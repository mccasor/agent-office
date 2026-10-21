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
  /**
   * posti nell'area relax: prima quelli a sedere (poltroncine e divanetti, id 'lounge-N'), poi quelli in piedi
   * nel corridoio e nei passaggi tra i salottini (id 'stand-N'), usati quando i primi sono finiti
   */
  lounge: Seat[];
  /** divisori tra blocchi di scrivanie affiancati: colonna x, bloccata da z0 a z1 */
  dividers: { x: number; z0: number; z1: number }[];
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
/** un blocco = 2 isole affiancate (8 posti); tra blocchi affiancati: corridoio, divisorio, corridoio */
const BLOCK_ISLANDS = 2;
const BLOCK_SEATS = BLOCK_ISLANDS * SEATS_PER_ISLAND;
const DIVIDER_GAP = 3;
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

/** Scrivanie necessarie: si parte da MIN_SEATS e si raddoppia finché bastano (8, 16, 32...). */
export function deskCapacity(agents: number): number {
  let seats = MIN_SEATS;
  while (seats < agents) seats *= 2;
  return seats;
}

/** Blocchi da 8 posti disposti più larghi che profondi (la stanza si allarga). */
function blockShape(minSeats: number): { blockCols: number; rows: number } {
  const blocks = deskCapacity(minSeats) / BLOCK_SEATS;
  const rows = Math.ceil(Math.sqrt(blocks / 2));
  return { blockCols: Math.ceil(blocks / rows), rows };
}

const BLOCK_W = BLOCK_ISLANDS * ISLAND_W + (BLOCK_ISLANDS - 1) * GAP_X;

/**
 * Openspace a blocchi di isole: con più agenti che scrivanie le scrivanie raddoppiano, la stanza si allarga e tra
 * i blocchi affiancati compare un divisorio. Gli id dei posti dipendono dalla posizione, quindi chi è seduto resta
 * al suo posto quando l'ufficio cresce. Deterministico.
 */
export function createLayout(minSeats: number): OfficeLayout {
  const { blockCols, rows } = blockShape(Number.isFinite(minSeats) ? minSeats : 0);
  const officeX = 1 + BOSS_W + 1 + SIDE_AISLE;
  const blockX = (b: number) => officeX + b * (BLOCK_W + DIVIDER_GAP);
  const width = blockX(blockCols - 1) + BLOCK_W + SIDE_AISLE + LOUNGE_W + 1;
  const depth = 1 + NORTH_AISLE + rows * ISLAND_D + (rows - 1) * GAP_Z + ENTRY_ZONE + 1;
  const walkable = Array.from({ length: depth }, (_, z) =>
    Array.from({ length: width }, (_, x) => x > 0 && z > 0 && x < width - 1 && z < depth - 1),
  );
  const door = { x: Math.floor(width / 2), z: depth - 1 };
  walkable[door.z]![door.x] = true;

  const seats: Seat[] = [];
  const islands: Cell[] = [];
  const seat = (x: number, z: number, facing: number): Seat => ({ id: `seat-${x}-${z}`, cell: { x, z }, facing });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < blockCols * BLOCK_ISLANDS; c++) {
      const b = Math.floor(c / BLOCK_ISLANDS);
      const x0 = blockX(b) + (c % BLOCK_ISLANDS) * (ISLAND_W + GAP_X);
      const z0 = 1 + NORTH_AISLE + r * (ISLAND_D + GAP_Z);
      islands.push({ x: x0, z: z0 });
      for (let dx = 0; dx < ISLAND_W; dx++) {
        walkable[z0 + 1]![x0 + dx] = false;
        walkable[z0 + 2]![x0 + dx] = false;
      }
      for (let dx = 0; dx < ISLAND_W; dx++) seats.push(seat(x0 + dx, z0, FACING_SOUTH));
      for (let dx = 0; dx < ISLAND_W; dx++) seats.push(seat(x0 + dx, z0 + 3, FACING_NORTH));
    }
  }

  // divisori tra blocchi affiancati: aperti sul corridoio nord e verso l'ingresso
  const lastRowEnd = 1 + NORTH_AISLE + (rows - 1) * (ISLAND_D + GAP_Z) + ISLAND_D - 1;
  const dividers = Array.from({ length: blockCols - 1 }, (_, b) => ({
    x: blockX(b) + BLOCK_W + Math.floor(DIVIDER_GAP / 2),
    z0: 1 + NORTH_AISLE,
    z1: lastRowEnd,
  }));
  for (const d of dividers) for (let z = d.z0; z <= d.z1; z++) walkable[z]![d.x] = false;

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
  // in piedi, col caffè: nei passaggi tra i salottini (verso il salottino a nord) e lungo il corridoio (verso est)
  const standing: Cell[] = [];
  for (const nook of plan.nooks) {
    const z = nook.z0 + 2;
    if (z <= depth - 3) for (let x = plan.tableX - 1; x <= plan.tableX + 1; x++) standing.push({ x, z });
  }
  const taken = new Set(standing.map(cellKey));
  for (let z = 2; z <= depth - 3; z++) if (!taken.has(cellKey({ x: plan.screenX + 1, z }))) standing.push({ x: plan.screenX + 1, z });
  standing.forEach((cell, i) => {
    const facing = cell.x === plan.screenX + 1 ? FACING_EAST : FACING_NORTH;
    lounge.push({ id: `stand-${i}`, cell, facing });
  });

  // board dei task sulla parete nord, al centro dell'openspace; ci si ferma nel corridoio nord
  const mid = Math.floor((BOSS_W + 2 + plan.screenX - 1) / 2);
  const board = (dx: number): Seat => ({ id: 'board', cell: { x: mid + dx, z: 1 }, facing: FACING_NORTH });
  const boards = { todo: board(-BOARD_STEP), progress: board(0), review: board(BOARD_STEP) };

  for (const p of [...plantCells({ width, depth }), ...plan.furniture]) walkable[p.z]![p.x] = false;
  return { width, depth, door, seats, islands, bossSeat, bossDoor, lounge, dividers, boards, walkable };
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
