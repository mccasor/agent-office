import type { AgentOutcome, DayStats, Snapshot } from '../../shared/types.js';

/** finestra del costo orario */
const HOUR_MS = 60 * 60_000;
/** una sessione non vista da così tanto si dimentica (il suo costo di base non serve più) */
const FORGET_MS = 2 * 24 * HOUR_MS;

/** mezzanotte locale del giorno di `t` */
export function midnightOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DayTracker {
  /** aggiorna i conteggi con uno snapshot appena costruito e restituisce i numeri della giornata */
  observe(snapshot: Snapshot, now: number): DayStats;
}

/**
 * Cruscotto della giornata (#97), in memoria e solo da quanto il server vede da quando è partito (lo storico
 * persistente è altrove). Il costo di oggi somma gli aumenti del costo delle sessioni (chi è iniziata oggi conta per
 * intero, le altre da quando sono state viste); l'ultima ora solo gli aumenti visti negli ultimi 60 minuti. Gli
 * agenti si contano per id (partiti oggi, terminati oggi con l'esito). L'attesa somma, sessione per sessione, il tempo
 * in cui è bloccata sull'utente. A mezzanotte si riparte da zero.
 */
export function createDayTracker(startedAt: number): DayTracker {
  let day = midnightOf(startedAt);
  /** ultimo costo visto e quando, per sessione */
  const costs = new Map<string, { cost: number; seen: number }>();
  let cost = 0;
  let priced = false;
  /** aumenti di costo con il loro istante, per l'ultima ora */
  let samples: { at: number; usd: number }[] = [];
  /** subagenti visti: partenza, fine ed esito */
  const agents = new Map<string, { startedAt: number; endedAt: number | null; outcome: AgentOutcome | null }>();
  /** sessioni bloccate adesso: da quando */
  const waits = new Map<string, number>();
  let waited = 0;

  const newDay = (now: number) => {
    day = midnightOf(now);
    cost = 0;
    priced = false;
    samples = [];
    waited = 0;
    // le attese aperte continuano, contate da mezzanotte
    for (const [id, a] of agents) if (Math.max(a.startedAt, a.endedAt ?? 0) < day) agents.delete(id);
    for (const [id, c] of costs) if (now - c.seen > FORGET_MS) costs.delete(id);
  };

  return {
    observe(snapshot, now) {
      if (midnightOf(now) !== day) newDay(now);

      for (const s of snapshot.sessions) {
        if (typeof s.cost !== 'number') continue;
        priced = true;
        const prev = costs.get(s.id);
        // prima volta: chi è nata oggi conta per intero (dall'ultima ora solo se nata dopo l'avvio), le altre da adesso
        const base = prev ? prev.cost : s.startedAt >= day ? 0 : s.cost;
        const delta = Math.max(0, s.cost - base);
        costs.set(s.id, { cost: s.cost, seen: now });
        if (delta === 0) continue;
        cost += delta;
        if (prev || s.startedAt >= startedAt) samples.push({ at: now, usd: delta });
      }
      samples = samples.filter((x) => now - x.at < HOUR_MS);

      for (const a of [...snapshot.agents, ...(snapshot.finished ?? [])]) {
        const done = a.status === 'done';
        const known = agents.get(a.id);
        if (known && (known.outcome !== null || !done)) continue;
        agents.set(a.id, { startedAt: a.startedAt, endedAt: done ? a.updatedAt : null, outcome: done ? (a.outcome ?? 'ok') : null });
      }

      const blocked = new Set<string>();
      for (const s of snapshot.sessions) {
        if (!s.active || !s.waiting) continue;
        blocked.add(s.id);
        if (!waits.has(s.id)) waits.set(s.id, Math.min(now, s.waitingSince ?? now));
      }
      for (const [id, since] of waits) {
        if (blocked.has(id)) continue;
        waited += Math.max(0, now - Math.max(since, day));
        waits.delete(id);
      }
      let open = 0;
      for (const since of waits.values()) open += Math.max(0, now - Math.max(since, day));

      let launched = 0;
      let finished = 0;
      let failed = 0;
      for (const a of agents.values()) {
        if (a.startedAt >= day) launched++;
        if (a.outcome === null || (a.endedAt ?? 0) < day) continue;
        if (a.outcome === 'failed') failed++;
        else finished++;
      }
      const lastHour = samples.reduce((sum, x) => sum + x.usd, 0);
      // arrotondati (centesimi, minuti): lo snapshot non cambia a ogni giro per differenze invisibili
      const cents = (usd: number) => Math.round(usd * 100) / 100;
      return {
        since: Math.max(day, startedAt),
        cost: priced ? cents(cost) : null,
        costLastHour: priced ? cents(lastHour) : null,
        launched,
        finished,
        failed,
        waitingMs: Math.floor((waited + open) / 60_000) * 60_000,
      };
    },
  };
}
