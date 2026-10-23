import { useState } from 'react';
import type { AgentState, SessionState } from '../../shared/types';
import { contextLevel, formatCost, formatTokens, percent } from './format';
import { agentName, agentTask, NO_INSTANCES, projectName, SESSION_STATUS_LABEL, STATUS_LABEL, toolText, waitingText } from './labels';
import { DiffStat, PopOutButton, RoleChip, SessionAlert, StatusDot } from './panels';
import { ProgressBar } from './ProgressBar';
import { useNow } from './useNow';
import './hud.css';

/** Una riga dell'elenco agenti: nome, ruolo, compito e stato (o tool in uso); il clic apre la scheda. */
function AgentRow({ agent, status, waiting = false, selected, onSelect }: {
  agent: AgentState;
  status: string;
  /** bloccato in attesa dell'utente: stato in rosso */
  waiting?: boolean;
  selected: boolean;
  onSelect: (agentId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`hud-instance__agent hud-instance__agent--${agent.status}${waiting ? ' hud-instance__agent--waiting' : ''}`}
        aria-pressed={selected}
        onClick={() => onSelect(agent.id)}
      >
        <span className="hud-instance__agent-head">
          <span className="hud-instance__agent-name" title={agentName(agent)}>{agentName(agent)}</span>
          {agent.agentType !== 'main' && <RoleChip area={agent.area} />}
        </span>
        {agentTask(agent) && <span className="hud-muted hud-instance__agent-task" title={agent.name}>{agent.name}</span>}
        <span className="hud-muted hud-instance__agent-status">{status}</span>
      </button>
    </li>
  );
}

/**
 * Corpo di un'istanza aperta: dati della sessione, Claude stesso e i suoi subagenti. Con `onPopOut` il pulsante
 * per aprirlo in una finestra a sé (#92); la finestra della scheda usa lo stesso corpo.
 */
export function InstanceBody({ session: s, boss, agents, selected, onSelect, onPopOut }: {
  session: SessionState;
  boss: AgentState | undefined;
  agents: AgentState[];
  selected: string | null;
  onSelect: (agentId: string) => void;
  onPopOut?: (sessionId: string) => void;
}) {
  const now = useNow();
  const pct = percent(s.context.used, s.context.window);
  // bloccata da un subagente: il motivo va sulla sua riga, Claude resta col suo stato
  const blocker = s.waitingAgentId ? agents.find((a) => a.id === s.waitingAgentId) : undefined;
  const bossStatus = s.waiting && !s.waitingAgentId
    ? waitingText(s.waitingKind, s.waitingSince, now)
    : [SESSION_STATUS_LABEL[s.status], s.tool ? toolText(s.tool) : null].filter(Boolean).join(' · ');
  return (
    <div className="hud-instance__body" id={`instance-${s.id}`}>
      {s.waiting && <SessionAlert session={s} who={s.waitingAgentId ? (blocker ? agentName(blocker) : 'Un subagente') : null} />}
      <div className="hud-instance__tools">
        <p className="hud-instance__meta hud-muted">
          {[s.model, s.effort, `${formatTokens(s.tokensUsed.output)} token generati`, s.cost !== null && s.cost !== undefined ? formatCost(s.cost) : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {onPopOut && <PopOutButton label={`Apri ${projectName(s)} in una finestra`} onClick={() => onPopOut(s.id)} />}
      </div>
      {pct !== null && (
        <div className="list-session__context">
          <span className="hud-muted">{`Contesto ${pct}%`}</span>
          <ProgressBar value={pct} label={`Contesto usato ${projectName(s)}`} level={contextLevel(pct)} className="hud-bar--small" />
        </div>
      )}
      {s.diff && <DiffStat diff={s.diff} />}
      <ul className="hud-instance__agents" aria-label={`Agenti di ${projectName(s)}`}>
        {boss && <AgentRow agent={boss} status={bossStatus} waiting={s.waiting && !s.waitingAgentId} selected={selected === boss.id} onSelect={onSelect} />}
        {agents.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            status={
              a.waiting
                ? waitingText(a.waitingKind, a.waitingSince, now)
                : [STATUS_LABEL[a.status], a.tool && a.status !== 'done' ? toolText(a.tool) : null].filter(Boolean).join(' · ')
            }
            waiting={a.waiting === true}
            selected={selected === a.id}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Pannello sinistro: un accordion per istanza (sessione attiva) con pallino di stato, progetto, branch e issue;
 * aperta mostra modello, contesto, token, diff e l'elenco dei suoi agenti (Claude stesso per primo).
 * Il clic su un agente apre la sua scheda. Aperta di default la sessione in evidenza o la più recente.
 */
export function InstancesPanel({ sessions, agents, bosses, focus = null, selected = null, onSelect, onPopOut }: {
  sessions: SessionState[];
  agents: AgentState[];
  /** Claude stesso di ogni sessione attiva (id `boss:<sessionId>`) */
  bosses: AgentState[];
  /** sessione da aprire (dal pannello della menu bar) */
  focus?: string | null;
  /** agente con la scheda aperta */
  selected?: string | null;
  onSelect: (agentId: string) => void;
  /** apre le informazioni dell'istanza in una finestra a sé */
  onPopOut?: (sessionId: string) => void;
}) {
  const active = sessions.filter((s) => s.active);
  // aperta/chiusa scelta dall'utente; senza scelta è aperta solo `first`
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [first, setFirst] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState<string | null>(null);
  // l'istanza aperta di default si sceglie una volta (alla prima sessione), così non salta a ogni snapshot
  const recent = active.reduce<SessionState | null>((best, s) => (!best || s.updatedAt > best.updatedAt ? s : best), null);
  if (first === null && active.length > 0) setFirst(focus && active.some((s) => s.id === focus) ? focus : recent!.id);
  // una nuova sessione in evidenza (dalla menu bar) si apre
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus) setOpen((o) => ({ ...o, [focus]: true }));
  }

  if (active.length === 0) {
    return (
      <section className="hud-panel hud-panel--empty" aria-label="Istanze">
        {NO_INSTANCES}
      </section>
    );
  }
  return (
    <section className="hud-panel hud-instances" aria-label="Istanze">
      {active.map((s) => {
        const own = agents.filter((a) => a.sessionId === s.id);
        const isOpen = open[s.id] ?? s.id === first;
        return (
          <div key={s.id} className={`hud-instance${isOpen ? ' hud-instance--open' : ''}`} data-session={s.id}>
            <button
              type="button"
              className="hud-instance__head"
              aria-expanded={isOpen}
              aria-controls={`instance-${s.id}`}
              onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))}
            >
              <StatusDot status={s.dot} />
              <span className="hud-instance__name">
                <span className="hud-title">{projectName(s)}</span>
                {s.branch && <span className="hud-session__branch hud-muted">{s.branch}</span>}
              </span>
              {s.issues.length > 0 && <span className="hud-label__issue">{s.issues.map((n) => `#${n}`).join(' ')}</span>}
              <span className="hud-instance__count hud-muted" title="Subagenti">{own.length}</span>
            </button>
            {isOpen && (
              <InstanceBody
                session={s}
                boss={bosses.find((b) => b.sessionId === s.id)}
                agents={own}
                selected={selected}
                onSelect={onSelect}
                onPopOut={onPopOut}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
