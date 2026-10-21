import { describe, expect, it } from 'vitest';
import type { AgentState } from '../shared/types';
import { MAX_REVIEWED, moveCard, syncBoard } from './board';

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
const agent = (id: string, over: Partial<AgentState> = {}): AgentState => ({
  id, sessionId: 's1', name: `task ${id}`, agentType: 'Explore', description: '', area: 'frontend', status: 'working',
  model: null, tokens, progress: null, issues: [14], startedAt: 0, updatedAt: 0, ...over,
});

describe('syncBoard', () => {
  it('un post-it per agente: nuovi in "to do", già terminati in "in review"', () => {
    const b = syncBoard({}, [agent('a'), agent('b', { status: 'done' })]);
    expect(b.a).toEqual({ id: 'a', title: 'task a', issues: [14], area: 'frontend', place: 'todo' });
    expect(b.b?.place).toBe('review');
  });

  it('mantiene il posto e aggiorna titolo/issue; degli usciti restano solo quelli in review', () => {
    let b = syncBoard({}, [agent('a'), agent('b'), agent('c')]);
    b = moveCard(moveCard(b, 'a', 'progress'), 'b', 'review');
    b = syncBoard(b, [agent('a', { name: 'nuovo', issues: [3] })]);
    expect(Object.keys(b).sort()).toEqual(['a', 'b']);
    expect(b.a).toMatchObject({ title: 'nuovo', issues: [3], place: 'progress' });
  });

  it(`conserva al più ${MAX_REVIEWED} post-it di agenti usciti, i più recenti`, () => {
    let b = syncBoard({}, Array.from({ length: MAX_REVIEWED + 3 }, (_, i) => agent(`a${i}`, { status: 'done' })));
    b = syncBoard(b, []);
    expect(Object.keys(b)).toEqual(Array.from({ length: MAX_REVIEWED }, (_, i) => `a${i + 3}`));
  });
});

describe('moveCard', () => {
  it('sposta e mette in fondo; id sconosciuto o stesso posto: invariato', () => {
    const b = syncBoard({}, [agent('a'), agent('b')]);
    const m = moveCard(b, 'a', 'carry');
    expect(Object.keys(m)).toEqual(['b', 'a']);
    expect(m.a?.place).toBe('carry');
    expect(moveCard(b, 'x', 'review')).toBe(b);
    expect(moveCard(b, 'a', 'todo')).toBe(b);
  });
});
