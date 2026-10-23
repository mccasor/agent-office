import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraFit, VIEW_DIR } from './camera';
import { createLayout } from './layout';

/** vertici del box proiettati in NDC con una vera camera three */
function ndc(width: number, depth: number, height: number, fov: number, aspect: number): Vector3[] {
  const fit = cameraFit(width, depth, height, fov, aspect);
  const cam = new PerspectiveCamera(fov, aspect, 0.1, 1000);
  cam.position.set(...fit.position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const out: Vector3[] = [];
  for (const x of [-width / 2, width / 2])
    for (const y of [0, height]) for (const z of [-depth / 2, depth / 2]) out.push(new Vector3(x, y, z).project(cam));
  return out;
}

describe('cameraFit', () => {
  const aspects = [390 / 800, 900 / 600, 1440 / 900, 3];

  it('tiene tutto il layout in inquadratura con ogni aspect e numero di agenti', () => {
    for (const n of [0, 8, 24, 40])
      for (const aspect of aspects) {
        const l = createLayout(n);
        const pts = ndc(l.width, l.depth, 2.2, 38, aspect);
        for (const p of pts) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-9);
        }
        // aderente: almeno un vertice tocca il margine (non solo "abbastanza lontano")
        expect(Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))).toBeCloseTo(1 / 1.08, 6);
      }
  });

  it('mantiene la direzione di vista e si allontana sui viewport stretti', () => {
    const l = createLayout(8);
    const wide = cameraFit(l.width, l.depth, 2.2, 38, 1.6);
    const narrow = cameraFit(l.width, l.depth, 2.2, 38, 390 / 800);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
    const len = Math.hypot(...VIEW_DIR);
    narrow.position.forEach((c, i) => expect(c / narrow.distance).toBeCloseTo(VIEW_DIR[i]! / len, 9));
  });

  it('si allontana quando il layout cresce', () => {
    const a = createLayout(8);
    const b = createLayout(40);
    expect(cameraFit(b.width, b.depth, 2.2, 38, 1.5).distance).toBeGreaterThan(cameraFit(a.width, a.depth, 2.2, 38, 1.5).distance);
  });
});
