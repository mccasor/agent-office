import type { AgentState, SessionState, Snapshot } from '../../shared/types';
import { BOSS_PREFIX, bossOf } from '../officeModel';
import { assignSpots } from '../scene/seats';
import { createPlan } from './plan';
import { INSTANCE_ROOMS, type PixelActor, type PixelModel, type PixelSeating, type Spot } from './types';

export const EMPTY_PIXEL_SEATING: PixelSeating = { rooms: {}, spots: {} };

const byRecency = (a: SessionState, b: SessionState) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stanze stabili per le sessioni attive: chi ce l'ha la tiene, le nuove (dalla più recente) prendono la prima libera.
 * Le altre restano senza stanza, dalla più recente.
 */
function assignRooms(prev: Record<string, number>, active: SessionState[]): { rooms: Record<string, number>; roomless: string[] } {
  const rooms: Record<string, number> = {};
  const taken = new Set<number>();
  for (const s of active) {
    const r = Object.hasOwn(prev, s.id) ? prev[s.id] : undefined;
    if (r !== undefined && Number.isInteger(r) && r >= 0 && r < INSTANCE_ROOMS && !taken.has(r)) {
      rooms[s.id] = r;
      taken.add(r);
    }
  }
  const roomless: string[] = [];
  for (const s of [...active].sort(byRecency)) {
    if (s.id in rooms) continue;
    const free = Array.from({ length: INSTANCE_ROOMS }, (_, i) => i).find((i) => !taken.has(i));
    if (free === undefined) roomless.push(s.id);
    else {
      rooms[s.id] = free;
      taken.add(free);
    }
  }
  return { rooms, roomless };
}

/** Deriva dallo snapshot chi va dove nella vista 2D; `prev` garantisce stanze e posti stabili. */
export function pixelModel(snapshot: Snapshot | null, prev: PixelSeating): PixelModel {
  const plan = createPlan();
  const agents = snapshot?.agents ?? [];
  const active = (snapshot?.sessions ?? []).filter((s) => s.active);
  const bosses = active.map((s) => bossOf(s, active.length > 1));
  const { rooms, roomless } = assignRooms(prev.rooms, active);

  // chi ha finito aspetta in sala relax finché lavora un subagente della sua sessione, solo se era già presente
  // (come in officeModel: un terminato mai visto lavorare, o già uscito, non rientra)
  const busy = new Set(agents.filter((a) => a.status !== 'done').map((a) => a.sessionId));
  const present = (a: AgentState) => a.id.startsWith(BOSS_PREFIX) || Object.hasOwn(prev.spots, a.id);
  const resting = [...agents, ...bosses].filter((a) => a.status === 'done' && busy.has(a.sessionId) && present(a));
  const lounge = plan.rooms.find((r) => r.kind === 'lounge')!;
  const spots = assignSpots(prev.spots, resting.map((a) => a.id), lounge.seats.map((s) => s.id));

  // al lavoro: boss alla sua scrivania, agenti sulle postazioni della stanza; senza stanza o oltre l'ottavo, corridoio
  const hall: string[] = [];
  for (const b of bosses) {
    if (b.status === 'done') continue;
    const room = rooms[b.sessionId];
    const boss = room === undefined ? null : plan.rooms[room]!.boss;
    if (boss) spots[b.id] = boss.id;
    else hall.push(b.id);
  }
  const workers = agents.filter((a) => a.status !== 'done');
  for (const [sessionId, room] of Object.entries(rooms)) {
    const ids = workers.filter((a) => a.sessionId === sessionId).map((a) => a.id);
    const desks = assignSpots(prev.spots, ids, plan.rooms[room]!.desks.map((d) => d.id));
    Object.assign(spots, desks);
    hall.push(...ids.filter((id) => !(id in desks)));
  }
  hall.push(...workers.filter((a) => rooms[a.sessionId] === undefined).map((a) => a.id));
  Object.assign(spots, assignSpots(prev.spots, hall, plan.overflow.map((s) => s.id)));

  const spotById = new Map<string, Spot>(
    [...plan.rooms.flatMap((r) => [...r.desks, ...(r.boss ? [r.boss] : []), ...r.seats]), ...plan.overflow].map((s) => [s.id, s]),
  );
  // il boss solo se è Claude stesso a essere bloccato; un subagente bloccato ha il suo fumetto
  const waiting = new Set(active.filter((s) => s.waiting && !s.waitingAgentId).map((s) => s.id));
  const actors: PixelActor[] = [...agents, ...bosses].map((a) => {
    const boss = a.id.startsWith(BOSS_PREFIX);
    const spot = spots[a.id];
    return {
      id: a.id,
      agent: a,
      sessionId: a.sessionId,
      boss,
      target: spot === undefined ? null : (spotById.get(spot) ?? null),
      waiting: boss ? waiting.has(a.sessionId) : a.waiting === true,
    };
  });
  return { plan, rooms, spots, actors, roomless };
}
