import type { AgentOutcome, HistoryEvent, HistoryEventKind, WaitingKind } from '../../shared/types';
import { formatDuration } from './format';

/*
 * Testi della vista "Analisi" (#98), raccolti qui per la traduzione: cronologia, attese, statistiche per tipo,
 * file più toccati, terminati delle istanze chiuse nella vista lista.
 */

export const HISTORY_TITLE = 'Analisi della giornata';
export const HISTORY_DAY = 'Giorno';
export const HISTORY_TODAY = 'oggi';
export const HISTORY_LOADING = 'Caricamento…';
export const HISTORY_ERROR = 'Storico non disponibile';

export const WAITS_TITLE = 'Attese';
export const WAITS_EMPTY = 'Nessuna attesa';
export const TIMELINE_TITLE = 'Cronologia';
export const TIMELINE_EMPTY = 'Nessun evento';
export const TYPES_TITLE = 'Per tipo di agente';
export const TYPES_EMPTY = 'Nessun agente terminato';
export const FILES_TITLE = 'File più toccati';
export const FILES_EMPTY = 'Nessun file';
/** spiegazione del conteggio accanto a ogni file */
export const FILES_HINT = 'agenti e istanze che l\'hanno letto o modificato';

/** intestazioni della tabella per tipo */
export const TYPES_COLUMNS = ['Tipo', 'Quanti', 'Durata media', 'Costo', 'Costo medio'] as const;

/** Terminati di oggi delle istanze già chiuse (B5), in fondo alla vista lista. */
export const CLOSED_FINISHED_TITLE = 'Terminati oggi nelle istanze chiuse';

/** "1 attesa", "3 attese" */
export const waitsCount = (n: number): string => (n === 1 ? '1 attesa' : `${n} attese`);

/** Riepilogo delle attese: "3 attese · 12 min in attesa". */
export const waitsSummary = (count: number, totalMs: number): string => `${waitsCount(count)} · ${formatDuration(totalMs)} in attesa`;

const EVENT_LABEL: Record<HistoryEventKind, string> = {
  'agent-start': 'agente avviato',
  'agent-end': 'agente terminato',
  wait: 'in attesa',
  unblock: 'sbloccata',
  compact: 'contesto compattato',
  'session-open': 'istanza aperta',
  'session-close': 'istanza chiusa',
};

const WAIT_REASON: Record<WaitingKind, string> = {
  permission: 'di un permesso',
  question: 'di una risposta',
  plan: 'dell\'ok al piano',
  input: 'di un input',
};

/** "in attesa di un permesso", "agente terminato" */
export function eventLabel(e: Pick<HistoryEvent, 'kind' | 'waitingKind'>): string {
  const label = EVENT_LABEL[e.kind];
  return e.kind === 'wait' && e.waitingKind ? `${label} ${WAIT_REASON[e.waitingKind]}` : label;
}

/** Esito da mostrare accanto a "agente terminato" (#97): solo interrotto o fallito, ok è la norma; null altrimenti. */
export const eventOutcome = (e: Pick<HistoryEvent, 'kind' | 'outcome'>): Exclude<AgentOutcome, 'ok'> | null =>
  e.kind === 'agent-end' && e.outcome && e.outcome !== 'ok' ? e.outcome : null;

/** Dettaglio della durata: "in 4 min" per un agente, "dopo 3 min" per uno sblocco; null altrimenti. */
export function eventDuration(e: Pick<HistoryEvent, 'kind' | 'durationMs'>): string | null {
  if (e.durationMs === undefined) return null;
  if (e.kind === 'agent-end') return `in ${formatDuration(e.durationMs)}`;
  return e.kind === 'unblock' ? `dopo ${formatDuration(e.durationMs)}` : null;
}

/** Ora del giorno: "09:42". */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
