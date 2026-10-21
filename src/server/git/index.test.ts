import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRepoState } from './index.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-git-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(): string {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commitFile(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', `add ${file}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readRepoState', () => {
  it('ritorna null fuori da un repo git', async () => {
    expect(await readRepoState(tempDir())).toBeNull();
  });

  it('ritorna null se la cartella non esiste', async () => {
    expect(await readRepoState(join(tempDir(), 'missing'))).toBeNull();
  });

  it('ritorna null se git non è disponibile', async () => {
    const dir = initRepo();
    vi.stubEnv('PATH', '');
    expect(await readRepoState(dir)).toBeNull();
  });

  it('repo pulito: progetto, branch e zero modifiche', async () => {
    const dir = initRepo();
    commitFile(dir, 'a.txt', 'uno\ndue\n');
    expect(await readRepoState(dir)).toEqual({
      project: basename(dir),
      branch: 'main',
      linesAdded: 0,
      linesRemoved: 0,
      filesChanged: 0,
    });
  });

  it('project è il basename del toplevel anche da una sottocartella', async () => {
    const dir = initRepo();
    commitFile(dir, 'a.txt', 'x\n');
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const state = await readRepoState(sub);
    expect(state?.project).toBe(basename(dir));
  });

  it('conta righe e file modificati, staged inclusi', async () => {
    const dir = initRepo();
    commitFile(dir, 'a.txt', 'uno\ndue\ntre\n');
    commitFile(dir, 'b.txt', 'b\n');
    writeFileSync(join(dir, 'a.txt'), 'uno\nDUE\ntre\nquattro\n'); // +2 -1 non staged
    writeFileSync(join(dir, 'b.txt'), ''); // -1, staged
    git(dir, 'add', 'b.txt');
    expect(await readRepoState(dir)).toMatchObject({
      branch: 'main',
      linesAdded: 2,
      linesRemoved: 2,
      filesChanged: 2,
    });
  });

  it('HEAD detached: branch è lo short sha', async () => {
    const dir = initRepo();
    commitFile(dir, 'a.txt', 'x\n');
    const sha = git(dir, 'rev-parse', '--short', 'HEAD');
    git(dir, 'checkout', '-q', '--detach');
    expect((await readRepoState(dir))?.branch).toBe(sha);
  });

  it('repo senza commit: branch dal ref simbolico, conta i file staged', async () => {
    const dir = initRepo();
    writeFileSync(join(dir, 'a.txt'), 'uno\ndue\n');
    git(dir, 'add', 'a.txt');
    expect(await readRepoState(dir)).toEqual({
      project: basename(dir),
      branch: 'main',
      linesAdded: 2,
      linesRemoved: 0,
      filesChanged: 1,
    });
  });

  it('repo senza commit e senza file: zero', async () => {
    const dir = initRepo();
    expect(await readRepoState(dir)).toMatchObject({ branch: 'main', linesAdded: 0, linesRemoved: 0, filesChanged: 0 });
  });
});
