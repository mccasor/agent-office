import { describe, expect, it } from 'vitest';
import { CHARACTER_PRESETS } from '../characters/presets';
import {
  bossLook, bubbleImage, CHAR_H, CHAR_W, characterImage, FOOSBALL_FRAMES, furnitureImage, PALETTE, pickLook, POSE_FRAMES, rgba,
  SCREEN_FRAMES, SCREEN_THEMES, selectionImage, shadowImage, tileImage, type PixelImage,
} from './sprites';
import { TILE, type Facing, type FurnitureKind, type Pose, type TileKind } from './types';

const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];
const POSES: Pose[] = ['stand', 'walk', 'sit', 'type', 'play'];
const FURNITURE: FurnitureKind[] = [
  'desk', 'boss-desk', 'chair', 'monitor', 'plant', 'sofa', 'armchair', 'coffee-table', 'coffee-machine', 'water-cooler',
  'bookshelf', 'rug', 'whiteboard', 'window', 'painting', 'clock', 'corkboard', 'poster', 'floor-lamp', 'cabinet', 'locker',
  'printer', 'bin', 'coat-rack', 'plant-tall', 'cactus', 'foosball', 'vending', 'fridge', 'arcade',
];
const TILES: TileKind[] = ['void', 'floor', 'lounge', 'corridor', 'wall', 'door'];

const alpha = (img: PixelImage, x: number, y: number) =>
  x < 0 || y < 0 || x >= img.w || y >= img.h ? 0 : img.data[(y * img.w + x) * 4 + 3]!;
const opaqueCount = (img: PixelImage) => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) n++;
  return n;
};
const sameData = (a: PixelImage, b: PixelImage) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);

const looks = [bossLook(0), bossLook(1), ...CHARACTER_PRESETS.map((_, i) => pickLook(`agent-${i}`)), pickLook('agent-44')];

describe('personaggi', () => {
  it('tutte le pose, direzioni e fotogrammi hanno dimensioni, ancora e pixel', () => {
    for (const look of looks) {
      for (const pose of POSES) {
        for (const facing of FACINGS) {
          for (let f = 0; f < POSE_FRAMES[pose]; f++) {
            const img = characterImage(look, pose, facing, f);
            expect([img.w, img.h, img.data.length]).toEqual([CHAR_W, CHAR_H, CHAR_W * CHAR_H * 4]);
            expect([img.ax, img.ay]).toEqual([CHAR_W / 2, CHAR_H - 1]);
            expect(opaqueCount(img)).toBeGreaterThan(100);
          }
        }
      }
    }
  });

  it('i fotogrammi delle animazioni sono diversi tra loro e il frame gira in modulo', () => {
    const look = pickLook('agent-1');
    for (const pose of POSES) {
      for (const facing of FACINGS) {
        const frames = Array.from({ length: POSE_FRAMES[pose] }, (_, f) => characterImage(look, pose, facing, f));
        expect(sameData(frames[0]!, frames[1]!)).toBe(false);
        expect(sameData(characterImage(look, pose, facing, POSE_FRAMES[pose]), frames[0]!)).toBe(true);
      }
    }
  });

  it('i pixel di bordo della sagoma sono del colore di contorno', () => {
    const [r, g, b] = rgba(PALETTE.outline);
    for (const look of looks) {
      for (const pose of POSES) {
        for (const facing of FACINGS) {
          const img = characterImage(look, pose, facing, 0);
          for (let y = 0; y < img.h; y++) {
            for (let x = 0; x < img.w; x++) {
              if (!alpha(img, x, y)) continue;
              const edge = !alpha(img, x - 1, y) || !alpha(img, x + 1, y) || !alpha(img, x, y - 1) || !alpha(img, x, y + 1);
              if (!edge) continue;
              const i = (y * img.w + x) * 4;
              expect([img.data[i], img.data[i + 1], img.data[i + 2]], `${look.id} ${pose} ${facing} (${x},${y})`).toEqual([r, g, b]);
            }
          }
        }
      }
    }
  });

  it('left è lo specchio di right', () => {
    const look = pickLook('agent-3');
    const l = characterImage(look, 'walk', 'left', 2);
    const r = characterImage(look, 'walk', 'right', 2);
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) expect(alpha(l, x, y)).toBe(alpha(r, l.w - 1 - x, y));
  });

  it('pickLook è deterministica e varia tra agenti', () => {
    expect(pickLook('abc')).toEqual(pickLook('abc'));
    const ids = new Set(Array.from({ length: 60 }, (_, i) => pickLook(`agent-${i}`).id));
    expect(ids.size).toBeGreaterThan(8);
    const lk = pickLook('agent-x');
    expect(lk.jacket).toBe(false);
  });

  it('il boss ha la giacca arancio Claude e si distingue tra le sessioni', () => {
    expect(bossLook(0).shirt).toBe(PALETTE.cloth.claude);
    expect(bossLook(0).jacket).toBe(true);
    expect(bossLook(1).shirt).not.toBe(bossLook(0).shirt);
    expect(bossLook(4)).toEqual(bossLook(0));
  });
});

describe('arredi', () => {
  it('ogni FurnitureKind ha uno sprite per ogni facing, con impronta e ancora coerenti', () => {
    for (const kind of FURNITURE) {
      for (const facing of FACINGS) {
        for (const [w, h] of [[1, 1], [2, 1], [1, 2], [3, 2]] as const) {
          const img = furnitureImage(kind, facing, w, h);
          expect(img.w).toBe(w * TILE);
          expect(img.h - img.ay).toBe(h * TILE);
          expect(img.ax).toBe(0);
          expect(img.ay).toBeGreaterThanOrEqual(0);
          expect(opaqueCount(img), `${kind} ${facing} ${w}x${h}`).toBeGreaterThan(20);
        }
      }
    }
  });

  it('il monitor acceso anima lo schermo e si distingue da spento', () => {
    const a = furnitureImage('monitor', 'down', 1, 1, 0);
    const b = furnitureImage('monitor', 'down', 1, 1, 1);
    const off = furnitureImage('monitor', 'down', 1, 1, -1);
    expect(sameData(a, b)).toBe(false);
    expect(sameData(a, off)).toBe(false);
    expect(sameData(a, furnitureImage('monitor', 'down', 1, 1, SCREEN_FRAMES))).toBe(true);
  });

  it('ogni tema dello schermo si anima e si distingue dagli altri; di spalle il monitor non cambia', () => {
    const first = SCREEN_THEMES.map((_, t) => furnitureImage('monitor', 'down', 1, 1, 0, t));
    for (const [t, img] of first.entries()) {
      const frames = Array.from({ length: SCREEN_FRAMES }, (_, f) => furnitureImage('monitor', 'down', 1, 1, f, t));
      expect(frames.some((f) => !sameData(f, img)), SCREEN_THEMES[t]).toBe(true);
      for (const other of first.slice(t + 1)) expect(sameData(img, other)).toBe(false);
    }
    expect(sameData(furnitureImage('monitor', 'up', 1, 1, 0, 3), furnitureImage('monitor', 'up', 1, 1, 5, 7))).toBe(true);
  });

  it('il biliardino in partita muove la palla, fermo resta uguale', () => {
    const still = furnitureImage('foosball', 'down', 2, 1, -1);
    const frames = Array.from({ length: FOOSBALL_FRAMES }, (_, f) => furnitureImage('foosball', 'down', 2, 1, f));
    expect(new Set(frames.map((f) => Array.from(f.data).join())).size).toBeGreaterThan(4);
    expect(frames.every((f) => !sameData(f, still))).toBe(true);
  });

  it('le varianti cambiano tappeti, quadri, poster e cabinati', () => {
    for (const [kind, n] of [['rug', 4], ['painting', 6], ['poster', 2], ['arcade', 2]] as const) {
      const imgs = Array.from({ length: n }, (_, v) => Array.from(furnitureImage(kind, 'down', 1, 1, 0, v).data).join());
      expect(new Set(imgs).size, kind).toBe(n);
    }
  });
});

describe('tile', () => {
  it('ogni TileKind riempie la cella', () => {
    for (const kind of TILES) {
      for (const face of [false, true]) {
        const img = tileImage(kind, 3, 5, face);
        expect([img.w, img.h, img.ax, img.ay]).toEqual([TILE, TILE, 0, 0]);
        expect(opaqueCount(img), kind).toBe(TILE * TILE);
      }
    }
  });

  it('variano in modo deterministico con x, z', () => {
    expect(sameData(tileImage('floor', 1, 2, false), tileImage('floor', 1, 2, false))).toBe(true);
    const variants = new Set([0, 1, 2, 3, 4, 5].map((x) => Array.from(tileImage('floor', x, 0, false).data).join()));
    expect(variants.size).toBeGreaterThan(1);
    expect(sameData(tileImage('wall', 0, 0, true), tileImage('wall', 0, 0, false))).toBe(false);
  });

  it('pavimenti e pareti cambiano tinta da una stanza all\'altra', () => {
    for (const kind of ['floor', 'wall'] as const) {
      const styles = [0, 1, 2, 3, 4].map((s) => Array.from(tileImage(kind, 2, 3, true, s).data).join());
      expect(new Set(styles).size, kind).toBe(5);
    }
    expect(sameData(tileImage('corridor', 1, 1, false, 3), tileImage('corridor', 1, 1, false))).toBe(true);
  });
});

describe('extra', () => {
  it('fumetto, ombra e selezione hanno pixel e ancora dentro l’immagine', () => {
    for (const img of [bubbleImage(), shadowImage(), selectionImage()]) {
      expect(opaqueCount(img)).toBeGreaterThan(10);
      expect(img.ax).toBeGreaterThanOrEqual(0);
      expect(img.ax).toBeLessThanOrEqual(img.w);
      expect(img.ay).toBeGreaterThanOrEqual(0);
      expect(img.ay).toBeLessThan(img.h);
    }
  });
});
