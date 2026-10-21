/**
 * Layout dell'ufficio su griglia. 1 cella = 1 unità three.js.
 * Coordinate di griglia: x verso est (0..width-1), z verso sud (0..depth-1); la porta è sulla parete sud (z = depth-1).
 * Da ovest a est: stanza del boss (chiusa da una vetrata con porta), openspace a isole, area relax con divani.
 * Angoli (facing/direction): rotation.y di three.js con il modello rivolto a +z a rotazione 0,
 * quindi direzione (dx, dz) -> atan2(dx, dz).
 */

export interface Cell { x: number; z: number }
export interface Seat { id: string; cell: Cell; /** radianti, verso la scrivania */ facing: number }
export interface OfficeLayout {
  width: number;
  depth: number;
  door: Cell;
  seats: Seat[];
  /** cella in alto a sinistra (sedie nord) di ogni isola */
  islands: Cell[];
  /** posto alla scrivania del boss */
  bossSeat: Seat;
  /** apertura nella vetrata della stanza del boss (x = BOSS_W + 1) */
  bossDoor: Cell;
  /** posti sui divani dell'area relax, colonne ovest ed est, da nord a sud */
  lounge: Seat[];
  /** walkable[z][x] */
  walkable: boolean[][];
}
export interface Desk { seatId: string; cell: Cell; /** radianti: rotazione della scrivania, il lato utente guarda il posto */ facing: number }

export const MIN_SEATS = 8;
const SEATS_PER_ISLAND = 4;
/** isola: 2 colonne di scrivanie x (sedia, scrivania, scrivania, sedia) */
const ISLAND_W = 2;
const ISLAND_D = 4;
/** corridoi */
const GAP_X = 2;
const GAP_Z = 1;
const SIDE_AISLE = 2;
const NORTH_AISLE = 1;
const ENTRY_ZONE = 3;
/** stanza del boss: colonne 1..BOSS_W, vetrata in colonna BOSS_W + 1 */
export const BOSS_W = 3;
/** area relax: divano, tavolino, divano (le ultime 3 colonne interne) */
export const LOUNGE_W = 3;

export const FACING_SOUTH = 0; // verso +z
export const FACING_NORTH = Math.PI; // verso -z
export const FACING_EAST = Math.PI / 2; // verso +x
export const FACING_WEST = -Math.PI / 2; // verso -x

export const cellKey = (c: Cell): string => `${c.x},${c.z}`;

function gridShape(minSeats: number): { cols: number; rows: number } {
  const islands = Math.max(Math.ceil(Math.max(minSeats, MIN_SEATS) / SEATS_PER_ISLAND), 2);
  const rows = Math.ceil(Math.sqrt(islands / 3));
  return { cols: Math.ceil(islands / rows), rows };
}

/** Openspace a isole di scrivanie; cresce per contenere almeno minSeats posti. Deterministico. */
export function createLayout(minSeats: number): OfficeLayout {
  const { cols, rows } = gridShape(Number.isFinite(minSeats) ? minSeats : 0);
  const officeX = 1 + BOSS_W + 1 + SIDE_AISLE;
  const width = officeX + cols * ISLAND_W + (cols - 1) * GAP_X + SIDE_AISLE + LOUNGE_W + 1;
  const depth = 1 + NORTH_AISLE + rows * ISLAND_D + (rows - 1) * GAP_Z + ENTRY_ZONE + 1;
  const walkable = Array.from({ length: depth }, (_, z) =>
    Array.from({ length: width }, (_, x) => x > 0 && z > 0 && x < width - 1 && z < depth - 1),
  );
  const door = { x: Math.floor(width / 2), z: depth - 1 };
  walkable[door.z]![door.x] = true;

  const seats: Seat[] = [];
  const islands: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = officeX + c * (ISLAND_W + GAP_X);
      const z0 = 1 + NORTH_AISLE + r * (ISLAND_D + GAP_Z);
      islands.push({ x: x0, z: z0 });
      for (let dx = 0; dx < ISLAND_W; dx++) {
        walkable[z0 + 1]![x0 + dx] = false;
        walkable[z0 + 2]![x0 + dx] = false;
      }
      for (let dx = 0; dx < ISLAND_W; dx++) {
        seats.push({ id: `seat-${seats.length}`, cell: { x: x0 + dx, z: z0 }, facing: FACING_SOUTH });
      }
      for (let dx = 0; dx < ISLAND_W; dx++) {
        seats.push({ id: `seat-${seats.length}`, cell: { x: x0 + dx, z: z0 + 3 }, facing: FACING_NORTH });
      }
    }
  }

  // stanza del boss: vetrata con porta verso l'ingresso; scrivania davanti al posto, si gira dal lato est
  const bossDoor = { x: BOSS_W + 1, z: depth - 3 };
  for (let z = 1; z < depth - 1; z++) walkable[z]![BOSS_W + 1] = z === bossDoor.z;
  for (let x = 1; x < BOSS_W; x++) walkable[3]![x] = false;
  const bossSeat: Seat = { id: 'boss', cell: { x: 2, z: 2 }, facing: FACING_SOUTH };

  // area relax: divani rivolti al tavolino centrale; il passaggio a sud del tavolino collega i due divani
  const lounge: Seat[] = [];
  const [west, table, east] = [width - 1 - LOUNGE_W, width - LOUNGE_W, width - 2];
  for (let z = 2; z <= depth - 3; z++) {
    if (z <= depth - 4) walkable[z]![table] = false;
    lounge.push({ id: `lounge-${lounge.length}`, cell: { x: west, z }, facing: FACING_EAST });
  }
  for (let z = 2; z <= depth - 3; z++) lounge.push({ id: `lounge-${lounge.length}`, cell: { x: east, z }, facing: FACING_WEST });

  for (const p of [...plantCells({ width, depth }), ...coffeeBarCells({ width, depth })]) walkable[p.z]![p.x] = false;
  return { width, depth, door, seats, islands, bossSeat, bossDoor, lounge, walkable };
}

/** Bancone con la macchina del caffè, a nord dell'area relax (sopra il divano ovest e il tavolino). */
export function coffeeBarCells(layout: Pick<OfficeLayout, 'width' | 'depth'>): Cell[] {
  return [
    { x: layout.width - 1 - LOUNGE_W, z: 1 },
    { x: layout.width - LOUNGE_W, z: 1 },
  ];
}

/** Tavolino dell'area relax: colonna centrale, dalla seconda riga fino a quella prima del passaggio. */
export function loungeTable(layout: Pick<OfficeLayout, 'width' | 'depth'>): { x: number; z0: number; z1: number } {
  return { x: layout.width - LOUNGE_W, z0: 2, z1: layout.depth - 4 };
}

/** Scrivania di ciascun posto: la cella verso cui il posto è rivolto. */
export function deskCells(layout: OfficeLayout): Desk[] {
  return layout.seats.map((s) => ({
    seatId: s.id,
    cell: { x: s.cell.x + Math.round(Math.sin(s.facing)), z: s.cell.z + Math.round(Math.cos(s.facing)) },
    facing: s.facing + Math.PI,
  }));
}

/** Piante decorative (non walkable): angoli della stanza del boss, dell'openspace e dell'area relax. */
export function plantCells(layout: Pick<OfficeLayout, 'width' | 'depth'>): Cell[] {
  const { width: w, depth: d } = layout;
  return [
    { x: 1, z: 1 },
    { x: BOSS_W, z: 1 },
    { x: 1, z: d - 2 },
    { x: BOSS_W + 2, z: 1 },
    { x: w - 2, z: 1 },
    { x: w - 2, z: d - 2 },
  ];
}

/** Centro della cella (anche frazionaria) in coordinate mondo, ufficio centrato sull'origine. */
export function cellToWorld(layout: Pick<OfficeLayout, 'width' | 'depth'>, c: Cell): [number, number, number] {
  return [c.x - layout.width / 2 + 0.5, 0, c.z - layout.depth / 2 + 0.5];
}
