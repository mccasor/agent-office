import type { OfficeLayout } from './layout';
import { findPath } from './path';

const orderCache = new WeakMap<OfficeLayout, string[]>();

/** seatId ordinati per distanza di percorso (A*) dalla porta; a parità, ordine dei posti nel layout. Irraggiungibili in coda. */
export function seatsByDoorDistance(layout: OfficeLayout): string[] {
  const cached = orderCache.get(layout);
  if (cached) return cached;
  const order = layout.seats
    .map((s, i) => {
      const len = findPath(layout, layout.door, s.cell).length;
      return { id: s.id, i, d: len === 0 ? Infinity : len };
    })
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((s) => s.id);
  orderCache.set(layout, order);
  return order;
}

/**
 * agentId -> seatId. Stabile: chi ha già un posto (ancora esistente) lo mantiene; i nuovi, nell'ordine di agentIds,
 * prendono il primo libero più vicino alla porta (distanza di percorso). Gli agenti assenti liberano il posto.
 * Se i posti finiscono, gli agenti in eccesso restano senza chiave.
 */
export function assignSeats(prev: Record<string, string>, agentIds: string[], layout: OfficeLayout): Record<string, string> {
  const valid = new Set(layout.seats.map((s) => s.id));
  const taken = new Set<string>();
  const out: Record<string, string> = {};
  const ids = [...new Set(agentIds)];
  for (const id of ids) {
    const seat = Object.hasOwn(prev, id) ? prev[id] : undefined;
    if (seat !== undefined && valid.has(seat) && !taken.has(seat)) {
      out[id] = seat;
      taken.add(seat);
    }
  }
  const free = seatsByDoorDistance(layout).filter((s) => !taken.has(s));
  let k = 0;
  for (const id of ids) {
    if (id in out) continue;
    const seat = free[k++];
    if (seat === undefined) break;
    out[id] = seat;
  }
  return out;
}

/**
 * agentId -> id del posto tra `spotIds` (es. divani dell'area relax). Stabile come assignSeats; i nuovi prendono
 * il primo libero nell'ordine dato. Se i posti finiscono si riusano dall'inizio (meglio stretti che in piedi).
 */
export function assignSpots(prev: Record<string, string>, agentIds: string[], spotIds: string[]): Record<string, string> {
  const valid = new Set(spotIds);
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  const ids = [...new Set(agentIds)];
  for (const id of ids) {
    const spot = Object.hasOwn(prev, id) ? prev[id] : undefined;
    if (spot !== undefined && valid.has(spot) && !taken.has(spot)) {
      out[id] = spot;
      taken.add(spot);
    }
  }
  const free = spotIds.filter((s) => !taken.has(s));
  let k = 0;
  for (const id of ids) {
    if (id in out || spotIds.length === 0) continue;
    out[id] = free[k] ?? spotIds[(k - free.length) % spotIds.length]!;
    k++;
  }
  return out;
}
