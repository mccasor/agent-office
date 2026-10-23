import type {
  AgentAlert, AgentOutcome, AgentState, AgentStatus, Compaction, OfficeStatus, SessionState, ToolErrors, ToolInUse, WaitingKind, WorkArea,
} from '../../shared/types';
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

/** Terminati di oggi già usciti dall'ufficio, in fondo alla scheda dell'istanza nella lista. */
export const FINISHED_TODAY_TITLE = 'Terminati oggi';

/** Gruppo richiudibile dei terminati: "1 terminato", "12 terminati". */
export const doneGroupLabel = (n: number): string => `${n} ${COUNT_LABEL[3]![n === 1 ? 0 : 1]}`;

// --- cruscotto della giornata (#97) ---

/** Barra della giornata: titolo, voci (singolare e plurale) e suggerimento sui limiti dei numeri. */
export const TODAY_TITLE = 'Oggi';
export const TODAY_LABEL = {
  cost: 'costo',
  lastHour: 'ultima ora',
  perHour: '/h',
  launched: ['lanciato', 'lanciati'],
  finished: ['terminato', 'terminati'],
  failed: ['fallito', 'falliti'],
  waiting: 'in attesa',
  noWait: '0 min',
} as const;
export const TODAY_HINT = 'Da quando l\'app è aperta: costo stimato a prezzi di listino, agenti e attese di oggi';

/** singolare o plurale secondo `n`: "lanciato", "lanciati" */
export const plural = (n: number, [one, many]: readonly [string, string]): string => (n === 1 ? one : many);

/** Esito di un subagente terminato. */
export const OUTCOME_LABEL: Record<AgentOutcome, string> = {
  ok: 'ok',
  interrupted: 'interrotto',
  failed: 'fallito',
};

/** Righe nuove della scheda dell'agente. */
export const CARD_LABEL = { outcome: 'Esito', errors: 'Errori' } as const;

/** Ora del giorno: "14:32". */
export const clockText = (at: number): string =>
  new Date(at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

/** Errori dei tool: "2 errori dei tool · ultimo Edit alle 14:32"; mai il testo dell'errore. */
export function toolErrorsText(e: ToolErrors): string {
  const count = e.count === 1 ? '1 errore dei tool' : `${e.count} errori dei tool`;
  return `${count} · ultimo ${e.tool} alle ${clockText(e.at)}`;
}

/** Errori in breve, per le righe della lista: "2 errori", "1 errore". */
export const toolErrorsShort = (e: ToolErrors): string => (e.count === 1 ? '1 errore' : `${e.count} errori`);

/** Durata per esteso nelle frasi: "1 h 12 min", "45 min", "2 h". */
const longDuration = (ms: number): string => formatDuration(ms).replace(/^(\d+ h \d+)$/, '$1 min');

/** Avviso su un agente fermo o in loop, per la scheda. */
export function alertText(alert: AgentAlert, now: number): string {
  if (alert.kind === 'stale') {
    return `Nessuna attività da ${longDuration(now - alert.since)}: potrebbe aver finito senza che l'ufficio se ne accorgesse`;
  }
  return `Ha chiamato ${alert.tool} con lo stesso input ${alert.count} volte di fila: potrebbe essere in un loop`;
}

/** Avviso in breve, per la lista e il tooltip del "!": "fermo da 1 h 12 min", "Bash ripetuto 6 volte". */
export function alertShort(alert: AgentAlert, now: number): string {
  return alert.kind === 'stale' ? `fermo da ${longDuration(now - alert.since)}` : `${alert.tool} ripetuto ${alert.count} volte`;
}

/** Pulsante dell'avviso "fermo": nasconde l'agente finché non torna attivo. */
export const DISMISS_LABEL = 'Fallo uscire';
export const DISMISS_HINT = 'Nasconde l\'agente; rientra da solo se torna attivo';
