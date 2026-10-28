import type { GitDayReport } from '../../shared/types.js';
import { attribute, createCommitScanner, type TranscriptSource } from './attribution.js';
import { createGitDayReader, dayBounds, localDay, type GitRunner } from './log.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** transcript da cui attribuire i commit; `since`: inizio del giorno (quelli fermi da prima si possono saltare) */
export type SourcesOf = (since: number) => Promise<TranscriptSource[]>;

export interface GitReports {
  /**
   * Scheda Git (#109): commit del giorno ("YYYY-MM-DD", null = oggi) nel repository di `cwd`, attribuiti con i
   * transcript di `sources`. null se il giorno non è valido.
   */
  report(cwd: string | null, day: string | null, sources: SourcesOf): Promise<GitDayReport | null>;
}

/** git log in cache per repository e giorno; l'attribuzione si rifà a ogni richiesta (i transcript si leggono a pezzi). */
export function createGitReports(opts: { run?: GitRunner; now?: () => number } = {}): GitReports {
  const now = opts.now ?? Date.now;
  const reader = createGitDayReader(opts);
  const scanner = createCommitScanner();
  return {
    async report(cwd, day, sources) {
      const today = localDay(now());
      const wanted = day ?? today;
      if (!DAY_RE.test(wanted) || Number.isNaN(new Date(`${wanted}T00:00:00`).getTime())) return null;
      const repo = await reader.read(cwd, wanted);
      // oggi c'è sempre, e anche il giorno chiesto; niente giorni futuri
      const days = [...new Set([today, wanted, ...repo.days])].filter((d) => d <= today).sort().reverse();
      const seen = repo.commits.length > 0 ? await scanner.scan(await sources(dayBounds(wanted).start)) : [];
      return {
        day: wanted,
        days,
        status: repo.status,
        project: repo.project,
        branch: repo.branch,
        commits: attribute(repo.commits, seen),
        truncated: repo.truncated,
      };
    },
  };
}
