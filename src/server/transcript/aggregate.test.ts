import { describe, expect, it } from 'vitest';
import { aggregate, type AgentMeta, type AggregateFile, type AggregateOptions } from './aggregate.js';
import { createAccumulator, type FileSummary } from './parser.js';

const S = 'sess-1';
const T = 1_000_000_000;
const OPTS: AggregateOptions = { activeWindowMs: 10 * 60_000, idleAfterMs: 60_000, doneGraceMs: 3_000 };

const summary = (over: Partial<FileSummary> = {}): FileSummary => ({ ...createAccumulator().state, ...over });
const tokens = (input: number, output: number, cacheRead = 0, cacheCreation = 0) => ({
  input,
  output,
  cacheRead,
  cacheCreation,
  total: input + output + cacheRead + cacheCreation,
});
const session = (over: Partial<FileSummary> = {}, mtime = T, sessionId = S): AggregateFile => ({
  parsed: { kind: 'session', sessionId },
  state: summary(over),
  mtime,
});
const agent = (agentId: string, over: Partial<FileSummary> = {}, mtime = T, sessionId = S): AggregateFile => ({
  parsed: { kind: 'agent', sessionId, agentId },
  state: summary(over),
  mtime,
});
const noMetas = new Map<string, AgentMeta>();

describe('aggregate', () => {
  it('nessun file: snapshot vuoto', () => {
    expect(aggregate([], noMetas, T, OPTS)).toEqual({ sessions: [], agents: [] });
  });

  it('sessione: token e costo sommati ai subagenti, updatedAt il più recente dei file', () => {
    const snap = aggregate(
      [
        session({ title: 'Lavoro', model: 'claude-opus-4-5', tokens: tokens(10, 20), firstAt: T - 5000, lastAt: T - 4000, cwd: '/w', gitBranch: 'main' }, T - 4000),
        agent('a1', { model: 'claude-haiku-4-5', tokens: tokens(1, 2, 3, 4), hasAssistant: true, lastAt: T - 1000 }, T - 2000),
        agent('a2', { model: 'modello-sconosciuto', tokens: tokens(5, 5), lastAt: T - 3000 }, T - 3000),
      ],
      noMetas,
      T,
      OPTS,
    );
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({
      id: S,
      title: 'Lavoro',
      tokensUsed: tokens(16, 27, 3, 4),
      startedAt: T - 5000,
      updatedAt: T - 1000,
      active: true,
      cwd: '/w',
      branch: 'main',
    });
    // il modello sconosciuto non ha prezzo: il costo somma solo gli altri due file
    const opus = aggregate([session({ model: 'claude-opus-4-5', tokens: tokens(10, 20) })], noMetas, T, OPTS).sessions[0]?.cost;
    const haiku = snap.agents.find((a) => a.id === 'a1')?.cost;
    expect(snap.sessions[0]?.cost).toBeCloseTo((opus ?? 0) + (haiku ?? 0), 10);
    expect(snap.agents.find((a) => a.id === 'a2')?.cost).toBeNull();
  });

  it('subagenti senza transcript della sessione: agenti sì, sessione no', () => {
    const snap = aggregate([agent('a1')], noMetas, T, OPTS);
    expect(snap.sessions).toEqual([]);
    expect(snap.agents.map((a) => a.id)).toEqual(['a1']);
  });

  it('meta.json: nome, tipo, area e issue dalla descrizione; senza meta tipo unknown', () => {
    const metas = new Map<string, AgentMeta>([[`${S}/a1`, { agentType: 'gsd-doc-writer', description: 'Write usage guide #12' }]]);
    const snap = aggregate([agent('a1', { issues: [7] }, T - 1), agent('a2')], metas, T, OPTS);
    expect(snap.agents[0]).toMatchObject({ name: 'Write usage guide #12', agentType: 'gsd-doc-writer', area: 'docs', issues: [12, 7] });
    expect(snap.agents[1]).toMatchObject({ name: 'unknown', agentType: 'unknown', description: '' });
  });

  it.each<[string, Partial<FileSummary>, number, string]>([
    ['senza risposte dell’assistente', {}, 0, 'entering'],
    ['al lavoro', { hasAssistant: true }, 0, 'working'],
    ['fermo oltre idleAfterMs', { hasAssistant: true }, 61_000, 'idle'],
    ['fine confermata', { hasAssistant: true, finished: 'confirmed' }, 0, 'done'],
    ['fine provvisoria entro doneGraceMs', { hasAssistant: true, finished: 'tentative' }, 1_000, 'working'],
    ['fine provvisoria dopo doneGraceMs', { hasAssistant: true, finished: 'tentative' }, 3_000, 'done'],
    ['fine con task in background aperti', { hasAssistant: true, finished: 'confirmed', backgroundTasks: 1 }, 0, 'working'],
  ])('stato: %s', (_, over, elapsed, status) => {
    const snap = aggregate([session({ ...over, lastAt: T }), agent('a1', { ...over, lastAt: T })], noMetas, T + elapsed, OPTS);
    expect(snap.sessions[0]?.status).toBe(status);
    expect(snap.agents[0]?.status).toBe(status);
  });

  it('tool in uso: nascosto quando l’agente ha finito', () => {
    const tool = { name: 'Bash', target: null, since: T };
    const snap = aggregate(
      [session({ tool, hasAssistant: true }), agent('a1', { tool, hasAssistant: true }), agent('a2', { tool, hasAssistant: true, finished: 'confirmed' }, T + 1)],
      noMetas,
      T,
      OPTS,
    );
    expect(snap.sessions[0]?.tool).toEqual(tool);
    expect(snap.agents.map((a) => a.tool)).toEqual([tool, null]);
  });

  it('attesa dell’utente: sulla sessione e sul subagente, finché non hanno finito', () => {
    const waiting = { hasAssistant: true, awaitingUser: true, awaitingKind: 'plan' as const, awaitingSince: T - 500 };
    const snap = aggregate([session(waiting), agent('a1', waiting), agent('a2', { ...waiting, finished: 'confirmed' }, T + 1)], noMetas, T, OPTS);
    expect(snap.sessions[0]).toMatchObject({ waiting: true, waitingKind: 'plan', waitingSince: T - 500 });
    expect(snap.agents[0]).toMatchObject({ waiting: true, waitingKind: 'plan', waitingSince: T - 500 });
    expect(snap.agents[1]).not.toHaveProperty('waiting');
    const idle = aggregate([session(), agent('a1')], noMetas, T, OPTS);
    expect(idle.sessions[0]).toMatchObject({ waiting: false, waitingKind: null, waitingSince: null });
    expect(idle.agents[0]).not.toHaveProperty('waiting');
  });

  it('sessione attiva entro activeWindowMs; onlyActive tiene solo le attive e i loro subagenti', () => {
    const files = [session({ lastAt: T }, T, 'nuova'), agent('a1', {}, T, 'nuova'), session({ lastAt: T - 11 * 60_000 }, 0, 'vecchia'), agent('a2', {}, 0, 'vecchia')];
    const snap = aggregate(files, noMetas, T, OPTS);
    expect(snap.sessions.map((s) => [s.id, s.active])).toEqual([
      ['nuova', true],
      ['vecchia', false],
    ]);
    expect(snap.agents).toHaveLength(2);
    const only = aggregate(files, noMetas, T, { ...OPTS, onlyActive: true });
    expect(only.sessions.map((s) => s.id)).toEqual(['nuova']);
    expect(only.agents.map((a) => a.id)).toEqual(['a1']);
  });

  it('ordine: sessioni dalla più recente, agenti dal primo avviato', () => {
    const snap = aggregate(
      [session({}, T - 10, 'b'), session({}, T, 'c'), session({}, T - 10, 'a'), agent('z', { firstAt: T - 5 }), agent('y', { firstAt: T - 9 }), agent('x', { firstAt: T - 5 })],
      noMetas,
      T,
      OPTS,
    );
    expect(snap.sessions.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(snap.agents.map((a) => a.id)).toEqual(['y', 'x', 'z']);
  });

  it('finestra di contesto dal modello dichiarato', () => {
    const snap = aggregate([session({ model: 'claude-opus-4-5', declaredModel: 'claude-opus-4-5[1m]', contextUsed: 1320 })], noMetas, T, OPTS);
    expect(snap.sessions[0]?.context).toEqual({ used: 1320, window: 1_000_000 });
  });

  it('non espone il testo dei prompt', () => {
    const acc = createAccumulator();
    acc.ingest(JSON.stringify({ type: 'user', timestamp: '2026-01-01T10:00:00.000Z', message: { role: 'user', content: 'prompt segreto per #5' } }));
    const snap = aggregate([{ parsed: { kind: 'session', sessionId: S }, state: acc.state, mtime: T }], noMetas, T, OPTS);
    expect(JSON.stringify(snap)).not.toContain('segreto');
    expect(snap.sessions[0]?.issues).toEqual([5]);
  });
});
