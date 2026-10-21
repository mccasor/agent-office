import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { RepoState } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

export const GIT_TIMEOUT_MS = 5_000;

/** stdout senza spazi finali, null se git fallisce (non repo, git assente, timeout, cwd inesistente) */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      // output non localizzato (parsing di --shortstat) e nessun lock opzionale sull'index
      env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C', GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** " 2 files changed, 3 insertions(+), 1 deletion(-)" -> numeri; stringa vuota -> zeri */
export function parseShortstat(out: string): Pick<RepoState, 'linesAdded' | 'linesRemoved' | 'filesChanged'> {
  const num = (re: RegExp): number => Number(re.exec(out)?.[1] ?? 0);
  return {
    filesChanged: num(/(\d+) files? changed/),
    linesAdded: num(/(\d+) insertions?\(\+\)/),
    linesRemoved: num(/(\d+) deletions?\(-\)/),
  };
}

async function readBranch(cwd: string, hasHead: boolean): Promise<string | null> {
  // repo senza commit: rev-parse HEAD fallisce, il ref simbolico esiste già
  if (!hasHead) return (await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])) || null;
  const ref = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (ref && ref !== 'HEAD') return ref;
  return (await git(cwd, ['rev-parse', '--short', 'HEAD'])) || null;
}

/** null se cwd non è un repo git o git non è disponibile */
export async function readRepoState(cwd: string): Promise<RepoState | null> {
  const toplevel = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!toplevel) return null;
  const hasHead = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null;
  // senza commit si contano solo le modifiche staged (git le confronta con l'albero vuoto)
  const [branch, stat] = await Promise.all([
    readBranch(cwd, hasHead),
    git(cwd, hasHead ? ['diff', '--shortstat', 'HEAD'] : ['diff', '--shortstat', '--cached']),
  ]);
  return { project: basename(toplevel), branch, ...parseShortstat(stat ?? '') };
}
