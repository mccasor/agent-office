import { readFile, rename, writeFile } from 'node:fs/promises';
import type { DayStats, Snapshot } from '../../shared/types.js';
import { dayOf, type DayCounts } from '../history/index.js';

/** finestra del costo orario */
const HOUR_MS = 60 * 60_000;
/** una sessione non vista da così tanto si dimentica (il suo costo di base non serve più) */
const FORGET_MS = 2 * 24 * HOUR_MS;
/** il costo si salva al più ogni tanto: un arresto brusco perde solo il $/h di questo intervallo, non il costo */
export const SAVE_MS = 30_000;

/** mezzanotte locale del giorno di `t` */
export function midnightOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DayTracker {
  /** riprende il costo della giornata dal file (se è di oggi) */
  start(): Promise<void>;
  /** aggiorna il costo con uno snapshot appena costruito e restituisce i numeri della giornata, con i conteggi dello storico */
  observe(snapshot: Snapshot, now: number, counts: DayCounts): DayStats;
  /** salva il costo se è cambiato e attende le scritture in corso */
  flush(): Promise<void>;
}

export interface DayTrackerOptions {
  /** file del costo della giornata: <dataDir>/today.json; senza, solo in memoria */
  file?: string;
}

/** contenuto di today.json: solo id di sessione, istanti e dollari (mai testo) */
interface SavedDay {
  day: string;
  since: number;
  cost: number;
  priced: boolean;
  /** ultimo costo contato per sessione */
  sessions: Record<string, { cost: number; seen: number }>;
  /** aumenti dell'ultima ora, a minuti */
  samples: { at: number; usd: number }[];
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Legge today.json; null se manca, è illeggibile o non è del giorno `day`. */
async function load(file: string, day: string): Promise<SavedDay | null> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as Partial<SavedDay>;
    if (v.day !== day || !num(v.since) || !num(v.cost) || typeof v.sessions !== 'object' || v.sessions === null) return null;
    const sessions: SavedDay['sessions'] = {};
    for (const [id, c] of Object.entries(v.sessions)) if (num(c?.cost) && num(c?.seen)) sessions[id] = { cost: c.cost, seen: c.seen };
    const samples = Array.isArray(v.samples) ? v.samples.filter((x) => num(x?.at) && num(x?.usd)) : [];
    return { day, since: v.since, cost: v.cost, priced: v.priced === true, sessions, samples };
  } catch {
    return null;
  }
}

/**
 * Cruscotto della giornata (#97). Agenti lanciati, finiti e falliti e tempo in attesa vengono dallo storico (#102), che
 * si conserva tra i riavvii e ha già la sua deduplica. Il costo di oggi somma gli aumenti del costo delle sessioni (chi
 * è iniziata oggi conta per intero, le altre da quando sono state viste); l'ultima ora solo gli aumenti visti negli
 * ultimi 60 minuti. Costo, ultimo costo contato per sessione e aumenti dell'ultima ora si salvano in today.json (rename
 * atomico, solo se cambiati e al più ogni SAVE_MS): al riavvio si riparte da lì, e l'aumento di una sessione già
 * contata (fatto a server spento o dopo l'ultimo salvataggio) va nel costo di oggi ma non nell'ultima ora, perché non
 * si sa quando è avvenuto. A mezzanotte il costo riparte da zero.
 */
export function createDayTracker(startedAt: number, opts: DayTrackerOptions = {}): DayTracker {
  let day = midnightOf(startedAt);
  let since = startedAt;
  /** ultimo costo visto e quando, per sessione */
  const costs = new Map<string, { cost: number; seen: number }>();
  /** sessioni viste da questo avvio: solo i loro aumenti sono dell'ultima ora */
  const live = new Set<string>();
  let cost = 0;
  let priced = false;
  /** aumenti di costo per minuto, per l'ultima ora */
  let samples: { at: number; usd: number }[] = [];
  /** qualcosa da salvare: costo, sessioni nuove o giorno cambiato */
  let dirty = false;
  let savedAt = startedAt;
  let writing: Promise<void> = Promise.resolve();

  const newDay = (now: number) => {
    day = midnightOf(now);
    since = day;
    cost = 0;
    priced = false;
    samples = [];
    dirty = true;
    for (const [id, c] of costs) if (now - c.seen > FORGET_MS) costs.delete(id);
  };

  const save = (now: number) => {
    if (!opts.file) return;
    const file = opts.file;
    dirty = false;
    savedAt = now;
    // solo le sessioni viste oggi: le altre, se tornano, ripartono dal costo che hanno (non nate oggi)
    const sessions: SavedDay['sessions'] = {};
    for (const [id, c] of costs) if (c.seen >= day) sessions[id] = c;
    const saved: SavedDay = { day: dayOf(day), since, cost, priced, sessions, samples };
    const text = JSON.stringify(saved);
    writing = writing.then(async () => {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, file);
    }).catch(() => {}); // disco pieno o cartella rimossa: al più il costo riparte da quel che si vede
  };

  return {
    async start() {
      if (!opts.file) return;
      const saved = await load(opts.file, dayOf(day));
      if (!saved) return;
      since = Math.min(since, saved.since);
      cost = saved.cost;
      priced = saved.priced;
      for (const [id, c] of Object.entries(saved.sessions)) costs.set(id, c);
      samples = saved.samples.filter((x) => startedAt - x.at < HOUR_MS);
    },

    observe(snapshot, now, counts) {
      if (midnightOf(now) !== day) newDay(now);

      for (const s of snapshot.sessions) {
        if (typeof s.cost !== 'number') continue;
        if (!priced) dirty = true;
        priced = true;
        const prev = costs.get(s.id);
        // prima volta: chi è nata oggi conta per intero (dall'ultima ora solo se nata dopo l'avvio), le altre da adesso
        const base = prev ? prev.cost : s.startedAt >= day ? 0 : s.cost;
        const delta = Math.max(0, s.cost - base);
        if (!prev || prev.cost !== s.cost) dirty = true;
        costs.set(s.id, { cost: s.cost, seen: now });
        const fresh = live.has(s.id);
        live.add(s.id);
        if (delta === 0) continue;
        cost += delta;
        // una sessione già contata prima del riavvio: l'aumento è di quando il server era spento, non dell'ultima ora
        if (fresh || s.startedAt >= startedAt) {
          const minute = Math.floor(now / 60_000) * 60_000;
          const last = samples[samples.length - 1];
          if (last?.at === minute) last.usd += delta;
          else samples.push({ at: minute, usd: delta });
        }
      }
      samples = samples.filter((x) => now - x.at < HOUR_MS);
      if (dirty && now - savedAt >= SAVE_MS) save(now);

      const lastHour = samples.reduce((sum, x) => sum + x.usd, 0);
      // arrotondati (centesimi, minuti): lo snapshot non cambia a ogni giro per differenze invisibili
      const cents = (usd: number) => Math.round(usd * 100) / 100;
      return {
        since: Math.max(day, since),
        cost: priced ? cents(cost) : null,
        costLastHour: priced ? cents(lastHour) : null,
        launched: counts.launched,
        finished: counts.finished,
        failed: counts.failed,
        waitingMs: Math.floor(counts.waitingMs / 60_000) * 60_000,
      };
    },

    async flush() {
      if (dirty) save(Date.now());
      await writing;
    },
  };
}
