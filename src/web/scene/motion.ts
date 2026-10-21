import type { Cell } from './layout';

/** unità (celle) al secondo */
export const WALK_SPEED = 2.5;

export interface PathPosition {
  x: number;
  z: number;
  /** radianti (rotation.y, modello rivolto a +z): direzione del segmento corrente */
  direction: number;
  /** true quando distanceTravelled >= lunghezza del path */
  done: boolean;
}

export function pathLength(path: readonly Cell[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
  }
  return len;
}

/** Posizione dopo aver percorso `distanceTravelled` unità lungo il path (clamp a [0, lunghezza]). Pura. */
export function advanceAlongPath(path: readonly Cell[], distanceTravelled: number): PathPosition {
  const first = path[0];
  if (!first) return { x: 0, z: 0, direction: 0, done: true };
  let rest = Math.max(0, distanceTravelled);
  let direction = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const seg = Math.hypot(dx, dz);
    if (seg === 0) continue;
    direction = Math.atan2(dx, dz);
    if (rest < seg) {
      const t = rest / seg;
      return { x: a.x + dx * t, z: a.z + dz * t, direction, done: false };
    }
    rest -= seg;
  }
  const last = path[path.length - 1]!;
  return { x: last.x, z: last.z, direction, done: true };
}
