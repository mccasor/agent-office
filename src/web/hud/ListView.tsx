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
export function ListView({ sessions, agents, hidden, onToggle }: {
  sessions: SessionState[];
  agents: AgentState[];
  hidden: readonly string[];
  onToggle: (sessionId: string) => void;
}) {
  const now = useNow();
  const active = sessions.filter((s) => s.active);
  return (
    <main className="list-view" aria-label="Sessioni">
      <h1 className="list-view__title">Sessioni attive</h1>
      {active.length === 0 && <p className="list-view__empty">Nessuna sessione di Claude Code attiva.</p>}
      {active.map((s) => {
        const own = agents.filter((a) => a.sessionId === s.id);
        const dot = sessionDot(s, own);
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
          </section>
        );
      })}
    </main>
  );
}
