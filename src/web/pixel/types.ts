/**
 * Vista 2D in pixel art (#71): contratto comune tra pianta (plan.ts), assegnazione (model.ts), sprite (sprites.ts)
 * e rendering (PixelOffice.tsx).
 *
 * Griglia di celle quadrate da TILE pixel (a scala 1), vista dall'alto con angolazione fissa a 3/4: le pareti nord
 * mostrano la faccia, i personaggi sono più alti di una cella. Coordinate: x verso est, z verso sud (verso il basso
 * dello schermo), le stesse di findPath (path.ts) e advanceAlongPath (motion.ts).
 */
import type { AgentState } from '../../shared/types';
import type { Cell } from './path';

export type { Cell };

/** lato di una cella in pixel, a scala 1 */
export const TILE = 16;

/** verso cui guarda un personaggio o un arredo */
export type Facing = 'down' | 'up' | 'left' | 'right';

/** stanze per le istanze di Claude Code */
export const INSTANCE_ROOMS = 5;
/** postazioni per gli agenti in ogni stanza istanza (oltre alla scrivania del boss) */
export const DESKS_PER_ROOM = 8;

export type TileKind =
  /** fuori dalla pianta */
  | 'void'
  /** pavimento delle stanze istanza */
  | 'floor'
  /** pavimento della sala relax */
  | 'lounge'
  /** pavimento del corridoio */
  | 'corridor'
  /** parete: la faccia è visibile se la cella sotto non è parete */
  | 'wall'
  /** vano porta (calpestabile) */
  | 'door';

/** Un posto dove un personaggio si ferma: postazione, scrivania del boss, posto in sala relax, posto in piedi. */
export interface Spot {
  /**
   * stabile e unico nella pianta: 'r<stanza>-desk-<n>', 'r<stanza>-boss', 'foos-<n>' (al biliardino), 'lounge-<n>',
   * 'stand-<n>', 'hall-<n>' (corridoio)
   */
  id: string;
  cell: Cell;
  /** verso cui guarda chi occupa il posto (la scrivania, il tavolino) */
  facing: Facing;
  /** seduto (sedia, divano) o in piedi */
  seated: boolean;
}

export interface Room {
  /** 'room-0'..'room-4' per le istanze, 'lounge' per la sala relax */
  id: string;
  kind: 'instance' | 'lounge';
  /** rettangolo interno calpestabile o arredato, pareti escluse, in celle */
  x: number;
  z: number;
  w: number;
  h: number;
  /** vano porta sul corridoio */
  door: Cell;
  /** stanze istanza: DESKS_PER_ROOM postazioni, nell'ordine in cui si occupano; sala relax: [] */
  desks: Spot[];
  /** stanze istanza: scrivania del boss (Claude stesso); sala relax: null */
  boss: Spot | null;
  /** sala relax: biliardino, posti a sedere e poi in piedi, nell'ordine in cui si occupano; stanze istanza: [] */
  seats: Spot[];
}

export type FurnitureKind =
  | 'desk'
  | 'boss-desk'
  | 'chair'
  | 'monitor'
  | 'plant'
  | 'sofa'
  | 'armchair'
  | 'coffee-table'
  | 'coffee-machine'
  | 'water-cooler'
  | 'bookshelf'
  | 'rug'
  | 'whiteboard'
  | 'window'
  // sulle pareti (piatti come le finestre)
  | 'painting'
  | 'clock'
  | 'corkboard'
  | 'poster'
  // arredi minori
  | 'floor-lamp'
  | 'cabinet'
  | 'locker'
  | 'printer'
  | 'bin'
  | 'coat-rack'
  | 'plant-tall'
  | 'cactus'
  // sala relax
  | 'foosball'
  | 'vending'
  | 'fridge'
  | 'arcade';

/** arredi appesi alle pareti: stanno sulla riga di parete, piatti, non bloccano nulla */
export const WALL_DECOR: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['window', 'painting', 'clock', 'corkboard', 'poster']);

/** Un arredo: occupa w×h celle a partire da `cell` (angolo nord-ovest). */
export interface Furniture {
  kind: FurnitureKind;
  cell: Cell;
  w: number;
  h: number;
  facing: Facing;
  /** stanza di appartenenza (id di Room), null per il corridoio */
  room: string | null;
  /** variante dello sprite (colori del tappeto, soggetto del quadro...), 0 se assente */
  variant?: number;
}

export interface PixelPlan {
  /** dimensioni in celle */
  width: number;
  depth: number;
  /** tiles[z][x] */
  tiles: TileKind[][];
  /**
   * styles[z][x]: tinta di pavimento e pareti, l'indice della stanza in `rooms` (le pareti con la faccia visibile
   * prendono quella della stanza sotto); -1 per il corridoio e il resto
   */
  styles: number[][];
  /** walkable[z][x]: pavimenti, porte e posti; non pareti né arredi (le sedie dei posti sì) */
  walkable: boolean[][];
  /** stanze istanza (INSTANCE_ROOMS, da 'room-0') e poi la sala relax */
  rooms: Room[];
  furniture: Furniture[];
  /** cella d'ingresso dall'esterno, nel corridoio: da qui entrano ed escono i personaggi */
  entrance: Cell;
  /** posti in piedi nel corridoio per chi non trova posto (stanza piena, oltre le 5 istanze) */
  overflow: Spot[];
}

/** Un personaggio da disegnare: un subagente o Claude stesso (boss) di un'istanza. */
export interface PixelActor {
  /** id dell'agente; per il boss `boss:<sessionId>`, come in boss.ts */
  id: string;
  agent: AgentState;
  sessionId: string;
  boss: boolean;
  /** dove deve andare: un posto, oppure null = esce dall'ingresso */
  target: Spot | null;
  /** bloccato in attesa dell'utente (il boss per la sessione, il subagente per sé): fumetto "!" sopra */
  waiting: boolean;
}

/** Assegnazioni stabili tra uno snapshot e il successivo. */
export interface PixelSeating {
  /** sessionId -> indice della stanza istanza (0..INSTANCE_ROOMS-1) */
  rooms: Record<string, number>;
  /** id dell'attore -> id dello Spot occupato (postazione, sala relax o corridoio) */
  spots: Record<string, string>;
}

export interface PixelModel extends PixelSeating {
  plan: PixelPlan;
  actors: PixelActor[];
  /** sessioni attive senza stanza (oltre INSTANCE_ROOMS), dalla più recente */
  roomless: string[];
}

/** Pose di un personaggio, una riga di fotogrammi per ciascuna; play: in piedi alle stecche del biliardino. */
export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'play';
