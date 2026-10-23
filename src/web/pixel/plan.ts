import {
  INSTANCE_ROOMS,
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
 * Pianta fissa: corridoio orizzontale al centro con l'ingresso a ovest, tre stanze sopra (room-0..2) e tre sotto
 * (room-3, room-4 e la sala relax). Ogni stanza ha una riga di parete a nord (la faccia visibile) e la porta sul
 * corridoio; le stanze sotto sono le stesse di sopra specchiate (porta a nord, boss a sud).
 */
const ROOM_W = 11;
const ROOM_H = 8;
const CORRIDOR_H = 3;
const WIDTH = 3 * (ROOM_W + 1) + 1;
const TOP_Z = 1;
const CORRIDOR_Z = TOP_Z + ROOM_H + 1;
const BOTTOM_Z = CORRIDOR_Z + CORRIDOR_H + 1;
const DEPTH = BOTTOM_Z + ROOM_H + 1;
/** colonna della porta dentro la stanza */
const DOOR_X = 5;

const FLIP: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'left', right: 'right' };

/** Coordinate locali di una stanza (lz = 0 sul lato del boss) -> pianta; le stanze sotto sono specchiate. */
class RoomBuilder {
  readonly furniture: Furniture[] = [];
  constructor(
    readonly id: string,
    readonly x: number,
    readonly z: number,
    readonly mirrored: boolean,
  ) {}

  cell(lx: number, lz: number, h = 1): Cell {
    return { x: this.x + lx, z: this.mirrored ? this.z + ROOM_H - lz - h : this.z + lz };
  }

  facing(f: Facing): Facing {
    return this.mirrored ? FLIP[f] : f;
  }

  place(kind: FurnitureKind, lx: number, lz: number, w: number, h: number, facing: Facing): void {
    this.furniture.push({ kind, cell: this.cell(lx, lz, h), w, h, facing: this.facing(facing), room: this.id });
  }

  /** arredo sulla parete nord (finestre): non specchiato */
  wall(kind: FurnitureKind, lx: number, w: number): void {
    this.furniture.push({ kind, cell: { x: this.x + lx, z: this.z - 1 }, w, h: 1, facing: 'down', room: this.id });
  }

  spot(id: string, lx: number, lz: number, facing: Facing, seated: boolean): Spot {
    return { id, cell: this.cell(lx, lz), facing: this.facing(facing), seated };
  }

  /** sul corridoio: a sud per le stanze sopra, a nord per quelle sotto */
  get door(): Cell {
    return this.z > CORRIDOR_Z ? { x: this.x + DOOR_X, z: this.z - 1 } : { x: this.x + DOOR_X, z: this.z + ROOM_H };
  }
}

const slot = (i: number) => ({ x: 1 + (i % 3) * (ROOM_W + 1), z: i < 3 ? TOP_Z : BOTTOM_Z, mirrored: i >= 3 });

/** Stanza istanza: scrivania del boss in fondo, due isole da 4 postazioni affacciate, aisle centrale fino alla porta. */
function instanceRoom(n: number): { room: Room; furniture: Furniture[] } {
  const { x, z, mirrored } = slot(n);
  const b = new RoomBuilder(`room-${n}`, x, z, mirrored);
  b.wall('window', 1, 2);
  b.wall('window', 8, 2);
  for (const [px, pz] of [[0, 0], [10, 0], [0, 7], [10, 7]] as const) b.place('plant', px, pz, 1, 1, 'down');
  b.place('whiteboard', 0, 3, 1, 2, 'right');

  b.place('boss-desk', 4, 1, 3, 1, 'up');
  b.place('chair', 5, 0, 1, 1, 'down');
  const boss = b.spot(`r${n}-boss`, 5, 0, 'down', true);

  // isole: sedie in alto che guardano giù, poi le sedie in basso che guardano su
  const desks: Spot[] = [];
  for (const [chairZ, deskZ, facing] of [[3, 4, 'down'], [6, 5, 'up']] as const) {
    for (const lx of [2, 3, 7, 8]) {
      const toward: Facing = facing === 'down' ? 'up' : 'down';
      b.place('desk', lx, deskZ, 1, 1, toward);
      b.place('monitor', lx, deskZ, 1, 1, toward);
      b.place('chair', lx, chairZ, 1, 1, facing);
      desks.push(b.spot(`r${n}-desk-${desks.length}`, lx, chairZ, facing, true));
    }
  }
  return {
    room: { id: b.id, kind: 'instance', x, z, w: ROOM_W, h: ROOM_H, door: b.door, desks, boss, seats: [] },
    furniture: b.furniture,
  };
}

/** Sala relax (sotto a destra, porta a nord): divani e poltrone attorno al tavolino, angolo caffè, libreria. */
function loungeRoom(): { room: Room; furniture: Furniture[] } {
  const { x, z } = slot(5);
  // già con la porta a nord: coordinate locali non specchiate
  const b = new RoomBuilder('lounge', x, z, false);
  b.wall('window', 1, 2);
  b.wall('window', 8, 2);
  b.place('rug', 2, 1, 7, 6, 'down');
  for (const [px, pz] of [[0, 0], [10, 0], [0, 7], [10, 7]] as const) b.place('plant', px, pz, 1, 1, 'down');
  b.place('bookshelf', 0, 2, 1, 3, 'right');
  b.place('coffee-machine', 10, 1, 1, 1, 'left');
  b.place('water-cooler', 10, 2, 1, 1, 'left');
  b.place('coffee-table', 4, 3, 3, 2, 'down');
  b.place('sofa', 4, 1, 3, 1, 'down');
  b.place('sofa', 4, 6, 3, 1, 'up');
  b.place('armchair', 2, 3, 1, 1, 'right');
  b.place('armchair', 2, 4, 1, 1, 'right');
  b.place('armchair', 8, 3, 1, 1, 'left');
  b.place('armchair', 8, 4, 1, 1, 'left');

  const seated: [number, number, Facing][] = [
    [4, 1, 'down'], [5, 1, 'down'], [6, 1, 'down'],
    [4, 6, 'up'], [5, 6, 'up'], [6, 6, 'up'],
    [2, 3, 'right'], [2, 4, 'right'], [8, 3, 'left'], [8, 4, 'left'],
  ];
  const standing: [number, number, Facing][] = [
    [9, 1, 'right'], [9, 2, 'right'],
    [1, 2, 'left'], [1, 3, 'left'], [1, 4, 'left'],
    [1, 6, 'right'], [9, 6, 'left'], [3, 7, 'up'], [7, 7, 'up'],
  ];
  const seats = [
    ...seated.map(([lx, lz, f], i) => b.spot(`lounge-${i}`, lx, lz, f, true)),
    ...standing.map(([lx, lz, f], i) => b.spot(`stand-${i}`, lx, lz, f, false)),
  ];
  return {
    room: { id: b.id, kind: 'lounge', x, z, w: ROOM_W, h: ROOM_H, door: b.door, desks: [], boss: null, seats },
    furniture: b.furniture,
  };
}

/** arredi che non bloccano il passaggio */
const PASSABLE = new Set<FurnitureKind>(['rug', 'window']);

function build(): PixelPlan {
  const tiles: TileKind[][] = Array.from({ length: DEPTH }, () => Array<TileKind>(WIDTH).fill('wall'));
  const fill = (x: number, z: number, w: number, h: number, kind: TileKind) => {
    for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) tiles[z + dz]![x + dx] = kind;
  };

  const built = [...Array.from({ length: INSTANCE_ROOMS }, (_, i) => instanceRoom(i)), loungeRoom()];
  const rooms = built.map((r) => r.room);
  const furniture = built.flatMap((r) => r.furniture);
  for (const r of rooms) {
    fill(r.x, r.z, r.w, r.h, r.kind === 'lounge' ? 'lounge' : 'floor');
    fill(r.door.x, r.door.z, 1, 1, 'door');
  }
  fill(1, CORRIDOR_Z, WIDTH - 2, CORRIDOR_H, 'corridor');
  const entrance = { x: 0, z: CORRIDOR_Z + 1 };
  fill(entrance.x, entrance.z, 1, 1, 'door');

  // corridoio: piante alle estremità, posti in piedi lungo le pareti lontano dalle porte; la riga centrale resta libera
  for (const [px, pz] of [[1, CORRIDOR_Z], [1, CORRIDOR_Z + 2], [WIDTH - 2, CORRIDOR_Z], [WIDTH - 2, CORRIDOR_Z + 2]] as const) {
    furniture.push({ kind: 'plant', cell: { x: px, z: pz }, w: 1, h: 1, facing: 'down', room: null });
  }
  const overflow: Spot[] = [];
  for (const x of [10, 12, 14, 22, 24, 26]) {
    overflow.push({ id: `hall-${overflow.length}`, cell: { x, z: CORRIDOR_Z }, facing: 'down', seated: false });
    overflow.push({ id: `hall-${overflow.length}`, cell: { x, z: CORRIDOR_Z + 2 }, facing: 'up', seated: false });
  }

  const walkable = tiles.map((row) => row.map((t) => t !== 'wall' && t !== 'void'));
  for (const f of furniture) {
    if (PASSABLE.has(f.kind)) continue;
    for (let dz = 0; dz < f.h; dz++) for (let dx = 0; dx < f.w; dx++) walkable[f.cell.z + dz]![f.cell.x + dx] = false;
  }
  const spots = [...rooms.flatMap((r) => [...r.desks, ...(r.boss ? [r.boss] : []), ...r.seats]), ...overflow];
  for (const s of spots) walkable[s.cell.z]![s.cell.x] = true;

  return { width: WIDTH, depth: DEPTH, tiles, walkable, rooms, furniture, entrance, overflow };
}

const PLAN = build();

/** La pianta della vista 2D: fissa, sempre la stessa istanza. */
export function createPlan(): PixelPlan {
  return PLAN;
}
