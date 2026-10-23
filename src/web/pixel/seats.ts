/**
 * agentId -> id del posto tra `spotIds`. Stabile: chi ha già un posto (ancora esistente) lo mantiene; i nuovi, nell'ordine
 * di agentIds, prendono il primo libero nell'ordine dato. Mai due agenti sullo stesso posto: se finiscono, gli ultimi
 * restano senza chiave.
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
    if (id in out) continue;
    const spot = free[k++];
    if (spot === undefined) break;
    out[id] = spot;
  }
  return out;
}
