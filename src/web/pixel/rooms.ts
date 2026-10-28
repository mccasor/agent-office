import type { WorkRoomType } from '../../shared/office';
import type { FurnitureKind } from './types';

/**
 * Piante delle stanze di lavoro (#108), come dati: una mappa ASCII per pianta, in coordinate locali con il boss in
 * alto (lz 0) e la porta in basso (sotto lz 7). Le stanze sotto il corridoio sono le stesse specchiate (plan.ts): ogni
 * pianta funziona nei due versi, e un test lo controlla per tutte.
 *
 * Per taglia restano fissi scrivanie, boss e porta; cambiano arredi minori, tappeto e tinta di pavimento e pareti.
 * Liberi i passaggi (WORK_SIZES.passages): le righe lz 2 e 7 lungo le isole, il corridoio fino alla porta e l'accesso
 * al boss. Un arredo è un rettangolo di lettere uguali; le postazioni (h, m) e il boss (b) sono celle singole.
 */

/** legenda della riga di parete: arredi appesi, piatti */
export const WALL_LEGEND: Record<string, FurnitureKind> = { w: 'window', o: 'clock', c: 'corkboard', p: 'poster' };
// le cifre sono quadri, con la cifra come variante (soggetto)

/**
 * Legenda del pavimento. Postazioni e boss: b sedia del boss, D sua scrivania, h sedia di una postazione, m scrivania
 * col monitor (davanti alla sua sedia). Il resto sono arredi minori.
 */
export const FLOOR_LEGEND: Record<string, FurnitureKind> = {
  D: 'boss-desk',
  T: 'plant-tall', P: 'plant', C: 'cactus', x: 'bin', l: 'floor-lamp', a: 'coat-rack',
  B: 'bookshelf', K: 'cabinet', S: 'printer', L: 'locker', W: 'whiteboard', r: 'rug',
  V: 'vending', F: 'fridge', k: 'coffee-machine', u: 'water-cooler', s: 'sofa', A: 'armchair', t: 'coffee-table',
};

export interface WorkLayout {
  /** nome del tema, solo per chi legge */
  name: string;
  /** tinta di pavimento e pareti (PixelPlan.styles, 0-4 come le stanze di sempre) */
  style: number;
  /** variante del tappeto, se c'è */
  rug?: number;
  /** riga di parete a nord */
  wall: string;
  /** 8 righe da lz 0 (boss) a lz 7 (porta) */
  floor: readonly string[];
}

/** Taglie: larghezza, colonna della porta (e del boss) e passaggi da lasciare liberi (x nella maschera). */
export const WORK_SIZES: Record<WorkRoomType, { w: number; door: number; passages: readonly string[] }> = {
  // un'isola da 2+2, corridoio a destra fino alla porta, boss raggiungibile da sinistra
  work4: {
    w: 7,
    door: 4,
    passages: [
      '..xx...',
      '..x....',
      '..xx...',
      '....xx.',
      '....xx.',
      '....xx.',
      '....xx.',
      '..xx...',
    ],
  },
  // due isole da 2+2 ai lati del corridoio centrale
  work8: {
    w: 11,
    door: 5,
    passages: [
      '...xx.xx...',
      '...x...x...',
      '..xxxxxxx..',
      '....xxx....',
      '....xxx....',
      '....xxx....',
      '....xxx....',
      '..xxxxxxx..',
    ],
  },
  // tre isole da 2+2: una a sinistra, due ai lati del corridoio; a destra un angolo per il tema
  work12: {
    w: 15,
    door: 8,
    passages: [
      '......xx.xx....',
      '......x...x....',
      '.xxxxxxxxxxxx..',
      '.......xxx..x..',
      '.......xxx..x..',
      '.......xxx..x..',
      '.......xxx..x..',
      '.xxxxxxxxxxxx..',
    ],
  },
};

/** 4 postazioni: 8 piante */
const WORK4: readonly WorkLayout[] = [
  {
    name: 'studio', style: 0, rug: 1, wall: '.ww0.o.',
    floor: ['BB..bTa', '...DDD.', 'W...rrl', 'W.hhrr.', '..mmrrP', '..mmrr.', '..hhrrK', 'P.....C'],
  },
  {
    name: 'laboratorio', style: 1, wall: 'wwcc.1.',
    floor: ['LL..bCS', '...DDD.', 'a......', '..hh..W', '..mm..W', 'T.mm...', '..hh..x', 'P.....K'],
  },
  {
    name: 'creativo', style: 2, rug: 2, wall: '.ww2.o3',
    floor: ['Tl..bCT', '...DDD.', '....rra', 'W.hhrr.', 'W.mmrr.', '..mmrr.', '..hhrrS', 'x.....P'],
  },
  {
    name: 'archivio', style: 3, rug: 3, wall: '.ww4.cc',
    floor: ['Px..b.l', '...DDD.', '......a', 'B.hhrrW', 'B.mmrrW', '..mmrr.', '..hhrr.', 'T.....L'],
  },
  {
    name: 'riunioni', style: 4, wall: '.wwo.5.',
    floor: ['CS..b.T', '...DDD.', 'W.....l', 'W.hh...', '..mm..B', '..mm..B', '..hh...', 'a.....x'],
  },
  {
    name: 'biblioteca', style: 3, wall: '.ww1.o.',
    floor: ['BB..bBB', '...DDD.', 'l......', 'B.hh..B', 'B.mm..B', '..mm...', 'T.hh..P', 'x.....T'],
  },
  {
    name: 'serra', style: 1, wall: 'ww.w.ww',
    floor: ['TP..bCT', '...DDD.', 'P.....P', 'T.hh..C', '..mm..T', 'P.mm...', '..hh..P', 'T.....T'],
  },
  {
    name: 'caffè', style: 2, rug: 0, wall: '.wwp.o.',
    floor: ['kF..bVu', '...DDD.', '......l', 'W.hhrr.', 'W.mmrrP', '..mmrr.', '..hhrrx', 'T.....C'],
  },
];

/** 8 postazioni: 4 piante, i temi delle stanze di sempre */
const WORK8: readonly WorkLayout[] = [
  {
    // libreria, quadro e orologio, schedario e stampante, tappeto blu nel corridoio centrale
    name: 'studio', style: 0, rug: 1, wall: '.ww0...oww.',
    floor: ['TBB..b..KSa', '....DDD....', '....rrr...l', 'W.hhrrrhh..', 'W.mmrrrmm..', '..mmrrrmm.P', '..hhrrrhh..', 'Px........C'],
  },
  {
    // armadietti, bacheca coi post-it, stampante e schedario, lavagna a destra
    name: 'laboratorio', style: 1, wall: '.wwcc..1ww.',
    floor: ['CLL..b..SKP', '....DDD....', 'a..........', '..hh...hh.W', '..mm...mm.W', 'T.mm...mm..', '..hh...hh.x', 'P..........'],
  },
  {
    // quadri, lampada e piante alte, libreria a destra, tappeto verde
    name: 'creativo', style: 2, rug: 2, wall: '.ww2..o3ww.',
    floor: ['TlC..b..BBT', '....DDD....', '....rrr...a', 'W.hhrrrhh..', 'W.mmrrrmm..', '..mmrrrmm..', '..hhrrrhh.S', 'x.........P'],
  },
  {
    // armadietti e appendiabiti accanto alla porta, libreria a sinistra, tappeto ocra
    name: 'archivio', style: 3, rug: 3, wall: '.wwcc.o4ww.',
    floor: ['Px...b...lP', '....DDD....', '....rrr....', 'B.hhrrrhh.W', 'B.mmrrrmm.W', '..mmrrrmm..', '..hhrrrhh..', 'TL.......La'],
  },
];

/** 12 postazioni: 4 piante, con un angolo a destra (salottino, libreria, lavagna) */
const WORK12: readonly WorkLayout[] = [
  {
    // riunioni: stampante e schedario, quadro e bacheca, salottino con divani e tavolino
    name: 'riunioni', style: 4, wall: '.ww5o.cc..ww.ww',
    floor: [
      'CS...l..b..K..T',
      '.......DDD.....',
      'W..............',
      'W.hh.hh...hh.ss',
      '..mm.mm...mm.tt',
      '..mm.mm...mm.tt',
      'P.hh.hh...hh.ss',
      'x............aP',
    ],
  },
  {
    // open space: librerie ai lati, tappeto blu, lavagna a destra
    name: 'open space', style: 0, rug: 1, wall: '.ww0.oww...ww..',
    floor: [
      'TBB.....b...BBT',
      '.......DDD.....',
      '.......rrr....l',
      'W.hh.hhrrrhh...',
      'W.mm.mmrrrmm..W',
      '..mm.mmrrrmm..W',
      '..hh.hhrrrhh..P',
      'P............aC',
    ],
  },
  {
    name: 'laboratorio', style: 1, wall: '.wwcc..1..ww.ww',
    floor: [
      'CLL.....b..SK.P',
      '.......DDD.....',
      'a.............T',
      '..hh.hh...hh..W',
      '..mm.mm...mm..W',
      'T.mm.mm...mm...',
      '..hh.hh...hh..x',
      'P.............L',
    ],
  },
  {
    name: 'creativo', style: 2, rug: 2, wall: '.ww2.o3...ww.ww',
    floor: [
      'TlC.....b...BBT',
      '.......DDD.....',
      '.......rrr....a',
      'W.hh.hhrrrhh...',
      'W.mm.mmrrrmm...',
      '..mm.mmrrrmm..P',
      '..hh.hhrrrhh..S',
      'x............CP',
    ],
  },
];

export const WORK_LAYOUTS: Record<WorkRoomType, readonly WorkLayout[]> = { work4: WORK4, work8: WORK8, work12: WORK12 };
