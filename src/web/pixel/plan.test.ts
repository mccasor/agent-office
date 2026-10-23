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
    // prima il biliardino, poi i posti a sedere, infine quelli in piedi
    const ids = lounge.seats.map((s) => s.id);
    const kind = (id: string) => id.replace(/-\d+$/, '');
    expect([...new Set(ids.map(kind))]).toEqual(['foos', 'lounge', 'stand']);
    expect(ids.map(kind)).toEqual([...ids.map(kind)].sort());
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

describe('arredi (#89)', () => {
  const inside = (f: { cell: { x: number; z: number }; w: number; h: number }, c: { x: number; z: number }) =>
    c.x >= f.cell.x && c.x < f.cell.x + f.w && c.z >= f.cell.z && c.z < f.cell.z + f.h;
  const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

  it('biliardino in sala relax con 2-4 giocatori in piedi ai lati lunghi, rivolti verso il tavolo', () => {
    const lounge = plan.rooms[INSTANCE_ROOMS]!;
    const table = plan.furniture.filter((f) => f.kind === 'foosball');
    expect(table).toHaveLength(1);
    expect(table[0]!.room).toBe('lounge');
    const players = lounge.seats.filter((s) => s.id.startsWith('foos-'));
    expect(players.length).toBeGreaterThanOrEqual(2);
    expect(players.length).toBeLessThanOrEqual(4);
    // i primi posti della sala relax: il primo che aspetta gioca, il secondo dall'altro lato
    expect(lounge.seats.slice(0, players.length)).toEqual(players);
    expect(players[0]!.facing).not.toBe(players[1]!.facing);
    for (const p of players) {
      expect(p.seated).toBe(false);
      expect(['up', 'down']).toContain(p.facing);
      const [dx, dz] = STEP[p.facing];
      expect(inside(table[0]!, { x: p.cell.x + dx, z: p.cell.z + dz }), p.id).toBe(true);
    }
  });

  it('sala relax con distributore, frigo, cabinati e caffè', () => {
    const kinds = new Set(plan.furniture.filter((f) => f.room === 'lounge').map((f) => f.kind));
    for (const k of ['vending', 'fridge', 'arcade', 'coffee-machine', 'water-cooler', 'sofa', 'poster'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  it('stanze istanza diverse tra loro: arredi minori, tinte di pavimento e pareti', () => {
    const fixed = new Set(['desk', 'boss-desk', 'chair', 'monitor', 'window']);
    const rooms = plan.rooms.slice(0, INSTANCE_ROOMS);
    const minor = (r: (typeof rooms)[number]) => plan.furniture.filter((f) => f.room === r.id && !fixed.has(f.kind));
    const signature = (r: (typeof rooms)[number]) =>
      minor(r).map((f) => `${f.kind}:${f.cell.x - r.x}:${f.variant ?? 0}`).sort().join();
    expect(new Set(rooms.map(signature)).size).toBe(INSTANCE_ROOMS);
    for (const r of rooms) {
      expect(minor(r).length, r.id).toBeGreaterThanOrEqual(8);
      // non troppo affollata: almeno metà della stanza resta calpestabile
      let free = 0;
      for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) if (plan.walkable[z]![x]) free++;
      expect(free, r.id).toBeGreaterThanOrEqual((r.w * r.h) / 2);
    }
    const style = (r: (typeof plan.rooms)[number]) => plan.styles[r.z]![r.x];
    expect(plan.rooms.map(style)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const r of plan.rooms) expect(plan.styles[r.z - 1]![r.x], `parete nord di ${r.id}`).toBe(style(r));
    expect(plan.styles[plan.entrance.z]![plan.entrance.x + 1]).toBe(-1);
  });

  it('quadri, orologi, bacheche e poster stanno sulla parete nord con la faccia visibile', () => {
    const wall = plan.furniture.filter((f) => ['painting', 'clock', 'corkboard', 'poster'].includes(f.kind));
    expect(wall.length).toBeGreaterThanOrEqual(12);
    for (const f of wall) {
      for (let dx = 0; dx < f.w; dx++) {
        expect(plan.tiles[f.cell.z]![f.cell.x + dx], f.kind).toBe('wall');
        expect(['floor', 'lounge'], f.kind).toContain(plan.tiles[f.cell.z + 1]![f.cell.x + dx]);
      }
    }
  });
});
