import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { EMPTY_SEATING, officeModel } from './officeModel';

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
const agent = (id: string): AgentState => ({
  id, sessionId: 's1', name: id, agentType: 'Explore', description: '', area: 'research', status: 'working',
  model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0,
});
const session = (id: string, active: boolean, updatedAt: number): SessionState => ({
  id, title: null, model: null, effort: null, context: { used: 0, window: null }, tokensUsed: tokens,
  startedAt: 0, updatedAt, active, status: 'working', issues: [], cwd: null, branch: null, waiting: false,
  dot: 'working', project: null,
});
const EMPTY = EMPTY_SEATING;
const snap = (agents: AgentState[], sessions: SessionState[] = []): Snapshot =>
  ({ status: 'idle', repo: null, sessions, agents, generatedAt: 0 });

describe('officeModel', () => {
  it('senza snapshot: ufficio vuoto con capacità minima', () => {
    const m = officeModel(null, EMPTY);
    expect(m.agents).toEqual([]);
    expect(m.layout.seats.length).toBeGreaterThanOrEqual(8);
    expect(m.session).toBeNull();
  });

  it('assegna un posto a ogni agente e mantiene i posti tra un aggiornamento e l\'altro', () => {
    const a = officeModel(snap([agent('a'), agent('b')]), EMPTY);
    expect(Object.keys(a.seats).sort()).toEqual(['a', 'b']);
    const b = officeModel(snap([agent('b'), agent('c'), agent('a')]), a);
    expect(b.seats.a).toBe(a.seats.a);
    expect(b.seats.b).toBe(a.seats.b);
    expect(b.seats.c).toBeDefined();
    expect(new Set(Object.values(b.seats)).size).toBe(3);
  });

  it('riusa lo stesso layout finché la capienza non cambia (niente ricostruzioni della scena)', () => {
    const a = officeModel(snap([agent('a')]), EMPTY);
    expect(officeModel(snap([agent('a'), agent('b')]), a).layout).toBe(a.layout);
    const many = officeModel(snap(Array.from({ length: 20 }, (_, i) => agent(`a${i}`))), a);
    expect(many.layout).not.toBe(a.layout);
  });

  it('l\'ufficio non si restringe quando gli agenti escono (niente rimescolamento dei posti)', () => {
    const many = officeModel(snap(Array.from({ length: 20 }, (_, i) => agent(`a${i}`))), EMPTY);
    const few = officeModel(snap([agent('a19')]), many);
    expect(few.layout.seats.length).toBe(many.layout.seats.length);
    expect(few.seats.a19).toBe(many.seats.a19);
  });

  it('sessione mostrata: la prima attiva, altrimenti la più recente', () => {
    expect(officeModel(snap([], [session('old', false, 1), session('act', true, 0)]), EMPTY).session?.id).toBe('act');
    expect(officeModel(snap([], [session('x', false, 1), session('y', false, 5)]), EMPTY).session?.id).toBe('y');
  });

  it('chi ha finito va sui divani finché un altro lavora; quando hanno finito tutti escono (target null)', () => {
    const done = { ...agent('d'), status: 'done' as const };
    const start = officeModel(snap([agent('d'), agent('w')]), EMPTY);
    const m = officeModel(snap([done, agent('w')]), start);
    expect(m.targets.d?.id).toMatch(/^lounge-/);
    expect(m.targets.w?.id).toBe(m.seats.w);
    const all = officeModel(snap([done, { ...agent('w'), status: 'done' }]), m);
    expect(all.targets).toEqual({ d: null, w: null });
    expect(all.seats).toEqual({});
  });

  it('chi è uscito, o non è mai stato visto lavorare, non torna in area relax quando entra un nuovo agente', () => {
    const done = (id: string) => ({ ...agent(id), status: 'done' as const });
    const before = officeModel(snap([agent('old')]), EMPTY);
    const out = officeModel(snap([done('old')]), before);
    expect(out.targets.old).toBeNull();
    const again = officeModel(snap([done('old'), done('never'), agent('new')]), out);
    expect(again.targets.old).toBeNull();
    expect(again.targets.never).toBeNull();
    expect(again.targets.new?.id).toMatch(/^seat-/);
  });

  it('Claudio Code: nella stanza del boss mentre lavora, sui divani se finisce prima degli agenti, poi esce', () => {
    const s = (status: SessionState['status']) => ({ ...session('s1', true, 1), status, issues: [14] });
    const working = officeModel(snap([agent('w')], [s('working')]), EMPTY);
    expect(working.bosses).toMatchObject([{ id: 'boss:s1', name: 'Claudio Code', issues: [14] }]);
    expect(working.targets['boss:s1']?.id).toBe('boss-0');
    expect(officeModel(snap([agent('w')], [s('done')]), EMPTY).targets['boss:s1']?.id).toMatch(/^lounge-/);
    expect(officeModel(snap([], [s('done')]), EMPTY).targets['boss:s1']).toBeNull();
    expect(officeModel(snap([], [{ ...s('working'), active: false }]), EMPTY).bosses).toEqual([]);
  });

  it('più sessioni attive: un Claudio per sessione, ognuno alla sua postazione; oltre 4 nell\'openspace', () => {
    const s = (id: string, project: string, updatedAt = 1) => ({ ...session(id, true, updatedAt), cwd: `/u/${project}`, project });
    const two = officeModel(snap([], [s('a', 'alpha'), s('b', 'beta')]), EMPTY);
    expect(two.bosses.map((b) => b.name)).toEqual(['Claudio Code · alpha', 'Claudio Code · beta']);
    expect(new Set(two.bosses.map((b) => two.targets[b.id]?.id))).toEqual(new Set(['boss-0', 'boss-1']));
    // postazioni stabili anche se cambia l'ordine delle sessioni
    const swapped = officeModel(snap([], [s('b', 'beta', 9), s('a', 'alpha')]), two);
    expect(swapped.targets['boss:a']?.id).toBe(two.targets['boss:a']?.id);
    const six = officeModel(snap([], ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => s(id, id))), EMPTY);
    const places = six.bosses.map((b) => six.targets[b.id]?.id ?? '');
    expect(places.filter((p) => p.startsWith('boss-'))).toHaveLength(4);
    expect(places.filter((p) => p.startsWith('seat-'))).toHaveLength(2);
  });

  it('area relax piena: nessuno si siede sopra un altro; chi non trova posto in piedi esce', () => {
    const working = agent('w');
    const many = Array.from({ length: 60 }, (_, i) => ({ ...agent(`d${i}`), status: 'done' as const }));
    const seen = officeModel(snap([working, ...many.map((a) => ({ ...a, status: 'working' as const }))]), EMPTY);
    const m = officeModel(snap([working, ...many]), seen);
    const spots = many.map((a) => m.targets[a.id]?.id).filter((id): id is string => id !== undefined);
    expect(new Set(spots).size).toBe(spots.length);
    expect(spots.some((id) => id.startsWith('stand-'))).toBe(true);
    expect(many.some((a) => m.targets[a.id] === null)).toBe(true);
  });
});
