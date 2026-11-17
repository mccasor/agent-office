import type { Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { scanCwd } from './cwdscan.js';
import { outside, posixRel, SESSION_RE } from './paths.js';

export interface ForeignDiscoveryOptions {
  /** <claudeHome>/projects */
  projectsRoot: string;
  /** cartella codificata della cwd monitorata: seguita dal watcher principale, qui esclusa */
  projectDir: string;
  /** cartella monitorata */
  cwd: string;
  /** all'avvio si valutano solo i transcript modificati negli ultimi N ms */
  discoveryWindowMs: number;
  now: () => number;
  /** sessione trovata: il chiamante ne segue transcript e subagenti */
  onMatch: (abs: string) => void;
}

export interface ForeignDiscovery {
  /** osserva le altre cartelle di projects e valuta i transcript recenti */
  start(): Promise<void>;
  /**
   * rete di sicurezza del tick: candidati recenti cresciuti e, al più ogni minuto, tutti i candidati e i nuovi
   * transcript mai segnalati
   */
  resync(): Promise<void>;
  stop(): Promise<void>;
  /** sessione di altra cartella già selezionata */
  has(sessionId: string): boolean;
}

/** intervallo minimo tra due scansioni complete delle cartelle di projects */
const RESCAN_MS = 60_000;

/**
 * Scoperta delle sessioni di altre cartelle di projects (cartella codificata assente, path abbreviati,
 * Claude avviato in una cartella superiore): una sessione è selezionata per cartella di avvio (`scanCwd`, #115),
 * cioè se la prima riga con `cwd` è nella cartella monitorata, o in una superiore e poi passa in quella monitorata.
 */
export function createForeignDiscovery(opts: ForeignDiscoveryOptions): ForeignDiscovery {
  const { projectsRoot, projectDir, discoveryWindowMs, now } = opts;
  const projectName = basename(projectDir);
  /** sessioni attribuite alla cartella monitorata */
  const foreignSessions = new Set<string>();
  /**
   * transcript già scansionati senza match: offset da cui riprendere, mtime all'ultimo controllo, cartella di avvio
   * superiore già vista (`started`), avviati altrove (`rejected`, non più valutati), byte iniziali saltati (`skipped`)
   */
  const candidates = new Map<
    string,
    { offset: number; mtime: number; queue: Promise<void>; started: boolean; rejected: boolean; skipped: boolean }
  >();
  let discovery: FSWatcher | null = null;
  let running = false;
  let lastRescan = -Infinity;

  /** <projects>/<cartella non codificata>/<sessione>.jsonl */
  const isCandidate = (abs: string): boolean => {
    const parts = posixRel(projectsRoot, abs).split('/');
    return parts.length === 2 && parts[0] !== projectName && parts[0] !== '..' && SESSION_RE.test(parts[1] ?? '');
  };

  const ignored = (abs: string, stats?: { isFile(): boolean; isDirectory(): boolean }): boolean => {
    const rel = posixRel(projectsRoot, abs);
    if (rel === '' || outside(rel)) return false;
    const parts = rel.split('/');
    if (parts[0] === projectName) return true; // seguita dal watcher principale
    if (parts.length === 1) return Boolean(stats?.isFile());
    return !isCandidate(abs) || Boolean(stats?.isDirectory());
  };

  /**
   * Scansione incrementale (solo byte nuovi) fino all'attribuzione della sessione (`scanCwd`).
   * `known`: stat già fatto da chokidar (scansione iniziale), evita di ripeterlo su migliaia di transcript vecchi.
   */
  const evaluate = (abs: string, initial: boolean, known?: Stats): Promise<void> => {
    if (foreignSessions.has(basename(abs, '.jsonl'))) return Promise.resolve();
    let c = candidates.get(abs);
    if (!c) candidates.set(abs, (c = { offset: 0, mtime: 0, queue: Promise.resolve(), started: false, rejected: false, skipped: false }));
    const cand = c;
    if (cand.rejected) return Promise.resolve();
    cand.queue = cand.queue.then(async () => {
      if (!running || foreignSessions.has(basename(abs, '.jsonl'))) return;
      try {
        const st = known ?? (await stat(abs));
        cand.mtime = st.mtimeMs;
        if (initial && st.mtimeMs < now() - discoveryWindowMs) {
          // sessione vecchia: conta solo se riprende; allora si rilegge dall'inizio per la cartella di avvio
          cand.offset = st.size;
          cand.skipped = true;
          return;
        }
        if (cand.skipped && st.size > cand.offset) {
          cand.skipped = false;
          cand.offset = 0;
        }
        if (st.size < cand.offset) Object.assign(cand, { offset: 0, started: false });
      } catch {
        return;
      }
      const { match, offset, started, rejected } = await scanCwd(abs, opts.cwd, cand.offset, undefined, cand.started);
      Object.assign(cand, { offset, started, rejected });
      if (!match || !running) return;
      candidates.delete(abs);
      foreignSessions.add(basename(abs, '.jsonl'));
      opts.onMatch(abs);
    }).catch(() => {
      // come per i file seguiti: si riprova al prossimo evento
    });
    return cand.queue;
  };

  return {
    async start() {
      running = true;
      const scans: Promise<void>[] = [];
      const w = (discovery = watch(projectsRoot, { depth: 1, ignored }));
      w.on('add', (abs, st) => void (isCandidate(abs) && scans.push(evaluate(abs, true, st))));
      w.on('change', (abs) => void (isCandidate(abs) && evaluate(abs, false)));
      w.on('error', () => {
        // come il watcher principale
      });
      await new Promise<void>((resolve) => w.once('ready', resolve));
      await Promise.all(scans);
      w.removeAllListeners('add');
      w.on('add', (abs) => void (isCandidate(abs) && evaluate(abs, false)));
    },
    async resync() {
      const checks: Promise<unknown>[] = [];
      // a ogni tick solo i candidati recenti: quelli fermi da tempo (spesso migliaia, di tutti i progetti) li segnala
      // il watcher se riprendono, e la scansione completa li ricontrolla al più ogni minuto
      const full = now() - lastRescan >= RESCAN_MS;
      for (const [abs, c] of candidates) {
        if (c.rejected || (!full && c.mtime < now() - discoveryWindowMs)) continue;
        checks.push(stat(abs).then((st) => (st.size > c.offset ? evaluate(abs, false) : undefined), () => {}));
      }
      // transcript mai segnalati dal watcher (scansione completa al più ogni minuto)
      if (!full) {
        await Promise.all(checks);
        return;
      }
      lastRescan = now();
      const dirs = await readdir(projectsRoot).catch(() => [] as string[]);
      for (const dir of dirs) {
        if (dir === projectName) continue;
        const names = await readdir(join(projectsRoot, dir)).catch(() => [] as string[]);
        for (const name of names) {
          const abs = join(projectsRoot, dir, name);
          if (isCandidate(abs) && !candidates.has(abs) && !foreignSessions.has(basename(name, '.jsonl'))) {
            checks.push(evaluate(abs, true));
          }
        }
      }
      await Promise.all(checks);
    },
    async stop() {
      running = false;
      await discovery?.close();
      discovery = null;
      await Promise.all([...candidates.values()].map((c) => c.queue));
    },
    has: (sessionId) => foreignSessions.has(sessionId),
  };
}
