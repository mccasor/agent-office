import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Processo di Claude Code di una sessione, da ~/.claude/sessions/<pid>.json (#104). */
export interface SessionProcessInfo {
  process: 'alive' | 'gone';
  /** busy al lavoro, idle in attesa di un prompt (dal file); null se assente o con il processo terminato */
  status: 'busy' | 'idle' | null;
  /** quando l'ufficio si è accorto della fine (epoch ms); null se era già terminato alla prima lettura */
  goneAt: number | null;
}

/** Controlli sui processi, iniettabili nei test. */
export interface ProcessProbe {
  /** il processo esiste (anche di un altro utente) */
  exists(pid: number): boolean;
  /** inizio dei processi come `ps -o lstart=` (UTC, LC_ALL=C), per pid; un pid assente non è stato trovato */
  startTimes(pids: number[]): Promise<Map<number, string>>;
}

export interface SessionProcesses {
  /**
   * Rilegge i file di sessione cambiati (stat; lettura solo dei `<pid>.json` nuovi o modificati) e controlla i
   * processi; senza `force` al più ogni minIntervalMs. True se lo stato di qualche sessione è cambiato.
   */
  refresh(force?: boolean): Promise<boolean>;
  /** stato noto della sessione; undefined se non c'è un file di sessione (verdetto "sconosciuto") */
  get(sessionId: string): SessionProcessInfo | undefined;
  /** tutte le sessioni note, per buildSnapshot */
  current(): ReadonlyMap<string, SessionProcessInfo>;
}

export interface SessionProcessesOptions {
  /** cartella dei file di sessione: <claudeHome>/sessions */
  dir: string;
  probe?: ProcessProbe;
  /** intervallo minimo tra due controlli non forzati (default 5 s) */
  minIntervalMs?: number;
  /** ogni quanto si riconferma con ps che il pid non sia stato riusato (default 60 s); kill(pid, 0) a ogni controllo */
  recheckMs?: number;
  now?: () => number;
}

/** contenuto utile di un file di sessione: mai gli altri campi (socket, nome, ...) */
interface Entry {
  pid: number;
  sessionId: string;
  procStart: string | null;
  status: 'busy' | 'idle' | null;
}

interface FileCache {
  mtimeMs: number;
  size: number;
  entry: Entry | null;
}

/** Sessione vista con un file: l'ultimo pid noto serve anche quando il file sparisce (uscita normale di Claude Code). */
interface Known extends Entry {
  info: SessionProcessInfo;
}

/** Solo i file `<pid>.json`: i `<pid>.<hash>.key` della stessa cartella contengono dei token e non si aprono mai. */
const SESSION_FILE_RE = /^\d+\.json$/;
/** sessioni terminate ricordate al più (le più vecchie si dimenticano) */
const MAX_GONE = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** "Wed Oct  1 09:37:06 2026" e "Wed Oct 1 09:37:06 2026" sono lo stesso istante */
const sameStart = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

function parseEntry(text: string): Entry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  const { pid, sessionId, procStart, status } = raw;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof sessionId !== 'string' || !sessionId) return null;
  return {
    pid,
    sessionId,
    procStart: typeof procStart === 'string' && procStart ? procStart : null,
    status: status === 'busy' || status === 'idle' ? status : null,
  };
}

/** process.kill(pid, 0) e un solo `ps` per tutti i pid da riconfermare. */
export const systemProbe: ProcessProbe = {
  exists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM: esiste, ma di un altro utente; ESRCH: non esiste
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  startTimes(pids) {
    return new Promise((ok, fail) => {
      execFile(
        'ps',
        ['-o', 'pid=,lstart=', '-p', pids.join(',')],
        { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }, timeout: 5_000 },
        (err, stdout) => {
          // ps esce con 1 se un pid non c'è, ma stampa gli altri
          if (err && !stdout) {
            fail(err);
            return;
          }
          const out = new Map<number, string>();
          for (const line of stdout.split('\n')) {
            const m = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
            if (m) out.set(Number(m[1]), m[2]!);
          }
          ok(out);
        },
      );
    });
  },
};

/**
 * Processi di Claude Code delle sessioni, in sola lettura. Claude Code scrive per ogni sessione aperta
 * `<claudeHome>/sessions/<pid>.json` con pid, sessionId, procStart (inizio del processo, come `ps -o lstart`) e
 * status. Il processo è vivo se esiste e ha lo stesso inizio (altrimenti il pid è stato riusato). Un file può
 * restare dopo la fine del processo, o sparire all'uscita: il pid già visto basta per accorgersi che è terminato.
 * Senza file (versioni vecchie, sessione mai vista aperta) la sessione resta sconosciuta.
 */
export function createSessionProcesses(opts: SessionProcessesOptions): SessionProcesses {
  const probe = opts.probe ?? systemProbe;
  const minIntervalMs = opts.minIntervalMs ?? 5_000;
  const recheckMs = opts.recheckMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const files = new Map<string, FileCache>();
  const known = new Map<string, Known>();
  /** inizio confermato da ps per pid e quando (per non lanciare ps a ogni controllo) */
  const verified = new Map<number, { start: string; at: number }>();
  let lastAt = -Infinity;
  let first = true;
  let running: Promise<boolean> | null = null;

  /** rilegge solo i file nuovi o cambiati (mtime o dimensione); gli altri restano in cache */
  const scan = async (): Promise<Entry[]> => {
    let names: string[];
    try {
      names = (await readdir(opts.dir)).filter((n) => SESSION_FILE_RE.test(n));
    } catch {
      names = []; // cartella assente: nessuna sessione con un file
    }
    const seen = new Set(names);
    for (const name of files.keys()) if (!seen.has(name)) files.delete(name);
    await Promise.all(
      names.map(async (name) => {
        const path = join(opts.dir, name);
        try {
          const st = await stat(path);
          const cached = files.get(name);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return;
          files.set(name, { mtimeMs: st.mtimeMs, size: st.size, entry: parseEntry(await readFile(path, 'utf8')) });
        } catch {
          files.delete(name); // sparito o illeggibile nel frattempo: si riprova al prossimo controllo
        }
      }),
    );
    return [...files.values()].flatMap((f) => (f.entry ? [f.entry] : []));
  };

  /** pid vivi: esistono e (riconfermato con ps al più ogni recheckMs) hanno lo stesso inizio del file */
  const aliveSet = async (entries: Entry[], t: number): Promise<Set<Entry>> => {
    const existing = entries.filter((e) => probe.exists(e.pid));
    const toCheck = existing.filter((e) => {
      if (e.procStart === null) return false;
      const v = verified.get(e.pid);
      return !v || !sameStart(v.start, e.procStart) || t - v.at >= recheckMs;
    });
    let starts: Map<number, string> | null = null;
    if (toCheck.length > 0) {
      try {
        // in ordine: i file arrivano in ordine di lettura, che cambia da un giro all'altro
        starts = await probe.startTimes([...new Set(toCheck.map((e) => e.pid))].sort((x, y) => x - y));
      } catch {
        starts = null; // ps non disponibile: basta che il processo esista
      }
    }
    const alive = new Set<Entry>();
    for (const e of existing) {
      if (starts && toCheck.includes(e)) {
        const start = starts.get(e.pid);
        if (start === undefined || !sameStart(start, e.procStart!)) {
          verified.delete(e.pid);
          continue; // terminato nel frattempo, o pid riusato da un altro processo
        }
        verified.set(e.pid, { start, at: t });
      } else if (e.procStart !== null && verified.has(e.pid) && !sameStart(verified.get(e.pid)!.start, e.procStart)) {
        continue;
      }
      alive.add(e);
    }
    return alive;
  };

  const check = async (): Promise<boolean> => {
    const t = now();
    const entries = await scan();
    const withFile = new Set(entries.map((e) => e.sessionId));
    // sessioni già viste che hanno perso il file: si controlla l'ultimo pid noto
    const orphans: Entry[] = [...known.values()].filter((k) => !withFile.has(k.sessionId) && k.info.process === 'alive');
    // pid passato a un'altra sessione (/clear, /resume): la sessione di prima è chiusa
    const reassigned = new Set(orphans.filter((o) => entries.some((e) => e.pid === o.pid && e.sessionId !== o.sessionId)));
    const alive = await aliveSet([...entries, ...orphans.filter((o) => !reassigned.has(o))], t);
    let changed = false;
    const update = (e: Entry, process: 'alive' | 'gone') => {
      const prev = known.get(e.sessionId);
      // l'ora della fine è quella in cui ce ne accorgiamo, tranne alla prima lettura (terminate da chissà quando)
      const goneAt = process === 'alive' ? null : prev?.info.process === 'gone' ? prev.info.goneAt : first ? null : t;
      const info: SessionProcessInfo = { process, status: process === 'alive' ? e.status : null, goneAt };
      if (!prev || prev.info.process !== info.process || prev.info.status !== info.status) changed = true;
      known.delete(e.sessionId);
      known.set(e.sessionId, { ...e, info });
    };
    // più file per la stessa sessione (ripresa in un altro processo): vale quello vivo
    const bySession = new Map<string, Entry>();
    for (const e of entries) if (!bySession.has(e.sessionId) || alive.has(e)) bySession.set(e.sessionId, e);
    for (const e of bySession.values()) update(e, alive.has(e) ? 'alive' : 'gone');
    for (const o of orphans) {
      if (reassigned.has(o) || !alive.has(o)) update(o, 'gone');
      else {
        // file sparito ma processo vivo: non si sa più nulla, la sessione torna sconosciuta
        known.delete(o.sessionId);
        changed = true;
      }
    }
    // le sessioni terminate restano ricordate (il file può sparire), ma non all'infinito
    const gone = [...known.values()].filter((k) => k.info.process === 'gone' && !withFile.has(k.sessionId));
    for (const k of gone.slice(0, Math.max(0, gone.length - MAX_GONE))) known.delete(k.sessionId);
    first = false;
    return changed;
  };

  return {
    refresh(force = false) {
      // un solo controllo alla volta: chi arriva durante uno in corso ne aspetta l'esito
      if (running) return running;
      const t = now();
      if (!force && t - lastAt < minIntervalMs) return Promise.resolve(false);
      lastAt = t;
      running = check().finally(() => {
        running = null;
      });
      return running;
    },
    get: (sessionId) => known.get(sessionId)?.info,
    current: () => new Map([...known].map(([id, k]) => [id, k.info])),
  };
}
