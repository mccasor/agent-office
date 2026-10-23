import { useState } from 'react';
import type { AgentState, SessionState } from '../../shared/types';
import { byUrgency, formatCost, formatTokens } from './format';
import {
  agentName, agentTask, alertShort, doneGroupLabel, NO_INSTANCES, projectName, SESSION_STATUS_LABEL, stateCounts, statusText, turnText,
} from './labels';
import { AlertMark, ContextGauge, DiffStat, PopOutButton, RoleChip, SessionAlert, StatusDot } from './panels';
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
          {agent.alert && agent.status !== 'done' && <AlertMark />}
          <span className="hud-instance__agent-name" title={agentName(agent)}>{agentName(agent)}</span>
          {agent.agentType !== 'main' && <RoleChip area={agent.area} />}
        </span>
        {agentTask(agent) && <span className="hud-muted hud-instance__agent-task" title={agent.name}>{agent.name}</span>}
        <span className="hud-muted hud-instance__agent-status" title={status}>{status}</span>
      </button>
    </li>
  );
}

/** Stato preceduto dall'avviso di un subagente in loop (#97): "Bash ripetuto 6 volte · al lavoro"; chi è fermo lo dice già lo stato. */
const withAlert = (a: AgentState, status: string, now: number): string =>
  a.alert?.kind === 'loop' && a.status !== 'done' ? `${alertShort(a.alert, now)} · ${status}` : status;

/** Riga meta della sessione: modello, effort, token generati e costo (sessione con i subagenti). */
export const sessionMeta = (s: SessionState): string =>
  [s.model, s.effort, `${formatTokens(s.tokensUsed.output)} token generati`, s.cost !== null && s.cost !== undefined ? formatCost(s.cost) : null]
    .filter(Boolean)
    .join(' · ');

/** Contatore per stato dei subagenti nella testata dell'istanza ("3 al lavoro · 12 terminati"), al posto del totale. */
export function StateCounts({ agents }: { agents: AgentState[] }) {
  const text = stateCounts(agents);
  return text ? <span className="hud-instance__count hud-muted" title="Subagenti">{text}</span> : null;
}

/**
 * Corpo di un'istanza aperta: dati della sessione, Claude stesso e i suoi subagenti dal più urgente (in attesa, al
 * lavoro, inattivi), i terminati in un gruppo richiudibile. Con la scheda di Claude aperta accanto, riga meta e contesto
 * restano solo lì. Con `onPopOut` il pulsante per aprirlo in una finestra a sé (#92); la finestra della scheda usa
 * lo stesso corpo.
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
  // bloccata da un subagente: il motivo va sulla sua riga, Claude resta col suo stato
  const blocker = s.waitingAgentId ? agents.find((a) => a.id === s.waitingAgentId) : undefined;
  const bossStatus = [statusText({ ...s, waiting: s.waiting && !s.waitingAgentId }, now, SESSION_STATUS_LABEL), turnText(s, now)]
    .filter(Boolean)
    .join(' · ');
  // la scheda di Claude aperta mostra già modello, costo e contesto
  const inCard = boss !== undefined && selected === boss.id;
  const sorted = byUrgency(agents);
  const live = sorted.filter((a) => a.status !== 'done');
  const done = sorted.filter((a) => a.status === 'done');
  const row = (a: AgentState) => (
    <AgentRow key={a.id} agent={a} status={withAlert(a, statusText(a, now), now)} waiting={a.waiting === true} selected={selected === a.id} onSelect={onSelect} />
  );
  return (
    <div className="hud-instance__body" id={`instance-${s.id}`}>
      {s.waiting && <SessionAlert session={s} who={s.waitingAgentId ? (blocker ? agentName(blocker) : 'Un subagente') : null} />}
      <div className="hud-instance__tools">
        {!inCard && <p className="hud-instance__meta hud-muted">{sessionMeta(s)}</p>}
        {!inCard && <ContextGauge session={s} slot="inline" />}
        {onPopOut && <PopOutButton label={`Apri ${projectName(s)} in una finestra`} onClick={() => onPopOut(s.id)} />}
      </div>
      {!inCard && <ContextGauge session={s} slot="block" />}
      {s.diff && <DiffStat diff={s.diff} />}
      <ul className="hud-instance__agents" aria-label={`Agenti di ${projectName(s)}`}>
        {boss && <AgentRow agent={boss} status={bossStatus} waiting={s.waiting && !s.waitingAgentId} selected={selected === boss.id} onSelect={onSelect} />}
        {live.map(row)}
        {done.length > 0 && (
          <li>
            <details className="hud-done-group">
              <summary>{doneGroupLabel(done.length)}</summary>
              <ul>{done.map(row)}</ul>
            </details>
          </li>
        )}
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
                {/* sotto il nome, per non stringere progetto e branch */}
                <StateCounts agents={own} />
              </span>
              {s.issues.length > 0 && <span className="hud-label__issue">{s.issues.map((n) => `#${n}`).join(' ')}</span>}
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
