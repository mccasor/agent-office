import type { AgentState, AgentStatus, OfficeStatus, SessionState, ToolInUse, WaitingKind, WorkArea } from '../../shared/types';
import { formatDuration } from './format';

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
