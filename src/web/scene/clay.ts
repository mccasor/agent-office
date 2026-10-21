import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterialParameters,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Stile "clay" della scena, coerente con i personaggi: forme morbide, smooth shading, materiali opachi.
 * I mobili ripetuti (scrivanie, sedie, fioriere...) sono "cotti" con bake() in un'unica geometria a colori per vertice:
 * un solo draw call per mobile invece di uno per pezzo, così si possono usare più segmenti a parità di costo.
 */

export type V3 = [number, number, number];

/** Materiale opaco e liscio (niente flatShading), come quello dei personaggi. */
export const clay = (color: string, extra: MeshStandardMaterialParameters = {}): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

/** Materiale dei mobili cotti con bake(): il colore sta nei vertici. */
export const BAKED = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

/**
 * Parallelepipedo a spigoli arrotondati di misure reali (il raggio non si deforma come scalando un cubo unitario).
 * I pezzi sottili usano un solo segmento di raccordo: a quella scala basta e risparmia triangoli.
 */
export const rbox = (w: number, h: number, d: number, r: number, segments = Math.min(w, h, d) < 0.05 ? 1 : 2): BufferGeometry =>
  new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));

/** Capsula di raggio `r` e altezza totale `h` lungo y. */
export const capsule = (r: number, h: number, radial = 10): BufferGeometry => new CapsuleGeometry(r, Math.max(h - 2 * r, 0), 3, radial);

/**
 * Disco/cilindro con il bordo arrotondato (profilo ruotato): piani di tavolini, basi, vasi. `rTop` per i tronchi di cono.
 * Raccordi piccoli con meno passi (basi di lampade e monitor, ripetute per ogni scrivania).
 */
export function rcyl(r: number, h: number, bevel: number, radial = 24, rTop = r, arcSteps = bevel < 0.012 ? 2 : 4): BufferGeometry {
  const pts: Vector2[] = [new Vector2(0, -h / 2)];
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= arcSteps; i++) {
      const a = a0 + (i / arcSteps) * (Math.PI / 2);
      pts.push(new Vector2(cx + Math.cos(a) * bevel, cy + Math.sin(a) * bevel));
    }
  };
  arc(r - bevel, -h / 2 + bevel, -Math.PI / 2);
  arc(rTop - bevel, h / 2 - bevel, 0);
  pts.push(new Vector2(0, h / 2));
  return new LatheGeometry(pts, radial);
}

/** Primitive unitarie lisce, da scalare nei pezzi (anche in modo non uniforme: le normali restano corrette). */
export const UNIT = {
  sphere: new SphereGeometry(0.5, 16, 12),
  /** per le bolle di fogliame, ripetute centinaia di volte */
  bubble: new SphereGeometry(0.5, 12, 8),
  /** dettagli piccoli (rotelle, snodi): pochi segmenti bastano */
  small: new SphereGeometry(0.5, 10, 6),
  cyl: new CylinderGeometry(0.5, 0.5, 1, 18),
};

/** Un pezzo di mobile: geometria, colore e trasformazione locale. */
export interface Part { g: BufferGeometry; c: string; m: Matrix4 }

const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpV = new Vector3();
const tmpS = new Vector3();

function matrix(p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1): Matrix4 {
  const scale = typeof s === 'number' ? tmpS.setScalar(s) : tmpS.set(...s);
  return new Matrix4().compose(tmpV.set(...p), tmpQ.setFromEuler(tmpE.set(...r)), scale);
}

export const part = (g: BufferGeometry, c: string, p?: V3, r?: V3, s?: number | V3): Part => ({ g, c, m: matrix(p, r, s) });

/** Sposta/ruota un gruppo di pezzi come farebbe un <group> padre. */
export function move(parts: Part[], p: V3, r?: V3): Part[] {
  const parent = matrix(p, r);
  return parts.map((x) => ({ ...x, m: parent.clone().multiply(x.m) }));
}

/** Fonde i pezzi in un'unica geometria non indicizzata con attributo `color` (da usare con BAKED). */
export function bake(parts: Part[]): BufferGeometry {
  const color = new Color();
  const list = parts.map(({ g, c, m }) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal') x.deleteAttribute(name);
    x.clearGroups();
    x.applyMatrix4(m);
    color.set(c);
    const n = x.attributes.position!.count;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([color.r, color.g, color.b], i * 3);
    x.setAttribute('color', new BufferAttribute(rgb, 3));
    return x;
  });
  const out = mergeGeometries(list);
  if (!out) throw new Error('bake: geometrie incompatibili');
  out.computeBoundingSphere();
  return out;
}
