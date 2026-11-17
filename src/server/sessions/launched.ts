import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { Watcher } from '../../shared/types.js';
import { systemProbe } from './index.js';

/** Sessione di Claude Code lanciata dall'app nel terminale integrato (#119), con il session id già noto. */
export interface LaunchedSession {
  sessionId: string;
  pid: number;
  cwd: string;
  /** epoch ms */
  launchedAt: number;
}

/** default: AGENT_OFFICE_DATA_DIR, altrimenti ~/.agent-office (come il server) */
export function launchedFilePath(opts: { dataDir?: string } = {}): string {
  const dataDir = opts.dataDir ?? (process.env.AGENT_OFFICE_DATA_DIR || join(homedir(), '.agent-office'));
  return join(dataDir, 'launched.json');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Contenuto di launched.json (qualunque) → sessioni valide: `{ version, sessions: [{ sessionId, pid, cwd, launchedAt }] }`.
 * Voci non valide scartate, altri campi ignorati; per sessione vale la prima voce. Pura, non lancia mai.
 */
export function parseLaunched(raw: unknown): LaunchedSession[] {
  if (!isObj(raw) || !Array.isArray(raw.sessions)) return [];
  const out = new Map<string, LaunchedSession>();
  for (const e of raw.sessions) {
    if (!isObj(e)) continue;
    const { sessionId, pid, cwd, launchedAt } = e;
    if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId) || out.has(sessionId)) continue;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue;
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) continue;
    if (typeof launchedAt !== 'number' || !Number.isFinite(launchedAt) || launchedAt < 0) continue;
    out.set(sessionId, { sessionId, pid, cwd, launchedAt });
  }
  return [...out.values()];
}

export interface LaunchedWatcherOptions {
  /** default: launchedFilePath() */
  file?: string;
  /** il processo esiste: una voce rimasta dopo la chiusura dell'app non tiene aperta la stanza (default: kill(pid, 0)) */
  exists?: (pid: number) => boolean;
  /** rilettura periodica: eventi persi e processi terminati (default 5 s) */
  tickMs?: number;
}

/**
 * Sessioni lanciate dall'app, da `<dataDir>/launched.json` (lo scrive l'app con file temporaneo e rename e toglie la
 * voce quando il processo termina). Si osserva la cartella, non il file (sostituito o assente), più una rilettura
 * periodica. File assente o non valido = nessuna sessione. Contiene solo id, pid, cartella e orario: mai prompt.
 */
export function createLaunchedWatcher(opts: LaunchedWatcherOptions = {}): Watcher<LaunchedSession[]> {
  const file = opts.file ?? launchedFilePath();
  const exists = opts.exists ?? ((pid: number) => systemProbe.exists(pid));
  const tickMs = opts.tickMs ?? 5_000;
  const listeners = new Set<(v: LaunchedSession[]) => void>();
  let sessions: LaunchedSession[] = [];
  let last = '[]';
  let fsw: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  /** letture serializzate: una lettura vecchia non sovrascrive una più recente */
  let queue = Promise.resolve();

  const readNow = async () => {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      raw = null; // assente, scritto a metà o malformato
    }
    const next = parseLaunched(raw).filter((s) => exists(s.pid));
    const text = JSON.stringify(next);
    if (text === last) return;
    last = text;
    sessions = next;
    if (running) for (const l of listeners) l(sessions);
  };
  const read = () => (queue = queue.then(readNow, readNow));

  return {
    async start() {
      if (running) return;
      await read();
      running = true;
      try {
        await mkdir(dirname(file), { recursive: true });
        const { watch } = await import('chokidar');
        const w = (fsw = watch(dirname(file), { depth: 0, ignoreInitial: true, ignored: (p) => p !== dirname(file) && basename(p) !== basename(file) }));
        const onFile = (p: string) => void (basename(p) === basename(file) && read());
        w.on('add', onFile).on('change', onFile).on('unlink', onFile).on('error', () => {});
        await new Promise<void>((resolve) => w.once('ready', () => resolve()));
      } catch {
        // cartella non osservabile: basta la rilettura periodica
      }
      await read();
      timer = setInterval(() => void read(), tickMs);
      timer.unref();
    },
    async stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      const w = fsw;
      fsw = null;
      await w?.close();
      await queue;
    },
    current: () => sessions,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
