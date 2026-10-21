import type { RepoState } from '../../shared/types.js';

/** null se cwd non è un repo git o git non è disponibile */
export function readRepoState(_cwd: string): Promise<RepoState | null> {
  throw new Error('not implemented');
}
