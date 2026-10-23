import { contentSize, fitScale, MARGIN, viewportFor, type Viewport } from './draw';
import type { PixelPlan } from './types';

/**
 * Zoom e trascinamento della vista 2D (#87), puri. Lo zoom resta a scala intera (ogni pixel dello sprite è un
 * quadrato di scala×scala pixel fisici); sotto la scala "adatta" non si scende: lì vale il viewport centrato di
 * viewportFor. Coordinate dello schermo in pixel fisici (backing store del canvas), della pianta in pixel a scala 1.
 */

/** ingrandimento massimo in pixel CSS per pixel dello sprite: una cella diventa 128 px CSS */
export const MAX_CSS_SCALE = 8;
/** rotella: delta (in pixel) che vale un passo di zoom; il pinch del trackpad manda delta piccoli e fitti */
export const WHEEL_STEP = 60;
/** spostamento (px CSS) oltre cui un clic diventa un trascinamento */
export const DRAG_THRESHOLD = 4;

/** Stato della camera: scala scelta (null = adatta alla finestra) e punto della pianta al centro dello schermo. */
export interface Camera {
  scale: number | null;
  cx: number;
  cy: number;
}

export const FIT: Camera = { scale: null, cx: 0, cy: 0 };

/** superficie del canvas in pixel fisici, con il devicePixelRatio */
export interface Screen {
  w: number;
  h: number;
  dpr: number;
}

type Plan = Pick<PixelPlan, 'width' | 'depth'>;

/** spazio lasciato a destra della pianta quando è adattata (vedi viewportFor) */
const gutterOf = (screen: Screen) => Math.round(16 * screen.dpr);

/** scale ammesse: da "adatta" a MAX_CSS_SCALE (mai sotto "adatta") */
export function scaleLimits(screen: Screen, plan: Plan): { min: number; max: number } {
  const { w, h } = contentSize(plan);
  const min = fitScale(screen.w, screen.h, w, h);
  return { min, max: Math.max(min, Math.round(MAX_CSS_SCALE * screen.dpr)) };
}

/** una dimensione: contenuto più piccolo dello schermo centrato, altrimenti senza bordi vuoti ai lati */
function clampAxis(origin: number, size: number, view: number): number {
  if (size <= view) return Math.floor((view - size) / 2);
  return Math.min(0, Math.max(view - size, origin));
}

/** Dove disegnare con questa camera: viewport adattato, oppure scala scelta col centro richiesto e i limiti. */
export function cameraViewport(cam: Camera, screen: Screen, plan: Plan): Viewport {
  const { min, max } = scaleLimits(screen, plan);
  if (cam.scale === null || cam.scale <= min) return viewportFor(screen.w, screen.h, plan, gutterOf(screen));
  const scale = Math.min(cam.scale, max);
  const { w, h } = contentSize(plan);
  // origine del contenuto (margini compresi) con il punto (cx, cy) al centro, poi riportata nei limiti
  const left = clampAxis(Math.round(screen.w / 2 - (cam.cx + MARGIN.side) * scale), w * scale, screen.w);
  const top = clampAxis(Math.round(screen.h / 2 - (cam.cy + MARGIN.top) * scale), h * scale, screen.h);
  return { scale, ox: left + MARGIN.side * scale, oy: top + MARGIN.top * scale };
}

/** punto dello schermo (pixel fisici) -> punto della pianta (pixel a scala 1) */
export const toPlan = (view: Viewport, px: number, py: number): { x: number; y: number } => ({
  x: (px - view.ox) / view.scale,
  y: (py - view.oy) / view.scale,
});

/** camera che riproduce un viewport: il centro dello schermo nella pianta */
function cameraOf(view: Viewport, screen: Screen, scale: number | null): Camera {
  if (scale === null) return FIT;
  const c = toPlan(view, screen.w / 2, screen.h / 2);
  return { scale, cx: c.x, cy: c.y };
}

/** scala successiva di `steps` passi (positivi = ingrandisce): +1 da vicino, circa +25% da lontano */
export function stepScale(scale: number, steps: number): number {
  let s = scale;
  for (let i = 0; i < Math.abs(steps); i++) {
    s = steps > 0 ? Math.max(s + 1, Math.round(s * 1.25)) : Math.min(s - 1, Math.round(s / 1.25));
  }
  return s;
}

/**
 * Zoom di `steps` passi tenendo fermo il punto dello schermo (ax, ay): il centro per i pulsanti, il cursore per la
 * rotella. Tornati alla scala "adatta" la camera torna a seguire la finestra.
 */
export function zoomAt(cam: Camera, screen: Screen, plan: Plan, steps: number, ax = screen.w / 2, ay = screen.h / 2): Camera {
  const { min, max } = scaleLimits(screen, plan);
  const view = cameraViewport(cam, screen, plan);
  const scale = Math.min(max, Math.max(min, stepScale(view.scale, steps)));
  if (scale <= min) return FIT;
  // stesso punto della pianta sotto l'ancora, poi i limiti
  const p = toPlan(view, ax, ay);
  const next: Viewport = { scale, ox: Math.round(ax - p.x * scale), oy: Math.round(ay - p.y * scale) };
  const free = cameraOf(next, screen, scale);
  return cameraOf(cameraViewport(free, screen, plan), screen, scale);
}

/** Trascinamento di (dx, dy) pixel fisici: la pianta segue il cursore, entro i limiti. Adattata non si sposta. */
export function panBy(cam: Camera, screen: Screen, plan: Plan, dx: number, dy: number): Camera {
  if (!isZoomed(cam, screen, plan)) return cam;
  const view = cameraViewport(cam, screen, plan);
  const moved = { ...view, ox: view.ox + dx, oy: view.oy + dy };
  return cameraOf(cameraViewport(cameraOf(moved, screen, view.scale), screen, plan), screen, view.scale);
}

/** ingrandita oltre "adatta": si può trascinare */
export function isZoomed(cam: Camera, screen: Screen, plan: Plan): boolean {
  return cam.scale !== null && cam.scale > scaleLimits(screen, plan).min;
}

/** la pianta (con i margini) esce dallo schermo: c'è qualcosa da trascinare */
export function canPan(cam: Camera, screen: Screen, plan: Plan): boolean {
  if (!isZoomed(cam, screen, plan)) return false;
  const { scale } = cameraViewport(cam, screen, plan);
  const { w, h } = contentSize(plan);
  return w * scale > screen.w || h * scale > screen.h;
}
