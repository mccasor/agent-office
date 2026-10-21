import { describe, expect, it } from 'vitest';
import type { RepoState } from '../../shared/types.js';
import { createRepoPoller } from './poller.js';

const repo = (linesAdded: number): RepoState => ({ project: 'p', branch: 'main', linesAdded, linesRemoved: 0, filesChanged: 1 });

describe('createRepoPoller', () => {
  it('legge subito le cartelle nuove, poi solo dopo un\'attività o quando la lettura è vecchia', async () => {
    const calls: string[] = [];
    let added = 1;
    const poller = createRepoPoller({ read: async (cwd) => (calls.push(cwd), repo(added)), minIntervalMs: 1_000, staleMs: 60_000 });
    poller.follow(['/a', '/b']);
    expect(await poller.poll(0)).toBe(true);
    expect(calls).toEqual(['/a', '/b']);
    expect(poller.get('/a')?.linesAdded).toBe(1);

    expect(await poller.poll(5_000)).toBe(false);
    expect(calls).toHaveLength(2);

    added = 7;
    poller.touch('/a');
    expect(await poller.poll(5_500)).toBe(true);
    expect(calls).toEqual(['/a', '/b', '/a']);
    expect(poller.get('/a')?.linesAdded).toBe(7);

    await poller.poll(60_000);
    expect(calls.slice(3)).toEqual(['/b']);
  });

  it('attività ravvicinate: al massimo una lettura ogni minIntervalMs', async () => {
    let n = 0;
    const poller = createRepoPoller({ read: async () => (n++, null), minIntervalMs: 3_000 });
    poller.follow(['/a']);
    await poller.poll(0);
    poller.touch('/a');
    await poller.poll(1_000);
    expect(n).toBe(1);
    await poller.poll(3_000);
    expect(n).toBe(2);
  });

  it('dimentica le cartelle non più seguite', async () => {
    const poller = createRepoPoller({ read: async () => repo(1) });
    poller.follow(['/a']);
    await poller.poll(0);
    poller.follow(['/b']);
    expect(poller.get('/a')).toBeNull();
  });
});
