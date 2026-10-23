import { describe, expect, it } from 'vitest';
import type { AgentState } from '../../shared/types';
import { START_GAP, StartQueue, WALK_SPEED } from '../scene/motion';
import { arrivedAt, facingOf, frameAt, isDeskSpot, isFoosballSpot, isVisible, poseOf, stepMotion, type ActorMotion } from './actors';
import { createPlan } from './plan';
import type { PixelActor, Spot } from './types';

const plan = createPlan();
const room = plan.rooms[0]!;
const desk = room.desks[0]!;
const lounge = plan.rooms.find((r) => r.kind === 'lounge')!;
const sofa = lounge.seats.find((s) => s.seated)!;
const standing = lounge.seats.find((s) => s.id.startsWith('stand-'))!;
const foosball = lounge.seats.find((s) => s.id.startsWith('foos-'))!;

/** avanza a passi da 0.1 s finché `until` o per al massimo `max` secondi */
function run(m: ActorMotion | undefined, target: Spot | null, from: number, max: number, until?: (m: ActorMotion) => boolean) {
  let t = from;
  let cur = stepMotion(m, target, plan, t, 0);
  while (t < from + max && !until?.(cur)) {
    t += 0.1;
    cur = stepMotion(cur, target, plan, t, 0.1);
  }
  return { m: cur, t };
}

const actor = (status: AgentState['status']): PixelActor => ({
  id: 'a1', sessionId: 's1', boss: false, target: null, waiting: false,
  agent: { id: 'a1', sessionId: 's1', status } as AgentState,
});

describe('stepMotion', () => {
  it("entra dall'ingresso e raggiunge il posto, guardando come il posto", () => {
    const first = stepMotion(undefined, desk, plan, 0, 0);
    expect(first.pos).toEqual(plan.entrance);
    const { m } = run(first, desk, 0, 60, (x) => x.phase === 'arrived');
    expect(m.phase).toBe('arrived');
    expect(m.pos).toEqual(desk.cell);
    expect(m.facing).toBe(desk.facing);
    expect(m.at).toBe(desk);
  });

  it('cammina a WALK_SPEED celle al secondo, nella direzione del segmento', () => {
    const m = stepMotion(stepMotion(undefined, desk, plan, 0, 0), desk, plan, 0.5, 0.5);
    expect(m.phase).toBe('walking');
    expect(m.dist).toBeCloseTo(0.5 * WALK_SPEED);
    // dall'ingresso a ovest si va verso est
    expect(m.facing).toBe('right');
    expect(isVisible(m)).toBe(true);
  });

  it("con target null torna all'ingresso e sparisce", () => {
    const { m } = run(arrivedAt(desk, 0), null, 0, 60, (x) => x.phase === 'gone');
    expect(m.phase).toBe('gone');
    expect(m.pos).toEqual(plan.entrance);
    expect(isVisible(m)).toBe(false);
  });

  it('senza meta e mai entrato non compare', () => {
    expect(stepMotion(undefined, null, plan, 0, 0).phase).toBe('gone');
  });

  it('cambiando posto ripianifica da dove si trova, anche a metà strada', () => {
    const half = run(undefined, desk, 0, 2).m;
    const other = room.desks[5]!;
    const { m } = run(half, other, 2, 60, (x) => x.phase === 'arrived');
    expect(m.pos).toEqual(other.cell);
    expect(m.path[0]).toEqual(half.pos);
  });

  it('chi entra insieme parte in fila (StartQueue)', () => {
    const q = new StartQueue();
    const a = stepMotion(undefined, desk, plan, 0, 0, q);
    const b = stepMotion(undefined, room.desks[1]!, plan, 0, 0, q);
    expect(b.holdUntil - a.holdUntil).toBeCloseTo(START_GAP);
    // in attesa del turno resta fuori, invisibile
    const waiting = stepMotion(b, room.desks[1]!, plan, 0.5, 0.5, q);
    expect(waiting.phase).toBe('queued');
    expect(isVisible(waiting)).toBe(false);
  });
});

describe('poseOf', () => {
  it('cammina mentre si muove', () => {
    const m = run(undefined, desk, 0, 1).m;
    expect(poseOf(actor('working'), m)).toBe('walk');
  });

  it('digita alla postazione o alla scrivania del boss se lavora, altrimenti seduto', () => {
    expect(poseOf(actor('working'), arrivedAt(desk, 0))).toBe('type');
    expect(poseOf(actor('entering'), arrivedAt(room.boss!, 0))).toBe('type');
    expect(poseOf(actor('idle'), arrivedAt(desk, 0))).toBe('sit');
  });

  it('seduto in sala relax, in piedi nei posti in piedi', () => {
    expect(poseOf(actor('done'), arrivedAt(sofa, 0))).toBe('sit');
    expect(poseOf(actor('working'), arrivedAt(sofa, 0))).toBe('sit');
    expect(poseOf(actor('done'), arrivedAt(standing, 0))).toBe('stand');
    expect(poseOf(actor('working'), arrivedAt(plan.overflow[0]!, 0))).toBe('stand');
  });

  it('al biliardino gioca, con la sua animazione', () => {
    expect(isFoosballSpot(foosball)).toBe(true);
    expect(isFoosballSpot(standing)).toBe(false);
    expect(poseOf(actor('done'), arrivedAt(foosball, 0))).toBe('play');
    expect(poseOf(actor('done'), run(undefined, foosball, 0, 0.1).m)).toBe('walk');
    expect(frameAt('play', 1, 0) - frameAt('play', 0, 0)).toBeGreaterThanOrEqual(4);
  });

  it('riconosce postazioni e scrivanie del boss', () => {
    expect(isDeskSpot(desk)).toBe(true);
    expect(isDeskSpot(room.boss!)).toBe(true);
    expect(isDeskSpot(sofa)).toBe(false);
    expect(isDeskSpot(plan.overflow[0]!)).toBe(false);
  });
});

describe('facingOf e frameAt', () => {
  it('direzione del segmento -> verso', () => {
    expect(facingOf(0)).toBe('down');
    expect(facingOf(Math.PI)).toBe('up');
    expect(facingOf(Math.PI / 2)).toBe('right');
    expect(facingOf(-Math.PI / 2)).toBe('left');
  });

  it('camminata più svelta del respiro', () => {
    expect(frameAt('walk', 1, 0) - frameAt('walk', 0, 0)).toBe(8);
    expect(frameAt('stand', 1, 0) - frameAt('stand', 0, 0)).toBeLessThan(3);
  });
});
