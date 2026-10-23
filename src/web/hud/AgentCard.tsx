import { useEffect } from 'react';
import type { AgentState, SessionState } from '../../shared/types';
import { useShow, useShown } from '../store';
import { contextLevel, elapsed, formatDuration, formatTokens, percent } from './format';
import {
  agentName, agentTask, CARD_LABEL, COMPACT_HINT, compactionText, projectName, SESSION_STATUS_LABEL, statusText, STATUS_LABEL, toolErrorsText,
} from './labels';
import { AgentAlertNote, CONTEXT_BAR_FROM, DiffStat, OutcomeTag, PopOutButton, RoleChip, Row, SessionAlert } from './panels';
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
  const shown = useShow('session.context');
  const { used, window } = session.context;
  const pct = percent(used, window);
  const compacted = compactionText(session.compactions, session.lastCompaction);
  if (!shown) return null;
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
 * finestra a sé (#92), dove la scheda non ha né l'uno né l'altro pulsante. Dal cruscotto (#97): l'avviso se è fermo
 * o in loop (con "Fallo uscire" se c'è `onDismiss`), l'esito di un terminato e gli errori dei tool. Le voci spente
 * nelle impostazioni (#94) non ci sono, righe e sezioni comprese.
 */
export function AgentCard({ agent, session = null, onClose, onPopOut, onDismiss }: {
  agent: AgentState;
  /** sessione di cui l'agente è Claude stesso (il boss); null per i subagenti */
  session?: SessionState | null;
  onClose?: () => void;
  onPopOut?: () => void;
  /** fa uscire un subagente fermo (nasconderlo finché non torna attivo) */
  onDismiss?: () => void;
}) {
  const now = useNow();
  const show = useShown();
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
  // voci delle impostazioni (#94): per Claude stesso quelle della sessione, per i subagenti quelle degli agenti
  const toolErrors = show(session ? 'session.toolErrors' : 'agent.toolErrors') ? (session ? session.toolErrors : agent.toolErrors) : null;
  const role = !session && show('agent.role');
  const issues = show(session ? 'session.issues' : 'agent.issues') && agent.issues.length > 0;
  const description = show(session ? 'session.title' : 'agent.description') && agent.description && agent.description !== agent.name;
  const turn = session !== null && show('session.turn');
  const tokens = show(session ? 'session.tokens' : 'agent.tokens');
  const cost = show(session ? 'session.cost' : 'agent.cost');
  return (
    <section className="hud-panel hud-card" aria-label={`Scheda di ${name}`}>
      <header className="hud-card__head">
        <span className="hud-card__names">
          <span className="hud-title" title={name}>{name}</span>
          {task && show('agent.task') && <span className="hud-card__task hud-muted">{task}</span>}
        </span>
        {onPopOut && <PopOutButton label="Apri la scheda in una finestra" onClick={onPopOut} />}
        {onClose && (
          <button type="button" className="hud-card__close" aria-label="Chiudi la scheda" title="Chiudi (Esc)" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      {/* senza ruolo né issue niente riga vuota; Claude stesso non ha un ruolo: coordina */}
      {(role || issues) && (
        <div className="hud-card__chips">
          {role && <RoleChip area={agent.area} />}
          {issues && <span className="hud-label__issue">{agent.issues.map((n) => `#${n}`).join(' ')}</span>}
        </div>
      )}
      {description && <p className="hud-card__desc">{agent.description}</p>}
      {/* Claude: la sessione bloccata (anche da un suo subagente); un subagente: il suo blocco */}
      {session?.waiting && <SessionAlert session={session} who={session.waitingAgentId ? 'Un subagente' : null} />}
      {!session && agent.waiting && !done && <SessionAlert session={agent} />}
      {!session && agent.alert && !done && show('agent.alerts') && <AgentAlertNote alert={agent.alert} onDismiss={onDismiss} />}
      {session && (
        <dl>
          <Row label="Progetto">{projectName(session)}</Row>
          {show('session.branch') && <Row label="Branch">{session.branch ?? DASH}</Row>}
        </dl>
      )}
      {session?.diff && <DiffStat diff={session.diff} />}
      {session && <SessionContext session={session} />}
      <dl>
        {!session && show('agent.type') && <Row label="Tipo">{agent.agentType}</Row>}
        <Row label="Stato">{status}</Row>
        {!session && done && agent.outcome && show('agent.outcome') && <Row label={CARD_LABEL.outcome}><OutcomeTag outcome={agent.outcome} /></Row>}
        {toolErrors && <Row label={CARD_LABEL.errors}>{toolErrorsText(toolErrors)}</Row>}
        {session ? (
          <>
            {turn && turnStartedAt && <Row label="Turno">{`in corso da ${formatDuration(now - turnStartedAt)}`}</Row>}
            {turn && typeof session.lastTurnMs === 'number' && <Row label="Ultimo turno">{formatDuration(session.lastTurnMs)}</Row>}
          </>
        ) : (
          show('agent.duration') && <Row label="Durata">{`${done ? 'in' : 'da'} ${formatDuration(elapsed(agent, now))}`}</Row>
        )}
        {show(session ? 'session.model' : 'agent.model') && <Row label="Modello">{agent.model ?? DASH}</Row>}
        {show(session ? 'session.effort' : 'agent.effort') && <Row label="Effort">{(session ? session.effort : agent.effort) ?? DASH}</Row>}
      </dl>
      {progress && pct !== null && show('agent.progress') && (
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
          <TokenSummary
            title="Claude" tokens={session.ownTokens ?? agent.tokens} cost={cost ? (session.ownCost ?? null) : undefined} costTestId="agent-cost" showTokens={tokens}
          />
          <TokenSummary
            title="Con i subagenti" tokens={session.tokensUsed} cost={cost ? (session.cost ?? null) : undefined} costTestId="session-cost" details={false}
            showTokens={tokens}
          />
        </>
      ) : (
        <TokenSummary tokens={agent.tokens} cost={cost ? (agent.cost ?? null) : undefined} costTestId="agent-cost" showTokens={tokens} />
      )}
    </section>
  );
}
