import { describe, expect, it } from 'vitest';
import {
  cameraViewport, canPan, FIT, isZoomed, panBy, scaleLimits, stepScale, toPlan, zoomAt, type Camera, type Screen,
} from './camera';
import { contentSize, MARGIN, viewportFor } from './draw';

// stessa grandezza della pianta vera: contenuto 608×404 pixel a scala 1
const plan = { width: 37, depth: 23 };
const screen: Screen = { w: 2880, h: 1800, dpr: 2 };
const { w: CW, h: CH } = contentSize(plan);

/** bordi del contenuto (margini compresi) sullo schermo */
const bounds = (cam: Camera, s = screen) => {
  const v = cameraViewport(cam, s, plan);
  const left = v.ox - MARGIN.side * v.scale;
  const top = v.oy - MARGIN.top * v.scale;
  return { scale: v.scale, left, top, right: left + CW * v.scale, bottom: top + CH * v.scale };
};

describe('limiti di scala', () => {
  it('da "adatta" a 8 pixel CSS per pixel dello sprite', () => {
    expect(scaleLimits(screen, plan)).toEqual({ min: 4, max: 16 });
    expect(scaleLimits({ w: 1440, h: 900, dpr: 1 }, plan)).toEqual({ min: 2, max: 8 });
  });

  it('una finestra enorme non scende sotto "adatta"', () => {
    const { min, max } = scaleLimits({ w: 8000, h: 6000, dpr: 1 }, plan);
    expect(min).toBe(13);
    expect(max).toBe(13);
  });

  it('passi interi: +1 da vicino, circa +25% da lontano', () => {
    expect(stepScale(2, 1)).toBe(3);
    expect(stepScale(8, 1)).toBe(10);
    expect(stepScale(10, -1)).toBe(8);
    expect(stepScale(3, -2)).toBe(1);
  });
});

describe('camera adattata', () => {
  it('coincide con viewportFor e non si trascina', () => {
    expect(cameraViewport(FIT, screen, plan)).toEqual(viewportFor(screen.w, screen.h, plan, 32));
    expect(isZoomed(FIT, screen, plan)).toBe(false);
    expect(canPan(FIT, screen, plan)).toBe(false);
    expect(panBy(FIT, screen, plan, 100, 100)).toBe(FIT);
  });

  it('dezoomare da "adatta" resta adattata', () => {
    expect(zoomAt(FIT, screen, plan, -1)).toBe(FIT);
  });
});

describe('zoom', () => {
  it('con i pulsanti tiene fermo il punto al centro dello schermo', () => {
    // da già ingrandita: da "adatta" la pianta non è centrata (spazio a sinistra per il pannello)
    const from = zoomAt(FIT, screen, plan, 3);
    const before = toPlan(cameraViewport(from, screen, plan), screen.w / 2, screen.h / 2);
    const cam = zoomAt(from, screen, plan, 1);
    expect([from.scale, cam.scale]).toEqual([8, 10]);
    const after = toPlan(cameraViewport(cam, screen, plan), screen.w / 2, screen.h / 2);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('con la rotella tiene fermo il punto sotto il cursore', () => {
    const cam = zoomAt(FIT, screen, plan, 2, 1500, 900);
    const fit = cameraViewport(FIT, screen, plan);
    const view = cameraViewport(cam, screen, plan);
    const p = toPlan(fit, 1500, 900);
    // il punto della pianta torna sotto il cursore a meno dell'arrotondamento a pixel fisici interi
    expect(Math.abs(view.ox + p.x * view.scale - 1500)).toBeLessThanOrEqual(1);
    expect(Math.abs(view.oy + p.y * view.scale - 900)).toBeLessThanOrEqual(1);
  });

  it('si ferma al massimo e torna ad "adatta" scendendo', () => {
    const max = zoomAt(FIT, screen, plan, 50);
    expect(max.scale).toBe(16);
    expect(zoomAt(max, screen, plan, -50)).toBe(FIT);
  });

  it('vicino a un bordo non lascia vuoti: il contenuto copre lo schermo', () => {
    const cam = zoomAt(FIT, screen, plan, 3, 0, 0);
    const b = bounds(cam);
    expect(b.left).toBe(0);
    expect(b.top).toBe(0);
    expect(b.right).toBeGreaterThanOrEqual(screen.w);
    expect(b.bottom).toBeGreaterThanOrEqual(screen.h);
  });
});

describe('trascinamento', () => {
  const zoomed = zoomAt(FIT, screen, plan, 4);

  it('la pianta segue il cursore', () => {
    const before = cameraViewport(zoomed, screen, plan);
    const after = cameraViewport(panBy(zoomed, screen, plan, 40, -30), screen, plan);
    expect(after.ox - before.ox).toBe(40);
    expect(after.oy - before.oy).toBe(-30);
  });

  it('non si perde la pianta: oltre il bordo si ferma', () => {
    const far = panBy(zoomed, screen, plan, 1e6, 1e6);
    expect(bounds(far)).toMatchObject({ left: 0, top: 0 });
    const other = panBy(zoomed, screen, plan, -1e6, -1e6);
    const b = bounds(other);
    expect(b.right).toBe(screen.w);
    expect(b.bottom).toBe(screen.h);
  });

  it('se in una dimensione la pianta ci sta, lì resta centrata', () => {
    // finestra larga e bassa: con scala 3 la pianta è più stretta dello schermo ma più alta
    const wide: Screen = { w: 4000, h: 1000, dpr: 1 };
    const cam = zoomAt(FIT, wide, plan, 1);
    const b = bounds(panBy(cam, wide, plan, 500, 0), wide);
    expect(b.left).toBe(Math.floor((wide.w - CW * b.scale) / 2));
    expect(canPan(cam, wide, plan)).toBe(true);
  });

  it('il cambio di finestra rimette la camera nei limiti', () => {
    const small: Screen = { w: 1000, h: 700, dpr: 1 };
    const b = bounds(zoomed, small);
    expect(b.scale).toBe(8);
    expect(b.left).toBeLessThanOrEqual(0);
    expect(b.right).toBeGreaterThanOrEqual(small.w);
  });
});
