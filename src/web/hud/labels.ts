import type { AgentState, AgentStatus, Compaction, OfficeStatus, SessionState, ToolInUse, WaitingKind, WorkArea } from '../../shared/types';
import { formatDuration, formatTokens, urgency } from './format';

/*
 * Un'etichetta per ogni concetto, la stessa nel pannello della menu bar (src-tauri/splash/panel.html) e nell'app
 * (src-tauri/src): "istanza" è una sessione di Claude Code aperta; "al lavoro", "inattivo", "in arrivo"; "terminato"
 * per un subagente che ha finito, "pronto" per Claude stesso a fine turno; "aspetta un tuo input" quando è bloccato.
 */

/** Stato di un subagente. */
export const STATUS_LABEL: Record<AgentStatus, string> = {
  entering: 'in arrivo',
  working: 'al lavoro',
  idle: 'inattivo',
  done: 'terminato',
};

/** Stato di Claude stesso (la sessione principale): a fine turno non ha "terminato", aspetta il prossimo prompt. */
export const SESSION_STATUS_LABEL: Record<AgentStatus, string> = { ...STATUS_LABEL, done: 'pronto' };

/** Pallino di stato (stessa regola dell'icona nella menu bar). */
export const DOT_LABEL: Record<OfficeStatus, string> = {
  waiting: 'aspetta un tuo input',
  working: 'al lavoro',
  idle: 'inattivo',
};

/** Testi delle istanze (sessioni di Claude Code aperte). */
export const INSTANCES_TITLE = 'Istanze aperte';
export const NO_INSTANCES = 'Nessuna istanza di Claude Code aperta';
export const NO_MATCH = 'Nessuna istanza corrisponde al filtro';

/** Nome del progetto (calcolato dal server), altrimenti l'inizio dell'id. */
export const projectName = (s: SessionState): string => s.project ?? s.id.slice(0, 8);

const WAITING_LABEL: Record<WaitingKind, string> = {
  permission: 'aspetta un tuo permesso',
  question: 'ti ha fatto una domanda',
  plan: 'aspetta l\'ok al piano',
  input: 'aspetta un tuo input',
};

/** "aspetta un tuo permesso · da 3 min" */
export function waitingText(kind: WaitingKind | null | undefined, since: number | null | undefined, now: number): string {
  const label = WAITING_LABEL[kind ?? 'input'];
  return since ? `${label} · da ${formatDuration(now - since)}` : label;
}

/** Ruolo dell'agente dall'area di lavoro (#88), in inglese come nel gergo: chip colorata con `hud-chip--<area>`. */
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
  return tool.since > 0 && ms >= 60_000 ? `${toolText(tool)} da ${formatDuration(ms)}` : toolText(tool);
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
  return a.status === 'idle' ? `fermo da ${formatDuration(now - a.updatedAt)}` : null;
}

/**
 * Stato in una riga: il motivo dell'attesa se bloccato, altrimenti stato e attività ("al lavoro · Edit parser.ts");
 * un inattivo dice solo da quanto ("fermo da 12 min", "Bash da 4 min"). `labels` per Claude stesso ("pronto").
 */
export function statusText(a: Activity, now: number, labels: Record<AgentStatus, string> = STATUS_LABEL): string {
  if (a.waiting) return waitingText(a.waitingKind, a.waitingSince, now);
  const activity = activityText(a, now);
  if (a.status === 'idle' && activity) return activity;
  return [labels[a.status], activity].filter(Boolean).join(' · ');
}

/** Turno di Claude: "turno da 3 min" se in corso (dall'ultimo prompt), altrimenti "ultimo turno 12 min"; null se ignoto. */
export function turnText(s: Pick<SessionState, 'status' | 'turnStartedAt' | 'lastTurnMs'>, now: number): string | null {
  if (s.status !== 'done' && s.turnStartedAt) return `turno da ${formatDuration(now - s.turnStartedAt)}`;
  return typeof s.lastTurnMs === 'number' ? `ultimo turno ${formatDuration(s.lastTurnMs)}` : null;
}

/** "compattato 2 volte · ultima 254k → 7.6k (auto)"; null se mai compattato. */
export function compactionText(count: number | undefined, last: Compaction | null | undefined): string | null {
  if (!count) return null;
  const times = count === 1 ? 'compattato 1 volta' : `compattato ${count} volte`;
  if (!last) return times;
  const trigger = last.trigger === 'manual' ? 'manuale' : 'auto';
  return `${times} · ultima ${formatTokens(last.preTokens)} → ${formatTokens(last.postTokens)} (${trigger})`;
}

/** Avviso col contesto oltre il 90%. */
export const COMPACT_HINT = 'conviene /compact';

/** singolare e plurale per urgenza (format.ts): in attesa, al lavoro, inattivi, terminati */
const COUNT_LABEL: [one: string, many: string][] = [
  ['in attesa', 'in attesa'],
  ['al lavoro', 'al lavoro'],
  ['inattivo', 'inattivi'],
  ['terminato', 'terminati'],
];

/** Contatore per stato dei subagenti, solo le voci non zero: "3 al lavoro · 1 in attesa · 12 terminati". */
export function stateCounts(agents: readonly { status: AgentStatus; waiting?: boolean }[]): string {
  const n = [0, 0, 0, 0];
  for (const a of agents) n[urgency(a)]!++;
  // al lavoro prima, poi in attesa, inattivi e terminati
  return [1, 0, 2, 3]
    .filter((i) => n[i]! > 0)
    .map((i) => `${n[i]} ${COUNT_LABEL[i]![n[i] === 1 ? 0 : 1]}`)
    .join(' · ');
}

/** Gruppo richiudibile dei terminati: "1 terminato", "12 terminati". */
export const doneGroupLabel = (n: number): string => `${n} ${COUNT_LABEL[3]![n === 1 ? 0 : 1]}`;
