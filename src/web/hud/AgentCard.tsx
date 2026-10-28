import { type ReactNode, useEffect, useMemo } from 'react';
import type { AgentState, SessionState } from '../../shared/types';
import { t } from '../../shared/i18n';
import { useShown } from '../store';
import { elapsed, formatDuration, percent } from './format';
import {
  agentName, agentTask, projectName, SESSION_STATUS_LABEL, statusText, STATUS_LABEL, toolErrorsText,
} from './labels';
import { AgentAlertNote, ContextMeter, GitSection, OutcomeTag, PopOutButton, RoleChip, Row, SessionAlert } from './panels';
import { InstanceTabs, type GitAuthorFilter } from './GitTab';
import { ProgressBar } from './ProgressBar';
import { StatusCheck } from './StatusCheck';
import { TokenSummary } from './TokenBreakdown';
import { useNow } from './useNow';
import './hud.css';

const DASH = '—';

/**
 * Scheda di un agente, a destra, aperta al clic sul personaggio o nell'elenco delle istanze: nome, descrizione,
 * tipo, stato (con tool in uso o da quanto è fermo), durata, modello, effort, avanzamento, issue, costo e token.
 * Per Claude stesso (`session`) anche progetto, branch, motivo del blocco, contesto, turno corrente e ultimo, e i
 * token suoi separati da quelli con i subagenti. Si chiude con il pulsante o con Esc; `onPopOut` la apre in una
 * finestra a sé (#92), dove la scheda non ha né l'uno né l'altro pulsante. Dal cruscotto (#97): l'avviso se è fermo
 * o in loop, l'esito di un terminato e gli errori dei tool. Per un subagente non terminato "Controlla stato" (#104),
 * con "Segna come terminato" se c'è `onMarkDone` e il verdetto lo propone. Le voci spente nelle impostazioni (#94)
 * non ci sono, righe e sezioni comprese. Per Claude stesso tutto questo sta nella scheda "Istanza", accanto alla scheda
 * "Git" con i commit del giorno (#109).
 */
export function AgentCard({ agent, session = null, onClose, onPopOut, onMarkDone }: {
  agent: AgentState;
  /** sessione di cui l'agente è Claude stesso (il boss); null per i subagenti */
  session?: SessionState | null;
  onClose?: () => void;
  onPopOut?: () => void;
  /** segna il subagente come terminato (lo nasconde finché non torna attivo), dopo il verdetto di "Controlla stato" */
  onMarkDone?: () => void;
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
  // le issue di Claude stesso sono quelle del branch: stanno nella sezione Git
  const issues = !session && show('agent.issues') && agent.issues.length > 0;
  const description = show(session ? 'session.title' : 'agent.description') && agent.description && agent.description !== agent.name;
  const turn = session !== null && show('session.turn');
  const tokens = show(session ? 'session.tokens' : 'agent.tokens');
  const cost = show(session ? 'session.cost' : 'agent.cost');
  // Claude stesso (#109): il contenuto di sempre nella scheda "Istanza", accanto alla scheda "Git"
  // scheda di un personaggio: nella scheda Git solo i suoi commit (Claude stesso della sua sessione, o il subagente)
  const sessionId = session?.id ?? null;
  const author = useMemo<GitAuthorFilter>(
    () => (sessionId ? { kind: 'claude', sessionId } : { kind: 'agent', agentId: agent.id }),
    [sessionId, agent.id],
  );
  const tabs = (content: ReactNode) => <InstanceTabs sessionId={agent.sessionId} author={author}>{content}</InstanceTabs>;
  return (
    <section className="hud-panel hud-card" aria-label={t('card.aria', { name })}>
      <header className="hud-card__head">
        <span className="hud-card__names">
          <span className="hud-title" title={name}>{name}</span>
          {task && show('agent.task') && <span className="hud-card__task hud-muted">{task}</span>}
        </span>
        {onPopOut && <PopOutButton label={t('popout.card')} onClick={onPopOut} />}
        {onClose && (
          <button type="button" className="hud-card__close" aria-label={t('card.close')} title={t('card.closeHint')} onClick={onClose}>
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
      {tabs(<>
        {description && <p className="hud-card__desc">{agent.description}</p>}
        {/* Claude: la sessione bloccata (anche da un suo subagente); un subagente: il suo blocco */}
        {session?.waiting && <SessionAlert session={session} who={session.waitingAgentId ? t('card.someSubagent') : null} />}
        {!session && agent.waiting && !done && <SessionAlert session={agent} />}
        {!session && agent.alert && !done && show('agent.alerts') && <AgentAlertNote alert={agent.alert} />}
        {!session && <StatusCheck agentId={agent.id} done={done} onMarkDone={onMarkDone} />}
        {session && (
          <dl>
            <Row label={t('card.project')}>{projectName(session)}</Row>
          </dl>
        )}
        {session && <ContextMeter session={session} compactions />}
        {session && <GitSection session={session} />}
        <dl>
          {!session && show('agent.type') && <Row label={t('card.type')}>{agent.agentType}</Row>}
          <Row label={t('card.status')}>{status}</Row>
          {!session && done && agent.outcome && show('agent.outcome') && <Row label={t('card.outcome')}><OutcomeTag outcome={agent.outcome} /></Row>}
          {toolErrors && <Row label={t('card.errors')}>{toolErrorsText(toolErrors)}</Row>}
          {session ? (
            <>
              {turn && turnStartedAt && <Row label={t('card.turn')}>{t('card.turnRunning', { d: formatDuration(now - turnStartedAt) })}</Row>}
              {turn && typeof session.lastTurnMs === 'number' && <Row label={t('card.lastTurn')}>{formatDuration(session.lastTurnMs)}</Row>}
            </>
          ) : (
            show('agent.duration') && <Row label={t('card.duration')}>{t(done ? 'dur.in' : 'dur.for', { d: formatDuration(elapsed(agent, now)) })}</Row>
          )}
          {show(session ? 'session.model' : 'agent.model') && <Row label={t('card.model')}>{agent.model ?? DASH}</Row>}
          {show(session ? 'session.effort' : 'agent.effort') && <Row label={t('card.effort')}>{(session ? session.effort : agent.effort) ?? DASH}</Row>}
        </dl>
        {progress && pct !== null && show('agent.progress') && (
          <div className="hud-context">
            <div className="hud-context__head">
              <span className="hud-muted">{t('card.progress')}</span>
              <span className="hud-context__pct">{`${progress.completed}/${progress.total} · ${pct}%`}</span>
            </div>
            <ProgressBar value={pct} label={t('card.progressOf', { name })} />
          </div>
        )}
        {session ? (
          <>
            {/* solo Claude, poi con i subagenti: i due numeri non vanno sommati */}
            <TokenSummary
              title="Claude" tokens={session.ownTokens ?? agent.tokens} cost={cost ? (session.ownCost ?? null) : undefined} costTestId="agent-cost" showTokens={tokens}
            />
            <TokenSummary
              title={t('card.withSubagents')} tokens={session.tokensUsed} cost={cost ? (session.cost ?? null) : undefined} costTestId="session-cost" details={false}
              showTokens={tokens}
            />
          </>
        ) : (
          <TokenSummary tokens={agent.tokens} cost={cost ? (agent.cost ?? null) : undefined} costTestId="agent-cost" showTokens={tokens} />
        )}
      </>)}
    </section>
  );
}
