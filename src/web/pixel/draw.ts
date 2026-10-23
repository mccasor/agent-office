import { CHAR_H, type PixelLook } from './sprites';
import { TILE, WALL_DECOR, type Cell, type Facing, type Furniture, type FurnitureKind, type PixelPlan, type Pose, type Spot } from './types';

/**
 * Geometria e ordine di disegno della vista 2D, puri (il canvas sta in PixelOffice.tsx). Coordinate in pixel a
 * scala 1 dentro la pianta; la scala intera e il centramento si applicano solo al momento di disegnare.
 */

/** margine attorno alla pianta: in alto c'è posto per il fumetto e l'etichetta dei boss della prima fila */
export const MARGIN = { top: 28, side: 8, bottom: 8 } as const;

/** dimensioni del contenuto (pianta più margini) in pixel a scala 1 */
export function contentSize(plan: Pick<PixelPlan, 'width' | 'depth'>): { w: number; h: number } {
  return { w: plan.width * TILE + 2 * MARGIN.side, h: plan.depth * TILE + MARGIN.top + MARGIN.bottom };
}

/**
 * Scala intera più grande che fa stare il contenuto nella superficie (in pixel fisici), almeno 1: ogni pixel
 * dello sprite diventa un quadrato di scala×scala pixel fisici, nitido anche sui retina.
 */
export function fitScale(viewW: number, viewH: number, contentW: number, contentH: number): number {
  return Math.max(1, Math.floor(Math.min(viewW / contentW, viewH / contentH)));
}

/** dove disegnare: scala e origine (pixel fisici) della pianta, centrata */
export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
}

/**
 * Pianta centrata in verticale; in orizzontale lo spazio avanzato va quasi tutto a sinistra (resta `gutter` a
 * destra), dove il pannello delle istanze altrimenti coprirebbe la prima stanza.
 */
export function viewportFor(viewW: number, viewH: number, plan: Pick<PixelPlan, 'width' | 'depth'>, gutter = 0): Viewport {
  const { w, h } = contentSize(plan);
  const scale = fitScale(viewW, viewH, w, h);
  const slack = viewW - w * scale;
  return {
    scale,
    ox: Math.max(Math.floor(slack / 2), slack - gutter) + MARGIN.side * scale,
    oy: Math.floor((viewH - h * scale) / 2) + MARGIN.top * scale,
  };
}

/** piedi di un personaggio in una cella (anche frazionaria): centro in x, quasi in fondo alla cella in y */
export function feetOf(pos: Cell): { x: number; y: number } {
  return { x: Math.round(pos.x * TILE + TILE / 2), y: Math.round(pos.z * TILE + TILE - 2) };
}

/** arredi piatti, sotto a tutto (anche ai personaggi): tappeti e quanto è appeso alle pareti */
export const FLAT = new Set<FurnitureKind>(['rug', ...WALL_DECOR]);

/** a parità di riga: prima i piani delle scrivanie, poi i monitor sopra, poi il resto, infine i personaggi */
const TIE: Partial<Record<FurnitureKind, number>> = { desk: 0, 'boss-desk': 0, 'coffee-table': 0, monitor: 1 };
const ACTOR_TIE = 3;

/** profondità di un arredo: la riga della sua base (la più a sud dell'impronta) */
export const furnitureDepth = (f: Pick<Furniture, 'cell' | 'h'>): number => f.cell.z + f.h - 1;

export type SpriteRef =
  | { type: 'furniture'; kind: FurnitureKind; facing: Facing; w: number; h: number; frame: number; variant: number }
  | { type: 'character'; look: PixelLook; pose: Pose; facing: Facing; frame: number }
  | { type: 'shadow' }
  | { type: 'selection' };

export interface DrawOp {
  /** riga (anche frazionaria) dei piedi o della base: chi ha la riga più grande è più vicino e copre gli altri */
  depth: number;
  tie: number;
  /** dove va l'ancora dello sprite, in pixel a scala 1 */
  x: number;
  y: number;
  sprite: SpriteRef;
}

export function furnitureOp(f: Furniture, frame = 0, variant = f.variant ?? 0): DrawOp {
  return {
    depth: furnitureDepth(f),
    tie: TIE[f.kind] ?? 2,
    x: f.cell.x * TILE,
    y: f.cell.z * TILE,
    sprite: { type: 'furniture', kind: f.kind, facing: f.facing, w: f.w, h: f.h, frame, variant },
  };
}

export interface ActorDraw {
  id: string;
  pos: Cell;
  look: PixelLook;
  pose: Pose;
  facing: Facing;
  frame: number;
  selected: boolean;
}

/** ombra, anello di selezione e personaggio, con la stessa profondità (i piedi): restano attaccati nell'ordine */
export function actorOps(a: ActorDraw): DrawOp[] {
  const { x, y } = feetOf(a.pos);
  const base = { depth: a.pos.z, tie: ACTOR_TIE, x, y };
  return [
    { ...base, y: y - 1, sprite: { type: 'shadow' } },
    ...(a.selected ? [{ ...base, sprite: { type: 'selection' } } satisfies DrawOp] : []),
    { ...base, sprite: { type: 'character', look: a.look, pose: a.pose, facing: a.facing, frame: a.frame } },
  ];
}

/** Ordine di disegno: per profondità, poi per tie; stabile (Array.sort lo è), così ombra e personaggio restano in fila. */
export function sortByDepth(ops: DrawOp[]): DrawOp[] {
  return [...ops].sort((a, b) => a.depth - b.depth || a.tie - b.tie);
}

const STEP: Record<Facing, Cell> = { up: { x: 0, z: -1 }, down: { x: 0, z: 1 }, left: { x: -1, z: 0 }, right: { x: 1, z: 0 } };
const OPPOSITE: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** cella davanti a chi occupa il posto (la scrivania col monitor) */
export const inFront = (spot: Pick<Spot, 'cell' | 'facing'>): Cell => ({
  x: spot.cell.x + STEP[spot.facing].x,
  z: spot.cell.z + STEP[spot.facing].z,
});

export const cellKey = (c: Cell): string => `${c.x},${c.z}`;

/**
 * Arredi da disegnare sopra il pavimento: quelli della pianta più un monitor sulla scrivania di ogni boss, davanti
 * alla sua sedia e con lo schermo verso di lui.
 */
export function sceneFurniture(plan: PixelPlan): Furniture[] {
  const monitors: Furniture[] = plan.rooms.flatMap((r) =>
    r.boss ? [{ kind: 'monitor', cell: inFront(r.boss), w: 1, h: 1, facing: OPPOSITE[r.boss.facing], room: r.id } satisfies Furniture] : [],
  );
  return [...plan.furniture, ...monitors];
}

/** la faccia di una parete si vede se sotto c'è una cella della pianta che non è parete */
export function wallFaceVisible(plan: Pick<PixelPlan, 'tiles' | 'depth'>, x: number, z: number): boolean {
  const below = plan.tiles[z + 1]?.[x];
  return below !== undefined && below !== 'wall' && below !== 'void';
}

/** rettangolo cliccabile di un personaggio (pixel a scala 1), un po' più stretto dello sprite */
export interface HitRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

export function actorRect(id: string, pos: Cell): HitRect {
  const { x, y } = feetOf(pos);
  return { id, x: x - 6, y: y - (CHAR_H - 3), w: 12, h: CHAR_H - 1, depth: pos.z };
}

/** Il personaggio sotto il punto (pixel a scala 1): tra più sovrapposti vince il più vicino (disegnato sopra). */
export function hitTest(rects: readonly HitRect[], px: number, py: number): string | null {
  let best: HitRect | null = null;
  for (const r of rects) {
    if (px < r.x || px >= r.x + r.w || py < r.y || py >= r.y + r.h) continue;
    if (!best || r.depth >= best.depth) best = r;
  }
  return best?.id ?? null;
}
