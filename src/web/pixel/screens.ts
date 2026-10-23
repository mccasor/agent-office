import { FOOSBALL_FRAMES, SCREEN_FRAMES, SCREEN_THEMES, type ScreenTheme } from './sprites';
import type { Furniture } from './types';

/**
 * Arredi animati della vista 2D (#89, #90): schermi accesi a tema col ruolo di chi ci lavora e biliardino in
 * partita. Puro: PixelOffice raccoglie chi usa cosa e chiede qui fotogramma e variante di ogni arredo.
 */

/** tema dello schermo per area di lavoro (WorkArea); aree sconosciute o nuove: lo schermo di sempre */
const AREA_THEMES: Readonly<Record<string, ScreenTheme>> = {
  backend: 'matrix',
  frontend: 'code',
  devops: 'terminal',
  test: 'tests',
  design: 'design',
  docs: 'docs',
  research: 'chart',
  architecture: 'diagram',
  other: 'generic',
};

export function screenTheme(area: string | null | undefined): ScreenTheme {
  return (area && Object.hasOwn(AREA_THEMES, area) ? AREA_THEMES[area] : undefined) ?? 'generic';
}

/** si vede lo schermo solo se è rivolto verso chi guarda (a sud); gli altri mostrano il retro */
export const screenVisible = (f: Pick<Furniture, 'kind' | 'facing'>): boolean => f.kind === 'monitor' && f.facing === 'down';

/** fotogrammi al secondo degli schermi e della partita */
export const SCREEN_FPS = 4;
export const FOOSBALL_FPS = 6;

/** Chi usa cosa in questo fotogramma. */
export interface FurnitureUse {
  /** cella del monitor (cellKey) -> area di chi ci digita davanti */
  screens: Map<string, string>;
  /** giocatori arrivati al biliardino */
  players: number;
}

/** sfasamento stabile per cella: gli schermi vicini non vanno all'unisono */
const phase = (x: number, z: number): number => ((x * 7 + z * 13) >>> 0) % SCREEN_FRAMES;

/**
 * Fotogramma e variante di un arredo all'istante `now` (s). Monitor: spento (-1) se nessuno ci lavora, acceso con
 * il tema del ruolo se si vede, acceso generico se è di spalle (il retro non cambia). Biliardino: fermo (-1) senza
 * giocatori. Il resto: fermo, con la sua variante.
 */
export function furnitureLook(f: Furniture, use: FurnitureUse, now: number): { frame: number; variant: number } {
  if (f.kind === 'monitor') {
    const area = use.screens.get(`${f.cell.x},${f.cell.z}`);
    if (area === undefined) return { frame: -1, variant: 0 };
    if (!screenVisible(f)) return { frame: 0, variant: 0 };
    const frame = (Math.floor(now * SCREEN_FPS) + phase(f.cell.x, f.cell.z)) % SCREEN_FRAMES;
    return { frame, variant: SCREEN_THEMES.indexOf(screenTheme(area)) };
  }
  if (f.kind === 'foosball') {
    return { frame: use.players > 0 ? Math.floor(now * FOOSBALL_FPS) % FOOSBALL_FRAMES : -1, variant: f.variant ?? 0 };
  }
  return { frame: 0, variant: f.variant ?? 0 };
}
