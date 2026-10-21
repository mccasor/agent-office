import { describe, expect, it } from 'vitest';
import { assignSeats, assignSpots, seatsByDoorDistance } from './seats';
import { createLayout } from './layout';
import { findPath } from './path';

describe('assignSeats', () => {
  const layout = createLayout(8);

  it('i nuovi agenti prendono il posto libero più vicino alla porta (distanza di percorso)', () => {
    const order = seatsByDoorDistance(layout);
    expect(order.length).toBe(layout.seats.length);
    const dist = (id: string) => findPath(layout, layout.door, layout.seats.find((s) => s.id === id)!.cell).length;
    for (let i = 1; i < order.length; i++) expect(dist(order[i]!)).toBeGreaterThanOrEqual(dist(order[i - 1]!));
    expect(assignSeats({}, ['a', 'b'], layout)).toEqual({ a: order[0], b: order[1] });
  });

  it('è stabile: chi ha già un posto lo mantiene', () => {
    const r1 = assignSeats({}, ['a', 'b', 'c'], layout);
    const r2 = assignSeats(r1, ['c', 'd', 'a', 'b'], layout);
    expect(r2.a).toBe(r1.a);
    expect(r2.b).toBe(r1.b);
    expect(r2.c).toBe(r1.c);
    expect(new Set(Object.values(r2)).size).toBe(4);
  });

  it('gli agenti assenti liberano il posto, riusato dai nuovi', () => {
    const r1 = assignSeats({}, ['a', 'b'], layout);
    const r2 = assignSeats(r1, ['b', 'c'], layout);
    expect(r2).toEqual({ b: r1.b, c: r1.a });
    expect('a' in r2).toBe(false);
  });

  it('ignora posti precedenti non più esistenti o duplicati', () => {
    const first = layout.seats[0]!.id;
    const r = assignSeats({ a: 'nope', b: first, c: first }, ['a', 'b', 'c'], layout);
    expect(r.b).toBe(first);
    expect(new Set(Object.values(r)).size).toBe(3);
    expect(layout.seats.some((s) => s.id === r.a)).toBe(true);
  });

  it('senza posti liberi gli agenti in eccesso restano senza posto', () => {
    const ids = Array.from({ length: layout.seats.length + 2 }, (_, i) => `x${i}`);
    const r = assignSeats({}, ids, layout);
    expect(Object.keys(r).length).toBe(layout.seats.length);
  });

  it('non muta prev ed è deterministico', () => {
    const prev = { a: 'seat-0' };
    const r1 = assignSeats(prev, ['b', 'a'], layout);
    expect(prev).toEqual({ a: 'seat-0' });
    expect(assignSeats(prev, ['b', 'a'], layout)).toEqual(r1);
  });
});

describe('assignSpots', () => {
  it('stabile, primo libero in ordine; finiti i posti gli ultimi restano senza (mai due sullo stesso)', () => {
    const a = assignSpots({}, ['x', 'y'], ['s0', 's1']);
    expect(a).toEqual({ x: 's0', y: 's1' });
    expect(assignSpots(a, ['y', 'z'], ['s0', 's1'])).toEqual({ y: 's1', z: 's0' });
    expect(assignSpots({}, ['a', 'b', 'c'], ['s0', 's1'])).toEqual({ a: 's0', b: 's1' });
    expect(assignSpots({}, ['a'], [])).toEqual({});
  });
});
