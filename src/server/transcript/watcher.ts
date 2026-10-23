import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { TranscriptSnapshot, Watcher } from '../../shared/types.js';
import { aggregate, UNKNOWN_AGENT_TYPE, type AgentMeta } from './aggregate.js';
import { createForeignDiscovery } from './discovery.js';
import { encodeProjectPath } from './encode.js';
import { createAccumulator, type Accumulator } from './parser.js';
import { agentKey, outside, parsePath, posixRel, type Parsed } from './paths.js';
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

type Transcript = Exclude<Parsed, { kind: 'meta' }>;

interface TrackedFile {
  parsed: Transcript;
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

/** ritardo con cui si accorpano le notifiche di una raffica di righe */
const EMIT_DELAY_MS = 100;
/** cartelle di una sessione senza transcript: non serve osservarle */
const SKIP_DIR_RE = /(?:^|\/)(?:tool-results|memory)(?:\/|$)/;

/** Solo I/O: osserva i transcript, li legge in modo incrementale e notifica lo snapshot calcolato da `aggregate`. */
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
  const all = opts.all === true;

  const files = new Map<string, TrackedFile>();
  const metas = new Map<string, AgentMeta>();
  const listeners = new Set<(value: TranscriptSnapshot) => void>();
  let fsWatcher: FSWatcher | null = null;
  /** cartelle da seguire trovate dalla discovery prima che il watcher principale esista */
  let pendingFollow: string[] = [];
  let timer: NodeJS.Timeout | null = null;
  let lastEmitted = '';
  let running = false;
  let emitTimer: NodeJS.Timeout | null = null;
  /** false durante la scansione iniziale: in modalità all i file vecchi non vengono letti */
  let started = false;

  /** segue sessione e subagenti di un transcript di altra cartella con il watcher principale */
  const follow = (abs: string) => {
    const paths = [abs, join(dirname(abs), basename(abs, '.jsonl'))];
    if (fsWatcher) fsWatcher.add(paths);
    else pendingFollow.push(...paths);
  };
  const discovery = createForeignDiscovery({ projectsRoot, projectDir, cwd: opts.cwd, discoveryWindowMs, now, onMatch: follow });

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
    return p && discovery.has(p.sessionId) ? p : null;
  };

  const compute = (): TranscriptSnapshot => {
    const loaded = [...files.values()].filter((f) => f.loaded).map((f) => ({ parsed: f.parsed, state: f.acc.state, mtime: f.mtime }));
    return aggregate(loaded, metas, now(), { activeWindowMs, idleAfterMs, doneGraceMs, onlyActive: all });
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

  const track = (abs: string, p: Transcript, existing?: TrackedFile): Promise<void> => {
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
    if (all) {
      // transcript fermi da più della finestra di scoperta: si dimenticano (se ripartono, si rileggono da capo)
      const t = now();
      for (const [abs, f] of files) {
        if (f.loaded && t - f.mtime > discoveryWindowMs) files.delete(abs);
      }
    } else {
      checks.push(discovery.resync());
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

  return {
    async start() {
      if (running) return;
      running = true;
      if (!all) await discovery.start();
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
      await Promise.all([fsWatcher?.close(), discovery.stop()]);
      fsWatcher = null;
      await Promise.all([...files.values()].map((f) => f.queue));
    },
    current: compute,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
