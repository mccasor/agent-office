import { findPath } from '../scene/path';
import { createPlan } from './plan';
import { DESKS_PER_ROOM, INSTANCE_ROOMS, type Spot } from './types';

const plan = createPlan();
const allSpots = (): Spot[] => [
  ...plan.rooms.flatMap((r) => [...r.desks, ...(r.boss ? [r.boss] : []), ...r.seats]),
  ...plan.overflow,
];

describe('createPlan', () => {
  it('deterministica: sempre la stessa pianta', () => {
    expect(createPlan()).toBe(plan);
    expect(plan.tiles).toHaveLength(plan.depth);
    expect(plan.walkable).toHaveLength(plan.depth);
    for (const row of [...plan.tiles, ...plan.walkable]) expect(row).toHaveLength(plan.width);
  });

  it('5 stanze istanza e la sala relax, con 8 postazioni e la scrivania del boss', () => {
    expect(plan.rooms.map((r) => r.id)).toEqual(['room-0', 'room-1', 'room-2', 'room-3', 'room-4', 'lounge']);
    for (const [n, r] of plan.rooms.slice(0, INSTANCE_ROOMS).entries()) {
      expect(r.kind).toBe('instance');
      expect(r.desks.map((d) => d.id)).toEqual(Array.from({ length: DESKS_PER_ROOM }, (_, i) => `r${n}-desk-${i}`));
      expect(r.boss?.id).toBe(`r${n}-boss`);
      expect(r.seats).toEqual([]);
      const kinds = plan.furniture.filter((f) => f.room === r.id).map((f) => f.kind);
      expect(kinds.filter((k) => k === 'desk')).toHaveLength(DESKS_PER_ROOM);
      expect(kinds).toEqual(expect.arrayContaining(['boss-desk', 'whiteboard', 'window', 'plant', 'monitor', 'chair']));
    }
    const lounge = plan.rooms[INSTANCE_ROOMS]!;
    expect(lounge.kind).toBe('lounge');
    expect(lounge.boss).toBeNull();
    expect(lounge.seats.length).toBeGreaterThanOrEqual(16);
    // prima i posti a sedere, poi quelli in piedi
    const ids = lounge.seats.map((s) => s.id);
    const firstStand = ids.findIndex((id) => id.startsWith('stand-'));
    expect(ids.slice(0, firstStand).every((id) => id.startsWith('lounge-'))).toBe(true);
    expect(ids.slice(firstStand).every((id) => id.startsWith('stand-'))).toBe(true);
    expect(lounge.seats.every((s) => s.seated === s.id.startsWith('lounge-'))).toBe(true);
  });

  it('ogni stanza ha una porta sul corridoio e una riga di parete a nord', () => {
    const tile = (x: number, z: number) => plan.tiles[z]?.[x];
    for (const r of plan.rooms) {
      expect(tile(r.door.x, r.door.z)).toBe('door');
      const sides = [tile(r.door.x, r.door.z - 1), tile(r.door.x, r.door.z + 1)];
      expect(sides).toContain('corridor');
      expect(sides).toContain(r.kind === 'lounge' ? 'lounge' : 'floor');
      for (let x = r.x; x < r.x + r.w; x++) expect(['wall', 'door']).toContain(tile(x, r.z - 1));
    }
    expect(tile(plan.entrance.x, plan.entrance.z)).toBe('door');
    expect(plan.overflow.length).toBeGreaterThanOrEqual(8);
    for (const s of plan.overflow) expect(tile(s.cell.x, s.cell.z)).toBe('corridor');
  });

  it('id unici, posti su celle calpestabili e raggiungibili dall\'ingresso', () => {
    const spots = allSpots();
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
    expect(new Set(spots.map((s) => `${s.cell.x},${s.cell.z}`)).size).toBe(spots.length);
    for (const s of spots) {
      expect(plan.walkable[s.cell.z]![s.cell.x]).toBe(true);
      expect(findPath(plan, plan.entrance, s.cell).length, s.id).toBeGreaterThan(0);
    }
  });

  it('pareti e arredi non sono calpestabili (sedie e divani dei posti sì), le finestre stanno sulle pareti', () => {
    const spotCells = new Set(allSpots().map((s) => `${s.cell.x},${s.cell.z}`));
    plan.tiles.forEach((row, z) => row.forEach((t, x) => {
      if (t === 'wall' || t === 'void') expect(plan.walkable[z]![x]).toBe(false);
    }));
    for (const f of plan.furniture) {
      for (let dz = 0; dz < f.h; dz++) {
        for (let dx = 0; dx < f.w; dx++) {
          const x = f.cell.x + dx;
          const z = f.cell.z + dz;
          if (f.kind === 'window') expect(plan.tiles[z]![x]).toBe('wall');
          else if (f.kind !== 'rug' && !spotCells.has(`${x},${z}`)) expect(plan.walkable[z]![x], f.kind).toBe(false);
        }
      }
    }
  });
});
