import { useEffect, useMemo, useState } from 'react';
import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { AgentCard } from './hud/AgentCard';
import { InstanceBody } from './hud/InstancesPanel';
import { projectName } from './hud/labels';
import { StatusDot } from './hud/panels';
import { openCardWindow, type CardKind } from './hud/popout';
import { BOSS_PREFIX, bossOf } from './pixel/boss';
import { connectSnapshotStream, useOfficeStore } from './store';

interface AgentView {
  agent: AgentState;
  /** sessione di cui l'agente è Claude stesso; null per i subagenti */
  session: SessionState | null;
}

interface SessionView {
  session: SessionState;
  boss: AgentState;
  agents: AgentState[];
}

/** Agente della scheda nello snapshot: in ufficio, già uscito (ultimo stato noto) o Claude di una sessione attiva. Pura. */
export function findAgent(snapshot: Snapshot, id: string): AgentView | null {
  if (id.startsWith(BOSS_PREFIX)) {
    const active = snapshot.sessions.filter((s) => s.active);
    const session = active.find((s) => s.id === id.slice(BOSS_PREFIX.length));
    return session ? { agent: bossOf(session, active.length > 1), session } : null;
  }
  const agent = snapshot.agents.find((a) => a.id === id) ?? snapshot.finished?.find((a) => a.id === id);
  return agent ? { agent, session: null } : null;
}

/** Istanza della scheda (solo se ancora aperta), con Claude stesso e i suoi subagenti. Pura. */
export function findSession(snapshot: Snapshot, id: string): SessionView | null {
  const session = snapshot.sessions.find((s) => s.id === id && s.active);
  if (!session) return null;
  return { session, boss: bossOf(session, false), agents: snapshot.agents.filter((a) => a.sessionId === id) };
}

/** Ultimo valore trovato (`current` memoizzato sullo snapshot): quando l'agente o l'istanza spariscono la scheda resta sull'ultimo stato noto. */
function useLastKnown<T>(current: T | null): T | null {
  const [last, setLast] = useState<T | null>(current);
  if (current && current !== last) setLast(current);
  return current ?? last;
}

function Note({ children }: { children: string }) {
  return <p className="card-window__note" role="status">{children}</p>;
}

function AgentWindow({ snapshot, id }: { snapshot: Snapshot; id: string }) {
  const current = useMemo(() => findAgent(snapshot, id), [snapshot, id]);
  const shown = useLastKnown(current);
  const name = shown ? (shown.agent.nickname ?? shown.agent.name) : null;
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  if (!shown) return <Note>Agente non trovato: forse è già uscito dall'ufficio.</Note>;
  if (current) return <AgentCard agent={current.agent} session={current.session} />;
  // sparito dallo snapshot: ultimo stato noto, senza tool in uso né attese
  const isBoss = shown.session !== null;
  const agent: AgentState = { ...shown.agent, status: isBoss ? shown.agent.status : 'done', tool: undefined, waiting: false };
  const session = shown.session && { ...shown.session, waiting: false, tool: undefined };
  return (
    <>
      <Note>{isBoss ? 'Istanza chiusa: ultimo stato noto.' : 'Uscito dall\'ufficio: ultimo stato noto.'}</Note>
      <AgentCard agent={agent} session={session} />
    </>
  );
}

function SessionWindow({ snapshot, id }: { snapshot: Snapshot; id: string }) {
  const current = useMemo(() => findSession(snapshot, id), [snapshot, id]);
  const shown = useLastKnown(current);
  const name = shown ? projectName(shown.session) : null;
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  if (!shown) return <Note>Istanza non trovata: forse è già stata chiusa.</Note>;
  const { session: s, boss, agents } = shown;
  return (
    <>
      {!current && <Note>Istanza chiusa: ultimo stato noto.</Note>}
      <section className="hud-panel hud-instance hud-instance--open card-window__instance" aria-label={`Istanza ${projectName(s)}`}>
        <header className="hud-instance__head card-window__head">
          <StatusDot status={current ? s.dot : 'idle'} />
          <span className="hud-instance__name">
            <span className="hud-title">{projectName(s)}</span>
            {s.branch && <span className="hud-session__branch hud-muted">{s.branch}</span>}
          </span>
          {s.issues.length > 0 && <span className="hud-label__issue">{s.issues.map((n) => `#${n}`).join(' ')}</span>}
        </header>
        <InstanceBody
          session={current ? s : { ...s, waiting: false }}
          boss={boss}
          agents={agents}
          selected={null}
          // il clic su un agente apre la sua scheda in un'altra finestra
          onSelect={(agentId) => openCardWindow('agent', agentId)}
        />
      </section>
    </>
  );
}

/**
 * Finestra di una scheda staccata (#92, `/?card=agent|session&id=...`): solo la scheda, a tutta finestra, con la sua
 * connessione allo stream; niente ufficio né pannelli. Se l'agente o l'istanza spariscono resta l'ultimo stato noto.
 */
export function CardWindow({ kind, id }: { kind: CardKind; id: string }) {
  const snapshot = useOfficeStore((s) => s.snapshot);
  const connected = useOfficeStore((s) => s.connected);
  useEffect(() => connectSnapshotStream(), []);
  return (
    <main className="card-window">
      {!snapshot ? (
        <Note>Connessione all'ufficio…</Note>
      ) : kind === 'agent' ? (
        <AgentWindow snapshot={snapshot} id={id} />
      ) : (
        <SessionWindow snapshot={snapshot} id={id} />
      )}
      {snapshot && !connected && <p className="card-window__offline">Disconnesso: riconnessione…</p>}
    </main>
  );
}
