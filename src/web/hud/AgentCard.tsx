import { useEffect } from 'react';
import type { AgentState, SessionState } from '../../shared/types';
import { contextLevel, elapsed, formatCost, formatDuration, formatTokens, percent } from './format';
import { projectName, SESSION_STATUS_LABEL, STATUS_LABEL, toolText } from './labels';
import { DiffStat, Row, SessionAlert } from './panels';
import { ProgressBar } from './ProgressBar';
import { TokenBreakdown } from './TokenBreakdown';
import { useNow } from './useNow';
import './hud.css';

const DASH = '—';

/** Contesto usato dalla sessione: token, percentuale e barra colorata per livello. */
function SessionContext({ session }: { session: SessionState }) {
  const { used, window } = session.context;
  const pct = percent(used, window);
  return (
    <div className="hud-context">
      <div className="hud-context__head">
        <span className="hud-muted">Contesto</span>
        <span>{`${formatTokens(used)} / ${window === null ? '?' : formatTokens(window)}`}</span>
        {pct !== null && <span className="hud-context__pct">{`${pct}%`}</span>}
      </div>
      {pct !== null && <ProgressBar value={pct} label="Contesto usato" level={contextLevel(pct)} />}
    </div>
  );
}

/**
 * Scheda di un agente, a destra, aperta al clic sul personaggio o nell'elenco delle istanze: nome, descrizione,
 * tipo, stato, tool in uso, durata, modello, avanzamento, issue, costo e token. Per Claude stesso (`session`)
 * anche progetto, branch, motivo del blocco e contesto. Si chiude con il pulsante o con Esc.
 */
export function AgentCard({ agent, session = null, onClose }: {
  agent: AgentState;
  /** sessione di cui l'agente è Claude stesso (il boss); null per i subagenti */
  session?: SessionState | null;
  onClose: () => void;
}) {
  const now = useNow();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { progress } = agent;
  const pct = progress ? percent(progress.completed, progress.total) : null;
  const done = agent.status === 'done';
  const status = session ? SESSION_STATUS_LABEL[agent.status] : STATUS_LABEL[agent.status];
  // Claude stesso: il tool è quello della sessione e a fine turno non ha "terminato", è pronto
  const tool = session ? session.tool : agent.tool;
  const duration = session ? `da ${formatDuration(now - session.startedAt)}` : `${done ? 'in' : 'da'} ${formatDuration(elapsed(agent, now))}`;
  return (
    <section className="hud-panel hud-card" aria-label={`Scheda di ${agent.name}`}>
      <header className="hud-card__head">
        <span className="hud-title" title={agent.name}>{agent.name}</span>
        <button type="button" className="hud-card__close" aria-label="Chiudi la scheda" title="Chiudi (Esc)" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="hud-card__chips">
        <span className={`hud-chip hud-chip--${agent.area}`} data-area={agent.area}>{agent.area}</span>
        {agent.issues.length > 0 && <span className="hud-label__issue">{agent.issues.map((n) => `#${n}`).join(' ')}</span>}
      </div>
      {agent.description && agent.description !== agent.name && <p className="hud-card__desc">{agent.description}</p>}
      {session?.waiting && <SessionAlert session={session} />}
      {session && (
        <dl>
          <Row label="Progetto">{projectName(session)}</Row>
          <Row label="Branch">{session.branch ?? DASH}</Row>
          <Row label="Effort">{session.effort ?? DASH}</Row>
        </dl>
      )}
      {session?.diff && <DiffStat diff={session.diff} />}
      {session && <SessionContext session={session} />}
      <dl>
        <Row label="Tipo">{agent.agentType}</Row>
        <Row label="Stato">{status}</Row>
        {tool && !done && <Row label="In uso">{toolText(tool)}</Row>}
        <Row label="Durata">{duration}</Row>
        <Row label="Modello">{agent.model ?? DASH}</Row>
        <Row label="Costo stimato">
          <span data-testid="agent-cost">{formatCost(session ? session.cost : agent.cost)}</span>
        </Row>
      </dl>
      {progress && pct !== null && (
        <div className="hud-context">
          <div className="hud-context__head">
            <span className="hud-muted">Avanzamento</span>
            <span className="hud-context__pct">{`${progress.completed}/${progress.total} · ${pct}%`}</span>
          </div>
          <ProgressBar value={pct} label={`Avanzamento ${agent.name}`} />
        </div>
      )}
      <div className="hud-card__section hud-muted">Token</div>
      <TokenBreakdown tokens={agent.tokens} />
    </section>
  );
}
