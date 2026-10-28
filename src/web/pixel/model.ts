import type { AgentState, SessionState, Snapshot } from '../../shared/types';
import { BOSS_PREFIX, bossOf } from './boss';
import { assignSpots } from './seats';
import { createPlan } from './plan';
import type { PixelActor, PixelModel, PixelPlan, PixelSeating, Room, Spot } from './types';

export const EMPTY_PIXEL_SEATING: PixelSeating = { rooms: {}, spots: {} };

const byRecency = (a: SessionState, b: SessionState) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stanze stabili per le sessioni attive: chi ce l'ha la tiene, le nuove (dalla più recente) prendono la prima libera.
 * Le altre restano senza stanza, dalla più recente.
 */
function assignRooms(prev: Record<string, number>, active: SessionState[], count: number): { rooms: Record<string, number>; roomless: string[] } {
  const rooms: Record<string, number> = {};
  const taken = new Set<number>();
  for (const s of active) {
    const r = Object.hasOwn(prev, s.id) ? prev[s.id] : undefined;
    if (r !== undefined && Number.isInteger(r) && r >= 0 && r < count && !taken.has(r)) {
      rooms[s.id] = r;
      taken.add(r);
    }
  }
  const roomless: string[] = [];
  for (const s of [...active].sort(byRecency)) {
    if (s.id in rooms) continue;
    const free = Array.from({ length: count }, (_, i) => i).find((i) => !taken.has(i));
    if (free === undefined) roomless.push(s.id);
    else {
      rooms[s.id] = free;
      taken.add(free);
    }
  }
  return { rooms, roomless };
}

/**
 * Posti delle sale hobby nell'ordine in cui si occupano: a coppie, una sala dopo l'altra (i primi due della prima, i
 * primi due della seconda...), così chi aspetta si distribuisce tra tutte e al biliardino si gioca in due.
 */
export function hobbySeats(rooms: readonly Room[]): Spot[] {
  const halls = rooms.filter((r) => r.kind === 'lounge');
  const out: Spot[] = [];
  const most = Math.max(0, ...halls.map((r) => r.seats.length));
  for (let k = 0; k < most; k += 2) for (const r of halls) out.push(...r.seats.slice(k, k + 2));
  return out;
}

/**
 * Deriva dallo snapshot chi va dove nella vista 2D; `prev` garantisce stanze e posti stabili. `plan` è la pianta della
 * composizione (createPlan): stanze e posti che non ci sono più si riassegnano.
 */
export function pixelModel(snapshot: Snapshot | null, prev: PixelSeating, plan: PixelPlan = createPlan()): PixelModel {
  const work = plan.rooms.filter((r) => r.kind === 'instance').length;
  const agents = snapshot?.agents ?? [];
  const active = (snapshot?.sessions ?? []).filter((s) => s.active);
  const bosses = active.map((s) => bossOf(s, active.length > 1));
  const { rooms, roomless } = assignRooms(prev.rooms, active, work);

  // chi ha finito aspetta in una sala hobby finché lavora un subagente della sua sessione, solo se era già presente
  // (un terminato mai visto lavorare, o già uscito, non rientra)
  const busy = new Set(agents.filter((a) => a.status !== 'done').map((a) => a.sessionId));
  const present = (a: AgentState) => a.id.startsWith(BOSS_PREFIX) || Object.hasOwn(prev.spots, a.id);
  const resting = [...agents, ...bosses].filter((a) => a.status === 'done' && busy.has(a.sessionId) && present(a));
  const spots = assignSpots(prev.spots, resting.map((a) => a.id), hobbySeats(plan.rooms).map((s) => s.id));

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
      alert: !boss && a.status !== 'done' && !a.waiting && !!a.alert,
    };
  });
  const idle = active.filter((s) => s.dot === 'idle').map((s) => s.id);
  return { plan, rooms, spots, actors, roomless, idle };
}
