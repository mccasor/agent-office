import { describe, expect, it } from 'vitest';
import { advanceAlongPath, pathLength, START_GAP, StartQueue, WALK_SPEED } from './motion';

const path = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 2, z: 0 },
  { x: 2, z: 1 },
];

describe('advanceAlongPath', () => {
  it('velocità costante dichiarata', () => {
    expect(WALK_SPEED).toBe(3.2);
  });

  it('inizio del path', () => {
    const r = advanceAlongPath(path, 0);
    expect(r).toMatchObject({ x: 0, z: 0, done: false });
    expect(r.direction).toBeCloseTo(Math.PI / 2); // verso +x
  });

  it('interpola lungo i segmenti', () => {
    const r = advanceAlongPath(path, 1.5);
    expect(r.x).toBeCloseTo(1.5);
    expect(r.z).toBeCloseTo(0);
    expect(r.done).toBe(false);
    const r2 = advanceAlongPath(path, 2.25);
    expect(r2.x).toBeCloseTo(2);
    expect(r2.z).toBeCloseTo(0.25);
    expect(r2.direction).toBeCloseTo(0); // verso +z
  });

  it('done a fine path, clamp oltre la lunghezza', () => {
    expect(pathLength(path)).toBe(3);
    expect(advanceAlongPath(path, 3)).toMatchObject({ x: 2, z: 1, done: true });
    const r2 = advanceAlongPath(path, 99);
    expect(r2).toMatchObject({ x: 2, z: 1, done: true });
    expect(r2.direction).toBeCloseTo(0);
  });

  it('distanza negativa = inizio', () => {
    expect(advanceAlongPath(path, -1)).toMatchObject({ x: 0, z: 0, done: false });
  });

  it('path degeneri', () => {
    expect(advanceAlongPath([], 1)).toMatchObject({ x: 0, z: 0, done: true });
    expect(advanceAlongPath([{ x: 3, z: 4 }], 0)).toMatchObject({ x: 3, z: 4, done: true });
  });

  it('direzioni: -x e -z', () => {
    const p = [
      { x: 2, z: 2 },
      { x: 1, z: 2 },
      { x: 1, z: 1 },
    ];
    expect(advanceAlongPath(p, 0.5).direction).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(advanceAlongPath(p, 1.5).direction)).toBeCloseTo(Math.PI);
  });

  it('supporta punti frazionari (ripianificazione a metà segmento)', () => {
    const p = [
      { x: 0.4, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 1 },
    ];
    expect(pathLength(p)).toBeCloseTo(1.4);
    expect(advanceAlongPath(p, 0.2).x).toBeCloseTo(0.2);
  });
});

describe('StartQueue', () => {
  it('chi parte insieme è distanziato di START_GAP; dopo una pausa si riparte subito', () => {
    const q = new StartQueue();
    expect(q.slot(10)).toBe(10);
    expect(q.slot(10)).toBeCloseTo(10 + START_GAP);
    expect(q.slot(10.5)).toBeCloseTo(10 + 2 * START_GAP);
    expect(q.slot(100)).toBe(100);
  });
});
