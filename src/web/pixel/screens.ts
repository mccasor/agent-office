import type { AnimClock } from './clock';
import { FOOSBALL_FRAMES, PONG_FRAMES, SCREEN_FRAMES, SCREEN_THEMES, TV_FRAMES, type ScreenTheme } from './sprites';
import type { Furniture } from './types';

/**
 * Arredi animati della vista 2D (#89, #90, #108): schermi accesi a tema col ruolo di chi ci lavora, biliardino in
 * partita, TV della sala console accese e scambi al ping-pong. Puro: PixelOffice raccoglie chi usa cosa e chiede
 * qui fotogramma e variante di ogni arredo.
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
/** gioco sulla TV e pallina del ping-pong (al massimo ANIM_HZ): un tiro, mezzo giro di PONG_FRAMES, dura 0,75 s */
export const TV_FPS = 4;
export const PONG_FPS = 8;

/** Chi usa cosa in questo fotogramma. */
export interface FurnitureUse {
  /** cella del monitor (cellKey) -> area di chi ci digita davanti */
  screens: Map<string, string>;
  /** giocatori arrivati al biliardino */
  players: number;
  /** sale hobby (id della stanza) -> giocatori col controller davanti alle TV */
  gamers: Map<string, number>;
  /** sale hobby (id della stanza) -> giocatori arrivati al tavolo da ping-pong */
  pong: Map<string, number>;
}

/** sfasamento stabile per cella: gli schermi vicini non vanno all'unisono */
const phase = (x: number, z: number): number => ((x * 7 + z * 13) >>> 0) % SCREEN_FRAMES;

/**
 * Fotogramma e variante di un arredo all'istante dell'orologio delle animazioni. Monitor: spento (-1) se nessuno ci lavora, acceso con
 * il tema del ruolo se si vede, acceso generico se è di spalle (il retro non cambia). Biliardino: fermo (-1) senza
 * giocatori. TV: spenta (-1) se nella sala nessuno gioca col controller. Ping-pong: senza pallina (-1) finché i due
 * giocatori non sono entrambi al tavolo. Il resto: fermo, con la sua variante.
 */
export function furnitureLook(f: Furniture, use: FurnitureUse, clock: AnimClock): { frame: number; variant: number } {
  if (f.kind === 'monitor') {
    const area = use.screens.get(`${f.cell.x},${f.cell.z}`);
    if (area === undefined) return { frame: -1, variant: 0 };
    if (!screenVisible(f)) return { frame: 0, variant: 0 };
    const frame = (clock.frame(SCREEN_FPS) + phase(f.cell.x, f.cell.z)) % SCREEN_FRAMES;
    return { frame, variant: SCREEN_THEMES.indexOf(screenTheme(area)) };
  }
  if (f.kind === 'tv') {
    // accese tutte le TV della sala appena qualcuno gioca, sfasate tra loro
    const on = f.room !== null && (use.gamers.get(f.room) ?? 0) > 0;
    return { frame: on ? (clock.frame(TV_FPS) + phase(f.cell.x, f.cell.z)) % TV_FRAMES : -1, variant: f.variant ?? 0 };
  }
  if (f.kind === 'pingpong') {
    // la pallina va avanti e indietro solo con tutti e due i giocatori
    const on = f.room !== null && (use.pong.get(f.room) ?? 0) >= 2;
    return { frame: on ? clock.frame(PONG_FPS) % PONG_FRAMES : -1, variant: f.variant ?? 0 };
  }
  if (f.kind === 'foosball') {
    return { frame: use.players > 0 ? clock.frame(FOOSBALL_FPS) % FOOSBALL_FRAMES : -1, variant: f.variant ?? 0 };
  }
  return { frame: 0, variant: f.variant ?? 0 };
}
