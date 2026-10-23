import { FOOSBALL_FRAMES } from './sprites';
import type { Furniture } from './types';

/**
 * Arredi animati della vista 2D (#89): schermi accesi di chi ci lavora e biliardino in partita. Puro: PixelOffice
 * raccoglie chi usa cosa e chiede qui fotogramma e variante di ogni arredo.
 */

/** fotogrammi al secondo degli schermi e della partita */
export const SCREEN_FPS = 2;
export const FOOSBALL_FPS = 6;

/** Chi usa cosa in questo fotogramma. */
export interface FurnitureUse {
  /** cella del monitor (cellKey) -> area di chi ci digita davanti */
  screens: Map<string, string>;
  /** giocatori arrivati al biliardino */
  players: number;
}

/**
 * Fotogramma e variante di un arredo all'istante `now` (s). Monitor: spento (-1) se nessuno ci lavora, altrimenti
 * acceso. Biliardino: fermo (-1) senza giocatori. Il resto: fermo, con la sua variante.
 */
export function furnitureLook(f: Furniture, use: FurnitureUse, now: number): { frame: number; variant: number } {
  if (f.kind === 'monitor') {
    const area = use.screens.get(`${f.cell.x},${f.cell.z}`);
    return { frame: area === undefined ? -1 : Math.floor(now * SCREEN_FPS), variant: 0 };
  }
  if (f.kind === 'foosball') {
    return { frame: use.players > 0 ? Math.floor(now * FOOSBALL_FPS) % FOOSBALL_FRAMES : -1, variant: f.variant ?? 0 };
  }
  return { frame: 0, variant: f.variant ?? 0 };
}
