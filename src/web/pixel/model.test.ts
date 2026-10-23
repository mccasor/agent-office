import type { AgentState, SessionState, Snapshot } from '../../shared/types';
import { EMPTY_PIXEL_SEATING, pixelModel } from './model';
import type { PixelModel } from './types';

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
const agent = (id: string, sessionId = 's1', status: AgentState['status'] = 'working'): AgentState => ({
  id, sessionId, name: id, agentType: 'Explore', description: '', area: 'research', status,
  model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0,
});
const session = (id: string, updatedAt = 1, extra: Partial<SessionState> = {}): SessionState => ({
  id, title: null, model: null, effort: null, context: { used: 0, window: null }, tokensUsed: tokens,
  startedAt: 0, updatedAt, active: true, status: 'working', issues: [], cwd: null, branch: null, waiting: false, dot: 'working', project: null, ...extra,
});
const snap = (agents: AgentState[], sessions: SessionState[] = []): Snapshot =>
  ({ status: 'idle', sessions, agents, generatedAt: 0 });
const EMPTY = EMPTY_PIXEL_SEATING;
const target = (m: PixelModel, id: string) => m.actors.find((a) => a.id === id)?.target?.id ?? null;

describe('pixelModel', () => {
  it('senza snapshot: nessun attore, pianta fissa', () => {
    const m = pixelModel(null, EMPTY);
    expect(m.actors).toEqual([]);
    expect(m.rooms).toEqual({});
    expect(m.roomless).toEqual([]);
    expect(m.plan.rooms).toHaveLength(6);
  });

  it('boss alla sua scrivania, agenti sulle postazioni della stanza; posti stabili tra snapshot', () => {
    const a = pixelModel(snap([agent('a'), agent('b')], [session('s1')]), EMPTY);
    expect(a.rooms).toEqual({ s1: 0 });
    expect(target(a, 'boss:s1')).toBe('r0-boss');
    expect([target(a, 'a'), target(a, 'b')]).toEqual(['r0-desk-0', 'r0-desk-1']);
    const b = pixelModel(snap([agent('c'), agent('b')], [session('s1')]), a);
    expect(target(b, 'b')).toBe('r0-desk-1');
    expect(target(b, 'c')).toBe('r0-desk-0');
    expect(b.actors.find((x) => x.id === 'boss:s1')).toMatchObject({ boss: true, sessionId: 's1', waiting: false });
  });

  it('stanze stabili: una sessione tiene la sua finché è attiva, le nuove prendono la prima libera', () => {
    const two = pixelModel(snap([], [session('a', 1), session('b', 2)]), EMPTY);
    expect(two.rooms).toEqual({ b: 0, a: 1 });
    const swapped = pixelModel(snap([], [session('b', 1), session('a', 9)]), two);
    expect(swapped.rooms).toEqual({ a: 1, b: 0 });
    const gone = pixelModel(snap([], [session('a', 1), session('b', 2, { active: false }), session('c', 3)]), two);
    expect(gone.rooms).toEqual({ a: 1, c: 0 });
  });

  it('oltre 5 istanze: le altre senza stanza (dalla più recente), il loro boss nel corridoio', () => {
    const five = pixelModel(snap([], [1, 2, 3, 4, 5].map((i) => session(`s${i}`, i))), EMPTY);
    expect(Object.keys(five.rooms)).toHaveLength(5);
    const seven = pixelModel(snap([agent('x', 's7')], [1, 2, 3, 4, 5, 6, 7].map((i) => session(`s${i}`, i))), five);
    for (let i = 1; i <= 5; i++) expect(seven.rooms[`s${i}`]).toBe(five.rooms[`s${i}`]);
    expect(seven.roomless).toEqual(['s7', 's6']);
    expect(target(seven, 'boss:s6')).toMatch(/^hall-/);
    expect(target(seven, 'boss:s7')).toMatch(/^hall-/);
    expect(target(seven, 'x')).toMatch(/^hall-/);
    // si libera una stanza: la prende la più recente rimasta fuori
    const after = pixelModel(snap([agent('x', 's7')], [2, 3, 4, 5, 6, 7].map((i) => session(`s${i}`, i))), seven);
    expect(after.rooms.s7).toBe(five.rooms.s1);
    expect(after.roomless).toEqual(['s6']);
    expect(target(after, 'x')).toBe(`r${five.rooms.s1}-desk-0`);
  });

  it('9° agente della stessa istanza nel corridoio; si libera una postazione e la prende', () => {
    const nine = Array.from({ length: 9 }, (_, i) => agent(`a${i}`));
    const m = pixelModel(snap(nine, [session('s1')]), EMPTY);
    expect(nine.slice(0, 8).map((a) => target(m, a.id))).toEqual(Array.from({ length: 8 }, (_, i) => `r0-desk-${i}`));
    expect(target(m, 'a8')).toBe('hall-0');
    const next = pixelModel(snap(nine.slice(1), [session('s1')]), m);
    expect(target(next, 'a8')).toBe('r0-desk-0');
    expect(target(next, 'a1')).toBe('r0-desk-1');
  });

  it('chi ha finito aspetta in sala relax finché lavora un altro agente dell\'istanza, poi esce', () => {
    const start = pixelModel(snap([agent('d'), agent('w')], [session('s1')]), EMPTY);
    const m = pixelModel(snap([agent('d', 's1', 'done'), agent('w')], [session('s1')]), start);
    expect(target(m, 'd')).toBe('lounge-0');
    expect(target(m, 'w')).toBe(target(start, 'w'));
    const all = pixelModel(snap([agent('d', 's1', 'done'), agent('w', 's1', 'done')], [session('s1')]), m);
    expect(target(all, 'd')).toBeNull();
    expect(target(all, 'w')).toBeNull();
    // uscito, o mai visto lavorare: non rientra
    const again = pixelModel(snap([agent('d', 's1', 'done'), agent('n', 's1', 'done'), agent('new')], [session('s1')]), all);
    expect(target(again, 'd')).toBeNull();
    expect(target(again, 'n')).toBeNull();
    expect(target(again, 'new')).toMatch(/^r0-desk-/);
  });

  it('boss: in sala relax se finisce prima degli agenti, poi esce; "!" se la sessione attende', () => {
    const done = pixelModel(snap([agent('w')], [session('s1', 1, { status: 'done' })]), EMPTY);
    expect(target(done, 'boss:s1')).toMatch(/^lounge-/);
    expect(target(pixelModel(snap([], [session('s1', 1, { status: 'done' })]), done), 'boss:s1')).toBeNull();
    const waiting = pixelModel(snap([agent('w')], [session('s1', 1, { waiting: true })]), EMPTY);
    expect(waiting.actors.find((a) => a.id === 'boss:s1')?.waiting).toBe(true);
    expect(waiting.actors.find((a) => a.id === 'w')?.waiting).toBe(false);
  });

  it('subagente bloccato: "!" sopra di lui, non sopra il boss della sessione che ne eredita l\'attesa', () => {
    const blocked = { ...agent('w'), waiting: true, waitingKind: 'permission' as const };
    const m = pixelModel(snap([blocked, agent('x')], [session('s1', 1, { waiting: true, waitingAgentId: 'w' })]), EMPTY);
    expect(m.actors.find((a) => a.id === 'w')?.waiting).toBe(true);
    expect(m.actors.find((a) => a.id === 'x')?.waiting).toBe(false);
    expect(m.actors.find((a) => a.id === 'boss:s1')?.waiting).toBe(false);
  });

  it('agenti di sessioni non attive: nel corridoio mentre lavorano, nessun boss', () => {
    const m = pixelModel(snap([agent('x', 'old')], [session('old', 1, { active: false })]), EMPTY);
    expect(m.actors.map((a) => a.id)).toEqual(['x']);
    expect(target(m, 'x')).toMatch(/^hall-/);
  });

  it('postazioni, corridoio e sala relax pieni: mai due attori sullo stesso posto, gli altri senza meta', () => {
    const many = Array.from({ length: 40 }, (_, i) => agent(`a${i}`));
    const m = pixelModel(snap(many, [session('s1')]), EMPTY);
    const ids = m.actors.map((a) => a.target?.id).filter((id): id is string => id !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1 + 8 + m.plan.overflow.length);
    const done = many.map((a) => ({ ...a, status: 'done' as const }));
    const resting = pixelModel(snap([agent('w'), ...done], [session('s1')]), m);
    const lounge = done.map((a) => target(resting, a.id)).filter((id): id is string => id !== null);
    expect(new Set(lounge).size).toBe(lounge.length);
    expect(lounge).toEqual(resting.plan.rooms[5]!.seats.map((s) => s.id));
  });
});
