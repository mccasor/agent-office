import {
  INSTANCE_ROOMS,
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
    return this.z > CORRIDOR_Z ? { x: this.x + DOOR_X, z: this.z - 1 } : { x: this.x + DOOR_X, z: this.z + ROOM_H };
  }
}

const slot = (i: number) => ({ x: 1 + (i % 3) * (ROOM_W + 1), z: i < 3 ? TOP_Z : BOTTOM_Z, mirrored: i >= 3 });

/** arredo a parete: tipo, colonna locale, larghezza, variante */
type WallItem = readonly [FurnitureKind, number, number, number?];
/** arredo a terra in coordinate locali, come RoomBuilder.place */
type FloorItem = readonly [FurnitureKind, number, number, number, number, Facing, number?];

/**
 * Arredi minori delle stanze istanza: ognuna ha il suo tema, con scrivanie e boss sempre negli stessi posti. Restano
 * liberi i passaggi lungo le isole (lz 2 e 7, colonne 2..8), il corridoio centrale (colonne 4..6, dove al massimo
 * c'è un tappeto) e l'accesso al boss (colonne 3, 4, 6, 7 delle righe lz 0 e 1). Le stanze sotto sono specchiate:
 * lz 0 è contro la parete sud che non si vede, quindi lì stanno arredi bassi; quelli col fronte vanno a lz 7.
 *
 *   room-0 (studio)               room-3 (archivio, specchiata: nord in alto)
 *   .wwq...oww.  parete            .wwcc.oqww.  parete: w finestre, q quadro, o orologio, c bacheca
 *   TBB..b..KSa  lz 0              TL.......La  lz 7, porta sopra la colonna 5
 *   ....DDD....  lz 1              ..cc...cc..  lz 6: c sedie delle postazioni
 *   (T pianta alta, B libreria, b boss, D sua scrivania, K schedario, S stampante, a appendiabiti, L armadietto)
 */
const THEMES: readonly { wall: readonly WallItem[]; floor: readonly FloorItem[] }[] = [
  // studio: libreria, quadro e orologio, schedario e stampante, tappeto blu nel corridoio centrale
  {
    wall: [['painting', 3, 1, 0], ['clock', 7, 1]],
    floor: [
      ['plant-tall', 0, 0, 1, 1, 'down'], ['bookshelf', 1, 0, 2, 1, 'down'], ['cabinet', 8, 0, 1, 1, 'down'],
      ['printer', 9, 0, 1, 1, 'down'], ['coat-rack', 10, 0, 1, 1, 'down'], ['whiteboard', 0, 3, 1, 2, 'right'],
      ['floor-lamp', 10, 2, 1, 1, 'down'], ['plant', 10, 5, 1, 1, 'down'], ['plant', 0, 7, 1, 1, 'down'],
      ['bin', 1, 7, 1, 1, 'down'], ['cactus', 10, 7, 1, 1, 'down'], ['rug', 4, 2, 3, 5, 'down', 1],
    ],
  },
  // laboratorio: armadietti, bacheca coi post-it, stampante e schedario, lavagna a destra
  {
    wall: [['corkboard', 3, 2], ['painting', 7, 1, 1]],
    floor: [
      ['cactus', 0, 0, 1, 1, 'down'], ['locker', 1, 0, 2, 1, 'down'], ['printer', 8, 0, 1, 1, 'down'],
      ['cabinet', 9, 0, 1, 1, 'down'], ['plant', 10, 0, 1, 1, 'down'], ['coat-rack', 0, 2, 1, 1, 'down'],
      ['plant-tall', 0, 5, 1, 1, 'down'], ['whiteboard', 10, 3, 1, 2, 'left'], ['bin', 10, 6, 1, 1, 'down'],
      ['plant', 0, 7, 1, 1, 'down'],
    ],
  },
  // creativo: quadri, lampada e piante alte, libreria a destra, tappeto verde
  {
    wall: [['painting', 3, 1, 2], ['clock', 6, 1], ['painting', 7, 1, 3]],
    floor: [
      ['plant-tall', 0, 0, 1, 1, 'down'], ['floor-lamp', 1, 0, 1, 1, 'down'], ['cactus', 2, 0, 1, 1, 'down'],
      ['bookshelf', 8, 0, 2, 1, 'down'], ['plant-tall', 10, 0, 1, 1, 'down'], ['whiteboard', 0, 3, 1, 2, 'right'],
      ['coat-rack', 10, 2, 1, 1, 'down'], ['printer', 10, 6, 1, 1, 'down'], ['bin', 0, 7, 1, 1, 'down'],
      ['plant', 10, 7, 1, 1, 'down'], ['rug', 4, 2, 3, 5, 'down', 2],
    ],
  },
  // archivio (specchiata): armadietti e appendiabiti alla parete nord, libreria a sinistra, tappeto ocra
  {
    wall: [['corkboard', 3, 2], ['clock', 6, 1], ['painting', 7, 1, 4]],
    floor: [
      ['plant-tall', 0, 7, 1, 1, 'down'], ['locker', 1, 7, 1, 1, 'up'], ['locker', 9, 7, 1, 1, 'up'],
      ['coat-rack', 10, 7, 1, 1, 'down'], ['bookshelf', 0, 3, 1, 2, 'right'], ['whiteboard', 10, 3, 1, 2, 'left'],
      ['plant', 0, 0, 1, 1, 'down'], ['bin', 1, 0, 1, 1, 'down'], ['floor-lamp', 9, 0, 1, 1, 'down'],
      ['plant', 10, 0, 1, 1, 'down'], ['rug', 4, 2, 3, 5, 'down', 3],
    ],
  },
  // riunioni (specchiata): stampante e schedario alla parete nord, quadro e bacheca, libreria a destra
  {
    wall: [['painting', 3, 1, 5], ['clock', 4, 1], ['corkboard', 6, 2]],
    floor: [
      ['cactus', 0, 7, 1, 1, 'down'], ['printer', 1, 7, 1, 1, 'up'], ['cabinet', 9, 7, 1, 1, 'up'],
      ['plant-tall', 10, 7, 1, 1, 'down'], ['whiteboard', 0, 3, 1, 2, 'right'], ['floor-lamp', 10, 1, 1, 1, 'down'],
      ['bookshelf', 10, 4, 1, 2, 'left'], ['coat-rack', 0, 0, 1, 1, 'down'], ['plant', 1, 0, 1, 1, 'down'],
      ['bin', 10, 0, 1, 1, 'down'],
    ],
  },
];

/** Stanza istanza: scrivania del boss in fondo, due isole da 4 postazioni affacciate, corridoio centrale fino alla porta. */
function instanceRoom(n: number): { room: Room; furniture: Furniture[] } {
  const { x, z, mirrored } = slot(n);
  const b = new RoomBuilder(`room-${n}`, x, z, mirrored);
  const theme = THEMES[n % THEMES.length]!;
  b.wall('window', 1, 2);
  b.wall('window', 8, 2);
  for (const [kind, lx, w, variant] of theme.wall) b.wall(kind, lx, w, variant);
  for (const [kind, lx, lz, w, h, facing, variant] of theme.floor) b.place(kind, lx, lz, w, h, facing, variant);

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

/**
 * Sala relax (sotto a destra, porta a nord sopra la colonna 5): in alto i cabinati, il distributore di snack, il
 * frigo e il caffè; a sinistra divani e poltrone attorno al tavolino, a destra il biliardino con i giocatori ai
 * lati lunghi.
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
function loungeRoom(): { room: Room; furniture: Furniture[] } {
  const { x, z } = slot(5);
  // già con la porta a nord: coordinate locali non specchiate
  const b = new RoomBuilder('lounge', x, z, false);
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
    room: { id: b.id, kind: 'lounge', x, z, w: ROOM_W, h: ROOM_H, door: b.door, desks: [], boss: null, seats },
    furniture: b.furniture,
  };
}

/** arredi che non bloccano il passaggio: tappeti e quelli appesi alle pareti */
const PASSABLE = new Set<FurnitureKind>(['rug', ...WALL_DECOR]);

function build(): PixelPlan {
  const tiles: TileKind[][] = Array.from({ length: DEPTH }, () => Array<TileKind>(WIDTH).fill('wall'));
  const styles: number[][] = Array.from({ length: DEPTH }, () => Array<number>(WIDTH).fill(-1));
  const fill = (x: number, z: number, w: number, h: number, kind: TileKind) => {
    for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) tiles[z + dz]![x + dx] = kind;
  };

  const built = [...Array.from({ length: INSTANCE_ROOMS }, (_, i) => instanceRoom(i)), loungeRoom()];
  const rooms = built.map((r) => r.room);
  const furniture = built.flatMap((r) => r.furniture);
  for (const [i, r] of rooms.entries()) {
    fill(r.x, r.z, r.w, r.h, r.kind === 'lounge' ? 'lounge' : 'floor');
    fill(r.door.x, r.door.z, 1, 1, 'door');
    // tinta della stanza sul pavimento e sulla parete nord, quella che si vede da dentro
    for (let dz = -1; dz < r.h; dz++) for (let dx = 0; dx < r.w; dx++) styles[r.z + dz]![r.x + dx] = i;
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

  return { width: WIDTH, depth: DEPTH, tiles, styles, walkable, rooms, furniture, entrance, overflow };
}

const PLAN = build();

/** La pianta della vista 2D: fissa, sempre la stessa istanza. */
export function createPlan(): PixelPlan {
  return PLAN;
}
