/**
 * Layout dell'openspace su griglia. 1 cella = 1 unità three.js.
 * Coordinate di griglia: x verso est (0..width-1), z verso sud (0..depth-1); la porta è sulla parete sud (z = depth-1).
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

export const FACING_SOUTH = 0; // verso +z
export const FACING_NORTH = Math.PI; // verso -z

export const cellKey = (c: Cell): string => `${c.x},${c.z}`;

function gridShape(minSeats: number): { cols: number; rows: number } {
  const islands = Math.max(Math.ceil(Math.max(minSeats, MIN_SEATS) / SEATS_PER_ISLAND), 2);
  const rows = Math.ceil(Math.sqrt(islands / 3));
  return { cols: Math.ceil(islands / rows), rows };
}

/** Openspace a isole di scrivanie; cresce per contenere almeno minSeats posti. Deterministico. */
export function createLayout(minSeats: number): OfficeLayout {
  const { cols, rows } = gridShape(Number.isFinite(minSeats) ? minSeats : 0);
  const width = 1 + SIDE_AISLE + cols * ISLAND_W + (cols - 1) * GAP_X + SIDE_AISLE + 1;
  const depth = 1 + NORTH_AISLE + rows * ISLAND_D + (rows - 1) * GAP_Z + ENTRY_ZONE + 1;
  const walkable = Array.from({ length: depth }, (_, z) =>
    Array.from({ length: width }, (_, x) => x > 0 && z > 0 && x < width - 1 && z < depth - 1),
  );
  const door = { x: Math.floor(width / 2), z: depth - 1 };
  walkable[door.z]![door.x] = true;

  const seats: Seat[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = 1 + SIDE_AISLE + c * (ISLAND_W + GAP_X);
      const z0 = 1 + NORTH_AISLE + r * (ISLAND_D + GAP_Z);
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
  for (const p of plantCells({ width, depth })) walkable[p.z]![p.x] = false;
  return { width, depth, door, seats, walkable };
}

/** Scrivania di ciascun posto: la cella verso cui il posto è rivolto. */
export function deskCells(layout: OfficeLayout): Desk[] {
  return layout.seats.map((s) => ({
    seatId: s.id,
    cell: { x: s.cell.x + Math.round(Math.sin(s.facing)), z: s.cell.z + Math.round(Math.cos(s.facing)) },
    facing: s.facing + Math.PI,
  }));
}

/** Piante decorative (non walkable): angoli interni dell'ufficio. */
export function plantCells(layout: Pick<OfficeLayout, 'width' | 'depth'>): Cell[] {
  const { width: w, depth: d } = layout;
  return [
    { x: 1, z: 1 },
    { x: w - 2, z: 1 },
    { x: 1, z: d - 2 },
    { x: w - 2, z: d - 2 },
  ];
}

/** Centro della cella (anche frazionaria) in coordinate mondo, ufficio centrato sull'origine. */
export function cellToWorld(layout: Pick<OfficeLayout, 'width' | 'depth'>, c: Cell): [number, number, number] {
  return [c.x - layout.width / 2 + 0.5, 0, c.z - layout.depth / 2 + 0.5];
}
