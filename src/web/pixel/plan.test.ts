import { DEFAULT_OFFICE_ROOMS, ROOM_VARIANTS, WORK_ROOM_TYPES, type OfficeRoom, type OfficeRoomType, type WorkRoomType } from '../../shared/office';
import { findPath } from './path';
import { createPlan } from './plan';
import { FLOOR_LEGEND, WALL_LEGEND, WORK_LAYOUTS, WORK_SIZES } from './rooms';
import type { PixelPlan, Room, Spot } from './types';

const plan = createPlan();
const allSpots = (p: PixelPlan): Spot[] => [
  ...p.rooms.flatMap((r) => [...r.desks, ...(r.boss ? [r.boss] : []), ...r.seats]),
  ...p.overflow,
];
const room = (type: OfficeRoomType, variant: number | null = null): OfficeRoom => ({ type, variant });
const many = (n: number, type: OfficeRoomType) => Array.from({ length: n }, () => room(type));
const DESKS: Record<WorkRoomType, number> = { work4: 4, work8: 8, work12: 12 };

/** composizioni ai limiti: massime per taglia, miste, minime */
const COMPOSITIONS: Record<string, OfficeRoom[]> = {
  default: [...DEFAULT_OFFICE_ROOMS],
  'massima da 12': [...many(5, 'work12'), room('relax'), room('console'), room('pingpong')],
  '7 di lavoro e 1 hobby': [...many(7, 'work12'), room('relax')],
  'minima': [room('work8'), room('relax')],
  '1 di lavoro e 3 hobby': [room('work4'), room('pingpong'), room('relax'), room('console')],
  mista: [room('work4'), room('work12', 2), room('work8', 4), room('work4', 8), room('relax'), room('work12'), room('console')],
  'tutte da 4': [...many(7, 'work4'), room('relax')],
};

/** Invarianti di ogni pianta: porte, pareti, calpestabilità, posti raggiungibili. */
function checkPlan(p: PixelPlan) {
  const tile = (x: number, z: number) => p.tiles[z]?.[x];
  expect(p.tiles).toHaveLength(p.depth);
  expect(p.walkable).toHaveLength(p.depth);
  for (const row of [...p.tiles, ...p.walkable, ...p.styles]) expect(row).toHaveLength(p.width);
  // ogni stanza ha una porta sul corridoio e una riga di parete a nord
  for (const r of p.rooms) {
    expect(tile(r.door.x, r.door.z), r.id).toBe('door');
    const sides = [tile(r.door.x, r.door.z - 1), tile(r.door.x, r.door.z + 1)];
    expect(sides).toContain('corridor');
    expect(sides).toContain(r.kind === 'lounge' ? 'lounge' : 'floor');
    for (let x = r.x; x < r.x + r.w; x++) expect(['wall', 'door']).toContain(tile(x, r.z - 1));
    for (let z = r.z; z < r.z + r.h; z++) expect([tile(r.x - 1, z), tile(r.x + r.w, z)], r.id).toEqual(['wall', 'wall']);
  }
  expect(tile(p.entrance.x, p.entrance.z)).toBe('door');
  expect(p.overflow.length).toBeGreaterThanOrEqual(4);
  for (const s of p.overflow) expect(tile(s.cell.x, s.cell.z)).toBe('corridor');

  // id unici, posti su celle calpestabili e raggiungibili dall'ingresso
  const spots = allSpots(p);
  expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
  expect(new Set(spots.map((s) => `${s.cell.x},${s.cell.z}`)).size).toBe(spots.length);
  for (const s of spots) {
    expect(p.walkable[s.cell.z]![s.cell.x], s.id).toBe(true);
    expect(findPath(p, p.entrance, s.cell).length, s.id).toBeGreaterThan(0);
  }

  // pareti e arredi non sono calpestabili (sedie e divani dei posti sì), gli arredi a parete stanno sulle pareti
  const spotCells = new Set(spots.map((s) => `${s.cell.x},${s.cell.z}`));
  p.tiles.forEach((row, z) => row.forEach((t, x) => {
    if (t === 'wall' || t === 'void') expect(p.walkable[z]![x]).toBe(false);
  }));
  for (const f of p.furniture) {
    for (let dz = 0; dz < f.h; dz++) {
      for (let dx = 0; dx < f.w; dx++) {
        const x = f.cell.x + dx;
        const z = f.cell.z + dz;
        if (['window', 'painting', 'clock', 'corkboard', 'poster'].includes(f.kind)) {
          expect(p.tiles[z]![x], f.kind).toBe('wall');
          expect(['floor', 'lounge'], f.kind).toContain(p.tiles[z + 1]![x]);
        } else if (f.kind !== 'rug' && !spotCells.has(`${x},${z}`)) expect(p.walkable[z]![x], `${f.room} ${f.kind}`).toBe(false);
        if (f.room) {
          const r = p.rooms.find((o) => o.id === f.room)!;
          expect(x >= r.x && x < r.x + r.w && z >= r.z - 1 && z < r.z + r.h, `${f.kind} fuori da ${r.id}`).toBe(true);
        }
      }
    }
  }
  // tinta di pavimento e parete nord per stanza; il corridoio senza
  for (const r of p.rooms) {
    expect(p.styles[r.z]![r.x]).toBeGreaterThanOrEqual(0);
    expect(p.styles[r.z - 1]![r.x], `parete nord di ${r.id}`).toBe(p.styles[r.z]![r.x]);
  }
  expect(p.styles[p.entrance.z]![p.entrance.x + 1]).toBe(-1);
}

describe('createPlan', () => {
  it('memoizzata: stessa composizione, stessa pianta (anche da un elenco nuovo)', () => {
    expect(createPlan()).toBe(plan);
    expect(createPlan(DEFAULT_OFFICE_ROOMS.map((r) => ({ ...r })))).toBe(plan);
    const mixed = COMPOSITIONS.mista!;
    expect(createPlan(structuredClone(mixed))).toBe(createPlan(mixed));
    expect(createPlan(mixed)).not.toBe(plan);
  });

  it('composizione non valida: la pianta di default', () => {
    for (const bad of [
      [], many(8, 'work8'), [...many(5, 'work8'), ...many(4, 'relax')], [...many(7, 'work8'), room('relax'), room('relax')],
      many(2, 'relax'), [room('work8', 5), room('relax')], [room('work4', 0), room('relax')], [room('relax', 2), room('work8')],
    ]) {
      expect(createPlan(bad)).toBe(plan);
    }
  });

  it('default: 5 stanze istanza da 8 postazioni e la sala relax, come sempre', () => {
    expect(plan.rooms.map((r) => r.id)).toEqual(['room-0', 'room-1', 'room-2', 'room-3', 'room-4', 'lounge']);
    expect(plan.width).toBe(37);
    for (const [n, r] of plan.rooms.slice(0, 5).entries()) {
      expect(r.kind).toBe('instance');
      expect(r.desks.map((d) => d.id)).toEqual(Array.from({ length: 8 }, (_, i) => `r${n}-desk-${i}`));
      expect(r.boss?.id).toBe(`r${n}-boss`);
      expect(r.seats).toEqual([]);
    }
    // tre sopra, due sotto (specchiate) e la sala relax in fondo a destra
    expect(plan.rooms.map((r) => [r.x, r.z])).toEqual([[1, 1], [13, 1], [25, 1], [1, 14], [13, 14], [25, 14]]);
    const lounge = plan.rooms[5]!;
    expect(lounge).toMatchObject({ kind: 'lounge', hobby: 'relax', boss: null });
    expect(lounge.seats.length).toBeGreaterThanOrEqual(20);
    // prima il biliardino, poi i posti a sedere, infine quelli in piedi
    const ids = lounge.seats.map((s) => s.id);
    const kind = (id: string) => id.replace(/-\d+$/, '');
    expect([...new Set(ids.map(kind))]).toEqual(['foos', 'lounge', 'stand']);
    expect(lounge.seats.every((s) => s.seated === s.id.startsWith('lounge-'))).toBe(true);
    // stili a rotazione: le prime quattro diverse, la quinta riprende la prima
    expect(plan.rooms.map((r) => plan.styles[r.z]![r.x])).toEqual([0, 1, 2, 3, 0, 5]);
    expect(plan.overflow.map((s) => s.cell.x)).toEqual([10, 10, 12, 12, 14, 14, 22, 22, 24, 24, 26, 26]);
  });

  for (const [name, rooms] of Object.entries(COMPOSITIONS)) {
    it(`composizione ${name}: porte, pareti, passaggi e posti raggiungibili`, () => {
      const p = createPlan(rooms);
      checkPlan(p);
      const work = rooms.filter((r) => r.type.startsWith('work'));
      const instance = p.rooms.filter((r) => r.kind === 'instance');
      expect(instance.map((r) => r.id)).toEqual(work.map((_, i) => `room-${i}`));
      // le postazioni della taglia, nell'ordine della composizione
      expect(instance.map((r) => r.desks.length)).toEqual(work.map((r) => DESKS[r.type as WorkRoomType]));
      expect(p.rooms.filter((r) => r.kind === 'lounge').map((r) => r.hobby)).toEqual(rooms.filter((r) => !r.type.startsWith('work')).map((r) => r.type));
    });
  }

  it('sale hobby sempre sotto, porta a nord, in fondo a destra; il corridoio prende la fila più lunga', () => {
    for (const rooms of Object.values(COMPOSITIONS)) {
      const p = createPlan(rooms);
      const corridor = p.entrance.z;
      const halls = p.rooms.filter((r) => r.kind === 'lounge');
      const bottom = p.rooms.filter((r) => r.z > corridor);
      expect(halls.every((r) => r.z > corridor && r.door.z === r.z - 1)).toBe(true);
      // dopo tutte le stanze di lavoro della fila sotto
      expect(bottom.slice(-halls.length)).toEqual(halls);
      // corridoio fino all'ultima stanza della fila più lunga, più la parete
      const end = Math.max(...p.rooms.map((r) => r.x + r.w));
      expect(p.width).toBe(end + 1);
      expect(p.tiles[corridor]![p.width - 2]).toBe('corridor');
    }
    const max = createPlan(COMPOSITIONS['massima da 12']!);
    expect(max.rooms.map((r) => r.id)).toEqual(['room-0', 'room-1', 'room-2', 'room-3', 'room-4', 'lounge', 'lounge-1', 'lounge-2']);
    expect(max.rooms[6]!.seats[0]!.id).toBe('h1-foos-0');
    expect(max.furniture.filter((f) => f.room === 'lounge-2').length).toBe(max.furniture.filter((f) => f.room === 'lounge').length);
  });

  it('stile automatico: a rotazione per taglia, saltando quelli scelti da altre stanze', () => {
    const p = createPlan([room('work8', 2), room('work8'), room('work8'), room('work8'), room('relax')]);
    const signature = (r: Room) => p.furniture.filter((f) => f.room === r.id && f.kind !== 'window').map((f) => `${f.kind}:${f.cell.x - r.x}`).sort().join();
    const [chosen, ...auto] = p.rooms.slice(0, 4).map(signature);
    expect(new Set(auto).size).toBe(3);
    expect(auto).not.toContain(chosen);
  });
});

describe('piante di lavoro (#108)', () => {
  it('8 piante da 4 postazioni, 4 da 8, 4 da 12, quante ne offrono le Impostazioni', () => {
    expect(Object.fromEntries(WORK_ROOM_TYPES.map((t) => [t, WORK_LAYOUTS[t].length]))).toEqual({ work4: 8, work8: 4, work12: 4 });
    for (const t of WORK_ROOM_TYPES) expect(ROOM_VARIANTS[t]).toBe(WORK_LAYOUTS[t].length);
  });

  for (const type of WORK_ROOM_TYPES) {
    const { w, door, passages } = WORK_SIZES[type];
    for (const [i, layout] of WORK_LAYOUTS[type].entries()) {
      it(`${type} stile ${i + 1} (${layout.name}): postazioni, boss, porta e passaggi, anche specchiata`, () => {
        // mappa ben formata: larghezza della taglia, lettere della legenda, niente quadri sopra la porta
        expect(layout.floor).toHaveLength(8);
        for (const row of [layout.wall, ...layout.floor, ...passages]) expect(row).toHaveLength(w);
        for (const ch of layout.wall.replace(/[.\d]/g, '')) expect(Object.keys(WALL_LEGEND)).toContain(ch);
        for (const ch of layout.floor.join('').replace(/[.bhm]/g, '')) expect(Object.keys(FLOOR_LEGEND)).toContain(ch);
        expect(layout.wall[door]).toBe('.');
        expect(layout.floor[0]![door]).toBe('b');

        // tre stanze uguali: due sopra, la terza sotto (specchiata)
        const p = createPlan([room(type, i + 1), room(type, i + 1), room(type, i + 1), room('relax')]);
        checkPlan(p);
        for (const r of p.rooms.slice(0, 3)) {
          const mirrored = r.z > p.entrance.z;
          const at = (lx: number, lz: number) => ({ x: r.x + lx, z: mirrored ? r.z + 7 - lz : r.z + lz });
          expect(r.desks).toHaveLength(DESKS[type]);
          expect(r.door.x - r.x).toBe(door);
          expect(r.boss!.cell).toEqual(at(door, 0));
          // passaggi liberi (un tappeto non conta)
          passages.forEach((row, lz) => [...row].forEach((c, lx) => {
            if (c === 'x') expect(p.walkable[at(lx, lz).z]![at(lx, lz).x], `${r.id} passaggio ${lx},${lz}`).toBe(true);
          }));
          // prima le postazioni davanti (verso la porta, guardano il boss), poi quelle dietro
          const half = DESKS[type] / 2;
          const toward = mirrored ? 'down' : 'up';
          expect(r.desks.slice(0, half).every((d) => d.facing === toward), r.id).toBe(true);
          expect(r.desks.slice(half).every((d) => d.facing !== toward), r.id).toBe(true);
          const near = (s: Spot) => Math.abs(s.cell.z - r.door.z);
          expect(Math.max(...r.desks.slice(0, half).map(near))).toBeLessThan(Math.min(...r.desks.slice(half).map(near)));
          // non troppo affollata: almeno metà della stanza resta calpestabile
          let free = 0;
          for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) if (p.walkable[z]![x]) free++;
          expect(free, r.id).toBeGreaterThanOrEqual((r.w * r.h) / 2);
          const minor = p.furniture.filter((f) => f.room === r.id && !['desk', 'boss-desk', 'chair', 'monitor', 'window'].includes(f.kind));
          expect(minor.length, r.id).toBeGreaterThanOrEqual(6);
        }
      });
    }
  }

  it('piante della stessa taglia diverse tra loro', () => {
    for (const type of WORK_ROOM_TYPES) {
      const signatures = WORK_LAYOUTS[type].map((l) => `${l.wall}|${l.floor.join('|')}`);
      expect(new Set(signatures).size, type).toBe(signatures.length);
    }
  });
});

describe('arredi (#89)', () => {
  const inside = (f: { cell: { x: number; z: number }; w: number; h: number }, c: { x: number; z: number }) =>
    c.x >= f.cell.x && c.x < f.cell.x + f.w && c.z >= f.cell.z && c.z < f.cell.z + f.h;
  const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

  it('biliardino in sala relax con 2-4 giocatori in piedi ai lati lunghi, rivolti verso il tavolo', () => {
    const lounge = plan.rooms.find((r) => r.kind === 'lounge')!;
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

  it('stanze istanza del default con arredi e tinte: scrivanie, boss, lavagna, finestre, piante', () => {
    for (const r of plan.rooms.slice(0, 5)) {
      const kinds = plan.furniture.filter((f) => f.room === r.id).map((f) => f.kind);
      expect(kinds.filter((k) => k === 'desk')).toHaveLength(8);
      expect(kinds).toEqual(expect.arrayContaining(['boss-desk', 'whiteboard', 'window', 'plant', 'monitor', 'chair']));
    }
  });

  it('arredi a parete sui lati guardano dentro la stanza, librerie e armadi in fila verso chi guarda', () => {
    for (const p of Object.values(COMPOSITIONS).map((c) => createPlan(c))) {
      for (const f of p.furniture.filter((o) => o.kind === 'whiteboard' || (o.kind === 'bookshelf' && o.h > o.w))) {
        const r = p.rooms.find((o) => o.id === f.room)!;
        expect(f.facing, `${r.id} ${f.kind}`).toBe(f.cell.x === r.x ? 'right' : 'left');
      }
      for (const f of p.furniture.filter((o) => ['locker', 'cabinet', 'printer'].includes(o.kind))) expect(f.facing).not.toBe('up');
    }
  });
});
