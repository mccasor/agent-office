import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { officeModel } from './officeModel';

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
const agent = (id: string): AgentState => ({
  id, sessionId: 's1', name: id, agentType: 'Explore', description: '', area: 'research', status: 'working',
  model: null, tokens, progress: null, startedAt: 0, updatedAt: 0,
});
const session = (id: string, active: boolean, updatedAt: number): SessionState => ({
  id, title: null, model: null, effort: null, context: { used: 0, window: null }, tokensUsed: tokens,
  tokensLeft: null, startedAt: 0, updatedAt, active,
});
const snap = (agents: AgentState[], sessions: SessionState[] = []): Snapshot =>
  ({ repo: null, sessions, agents, generatedAt: 0 });

describe('officeModel', () => {
  it('senza snapshot: ufficio vuoto con capacità minima', () => {
    const m = officeModel(null, { seats: {}, capacity: 0 });
    expect(m.agents).toEqual([]);
    expect(m.layout.seats.length).toBeGreaterThanOrEqual(8);
    expect(m.session).toBeNull();
  });

  it('assegna un posto a ogni agente e mantiene i posti tra un aggiornamento e l\'altro', () => {
    const a = officeModel(snap([agent('a'), agent('b')]), { seats: {}, capacity: 0 });
    expect(Object.keys(a.seats).sort()).toEqual(['a', 'b']);
    const b = officeModel(snap([agent('b'), agent('c'), agent('a')]), a);
    expect(b.seats.a).toBe(a.seats.a);
    expect(b.seats.b).toBe(a.seats.b);
    expect(b.seats.c).toBeDefined();
    expect(new Set(Object.values(b.seats)).size).toBe(3);
  });

  it('l\'ufficio non si restringe quando gli agenti escono (niente rimescolamento dei posti)', () => {
    const many = officeModel(snap(Array.from({ length: 20 }, (_, i) => agent(`a${i}`))), { seats: {}, capacity: 0 });
    const few = officeModel(snap([agent('a19')]), many);
    expect(few.layout.seats.length).toBe(many.layout.seats.length);
    expect(few.seats.a19).toBe(many.seats.a19);
  });

  it('sessione mostrata: la prima attiva, altrimenti la più recente', () => {
    expect(officeModel(snap([], [session('old', false, 1), session('act', true, 0)]), { seats: {}, capacity: 0 }).session?.id).toBe('act');
    expect(officeModel(snap([], [session('x', false, 1), session('y', false, 5)]), { seats: {}, capacity: 0 }).session?.id).toBe('y');
  });
});
