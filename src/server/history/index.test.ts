import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, SessionState, Snapshot } from '../../shared/types.js';
import { createHistory, dayOf, type History } from './index.js';

const tokens = { input: 0, output: 1200, cacheRead: 0, cacheCreation: 0, total: 1200 };
/** 23 ottobre 2026, 10:00 ora locale */
const T0 = new Date(2026, 9, 23, 10, 0, 0).getTime();
const MIN = 60_000;

const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Testo segreto del titolo', model: null, effort: null, context: { used: 0, window: null }, tokensUsed: tokens,
  startedAt: T0 - 30 * MIN, updatedAt: T0, active: true, status: 'working', issues: [], cwd: '/Users/x/agent-office', branch: null,
  waiting: false, dot: 'working', project: 'agent-office', ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Descrizione privata del compito', agentType: 'Explore', description: 'Descrizione privata del compito',
  area: 'backend', status: 'working', model: null, tokens, progress: null, issues: [], startedAt: T0 - 5 * MIN, updatedAt: T0, cost: 0.5, ...over,
});
const snap = (sessions: SessionState[], agents: AgentState[] = [], finished: AgentState[] = []): Snapshot => ({
  status: 'idle', sessions, agents, finished, generatedAt: 0,
});

describe('storico della giornata', () => {
  let dir: string;
  let t: number;
  let history: History;
  const open = async () => {
    const h = createHistory({ dir, now: () => t, filesOf: (_s, a) => (a ? ['parser.ts', 'types.ts'] : ['parser.ts']) });
    await h.start();
    return h;
  };

  beforeEach(async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'agent-office-history-')), 'history');
    t = T0;
    history = await open();
  });
  afterEach(async () => {
    await history.flush();
    await rm(join(dir, '..'), { recursive: true, force: true });
  });

  it('cronologia: apertura, agente avviato e terminato, attesa e sblocco, compattazione, chiusura', async () => {
    history.observe(snap([session()], [agent()]));
    t += MIN;
    history.observe(snap([session({ waiting: true, waitingKind: 'permission', waitingSince: t, tool: { name: 'Bash', target: null, since: t } })], [agent()]));
    t += 3 * MIN;
    history.observe(snap([session({ updatedAt: t, lastCompaction: { at: t - 1000, trigger: 'auto', preTokens: 1, postTokens: 1 } })], [agent({ status: 'done', updatedAt: t })]));
    t += MIN;
    history.observe(snap([session({ active: false })]));
    const r = (await history.report())!;
    expect(r.day).toBe('2026-10-23');
    // dal più recente
    expect(r.events.map((e) => e.kind)).toEqual(['unblock', 'agent-end', 'session-close', 'compact', 'wait', 'agent-start', 'session-open']);
    const wait = r.events.find((e) => e.kind === 'wait')!;
    expect(wait).toMatchObject({ project: 'agent-office', tool: 'Bash', waitingKind: 'permission' });
    expect(r.events.find((e) => e.kind === 'agent-end')).toMatchObject({ agentType: 'Explore', durationMs: 9 * MIN });
    expect(r.waits).toMatchObject({ count: 1, totalMs: 3 * MIN });
    expect(r.byType).toEqual([{ agentType: 'Explore', count: 1, avgMs: 9 * MIN, cost: 0.5, avgCost: 0.5 }]);
    expect(r.files).toEqual([{ name: 'parser.ts', count: 2 }, { name: 'types.ts', count: 1 }]);
  });

  it('su disco solo orari, contatori, nomi di tool, nickname e basename: mai titoli o descrizioni', async () => {
    history.observe(snap([session()], [agent({ status: 'done' })]));
    await history.flush();
    const text = await readFile(join(dir, '2026-10-23.jsonl'), 'utf8');
    expect(text).not.toMatch(/segreto|privata|\/Users/);
    expect(text).toContain('agent-office');
  });

  it('riavvio: la giornata riparte dal file e gli stessi agenti e attese non si contano due volte', async () => {
    const waiting = session({ waiting: true, waitingKind: 'question', waitingSince: T0 });
    history.observe(snap([waiting], [agent({ status: 'done' })]));
    await history.flush();

    t += 2 * MIN;
    history = await open();
    history.observe(snap([waiting], [agent({ status: 'done' })]));
    let r = (await history.report())!;
    expect(r.events.filter((e) => e.kind === 'agent-end')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'session-open')).toHaveLength(1);
    // l'attesa continua: contata una volta, in corso fino a ora
    expect(r.waits).toMatchObject({ count: 1, totalMs: 2 * MIN });

    t += MIN;
    history.observe(snap([session({ updatedAt: t })]));
    r = (await history.report())!;
    expect(r.waits).toMatchObject({ count: 1, totalMs: 3 * MIN });
    expect(r.byType[0]!.count).toBe(1);
  });

  it('attesa chiusa mentre il server era spento: finisce all\'ultima attività della sessione', async () => {
    history.observe(snap([session({ waiting: true, waitingSince: T0 })]));
    await history.flush();
    t += 60 * MIN;
    history = await open();
    history.observe(snap([session({ updatedAt: T0 + 2 * MIN })]));
    expect((await history.report())!.waits.totalMs).toBe(2 * MIN);
  });

  it('un agente ripreso e terminato di nuovo aggiorna la sua fine, senza contarlo due volte', async () => {
    history.observe(snap([session()], [agent({ status: 'done' })]));
    t += 10 * MIN;
    history.observe(snap([session()], [agent({ status: 'done', updatedAt: t, cost: 0.8 })]));
    const r = (await history.report())!;
    expect(r.byType).toEqual([{ agentType: 'Explore', count: 1, avgMs: 15 * MIN, cost: 0.8, avgCost: 0.8 }]);
    expect(r.events.filter((e) => e.kind === 'agent-end')).toHaveLength(1);
  });

  it('terminati di oggi delle sessioni chiuse (B5), non quelli delle sessioni aperte', async () => {
    history.observe(snap([session(), session({ id: 's2', project: 'altro' })], [], [agent({ status: 'done' }), agent({ id: 'a2', sessionId: 's2', status: 'done' })]));
    expect(history.closedFinished()).toBeUndefined();
    history.observe(snap([session()], [], [agent({ status: 'done' })]));
    expect(history.closedFinished()).toEqual([
      expect.objectContaining({ id: 'a2', sessionId: 's2', project: 'altro', agentType: 'Explore', outputTokens: 1200, cost: 0.5 }),
    ]);
    expect(history.closedFinished()).toBe(history.closedFinished());
  });

  it('esito dei terminati (#97): nella cronologia, nei terminati delle sessioni chiuse e dopo un riavvio', async () => {
    history.observe(snap([session(), session({ id: 's2', project: 'altro' })], [], [
      agent({ status: 'done', outcome: 'failed' }),
      agent({ id: 'a2', sessionId: 's2', status: 'done', outcome: 'interrupted' }),
      // senza esito dal transcript: finito bene
      agent({ id: 'a3', sessionId: 's2', status: 'done', updatedAt: T0 - MIN }),
    ]));
    history.observe(snap([session()]));
    // esiti dal più recente: a1 e a2 alle 10:00, a3 un minuto prima
    const ends = async () => (await history.report())!.events.filter((e) => e.kind === 'agent-end').map((e) => e.outcome);
    expect((await ends()).slice(0, 2).sort()).toEqual(['failed', 'interrupted']);
    expect((await ends())[2]).toBe('ok');
    expect(history.closedFinished()!.map((f) => [f.id, f.outcome])).toEqual([['a2', 'interrupted'], ['a3', 'ok']]);

    await history.flush();
    // una riga scritta a mano con un esito sconosciuto: scartato, il resto della riga vale
    await writeFile(join(dir, '2026-10-23.jsonl'), `${await readFile(join(dir, '2026-10-23.jsonl'), 'utf8')}${JSON.stringify({
      k: 'e:a9', at: T0, kind: 'agent-end', sessionId: 's2', project: 'altro', agent: 'Zeta', outcome: 'boh',
    })}\n`);
    history = await open();
    const reloaded = (await history.report())!.events.filter((e) => e.kind === 'agent-end');
    expect(reloaded.map((e) => e.outcome).sort()).toEqual(['failed', 'interrupted', 'ok', undefined]);
    expect(reloaded.find((e) => e.agent === 'Zeta')).not.toHaveProperty('outcome');
    expect(history.closedFinished()!.find((f) => f.id === 'a9')).not.toHaveProperty('outcome');
  });

  it('i fatti di ieri non entrano nella giornata; a mezzanotte si passa al file nuovo', async () => {
    history.observe(snap([session({ startedAt: T0 - 24 * 60 * MIN })], [agent({ status: 'done', startedAt: T0 - 25 * 60 * MIN, updatedAt: T0 - 24 * 60 * MIN })]));
    expect((await history.report())!.events).toEqual([]);
    t = new Date(2026, 9, 24, 0, 5).getTime();
    history.observe(snap([session({ updatedAt: t })], [agent({ id: 'a3', startedAt: t })]));
    const r = (await history.report())!;
    expect(r.day).toBe('2026-10-24');
    expect(r.events.map((e) => e.kind)).toEqual(['agent-start']);
    expect(r.days).toEqual(['2026-10-24']);
    expect((await history.report('2026-10-23'))!.events).toEqual([]);
    expect(await history.report('ieri')).toBeNull();
  });

  it('sfoltisce i giorni oltre la soglia e scarta le righe troncate', async () => {
    await writeFile(join(dir, '2026-09-01.jsonl'), '{}\n');
    await writeFile(join(dir, '2026-10-20.jsonl'), `${JSON.stringify({ k: 's:x', at: T0 - 3 * 1440 * MIN, kind: 'agent-start', sessionId: 's', project: 'p' })}\n{"k":"tron`);
    await writeFile(join(dir, 'note.txt'), '');
    history = await open();
    await history.flush();
    expect((await readdir(dir)).sort()).toEqual(['2026-10-20.jsonl', 'note.txt']);
    const r = (await history.report('2026-10-20'))!;
    expect(r.events).toHaveLength(1);
    expect(r.days).toEqual(['2026-10-23', '2026-10-20']);
  });

  // #102: gli stessi scenari e valori del vecchio cruscotto in memoria (state/today), in un giorno senza riavvii
  it('barra "Oggi": agenti partiti, terminati e falliti oggi; un agente si conta una volta sola', () => {
    history.observe(snap([], [agent(), agent({ id: 'a2' }), agent({ id: 'vecchio', startedAt: T0 - 24 * 60 * MIN })]));
    history.observe(snap([], [agent({ id: 'a2', status: 'done', outcome: 'interrupted', updatedAt: T0 + 1000 })], [
      agent({ status: 'done', outcome: 'failed', updatedAt: T0 + 2000 }),
      agent({ id: 'a3', status: 'done', updatedAt: T0 - 60 * MIN, startedAt: T0 - 120 * MIN }),
    ]));
    // ripreso e terminato di nuovo, stavolta bene: cambia categoria senza contarsi due volte
    t += 10 * MIN;
    history.observe(snap([], [], [agent({ status: 'done', outcome: 'ok', updatedAt: t })]));
    expect(history.counts(t)).toMatchObject({ launched: 3, finished: 3, failed: 0 });
  });

  it('barra "Oggi": attesa delle sessioni bloccate, anche quella ancora aperta, e dopo un riavvio', async () => {
    history.observe(snap([session({ waiting: true, waitingSince: T0 - 10 * MIN })]));
    t = T0 + 5 * MIN;
    history.observe(snap([session({ updatedAt: t })]));
    t = T0 + 20 * MIN;
    history.observe(snap([session({ id: 's2', waiting: true, waitingSince: t })]));
    t = T0 + 23 * MIN;
    expect(history.counts(t).waitingMs).toBe((15 + 3) * MIN);

    await history.flush();
    t = T0 + 30 * MIN;
    history = await open();
    expect(history.counts(t)).toMatchObject({ waitingMs: (15 + 10) * MIN });
    history.observe(snap([session({ id: 's2', waiting: true, waitingSince: T0 + 20 * MIN })]));
    expect(history.counts(t).waitingMs).toBe((15 + 10) * MIN);
  });

  it('barra "Oggi": un\'attesa a cavallo della mezzanotte conta da mezzanotte', () => {
    const late = new Date(2026, 9, 23, 23, 50).getTime();
    t = late;
    history.observe(snap([session({ waiting: true, waitingSince: late })]));
    t = new Date(2026, 9, 24, 0, 10).getTime();
    expect(history.counts(t).waitingMs).toBe(10 * MIN);
    history.observe(snap([session({ updatedAt: t })]));
    expect(history.counts(t + MIN)).toMatchObject({ waitingMs: 10 * MIN, launched: 0 });
  });

  it('dayOf usa l\'ora locale', () => {
    expect(dayOf(new Date(2026, 0, 2, 23, 59).getTime())).toBe('2026-01-02');
  });
});
