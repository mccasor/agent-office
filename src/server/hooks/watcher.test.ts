import { appendFile, mkdtemp, readFile, rm, truncate, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEvent, Watcher } from '../../shared/types.js';
import { createHookEventsWatcher, eventsFilePath } from './index.js';

const ev = (i: number): HookEvent => ({
  event: 'PreToolUse',
  sessionId: 's1',
  agentId: null,
  agentType: null,
  toolName: 'Bash',
  cwd: '/proj',
  timestamp: i,
});
const line = (i: number) => JSON.stringify(ev(i)) + '\n';

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('createHookEventsWatcher', () => {
  let dataDir: string;
  let file: string;
  let w: Watcher<HookEvent[]> | null = null;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agent-office-watch-'));
    file = eventsFilePath('/proj', { dataDir });
  });

  afterEach(async () => {
    await w?.stop();
    w = null;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('crea cartella e file se assenti; current() vuoto', async () => {
    w = createHookEventsWatcher({ cwd: '/proj', dataDir });
    expect(w.current()).toEqual([]);
    await w.start();
    expect(await readFile(file, 'utf8')).toBe('');
    expect(w.current()).toEqual([]);
  });

  it('carica gli eventi esistenti, ignora righe non valide', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, line(1) + 'garbage\n{"event":1}\n' + line(2));
    w = createHookEventsWatcher({ cwd: '/proj', dataDir });
    await w.start();
    expect(w.current()).toEqual([ev(1), ev(2)]);
  });

  it('append -> onChange con i nuovi eventi (anche righe spezzate)', async () => {
    w = createHookEventsWatcher({ cwd: '/proj', dataDir });
    const seen: HookEvent[][] = [];
    const off = w.onChange((v) => seen.push(v));
    await w.start();

    await appendFile(file, line(1));
    await waitFor(() => w!.current().length === 1);

    const l2 = line(2);
    await appendFile(file, l2.slice(0, 10));
    await new Promise((r) => setTimeout(r, 150));
    expect(w.current()).toEqual([ev(1)]);
    await appendFile(file, l2.slice(10) + line(3));
    await waitFor(() => w!.current().length === 3);

    expect(w.current()).toEqual([ev(1), ev(2), ev(3)]);
    expect(seen.at(-1)).toEqual([ev(1), ev(2), ev(3)]);
    off();
  });

  it('mantiene al massimo 2000 eventi (i più recenti)', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Array.from({ length: 2100 }, (_, i) => line(i)).join(''));
    w = createHookEventsWatcher({ cwd: '/proj', dataDir });
    await w.start();
    const cur = w.current();
    expect(cur).toHaveLength(2000);
    expect(cur[0]?.timestamp).toBe(100);
    expect(cur.at(-1)?.timestamp).toBe(2099);
  });

  it('file troncato -> riparte da capo', async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, line(1) + line(2));
    w = createHookEventsWatcher({ cwd: '/proj', dataDir });
    await w.start();
    await truncate(file, 0);
    await appendFile(file, line(9));
    await waitFor(() => w!.current().length === 1 && w!.current()[0]?.timestamp === 9);
  });

  it('stop() ferma le notifiche', async () => {
    w = createHookEventsWatcher({ cwd: '/proj', dataDir });
    let calls = 0;
    w.onChange(() => calls++);
    await w.start();
    await w.stop();
    await appendFile(file, line(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(0);
  });
});
