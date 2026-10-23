import { useEffect, useState } from 'react';
import type { AgentState, FinishedAgent, HistoryReport } from '../../shared/types';
import { formatCost, formatDuration } from './format';
import {
  clockTime, eventDuration, eventLabel, FILES_EMPTY, FILES_HINT, FILES_TITLE, HISTORY_DAY, HISTORY_ERROR, HISTORY_LOADING,
  HISTORY_TITLE, HISTORY_TODAY, TIMELINE_EMPTY, TIMELINE_TITLE, TYPES_COLUMNS, TYPES_EMPTY, TYPES_TITLE, waitsCount,
  waitsSummary, WAITS_EMPTY, WAITS_TITLE,
} from './historyLabels';
import { useNow } from './useNow';
import './hud.css';
import './history.css';

/** Riepilogo di un giorno dal server; null = oggi. */
export async function fetchHistory(day: string | null): Promise<HistoryReport> {
  const res = await fetch(day ? `/api/history?day=${encodeURIComponent(day)}` : '/api/history');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as HistoryReport;
}

/** Terminato di una sessione chiusa come riga dei terminati (FinishedToday): nickname e tipo, durata, token, costo. */
export const finishedAsAgent = (f: FinishedAgent): AgentState => ({
  id: f.id,
  sessionId: f.sessionId,
  // il compito non si salva: al suo posto tipo e progetto
  name: f.project ? `${f.agentType} · ${f.project}` : f.agentType,
  nickname: f.nickname,
  agentType: f.agentType,
  description: '',
  area: f.area,
  status: 'done',
  model: null,
  tokens: { input: 0, output: f.outputTokens, cacheRead: 0, cacheCreation: 0, total: f.outputTokens },
  progress: null,
  issues: [],
  startedAt: f.startedAt,
  updatedAt: f.endedAt,
  cost: f.cost,
});

/** Attese della giornata: totale e per istanza (bloccata su un permesso o una domanda, non a fine turno). */
function Waits({ waits }: { waits: HistoryReport['waits'] }) {
  return (
    <section className="history-card" aria-label={WAITS_TITLE}>
      <h2>{WAITS_TITLE}</h2>
      {waits.count === 0 ? (
        <p className="hud-muted">{WAITS_EMPTY}</p>
      ) : (
        <>
          <p className="history-card__lead">{waitsSummary(waits.count, waits.totalMs)}</p>
          <ul className="history-rows">
            {waits.sessions.map((w) => (
              <li key={w.sessionId}>
                <strong>{w.project ?? w.sessionId.slice(0, 8)}</strong>
                <span className="hud-muted">{`${waitsCount(w.count)} · ${formatDuration(w.totalMs)}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Cronologia degli eventi, dal più recente: ora, evento, agente, progetto, tool, durata. */
function Timeline({ events }: { events: HistoryReport['events'] }) {
  return (
    <section className="history-card" aria-label={TIMELINE_TITLE}>
      <h2>{TIMELINE_TITLE}</h2>
      {events.length === 0 ? (
        <p className="hud-muted">{TIMELINE_EMPTY}</p>
      ) : (
        <ol className="history-timeline">
          {events.map((e, i) => (
            <li key={`${e.at}-${e.kind}-${i}`} className={`history-event history-event--${e.kind}`}>
              <time className="hud-muted">{clockTime(e.at)}</time>
              <span>
                <strong>{eventLabel(e)}</strong>
                <span className="history-event__part">
                  {[e.agent && (e.agentType ? `${e.agent} (${e.agentType})` : e.agent), e.tool, e.project, eventDuration(e)]
                    .filter(Boolean)
                    .map((part) => ` · ${part}`)
                    .join('')}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Statistiche dei terminati per tipo di agente. */
function ByType({ types }: { types: HistoryReport['byType'] }) {
  return (
    <section className="history-card" aria-label={TYPES_TITLE}>
      <h2>{TYPES_TITLE}</h2>
      {types.length === 0 ? (
        <p className="hud-muted">{TYPES_EMPTY}</p>
      ) : (
        <table className="history-table">
          <thead>
            <tr>{TYPES_COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.agentType}>
                <th scope="row">{t.agentType || '—'}</th>
                <td>{t.count}</td>
                <td>{formatDuration(t.avgMs)}</td>
                <td>{formatCost(t.cost)}</td>
                <td>{formatCost(t.avgCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** File più toccati: basename e quanti agenti o istanze l'hanno letto o modificato, con una barra in proporzione. */
function Files({ files }: { files: HistoryReport['files'] }) {
  const max = Math.max(1, ...files.map((f) => f.count));
  return (
    <section className="history-card" aria-label={FILES_TITLE}>
      <h2>{FILES_TITLE}</h2>
      {files.length === 0 ? (
        <p className="hud-muted">{FILES_EMPTY}</p>
      ) : (
        <ul className="history-rows history-files" title={FILES_HINT}>
          {files.map((f) => (
            <li key={f.name}>
              <span className="history-files__name">{f.name}</span>
              <span className="history-files__bar" style={{ width: `${Math.round((f.count / max) * 100)}%` }} />
              <span className="hud-muted">{f.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Contenuto di un riepilogo: attese e file affiancati, poi tipi di agente e cronologia. Pura. */
export function HistoryReportView({ report }: { report: HistoryReport }) {
  return (
    <div className="history-grid">
      <Waits waits={report.waits} />
      <Files files={report.files} />
      <ByType types={report.byType} />
      <Timeline events={report.events} />
    </div>
  );
}

/**
 * Vista "Analisi": lo storico della giornata (o di un giorno passato) letto da /api/history. Oggi si aggiorna col
 * ticchettio di useNow (ogni 15 s); i giorni passati non cambiano e si leggono una volta.
 */
export function HistoryView({ load = fetchHistory }: { load?: (day: string | null) => Promise<HistoryReport> }) {
  const now = useNow();
  /** null = oggi */
  const [day, setDay] = useState<string | null>(null);
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [failed, setFailed] = useState(false);
  const tick = day === null ? now : 0;
  useEffect(() => {
    let live = true;
    load(day).then(
      (r) => {
        if (!live) return;
        setReport(r);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [day, tick, load]);
  const today = report?.days[0] ?? null;
  return (
    <main className="list-view history-view" aria-label={HISTORY_TITLE}>
      <header className="history-head">
        <h1 className="list-view__title">{HISTORY_TITLE}</h1>
        {report && report.days.length > 1 && (
          <label className="history-day">
            {HISTORY_DAY}
            <select value={day ?? report.day} onChange={(e) => setDay(e.target.value === today ? null : e.target.value)}>
              {report.days.map((d) => <option key={d} value={d}>{d === today ? `${d} (${HISTORY_TODAY})` : d}</option>)}
            </select>
          </label>
        )}
      </header>
      {!report && <p className="list-view__empty">{failed ? HISTORY_ERROR : HISTORY_LOADING}</p>}
      {report && <HistoryReportView report={report} />}
    </main>
  );
}
