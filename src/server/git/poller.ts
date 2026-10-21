import type { RepoState } from '../../shared/types.js';
import { readRepoState } from './index.js';

export interface RepoPollerOptions {
  /** lettura dello stato (iniettabile nei test) */
  read?: (cwd: string) => Promise<RepoState | null>;
  /** intervallo minimo tra due letture dello stesso repository con attività */
  minIntervalMs?: number;
  /** rilettura anche senza attività (modifiche fatte fuori da Claude Code) */
  staleMs?: number;
}

export interface RepoPoller {
  /** cartelle da seguire: le altre vengono dimenticate */
  follow(cwds: Iterable<string>): void;
  /** attività nella cartella (es. il transcript della sessione è cambiato): rilettura al prossimo giro utile */
  touch(cwd: string): void;
  /** stato noto; null se non è un repository o non ancora letto */
  get(cwd: string): RepoState | null;
  /** legge i repository da aggiornare, uno alla volta; true se qualcosa è cambiato */
  poll(now: number): Promise<boolean>;
}

interface Entry { state: RepoState | null; dirty: boolean; readAt: number }

/**
 * Stato git (branch, righe aggiunte/tolte) di più cartelle senza lanciare git a vuoto: si rilegge un repository
 * solo dopo un'attività nella sua sessione (al massimo ogni minIntervalMs) o quando la lettura è vecchia di staleMs.
 */
export function createRepoPoller(opts: RepoPollerOptions = {}): RepoPoller {
  const read = opts.read ?? readRepoState;
  const minIntervalMs = opts.minIntervalMs ?? 3_000;
  const staleMs = opts.staleMs ?? 60_000;
  const entries = new Map<string, Entry>();
  let running = false;

  return {
    follow(cwds) {
      const wanted = new Set(cwds);
      for (const cwd of entries.keys()) if (!wanted.has(cwd)) entries.delete(cwd);
      for (const cwd of wanted) if (!entries.has(cwd)) entries.set(cwd, { state: null, dirty: true, readAt: -Infinity });
    },
    touch(cwd) {
      const e = entries.get(cwd);
      if (e) e.dirty = true;
    },
    get: (cwd) => entries.get(cwd)?.state ?? null,
    async poll(now) {
      // una sola passata alla volta: un repository lento non accumula processi git
      if (running) return false;
      running = true;
      let changed = false;
      try {
        for (const [cwd, e] of entries) {
          const due = e.dirty ? now - e.readAt >= minIntervalMs : now - e.readAt >= staleMs;
          if (!due) continue;
          e.dirty = false;
          e.readAt = now;
          const state = await read(cwd);
          if (entries.get(cwd) !== e) continue; // dimenticato nel frattempo
          if (JSON.stringify(state) !== JSON.stringify(e.state)) changed = true;
          e.state = state;
        }
      } finally {
        running = false;
      }
      return changed;
    },
  };
}
