import { useState } from 'react';
import type { AgentState, AgentStatus } from '../../shared/types';
import { elapsed, formatDuration, percent, truncate } from './format';
import { ProgressBar } from './ProgressBar';
import { TokenBreakdown } from './TokenBreakdown';
import { useNow } from './useNow';
import './hud.css';

export const NAME_MAX_CHARS = 24;

const STATUS_LABEL: Record<AgentStatus, string> = {
  entering: 'in arrivo',
  working: 'al lavoro',
  idle: 'inattivo',
  done: 'terminato',
};

interface AgentLabelContentProps {
  agent: AgentState;
  /** dettaglio forzato (es. hover sul personaggio nella scena) */
  expanded?: boolean;
  /** notifica l'hover sull'etichetta stessa */
  onHoverChange?: (hovered: boolean) => void;
  /** la sessione è bloccata in attesa dell'utente (solo per Claudio Code) */
  waiting?: boolean;
}

/**
 * Contenuto DOM puro dell'etichetta agente (testabile senza Canvas).
 * Compatta di default (nome, da quanto lavora, barra solo con una todo list); dettaglio (area, token, stato)
 * con `expanded` o hover. In rosso quando la sessione aspetta un input dell'utente.
 */
export function AgentLabelContent({ agent, expanded = false, onHoverChange, waiting = false }: AgentLabelContentProps) {
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
        {waiting ? 'aspetta un tuo input' : `${agent.status === 'done' ? 'in' : 'da'} ${formatDuration(elapsed(agent, now))}`}
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
          {progress && pct !== null && (
            <div className="hud-label__progress">{`${progress.completed}/${progress.total} · ${pct}%`}</div>
          )}
          <TokenBreakdown tokens={agent.tokens} />
        </>
      )}
    </div>
  );
}
