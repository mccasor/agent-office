import { useEffect } from 'react';
import type { AgentState, SessionState } from '../../shared/types';
import { contextLevel, elapsed, formatDuration, formatTokens, percent } from './format';
import {
  agentName, agentTask, COMPACT_HINT, compactionText, projectName, SESSION_STATUS_LABEL, statusText, STATUS_LABEL,
} from './labels';
import { CONTEXT_BAR_FROM, DiffStat, PopOutButton, RoleChip, Row, SessionAlert } from './panels';
import { ProgressBar } from './ProgressBar';
import { TokenSummary } from './TokenBreakdown';
import { useNow } from './useNow';
import './hud.css';

const DASH = '—';

/**
 * Contesto usato dalla sessione: token e percentuale; la barra solo dal 50% (sotto basta il numero), oltre il 90%
 * il suggerimento di compattare. Sotto, quante volte è stato compattato e l'ultima volta prima → dopo.
 */
function SessionContext({ session }: { session: SessionState }) {
  const { used, window } = session.context;
  const pct = percent(used, window);
  const compacted = compactionText(session.compactions, session.lastCompaction);
  return (
    <div className="hud-context">
      <div className="hud-context__head">
        <span className="hud-muted">Contesto</span>
        <span>{`${formatTokens(used)} / ${window === null ? '?' : formatTokens(window)}`}</span>
        {pct !== null && <span className="hud-context__pct">{`${pct}%`}</span>}
      </div>
      {pct !== null && pct >= CONTEXT_BAR_FROM && <ProgressBar value={pct} label="Contesto usato" level={contextLevel(pct)} />}
      {pct !== null && contextLevel(pct) === 'danger' && <p className="hud-context__note hud-context__hint">{COMPACT_HINT}</p>}
      {compacted && <p className="hud-context__note hud-muted">{compacted.charAt(0).toUpperCase() + compacted.slice(1)}</p>}
    </div>
  );
}

/**
 * Scheda di un agente, a destra, aperta al clic sul personaggio o nell'elenco delle istanze: nome, descrizione,
 * tipo, stato (con tool in uso o da quanto è fermo), durata, modello, effort, avanzamento, issue, costo e token.
 * Per Claude stesso (`session`) anche progetto, branch, motivo del blocco, contesto, turno corrente e ultimo, e i
 * token suoi separati da quelli con i subagenti. Si chiude con il pulsante o con Esc; `onPopOut` la apre in una
 * finestra a sé (#92), dove la scheda non ha né l'uno né l'altro pulsante.
 */
export function AgentCard({ agent, session = null, onClose, onPopOut }: {
  agent: AgentState;
  /** sessione di cui l'agente è Claude stesso (il boss); null per i subagenti */
  session?: SessionState | null;
  onClose?: () => void;
  onPopOut?: () => void;
}) {
  const now = useNow();
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { progress } = agent;
  const pct = progress ? percent(progress.completed, progress.total) : null;
  const done = agent.status === 'done';
  // Claude stesso: stato, tool e attesa sono quelli della sessione; a fine turno non ha "terminato", è pronto
  const status = session ? statusText(session, now, SESSION_STATUS_LABEL) : statusText(agent, now, STATUS_LABEL);
  const name = agentName(agent);
  const task = agentTask(agent);
  const turnStartedAt = session && session.status !== 'done' ? session.turnStartedAt : null;
  return (
    <section className="hud-panel hud-card" aria-label={`Scheda di ${name}`}>
      <header className="hud-card__head">
        <span className="hud-card__names">
          <span className="hud-title" title={name}>{name}</span>
          {task && <span className="hud-card__task hud-muted">{task}</span>}
        </span>
        {onPopOut && <PopOutButton label="Apri la scheda in una finestra" onClick={onPopOut} />}
        {onClose && (
          <button type="button" className="hud-card__close" aria-label="Chiudi la scheda" title="Chiudi (Esc)" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      <div className="hud-card__chips">
        {/* Claude stesso non ha un ruolo: coordina */}
        {!session && <RoleChip area={agent.area} />}
        {agent.issues.length > 0 && <span className="hud-label__issue">{agent.issues.map((n) => `#${n}`).join(' ')}</span>}
      </div>
      {agent.description && agent.description !== agent.name && <p className="hud-card__desc">{agent.description}</p>}
      {/* Claude: la sessione bloccata (anche da un suo subagente); un subagente: il suo blocco */}
      {session?.waiting && <SessionAlert session={session} who={session.waitingAgentId ? 'Un subagente' : null} />}
      {!session && agent.waiting && !done && <SessionAlert session={agent} />}
      {session && (
        <dl>
          <Row label="Progetto">{projectName(session)}</Row>
          <Row label="Branch">{session.branch ?? DASH}</Row>
        </dl>
      )}
      {session?.diff && <DiffStat diff={session.diff} />}
      {session && <SessionContext session={session} />}
      <dl>
        {!session && <Row label="Tipo">{agent.agentType}</Row>}
        <Row label="Stato">{status}</Row>
        {session ? (
          <>
            {turnStartedAt && <Row label="Turno">{`in corso da ${formatDuration(now - turnStartedAt)}`}</Row>}
            {typeof session.lastTurnMs === 'number' && <Row label="Ultimo turno">{formatDuration(session.lastTurnMs)}</Row>}
          </>
        ) : (
          <Row label="Durata">{`${done ? 'in' : 'da'} ${formatDuration(elapsed(agent, now))}`}</Row>
        )}
        <Row label="Modello">{agent.model ?? DASH}</Row>
        <Row label="Effort">{(session ? session.effort : agent.effort) ?? DASH}</Row>
      </dl>
      {progress && pct !== null && (
        <div className="hud-context">
          <div className="hud-context__head">
            <span className="hud-muted">Avanzamento</span>
            <span className="hud-context__pct">{`${progress.completed}/${progress.total} · ${pct}%`}</span>
          </div>
          <ProgressBar value={pct} label={`Avanzamento ${name}`} />
        </div>
      )}
      {session ? (
        <>
          {/* solo Claude, poi con i subagenti: i due numeri non vanno sommati */}
          <TokenSummary title="Claude" tokens={session.ownTokens ?? agent.tokens} cost={session.ownCost ?? null} costTestId="agent-cost" />
          <TokenSummary title="Con i subagenti" tokens={session.tokensUsed} cost={session.cost ?? null} costTestId="session-cost" details={false} />
        </>
      ) : (
        <TokenSummary tokens={agent.tokens} cost={agent.cost ?? null} costTestId="agent-cost" />
      )}
    </section>
  );
}
