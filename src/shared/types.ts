/** Contratto dati condiviso tra server (Node) e web (browser). Solo tipi, nessuna logica. */

export type WorkArea =
  | 'backend'
  | 'frontend'
  | 'architecture'
  | 'test'
  | 'docs'
  | 'devops'
  | 'research'
  | 'other';

/** entering: appena comparso (cammina dalla porta) · working · idle: nessuna attività recente · done: terminato (esce) */
export type AgentStatus = 'entering' | 'working' | 'idle' | 'done';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  /** somma dei quattro campi */
  total: number;
}

export interface TodoProgress {
  completed: number;
  total: number;
}

export interface AgentState {
  /** agentId del transcript (es. "aa90d25bed00dc240") */
  id: string;
  sessionId: string;
  /** nome visualizzato: description del meta.json, altrimenti agentType */
  name: string;
  agentType: string;
  description: string;
  area: WorkArea;
  status: AgentStatus;
  model: string | null;
  tokens: TokenUsage;
  /** null = indeterminato (l'agente non usa una todo list) */
  progress: TodoProgress | null;
  /** issue citate (es. #14) nella descrizione o nell'ultimo prompt con riferimenti; max 3 */
  issues: number[];
  /** epoch ms */
  startedAt: number;
  updatedAt: number;
}

export interface ContextState {
  /** token in ingresso dell'ultima richiesta (input + cache read + cache creation) */
  used: number;
  /** dimensione della finestra di contesto del modello; null se sconosciuta */
  window: number | null;
}

export interface SessionState {
  id: string;
  title: string | null;
  model: string | null;
  /** es. "low" | "medium" | "high" | "xhigh" | "max" */
  effort: string | null;
  context: ContextState;
  /** token usati dalla sessione principale + tutti i suoi subagenti */
  tokensUsed: TokenUsage;
  startedAt: number;
  updatedAt: number;
  active: boolean;
  /** stato della sessione principale (Claude stesso, non i subagenti), stessa semantica di AgentStatus */
  status: AgentStatus;
  /** issue dell'ultimo prompt con riferimenti, altrimenti dedotte dal branch; max 3 */
  issues: number[];
  /** cartella di lavoro della sessione (ultimo `cwd` del transcript) */
  cwd: string | null;
  /** branch git dichiarato dal transcript */
  branch: string | null;
  /** bloccata in attesa dell'utente: permesso di un tool, domanda, richiesta di input (non il prossimo prompt) */
  waiting: boolean;
  /** modifiche non committate nel repository del cwd (solo sessioni attive); null o assente se non disponibili */
  diff?: RepoDiff | null;
}

/** Stato complessivo per l'icona nella menu bar: rosso, verde, grigio. */
export type OfficeStatus = 'waiting' | 'working' | 'idle';

export interface RepoDiff {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
}

export interface RepoState extends RepoDiff {
  project: string;
  branch: string | null;
}

export interface Snapshot {
  /** priorità: waiting (una sessione aspetta l'utente) > working > idle */
  status: OfficeStatus;
  repo: RepoState | null;
  sessions: SessionState[];
  agents: AgentState[];
  generatedAt: number;
}

/** Evento scritto dall'hook di Claude Code (una riga JSON per evento). */
export interface HookEvent {
  /** hook_event_name: SubagentStart, SubagentStop, PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, ... */
  event: string;
  sessionId: string;
  agentId: string | null;
  agentType: string | null;
  toolName: string | null;
  /** solo per Notification: 'input' = Claude è bloccato su un permesso o una domanda, 'idle' = aspetta il prossimo prompt */
  notification?: 'input' | 'idle' | null;
  cwd: string;
  /** epoch ms */
  timestamp: number;
}

/** Sorgente osservabile usata dal server per comporre lo Snapshot. */
export interface Watcher<T> {
  start(): Promise<void>;
  stop(): Promise<void>;
  current(): T;
  onChange(listener: (value: T) => void): () => void;
}

export interface TranscriptSnapshot {
  sessions: SessionState[];
  agents: AgentState[];
}
