import type { AnimClock } from './clock';
import { planFrom } from './path';
import { advanceAlongPath, WALK_SPEED, type StartQueue } from './motion';
import type { Cell, Facing, PixelActor, PixelPlan, Pose, Spot } from './types';

/**
 * Movimento di un personaggio della vista 2D, aggiornato a ogni fotogramma:
 * entra dall'ingresso, raggiunge il posto, ripianifica se il posto cambia, esce dall'ingresso con target null.
 */
export interface ActorMotion {
  /** meta corrente: 'in:<spotId>' oppure 'out' */
  key: string;
  path: Cell[];
  dist: number;
  pos: Cell;
  facing: Facing;
  /** queued: fuori dall'ingresso in attesa del turno (invisibile); arrived: fermo al posto `at`; gone: uscito */
  phase: 'queued' | 'walking' | 'arrived' | 'gone';
  at: Spot | null;
  /** istante (s) da cui può muoversi: turno della StartQueue */
  holdUntil: number;
}

/** secondi di simulazione recuperati al massimo in un fotogramma (pagina rimasta nascosta a lungo) */
export const MAX_CATCH_UP = 5;

/** direzione di advanceAlongPath (atan2(dx, dz)) -> verso a 4 direzioni */
export function facingOf(direction: number): Facing {
  const dx = Math.sin(direction);
  const dz = Math.cos(direction);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'right' : 'left';
  return dz >= 0 ? 'down' : 'up';
}

function route(plan: PixelPlan, from: Cell, to: Cell): Cell[] {
  const path = planFrom(plan, from, to);
  // irraggiungibile: compare lì
  return path.length > 0 ? path : [to];
}

/** Avanza il movimento di `dt` secondi all'istante `now` verso `target`. Restituisce lo stato nuovo (puro). */
export function stepMotion(
  prev: ActorMotion | undefined,
  target: Spot | null,
  plan: PixelPlan,
  now: number,
  dt: number,
  queue?: StartQueue,
): ActorMotion {
  const key = target ? `in:${target.id}` : 'out';
  const dest = target?.cell ?? plan.entrance;
  let m: ActorMotion;
  if (!prev || ((prev.phase === 'queued' || prev.phase === 'gone') && prev.key !== key)) {
    // mai visto, non ancora entrato o già uscito: senza meta non entra, altrimenti parte dall'ingresso al proprio turno
    if (!target) return { key, path: [], dist: 0, pos: plan.entrance, facing: 'right', phase: 'gone', at: null, holdUntil: now };
    m = {
      key, path: route(plan, plan.entrance, dest), dist: 0, pos: plan.entrance, facing: 'right', phase: 'queued', at: null,
      holdUntil: queue ? queue.slot(now) : now,
    };
  } else if (prev.key !== key) {
    // nuova meta: si riparte da dove si è (anche a metà di un segmento) al proprio turno
    m = { ...prev, key, path: route(plan, prev.pos, dest), dist: 0, holdUntil: queue ? queue.slot(now) : now };
  } else {
    m = { ...prev };
  }
  if (m.phase === 'gone' || now < m.holdUntil) return m;

  m.dist += Math.min(dt, MAX_CATCH_UP) * WALK_SPEED;
  const r = advanceAlongPath(m.path, m.dist);
  m.pos = { x: r.x, z: r.z };
  if (!r.done) {
    m.phase = 'walking';
    m.at = null;
    m.facing = facingOf(r.direction);
  } else if (target) {
    m.phase = 'arrived';
    m.at = target;
    m.facing = target.facing;
  } else {
    m.phase = 'gone';
    m.at = null;
  }
  return m;
}

/** già seduto (o in piedi) al posto: per chi c'è già quando la vista compare, senza rientrare dalla porta */
export function arrivedAt(target: Spot, now: number): ActorMotion {
  return {
    key: `in:${target.id}`, path: [target.cell], dist: 0, pos: target.cell, facing: target.facing, phase: 'arrived', at: target,
    holdUntil: now,
  };
}

export const isVisible = (m: ActorMotion): boolean => m.phase === 'walking' || m.phase === 'arrived';

/** postazione o scrivania del boss: chi ci lavora digita */
export const isDeskSpot = (spot: Spot): boolean => /-(desk-\d+|boss)$/.test(spot.id);

/** posto al biliardino: chi ci sta gioca (anche '<stanza>:foos-<n>' delle sale hobby, vedi hobby.ts) */
export const isFoosballSpot = (spot: Spot): boolean => /(^|:)foos-\d+$/.test(spot.id);

/** posto davanti alla TV della sala console: chi ci siede gioca col controller */
export const isConsoleSpot = (spot: Spot): boolean => /(^|:)pad-\d+$/.test(spot.id);

/** posto di un giocatore al tavolo da ping-pong */
export const isPingPongSpot = (spot: Spot): boolean => /(^|:)pong-\d+$/.test(spot.id);

/**
 * Posa del personaggio: cammina, digita alla scrivania se lavora, gioca col controller davanti alla TV, seduto se
 * inattivo o sul divano, gioca al biliardino o a ping-pong, altrimenti in piedi.
 */
export function poseOf(actor: PixelActor, m: ActorMotion): Pose {
  if (m.phase !== 'arrived' || !m.at) return 'walk';
  if (!m.at.seated) return isFoosballSpot(m.at) ? 'play' : isPingPongSpot(m.at) ? 'paddle' : 'stand';
  if (isConsoleSpot(m.at)) return 'game';
  const working = actor.agent.status === 'working' || actor.agent.status === 'entering';
  return working && isDeskSpot(m.at) ? 'type' : 'sit';
}

/** fotogrammi al secondo delle animazioni: passo e digitazione svelti, respiro lento */
export const POSE_FPS: Record<Pose, number> = { walk: 8, type: 7, stand: 1.5, sit: 1.2, play: 5, game: 4, paddle: 4 };

/** fotogramma all'istante dell'orologio delle animazioni; `seed` sfasa i personaggi tra loro */
export function frameAt(pose: Pose, clock: AnimClock, seed: number): number {
  return clock.frame(POSE_FPS[pose], (seed % 97) / 13);
}
