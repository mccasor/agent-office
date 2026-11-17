import { describe, expect, it } from 'vitest';
import { estimateCost } from '../../shared/pricing.js';
import { aggregate, pruneMetas, type AgentMeta, type AggregateFile, type AggregateOptions } from './aggregate.js';
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

describe('pruneMetas', () => {
  it('tiene solo i meta dei subagenti con un transcript seguito', () => {
    const meta = { agentType: 'Explore', description: 'x' };
    const metas = new Map<string, AgentMeta>([
      [`${S}/a1`, meta],
      [`${S}/a2`, meta],
      ['altra/a3', meta],
    ]);
    pruneMetas(metas, [session(), agent('a1'), agent('a3')]);
    expect([...metas.keys()]).toEqual([`${S}/a1`]);
  });
});

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

  it('#110: fine notificata alla sessione con un comando in background mai chiuso nel suo transcript: terminato', () => {
    const open = { hasAssistant: true, finished: 'confirmed' as const, backgroundTasks: 1, lastAt: T };
    const snap = aggregate(
      [session({ taskEnds: new Map([['a1', 'completed']]) }), agent('a1', open), agent('a2', open), agent('a3', { ...open, finished: false })],
      noMetas,
      T,
      OPTS,
    );
    const by = new Map(snap.agents.map((a) => [a.id, a]));
    expect(by.get('a1')).toMatchObject({ status: 'done', outcome: 'ok' });
    // senza la notifica aspetta ancora il suo comando, come prima
    expect(by.get('a2')?.status).toBe('working');
    // notificato ma col transcript che va avanti (ripreso dopo il rapporto): non è finito
    expect(by.get('a3')?.status).not.toBe('done');
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

  it('processo di Claude vivo: sessione attiva anche con il transcript fermo da più di activeWindowMs (#111)', () => {
    const files = [session({ lastAt: T - 30 * 60_000 }, T - 30 * 60_000, 'viva'), agent('a1', {}, T - 30 * 60_000, 'viva'), session({ lastAt: T - 30 * 60_000 }, T - 30 * 60_000, 'morta')];
    const alive = (id: string) => id === 'viva';
    const snap = aggregate(files, noMetas, T, { ...OPTS, alive });
    expect(snap.sessions.map((s) => [s.id, s.active]).sort()).toEqual([
      ['morta', false],
      ['viva', true],
    ]);
    const only = aggregate(files, noMetas, T, { ...OPTS, onlyActive: true, alive });
    expect(only.sessions.map((s) => s.id)).toEqual(['viva']);
    expect(only.agents.map((a) => a.id)).toEqual(['a1']);
    // senza dati sul processo: solo la finestra di attività
    expect(aggregate(files, noMetas, T, { ...OPTS, onlyActive: true }).sessions).toEqual([]);
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

  it('costo per modello (#112): dopo un /model i token precedenti restano al prezzo del loro modello', () => {
    const msg = (id: string, model: string, input: number, output: number) =>
      JSON.stringify({ type: 'assistant', message: { id, model, content: [{ type: 'text', text: 'x' }], usage: { input_tokens: input, output_tokens: output } } });
    const acc = createAccumulator();
    acc.ingest(msg('m1', 'claude-opus-4-5', 1000, 2000));
    acc.ingest(msg('m2', 'claude-haiku-4-5', 3000, 4000));
    const expected = estimateCost('claude-opus-4-5', tokens(1000, 2000))! + estimateCost('claude-haiku-4-5', tokens(3000, 4000))!;
    const sub = createAccumulator();
    sub.ingest(msg('a', 'claude-opus-4-5', 10, 20));
    sub.ingest(msg('b', 'claude-haiku-4-5', 30, 40));
    const subExpected = estimateCost('claude-opus-4-5', tokens(10, 20))! + estimateCost('claude-haiku-4-5', tokens(30, 40))!;
    const snap = aggregate(
      [
        { parsed: { kind: 'session', sessionId: S }, state: acc.state, mtime: T },
        { parsed: { kind: 'agent', sessionId: S, agentId: 'a1' }, state: sub.state, mtime: T },
      ],
      noMetas,
      T,
      OPTS,
    );
    expect(snap.sessions[0]?.ownCost).toBeCloseTo(expected, 10);
    expect(snap.agents[0]?.cost).toBeCloseTo(subExpected, 10);
    expect(snap.sessions[0]?.cost).toBeCloseTo(expected + subExpected, 10);
    expect(snap.sessions[0]?.ownTokens).toMatchObject(tokens(4000, 6000));
  });

  it('finestra 1M dal modello dichiarato [1m] anche con 50k usati (#113)', () => {
    const acc = createAccumulator();
    acc.ingest(JSON.stringify({ type: 'attachment', attachment: { type: 'model', identity: { modelId: 'claude-opus-4-6[1m]' } } }));
    acc.ingest(JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-4-6', content: [], usage: { input_tokens: 50_000, output_tokens: 1 } } }));
    const snap = aggregate([{ parsed: { kind: 'session', sessionId: S }, state: acc.state, mtime: T }], noMetas, T, OPTS);
    expect(snap.sessions[0]?.context).toEqual({ used: 50_000, window: 1_000_000 });
  });
});

describe('Claude stesso e subagenti separati', () => {
  it('ownTokens e ownCost della sola sessione, tokensUsed e cost con i subagenti; turni, compattazioni, effort', () => {
    const lastCompaction = { at: T - 9000, trigger: 'auto', preTokens: 190_000, postTokens: 9_000 };
    const snap = aggregate(
      [
        session({ model: 'claude-opus-4-5', tokens: tokens(10, 20), lastPromptAt: T - 3000, lastTurnMs: 42_000, compactions: 2, lastCompaction }),
        agent('a1', { model: 'claude-haiku-4-5', effort: 'low', tokens: tokens(1, 2, 3, 4), hasAssistant: true, lastAt: T - 1000 }),
      ],
      noMetas,
      T,
      OPTS,
    );
    const s = snap.sessions[0]!;
    expect(s.ownTokens).toMatchObject(tokens(10, 20));
    expect(s.tokensUsed).toMatchObject(tokens(11, 22, 3, 4));
    const alone = aggregate([session({ model: 'claude-opus-4-5', tokens: tokens(10, 20) })], noMetas, T, OPTS).sessions[0]!;
    expect(s.ownCost).toBeCloseTo(alone.cost!, 10);
    expect(s.cost).toBeCloseTo(s.ownCost! + snap.agents[0]!.cost!, 10);
    expect(s).toMatchObject({ turnStartedAt: T - 3000, lastTurnMs: 42_000, compactions: 2, lastCompaction });
    expect(snap.agents[0]?.effort).toBe('low');
  });

  it('esito dei terminati (#97): dal transcript e dalle notifiche alla sessione; fermato o fallito vale come finito', () => {
    const working = { hasAssistant: true, lastAt: T - 1000 };
    const snap = aggregate(
      [
        session({ taskEnds: new Map([['a2', 'killed'], ['a3', 'failed'], ['a4', 'completed']]) }),
        agent('a1', { ...working, finished: 'confirmed', stop: 'interrupted' }),
        agent('a2', working),
        agent('a3', working),
        agent('a4', { ...working, finished: 'confirmed', toolErrors: { count: 2, tool: 'Bash', at: T - 2000 } }),
        agent('a5', { ...working, repeat: { tool: 'Read', count: 6 } }),
      ],
      noMetas,
      T,
      OPTS,
    );
    const by = new Map(snap.agents.map((a) => [a.id, a]));
    expect(by.get('a1')).toMatchObject({ status: 'done', outcome: 'interrupted' });
    expect(by.get('a2')).toMatchObject({ status: 'done', outcome: 'interrupted' });
    expect(by.get('a3')).toMatchObject({ status: 'done', outcome: 'failed' });
    expect(by.get('a4')).toMatchObject({ status: 'done', outcome: 'ok', toolErrors: { count: 2, tool: 'Bash', at: T - 2000 } });
    expect(by.get('a5')).toMatchObject({ status: 'working', repeat: { tool: 'Read', count: 6 } });
    expect(by.get('a5')).not.toHaveProperty('outcome');
  });
});

describe('aggregate: sessioni lanciate dall’app (#119)', () => {
  const L = '33333333-3333-4333-8333-333333333333';
  const launched = { sessionId: L, pid: 4242, cwd: '/w/progetto', launchedAt: T - 2000 };

  it('senza transcript: presente subito, attiva e in attesa del primo prompt (idle)', () => {
    const snap = aggregate([], noMetas, T, { ...OPTS, launched: [launched] });
    expect(snap.sessions).toEqual([
      expect.objectContaining({
        id: L,
        title: null,
        model: null,
        cwd: '/w/progetto',
        startedAt: T - 2000,
        updatedAt: T - 2000,
        active: true,
        status: 'idle',
        waiting: false,
        tool: null,
        issues: [],
      }),
    ]);
    expect(snap.sessions[0]?.tokensUsed.total).toBe(0);
  });

  it('resta anche in modalità all (solo attive), pure se lanciata da più della finestra di attività', () => {
    const old = { ...launched, launchedAt: T - 60 * 60_000 };
    const snap = aggregate([], noMetas, T, { ...OPTS, onlyActive: true, launched: [old] });
    expect(snap.sessions.map((s) => [s.id, s.active, s.status])).toEqual([[L, true, 'idle']]);
  });

  it('con il transcript: una sola sessione, quella del transcript', () => {
    const snap = aggregate([session({ title: 'Primo prompt', cwd: '/w/progetto' }, T - 500, L)], noMetas, T, { ...OPTS, launched: [launched] });
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({ id: L, title: 'Primo prompt' });
  });

  it('voce rimossa e nessun transcript: sparita', () => {
    expect(aggregate([], noMetas, T, { ...OPTS, launched: [] }).sessions).toEqual([]);
  });
});
