import type { Cell, Facing, Furniture, FurnitureKind, Spot } from './types';

/**
 * Sale hobby (#108): piante a dati, tutte HOBBY_W×HOBBY_H celle con la porta a nord sopra la colonna locale 5, mai
 * specchiate (stanno nella fila sotto il corridoio).
 *
 *   hobbyRoom(kind: HobbyKind, id: string, x: number, z: number): { furniture: Furniture[]; seats: Spot[]; door: Cell }
 *
 * - `x`, `z`: angolo nord-ovest del rettangolo interno della stanza nella pianta (pareti escluse), come Room.x/z;
 * - `furniture`: arredi in coordinate di pianta, con `room` = `id`; quelli a parete stanno sulla riga z - 1;
 * - `seats`: posti nell'ordine in cui si occupano, con id `<id>:<locale>` (unici anche con più sale dello stesso
 *   tipo); i locali dicono cosa fa chi ci sta: 'foos-<n>' al biliardino, 'pad-<n>' alla console, 'pong-<n>' al
 *   ping-pong (vedi actors.ts), gli altri seduti o in piedi;
 * - `door`: vano porta sul corridoio, { x: x + 5, z: z - 1 }.
 *
 * Coordinate locali come nella sala relax di plan.ts: lz = 0 è la riga sotto la parete nord (che si vede).
 */
export const HOBBY_KINDS = ['relax', 'console', 'pingpong'] as const;
export type HobbyKind = (typeof HOBBY_KINDS)[number];

export const HOBBY_W = 11;
export const HOBBY_H = 8;
/** colonna locale della porta, sulla parete nord */
export const HOBBY_DOOR_X = 5;

/** arredo a parete: tipo, colonna locale, larghezza, variante */
type WallItem = readonly [FurnitureKind, number, number, number?];
/** arredo a terra: tipo, lx, lz, w, h, facing, variante */
type FloorItem = readonly [FurnitureKind, number, number, number, number, Facing, number?];
/** posto: id locale, lx, lz, facing, seduto */
type SeatItem = readonly [string, number, number, Facing, boolean];

export interface HobbyPlan {
  wall: readonly WallItem[];
  floor: readonly FloorItem[];
  seats: readonly SeatItem[];
}

/** posti numerati per tipo, nell'ordine dato: [lx, lz, facing] -> ['<prefisso>-<n>', lx, lz, facing, seated] */
const numbered = (prefix: string, seated: boolean, cells: readonly (readonly [number, number, Facing])[]): SeatItem[] =>
  cells.map(([lx, lz, f], i) => [`${prefix}-${i}`, lx, lz, f, seated] as const);

/**
 * Sala relax, la stessa di sempre: in alto i cabinati, il distributore di snack, il frigo e il caffè; a sinistra
 * divani e poltrone attorno al tavolino, a destra il biliardino con i giocatori ai lati lunghi. 22 posti.
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
const RELAX: HobbyPlan = {
  wall: [['window', 3, 1], ['poster', 4, 1, 1], ['poster', 6, 1, 0]],
  floor: [
    ['rug', 1, 3, 5, 4, 'down', 0], ['plant-tall', 0, 0, 1, 1, 'down'], ['arcade', 1, 0, 1, 1, 'down', 0],
    ['arcade', 2, 0, 1, 1, 'down', 1], ['bin', 6, 0, 1, 1, 'down'], ['vending', 7, 0, 1, 1, 'down'],
    ['fridge', 8, 0, 1, 1, 'down'], ['coffee-machine', 9, 0, 1, 1, 'down'], ['plant', 10, 0, 1, 1, 'down'],
    ['bookshelf', 0, 3, 1, 3, 'right'], ['coffee-table', 2, 4, 3, 2, 'down'], ['sofa', 2, 3, 3, 1, 'down'],
    ['sofa', 2, 6, 3, 1, 'up'], ['armchair', 1, 4, 1, 1, 'right'], ['armchair', 1, 5, 1, 1, 'right'],
    ['armchair', 5, 4, 1, 1, 'left'], ['armchair', 5, 5, 1, 1, 'left'], ['foosball', 7, 4, 2, 1, 'down'],
    ['water-cooler', 10, 6, 1, 1, 'left'], ['floor-lamp', 0, 6, 1, 1, 'down'], ['plant', 0, 7, 1, 1, 'down'],
    ['cactus', 10, 7, 1, 1, 'down'],
  ],
  seats: [
    // biliardino: prima uno per lato (si gioca uno contro uno), poi gli altri due
    ...numbered('foos', false, [[7, 3, 'down'], [8, 5, 'up'], [8, 3, 'down'], [7, 5, 'up']]),
    ...numbered('lounge', true, [
      [2, 3, 'down'], [3, 3, 'down'], [4, 3, 'down'],
      [2, 6, 'up'], [3, 6, 'up'], [4, 6, 'up'],
      [1, 4, 'right'], [1, 5, 'right'], [5, 4, 'left'], [5, 5, 'left'],
    ]),
    ...numbered('stand', false, [
      [1, 1, 'up'], [2, 1, 'up'], [7, 1, 'up'], [8, 1, 'up'], [9, 1, 'up'],
      [9, 6, 'right'], [6, 7, 'right'], [7, 7, 'left'],
    ]),
  ],
};

/**
 * Sala console: a sinistra la TV grande sul mobile con le console, davanti pouf e divano con i giocatori col
 * controller; a destra una seconda postazione più piccola; in fondo lo scaffale dei giochi, un divano e due
 * poltrone per chi guarda. File alternate a passaggi (lz 1, 3, 5) collegati dalle colonne 5..7. 22 posti:
 * 10 giocatori, 5 seduti che guardano, 7 in piedi.
 *
 *   ....o..p...   parete: o orologio, p poster (sopra i mobili la parete è coperta dalle TV)
 *   PTTT..f.ttP   lz 0: P piante, T TV grande sul mobile, f minifrigo, t TV piccola
 *   rrrrr.s....   lz 1: r tappeto (sotto, fino a lz 5), s in piedi davanti al minifrigo
 *   rpppS...ppS   lz 2: p pouf dei giocatori, S in piedi che guardano
 *   rrrrr......   lz 3: passaggio
 *   rDDDS...ddS   lz 4: D divano dei giocatori, d divanetto dei giocatori
 *   GSrrr......   lz 5: G scaffale dei giochi, S in piedi che scelgono
 *   GSRRR...cc.   lz 6: R divano di chi guarda, c poltrone
 *   P.....l...C   lz 7: l lampada, C cactus
 */
const CONSOLE: HobbyPlan = {
  wall: [['clock', 4, 1], ['poster', 7, 1, 0]],
  floor: [
    ['rug', 0, 1, 5, 5, 'down', 1], ['plant-tall', 0, 0, 1, 1, 'down'], ['tv', 1, 0, 3, 1, 'down', 0],
    ['mini-fridge', 6, 0, 1, 1, 'down'], ['tv', 8, 0, 2, 1, 'down', 1], ['plant', 10, 0, 1, 1, 'down'],
    ['pouf', 1, 2, 1, 1, 'up', 0], ['pouf', 2, 2, 1, 1, 'up', 1], ['pouf', 3, 2, 1, 1, 'up', 2],
    ['pouf', 8, 2, 1, 1, 'up', 3], ['pouf', 9, 2, 1, 1, 'up', 0], ['sofa', 1, 4, 3, 1, 'up'],
    ['armchair', 8, 4, 2, 1, 'up'], ['game-shelf', 0, 5, 1, 2, 'right'], ['sofa', 2, 6, 3, 1, 'up'],
    ['armchair', 8, 6, 1, 1, 'up'], ['armchair', 9, 6, 1, 1, 'up'], ['plant', 0, 7, 1, 1, 'down'],
    ['floor-lamp', 6, 7, 1, 1, 'down'], ['cactus', 10, 7, 1, 1, 'down'],
  ],
  seats: [
    // giocatori: prima la TV grande (pouf davanti, poi il divano), poi la postazione piccola
    ...numbered('pad', true, [
      [2, 2, 'up'], [1, 2, 'up'], [3, 2, 'up'], [2, 4, 'up'], [1, 4, 'up'], [3, 4, 'up'],
      [8, 2, 'up'], [9, 2, 'up'], [8, 4, 'up'], [9, 4, 'up'],
    ]),
    ...numbered('couch', true, [[3, 6, 'up'], [2, 6, 'up'], [4, 6, 'up'], [8, 6, 'up'], [9, 6, 'up']]),
    ...numbered('stand', false, [
      [4, 2, 'up'], [4, 4, 'up'], [10, 2, 'up'], [10, 4, 'up'], [6, 1, 'up'], [1, 5, 'left'], [1, 6, 'left'],
    ]),
  ],
};

/**
 * Sala ping-pong: il tavolo al centro con i due giocatori ai lati corti che si fronteggiano (in diagonale), sgabelli
 * lungo le pareti, due panche in fondo per chi guarda, il distributore d'acqua; a parete il porta-racchette e il
 * segnapunti. 23 posti: 2 giocatori, 14 seduti, 7 in piedi.
 *
 *   .w.R...SSw.   parete: w finestre, R porta-racchette, S segnapunti
 *   P........WP   lz 0: P piante, W distributore d'acqua
 *   .........s.   lz 1: s in piedi al distributore
 *   o..rsrsr..o   lz 2: o sgabelli, r tappeto (fino a lz 5), s in piedi che guardano
 *   o..r###g..o   lz 3: # tavolo, g giocatore a est (guarda a ovest)
 *   o..g###r..o   lz 4: g giocatore a ovest (guarda a est)
 *   s..rrrrr..s   lz 5: passaggio, in piedi ai lati
 *   .bbbb.bbbb.   lz 6: b panche
 *   P...s.s...C   lz 7: in piedi dietro le panche, C cactus
 */
const PINGPONG: HobbyPlan = {
  wall: [['window', 1, 1], ['paddle-rack', 3, 1], ['scoreboard', 7, 2], ['window', 9, 1]],
  floor: [
    ['rug', 3, 2, 5, 4, 'down', 2], ['plant-tall', 0, 0, 1, 1, 'down'], ['water-cooler', 9, 0, 1, 1, 'down'],
    ['plant', 10, 0, 1, 1, 'down'], ['pingpong', 4, 3, 3, 2, 'down'],
    ['stool', 0, 2, 1, 1, 'right'], ['stool', 0, 3, 1, 1, 'right'], ['stool', 0, 4, 1, 1, 'right'],
    ['stool', 10, 2, 1, 1, 'left'], ['stool', 10, 3, 1, 1, 'left'], ['stool', 10, 4, 1, 1, 'left'],
    ['bench', 1, 6, 4, 1, 'up'], ['bench', 6, 6, 4, 1, 'up'], ['plant', 0, 7, 1, 1, 'down'],
    ['cactus', 10, 7, 1, 1, 'down'],
  ],
  seats: [
    // i due giocatori, poi chi guarda: panche, sgabelli, in piedi
    ...numbered('pong', false, [[3, 4, 'right'], [7, 3, 'left']]),
    ...numbered('seat', true, [
      [2, 6, 'up'], [3, 6, 'up'], [7, 6, 'up'], [8, 6, 'up'], [1, 6, 'up'], [4, 6, 'up'], [6, 6, 'up'], [9, 6, 'up'],
      [0, 3, 'right'], [10, 3, 'left'], [0, 2, 'right'], [10, 2, 'left'], [0, 4, 'right'], [10, 4, 'left'],
    ]),
    ...numbered('stand', false, [
      [4, 2, 'down'], [6, 2, 'down'], [9, 1, 'up'], [4, 7, 'up'], [6, 7, 'up'], [0, 5, 'right'], [10, 5, 'left'],
    ]),
  ],
};

export const HOBBY_PLANS: Readonly<Record<HobbyKind, HobbyPlan>> = { relax: RELAX, console: CONSOLE, pingpong: PINGPONG };

/** Sala hobby `kind` con id `id` e angolo nord-ovest interno in (x, z) della pianta. Pura. */
export function hobbyRoom(kind: HobbyKind, id: string, x: number, z: number): { furniture: Furniture[]; seats: Spot[]; door: Cell } {
  const p = HOBBY_PLANS[kind];
  const furniture: Furniture[] = [
    ...p.wall.map(([k, lx, w, variant = 0]): Furniture => ({ kind: k, cell: { x: x + lx, z: z - 1 }, w, h: 1, facing: 'down', room: id, variant })),
    ...p.floor.map(([k, lx, lz, w, h, facing, variant = 0]): Furniture => ({ kind: k, cell: { x: x + lx, z: z + lz }, w, h, facing, room: id, variant })),
  ];
  const seats = p.seats.map(([local, lx, lz, facing, seated]): Spot => ({ id: `${id}:${local}`, cell: { x: x + lx, z: z + lz }, facing, seated }));
  return { furniture, seats, door: { x: x + HOBBY_DOOR_X, z: z - 1 } };
}

/** stanza di un posto delle sale hobby (la parte prima di ':'), null per gli altri posti */
export function hobbySpotRoom(spotId: string): string | null {
  const i = spotId.indexOf(':');
  return i < 0 ? null : spotId.slice(0, i);
}
