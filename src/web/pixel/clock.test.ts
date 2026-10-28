import { describe, expect, it } from 'vitest';
import { AnimClock, ANIM_HZ, nextWake, tickOf } from './clock';
import { frameAt, POSE_FPS } from './actors';
import { furnitureLook } from './screens';
import type { Furniture } from './types';

describe('orologio delle animazioni', () => {
  it('quantizzato a scatti di 1/ANIM_HZ s', () => {
    expect(ANIM_HZ).toBe(8);
    expect(tickOf(1.06)).toBe(1);
    expect(tickOf(1.13)).toBe(1.125);
    expect(new AnimClock(2.99).t).toBe(2.875);
  });

  it('tra due scatti i fotogrammi sono identici', () => {
    for (const pose of ['type', 'sit', 'play'] as const) {
      expect(frameAt(pose, new AnimClock(10.13), 42)).toBe(frameAt(pose, new AnimClock(10.24), 42));
    }
  });

  it('senza animazioni non c\'è uno scatto da aspettare', () => {
    expect(new AnimClock(3).next).toBe(Infinity);
  });

  it('next è il primo scatto futuro in cui un fotogramma cambia, e lì cambia davvero', () => {
    for (const [fps, offset] of [[POSE_FPS.sit, 3.7], [POSE_FPS.type, 0.4], [4, 0], [6, 0]] as const) {
      for (let now = 0; now < 4; now += 0.037) {
        const clock = new AnimClock(now);
        const f = clock.frame(fps, offset);
        expect(clock.next).toBeGreaterThan(clock.t);
        // nessun cambio tra lo scatto corrente e next (escluso)
        for (let t = clock.t; t < clock.next - 1e-9; t += 1 / ANIM_HZ) expect(new AnimClock(t).frame(fps, offset)).toBe(f);
        expect(new AnimClock(clock.next).frame(fps, offset)).not.toBe(f);
      }
    }
  });

  it('con più animazioni vale lo scatto più vicino', () => {
    const clock = new AnimClock(0);
    clock.frame(1, 0);
    clock.frame(4, 0);
    expect(clock.next).toBe(0.25);
  });

  it('gli schermi accesi chiedono un risveglio, quelli spenti no', () => {
    const monitor: Furniture = { kind: 'monitor', cell: { x: 3, z: 4 }, w: 1, h: 1, facing: 'down', room: 'room-0' };
    const off = new AnimClock(5);
    furnitureLook(monitor, { screens: new Map(), players: 0, gamers: new Map(), pong: new Map() }, off);
    expect(off.next).toBe(Infinity);
    const on = new AnimClock(5);
    furnitureLook(monitor, { screens: new Map([['3,4', 'backend']]), players: 0, gamers: new Map(), pong: new Map() }, on);
    expect(on.next).toBe(5.25);
  });
});

describe('risveglio del loop di disegno', () => {
  it('subito se qualcosa si muove sul tempo continuo (camminate, luci)', () => {
    const clock = new AnimClock(7);
    clock.frame(4);
    expect(nextWake(7.01, true, clock)).toBe(7.01);
  });

  it('altrimenti al prossimo scatto che cambia qualcosa, o mai se nulla è animato', () => {
    const clock = new AnimClock(7.01);
    clock.frame(4);
    expect(nextWake(7.01, false, clock)).toBe(7.25);
    expect(nextWake(7.01, false, new AnimClock(7.01))).toBe(Infinity);
  });
});
