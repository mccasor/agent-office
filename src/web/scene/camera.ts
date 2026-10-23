/**
 * Inquadratura della vista 3D: distanza della camera perché la bounding box dell'ufficio stia tutta nel frustum,
 * dato fov verticale e aspect del canvas. La camera guarda l'origine (centro del pavimento) da una direzione fissa.
 */

/** vista a 3/4 dall'angolo sud-est (non normalizzata): la stessa di prima, solo la distanza si adatta */
export const VIEW_DIR: readonly [number, number, number] = [0.56, 0.66, 0.72];
/** altezza delle pareti più alte (WALL_H in Office.tsx): il box da inquadrare */
export const OFFICE_H = 2.2;
/** margine attorno all'ufficio: lascia un po' d'aria ai bordi e sotto i pannelli dell'HUD */
const MARGIN = 1.08;

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface CameraFit { position: Vec; distance: number }

/**
 * Posizione della camera (che guarda l'origine da `dir`) con dentro tutto il box `width`×`height`×`depth`
 * centrato in x/z e appoggiato su y = 0. `fov` è il campo verticale in gradi, `aspect` = larghezza/altezza.
 */
export function cameraFit(width: number, depth: number, height: number, fov: number, aspect: number, dir: readonly number[] = VIEW_DIR): CameraFit {
  const back = norm([dir[0]!, dir[1]!, dir[2]!]);
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  const tanV = Math.tan(((fov / 2) * Math.PI) / 180) / MARGIN;
  const tanH = tanV * aspect;
  let distance = 0;
  for (const x of [-width / 2, width / 2])
    for (const y of [0, height])
      for (const z of [-depth / 2, depth / 2]) {
        const p: Vec = [x, y, z];
        // in vista il vertice è a profondità distance - p·back: deve stare entro tan(fov/2) in entrambi gli assi
        const need = Math.max(Math.abs(dot(p, right)) / tanH, Math.abs(dot(p, up)) / tanV) + dot(p, back);
        distance = Math.max(distance, need);
      }
  return { position: [back[0] * distance, back[1] * distance, back[2] * distance], distance };
}
