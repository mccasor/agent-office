import type {
  AgentAlert, AgentOutcome, AgentState, AgentStatus, Compaction, OfficeStatus, SessionState, ToolErrors, ToolInUse, WaitingKind, WorkArea,
} from '../../shared/types';
import { clock, t, tn, type TextKey } from '../../shared/i18n';
import { formatDuration, formatTokens, urgency } from './format';

/*
 * Un'etichetta per ogni concetto, la stessa nel pannello della menu bar (src-tauri/splash/panel.html) e nell'app
 * (src-tauri/src): "istanza" è una sessione di Claude Code aperta; "al lavoro", "inattivo", "in arrivo"; "terminato"
 * per un subagente che ha finito, "pronto" per Claude stesso a fine turno; "aspetta un tuo input" quando è bloccato.
 * I testi stanno in src/shared/i18n (#93), nella lingua corrente: qui si compongono.
 */

/**
 * Tabella di testi nella lingua corrente: ogni valore si legge al momento (getter), così le tabelle restano costanti
 * del modulo e cambiano con la lingua.
 */
function localized<K extends string>(keys: Record<K, TextKey>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { get: () => t(keys[k]), enumerable: true });
  return out;
}

/** Stato di un subagente. */
export const STATUS_LABEL = localized<AgentStatus>({
  entering: 'status.entering',
  working: 'status.working',
  idle: 'status.idle',
  done: 'status.done',
});

/** Stato di Claude stesso (la sessione principale): a fine turno non ha "terminato", aspetta il prossimo prompt. */
export const SESSION_STATUS_LABEL = localized<AgentStatus>({
  entering: 'status.entering',
  working: 'status.working',
  idle: 'status.idle',
  done: 'status.ready',
});

/** Pallino di stato (stessa regola dell'icona nella menu bar). */
export const DOT_LABEL = localized<OfficeStatus>({
  waiting: 'waiting.input',
  working: 'status.working',
  idle: 'status.idle',
});

/** Nome del progetto (calcolato dal server), altrimenti l'inizio dell'id. */
export const projectName = (s: SessionState): string => s.project ?? s.id.slice(0, 8);

const WAITING_LABEL = localized<WaitingKind>({
  permission: 'waiting.permission',
  question: 'waiting.question',
  plan: 'waiting.plan',
  input: 'waiting.input',
});

/** "aspetta un tuo permesso · da 3 min" */
export function waitingText(kind: WaitingKind | null | undefined, since: number | null | undefined, now: number): string {
  const label = WAITING_LABEL[kind ?? 'input'];
  return since ? t('waiting.since', { label, d: formatDuration(now - since) }) : label;
}

/** Ruolo dell'agente dall'area di lavoro (#88), in inglese come nel gergo (non si traduce): chip colorata con `hud-chip--<area>`. */
export const AREA_LABEL: Record<WorkArea, string> = {
  backend: 'backend',
  frontend: 'frontend',
  design: 'design',
  architecture: 'architect',
  test: 'QA',
  docs: 'docs',
  devops: 'devops',
  research: 'research',
  other: 'generalist',
};

/** Nome di persona dell'agente ("Marta Commit"); Claudio Code e i client vecchi usano il nome descrittivo. */
export const agentName = (agent: Pick<AgentState, 'name' | 'nickname'>): string => agent.nickname ?? agent.name;

/** Sottotitolo: il nome descrittivo (il compito), solo se c'è un nome di persona a precederlo. */
export const agentTask = (agent: Pick<AgentState, 'name' | 'nickname'>): string | null => (agent.nickname ? agent.name : null);

/** "Edit parser.ts", "Bash" */
export const toolText = (tool: ToolInUse): string => (tool.target ? `${tool.name} ${tool.target}` : tool.name);

/** Tool in uso con da quanto, se da almeno un minuto: "Bash da 4 min", altrimenti "Edit parser.ts". */
export function toolSince(tool: ToolInUse, now: number): string {
  const ms = now - tool.since;
  return tool.since > 0 && ms >= 60_000 ? t('activity.toolSince', { tool: toolText(tool), d: formatDuration(ms) }) : toolText(tool);
}

interface Activity {
  status: AgentStatus;
  tool?: ToolInUse | null;
  updatedAt: number;
  waiting?: boolean;
  waitingKind?: WaitingKind | null;
  waitingSince?: number | null;
}

/** Cosa sta facendo: il tool in uso ("Bash da 4 min"), altrimenti per un inattivo "fermo da 12 min"; null se niente. */
export function activityText(a: Activity, now: number): string | null {
  if (a.status === 'done') return null;
  if (a.tool) return toolSince(a.tool, now);
  return a.status === 'idle' ? t('activity.idleSince', { d: formatDuration(now - a.updatedAt) }) : null;
}

/**
 * Stato in una riga: il motivo dell'attesa se bloccato, altrimenti stato e attività ("al lavoro · Edit parser.ts");
 * un inattivo dice solo da quanto ("fermo da 12 min", "Bash da 4 min"). `labels` per Claude stesso ("pronto").
 */
export function statusText(a: Activity, now: number, labels: Readonly<Record<AgentStatus, string>> = STATUS_LABEL): string {
  if (a.waiting) return waitingText(a.waitingKind, a.waitingSince, now);
  const activity = activityText(a, now);
  if (a.status === 'idle' && activity) return activity;
  return [labels[a.status], activity].filter(Boolean).join(' · ');
}

/** Turno di Claude: "turno da 3 min" se in corso (dall'ultimo prompt), altrimenti "ultimo turno 12 min"; null se ignoto. */
export function turnText(s: Pick<SessionState, 'status' | 'turnStartedAt' | 'lastTurnMs'>, now: number): string | null {
  if (s.status !== 'done' && s.turnStartedAt) return t('turn.current', { d: formatDuration(now - s.turnStartedAt) });
  return typeof s.lastTurnMs === 'number' ? t('turn.last', { d: formatDuration(s.lastTurnMs) }) : null;
}

/** "compattato 2 volte · ultima 254k → 7.6k (auto)"; null se mai compattato. */
export function compactionText(count: number | undefined, last: Compaction | null | undefined): string | null {
  if (!count) return null;
  const times = tn('compact.times', count);
  if (!last) return times;
  const trigger = t(last.trigger === 'manual' ? 'compact.manual' : 'compact.auto');
  return t('compact.last', { times, pre: formatTokens(last.preTokens), post: formatTokens(last.postTokens), trigger });
}

/** contatori per urgenza (format.ts): in attesa, al lavoro, inattivi, terminati */
const COUNT_KEY = ['count.waiting', 'count.working', 'count.idle', 'count.done'] as const;

/** Contatore per stato dei subagenti, solo le voci non zero: "3 al lavoro · 1 in attesa · 12 terminati". */
export function stateCounts(agents: readonly { status: AgentStatus; waiting?: boolean }[]): string {
  const n = [0, 0, 0, 0];
  for (const a of agents) n[urgency(a)]!++;
  // al lavoro prima, poi in attesa, inattivi e terminati
  return [1, 0, 2, 3]
    .filter((i) => n[i]! > 0)
    .map((i) => tn(COUNT_KEY[i]!, n[i]!))
    .join(' · ');
}

/** Gruppo richiudibile dei terminati: "1 terminato", "12 terminati". */
export const doneGroupLabel = (n: number): string => tn('count.done', n);

/** Esito di un subagente terminato. */
export const OUTCOME_LABEL = localized<AgentOutcome>({
  ok: 'outcome.ok',
  interrupted: 'outcome.interrupted',
  failed: 'outcome.failed',
});

/** Ora del giorno: "14:32". */
export const clockText = (at: number): string => clock(at);

/** Errori dei tool: "2 errori dei tool · ultimo Edit alle 14:32"; mai il testo dell'errore. */
export function toolErrorsText(e: ToolErrors): string {
  return t('toolErrors.full', { count: tn('toolErrors.count', e.count), tool: e.tool, time: clockText(e.at) });
}

/** Errori in breve, per le righe della lista: "2 errori", "1 errore". */
export const toolErrorsShort = (e: ToolErrors): string => tn('toolErrors.short', e.count);

/** Avviso su un agente fermo o in loop, per la scheda. */
export function alertText(alert: AgentAlert, now: number): string {
  if (alert.kind === 'stale') return t('alert.stale', { d: formatDuration(now - alert.since, true) });
  return t('alert.loop', { tool: alert.tool, n: alert.count });
}

/** Avviso in breve, per la lista e il tooltip del "!": "fermo da 1 h 12 min", "Bash ripetuto 6 volte". */
export function alertShort(alert: AgentAlert, now: number): string {
  return alert.kind === 'stale'
    ? t('alert.staleShort', { d: formatDuration(now - alert.since, true) })
    : t('alert.loopShort', { tool: alert.tool, n: alert.count });
}
