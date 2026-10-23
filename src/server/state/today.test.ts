import { describe, expect, it } from 'vitest';
import type { AgentState, SessionState, Snapshot } from '../../shared/types.js';
import { createDayTracker, midnightOf } from './today.js';

// istanti in ora locale, lontani dalla mezzanotte: i test non dipendono dal fuso orario
const DAY = new Date(2026, 0, 10).getTime();
const H = 3_600_000;
const START = DAY + 9 * H;
const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

const session = (id: string, over: Partial<SessionState> = {}): SessionState => ({
  id, title: null, model: null, effort: null, context: { used: 0, window: null }, tokensUsed: zero, startedAt: START, updatedAt: START,
  active: true, status: 'working', issues: [], cwd: null, branch: null, waiting: false, dot: 'working', project: null, ...over,
});
const agent = (id: string, over: Partial<AgentState> = {}): AgentState => ({
  id, sessionId: 's1', name: id, agentType: 'x', description: '', area: 'other', status: 'working', model: null, tokens: zero,
  progress: null, issues: [], startedAt: START, updatedAt: START, ...over,
});
const snap = (sessions: SessionState[], agents: AgentState[] = [], finished: AgentState[] = []): Snapshot =>
  ({ status: 'idle', sessions, agents, finished, generatedAt: 0 });

describe('createDayTracker', () => {
  it('mezzanotte locale', () => {
    expect(midnightOf(START)).toBe(DAY);
  });

  it('costo di oggi: le sessioni nate oggi per intero, le altre dagli aumenti; ultima ora solo gli aumenti recenti', () => {
    const t = createDayTracker(START);
    // nata ieri: conta solo da adesso; nata oggi prima dell'avvio: per intero ma non nell'ultima ora
    let today = t.observe(snap([session('ieri', { startedAt: DAY - H, cost: 10 }), session('oggi', { startedAt: DAY + H, cost: 2 })]), START);
    expect(today).toMatchObject({ since: START, cost: 2, costLastHour: 0 });
    today = t.observe(snap([session('ieri', { startedAt: DAY - H, cost: 10.5 }), session('oggi', { startedAt: DAY + H, cost: 3 })]), START + 30 * 60_000);
    expect(today).toMatchObject({ cost: 3.5, costLastHour: 1.5 });
    // un'ora dopo l'aumento esce dalla finestra; una sessione nata dopo l'avvio entra subito
    today = t.observe(snap([session('nuova', { startedAt: START + H, cost: 0.25 })]), START + 2 * H);
    expect(today).toMatchObject({ cost: 3.75, costLastHour: 0.25 });
  });

  it('nessun modello nel listino: costo null', () => {
    expect(createDayTracker(START).observe(snap([session('s1')]), START)).toMatchObject({ cost: null, costLastHour: null });
  });

  it('agenti partiti, terminati e falliti oggi; un agente si conta una volta sola', () => {
    const t = createDayTracker(START);
    t.observe(snap([], [agent('a1'), agent('a2'), agent('vecchio', { startedAt: DAY - H })]), START);
    const today = t.observe(
      snap([], [agent('a2', { status: 'done', outcome: 'interrupted', updatedAt: START + 1000 })], [
        agent('a1', { status: 'done', outcome: 'failed', updatedAt: START + 2000 }),
        agent('a3', { status: 'done', updatedAt: START - H, startedAt: START - 2 * H }),
      ]),
      START + 5000,
    );
    expect(today).toMatchObject({ launched: 3, finished: 2, failed: 1 });
  });

  it('attesa: somma il tempo delle sessioni bloccate, anche quella ancora aperta', () => {
    const t = createDayTracker(START);
    t.observe(snap([session('s1', { waiting: true, waitingSince: START - 10 * 60_000 })]), START);
    t.observe(snap([session('s1')]), START + 5 * 60_000);
    const today = t.observe(snap([session('s2', { waiting: true, waitingSince: START + 20 * 60_000 })]), START + 23 * 60_000 + 30_000);
    expect(today.waitingMs).toBe((15 + 3) * 60_000);
  });

  it('a mezzanotte si riparte da zero', () => {
    const t = createDayTracker(START);
    t.observe(snap([session('s1', { startedAt: START, cost: 1 })], [agent('a1')]), START);
    const next = t.observe(snap([session('s1', { startedAt: START, cost: 1.5 })]), DAY + 25 * H);
    expect(next).toMatchObject({ since: DAY + 24 * H, cost: 0.5, launched: 0 });
  });
});
