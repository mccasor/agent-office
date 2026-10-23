import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { AgentCard } from './hud/AgentCard';
import { appTitle, followHeight, inApp, MAX_SCREEN_FRACTION } from './hud/fit';
import { InstanceBody, StateCounts } from './hud/InstancesPanel';
import { projectName } from './hud/labels';
import { StatusDot } from './hud/panels';
import { openCardWindow, type CardKind } from './hud/popout';
import { BOSS_PREFIX, bossOf } from './pixel/boss';
import { t } from '../shared/i18n';
import { connectSnapshotStream, useLocale, useOfficeStore, useShown } from './store';

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

interface WindowProps {
  snapshot: Snapshot;
  id: string;
  /** nome da dare alla finestra (agente o progetto) */
  onName: (name: string) => void;
}

function AgentWindow({ snapshot, id, onName }: WindowProps) {
  const current = useMemo(() => findAgent(snapshot, id), [snapshot, id]);
  const shown = useLastKnown(current);
  const name = shown ? (shown.agent.nickname ?? shown.agent.name) : null;
  useEffect(() => {
    if (name) onName(name);
  }, [name, onName]);
  if (!shown) return <Note>{t('cardWindow.agentMissing')}</Note>;
  if (current) return <AgentCard agent={current.agent} session={current.session} />;
  // sparito dallo snapshot: ultimo stato noto, senza tool in uso né attese
  const isBoss = shown.session !== null;
  const agent: AgentState = { ...shown.agent, status: isBoss ? shown.agent.status : 'done', tool: undefined, waiting: false };
  const session = shown.session && { ...shown.session, waiting: false, tool: undefined };
  return (
    <>
      <Note>{t(isBoss ? 'cardWindow.sessionClosed' : 'cardWindow.agentLeft')}</Note>
      <AgentCard agent={agent} session={session} />
    </>
  );
}

function SessionWindow({ snapshot, id, onName }: WindowProps) {
  const current = useMemo(() => findSession(snapshot, id), [snapshot, id]);
  const shown = useLastKnown(current);
  const show = useShown();
  const name = shown ? projectName(shown.session) : null;
  useEffect(() => {
    if (name) onName(name);
  }, [name, onName]);
  if (!shown) return <Note>{t('cardWindow.sessionMissing')}</Note>;
  const { session: s, boss, agents } = shown;
  return (
    <>
      {!current && <Note>{t('cardWindow.sessionClosed')}</Note>}
      <section className="hud-panel hud-instance hud-instance--open card-window__instance" aria-label={t('instance.aria', { project: projectName(s) })}>
        <header className="hud-instance__head card-window__head">
          <StatusDot status={current ? s.dot : 'idle'} />
          <span className="hud-instance__name">
            <span className="hud-title">{projectName(s)}</span>
            {s.branch && show('session.branch') && <span className="hud-session__branch hud-muted">{s.branch}</span>}
          </span>
          {s.issues.length > 0 && show('session.issues') && <span className="hud-label__issue">{s.issues.map((n) => `#${n}`).join(' ')}</span>}
          <StateCounts agents={agents} />
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

/** Altezza massima del contenuto: l'85% dello schermo meno la cornice della finestra (barra del titolo). */
function readWindow(): { max: number; current: number } {
  const frame = Math.max(0, window.outerHeight - window.innerHeight);
  // schermo sconosciuto (0, come in jsdom): nessun limite qui, lo mette comunque l'app o il browser
  const screen = window.screen.availHeight;
  return { max: screen > 0 ? screen * MAX_SCREEN_FRACTION - frame : Infinity, current: window.innerHeight };
}

/**
 * Finestra a misura del contenuto (fit.ts) e titolo = `name`. Nel browser il popup si ridimensiona da sé; nell'app
 * l'altezza va nel titolo della pagina, che l'app legge (e toglie dal titolo della finestra).
 */
function useFitWindow(ref: RefObject<HTMLElement | null>, name: string): void {
  const app = useMemo(() => inApp(location.search), []);
  const [fit, setFit] = useState<{ height: number; seq: number } | null>(null);
  useEffect(() => {
    document.documentElement.classList.add('card-window-root');
    const el = ref.current;
    if (!el) return;
    const stop = followHeight(el, readWindow, (height) => {
      if (app) setFit((f) => ({ height, seq: (f?.seq ?? 0) + 1 }));
      else window.resizeBy(0, height - window.innerHeight);
    });
    return () => {
      stop();
      document.documentElement.classList.remove('card-window-root');
    };
  }, [ref, app]);
  useEffect(() => {
    document.title = fit ? appTitle(name, fit.height, fit.seq) : name;
  }, [name, fit]);
}

/**
 * Finestra di una scheda staccata (#92, `/?card=agent|session&id=...`): solo la scheda, a misura del contenuto, con
 * la sua connessione allo stream; niente ufficio né pannelli. Se l'agente o l'istanza spariscono resta l'ultimo stato noto.
 */
export function CardWindow({ kind, id }: { kind: CardKind; id: string }) {
  const snapshot = useOfficeStore((s) => s.snapshot);
  const connected = useOfficeStore((s) => s.connected);
  const ref = useRef<HTMLElement>(null);
  const [name, setName] = useState('Agent Office');
  // lingua (#93): cambiandola si ridisegna la scheda
  useLocale();
  useFitWindow(ref, name);
  useEffect(() => connectSnapshotStream(), []);
  return (
    <main className="card-window" ref={ref}>
      {!snapshot ? (
        <Note>{t('cardWindow.connecting')}</Note>
      ) : kind === 'agent' ? (
        <AgentWindow snapshot={snapshot} id={id} onName={setName} />
      ) : (
        <SessionWindow snapshot={snapshot} id={id} onName={setName} />
      )}
      {snapshot && !connected && <p className="card-window__offline">{t('app.offline')}</p>}
    </main>
  );
}
