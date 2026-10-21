import { describe, expect, it } from 'vitest';
import { findPath } from './path';
import type { Cell, OfficeLayout } from './layout';

function grid(rows: string[]): OfficeLayout {
  return {
    width: rows[0]!.length,
    depth: rows.length,
    door: { x: 0, z: 0 },
    seats: [],
    islands: [],
    bossSeat: { id: 'boss', cell: { x: 0, z: 0 }, facing: 0 },
    bossDoor: { x: 0, z: 0 },
    lounge: [],
    boards: {
      todo: { id: 'board', cell: { x: 0, z: 0 }, facing: 0 },
      progress: { id: 'board', cell: { x: 0, z: 0 }, facing: 0 },
      review: { id: 'board', cell: { x: 0, z: 0 }, facing: 0 },
    },
    walkable: rows.map((r) => [...r].map((c) => c !== '#')),
  };
}

function expectValid(l: OfficeLayout, p: Cell[]) {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBe(1);
    expect(l.walkable[b.z]![b.x]).toBe(true);
  }
}

describe('findPath', () => {
  it('include from e to, percorso minimo 4-direzioni', () => {
    const l = grid(['....', '.##.', '....']);
    const p = findPath(l, { x: 0, z: 1 }, { x: 3, z: 1 });
    expect(p[0]).toEqual({ x: 0, z: 1 });
    expect(p[p.length - 1]).toEqual({ x: 3, z: 1 });
    expect(p.length).toBe(6);
    expectValid(l, p);
  });

  it('from === to restituisce [from]', () => {
    const l = grid(['...']);
    expect(findPath(l, { x: 1, z: 0 }, { x: 1, z: 0 })).toEqual([{ x: 1, z: 0 }]);
  });

  it('[] se irraggiungibile, fuori griglia o su cella bloccata', () => {
    const l = grid(['.#.', '.#.', '.#.']);
    expect(findPath(l, { x: 0, z: 0 }, { x: 2, z: 2 })).toEqual([]);
    expect(findPath(l, { x: 0, z: 0 }, { x: 1, z: 1 })).toEqual([]);
    expect(findPath(l, { x: 0, z: 0 }, { x: 9, z: 0 })).toEqual([]);
  });

  it('aggira gli ostacoli', () => {
    const l = grid(['.....', '####.', '.....', '.####', '.....']);
    const p = findPath(l, { x: 0, z: 0 }, { x: 4, z: 4 });
    expect(p.length).toBe(17);
    expectValid(l, p);
  });

  it('deterministico', () => {
    const l = grid(['.....', '.....', '.....']);
    expect(findPath(l, { x: 0, z: 0 }, { x: 4, z: 2 })).toEqual(findPath(l, { x: 0, z: 0 }, { x: 4, z: 2 }));
  });
});
