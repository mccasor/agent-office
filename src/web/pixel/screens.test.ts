import { describe, expect, it } from 'vitest';
import { cellKey } from './draw';
import { furnitureLook, type FurnitureUse } from './screens';
import type { Furniture } from './types';

const monitor = (facing: Furniture['facing'], x = 3, z = 4): Furniture => ({ kind: 'monitor', cell: { x, z }, w: 1, h: 1, facing, room: 'room-0' });
const using = (f: Furniture, area: string): FurnitureUse => ({ screens: new Map([[cellKey(f.cell), area]]), players: 0 });
const idle: FurnitureUse = { screens: new Map(), players: 0 };

describe('furnitureLook', () => {
  it('monitor spento se nessuno ci lavora', () => {
    expect(furnitureLook(monitor('down'), idle, 3)).toEqual({ frame: -1, variant: 0 });
  });

  it('monitor acceso se qualcuno ci digita davanti', () => {
    const m = monitor('down');
    expect(furnitureLook(m, using(m, 'backend'), 3).frame).toBeGreaterThanOrEqual(0);
  });

  it('biliardino fermo senza giocatori, in partita con almeno uno', () => {
    const table: Furniture = { kind: 'foosball', cell: { x: 30, z: 18 }, w: 2, h: 1, facing: 'down', room: 'lounge' };
    expect(furnitureLook(table, idle, 5).frame).toBe(-1);
    const frames = new Set([0, 0.2, 0.4, 0.6].map((t) => furnitureLook(table, { ...idle, players: 2 }, t).frame));
    expect(frames.size).toBeGreaterThan(1);
    expect([...frames].every((f) => f >= 0)).toBe(true);
  });

  it('gli altri arredi restano fermi con la loro variante', () => {
    const rug: Furniture = { kind: 'rug', cell: { x: 5, z: 3 }, w: 3, h: 5, facing: 'down', room: 'room-0', variant: 2 };
    expect(furnitureLook(rug, idle, 9)).toEqual({ frame: 0, variant: 2 });
  });
});
