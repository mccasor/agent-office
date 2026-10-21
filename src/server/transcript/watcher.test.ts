import { appendFile, cp, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptSnapshot } from '../../shared/types.js';
import { createTranscriptWatcher } from './index.js';

const FIXTURES = fileURLToPath(new URL('../../../test/fixtures/transcript', import.meta.url));
const CWD = '/tmp/agent-office-fixture';
const SESSION = '11111111-1111-4111-8111-111111111111';
const T0 = Date.parse('2026-01-01T10:10:00.000Z');
const ts = (iso: string) => Date.parse(iso);

let home: string;
let clock: number;
let watcher: ReturnType<typeof createTranscriptWatcher> | null;

const projectDir = () => join(home, 'projects', '-tmp-agent-office-fixture');
const subDir = () => join(projectDir(), SESSION, 'subagents');

async function touchAll(dir: string, time: number): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await touchAll(p, time);
    else await utimes(p, time / 1000, time / 1000);
  }
}

async function startWatcher(extra: Partial<Parameters<typeof createTranscriptWatcher>[0]> = {}) {
  watcher = createTranscriptWatcher({ cwd: CWD, claudeHome: home, now: () => clock, tickMs: 50, ...extra });
  await watcher.start();
  return watcher;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ao-watcher-'));
  await cp(FIXTURES, home, { recursive: true });
  await touchAll(home, T0);
  clock = T0 + 1000;
  watcher = null;
});

afterEach(async () => {
  await watcher?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('createTranscriptWatcher – lettura iniziale delle fixture', () => {
  it('compone sessione e subagenti', async () => {
    const w = await startWatcher();
    const snap = w.current();

    expect(snap.sessions).toEqual([
      {
        id: SESSION,
        title: 'Fixture session',
        model: 'claude-opus-4-5',
        effort: 'high',
        context: { used: 20 + 1200 + 100, window: 200_000 },
        tokensUsed: { input: 49, output: 235, cacheRead: 6350, cacheCreation: 850, total: 7484 },
        tokensLeft: 140_000,
        startedAt: ts('2026-01-01T10:00:00.000Z'),
        updatedAt: T0,
        active: true,
      },
    ]);

    expect(snap.agents).toEqual([
      {
        id: 'a0000000000000001',
        sessionId: SESSION,
        name: 'Survey transcript format',
        agentType: 'Explore',
        description: 'Survey transcript format',
        area: 'research',
        status: 'done',
        model: 'claude-haiku-4-5',
        tokens: { input: 10, output: 60, cacheRead: 1100, cacheCreation: 160, total: 1330 },
        progress: null,
        startedAt: ts('2026-01-01T10:00:03.500Z'),
        updatedAt: T0,
      },
      {
        id: 'a0000000000000002',
        sessionId: SESSION,
        name: 'Build HUD panel',
        agentType: 'workflow-subagent',
        description: 'Build HUD panel',
        area: 'frontend',
        status: 'working',
        model: 'claude-sonnet-4-5',
        tokens: { input: 9, output: 95, cacheRead: 3050, cacheCreation: 390, total: 3544 },
        progress: { completed: 1, total: 3 },
        startedAt: ts('2026-01-01T10:01:00.000Z'),
        updatedAt: T0,
      },
    ]);
  });

  it('non espone contenuti dei messaggi', async () => {
    const w = await startWatcher();
    expect(JSON.stringify(w.current())).not.toMatch(/redacted|Panel\.tsx|example\.ts/);
  });

  it('stati in base al tempo: idle dopo idleAfterMs, sessione inattiva dopo activeWindowMs', async () => {
    const w = await startWatcher({ idleAfterMs: 60_000, activeWindowMs: 10 * 60_000 });
    clock = T0 + 5 * 60_000;
    let snap = w.current();
    expect(snap.agents.map((a) => a.status)).toEqual(['done', 'idle']);
    expect(snap.sessions[0]?.active).toBe(true);
    clock = T0 + 11 * 60_000;
    snap = w.current();
    expect(snap.sessions[0]?.active).toBe(false);
  });

  it('il tick periodico notifica i cambi di stato dovuti al tempo', async () => {
    const w = await startWatcher({ idleAfterMs: 60_000 });
    const seen: TranscriptSnapshot[] = [];
    w.onChange((s) => seen.push(s));
    clock = T0 + 2 * 60_000;
    await vi.waitFor(() => expect(seen.at(-1)?.agents[1]?.status).toBe('idle'), { timeout: 3000, interval: 20 });
  });

  it('progetto inesistente: snapshot vuoto senza errori', async () => {
    const w = await startWatcher({ cwd: '/does/not/exist' });
    expect(w.current()).toEqual({ sessions: [], agents: [] });
  });
});

describe('createTranscriptWatcher – aggiornamenti incrementali', () => {
  it('legge le righe aggiunte (anche spezzate) e notifica', async () => {
    const w = await startWatcher();
    const listener = vi.fn();
    const off = w.onChange(listener);
    const file = join(subDir(), 'workflows', 'wf_fixture', 'agent-a0000000000000002.jsonl');
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T10:04:00.000Z',
      message: {
        id: 'msg_new',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'tool_use', id: 'x', name: 'TodoWrite', input: { todos: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }] } }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 },
      },
    });
    const sizeBefore = (await stat(file)).size;
    await appendFile(file, line.slice(0, 40));
    await new Promise((r) => setTimeout(r, 200));
    expect(w.current().agents[1]?.progress).toEqual({ completed: 1, total: 3 });
    await appendFile(file, line.slice(40) + '\n');
    await vi.waitFor(() => expect(w.current().agents[1]?.progress).toEqual({ completed: 3, total: 3 }), { timeout: 3000, interval: 20 });
    expect(w.current().agents[1]?.tokens.total).toBe(3544 + 4);
    expect(w.current().sessions[0]?.tokensUsed.total).toBe(7484 + 4);
    expect((await stat(file)).size).toBeGreaterThan(sizeBefore);
    expect(listener).toHaveBeenCalled();
    off();
  });

  it('nuovo subagente: compare, e il meta.json arrivato dopo aggiorna nome e area', async () => {
    const w = await startWatcher();
    const file = join(subDir(), 'agent-a0000000000000003.jsonl');
    await writeFile(file, '{"type":"user","timestamp":"2026-01-01T10:09:00.000Z","message":{"role":"user","content":"[redacted]"}}\n');
    await vi.waitFor(() => expect(w.current().agents).toHaveLength(3), { timeout: 3000, interval: 20 });
    expect(w.current().agents[2]).toMatchObject({ id: 'a0000000000000003', status: 'entering', agentType: 'unknown', name: 'unknown', progress: null });
    await writeFile(join(subDir(), 'agent-a0000000000000003.meta.json'), '{"agentType":"gsd-doc-writer","description":"Write usage guide"}');
    await vi.waitFor(() => expect(w.current().agents[2]).toMatchObject({ name: 'Write usage guide', agentType: 'gsd-doc-writer', area: 'docs' }), { timeout: 3000, interval: 20 });
  });

  it('nuova sessione in un progetto creato dopo l’avvio', async () => {
    await rm(projectDir(), { recursive: true });
    const w = await startWatcher();
    expect(w.current().sessions).toEqual([]);
    await mkdir(projectDir(), { recursive: true });
    await writeFile(join(projectDir(), 'sess-2.jsonl'), '{"type":"ai-title","aiTitle":"Later"}\n');
    await vi.waitFor(() => expect(w.current().sessions.map((s) => s.title)).toEqual(['Later']), { timeout: 5000, interval: 20 });
  });

  it('ignora file non pertinenti (journal.jsonl dei workflow, altri json)', async () => {
    await writeFile(join(subDir(), 'workflows', 'wf_fixture', 'journal.jsonl'), '{"type":"launched"}\n');
    await writeFile(join(projectDir(), 'notes.txt'), 'x');
    const w = await startWatcher();
    expect(w.current().agents).toHaveLength(2);
    expect(w.current().sessions).toHaveLength(1);
  });

  it('stop() ferma le notifiche', async () => {
    const w = await startWatcher();
    const listener = vi.fn();
    w.onChange(listener);
    await w.stop();
    watcher = null;
    await appendFile(join(projectDir(), `${SESSION}.jsonl`), '{"type":"ai-title","aiTitle":"After stop"}\n');
    clock = T0 + 60 * 60_000;
    await new Promise((r) => setTimeout(r, 300));
    expect(listener).not.toHaveBeenCalled();
  });
});
