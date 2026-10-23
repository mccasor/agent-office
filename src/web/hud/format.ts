import { t } from '../../shared/i18n';

const UNITS = ['', 'k', 'M', 'B'] as const;

/**
 * Formato compatto dei token.
 * - < 1000: intero (0 → "0", 999 → "999")
 * - altrimenti k / M / B con UNA cifra decimale sotto 100 unità e intero da 100 in su,
 *   senza ".0" finale: 1234 → "1.2k", 12_345 → "12.3k", 123_456 → "123k", 2_500_000 → "2.5M"
 * - se l'arrotondamento raggiunge 1000 si passa all'unità successiva (999_999 → "1M")
 * - valori non finiti → "0"; i negativi mantengono il segno
 * - separatore decimale della lingua (#93): il punto in italiano e in inglese, la virgola in spagnolo ("1,2k")
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  let v = Math.abs(n);
  for (let i = 0; i < UNITS.length; i++) {
    const text = i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
    if (Number(text) < 1000 || i === UNITS.length - 1) return text === '0' ? '0' : `${sign}${text.replace('.', t('format.decimal'))}${UNITS[i]}`;
    v /= 1000;
  }
  return '0'; // irraggiungibile
}

/** Percentuale intera 0..100; null se il totale è assente o non positivo. */
export function percent(value: number, total: number | null): number | null {
  if (total === null || !(total > 0)) return null;
  return Math.round(Math.min(100, Math.max(0, (value / total) * 100)));
}

export type ContextLevel = 'ok' | 'warn' | 'danger';

/** Livello di riempimento del contesto: ambra oltre il 70%, rosso oltre il 90%. */
export function contextLevel(pct: number): ContextLevel {
  if (pct > 90) return 'danger';
  if (pct > 70) return 'warn';
  return 'ok';
}

/**
 * Durata compatta: "<1 min", "12 min", "2 h", "2 h 05" (in inglese "12m", "2h 05m"); valori negativi o non finiti →
 * "<1 min". `long` per le frasi: "1 h 12 min".
 */
export function formatDuration(ms: number, long = false): string {
  const min = Number.isFinite(ms) ? Math.floor(ms / 60_000) : 0;
  if (min < 1) return t('dur.lessMin');
  if (min < 60) return t('dur.min', { m: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? t('dur.h', { h }) : t(long ? 'dur.hmLong' : 'dur.hm', { h, mm: String(m).padStart(2, '0') });
}

/** Tempo di lavoro di un agente: fino a ora se è ancora al lavoro, fino all'ultimo aggiornamento se ha finito. */
export function elapsed(agent: { status: string; startedAt: number; updatedAt: number }, now: number): number {
  return (agent.status === 'done' ? agent.updatedAt : now) - agent.startedAt;
}

/** Input effettivo: token in ingresso non letti dalla cache (input + scrittura in cache). */
export const effectiveInput = (t: { input: number; cacheCreation: number }): number => t.input + t.cacheCreation;

/** Urgenza di un agente per l'ordinamento: in attesa, al lavoro (e in arrivo), inattivo, terminato. */
export function urgency(a: { status: string; waiting?: boolean }): number {
  if (a.waiting && a.status !== 'done') return 0;
  return a.status === 'working' || a.status === 'entering' ? 1 : a.status === 'idle' ? 2 : 3;
}

/** Agenti dal più urgente; a parità resta l'ordine di arrivo. Non modifica l'array. */
export const byUrgency = <T extends { status: string; waiting?: boolean }>(agents: readonly T[]): T[] =>
  [...agents].sort((a, b) => urgency(a) - urgency(b));

/** Costo stimato in dollari: "≈ $0,42", "< $0,01" (in inglese "≈ $0.42", in spagnolo "≈ 0,42 $"); null (modello non nel listino) -> "—". */
export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  if (usd < 0.01) return t('format.costTiny');
  return t('format.cost', { n: usd.toFixed(2).replace('.', t('format.costDecimal')) });
}
