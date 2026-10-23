import type { AgentState, WaitingKind } from '../../shared/types';
import { elapsed, formatDuration, percent, truncate } from './format';
import { ProgressBar } from './ProgressBar';
import { toolText, waitingText } from './labels';
import { useNow } from './useNow';
import './hud.css';

export const NAME_MAX_CHARS = 24;

/** Blocco della sessione: motivo e da quando. */
export interface Waiting {
  kind: WaitingKind | null;
  since: number | null;
}

/** Riga sotto il nome: motivo del blocco, oppure tool in uso e da quanto lavora (o quanto ha lavorato). */
export function activityText(agent: AgentState, waiting: Waiting | null, now: number): string {
  if (waiting) return waitingText(waiting.kind, waiting.since, now);
  // Claudio Code a fine turno aspetta il prossimo prompt: non ha "terminato"
  if (agent.agentType === 'main' && agent.status === 'done') return 'pronto';
  const time = `${agent.status === 'done' ? 'in' : 'da'} ${formatDuration(elapsed(agent, now))}`;
  return agent.tool && agent.status !== 'done' ? `${toolText(agent.tool)} · ${time}` : time;
}

interface AgentLabelContentProps {
  agent: AgentState;
  /** la sessione è bloccata in attesa dell'utente (solo per Claudio Code) */
  waiting?: Waiting | null;
  /** la sua scheda è aperta */
  selected?: boolean;
  /** clic sull'etichetta: apre la scheda dell'agente */
  onSelect?: (agentId: string) => void;
}

/**
 * Contenuto DOM puro dell'etichetta agente (testabile senza Canvas), sempre compatto: nome, da quanto lavora,
 * barra solo con una todo list. Il dettaglio è nella scheda (AgentCard) che si apre al clic.
 * In rosso quando la sessione aspetta un input dell'utente.
 */
export function AgentLabelContent({ agent, waiting = null, selected = false, onSelect }: AgentLabelContentProps) {
  const now = useNow();
  const { progress } = agent;
  const pct = progress ? percent(progress.completed, progress.total) : null;
  const className = `hud-label hud-label--${agent.status}${waiting ? ' hud-label--waiting' : ''}${selected ? ' hud-label--selected' : ''}`;
  const content = (
    <>
      <div className="hud-label__name" title={agent.name}>
        {truncate(agent.name, NAME_MAX_CHARS)}
        {agent.issues.length > 0 && (
          <span className="hud-label__issue" data-testid="agent-issues">{agent.issues.map((n) => `#${n}`).join(' ')}</span>
        )}
      </div>
      <div className="hud-label__time" data-testid="agent-time">
        {activityText(agent, waiting, now)}
      </div>
      {pct !== null && <ProgressBar value={pct} label={`Avanzamento ${agent.name}`} className="hud-bar--small" />}
    </>
  );
  if (!onSelect) return <div className={className}>{content}</div>;
  // div e non <button>: dentro ci sono blocchi (la barra), non ammessi in un pulsante
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      aria-pressed={selected}
      onClick={(e) => {
        // nella scena 3D il clic non deve arrivare al canvas (lo leggerebbe come clic sul vuoto)
        e.stopPropagation();
        onSelect(agent.id);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect(agent.id);
      }}
    >
      {content}
    </div>
  );
}
