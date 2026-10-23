import { useState } from 'react';
import type { AgentState, WaitingKind } from '../../shared/types';
import { elapsed, formatCost, formatDuration, percent, truncate } from './format';
import { ProgressBar } from './ProgressBar';
import { TokenBreakdown } from './TokenBreakdown';
import { STATUS_LABEL, toolText, waitingText } from './labels';
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
  /** dettaglio forzato (es. hover sul personaggio nella scena) */
  expanded?: boolean;
  /** notifica l'hover sull'etichetta stessa */
  onHoverChange?: (hovered: boolean) => void;
  /** la sessione è bloccata in attesa dell'utente (solo per Claudio Code) */
  waiting?: Waiting | null;
}

/**
 * Contenuto DOM puro dell'etichetta agente (testabile senza Canvas).
 * Compatta di default (nome, da quanto lavora, barra solo con una todo list); dettaglio (area, token, stato)
 * con `expanded` o hover. In rosso quando la sessione aspetta un input dell'utente.
 */
export function AgentLabelContent({ agent, expanded = false, onHoverChange, waiting = null }: AgentLabelContentProps) {
  const now = useNow();
  const [hovered, setHovered] = useState(false);
  const hover = (h: boolean) => {
    setHovered(h);
    onHoverChange?.(h);
  };
  const open = expanded || hovered;
  const { progress } = agent;
  const pct = progress ? percent(progress.completed, progress.total) : null;
  return (
    <div
      className={`hud-label hud-label--${agent.status}${waiting ? ' hud-label--waiting' : ''}${open ? ' hud-label--expanded' : ''}`}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
    >
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
      {open && (
        <>
          <div className="hud-label__meta">
            <span className={`hud-chip hud-chip--${agent.area}`} data-area={agent.area}>
              {agent.area}
            </span>
            <span className="hud-label__status">{STATUS_LABEL[agent.status]}</span>
          </div>
          <div className="hud-label__progress" data-testid="agent-cost">{`Costo ${formatCost(agent.cost)}`}</div>
          {progress && pct !== null && (
            <div className="hud-label__progress">{`${progress.completed}/${progress.total} · ${pct}%`}</div>
          )}
          <TokenBreakdown tokens={agent.tokens} />
        </>
      )}
    </div>
  );
}
