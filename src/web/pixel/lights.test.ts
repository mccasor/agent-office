import { describe, expect, it } from 'vitest';
import { CORRIDOR, darknessAt, FADE_OFF, FLICKER_END, lightGeometry, litZones, RoomLights, zoneAt, type Occupant } from './lights';
import { createPlan } from './plan';

const plan = createPlan();
const g = lightGeometry(plan);
const room = (id: string) => plan.rooms.find((r) => r.id === id)!;
/** un personaggio al centro della stanza */
const inside = (sessionId: string, id: string): Occupant => {
  const r = room(id);
  return { sessionId, pos: { x: r.x + 5, z: r.z + 3 } };
};
const inHall = (sessionId: string): Occupant => ({ sessionId, pos: plan.entrance });
const none = new Set<string>();

describe('lightGeometry', () => {
  it('una zona per stanza più il corridoio; ogni cella della pianta che non è vuoto è coperta una volta sola', () => {
    expect(g.zones.map((z) => z.id)).toEqual([...plan.rooms.map((r) => r.id), CORRIDOR]);
    const covered = plan.tiles.map((row) => row.map(() => 0));
    for (const p of g.patches) for (let z = p.z; z < p.z + p.h; z++) for (let x = p.x; x < p.x + p.w; x++) covered[z]![x]!++;
    plan.tiles.forEach((row, z) => row.forEach((t, x) => expect(covered[z]![x], `${x},${z}`).toBe(t === 'void' ? 0 : 1)));
    // pochi rettangoli, non una cella alla volta
    expect(g.patches.length).toBeLessThan(80);
  });

  it('le porte delle stanze sotto sono della stanza, quelle sopra e l\'ingresso del corridoio', () => {
    expect(g.zones[zoneAt(g, room('room-3').door)]!.id).toBe('room-3');
    expect(g.zones[zoneAt(g, room('room-0').door)]!.id).toBe(CORRIDOR);
    expect(g.zones[zoneAt(g, plan.entrance)]!.id).toBe(CORRIDOR);
  });

  it('le finestre di ogni stanza fanno chiarore', () => {
    for (const [i] of plan.rooms.entries()) expect(g.windows.some((w) => w.zone === i)).toBe(true);
  });
});

describe('litZones', () => {
  const rooms = { a: 0, b: 1 };

  it('nessuno in ufficio: tutto spento', () => {
    expect(litZones(g, [], rooms, none)).toEqual(new Set());
  });

  it('stanza accesa con qualcuno dentro, le altre spente; il corridoio acceso finché c\'è qualcuno', () => {
    expect(litZones(g, [inside('a', 'room-0')], rooms, none)).toEqual(new Set(['room-0', CORRIDOR]));
  });

  it('conta la posizione reale: chi è ancora in corridoio non accende la sua stanza', () => {
    expect(litZones(g, [inHall('a')], rooms, none)).toEqual(new Set([CORRIDOR]));
  });

  it('pallino grigio: la stanza resta spenta anche con Claude alla scrivania; tutto grigio, tutto spento', () => {
    const boss = { sessionId: 'a', pos: room('room-0').boss!.cell };
    expect(litZones(g, [boss], rooms, new Set(['a']))).toEqual(new Set());
    expect(litZones(g, [boss, inside('b', 'room-1')], rooms, new Set(['a']))).toEqual(new Set(['room-1', CORRIDOR]));
  });

  it('stanza di una sessione grigia: spenta anche se ci passa qualcuno di un\'altra sessione', () => {
    expect(litZones(g, [inside('b', 'room-0')], rooms, new Set(['a']))).toEqual(new Set([CORRIDOR]));
  });

  it('stanza senza sessione (chi esce dopo la fine): segue chi c\'è dentro', () => {
    expect(litZones(g, [inside('x', 'room-4')], rooms, none)).toEqual(new Set(['room-4', CORRIDOR]));
  });

  it('sala relax: accesa con qualcuno di una sessione non grigia', () => {
    expect(litZones(g, [inside('a', 'lounge')], rooms, none)).toEqual(new Set(['lounge', CORRIDOR]));
    expect(litZones(g, [inside('a', 'lounge')], rooms, new Set(['a']))).toEqual(new Set());
  });
});

describe('darknessAt', () => {
  it('spegnimento: sfuma dal buio di partenza fino a 1 in FADE_OFF', () => {
    const sw = { on: false, at: 10, from: 0 };
    expect(darknessAt(sw, 10)).toBe(0);
    expect(darknessAt(sw, 10 + FADE_OFF / 2)).toBeCloseTo(0.5);
    expect(darknessAt(sw, 10 + FADE_OFF + 1e-9)).toBe(1);
    expect(darknessAt({ on: false, at: 10, from: 0.6 }, 10 + FADE_OFF / 2)).toBeCloseTo(0.8);
  });

  it('accensione: sfarfalla tra acceso e buio, mai più buio di prima, poi accesa', () => {
    const sw = { on: true, at: 10, from: 1 };
    const samples = Array.from({ length: 30 }, (_, i) => darknessAt(sw, 10 + i * 0.01));
    expect(samples[0]).toBe(0);
    expect(samples.some((d) => d > 0.3)).toBe(true);
    expect(samples.every((d) => d >= 0 && d <= 1)).toBe(true);
    expect(darknessAt(sw, 10 + FLICKER_END)).toBe(0);
    expect(darknessAt({ on: true, at: 10, from: 0.5 }, 10.07)).toBeLessThanOrEqual(0.5);
  });
});

describe('RoomLights', () => {
  const idx = (id: string) => g.zones.findIndex((z) => z.id === id);

  it('al primo aggiornamento niente transizioni; poi si spegne sfumando e si riaccende', () => {
    const l = new RoomLights(plan);
    l.update(new Set(['room-0']), 0);
    expect(l.isOn(idx('room-0'))).toBe(true);
    expect(l.isOn(idx('room-1'))).toBe(false);
    l.update(new Set(), 1);
    expect(l.isOn(idx('room-0'))).toBe(false);
    l.update(new Set(['room-1']), 1 + FADE_OFF + 1);
    expect(l.isOn(idx('room-1'))).toBe(true);
  });

  it('occupata finché sfuma o sfarfalla, poi ferma: il loop di disegno può dormire', () => {
    const l = new RoomLights(plan);
    expect(l.busy(0)).toBe(false);
    l.update(new Set(['room-0']), 0);
    expect(l.busy(0)).toBe(false);
    l.update(new Set(), 1);
    expect(l.busy(1 + FADE_OFF / 2)).toBe(true);
    expect(l.busy(1 + FADE_OFF + 0.01)).toBe(false);
    l.update(new Set(['room-0']), 2);
    expect(l.busy(2 + FLICKER_END / 2)).toBe(true);
    expect(l.busy(2 + FLICKER_END + 0.01)).toBe(false);
  });

  it('spegne gli schermi delle stanze spente', () => {
    const l = new RoomLights(plan);
    l.update(new Set(['room-1']), 0);
    const r0 = room('room-0');
    const r1 = room('room-1');
    const screens = new Map([[`${r0.x + 2},${r0.z + 4}`, 'backend'], [`${r1.x + 2},${r1.z + 4}`, 'docs']]);
    l.dimScreens(screens);
    expect([...screens.values()]).toEqual(['docs']);
  });
});
