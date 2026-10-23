import { describe, expect, it } from 'vitest';
import { assignSpots } from './seats';

describe('assignSpots', () => {
  it('stabile, primo libero in ordine; finiti i posti gli ultimi restano senza (mai due sullo stesso)', () => {
    const a = assignSpots({}, ['x', 'y'], ['s0', 's1']);
    expect(a).toEqual({ x: 's0', y: 's1' });
    expect(assignSpots(a, ['y', 'z'], ['s0', 's1'])).toEqual({ y: 's1', z: 's0' });
    expect(assignSpots({}, ['a', 'b', 'c'], ['s0', 's1'])).toEqual({ a: 's0', b: 's1' });
    expect(assignSpots({}, ['a'], [])).toEqual({});
  });

  it('ignora posti precedenti non più esistenti o duplicati e non muta prev', () => {
    const prev = { a: 'nope', b: 's0', c: 's0' };
    expect(assignSpots(prev, ['a', 'b', 'c'], ['s0', 's1', 's2'])).toEqual({ b: 's0', a: 's1', c: 's2' });
    expect(prev).toEqual({ a: 'nope', b: 's0', c: 's0' });
  });
});
