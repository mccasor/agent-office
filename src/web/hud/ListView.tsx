import { useState } from 'react';
import type { AgentState, AgentStatus, OfficeStatus, SessionState } from '../../shared/types';
import { contextLevel, elapsed, formatCost, formatDuration, formatTokens, percent } from './format';
import { SESSION_STATUS_LABEL, STATUS_LABEL, toolText, waitingText } from './labels';
import { DiffStat, projectName, StatusDot } from './panels';
import { ProgressBar } from './ProgressBar';
import { useNow } from './useNow';
import './hud.css';

/** Colore del pallino di una sessione, con la stessa regola dell'icona nella menu bar. */
export function sessionDot(session: SessionState, agents: AgentState[]): OfficeStatus {
  if (!session.active) return 'idle';
  if (session.waiting) return 'waiting';
  const busy = (s: AgentStatus) => s === 'working' || s === 'entering';
  return busy(session.status) || agents.some((a) => busy(a.status)) ? 'working' : 'idle';
}

const issueText = (issues: number[]): string => issues.map((n) => `#${n}`).join(' ');

interface ListFilter {
  query: string;
  waitingOnly: boolean;
  hideDone: boolean;
}

const FILTER_KEY = 'agent-office:list-filter';
const NO_FILTER: ListFilter = { query: '', waitingOnly: false, hideDone: false };

/** Filtro della lista ricordato nel browser (comodità per chi guarda; può mancare in finestre private). */
function loadFilter(): ListFilter {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null');
    return typeof saved === 'object' && saved !== null ? { ...NO_FILTER, ...(saved as Partial<ListFilter>) } : NO_FILTER;
  } catch {
    return NO_FILTER;
  }
}

function saveFilter(filter: ListFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // storage non disponibile: il filtro vale solo per questa pagina
  }
}

/** La sessione corrisponde alla ricerca: progetto, branch, titolo o nome di un suo agente (senza maiuscole). */
function matches(query: string, s: SessionState, agents: AgentState[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [projectName(s), s.branch ?? '', s.title ?? '', ...agents.map((a) => a.name)].some((text) => text.toLowerCase().includes(q));
}

/** Agenti della sessione terminati oggi: nome, durata, costo. Chiusa di default. */
function FinishedToday({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) return null;
  return (
    <details className="list-finished">
      <summary>{`Terminati oggi (${agents.length})`}</summary>
      <ul className="list-agents">
        {agents.map((a) => (
          <li key={a.id} className="list-agent list-agent--done">
            <span className="list-agent__name" title={a.name}>{a.name}</span>
            <span className={`hud-chip hud-chip--${a.area}`}>{a.area}</span>
            <span className="list-agent__status hud-muted">
              {[`in ${formatDuration(a.updatedAt - a.startedAt)}`, `${formatTokens(a.tokens.output)} token`, a.cost !== null && a.cost !== undefined ? formatCost(a.cost) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Contesto usato dalla sessione: utile per capire quando sta per essere compattata. */
function ContextBar({ session }: { session: SessionState }) {
  const pct = percent(session.context.used, session.context.window);
  if (pct === null) return null;
  return (
    <div className="list-session__context">
      <span className="hud-muted">{`Contesto ${pct}%`}</span>
      <ProgressBar value={pct} label={`Contesto usato ${projectName(session)}`} level={contextLevel(pct)} className="hud-bar--small" />
    </div>
  );
}

/** Pulsante a due stati in alto a destra: ufficio 3D o lista delle sessioni. */
export function ViewToggle({ view, onChange }: { view: 'office' | 'list'; onChange: (view: 'office' | 'list') => void }) {
  return (
    <div className="hud-toggle" role="group" aria-label="Vista">
      <button type="button" aria-pressed={view === 'office'} onClick={() => onChange('office')}>
        Ufficio
      </button>
      <button type="button" aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        Lista
      </button>
    </div>
  );
}

/**
 * Vista lista: una scheda per sessione (pallino di stato, progetto, branch, issue, modello, token) con i suoi agenti;
 * la casella "Nell'ufficio" sceglie quali sessioni mostrare nella scena 3D.
 */
export function ListView({ sessions, agents, finished = [], hidden, onToggle }: {
  sessions: SessionState[];
  agents: AgentState[];
  /** terminati oggi e già usciti dall'ufficio */
  finished?: AgentState[];
  hidden: readonly string[];
  onToggle: (sessionId: string) => void;
}) {
  const now = useNow();
  const [filter, setFilter] = useState(loadFilter);
  const update = (next: Partial<ListFilter>) => {
    const value = { ...filter, ...next };
    setFilter(value);
    saveFilter(value);
  };
  const active = sessions.filter((s) => s.active);
  const shown = active
    .map((s) => {
      const all = agents.filter((a) => a.sessionId === s.id);
      return { s, all, own: filter.hideDone ? all.filter((a) => a.status !== 'done') : all, dot: sessionDot(s, all) };
    })
    .filter(({ s, all, dot }) => (!filter.waitingOnly || dot === 'waiting') && matches(filter.query, s, all));
  return (
    <main className="list-view" aria-label="Sessioni">
      <h1 className="list-view__title">Sessioni attive</h1>
      {active.length > 0 && (
        <div className="list-filter" role="search">
          <input
            type="search"
            placeholder="Cerca progetto, branch o agente"
            aria-label="Cerca"
            value={filter.query}
            onChange={(e) => update({ query: e.target.value })}
          />
          <label>
            <input type="checkbox" checked={filter.waitingOnly} onChange={(e) => update({ waitingOnly: e.target.checked })} />
            Solo in attesa
          </label>
          <label>
            <input type="checkbox" checked={filter.hideDone} onChange={(e) => update({ hideDone: e.target.checked })} />
            Nascondi terminati
          </label>
        </div>
      )}
      {active.length === 0 && <p className="list-view__empty">Nessuna sessione di Claude Code attiva.</p>}
      {active.length > 0 && shown.length === 0 && <p className="list-view__empty">Nessuna sessione corrisponde al filtro.</p>}
      {shown.map(({ s, own, dot }) => {
        return (
          <section key={s.id} className="list-session" aria-label={projectName(s)}>
            <header className="list-session__head">
              <StatusDot status={dot} />
              <div className="list-session__name">
                <strong>{projectName(s)}</strong>
                {s.branch && <span className="hud-muted">{s.branch}</span>}
                {s.issues.length > 0 && <span className="hud-label__issue">{issueText(s.issues)}</span>}
              </div>
              <label className="list-session__show">
                <input type="checkbox" checked={!hidden.includes(s.id)} onChange={() => onToggle(s.id)} />
                Nell'ufficio
              </label>
            </header>
            {s.title && <p className="list-session__title">{s.title}</p>}
            {s.diff && <DiffStat diff={s.diff} />}
            <p className="list-session__meta hud-muted">
              {[
                s.model,
                s.effort,
                `${formatTokens(s.tokensUsed.output)} token generati`,
                s.cost !== null && s.cost !== undefined ? formatCost(s.cost) : null,
                `attiva da ${formatDuration(now - s.startedAt)}`,
                s.waiting ? waitingText(s.waitingKind, s.waitingSince, now) : SESSION_STATUS_LABEL[s.status],
                s.tool && !s.waiting ? toolText(s.tool) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <ContextBar session={s} />
            {own.length > 0 && (
              <ul className="list-agents">
                {own.map((a) => {
                  const pct = a.progress ? percent(a.progress.completed, a.progress.total) : null;
                  return (
                    <li key={a.id} className={`list-agent list-agent--${a.status}`}>
                      <span className="list-agent__name" title={a.name}>
                        {a.name}
                        {a.issues.length > 0 && <span className="hud-label__issue">{issueText(a.issues)}</span>}
                      </span>
                      <span className={`hud-chip hud-chip--${a.area}`}>{a.area}</span>
                      <span className="list-agent__status hud-muted">
                        {[
                          STATUS_LABEL[a.status],
                          a.tool && a.status !== 'done' ? toolText(a.tool) : null,
                          `${a.status === 'done' ? 'in' : 'da'} ${formatDuration(elapsed(a, now))}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {pct === null ? <span /> : <ProgressBar value={pct} label={`Avanzamento ${a.name}`} className="hud-bar--small" />}
                    </li>
                  );
                })}
              </ul>
            )}
            <FinishedToday agents={finished.filter((a) => a.sessionId === s.id)} />
          </section>
        );
      })}
    </main>
  );
}
