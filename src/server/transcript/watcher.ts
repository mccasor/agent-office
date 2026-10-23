import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { estimateCost } from '../../shared/pricing.js';
import type { AgentState, AgentStatus, TokenUsage, TranscriptSession, TranscriptSnapshot, Watcher } from '../../shared/types.js';
import { classifyArea } from './classify.js';
import { scanCwd } from './cwdscan.js';
import { encodeProjectPath } from './encode.js';
import { contextWindowFor } from './models.js';
import { createAccumulator, extractIssues, type Accumulator } from './parser.js';
import { createLineReader, type LineReader } from './reader.js';

export interface TranscriptWatcherOptions {
  /** cartella monitorata (cwd dell'utente); ignorata con `all` */
  cwd: string;
  /**
   * tutte le sessioni di tutte le cartelle di projects (app della menu bar): all'avvio si leggono solo i transcript
   * modificati negli ultimi discoveryWindowMs; nello snapshot restano solo le sessioni attive e i loro subagenti
   */
  all?: boolean;
  /** default: ~/.claude */
  claudeHome?: string;
  /** una sessione è attiva se modificata negli ultimi N ms (default 10 min) */
  activeWindowMs?: number;
  /** un agente non terminato è idle se fermo da più di N ms (default 60 s) */
  idleAfterMs?: number;
  /** risposta finale senza stop_reason: considerata definitiva dopo N ms di silenzio (default 3 s) */
  doneGraceMs?: number;
  /**
   * sessioni in altre cartelle di projects (cartella codificata assente, path abbreviati, Claude avviato in una
   * cartella superiore): all'avvio si valutano solo i transcript modificati negli ultimi N ms
   * (default activeWindowMs + 1 h); quelli modificati dopo l'avvio sono valutati sempre
   */
  discoveryWindowMs?: number;
  /** intervallo di ricalcolo degli stati dipendenti dal tempo (default 5 s) */
  tickMs?: number;
  now?: () => number;
}

interface TrackedFile {
  parsed: Parsed;
  reader: LineReader;
  acc: Accumulator;
  mtime: number;
  /** dimensione all'ultima lettura: il tick la confronta per recuperare eventi persi */
  size: number;
  /** false finché la prima lettura non è completata: il file non compare nello snapshot */
  loaded: boolean;
  /** serializza le letture dello stesso file */
  queue: Promise<void>;
}

interface AgentMeta {
  agentType: string;
  description: string;
}

type Parsed =
  | { kind: 'session'; sessionId: string }
  | { kind: 'agent'; sessionId: string; agentId: string }
  | { kind: 'meta'; sessionId: string; agentId: string };

const SESSION_RE = /^([^/]+)\.jsonl$/;
const AGENT_RE = /^([^/]+)\/subagents\/(?:workflows\/[^/]+\/)?agent-([^/]+)\.(jsonl|meta\.json)$/;
const UNKNOWN_AGENT_TYPE = 'unknown';
/** ritardo con cui si accorpano le notifiche di una raffica di righe */
const EMIT_DELAY_MS = 100;
/** intervallo minimo tra due scansioni complete delle cartelle di projects (modalità progetto) */
const RESCAN_MS = 60_000;
/** cartelle di una sessione senza transcript: non serve osservarle */
const SKIP_DIR_RE = /(?:^|\/)(?:tool-results|memory)(?:\/|$)/;

function parsePath(rel: string): Parsed | null {
  const session = SESSION_RE.exec(rel);
  if (session?.[1]) return { kind: 'session', sessionId: session[1] };
  const agent = AGENT_RE.exec(rel);
  if (agent?.[1] && agent[2]) return { kind: agent[3] === 'jsonl' ? 'agent' : 'meta', sessionId: agent[1], agentId: agent[2] };
  return null;
}

const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  const input = a.input + b.input;
  const output = a.output + b.output;
  const cacheRead = a.cacheRead + b.cacheRead;
  const cacheCreation = a.cacheCreation + b.cacheCreation;
  return { input, output, cacheRead, cacheCreation, total: input + output + cacheRead + cacheCreation };
}

const mergeIssues = (a: number[], b: number[]): number[] => [...new Set([...a, ...b])].slice(0, 3);

export function createTranscriptWatcher(opts: TranscriptWatcherOptions): Watcher<TranscriptSnapshot> {
  const claudeHome = opts.claudeHome ?? join(homedir(), '.claude');
  const projectsRoot = join(claudeHome, 'projects');
  const projectDir = join(projectsRoot, encodeProjectPath(opts.cwd));
  const activeWindowMs = opts.activeWindowMs ?? 10 * 60_000;
  const discoveryWindowMs = opts.discoveryWindowMs ?? activeWindowMs + 60 * 60_000;
  const idleAfterMs = opts.idleAfterMs ?? 60_000;
  const doneGraceMs = opts.doneGraceMs ?? 3_000;
  const tickMs = opts.tickMs ?? 5_000;
  const now = opts.now ?? Date.now;

  const files = new Map<string, TrackedFile>();
  const metas = new Map<string, AgentMeta>();
  const listeners = new Set<(value: TranscriptSnapshot) => void>();
  let fsWatcher: FSWatcher | null = null;
  /** sessioni di altre cartelle di projects con almeno una riga `cwd` nella cartella monitorata */
  const foreignSessions = new Set<string>();
  /** transcript di altre cartelle già scansionati senza match: offset da cui riprendere */
  const candidates = new Map<string, { offset: number; queue: Promise<void> }>();
  let discovery: FSWatcher | null = null;
  let pendingFollow: string[] = [];
  let timer: NodeJS.Timeout | null = null;
  let lastEmitted = '';
  let running = false;
  let emitTimer: NodeJS.Timeout | null = null;
  let lastRescan = -Infinity;

  const posixRel = (from: string, to: string) => relative(from, to).split(sep).join('/');
  const outside = (rel: string) => rel === '..' || rel.startsWith('../') || isAbsolute(rel);

  const all = opts.all === true;
  /** false durante la scansione iniziale: in modalità all i file vecchi non vengono letti */
  let started = false;

  /** file della cartella codificata, o di una sessione di altra cartella già selezionata (con `all`: qualunque) */
  const parseAbs = (abs: string): Parsed | null => {
    if (all) {
      const rel = posixRel(projectsRoot, abs);
      const slash = rel.indexOf('/');
      return outside(rel) || slash < 0 ? null : parsePath(rel.slice(slash + 1));
    }
    const inProject = posixRel(projectDir, abs);
    if (!outside(inProject)) return parsePath(inProject);
    const rel = posixRel(projectsRoot, abs);
    const slash = rel.indexOf('/');
    if (outside(rel) || slash < 0) return null;
    const p = parsePath(rel.slice(slash + 1));
    return p && foreignSessions.has(p.sessionId) ? p : null;
  };
  const agentKey = (sessionId: string, agentId: string) => `${sessionId}/${agentId}`;

  const agentStatus = (f: TrackedFile, updatedAt: number, t: number): AgentStatus => {
    const { finished, hasAssistant, backgroundTasks } = f.acc.state;
    // fine del turno ma con comandi in background aperti: riprenderà alla loro notifica, non ha finito
    const done = finished === 'confirmed' || (finished === 'tentative' && t - updatedAt >= doneGraceMs);
    if (done && backgroundTasks === 0) return 'done';
    if (!hasAssistant) return 'entering';
    return t - updatedAt > idleAfterMs ? 'idle' : 'working';
  };

  const compute = (): TranscriptSnapshot => {
    const t = now();
    const agents: AgentState[] = [];
    const bySession = new Map<string, { files: TrackedFile[]; tokens: TokenUsage; cost: number | null }>();
    const group = (sessionId: string) => {
      let g = bySession.get(sessionId);
      if (!g) bySession.set(sessionId, (g = { files: [], tokens: emptyTokens(), cost: null }));
      return g;
    };

    for (const f of files.values()) {
      const p = f.parsed;
      if (p.kind === 'meta' || !f.loaded) continue;
      const s = f.acc.state;
      const g = group(p.sessionId);
      g.files.push(f);
      g.tokens = addTokens(g.tokens, s.tokens);
      // costo per file: la sessione e i suoi subagenti possono usare modelli diversi
      const cost = estimateCost(s.model ?? s.declaredModel, s.tokens);
      if (cost !== null) g.cost = (g.cost ?? 0) + cost;
      if (p.kind !== 'agent') continue;

      const meta = metas.get(agentKey(p.sessionId, p.agentId));
      const agentType = meta?.agentType || UNKNOWN_AGENT_TYPE;
      const description = meta?.description ?? '';
      const updatedAt = Math.max(s.lastAt ?? 0, f.mtime);
      const status = agentStatus(f, updatedAt, t);
      agents.push({
        id: p.agentId,
        sessionId: p.sessionId,
        name: description || agentType,
        agentType,
        description,
        area: classifyArea({ agentType, description, filePaths: s.filePaths }),
        status,
        model: s.model,
        tokens: { ...s.tokens },
        progress: s.progress ? { ...s.progress } : null,
        issues: mergeIssues(extractIssues(description), s.issues),
        startedAt: s.firstAt ?? f.mtime,
        updatedAt,
        tool: status === 'done' ? null : s.tool,
        cost: estimateCost(s.model ?? s.declaredModel, s.tokens),
      });
    }

    const sessions: TranscriptSession[] = [];
    for (const [sessionId, g] of bySession) {
      const main = g.files.find((f) => f.parsed.kind === 'session');
      if (!main) continue;
      const s = main.acc.state;
      let updatedAt = 0;
      for (const f of g.files) {
        updatedAt = Math.max(updatedAt, f.acc.state.lastAt ?? 0, f.mtime);
      }
      sessions.push({
        id: sessionId,
        title: s.title,
        model: s.model,
        effort: s.effort,
        context: { used: s.contextUsed ?? 0, window: contextWindowFor(s.model, s.contextUsed ?? 0, s.declaredModel) },
        tokensUsed: g.tokens,
        startedAt: s.firstAt ?? main.mtime,
        updatedAt,
        active: t - updatedAt <= activeWindowMs,
        status: agentStatus(main, Math.max(s.lastAt ?? 0, main.mtime), t),
        issues: [...s.issues],
        cwd: s.cwd,
        branch: s.gitBranch,
        waiting: s.awaitingUser && !s.finished,
        waitingKind: s.awaitingUser && !s.finished ? s.awaitingKind : null,
        waitingSince: s.awaitingUser && !s.finished ? s.awaitingSince : null,
        tool: s.finished ? null : s.tool,
        cost: g.cost,
      });
    }

    if (all) {
      // solo il lavoro in corso: sessioni attive e i loro subagenti
      const active = new Set(sessions.filter((x) => x.active).map((x) => x.id));
      sessions.splice(0, sessions.length, ...sessions.filter((x) => active.has(x.id)));
      agents.splice(0, agents.length, ...agents.filter((a) => active.has(a.sessionId)));
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    agents.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    return { sessions, agents };
  };

  /**
   * Notifica i listener se lo snapshot è cambiato. Le righe arrivano a raffiche (più file, più righe al secondo):
   * un solo ricalcolo ogni EMIT_DELAY_MS; nessuno durante la scansione iniziale (start() calcola alla fine).
   */
  const emitIfChanged = () => {
    if (!running || !started || emitTimer) return;
    emitTimer = setTimeout(emitNow, EMIT_DELAY_MS);
    emitTimer.unref();
  };
  const emitNow = () => {
    emitTimer = null;
    if (!running) return;
    const snapshot = compute();
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastEmitted) return;
    lastEmitted = serialized;
    for (const listener of listeners) listener(snapshot);
  };

  const readMeta = async (abs: string, p: Extract<Parsed, { kind: 'meta' }>) => {
    try {
      const raw: unknown = JSON.parse(await readFile(abs, 'utf8'));
      if (typeof raw !== 'object' || raw === null) return;
      const { agentType, description } = raw as Record<string, unknown>;
      metas.set(agentKey(p.sessionId, p.agentId), {
        agentType: typeof agentType === 'string' ? agentType : UNKNOWN_AGENT_TYPE,
        description: typeof description === 'string' ? description : '',
      });
    } catch {
      // meta.json scritto a metà o malformato: si riprova al prossimo evento
    }
  };

  const processFile = (abs: string): Promise<void> => {
    const p = parseAbs(abs);
    if (!p) return Promise.resolve();
    if (p.kind === 'meta') return readMeta(abs, p).then(emitIfChanged);

    const f = files.get(abs);
    if (!f && all && !started) {
      // scansione iniziale in modalità all: si leggono solo i transcript recenti
      return stat(abs).then(
        (st) => (st.mtimeMs >= now() - discoveryWindowMs ? track(abs, p) : undefined),
        () => undefined,
      );
    }
    return track(abs, p, f);
  };

  const track = (abs: string, p: Exclude<Parsed, { kind: 'meta' }>, existing?: TrackedFile): Promise<void> => {
    let f = existing ?? files.get(abs);
    if (!f) {
      f = { parsed: p, reader: createLineReader(abs), acc: createAccumulator(), mtime: 0, size: 0, loaded: false, queue: Promise.resolve() };
      files.set(abs, f);
    }
    const tracked = f;
    tracked.queue = tracked.queue.then(async () => {
      // a blocchi: la prima lettura di un transcript grande non lo carica tutto in memoria
      for (let more = true; more; ) {
        const r = await tracked.reader.read();
        if (r.reset) tracked.acc = createAccumulator();
        for (const line of r.lines) tracked.acc.ingest(line);
        more = r.more;
      }
      try {
        const st = await stat(abs);
        tracked.mtime = st.mtimeMs;
        tracked.size = st.size;
      } catch {
        // file rimosso nel frattempo
      }
      tracked.loaded = true;
      emitIfChanged();
    }).catch(() => {
      // lettura fallita (file sparito o illeggibile): la catena resta viva, si riprova al prossimo evento
    });
    return tracked.queue;
  };

  /**
   * Rete di sicurezza: gli eventi del filesystem possono andare persi (FSEvents/chokidar sotto carico,
   * file aggiunti al watcher durante la scansione iniziale). Rilegge i file cresciuti dall'ultima lettura.
   */
  const resync = async () => {
    const checks: Promise<unknown>[] = [];
    for (const [abs, f] of files) {
      checks.push(stat(abs).then((st) => (st.size !== f.size ? processFile(abs) : undefined), () => {}));
    }
    for (const [abs, c] of candidates) {
      checks.push(stat(abs).then((st) => (st.size > c.offset ? evaluate(abs, false) : undefined), () => {}));
    }
    if (all) {
      // transcript fermi da più della finestra di scoperta: si dimenticano (se ripartono, si rileggono da capo)
      const t = now();
      for (const [abs, f] of files) {
        if (f.parsed.kind !== 'meta' && f.loaded && t - f.mtime > discoveryWindowMs) files.delete(abs);
      }
      await Promise.all(checks);
      return;
    }
    // transcript di altre cartelle mai segnalati dal watcher di discovery (scansione completa al più ogni minuto)
    if (now() - lastRescan < RESCAN_MS) {
      await Promise.all(checks);
      return;
    }
    lastRescan = now();
    const dirs = await readdir(projectsRoot).catch(() => [] as string[]);
    for (const dir of dirs) {
      if (dir === basename(projectDir)) continue;
      const names = await readdir(join(projectsRoot, dir)).catch(() => [] as string[]);
      for (const name of names) {
        const abs = join(projectsRoot, dir, name);
        if (isCandidate(abs) && !candidates.has(abs) && !foreignSessions.has(basename(name, '.jsonl'))) {
          checks.push(evaluate(abs, true));
        }
      }
    }
    await Promise.all(checks);
  };

  const removeFile = (abs: string) => {
    const p = parseAbs(abs);
    if (!p) return;
    if (p.kind === 'meta') metas.delete(agentKey(p.sessionId, p.agentId));
    else files.delete(abs);
    emitIfChanged();
  };

  // antenati di projects (path non ancora esistente) o file pertinenti
  const isRelevant = (abs: string): boolean => outside(posixRel(projectsRoot, abs)) || parseAbs(abs) !== null;

  /** <projects>/<cartella non codificata>/<sessione>.jsonl */
  const isCandidate = (abs: string): boolean => {
    const parts = posixRel(projectsRoot, abs).split('/');
    return parts.length === 2 && parts[0] !== basename(projectDir) && parts[0] !== '..' && SESSION_RE.test(parts[1] ?? '');
  };

  const discoveryIgnored = (abs: string, stats?: { isFile(): boolean; isDirectory(): boolean }): boolean => {
    const rel = posixRel(projectsRoot, abs);
    if (rel === '' || outside(rel)) return false;
    const parts = rel.split('/');
    if (parts[0] === basename(projectDir)) return true; // seguita dal watcher principale
    if (parts.length === 1) return Boolean(stats?.isFile());
    return !isCandidate(abs) || Boolean(stats?.isDirectory());
  };

  /** segue sessione e subagenti di un transcript di altra cartella con il watcher principale */
  const follow = (abs: string) => {
    const sessionId = basename(abs, '.jsonl');
    foreignSessions.add(sessionId);
    const paths = [abs, join(dirname(abs), sessionId)];
    if (fsWatcher) fsWatcher.add(paths);
    else pendingFollow.push(...paths);
  };

  /** scansione incrementale (solo byte nuovi) fino al primo `cwd` nella cartella monitorata */
  const evaluate = (abs: string, initial: boolean): Promise<void> => {
    if (foreignSessions.has(basename(abs, '.jsonl'))) return Promise.resolve();
    let c = candidates.get(abs);
    if (!c) candidates.set(abs, (c = { offset: 0, queue: Promise.resolve() }));
    const cand = c;
    cand.queue = cand.queue.then(async () => {
      if (!running || foreignSessions.has(basename(abs, '.jsonl'))) return;
      try {
        const st = await stat(abs);
        if (initial && st.mtimeMs < now() - discoveryWindowMs) {
          // sessione vecchia: conta solo se riprende, quindi si valutano soltanto i byte nuovi
          cand.offset = st.size;
          return;
        }
        if (st.size < cand.offset) cand.offset = 0;
      } catch {
        return;
      }
      const { match, offset } = await scanCwd(abs, opts.cwd, cand.offset);
      cand.offset = offset;
      if (!match || !running) return;
      candidates.delete(abs);
      follow(abs);
    }).catch(() => {
      // come per i file seguiti: si riprova al prossimo evento
    });
    return cand.queue;
  };

  const startDiscovery = async () => {
    const scans: Promise<void>[] = [];
    discovery = watch(projectsRoot, { depth: 1, ignored: discoveryIgnored });
    discovery.on('add', (abs) => void (isCandidate(abs) && scans.push(evaluate(abs, true))));
    discovery.on('change', (abs) => void (isCandidate(abs) && evaluate(abs, false)));
    discovery.on('error', () => {
      // come il watcher principale
    });
    await new Promise<void>((resolve) => discovery?.once('ready', resolve));
    await Promise.all(scans);
    discovery.removeAllListeners('add');
    discovery.on('add', (abs) => void (isCandidate(abs) && evaluate(abs, false)));
  };

  return {
    async start() {
      if (running) return;
      running = true;
      if (!all) await startDiscovery();
      const pending: Promise<void>[] = [];
      fsWatcher = watch(all ? [projectsRoot] : [projectDir, ...pendingFollow], {
        // senza `depth` chokidar usa un solo watcher ricorsivo (FSEvents) invece di uno per cartella
        ignored: (abs, stats) => SKIP_DIR_RE.test(posixRel(projectsRoot, abs)) || (Boolean(stats?.isFile()) && !isRelevant(abs)),
      });
      fsWatcher.on('add', (abs) => void pending.push(processFile(abs)));
      fsWatcher.on('change', (abs) => void processFile(abs));
      fsWatcher.on('unlink', removeFile);
      fsWatcher.on('error', () => {
        // permessi o race del filesystem: il watcher continua sugli altri file
      });
      await new Promise<void>((resolve) => fsWatcher?.once('ready', resolve));
      await Promise.all(pending);
      // dopo la scansione iniziale gli add non vanno più accumulati
      fsWatcher.removeAllListeners('add');
      fsWatcher.on('add', (abs) => void processFile(abs));
      pendingFollow = [];
      started = true;
      lastEmitted = JSON.stringify(compute());
      timer = setInterval(() => void resync().then(emitIfChanged), tickMs);
      timer.unref();
    },
    async stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = null;
      await Promise.all([fsWatcher?.close(), discovery?.close()]);
      fsWatcher = null;
      discovery = null;
      await Promise.all([...files.values(), ...candidates.values()].map((f) => f.queue));
    },
    current: compute,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
