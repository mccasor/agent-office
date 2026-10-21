/**
 * Layout dell'ufficio su griglia. 1 cella = 1 unità three.js.
 * Coordinate di griglia: x verso est (0..width-1), z verso sud (0..depth-1); la porta è sulla parete sud (z = depth-1).
 * Da ovest a est: stanza del boss (chiusa da una vetrata con porta), openspace a isole con le tre board dei task
 * sulla parete nord, area relax dietro un separè con divanetti, poltroncine, tavolini, libreria e bancone del caffè.
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
  /** posti nell'area relax (poltroncine e divanetti), da nord a sud */
  lounge: Seat[];
  /** dove si ferma chi sposta un post-it, davanti a ciascuna board (parete nord, rivolto a nord) */
  boards: Record<BoardColumn, Seat>;
  /** walkable[z][x] */
  walkable: boolean[][];
}
export type BoardColumn = 'todo' | 'progress' | 'review';
export const BOARD_COLUMNS: readonly BoardColumn[] = ['todo', 'progress', 'review'];

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
/** area relax: separè, corridoio, poltroncine, tavolini, divanetti (le ultime 5 colonne interne) */
export const LOUNGE_W = 5;
/** distanza tra le board dei task (celle) */
const BOARD_STEP = 2;

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

  // area relax dietro il separè (aperto a sud, verso l'ingresso): salottini di due poltroncine e un divanetto
  const plan = loungePlan({ width, depth });
  for (let z = 1; z <= plan.screenZ1; z++) walkable[z]![plan.screenX] = false;
  const lounge: Seat[] = [];
  for (const nook of plan.nooks) {
    for (const z of [nook.z0, nook.z0 + 1]) {
      walkable[z]![plan.tableX] = false;
      lounge.push({ id: `lounge-${lounge.length}`, cell: { x: plan.tableX - 1, z }, facing: FACING_EAST });
      lounge.push({ id: `lounge-${lounge.length}`, cell: { x: plan.tableX + 1, z }, facing: FACING_WEST });
    }
  }

  // board dei task sulla parete nord, al centro dell'openspace; ci si ferma nel corridoio nord
  const mid = Math.floor((BOSS_W + 2 + plan.screenX - 1) / 2);
  const board = (dx: number): Seat => ({ id: 'board', cell: { x: mid + dx, z: 1 }, facing: FACING_NORTH });
  const boards = { todo: board(-BOARD_STEP), progress: board(0), review: board(BOARD_STEP) };

  for (const p of [...plantCells({ width, depth }), ...plan.furniture]) walkable[p.z]![p.x] = false;
  return { width, depth, door, seats, islands, bossSeat, bossDoor, lounge, boards, walkable };
}

export interface LoungePlan {
  /** colonna del separè, bloccata da z = 1 a screenZ1 (le ultime righe restano aperte come ingresso) */
  screenX: number;
  screenZ1: number;
  /** colonna dei tavolini: poltroncine a ovest, divanetti a est */
  tableX: number;
  /** salottini di due righe (z0, z0 + 1), separati da una riga di passaggio */
  nooks: { z0: number }[];
  /** libreria nell'angolo nord-ovest dell'area */
  shelf: Cell;
  /** bancone con la macchina del caffè contro la parete nord */
  bar: Cell[];
  /** celle non walkable occupate dai mobili */
  furniture: Cell[];
}

/** Geometria dell'area relax, a partire dalla parete est. Deterministica. */
export function loungePlan(layout: Pick<OfficeLayout, 'width' | 'depth'>): LoungePlan {
  const { width: w, depth: d } = layout;
  const screenX = w - 1 - LOUNGE_W;
  const aisle = screenX + 1;
  const nooks: { z0: number }[] = [];
  for (let z0 = 2; z0 + 1 <= d - 3; z0 += 3) nooks.push({ z0 });
  const shelf = { x: aisle, z: 1 };
  const bar = [{ x: aisle + 1, z: 1 }, { x: aisle + 2, z: 1 }];
  return { screenX, screenZ1: d - 4, tableX: aisle + 2, nooks, shelf, bar, furniture: [shelf, ...bar] };
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
    { x: w - 2 - LOUNGE_W, z: 1 },
  ];
}

/** Centro della cella (anche frazionaria) in coordinate mondo, ufficio centrato sull'origine. */
export function cellToWorld(layout: Pick<OfficeLayout, 'width' | 'depth'>, c: Cell): [number, number, number] {
  return [c.x - layout.width / 2 + 0.5, 0, c.z - layout.depth / 2 + 0.5];
}
