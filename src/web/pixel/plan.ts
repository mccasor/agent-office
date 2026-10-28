import {
  DEFAULT_OFFICE_ROOMS, isHobby, officeKey, parseOfficeRooms, type HobbyKind, type OfficeRoom, type WorkRoomType,
} from '../../shared/office';
import { FLOOR_LEGEND, WALL_LEGEND, WORK_LAYOUTS, WORK_SIZES, type WorkLayout } from './rooms';
import {
  WALL_DECOR,
  type Cell,
  type Facing,
  type Furniture,
  type FurnitureKind,
  type PixelPlan,
  type Room,
  type Spot,
  type TileKind,
} from './types';

/**
 * Pianta a composizione (#108): corridoio orizzontale al centro con l'ingresso a ovest, stanze sopra e sotto. Le
 * stanze di lavoro (larghe 7, 11 o 15, piante in rooms.ts) riempiono la fila sopra e poi quella sotto; le sale hobby
 * stanno sempre sotto, in fondo a destra. Ogni stanza ha una riga di parete a nord (la faccia visibile) e la porta sul
 * corridoio; le stanze di lavoro sotto sono quelle di sopra specchiate (porta a nord, boss a sud), le sale hobby
 * hanno già la porta a nord. Il corridoio è lungo quanto la fila più lunga.
 */
const ROOM_H = 8;
const CORRIDOR_H = 3;
const TOP_Z = 1;
const CORRIDOR_Z = TOP_Z + ROOM_H + 1;
const BOTTOM_Z = CORRIDOR_Z + CORRIDOR_H + 1;
const DEPTH = BOTTOM_Z + ROOM_H + 1;
/** sale hobby: larghezza e colonna della porta */
const HOBBY_W = 11;
const HOBBY_DOOR = 5;
/** tinta di pavimento e pareti delle sale hobby (le stanze di lavoro hanno quella della pianta, 0-4) */
const HOBBY_STYLE = 5;

const FLIP: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'left', right: 'right' };

/** Coordinate locali di una stanza (lz = 0 sul lato del boss) -> pianta; le stanze sotto sono specchiate. */
class RoomBuilder {
  readonly furniture: Furniture[] = [];
  constructor(
    readonly id: string,
    readonly x: number,
    readonly z: number,
    readonly mirrored: boolean,
    readonly doorX: number,
  ) {}

  cell(lx: number, lz: number, h = 1): Cell {
    return { x: this.x + lx, z: this.mirrored ? this.z + ROOM_H - lz - h : this.z + lz };
  }

  facing(f: Facing): Facing {
    return this.mirrored ? FLIP[f] : f;
  }

  place(kind: FurnitureKind, lx: number, lz: number, w: number, h: number, facing: Facing, variant = 0): void {
    this.furniture.push({ kind, cell: this.cell(lx, lz, h), w, h, facing: this.facing(facing), room: this.id, variant });
  }

  /** arredo sulla parete nord (finestre, quadri, orologio, bacheca): non specchiato */
  wall(kind: FurnitureKind, lx: number, w: number, variant = 0): void {
    this.furniture.push({ kind, cell: { x: this.x + lx, z: this.z - 1 }, w, h: 1, facing: 'down', room: this.id, variant });
  }

  spot(id: string, lx: number, lz: number, facing: Facing, seated: boolean): Spot {
    return { id, cell: this.cell(lx, lz), facing: this.facing(facing), seated };
  }

  /** sul corridoio: a sud per le stanze sopra, a nord per quelle sotto */
  get door(): Cell {
    return this.z > CORRIDOR_Z ? { x: this.x + this.doorX, z: this.z - 1 } : { x: this.x + this.doorX, z: this.z + ROOM_H };
  }
}

/** Rettangoli di caratteri uguali di una mappa ASCII ('.' vuoto), da nord-ovest; `single` sono sempre celle singole. */
function* runs(rows: readonly string[], single = ''): Generator<{ ch: string; lx: number; lz: number; w: number; h: number }> {
  const seen = rows.map((row) => [...row].map(() => false));
  for (const [lz, row] of rows.entries()) {
    for (let lx = 0; lx < row.length; lx++) {
      const ch = row[lx]!;
      if (ch === '.' || seen[lz]![lx]) continue;
      let w = 1;
      let h = 1;
      if (!single.includes(ch)) {
        while (row[lx + w] === ch && !seen[lz]![lx + w]) w++;
        while (rows[lz + h]?.slice(lx, lx + w) === ch.repeat(w)) h++;
      }
      for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) seen[lz + dz]![lx + dx] = true;
      yield { ch, lx, lz, w, h };
    }
  }
}

const SEATS = new Set<FurnitureKind>(['sofa', 'armchair']);

/**
 * Stanza di lavoro dalla sua pianta (rooms.ts). Gli arredi a parete guardano la stanza (lavagne e librerie sui lati),
 * gli altri verso il basso dello schermo anche nelle stanze specchiate; divani e poltrone verso il tavolino.
 */
function workRoom(n: number, type: WorkRoomType, layout: WorkLayout, x: number, z: number, mirrored: boolean): { room: Room; furniture: Furniture[] } {
  const { w, door } = WORK_SIZES[type];
  const b = new RoomBuilder(`room-${n}`, x, z, mirrored, door);
  for (const r of runs([layout.wall])) {
    const painting = /\d/.test(r.ch);
    b.wall(painting ? 'painting' : WALL_LEGEND[r.ch]!, r.lx, r.w, painting ? Number(r.ch) : 0);
  }

  const grid = layout.floor;
  let boss: Spot | null = null;
  const chairs: { lx: number; lz: number; facing: Facing }[] = [];
  for (const r of runs(grid, 'bhm')) {
    const { ch, lx, lz } = r;
    if (ch === 'b') {
      b.place('chair', lx, lz, 1, 1, 'down');
      boss = b.spot(`r${n}-boss`, lx, lz, 'down', true);
    } else if (ch === 'h') {
      // la sedia guarda la sua scrivania, sopra o sotto
      chairs.push({ lx, lz, facing: grid[lz - 1]?.[lx] === 'm' ? 'up' : 'down' });
    } else if (ch === 'm') {
      const toward: Facing = grid[lz + 1]?.[lx] === 'h' ? 'down' : 'up';
      b.place('desk', lx, lz, 1, 1, toward);
      b.place('monitor', lx, lz, 1, 1, toward);
    } else {
      const kind = FLOOR_LEGEND[ch];
      if (!kind) throw new Error(`pianta ${layout.name}: '${ch}' non è nella legenda`);
      if (kind === 'boss-desk') {
        b.place(kind, lx, lz, r.w, r.h, 'up');
        continue;
      }
      const variant = kind === 'rug' ? (layout.rug ?? 0) : 0;
      if (SEATS.has(kind)) {
        const table = (dx: number, dz: number) => grid[lz + dz]?.[lx + dx] === 't';
        const local: Facing = table(0, r.h) ? 'down' : table(0, -1) ? 'up' : table(r.w, 0) ? 'right' : 'left';
        b.place(kind, lx, lz, r.w, r.h, local, variant);
        continue;
      }
      // in pianta, non specchiato: sui lati verso l'interno, altrimenti verso chi guarda
      const side = r.h >= r.w && lz > 0 && lz + r.h < ROOM_H;
      const facing: Facing = side && lx === 0 ? 'right' : side && lx + r.w === w ? 'left' : 'down';
      b.furniture.push({ kind, cell: b.cell(lx, lz, r.h), w: r.w, h: r.h, facing, room: b.id, variant });
    }
  }
  if (!boss) throw new Error(`pianta ${layout.name}: manca il boss`);

  // prima le sedie davanti (verso la porta, guardano su), poi quelle dietro verso il boss
  chairs.sort((p, q) => (p.facing === q.facing ? q.lz - p.lz || p.lx - q.lx : p.facing === 'up' ? -1 : 1));
  const desks = chairs.map((c, i) => {
    b.place('chair', c.lx, c.lz, 1, 1, c.facing);
    return b.spot(`r${n}-desk-${i}`, c.lx, c.lz, c.facing, true);
  });
  return {
    room: { id: b.id, kind: 'instance', x, z, w, h: ROOM_H, door: b.door, desks, boss, seats: [] },
    furniture: b.furniture,
  };
}

/**
 * Sala relax (porta a nord sopra la colonna 5): in alto i cabinati, il distributore di snack, il frigo e il caffè; a
 * sinistra divani e poltrone attorno al tavolino, a destra il biliardino con i giocatori ai lati lunghi.
 *
 *   ...wp.p....   parete: w finestra, p poster
 *   TAA...bVFKP   lz 0: T pianta alta, A cabinati, b cestino, V distributore, F frigo, K caffè, P pianta
 *   .ss....sss.   lz 1: in piedi davanti a cabinati, distributore, frigo e caffè
 *   ...........   lz 2: passaggio
 *   BrSSSr.gg..   lz 3: B libreria, r tappeto, S divano, g giocatori a nord
 *   Bc###c.==..   lz 4: c poltrone, # tavolino, = biliardino
 *   Bc###c.gg..   lz 5: giocatori a sud
 *   lrSSSr...sW   lz 6: l lampada, W boccione dell'acqua
 *   P.....ss..C   lz 7: due in piedi che chiacchierano, C cactus
 */
function loungeRoom(x: number, z: number): { room: Room; furniture: Furniture[] } {
  // già con la porta a nord: coordinate locali non specchiate
  const b = new RoomBuilder('lounge', x, z, false, HOBBY_DOOR);
  b.wall('window', 3, 1);
  b.wall('poster', 4, 1, 1);
  b.wall('poster', 6, 1, 0);
  b.place('rug', 1, 3, 5, 4, 'down', 0);
  b.place('plant-tall', 0, 0, 1, 1, 'down');
  b.place('arcade', 1, 0, 1, 1, 'down', 0);
  b.place('arcade', 2, 0, 1, 1, 'down', 1);
  b.place('bin', 6, 0, 1, 1, 'down');
  b.place('vending', 7, 0, 1, 1, 'down');
  b.place('fridge', 8, 0, 1, 1, 'down');
  b.place('coffee-machine', 9, 0, 1, 1, 'down');
  b.place('plant', 10, 0, 1, 1, 'down');
  b.place('bookshelf', 0, 3, 1, 3, 'right');
  b.place('coffee-table', 2, 4, 3, 2, 'down');
  b.place('sofa', 2, 3, 3, 1, 'down');
  b.place('sofa', 2, 6, 3, 1, 'up');
  b.place('armchair', 1, 4, 1, 1, 'right');
  b.place('armchair', 1, 5, 1, 1, 'right');
  b.place('armchair', 5, 4, 1, 1, 'left');
  b.place('armchair', 5, 5, 1, 1, 'left');
  b.place('foosball', 7, 4, 2, 1, 'down');
  b.place('water-cooler', 10, 6, 1, 1, 'left');
  b.place('floor-lamp', 0, 6, 1, 1, 'down');
  b.place('plant', 0, 7, 1, 1, 'down');
  b.place('cactus', 10, 7, 1, 1, 'down');

  // biliardino: prima uno per lato (si gioca uno contro uno), poi gli altri due
  const foosball: [number, number, Facing][] = [[7, 3, 'down'], [8, 5, 'up'], [8, 3, 'down'], [7, 5, 'up']];
  const seated: [number, number, Facing][] = [
    [2, 3, 'down'], [3, 3, 'down'], [4, 3, 'down'],
    [2, 6, 'up'], [3, 6, 'up'], [4, 6, 'up'],
    [1, 4, 'right'], [1, 5, 'right'], [5, 4, 'left'], [5, 5, 'left'],
  ];
  const standing: [number, number, Facing][] = [
    [1, 1, 'up'], [2, 1, 'up'], [7, 1, 'up'], [8, 1, 'up'], [9, 1, 'up'],
    [9, 6, 'right'], [6, 7, 'right'], [7, 7, 'left'],
  ];
  const seats = [
    ...foosball.map(([lx, lz, f], i) => b.spot(`foos-${i}`, lx, lz, f, false)),
    ...seated.map(([lx, lz, f], i) => b.spot(`lounge-${i}`, lx, lz, f, true)),
    ...standing.map(([lx, lz, f], i) => b.spot(`stand-${i}`, lx, lz, f, false)),
  ];
  return {
    room: { id: b.id, kind: 'lounge', x, z, w: HOBBY_W, h: ROOM_H, door: b.door, desks: [], boss: null, seats },
    furniture: b.furniture,
  };
}

/**
 * Sala hobby `kind` con l'angolo nord-ovest dell'interno in (x, z): 11×8, porta a nord sopra la colonna 5, posti in
 * `seats` nell'ordine in cui si occupano. Id della stanza e dei posti come la sala relax: build li rende unici.
 */
export function hobbyRoom(kind: HobbyKind, x: number, z: number): { room: Room; furniture: Furniture[] } {
  switch (kind) {
    case 'relax':
      return loungeRoom(x, z);
    // parte B (#108): sale console e ping-pong da hobby.ts; per ora ripiegano sulla sala relax
    case 'console':
    case 'pingpong':
      return loungeRoom(x, z);
  }
}

/** arredi che non bloccano il passaggio: tappeti e quelli appesi alle pareti */
const PASSABLE = new Set<FurnitureKind>(['rug', ...WALL_DECOR]);

type Slot = { kind: 'work'; type: WorkRoomType; layout: WorkLayout } | { kind: 'hobby'; type: HobbyKind };

/**
 * Piante delle stanze di lavoro: lo stile scelto, oppure a rotazione per taglia tra quelli che nessun'altra stanza
 * della stessa taglia ha scelto (tutti, se li hanno scelti tutti).
 */
function layoutsOf(rooms: readonly OfficeRoom[]): Slot[] {
  const auto: Partial<Record<WorkRoomType, number>> = {};
  return rooms.map((r): Slot => {
    if (isHobby(r.type)) return { kind: 'hobby', type: r.type };
    const type = r.type;
    const all = WORK_LAYOUTS[type];
    if (r.variant !== null) return { kind: 'work', type, layout: all[r.variant - 1]! };
    const chosen = new Set(rooms.filter((o) => o.type === type && o.variant !== null).map((o) => o.variant! - 1));
    const free = all.filter((_, i) => !chosen.has(i));
    const pool = free.length > 0 ? free : all;
    const k = auto[type] ?? 0;
    auto[type] = k + 1;
    return { kind: 'work', type, layout: pool[k % pool.length]! };
  });
}

/** Posti in piedi lungo le pareti del corridoio, lontano dalle porte; la riga centrale resta libera. */
function hallSpots(width: number, topDoors: number[], bottomDoors: number[]): Spot[] {
  const pick = (from: number, to: number, gap: number, doors: number[]) => {
    const xs: number[] = [];
    for (let x = from; x <= to; x++) if (x % 2 === 0 && doors.every((d) => Math.abs(x - d) > gap)) xs.push(x);
    return xs;
  };
  // lontano dalle porte e dalle piante in fondo; in un corridoio corto ci si accontenta di non stare davanti alle porte
  let top = pick(4, width - 4, 3, topDoors);
  let bottom = pick(4, width - 4, 3, bottomDoors);
  if (top.length + bottom.length < 8) {
    top = pick(2, width - 3, 1, topDoors);
    bottom = pick(2, width - 3, 1, bottomDoors);
  }
  const cells = [
    ...top.map((x) => ({ x, z: CORRIDOR_Z, facing: 'down' as const })),
    ...bottom.map((x) => ({ x, z: CORRIDOR_Z + CORRIDOR_H - 1, facing: 'up' as const })),
  ].sort((a, b) => a.x - b.x || a.z - b.z);
  return cells.map((c, i) => ({ id: `hall-${i}`, cell: { x: c.x, z: c.z }, facing: c.facing, seated: false }));
}

function build(composition: readonly OfficeRoom[]): PixelPlan {
  const slots = layoutsOf(composition);
  const work = slots.filter((s) => s.kind === 'work');
  const hobby = slots.filter((s) => s.kind === 'hobby');
  // lavoro prima sopra, poi sotto; sotto in fondo le sale hobby
  const topCount = Math.min(work.length, Math.ceil(slots.length / 2));
  const rows = [work.slice(0, topCount), [...work.slice(topCount), ...hobby]];
  const widthOf = (s: Slot) => (s.kind === 'work' ? WORK_SIZES[s.type].w : HOBBY_W);
  const width = Math.max(...rows.map((row) => row.reduce((n, s) => n + widthOf(s) + 1, 1)));

  const tiles: TileKind[][] = Array.from({ length: DEPTH }, () => Array<TileKind>(width).fill('void'));
  const styles: number[][] = Array.from({ length: DEPTH }, () => Array<number>(width).fill(-1));
  const fill = (x: number, z: number, w: number, h: number, kind: TileKind) => {
    for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) tiles[z + dz]![x + dx] = kind;
  };

  const built: { room: Room; furniture: Furniture[]; style: number }[] = [];
  let n = 0;
  let h = 0;
  for (const [i, row] of rows.entries()) {
    let x = 1;
    const z = i === 0 ? TOP_Z : BOTTOM_Z;
    for (const s of row) {
      if (s.kind === 'work') {
        built.push({ ...workRoom(n++, s.type, s.layout, x, z, i === 1), style: s.layout.style });
      } else {
        // la prima sala tiene gli id di sempre, le altre li prendono con un prefisso
        const { room, furniture } = hobbyRoom(s.type, x, z);
        const id = h === 0 ? room.id : `${room.id}-${h}`;
        const prefix = h === 0 ? '' : `h${h}-`;
        built.push({
          room: { ...room, id, hobby: s.type, seats: room.seats.map((p) => ({ ...p, id: prefix + p.id })) },
          furniture: furniture.map((f) => ({ ...f, room: id })),
          style: HOBBY_STYLE,
        });
        h++;
      }
      x += widthOf(s) + 1;
    }
  }
  const rooms = built.map((r) => r.room);
  const furniture = built.flatMap((r) => r.furniture);
  for (const r of rooms) fill(r.x - 1, r.z - 1, r.w + 2, r.h + 2, 'wall');
  fill(0, CORRIDOR_Z - 1, width, CORRIDOR_H + 2, 'wall');
  for (const { room: r, style } of built) {
    fill(r.x, r.z, r.w, r.h, r.kind === 'lounge' ? 'lounge' : 'floor');
    // tinta della stanza sul pavimento e sulla parete nord, quella che si vede da dentro
    for (let dz = -1; dz < r.h; dz++) for (let dx = 0; dx < r.w; dx++) styles[r.z + dz]![r.x + dx] = style;
  }
  fill(1, CORRIDOR_Z, width - 2, CORRIDOR_H, 'corridor');
  for (const r of rooms) fill(r.door.x, r.door.z, 1, 1, 'door');
  const entrance = { x: 0, z: CORRIDOR_Z + 1 };
  fill(entrance.x, entrance.z, 1, 1, 'door');

  // corridoio: piante alle estremità, posti in piedi lungo le pareti lontano dalle porte
  for (const [px, pz] of [[1, CORRIDOR_Z], [1, CORRIDOR_Z + 2], [width - 2, CORRIDOR_Z], [width - 2, CORRIDOR_Z + 2]] as const) {
    furniture.push({ kind: 'plant', cell: { x: px, z: pz }, w: 1, h: 1, facing: 'down', room: null });
  }
  const doorsAt = (z: number) => rooms.filter((r) => r.door.z === z).map((r) => r.door.x);
  const overflow = hallSpots(width, doorsAt(CORRIDOR_Z - 1), doorsAt(CORRIDOR_Z + CORRIDOR_H));

  const walkable = tiles.map((row) => row.map((t) => t !== 'wall' && t !== 'void'));
  for (const f of furniture) {
    if (PASSABLE.has(f.kind)) continue;
    for (let dz = 0; dz < f.h; dz++) for (let dx = 0; dx < f.w; dx++) walkable[f.cell.z + dz]![f.cell.x + dx] = false;
  }
  const spots = [...rooms.flatMap((r) => [...r.desks, ...(r.boss ? [r.boss] : []), ...r.seats]), ...overflow];
  for (const s of spots) walkable[s.cell.z]![s.cell.x] = true;

  return { width, depth: DEPTH, tiles, styles, walkable, rooms, furniture, entrance, overflow };
}

/** piante già costruite, per composizione: le ultime usate (si cambia composizione di rado) */
const cache = new Map<string, PixelPlan>();
const CACHE_SIZE = 8;

/**
 * La pianta della vista 2D per una composizione (#108), sempre la stessa istanza per la stessa composizione: si
 * costruisce una volta, non a ogni fotogramma. Una composizione non valida vale quella di default.
 */
export function createPlan(rooms: readonly OfficeRoom[] = DEFAULT_OFFICE_ROOMS): PixelPlan {
  const valid = parseOfficeRooms(rooms) ?? DEFAULT_OFFICE_ROOMS;
  const key = officeKey(valid);
  let plan = cache.get(key);
  if (plan) {
    // in fondo: la più usata di recente
    cache.delete(key);
  } else {
    plan = build(valid);
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, plan);
  return plan;
}
