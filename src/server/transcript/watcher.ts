import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { AgentState, AgentStatus, SessionState, TokenUsage, TranscriptSnapshot, Watcher } from '../../shared/types.js';
import { classifyArea } from './classify.js';
import { encodeProjectPath } from './encode.js';
import { contextWindowFor } from './models.js';
import { createAccumulator, type Accumulator } from './parser.js';
import { createLineReader, type LineReader } from './reader.js';

export interface TranscriptWatcherOptions {
  /** cartella monitorata (cwd dell'utente) */
  cwd: string;
  /** default: ~/.claude */
  claudeHome?: string;
  /** una sessione è attiva se modificata negli ultimi N ms (default 10 min) */
  activeWindowMs?: number;
  /** un agente non terminato è idle se fermo da più di N ms (default 60 s) */
  idleAfterMs?: number;
  /** risposta finale senza stop_reason: considerata definitiva dopo N ms di silenzio (default 3 s) */
  doneGraceMs?: number;
  /** intervallo di ricalcolo degli stati dipendenti dal tempo (default 5 s) */
  tickMs?: number;
  now?: () => number;
}

interface TrackedFile {
  parsed: Parsed;
  reader: LineReader;
  acc: Accumulator;
  mtime: number;
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

export function createTranscriptWatcher(opts: TranscriptWatcherOptions): Watcher<TranscriptSnapshot> {
  const claudeHome = opts.claudeHome ?? join(homedir(), '.claude');
  const projectDir = join(claudeHome, 'projects', encodeProjectPath(opts.cwd));
  const activeWindowMs = opts.activeWindowMs ?? 10 * 60_000;
  const idleAfterMs = opts.idleAfterMs ?? 60_000;
  const doneGraceMs = opts.doneGraceMs ?? 3_000;
  const tickMs = opts.tickMs ?? 5_000;
  const now = opts.now ?? Date.now;

  const files = new Map<string, TrackedFile>();
  const metas = new Map<string, AgentMeta>();
  const listeners = new Set<(value: TranscriptSnapshot) => void>();
  let fsWatcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastEmitted = '';
  let running = false;

  const relPath = (abs: string) => relative(projectDir, abs).split(sep).join('/');
  const agentKey = (sessionId: string, agentId: string) => `${sessionId}/${agentId}`;

  const agentStatus = (f: TrackedFile, updatedAt: number, t: number): AgentStatus => {
    const { finished, hasAssistant } = f.acc.state;
    if (finished === 'confirmed' || (finished === 'tentative' && t - updatedAt >= doneGraceMs)) return 'done';
    if (!hasAssistant) return 'entering';
    return t - updatedAt > idleAfterMs ? 'idle' : 'working';
  };

  const compute = (): TranscriptSnapshot => {
    const t = now();
    const agents: AgentState[] = [];
    const bySession = new Map<string, { files: TrackedFile[]; tokens: TokenUsage }>();
    const group = (sessionId: string) => {
      let g = bySession.get(sessionId);
      if (!g) bySession.set(sessionId, (g = { files: [], tokens: emptyTokens() }));
      return g;
    };

    for (const f of files.values()) {
      const p = f.parsed;
      if (p.kind === 'meta' || !f.loaded) continue;
      const s = f.acc.state;
      const g = group(p.sessionId);
      g.files.push(f);
      g.tokens = addTokens(g.tokens, s.tokens);
      if (p.kind !== 'agent') continue;

      const meta = metas.get(agentKey(p.sessionId, p.agentId));
      const agentType = meta?.agentType || UNKNOWN_AGENT_TYPE;
      const description = meta?.description ?? '';
      const updatedAt = Math.max(s.lastAt ?? 0, f.mtime);
      agents.push({
        id: p.agentId,
        sessionId: p.sessionId,
        name: description || agentType,
        agentType,
        description,
        area: classifyArea({ agentType, description, filePaths: s.filePaths }),
        status: agentStatus(f, updatedAt, t),
        model: s.model,
        tokens: { ...s.tokens },
        progress: s.progress ? { ...s.progress } : null,
        startedAt: s.firstAt ?? f.mtime,
        updatedAt,
      });
    }

    const sessions: SessionState[] = [];
    for (const [sessionId, g] of bySession) {
      const main = g.files.find((f) => f.parsed.kind === 'session');
      if (!main) continue;
      const s = main.acc.state;
      let tokensLeft: { value: number; at: number } | null = null;
      let updatedAt = 0;
      for (const f of g.files) {
        const left = f.acc.state.tokensLeft;
        if (left && (!tokensLeft || left.at >= tokensLeft.at)) tokensLeft = left;
        updatedAt = Math.max(updatedAt, f.acc.state.lastAt ?? 0, f.mtime);
      }
      sessions.push({
        id: sessionId,
        title: s.title,
        model: s.model,
        effort: s.effort,
        context: { used: s.contextUsed ?? 0, window: contextWindowFor(s.model) },
        tokensUsed: g.tokens,
        tokensLeft: tokensLeft?.value ?? null,
        startedAt: s.firstAt ?? main.mtime,
        updatedAt,
        active: t - updatedAt <= activeWindowMs,
      });
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    agents.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    return { sessions, agents };
  };

  const emitIfChanged = () => {
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
    const p = parsePath(relPath(abs));
    if (!p) return Promise.resolve();
    if (p.kind === 'meta') return readMeta(abs, p).then(emitIfChanged);

    let f = files.get(abs);
    if (!f) {
      f = { parsed: p, reader: createLineReader(abs), acc: createAccumulator(), mtime: 0, loaded: false, queue: Promise.resolve() };
      files.set(abs, f);
    }
    const tracked = f;
    tracked.queue = tracked.queue.then(async () => {
      const { lines, reset } = await tracked.reader.read();
      if (reset) tracked.acc = createAccumulator();
      for (const line of lines) tracked.acc.ingest(line);
      try {
        tracked.mtime = (await stat(abs)).mtimeMs;
      } catch {
        // file rimosso nel frattempo
      }
      tracked.loaded = true;
      emitIfChanged();
    });
    return tracked.queue;
  };

  const removeFile = (abs: string) => {
    const p = parsePath(relPath(abs));
    if (!p) return;
    if (p.kind === 'meta') metas.delete(agentKey(p.sessionId, p.agentId));
    else files.delete(abs);
    emitIfChanged();
  };

  const isRelevant = (abs: string): boolean => {
    const rel = relPath(abs);
    if (rel.startsWith('..')) return true; // antenati della cartella di progetto (path non ancora esistente)
    return parsePath(rel) !== null;
  };

  return {
    async start() {
      if (running) return;
      running = true;
      const pending: Promise<void>[] = [];
      fsWatcher = watch(projectDir, {
        // profondità massima: <session>/subagents/workflows/<wf>/agent-x.jsonl
        depth: 4,
        ignored: (abs, stats) => Boolean(stats?.isFile()) && !isRelevant(abs),
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
      lastEmitted = JSON.stringify(compute());
      timer = setInterval(emitIfChanged, tickMs);
      timer.unref();
    },
    async stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      await fsWatcher?.close();
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
