import type { AgentOutcome, HistoryEvent } from '../../shared/types';
import { clock, t, tn, type TextKey } from '../../shared/i18n';
import { formatDuration } from './format';

/*
 * Testi composti della vista "Analisi" (#98): attese, eventi della cronologia e loro durata. I testi fissi (titoli,
 * stati vuoti, colonne) sono le chiavi `history.*` di src/shared/i18n, nella lingua corrente (#93).
 */

/** intestazioni della tabella per tipo */
export const TYPES_COLUMNS: readonly TextKey[] = ['history.col.type', 'history.col.count', 'history.col.avgDuration', 'history.col.cost', 'history.col.avgCost'];

/** "1 attesa", "3 attese" */
export const waitsCount = (n: number): string => tn('history.waitsCount', n);

/** Riepilogo delle attese: "3 attese · 12 min in attesa". */
export const waitsSummary = (count: number, totalMs: number): string => t('history.waitsSummary', { count: waitsCount(count), d: formatDuration(totalMs) });

/** "in attesa di un permesso", "agente terminato" */
export function eventLabel(e: Pick<HistoryEvent, 'kind' | 'waitingKind'>): string {
  return e.kind === 'wait' && e.waitingKind ? t(`event.waitFor.${e.waitingKind}`) : t(`event.${e.kind}`);
}

/** Esito da mostrare accanto a "agente terminato" (#97): solo interrotto o fallito, ok è la norma; null altrimenti. */
export const eventOutcome = (e: Pick<HistoryEvent, 'kind' | 'outcome'>): Exclude<AgentOutcome, 'ok'> | null =>
  e.kind === 'agent-end' && e.outcome && e.outcome !== 'ok' ? e.outcome : null;

/** Dettaglio della durata: "in 4 min" per un agente, "dopo 3 min" per uno sblocco; null altrimenti. */
export function eventDuration(e: Pick<HistoryEvent, 'kind' | 'durationMs'>): string | null {
  if (e.durationMs === undefined) return null;
  if (e.kind === 'agent-end') return t('event.in', { d: formatDuration(e.durationMs) });
  return e.kind === 'unblock' ? t('event.after', { d: formatDuration(e.durationMs) }) : null;
}

/** Ora del giorno: "09:42". */
export const clockTime = (ms: number): string => clock(ms);
