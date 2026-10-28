import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitDayReader, dayBounds, LOG_FORMAT, parseLog, parseNumstatLine, renamedPath, runGit, type GitRunner } from './log.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-gitlog-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RS = '\x1e';
const US = '\x1f';
const header = (hash: string, ct: number, source: string, subject: string) => `${RS}${hash}${US}${hash.slice(0, 7)}${US}${ct}${US}${ct - 5}${US}${source}${US}${subject}\n`;

describe('parser di --numstat', () => {
  it('righe normali, binari con "-" e righe non valide', () => {
    expect(parseNumstatLine('3\t1\tsrc/a.ts')).toEqual({ path: 'src/a.ts', added: 3, removed: 1 });
    expect(parseNumstatLine('-\t-\tassets/logo.png')).toEqual({ path: 'assets/logo.png', added: 0, removed: 0, binary: true });
    expect(parseNumstatLine('')).toBeNull();
    expect(parseNumstatLine('x\t1\ta')).toBeNull();
  });

  it('rinomine: a => b, {a => b} nel mezzo, lati vuoti', () => {
    expect(renamedPath('old.txt => new.txt')).toBe('new.txt');
    expect(renamedPath('src/{old => new}/x.ts')).toBe('src/new/x.ts');
    expect(renamedPath('src/{ => sub}/x.ts')).toBe('src/sub/x.ts');
    expect(renamedPath('src/{sub => }/x.ts')).toBe('src/x.ts');
    expect(renamedPath('{a => b}.ts')).toBe('b.ts');
    expect(renamedPath('plain/path.ts')).toBe('plain/path.ts');
    expect(parseNumstatLine('0\t0\tdocs/{a.md => b.md}')).toEqual({ path: 'docs/b.md', added: 0, removed: 0 });
  });

  it('commit con file, totali, branch da --source e solo la prima riga del messaggio', () => {
    const out =
      header('a'.repeat(40), 1000, 'refs/heads/main', 'feat: uno') + '\n3\t1\tsrc/a.ts\n-\t-\tlogo.png\n2\t0\tsrc/{x => y}/b.ts\n' +
      header('b'.repeat(40), 900, 'HEAD', 'fix: due') + '\n' +
      header('c'.repeat(40), 800, 'feature/x', `con${US}separatore`);
    const commits = parseLog(out);
    expect(commits).toHaveLength(3);
    expect(commits[0]).toEqual({
      hash: 'a'.repeat(40),
      short: 'aaaaaaa',
      at: 1_000_000,
      authoredAt: 995_000,
      branch: 'main',
      message: 'feat: uno',
      added: 5,
      removed: 1,
      files: [
        { path: 'src/a.ts', added: 3, removed: 1 },
        { path: 'logo.png', added: 0, removed: 0, binary: true },
        { path: 'src/y/b.ts', added: 2, removed: 0 },
      ],
      filesCount: 3,
    });
    // HEAD staccato: nessun branch; un commit senza file
    expect(commits[1]).toMatchObject({ branch: null, files: [], filesCount: 0, message: 'fix: due' });
    expect(commits[2]).toMatchObject({ branch: 'feature/x', message: `con${US}separatore` });
  });

  it('record illeggibili scartati', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog(`${RS}nonhash${US}x${US}1${US}1${US}m${US}s\n`)).toEqual([]);
    expect(parseLog(`${RS}troppo${US}pochi\n`)).toEqual([]);
  });

  it('il formato di git log è quello che parseLog si aspetta', () => {
    expect(LOG_FORMAT).toBe(`--format=${RS}%H${US}%h${US}%ct${US}%at${US}%S${US}%s`);
  });
});

describe('dayBounds', () => {
  it('dalla mezzanotte locale alla successiva', () => {
    const { start, end } = dayBounds('2026-10-20');
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(start).getDate()).toBe(20);
    expect(new Date(end).getDate()).toBe(21);
    expect(new Date(end).getHours()).toBe(0);
  });
});

/** epoch ms di un'ora locale del 20 ottobre 2026 */
const at = (hour: number, day = 20) => new Date(2026, 9, day, hour).getTime();

function git(cwd: string, args: string[], when?: number): string {
  const date = when === undefined ? undefined : `${Math.floor(when / 1000)} +0000`;
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim();
}

function initRepo(): string {
  const dir = tempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function commit(dir: string, file: string, content: string, when: number, message = `add ${file}`): void {
  writeFileSync(join(dir, file), content);
  git(dir, ['add', file]);
  git(dir, ['commit', '-q', '-m', message, '-m', 'corpo del messaggio'], when);
}

/** runner che conta le chiamate a git log */
function counting(): { run: GitRunner; logs: () => number } {
  let logs = 0;
  return {
    run: (cwd, args) => {
      if (args.includes('log')) logs++;
      return runGit(cwd, args);
    },
    logs: () => logs,
  };
}

describe('createGitDayReader', () => {
  it('commit del giorno su tutti i branch, merge esclusi, giorni con commit', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'uno\n', at(9, 19));
    commit(dir, 'b.txt', 'uno\ndue\n', at(10));
    git(dir, ['checkout', '-q', '-b', 'feature']);
    commit(dir, 'c.txt', 'x\n', at(11));
    git(dir, ['checkout', '-q', 'main']);
    commit(dir, 'd.txt', 'y\n', at(12));
    git(dir, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature'], at(13));
    // branch di un agente con la punta più recente: i commit di main restano di main
    git(dir, ['checkout', '-q', '-b', 'wt']);
    commit(dir, 'e.txt', 'z\n', at(14));
    git(dir, ['checkout', '-q', 'main']);
    const reader = createGitDayReader({ now: () => at(15, 21) });
    const day = await reader.read(dir, '2026-10-20');
    expect(day.status).toBe('ok');
    expect(day.project).toBe(basename(dir));
    expect(day.branch).toBe('main');
    expect(day.commits.map((c) => [c.message, c.branch, c.added])).toEqual([
      ['add e.txt', 'wt', 1],
      ['add d.txt', 'main', 1],
      // unito in main
      ['add c.txt', 'main', 1],
      ['add b.txt', 'main', 2],
    ]);
    expect(day.days).toEqual(['2026-10-20', '2026-10-19']);
    expect(day.truncated).toBe(false);
    expect((await reader.read(dir, '2026-10-18')).commits).toEqual([]);
  });

  it('cache per repository, giorno e branch: un commit nuovo la invalida', async () => {
    const dir = initRepo();
    commit(dir, 'a.txt', 'uno\n', at(10));
    const { run, logs } = counting();
    const reader = createGitDayReader({ run, now: () => at(15) });
    await reader.read(dir, '2026-10-20');
    const first = logs();
    const again = await reader.read(dir, '2026-10-20');
    expect(logs()).toBe(first);
    expect(again.commits).toHaveLength(1);
    expect(reader.cacheSize).toBe(1);
    commit(dir, 'b.txt', 'due\n', at(11));
    expect((await reader.read(dir, '2026-10-20')).commits).toHaveLength(2);
    expect(logs()).toBeGreaterThan(first);
  });

  it('stati vuoti: senza cartella, non repo, repository senza commit, git assente', async () => {
    const reader = createGitDayReader({ now: () => at(15) });
    expect((await reader.read(null, '2026-10-20')).status).toBe('not-repo');
    expect((await reader.read(tempDir(), '2026-10-20')).status).toBe('not-repo');
    const empty = initRepo();
    expect(await reader.read(empty, '2026-10-20')).toMatchObject({ status: 'empty', branch: 'main', commits: [] });
    const missing = createGitDayReader({ run: async () => ({ ok: false, missing: true }) });
    expect((await missing.read(tempDir(), '2026-10-20')).status).toBe('no-git');
  });
});
