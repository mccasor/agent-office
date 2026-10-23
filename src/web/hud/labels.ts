import type { AgentStatus, OfficeStatus, ToolInUse, WaitingKind } from '../../shared/types';
import { formatDuration } from './format';

/** Stato di un subagente. */
export const STATUS_LABEL: Record<AgentStatus, string> = {
  entering: 'in arrivo',
  working: 'al lavoro',
  idle: 'inattivo',
  done: 'terminato',
};

/** Stato della sessione principale: a fine turno non ha "terminato", aspetta il prossimo prompt. */
export const SESSION_STATUS_LABEL: Record<AgentStatus, string> = { ...STATUS_LABEL, done: 'pronta' };

/** Pallino di stato (stessa regola dell'icona nella menu bar). */
export const DOT_LABEL: Record<OfficeStatus, string> = {
  waiting: 'in attesa di un tuo input',
  working: 'al lavoro',
  idle: 'inattivo',
};

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

/** "Edit parser.ts", "Bash" */
export const toolText = (tool: ToolInUse): string => (tool.target ? `${tool.name} ${tool.target}` : tool.name);
