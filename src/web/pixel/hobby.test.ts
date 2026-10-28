import { describe, expect, it } from 'vitest';
import { isConsoleSpot, isFoosballSpot, isPingPongSpot } from './actors';
import { HOBBY_DOOR_X, HOBBY_H, HOBBY_KINDS, HOBBY_W, hobbyRoom, hobbySpotRoom, type HobbyKind } from './hobby';
import { createPlan } from './plan';
import { WALL_DECOR, type FurnitureKind } from './types';

/** angolo della stanza nella pianta: le coordinate locali sono la differenza */
const X = 7;
const Z = 3;
/** arredi su cui ci si siede: i posti seduti stanno lì sopra, gli altri arredi bloccanti non hanno posti */
const SEATS = new Set<FurnitureKind>(['sofa', 'armchair', 'chair', 'pouf', 'bench', 'stool']);
const PASSABLE = new Set<FurnitureKind>(['rug', ...WALL_DECOR]);

/** griglia locale HOBBY_W×HOBBY_H: tipo dell'arredo bloccante su ogni cella, null se libera */
function grid(kind: HobbyKind) {
  const room = hobbyRoom(kind, 'h', X, Z);
  const cells: (FurnitureKind | null)[][] = Array.from({ length: HOBBY_H }, () => Array<FurnitureKind | null>(HOBBY_W).fill(null));
  for (const f of room.furniture) {
    if (PASSABLE.has(f.kind)) continue;
    for (let dz = 0; dz < f.h; dz++) {
      for (let dx = 0; dx < f.w; dx++) {
        const lx = f.cell.x - X + dx;
        const lz = f.cell.z - Z + dz;
        expect(cells[lz]![lx], `${kind}: ${f.kind} sovrapposto in ${lx},${lz}`).toBeNull();
        cells[lz]![lx] = f.kind;
      }
    }
  }
  return { room, cells };
}

/** celle libere raggiungibili dalla cella sotto la porta, senza attraversare arredi né posti */
function reachable(kind: HobbyKind): boolean[][] {
  const { room, cells } = grid(kind);
  const seat = new Set(room.seats.map((s) => `${s.cell.x - X},${s.cell.z - Z}`));
  const seen = cells.map((row) => row.map(() => false));
  const queue: [number, number][] = [[HOBBY_DOOR_X, 0]];
  seen[0]![HOBBY_DOOR_X] = true;
  while (queue.length > 0) {
    const [x, z] = queue.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= HOBBY_W || nz >= HOBBY_H || seen[nz]![nx]) continue;
      if (cells[nz]![nx] !== null || seat.has(`${nx},${nz}`)) continue;
      seen[nz]![nx] = true;
      queue.push([nx, nz]);
    }
  }
  return seen;
}

describe.each(HOBBY_KINDS)('sala hobby %s', (kind) => {
  const { room, cells } = grid(kind);
  const local = room.seats.map((s) => ({ ...s, lx: s.cell.x - X, lz: s.cell.z - Z }));

  it('almeno 20 posti, id unici col prefisso della stanza, uno per cella, dentro la stanza', () => {
    expect(room.seats.length).toBeGreaterThanOrEqual(20);
    expect(new Set(room.seats.map((s) => s.id)).size).toBe(room.seats.length);
    expect(new Set(room.seats.map((s) => `${s.cell.x},${s.cell.z}`)).size).toBe(room.seats.length);
    for (const s of local) {
      expect(s.id.startsWith('h:')).toBe(true);
      expect(hobbySpotRoom(s.id)).toBe('h');
      expect(s.lx >= 0 && s.lx < HOBBY_W && s.lz >= 0 && s.lz < HOBBY_H, s.id).toBe(true);
    }
  });

  it('arredi dentro la stanza, quelli a parete sulla riga sopra, tutti della stanza', () => {
    for (const f of room.furniture) {
      expect(f.room).toBe('h');
      const lx = f.cell.x - X;
      const lz = f.cell.z - Z;
      expect(lx >= 0 && lx + f.w <= HOBBY_W, f.kind).toBe(true);
      if (WALL_DECOR.has(f.kind)) expect([lz, f.h]).toEqual([-1, 1]);
      else expect(lz >= 0 && lz + f.h <= HOBBY_H, f.kind).toBe(true);
    }
  });

  it('chi siede sta su una seduta, chi sta in piedi su una cella libera', () => {
    for (const s of local) {
      const under = cells[s.lz]![s.lx] ?? null;
      if (s.seated) expect(under !== null && SEATS.has(under), `${s.id} su ${under}`).toBe(true);
      else expect(under, s.id).toBeNull();
    }
  });

  it('porta a nord sopra la colonna 5, con il passaggio libero davanti', () => {
    expect(room.door).toEqual({ x: X + HOBBY_DOOR_X, z: Z - 1 });
    for (const lz of [0, 1]) {
      expect(cells[lz]![HOBBY_DOOR_X]).toBeNull();
      expect(local.some((s) => s.lx === HOBBY_DOOR_X && s.lz === lz)).toBe(false);
    }
  });

  it('ogni posto si raggiunge dalla porta senza attraversare arredi né altri posti', () => {
    const seen = reachable(kind);
    for (const s of local) {
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen[s.lz + dz!]?.[s.lx + dx!]);
      expect(near, s.id).toBe(true);
    }
  });

  it('pura: stessi dati a ogni chiamata, traslati con la stanza', () => {
    expect(hobbyRoom(kind, 'h', X, Z)).toEqual(room);
    const moved = hobbyRoom(kind, 'h', X + 12, Z + 1);
    expect(moved.seats.map((s) => [s.cell.x - 12, s.cell.z - 1])).toEqual(room.seats.map((s) => [s.cell.x, s.cell.z]));
    expect(moved.furniture.map((f) => [f.cell.x - 12, f.cell.z - 1])).toEqual(room.furniture.map((f) => [f.cell.x, f.cell.z]));
  });
});

describe('sale hobby', () => {
  it('relax è la sala relax di oggi: stessi arredi, posti e ordine', () => {
    const plan = createPlan();
    const lounge = plan.rooms.find((r) => r.kind === 'lounge')!;
    const relax = hobbyRoom('relax', 'lounge', lounge.x, lounge.z);
    expect(relax.furniture).toEqual(plan.furniture.filter((f) => f.room === 'lounge'));
    expect(relax.seats).toEqual(lounge.seats);
    expect(relax.door).toEqual(lounge.door);
    expect(relax.seats).toHaveLength(22);
  });

  it('console: giocatori seduti davanti alle TV, prima dei posti per chi guarda', () => {
    const { seats, furniture } = hobbyRoom('console', 'c', 0, 0);
    const pads = seats.filter(isConsoleSpot);
    expect(pads.length).toBeGreaterThanOrEqual(8);
    expect(seats.slice(0, pads.length)).toEqual(pads);
    expect(pads.every((s) => s.seated && s.facing === 'up')).toBe(true);
    const tvs = furniture.filter((f) => f.kind === 'tv');
    expect(tvs).toHaveLength(2);
    // ogni giocatore ha una TV a nord, nelle sue colonne
    for (const s of pads) expect(tvs.some((t) => t.cell.z < s.cell.z && s.cell.x >= t.cell.x && s.cell.x < t.cell.x + t.w), s.id).toBe(true);
  });

  it('ping-pong: due giocatori in piedi ai lati corti del tavolo, che si fronteggiano', () => {
    const { seats, furniture } = hobbyRoom('pingpong', 'p', 0, 0);
    const players = seats.filter(isPingPongSpot);
    expect(players).toHaveLength(2);
    expect(seats.slice(0, 2)).toEqual(players);
    const table = furniture.find((f) => f.kind === 'pingpong')!;
    const [west, east] = players;
    expect(west!.seated || east!.seated).toBe(false);
    expect([west!.cell.x, west!.facing]).toEqual([table.cell.x - 1, 'right']);
    expect([east!.cell.x, east!.facing]).toEqual([table.cell.x + table.w, 'left']);
    for (const p of players) expect(p.cell.z >= table.cell.z && p.cell.z < table.cell.z + table.h).toBe(true);
    expect(seats.some(isFoosballSpot)).toBe(false);
  });

  it('hobbySpotRoom: la stanza solo per i posti delle sale hobby', () => {
    expect(hobbySpotRoom('console-2:pad-3')).toBe('console-2');
    expect(hobbySpotRoom('foos-0')).toBeNull();
    expect(hobbySpotRoom('r0-desk-1')).toBeNull();
  });
});
