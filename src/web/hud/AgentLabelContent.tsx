import type { AgentState, AgentStatus } from '../../shared/types';
import { formatTokens, percent, truncate } from './format';
import { ProgressBar } from './ProgressBar';
import './hud.css';

export const NAME_MAX_CHARS = 24;

const STATUS_LABEL: Record<AgentStatus, string> = {
  entering: 'in arrivo',
  working: 'al lavoro',
  idle: 'inattivo',
  done: 'terminato',
};

/** Contenuto DOM puro dell'etichetta agente (testabile senza Canvas). */
export function AgentLabelContent({ agent }: { agent: AgentState }) {
  const { progress } = agent;
  const pct = progress ? percent(progress.completed, progress.total) : null;
  return (
    <div className={`hud-label hud-label--${agent.status}`}>
      <div className="hud-label__name" title={agent.name}>
        {truncate(agent.name, NAME_MAX_CHARS)}
      </div>
      <div className="hud-label__meta">
        <span className={`hud-chip hud-chip--${agent.area}`} data-area={agent.area}>
          {agent.area}
        </span>
        <span className="hud-label__tokens">{formatTokens(agent.tokens.total)}</span>
        <span className="hud-label__status">{STATUS_LABEL[agent.status]}</span>
      </div>
      <ProgressBar value={pct} label={`Avanzamento ${agent.name}`} className="hud-bar--small" />
      {progress && pct !== null && (
        <div className="hud-label__progress">{`${progress.completed}/${progress.total} · ${pct}%`}</div>
      )}
    </div>
  );
}
