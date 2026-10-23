import { describe, expect, it } from 'vitest';
import { AnimClock } from './clock';
import { cellKey, sceneFurniture } from './draw';
import { createPlan } from './plan';
import { furnitureLook, screenTheme, screenVisible, type FurnitureUse } from './screens';
import { SCREEN_FRAMES, SCREEN_THEMES } from './sprites';
import type { Furniture } from './types';

const monitor = (facing: Furniture['facing'], x = 3, z = 4): Furniture => ({ kind: 'monitor', cell: { x, z }, w: 1, h: 1, facing, room: 'room-0' });
const using = (f: Furniture, area: string): FurnitureUse => ({ screens: new Map([[cellKey(f.cell), area]]), players: 0 });
const idle: FurnitureUse = { screens: new Map(), players: 0 };

describe('screenTheme', () => {
  it('un tema per ruolo: sviluppo a codice, design a forme, docs a testo, research a grafici, architecture a blocchi', () => {
    expect(screenTheme('backend')).toBe('matrix');
    expect(screenTheme('frontend')).toBe('code');
    expect(screenTheme('devops')).toBe('terminal');
    expect(screenTheme('test')).toBe('tests');
    expect(screenTheme('design')).toBe('design');
    expect(screenTheme('docs')).toBe('docs');
    expect(screenTheme('research')).toBe('chart');
    expect(screenTheme('architecture')).toBe('diagram');
  });

  it('area sconosciuta, assente o "other": lo schermo generico', () => {
    for (const area of ['other', 'marketing', '', undefined, null, 'toString', '__proto__']) expect(screenTheme(area)).toBe('generic');
  });
});

describe('furnitureLook', () => {
  it('monitor spento se nessuno ci lavora', () => {
    expect(furnitureLook(monitor('down'), idle, new AnimClock(3))).toEqual({ frame: -1, variant: 0 });
  });

  it('solo lo schermo visibile (verso sud) prende il tema del ruolo e si anima', () => {
    const front = monitor('down');
    const looks = Array.from({ length: SCREEN_FRAMES }, (_, i) => furnitureLook(front, using(front, 'design'), new AnimClock(i / 4)));
    expect(new Set(looks.map((l) => l.variant))).toEqual(new Set([SCREEN_THEMES.indexOf('design')]));
    expect(new Set(looks.map((l) => l.frame)).size).toBe(SCREEN_FRAMES);
    const back = monitor('up');
    for (const t of [0, 1.3, 7]) expect(furnitureLook(back, using(back, 'design'), new AnimClock(t))).toEqual({ frame: 0, variant: 0 });
    expect(screenVisible(front)).toBe(true);
    expect(screenVisible(back)).toBe(false);
  });

  it('deterministico per postazione e tempo, sfasato tra postazioni vicine', () => {
    const a = monitor('down', 3, 4);
    const b = monitor('down', 4, 4);
    expect(furnitureLook(a, using(a, 'backend'), new AnimClock(2.6))).toEqual(furnitureLook(a, using(a, 'backend'), new AnimClock(2.6)));
    expect(furnitureLook(a, using(a, 'backend'), new AnimClock(2.6)).frame).not.toBe(furnitureLook(b, using(b, 'backend'), new AnimClock(2.6)).frame);
  });

  it('nella pianta metà degli schermi delle postazioni si vede, e quelli dei boss delle stanze sotto', () => {
    const plan = createPlan();
    const monitors = sceneFurniture(plan).filter((f) => f.kind === 'monitor');
    const visible = monitors.filter(screenVisible);
    expect(visible.length).toBe(5 * 4 + 2);
    const bossRows = plan.rooms.filter((r) => r.boss).map((r) => r.boss!.cell.z - 1);
    expect(visible.filter((f) => bossRows.includes(f.cell.z))).toHaveLength(2);
  });

  it('biliardino fermo senza giocatori, in partita con almeno uno', () => {
    const table: Furniture = { kind: 'foosball', cell: { x: 30, z: 18 }, w: 2, h: 1, facing: 'down', room: 'lounge' };
    expect(furnitureLook(table, idle, new AnimClock(5)).frame).toBe(-1);
    const frames = new Set([0, 0.2, 0.4, 0.6].map((t) => furnitureLook(table, { ...idle, players: 2 }, new AnimClock(t)).frame));
    expect(frames.size).toBeGreaterThan(1);
    expect([...frames].every((f) => f >= 0)).toBe(true);
  });

  it('gli altri arredi restano fermi con la loro variante', () => {
    const rug: Furniture = { kind: 'rug', cell: { x: 5, z: 3 }, w: 3, h: 5, facing: 'down', room: 'room-0', variant: 2 };
    expect(furnitureLook(rug, idle, new AnimClock(9))).toEqual({ frame: 0, variant: 2 });
  });
});
