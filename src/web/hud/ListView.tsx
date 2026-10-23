import { memo, useEffect, useMemo, useState } from 'react';
import type { AgentState, DayStats, FinishedAgent, SessionState } from '../../shared/types';
import { t, type TextKey } from '../../shared/i18n';
import { useShown, type OfficeView } from '../store';
import { byUrgency, elapsed, formatCost, formatDuration, formatTokens, percent } from './format';
import { sessionMeta, StateCounts } from './InstancesPanel';
import {
  agentName, agentTask, alertShort, doneGroupLabel, projectName, SESSION_STATUS_LABEL, statusText, toolErrorsShort, toolErrorsText, turnText,
} from './labels';
import { finishedAsAgent } from './HistoryView';
import { AlertMark, ContextGauge, DiffStat, DismissedNote, OutcomeTag, RoleChip, StatusDot } from './panels';
import { ProgressBar } from './ProgressBar';
import { TodayBar } from './TodayBar';
import { useNow } from './useNow';
import './hud.css';

const issueText = (issues: number[]): string => issues.map((n) => `#${n}`).join(' ');

interface ListFilter {
  query: string;
  waitingOnly: boolean;
  hideDone: boolean;
}

const FILTER_KEY = 'agent-office:list-filter';
const NO_FILTER: ListFilter = { query: '', waitingOnly: false, hideDone: false };

/** Filtro della lista ricordato nel browser (comodità per chi guarda; può mancare in finestre private). */
function loadFilter(): ListFilter {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null');
    return typeof saved === 'object' && saved !== null ? { ...NO_FILTER, ...(saved as Partial<ListFilter>) } : NO_FILTER;
  } catch {
    return NO_FILTER;
  }
}

function saveFilter(filter: ListFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // storage non disponibile: il filtro vale solo per questa pagina
  }
}

/** Nome di persona in grassetto e compito accanto, in grigio. */
function AgentName({ agent }: { agent: AgentState }) {
  const task = useShown()('agent.task') ? agentTask(agent) : null;
  return (
    <>
      <strong>{agentName(agent)}</strong>
      {task && <span className="list-agent__task">{task}</span>}
    </>
  );
}

/** La sessione corrisponde alla ricerca: progetto, branch, titolo o nome di un suo agente (senza maiuscole). */
function matches(query: string, s: SessionState, agents: AgentState[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [projectName(s), s.branch ?? '', s.title ?? '', ...agents.flatMap((a) => [a.name, a.nickname ?? ''])].some((text) => text.toLowerCase().includes(q));
}

/**
 * Props uguali per React.memo: confronto per identità, e gli array (agenti di una sessione, ricavati a ogni
 * rendering) elemento per elemento. Grazie alla condivisione strutturale dello store (share) gli agenti invariati
 * tra due snapshot sono gli stessi oggetti.
 */
export function sameProps<P extends object>(a: P, b: P): boolean {
  const keys = Object.keys(a) as (keyof P)[];
  return keys.length === Object.keys(b).length && keys.every((k) => {
    const x = a[k];
    const y = b[k];
    if (Object.is(x, y)) return true;
    return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
  });
}

/** raggruppa per sessione (ordine originale dentro ogni gruppo) */
function bySession(agents: readonly AgentState[]): Map<string, AgentState[]> {
  const groups = new Map<string, AgentState[]>();
  for (const a of agents) {
    const list = groups.get(a.sessionId);
    if (list) list.push(a);
    else groups.set(a.sessionId, [a]);
  }
  return groups;
}

const NONE: AgentState[] = [];

/** Errori dei tool in breve ("2 errori"), con il dettaglio nel tooltip; mai il testo dell'errore. `lead`: dopo altro testo, con " · ". */
function ToolErrorsNote({ agent, lead }: { agent: AgentState; lead: boolean }) {
  const shown = useShown()('agent.toolErrors');
  if (!agent.toolErrors || !shown) return null;
  const text = toolErrorsShort(agent.toolErrors);
  return <span className="list-agent__errors" title={toolErrorsText(agent.toolErrors)}>{lead ? ` · ${text}` : text}</span>;
}

/** Chip del ruolo, o un segnaposto se è spenta: la riga è una griglia a colonne fisse. */
function RoleCell({ area, shown }: { area: AgentState['area']; shown: boolean }) {
  return shown ? <RoleChip area={area} /> : <span />;
}

/** Agenti della sessione (o delle istanze chiuse, `title`) terminati oggi: nome, esito, durata, costo ed errori. Chiusa di default. */
const FinishedToday = memo(function FinishedToday({ agents, title = 'finished.today' }: { agents: AgentState[]; title?: TextKey }) {
  const show = useShown();
  if (agents.length === 0) return null;
  return (
    <details className="list-finished">
      <summary>{`${t(title)} (${agents.length})`}</summary>
      <ul className="list-agents">
        {agents.map((a) => {
          const text = [
            show('agent.duration') && t('dur.in', { d: formatDuration(a.updatedAt - a.startedAt) }),
            show('agent.tokens') && t('tokens.count', { n: formatTokens(a.tokens.output) }),
            show('agent.cost') && a.cost !== null && a.cost !== undefined ? formatCost(a.cost) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={a.id} className="list-agent list-agent--done">
              <span className="list-agent__name" title={a.name}><AgentName agent={a} /></span>
              <RoleCell area={a.area} shown={show('agent.role')} />
              <span className="list-agent__status hud-muted">
                {text}
                <ToolErrorsNote agent={a} lead={text !== ''} />
              </span>
              {a.outcome && show('agent.outcome') ? <OutcomeTag outcome={a.outcome} /> : <span />}
            </li>
          );
        })}
      </ul>
    </details>
  );
}, sameProps);

/**
 * Riga di un subagente: nome, issue, ruolo, stato (o attesa, tool, da quanto è fermo), durata e avanzamento; per un
 * terminato esito e costo; l'avviso se è fermo o in loop ("!" giallo, con "Fallo uscire" se è fermo); gli errori.
 * Con `onDismiss` "Fallo uscire" anche per un terminato ancora in area relax (#101), che altrimenti aspetta gli altri.
 */
const AgentLine = memo(function AgentLine({ agent: a, now, onDismiss }: { agent: AgentState; now: number; onDismiss?: (id: string) => void }) {
  const show = useShown();
  const pct = a.progress && show('agent.progress') ? percent(a.progress.completed, a.progress.total) : null;
  const done = a.status === 'done';
  const alert = !done && a.alert && show('agent.alerts') ? alertShort(a.alert, now) : null;
  // chi è fermo lo dice già lo stato ("fermo da 1 h 12")
  const text = [
    a.alert?.kind === 'loop' && alert,
    statusText(a, now),
    show('agent.duration') && t(done ? 'dur.in' : 'dur.for', { d: formatDuration(elapsed(a, now)) }),
    show('agent.cost') && done && a.cost !== null && a.cost !== undefined ? formatCost(a.cost) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  let last = pct === null ? <span /> : <ProgressBar value={pct} label={t('card.progressOf', { name: agentName(a) })} className="hud-bar--small" />;
  if (done && a.outcome && show('agent.outcome')) last = <OutcomeTag outcome={a.outcome} />;
  if (done && onDismiss) {
    last = (
      <span className="list-agent__end">
        {a.outcome && show('agent.outcome') && <OutcomeTag outcome={a.outcome} />}
        <button type="button" className="hud-alert__dismiss" title={t('alert.dismissDoneHint')} onClick={() => onDismiss(a.id)}>{t('alert.dismiss')}</button>
      </span>
    );
  } else if (alert && a.alert?.kind === 'stale' && onDismiss) {
    last = <button type="button" className="hud-alert__dismiss" title={t('alert.dismissHint')} onClick={() => onDismiss(a.id)}>{t('alert.dismiss')}</button>;
  }
  return (
    <li className={`list-agent list-agent--${a.status}${a.waiting ? ' list-agent--waiting' : ''}${alert ? ' list-agent--alert' : ''}`}>
      <span className="list-agent__name" title={a.name}>
        {alert && <AlertMark title={alert} />}
        <AgentName agent={a} />
        {a.issues.length > 0 && show('agent.issues') && <span className="hud-label__issue">{issueText(a.issues)}</span>}
      </span>
      <RoleCell area={a.area} shown={show('agent.role')} />
      <span className="list-agent__status hud-muted">
        {text}
        <ToolErrorsNote agent={a} lead />
      </span>
      {last}
    </li>
  );
});

/**
 * Scheda di un'istanza nella lista: si ridisegna solo se cambiano la sessione, i suoi agenti, il filtro dei
 * terminati, la casella, l'evidenza o l'ora corrente (useNow, ogni 15 s, per gli orari relativi).
 */
const SessionCard = memo(function SessionCard({ session: s, agents: all, finished, dismissed, hideDone, shown, focused, now, onToggle, onDismiss, onRestore }: {
  session: SessionState;
  agents: AgentState[];
  finished: AgentState[];
  /** subagenti della sessione fatti uscire a mano (#101) */
  dismissed: AgentState[];
  hideDone: boolean;
  shown: boolean;
  focused: boolean;
  now: number;
  onToggle: (sessionId: string) => void;
  onDismiss?: (agentId: string) => void;
  onRestore?: (agentIds: string[]) => void;
}) {
  const show = useShown();
  const own = hideDone || !show('instances.done') ? all.filter((a) => a.status !== 'done') : all;
  // dal più urgente; i terminati ancora in ufficio in un gruppo richiudibile
  const sorted = byUrgency(own);
  const live = sorted.filter((a) => a.status !== 'done');
  const done = sorted.filter((a) => a.status === 'done');
  return (
    <section
      key={s.id}
      className={`list-session${focused ? ' list-session--focus' : ''}`}
      aria-label={projectName(s)}
      data-session={s.id}
    >
      <header className="list-session__head">
        <StatusDot status={s.dot} />
        <div className="list-session__name">
          <strong>{projectName(s)}</strong>
          {s.branch && show('session.branch') && <span className="hud-muted">{s.branch}</span>}
          {s.issues.length > 0 && show('session.issues') && <span className="hud-label__issue">{issueText(s.issues)}</span>}
        </div>
        <StateCounts agents={all} />
        <label className="list-session__show">
          <input type="checkbox" checked={shown} onChange={() => onToggle(s.id)} />
          {t('list.inOffice')}
        </label>
      </header>
      {s.title && show('session.title') && <p className="list-session__title">{s.title}</p>}
      {s.diff && <DiffStat diff={s.diff} />}
      <div className="list-session__metarow">
        <p className="list-session__meta hud-muted">
          {[
            sessionMeta(s, show),
            // il turno corrente (dall'ultimo prompt) o l'ultimo chiuso, non l'età della sessione
            show('session.turn') && turnText(s, now),
            statusText(s, now, SESSION_STATUS_LABEL),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <ContextGauge session={s} slot="inline" />
      </div>
      <ContextGauge session={s} slot="block" />
      {live.length > 0 && <ul className="list-agents">{live.map((a) => <AgentLine key={a.id} agent={a} now={now} onDismiss={onDismiss} />)}</ul>}
      {done.length > 0 && (
        <details className="list-finished">
          <summary>{doneGroupLabel(done.length)}</summary>
          <ul className="list-agents">{done.map((a) => <AgentLine key={a.id} agent={a} now={now} onDismiss={onDismiss} />)}</ul>
        </details>
      )}
      {onRestore && <DismissedNote agents={dismissed} onRestore={onRestore} />}
      {show('list.finishedToday') && <FinishedToday agents={finished} />}
    </section>
  );
}, sameProps);

// "Ufficio" e non "2D": c'è una sola vista dell'ufficio, e il nome è lo stesso di "Apri ufficio" (menu bar) e "Nell'ufficio"
const VIEW_LABEL: [OfficeView, TextKey, TextKey][] = [
  ['pixel', 'view.pixel', 'view.pixelHint'],
  ['list', 'view.list', 'view.listHint'],
  ['history', 'view.history', 'view.historyHint'],
];

/** Selettore in alto a destra: ufficio, lista delle istanze o analisi della giornata. */
export function ViewToggle({ view, onChange }: { view: OfficeView; onChange: (view: OfficeView) => void }) {
  return (
    <div className="hud-toggle" role="group" aria-label={t('view.aria')}>
      {VIEW_LABEL.map(([value, label, title]) => (
        <button key={value} type="button" title={t(title)} aria-pressed={view === value} onClick={() => onChange(value)}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}

/**
 * Vista lista: una scheda per istanza (pallino di stato, progetto, branch, issue, modello, token) con i suoi agenti;
 * la casella "Nell'ufficio" sceglie quali sessioni mostrare nell'ufficio.
 */
export function ListView({ sessions, agents, finished = [], closedFinished, dismissed = NONE, hidden, onToggle, focus = null, today, onDismiss, onRestore }: {
  sessions: SessionState[];
  agents: AgentState[];
  /** terminati oggi e già usciti dall'ufficio */
  finished?: AgentState[];
  /** terminati oggi delle istanze già chiuse (dallo storico del server) */
  closedFinished?: FinishedAgent[];
  /** subagenti fatti uscire a mano (#101), tolti da `agents` */
  dismissed?: AgentState[];
  hidden: readonly string[];
  onToggle: (sessionId: string) => void;
  /** sessione da evidenziare e portare in vista */
  focus?: string | null;
  /** cruscotto della giornata (#97); assente con un server vecchio */
  today?: DayStats;
  /** fa uscire un subagente fermo, o un terminato ancora in area relax */
  onDismiss?: (agentId: string) => void;
  /** fa rientrare i subagenti fatti uscire (#101) */
  onRestore?: (agentIds: string[]) => void;
}) {
  const now = useNow();
  const show = useShown();
  const [filter, setFilter] = useState(loadFilter);
  // sessione aperta dal pannello della menu bar: portata in vista una volta, quando cambia
  useEffect(() => {
    if (!focus) return;
    const el = [...document.querySelectorAll<HTMLElement>('[data-session]')].find((e) => e.dataset.session === focus);
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);
  const update = (next: Partial<ListFilter>) => {
    const value = { ...filter, ...next };
    setFilter(value);
    saveFilter(value);
  };
  const active = useMemo(() => sessions.filter((s) => s.active), [sessions]);
  const agentsBy = useMemo(() => bySession(agents), [agents]);
  const finishedBy = useMemo(() => bySession(finished), [finished]);
  const dismissedBy = useMemo(() => bySession(dismissed), [dismissed]);
  const closed = useMemo(() => closedFinished?.map(finishedAsAgent) ?? NONE, [closedFinished]);
  const shown = useMemo(
    () => active
      .map((s) => ({ s, all: agentsBy.get(s.id) ?? NONE }))
      .filter(({ s, all }) => (!filter.waitingOnly || s.dot === 'waiting') && matches(filter.query, s, all)),
    [active, agentsBy, filter.waitingOnly, filter.query],
  );
  return (
    <main className="list-view" aria-label={t('instances.aria')}>
      {today && <TodayBar today={today} />}
      <h1 className="list-view__title">{t('instances.title')}</h1>
      {active.length > 0 && (
        <div className="list-filter" role="search">
          <input
            type="search"
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.search')}
            value={filter.query}
            onChange={(e) => update({ query: e.target.value })}
          />
          <label>
            <input type="checkbox" checked={filter.waitingOnly} onChange={(e) => update({ waitingOnly: e.target.checked })} />
            {t('list.waitingOnly')}
          </label>
          <label>
            <input type="checkbox" checked={filter.hideDone} onChange={(e) => update({ hideDone: e.target.checked })} />
            {t('list.hideDone')}
          </label>
        </div>
      )}
      {active.length === 0 && <p className="list-view__empty">{t('instances.none')}</p>}
      {active.length > 0 && shown.length === 0 && <p className="list-view__empty">{t('instances.noMatch')}</p>}
      {shown.map(({ s, all }) => (
        <SessionCard
          key={s.id}
          session={s}
          agents={all}
          finished={finishedBy.get(s.id) ?? NONE}
          dismissed={dismissedBy.get(s.id) ?? NONE}
          hideDone={filter.hideDone}
          shown={!hidden.includes(s.id)}
          focused={s.id === focus}
          now={now}
          onToggle={onToggle}
          onDismiss={onDismiss}
          onRestore={onRestore}
        />
      ))}
      {closed.length > 0 && show('list.closedFinished') && (
        <section className="list-session list-closed" aria-label={t('finished.closed')}>
          <FinishedToday agents={closed} title="finished.closed" />
        </section>
      )}
    </main>
  );
}
