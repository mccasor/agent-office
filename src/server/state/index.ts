import type { HookEvent, RepoState, Snapshot, TranscriptSnapshot } from '../../shared/types.js';

/** Funzione pura: combina transcript + eventi hook + git nello Snapshot inviato al browser. */
export function buildSnapshot(_input: {
  transcript: TranscriptSnapshot;
  hookEvents: HookEvent[];
  repo: RepoState | null;
  now: number;
}): Snapshot {
  throw new Error('not implemented');
}
