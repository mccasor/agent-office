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

/** Tool che un agente sta usando adesso (tool_use senza ancora il risultato). Mai input o comandi. */
export interface ToolInUse {
  /** nome del tool: Bash, Edit, Read, Grep, Agent, ... */
  name: string;
  /** solo il nome del file (senza cartella) per i tool sui file, l'host per WebFetch; altrimenti null */
  target: string | null;
  /** epoch ms */
  since: number;
}

/** Perché una sessione o un subagente è bloccato: permesso di un tool, domanda (AskUserQuestion), piano (ExitPlanMode), altro input. */
export type WaitingKind = 'permission' | 'question' | 'plan' | 'input';

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
  /** tool in uso adesso; null o assente se nessuno */
  tool?: ToolInUse | null;
  /** costo stimato in dollari (listino dell'API); null se il modello non è nel listino */
  cost?: number | null;
  /** bloccato in attesa dell'utente (permesso, domanda), con motivo e inizio come per la sessione */
  waiting?: boolean;
  waitingKind?: WaitingKind | null;
  waitingSince?: number | null;
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
  /** con `waiting`: perché e da quando (epoch ms) */
  waitingKind?: WaitingKind | null;
  waitingSince?: number | null;
  /** con `waiting`: id del subagente bloccato da cui la sessione eredita l'attesa; null o assente = Claude stesso */
  waitingAgentId?: string | null;
  /** tool in uso adesso dalla sessione principale */
  tool?: ToolInUse | null;
  /** costo stimato in dollari della sessione e dei suoi subagenti; null se nessun modello è nel listino */
  cost?: number | null;
  /** modifiche non committate nel repository del cwd (solo sessioni attive); null o assente se non disponibili */
  diff?: RepoDiff | null;
  /** pallino di stato della sessione (stessa regola dell'icona nella menu bar), calcolato dal server */
  dot: OfficeStatus;
  /** nome del progetto: ultima cartella del cwd; null senza cwd */
  project: string | null;
}

/** Sessione letta dal transcript, prima dei campi che il server deriva nello Snapshot. */
export type TranscriptSession = Omit<SessionState, 'dot' | 'project'>;

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
  /** agenti terminati oggi e già usciti dall'ufficio, dal più recente (cronologia); assente nei client vecchi */
  finished?: AgentState[];
  generatedAt: number;
}

/** Evento scritto dall'hook di Claude Code (una riga JSON per evento). */
export interface HookEvent {
  /** hook_event_name: SubagentStart, SubagentStop, PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, PermissionRequest, ... */
  event: string;
  sessionId: string;
  agentId: string | null;
  agentType: string | null;
  toolName: string | null;
  /** solo per Notification: perché Claude è bloccato, oppure 'idle' = aspetta il prossimo prompt */
  notification?: WaitingKind | 'idle' | null;
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
  sessions: TranscriptSession[];
  agents: AgentState[];
}
