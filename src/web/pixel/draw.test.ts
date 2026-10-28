import { describe, expect, it } from 'vitest';
import { AnimClock } from './clock';
import {
  actorOps, actorRect, contentSize, FLAT, fitScale, furnitureOp, hitTest, inFront, sameFrame, sceneFurniture, sortByDepth, viewportFor,
  wallFaceVisible, type ActorDraw, type DrawOp,
} from './draw';
import { frameAt, POSE_FPS } from './actors';
import { createPlan } from './plan';
import { pickLook } from './sprites';
import type { Furniture } from './types';

const plan = createPlan();
const look = pickLook('a1');
const who = (pos: { x: number; z: number }, extra: Partial<ActorDraw> = {}): ActorDraw => ({
  id: 'a1', pos, look, pose: 'type', facing: 'down', frame: 0, selected: false, ...extra,
});
const furn = (kind: Furniture['kind'], x: number, z: number, h = 1): Furniture => ({ kind, cell: { x, z }, w: 1, h, facing: 'up', room: null });
const kinds = (ops: DrawOp[]) => ops.map((o) => (o.sprite.type === 'furniture' ? o.sprite.kind : o.sprite.type));

describe('ordine di profondità', () => {
  it('chi siede dietro la scrivania è coperto, chi sta davanti la copre', () => {
    const behind = actorOps(who({ x: 3, z: 3 }));
    const front = actorOps(who({ x: 3, z: 6 }, { facing: 'up' }));
    const ops = sortByDepth([...front, furnitureOp(furn('desk', 3, 4)), furnitureOp(furn('desk', 3, 5)), ...behind]);
    expect(kinds(ops)).toEqual(['shadow', 'character', 'desk', 'desk', 'shadow', 'character']);
  });

  it('a parità di riga: scrivania, monitor, sedia, poi ombra, selezione e personaggio', () => {
    const ops = sortByDepth([
      ...actorOps(who({ x: 2, z: 2 }, { selected: true })),
      furnitureOp(furn('chair', 2, 2)),
      furnitureOp(furn('monitor', 3, 2)),
      furnitureOp(furn('desk', 3, 2)),
    ]);
    expect(kinds(ops)).toEqual(['desk', 'monitor', 'chair', 'shadow', 'selection', 'character']);
  });

  it('gli arredi alti contano dalla base', () => {
    const shelf = furnitureOp(furn('bookshelf', 0, 2, 3));
    expect(shelf.depth).toBe(4);
    const ops = sortByDepth([shelf, ...actorOps(who({ x: 1, z: 3 }))]);
    expect(kinds(ops).at(-1)).toBe('bookshelf');
  });

  it('chi cammina tra due righe sta tra le due', () => {
    const ops = sortByDepth([furnitureOp(furn('plant', 0, 5)), ...actorOps(who({ x: 1, z: 4.5 })), furnitureOp(furn('plant', 0, 4))]);
    expect(kinds(ops)).toEqual(['plant', 'shadow', 'character', 'plant']);
  });

  it('tappeti e finestre sono piatti, il monitor del boss sta davanti alla sua sedia', () => {
    expect(FLAT.has('rug') && FLAT.has('window') && !FLAT.has('desk')).toBe(true);
    // porta-racchette e segnapunti appesi; la TV no, si anima e sta sul mobile
    expect(FLAT.has('paddle-rack') && FLAT.has('scoreboard') && !FLAT.has('tv')).toBe(true);
    const all = sceneFurniture(plan);
    for (const r of plan.rooms.filter((r) => r.boss)) {
      const m = all.find((f) => f.kind === 'monitor' && f.cell.x === inFront(r.boss!).x && f.cell.z === inFront(r.boss!).z);
      expect(m?.facing).toBe(r.boss!.facing === 'down' ? 'up' : 'down');
      // sopra la scrivania del boss
      expect(plan.furniture.some((f) => f.kind === 'boss-desk' && f.cell.z === m!.cell.z)).toBe(true);
    }
  });

  it('la faccia delle pareti si vede solo sopra una cella calpestabile', () => {
    const z = plan.rooms[0]!.z - 1;
    expect(wallFaceVisible(plan, 3, z)).toBe(true);
    expect(wallFaceVisible(plan, 0, 5)).toBe(false);
    expect(wallFaceVisible(plan, 3, plan.depth - 1)).toBe(false);
  });
});

describe('scala intera', () => {
  it('la più grande che ci sta, almeno 1', () => {
    expect(fitScale(1000, 1000, 300, 200)).toBe(3);
    expect(fitScale(1000, 450, 300, 200)).toBe(2);
    expect(fitScale(100, 100, 300, 200)).toBe(1);
  });

  it('su retina conta in pixel fisici: 1440×900 a dpr 2 -> scala 4', () => {
    const { w, h } = contentSize(plan);
    expect(fitScale(2880, 1800, w, h)).toBe(4);
    expect(fitScale(1440, 900, w, h)).toBe(2);
  });

  it('origine intera, pianta dentro la superficie e spostata verso destra', () => {
    const v = viewportFor(2880, 1800, plan, 32);
    const { w } = contentSize(plan);
    expect(Number.isInteger(v.ox) && Number.isInteger(v.oy)).toBe(true);
    expect(v.ox + (plan.width * 16 + 8) * v.scale).toBe(2880 - 32);
    expect(viewportFor(w, 2000, plan, 32).ox).toBe(8);
  });
});

describe('hitTest', () => {
  it('trova il personaggio sotto il punto, il vuoto dà null', () => {
    const r = actorRect('a', { x: 2, z: 2 });
    expect(hitTest([r], r.x + 2, r.y + 2)).toBe('a');
    expect(hitTest([r], r.x - 1, r.y + 2)).toBeNull();
    expect(hitTest([], 0, 0)).toBeNull();
  });

  it('tra due sovrapposti vince il più vicino', () => {
    const back = actorRect('back', { x: 2, z: 2 });
    const front = actorRect('front', { x: 2, z: 2.6 });
    const y = front.y + 2;
    expect(hitTest([front, back], front.x + 4, y)).toBe('front');
    expect(hitTest([back, front], front.x + 4, y)).toBe('front');
  });
});

describe('fotogrammi uguali', () => {
  const sprite = {};
  it('stessi elementi (sprite per identità) e stessa lunghezza', () => {
    expect(sameFrame(null, [])).toBe(false);
    expect(sameFrame([1, sprite, 'Marta'], [1, sprite, 'Marta'])).toBe(true);
    expect(sameFrame([1, sprite], [1, {}])).toBe(false);
    expect(sameFrame([1, sprite], [1, sprite, 2])).toBe(false);
    expect(sameFrame([0, NaN], [0, NaN])).toBe(true);
  });

  it('chi siede fermo cambia posa poco più di una volta al secondo: a 30 fps quasi tutti i fotogrammi si saltano', () => {
    const frames = Array.from({ length: 30 }, (_, i) => frameAt('sit', new AnimClock(100 + i / 30), 7));
    const redraws = frames.filter((f, i) => i > 0 && !sameFrame([frames[i - 1]], [f])).length;
    expect(redraws).toBeLessThanOrEqual(Math.ceil(POSE_FPS.sit));
  });
});
