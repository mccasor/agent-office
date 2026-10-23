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
        tokensUsed: { input: 49, output: 235, cacheRead: 6350, cacheCreation: 850, cacheCreation1h: 0, total: 7484 },
        startedAt: ts('2026-01-01T10:00:00.000Z'),
        updatedAt: T0,
        active: true,
        status: 'done',
        issues: [],
        cwd: '/tmp/agent-office-fixture',
        branch: null,
        waiting: false,
        waitingKind: null,
        waitingSince: null,
        tool: null,
        // stima ai prezzi di listino, sommata file per file (sessione e subagenti)
        cost: expect.closeTo(0.0095745, 7),
        // Claude stesso, senza i subagenti
        ownTokens: { input: 30, output: 80, cacheRead: 2200, cacheCreation: 300, cacheCreation1h: 0, total: 2610 },
        ownCost: expect.closeTo(0.005125, 7),
        turnStartedAt: ts('2026-01-01T10:00:00.000Z'),
        lastTurnMs: 302_000,
        compactions: 1,
        lastCompaction: { at: ts('2026-01-01T10:05:01.500Z'), trigger: 'auto', preTokens: 180_000, postTokens: 12_000 },
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
        tokens: { input: 10, output: 60, cacheRead: 1100, cacheCreation: 160, cacheCreation1h: 0, total: 1330 },
        progress: null,
        issues: [],
        startedAt: ts('2026-01-01T10:00:03.500Z'),
        updatedAt: T0,
        tool: null,
        cost: expect.closeTo(0.00062, 7),
        effort: null,
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
        tokens: { input: 9, output: 95, cacheRead: 3050, cacheCreation: 390, cacheCreation1h: 0, total: 3544 },
        progress: { completed: 1, total: 3 },
        issues: [],
        startedAt: ts('2026-01-01T10:01:00.000Z'),
        updatedAt: T0,
        tool: null,
        cost: expect.closeTo(0.0038295, 7),
        effort: null,
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

  it('domanda del subagente senza risposta: attesa sull’agente, senza il testo della domanda', async () => {
    const w = await startWatcher();
    const file = join(subDir(), 'workflows', 'wf_fixture', 'agent-a0000000000000002.jsonl');
    const at = '2026-01-01T10:05:00.000Z';
    const ask = { type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: 'segreto?' }] } };
    await appendFile(file, JSON.stringify({ type: 'assistant', timestamp: at, message: { id: 'msg_q', model: 'claude-sonnet-4-5', content: [ask] } }) + '\n');
    await vi.waitFor(() => expect(w.current().agents[1]).toMatchObject({ waiting: true, waitingKind: 'question', waitingSince: ts(at) }), { timeout: 3000, interval: 20 });
    expect(JSON.stringify(w.current())).not.toContain('segreto');
    const answer = { type: 'user', timestamp: '2026-01-01T10:06:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'ok' }] } };
    await appendFile(file, JSON.stringify(answer) + '\n');
    await vi.waitFor(() => expect(w.current().agents[1]?.waiting).toBeUndefined(), { timeout: 3000, interval: 20 });
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

describe('createTranscriptWatcher – finestra 1M dichiarata (#20)', () => {
  it('attachment "model" con modelId [1m] -> window 1M anche sotto 200k', async () => {
    await appendFile(
      join(projectDir(), `${SESSION}.jsonl`),
      JSON.stringify({ type: 'attachment', attachment: { type: 'model', identity: { modelId: 'claude-opus-4-5[1m]' } } }) + '\n',
    );
    await touchAll(home, T0);
    const w = await startWatcher();
    expect(w.current().sessions[0]?.context).toEqual({ used: 1320, window: 1_000_000 });
  });
});

describe('createTranscriptWatcher – sessioni in altre cartelle di projects (#21)', () => {
  const FOREIGN = '22222222-2222-4222-8222-222222222222';
  const foreignDir = () => join(home, 'projects', '-tmp');
  const row = (cwd: string) =>
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T10:05:00.000Z', cwd, sessionId: FOREIGN, message: { role: 'user', content: '[redacted]' } }) + '\n';
  const transcript = (cwds: string[]) => ['{"type":"ai-title","aiTitle":"Foreign"}\n', ...cwds.map(row)].join('');

  async function writeForeign(name: string, body: string, mtime = T0) {
    await mkdir(foreignDir(), { recursive: true });
    const file = join(foreignDir(), name);
    await writeFile(file, body);
    await utimes(file, mtime / 1000, mtime / 1000);
    return file;
  }

  it('avviata in una cartella superiore e passata in una interna: inclusa con i subagenti', async () => {
    await writeForeign(`${FOREIGN}.jsonl`, transcript(['/tmp', '/tmp', `${CWD}/src`]));
    const sub = join(foreignDir(), FOREIGN, 'subagents');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'agent-b0000000000000001.jsonl'), row(`${CWD}/src`));
    await writeFile(join(sub, 'agent-b0000000000000001.meta.json'), '{"agentType":"Explore","description":"Foreign agent"}');
    await touchAll(home, T0);
    const w = await startWatcher();
    const snap = w.current();
    expect(snap.sessions.map((s) => s.title).sort()).toEqual(['Fixture session', 'Foreign']);
    expect(snap.agents.map((a) => a.name)).toContain('Foreign agent');
  });

  it('cartella codificata assente: trova la sessione tramite cwd uguale', async () => {
    await rm(projectDir(), { recursive: true });
    await writeForeign(`${FOREIGN}.jsonl`, transcript([CWD]));
    const w = await startWatcher();
    expect(w.current().sessions.map((s) => s.id)).toEqual([FOREIGN]);
  });

  it('cwd non interno (prefisso simile o cartella superiore) non è incluso', async () => {
    await writeForeign(`${FOREIGN}.jsonl`, transcript(['/tmp', `${CWD}-other`, `${CWD}x/y`]));
    const w = await startWatcher();
    expect(w.current().sessions.map((s) => s.id)).toEqual([SESSION]);
  });

  it('file vecchi non letti all’avvio; diventano pertinenti se riprendono con il cwd monitorato', async () => {
    const file = await writeForeign(`${FOREIGN}.jsonl`, transcript([CWD]), T0 - 7 * 24 * 3_600_000);
    const w = await startWatcher();
    expect(w.current().sessions.map((s) => s.id)).toEqual([SESSION]);
    await appendFile(file, row(`${CWD}/lib`));
    await vi.waitFor(() => expect(w.current().sessions.map((s) => s.id)).toContain(FOREIGN), { timeout: 5000, interval: 20 });
  });

  it('nuovo file in un’altra cartella dopo l’avvio: valutato e seguito (anche i subagenti nuovi)', async () => {
    const w = await startWatcher();
    const file = await writeForeign(`${FOREIGN}.jsonl`, transcript(['/tmp']), clock);
    await new Promise((r) => setTimeout(r, 300));
    expect(w.current().sessions.map((s) => s.id)).toEqual([SESSION]);
    await appendFile(file, row(CWD));
    await vi.waitFor(() => expect(w.current().sessions.map((s) => s.id)).toContain(FOREIGN), { timeout: 5000, interval: 20 });
    const sub = join(foreignDir(), FOREIGN, 'subagents');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'agent-b0000000000000002.jsonl'), row(CWD));
    await vi.waitFor(() => expect(w.current().agents.map((a) => a.id)).toContain('b0000000000000002'), { timeout: 5000, interval: 20 });
  });
});

describe('createTranscriptWatcher – modalità all (menu bar)', () => {
  it('trova le sessioni attive di qualunque cartella, ignora i transcript vecchi', async () => {
    const other = join(home, 'projects', '-altro-progetto');
    await mkdir(other, { recursive: true });
    const old = join(other, '22222222-2222-4222-8222-222222222222.jsonl');
    await writeFile(old, JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00.000Z', cwd: '/altro', message: { content: 'x' } }) + '\n');
    await utimes(old, Date.parse('2025-01-01') / 1000, Date.parse('2025-01-01') / 1000);
    const w = await startWatcher({ cwd: '/qualunque', all: true });
    const snap = w.current();
    expect(snap.sessions.map((s) => [s.id, s.cwd])).toEqual([[SESSION, CWD]]);
    expect(snap.agents.map((a) => a.id).sort()).toEqual(['a0000000000000001', 'a0000000000000002']);
  });

  it('con all restano solo le sessioni attive e i loro subagenti', async () => {
    const w = await startWatcher({ cwd: '/qualunque', all: true, activeWindowMs: 10 * 60_000 });
    clock = T0 + 11 * 60_000;
    expect(w.current()).toEqual({ sessions: [], agents: [] });
  });
});
