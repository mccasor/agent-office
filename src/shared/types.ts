/** Contratto dati condiviso tra server (Node) e web (browser). Solo tipi, nessuna logica. */

export type WorkArea =
  | 'backend'
  | 'frontend'
  | 'design'
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
  /** parte di cacheCreation scritta nella cache da 1 ora (prezzo 2x invece di 1,25x); assente nei client vecchi */
  cacheCreation1h?: number;
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
  /** nome di persona stabile dall'id (es. "Marta Commit"), calcolato dal server; assente nei client vecchi e per Claude stesso */
  nickname?: string;
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
  /** effort dell'ultima richiesta del subagente ("low" ... "max"); null o assente se non dichiarato */
  effort?: string | null;

  // --- cruscotto della giornata (#97): esito, errori dei tool, avvisi; tutti assenti nei client vecchi ---
  /** con status 'done': com'è finito; null o assente finché lavora */
  outcome?: AgentOutcome | null;
  /** errori dei tool; null o assente se nessuno */
  toolErrors?: ToolErrors | null;
  /** chiamate consecutive allo stesso tool con lo stesso input (solo nome e numero); null o assente se meno di 2 */
  repeat?: ToolRepeat | null;
  /** avviso calcolato dal server: fermo da troppo tempo o in loop; null o assente se nessuno */
  alert?: AgentAlert | null;
}

/** Esito di un subagente terminato: ok, interrotto (Esc, fermato) o fallito (errore dell'API, task fallito). */
export type AgentOutcome = 'ok' | 'interrupted' | 'failed';

/** Errori dei tool (tool_result con is_error, esclusi i rifiuti dell'utente): mai il testo dell'errore o del comando. */
export interface ToolErrors {
  count: number;
  /** nome del tool dell'ultimo errore e quando (epoch ms) */
  tool: string;
  at: number;
}

/** Stesso tool con lo stesso input più volte di fila: l'input si confronta per hash e non esce dal server. */
export interface ToolRepeat {
  tool: string;
  count: number;
}

/**
 * Avviso su un subagente non terminato: `stale` senza attività da `staleAgentMinutes` (potrebbe aver finito senza
 * che l'ufficio se ne accorgesse), `loop` stesso tool con lo stesso input almeno `loopRepeats` volte di fila.
 */
export type AgentAlert = { kind: 'stale'; since: number } | { kind: 'loop'; tool: string; count: number };

/** Compattazione del contesto (riga compact_boundary del transcript): solo contatori e orario. */
export interface Compaction {
  /** epoch ms */
  at: number;
  /** "auto" o "manual" (/compact) */
  trigger: string;
  /** token del contesto prima e dopo */
  preTokens: number;
  postTokens: number;
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
  /** token e costo della sola sessione principale (Claude stesso, senza i subagenti) */
  ownTokens?: TokenUsage;
  ownCost?: number | null;
  /** inizio del turno: ultimo prompt dell'utente (epoch ms; dall'hook UserPromptSubmit o dal transcript), mai il testo */
  turnStartedAt?: number | null;
  /** durata dell'ultimo turno chiuso (riga turn_duration del transcript) */
  lastTurnMs?: number | null;
  /** compattazioni del contesto nella sessione e l'ultima */
  compactions?: number;
  lastCompaction?: Compaction | null;
  /** modifiche non committate nel repository del cwd (solo sessioni attive); null o assente se non disponibili */
  diff?: RepoDiff | null;
  /** pallino di stato della sessione (stessa regola dell'icona nella menu bar), calcolato dal server */
  dot: OfficeStatus;
  /** nome del progetto: ultima cartella del cwd; null senza cwd */
  project: string | null;
  /** errori dei tool di Claude stesso (#97); null o assente se nessuno */
  toolErrors?: ToolErrors | null;
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
  sessions: SessionState[];
  agents: AgentState[];
  /** agenti terminati oggi e già usciti dall'ufficio, dal più recente (cronologia); assente nei client vecchi */
  finished?: AgentState[];
  /** terminati oggi delle sessioni già chiuse, dallo storico (#98), dal più recente; assente se nessuno */
  closedFinished?: FinishedAgent[];
  /** cruscotto della giornata (#97), da quello che il server ha visto da quando è partito; assente nei client vecchi */
  today?: DayStats;
  generatedAt: number;
}

/** Numeri della giornata (dalla mezzanotte locale), solo da quanto il server ha osservato in memoria. */
export interface DayStats {
  /** da quando valgono i numeri (epoch ms): la mezzanotte, o l'avvio del server se è partito oggi */
  since: number;
  /** costo stimato di oggi in dollari (sessioni e subagenti); null se nessun modello è nel listino */
  cost: number | null;
  /** costo dell'ultima ora (dollari all'ora); null se nessun modello è nel listino */
  costLastHour: number | null;
  /** subagenti partiti oggi, terminati oggi (ok o interrotti) e falliti oggi */
  launched: number;
  finished: number;
  failed: number;
  /** tempo passato oggi con una sessione bloccata in attesa dell'utente (somma sulle sessioni, a minuti interi) */
  waitingMs: number;
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

/*
 * ---- Storico della giornata (#98): attese, cronologia, terminati, statistiche per tipo, file toccati ----
 * Salvato dal server in <dataDir>/history, un file per giorno. Solo orari, contatori, nomi di tool, nickname,
 * tipi di agente e basename di file e progetti: mai testo dei prompt, comandi, errori o descrizioni.
 */

/** Tipo di evento della cronologia. */
export type HistoryEventKind =
  | 'agent-start'
  | 'agent-end'
  /** sessione bloccata su un permesso o una domanda (non il pallino grigio di fine turno) */
  | 'wait'
  | 'unblock'
  | 'compact'
  | 'session-open'
  | 'session-close';

/** Evento della cronologia. */
export interface HistoryEvent {
  /** epoch ms */
  at: number;
  kind: HistoryEventKind;
  sessionId: string;
  /** basename del cwd della sessione; null se sconosciuto */
  project: string | null;
  /** nickname del subagente (o del subagente che blocca la sessione); assente per Claude stesso */
  agent?: string;
  agentType?: string;
  /** nome del tool (in uso all'inizio dell'attesa), mai input o comandi */
  tool?: string;
  /** con wait/unblock: il motivo; con unblock e agent-end: la durata */
  waitingKind?: WaitingKind;
  durationMs?: number;
  /** con agent-end: com'è finito (#97); assente nelle righe scritte prima */
  outcome?: AgentOutcome;
}

/** Subagente terminato oggi in una sessione già chiusa (B5): l'essenziale per la riga dei terminati. */
export interface FinishedAgent {
  id: string;
  sessionId: string;
  project: string | null;
  nickname: string;
  agentType: string;
  area: WorkArea;
  startedAt: number;
  endedAt: number;
  outputTokens: number;
  cost: number | null;
  /** com'è finito (#97); assente nelle righe scritte prima */
  outcome?: AgentOutcome;
}

/** Attese di una sessione nella giornata. */
export interface WaitStats {
  sessionId: string;
  project: string | null;
  count: number;
  /** tempo in attesa cumulato (le attese in corso fino a ora) */
  totalMs: number;
}

/** Statistiche dei subagenti terminati nella giornata, per agentType. */
export interface AgentTypeStats {
  agentType: string;
  count: number;
  avgMs: number;
  /** null se nessun agente del tipo ha un costo stimato */
  cost: number | null;
  avgCost: number | null;
}

/** Risposta di GET /api/history?day=YYYY-MM-DD. */
export interface HistoryReport {
  /** giorno (ora locale del server) */
  day: string;
  /** giorni con uno storico, dal più recente */
  days: string[];
  /** cronologia dal più recente (al più le ultime 200) */
  events: HistoryEvent[];
  waits: { count: number; totalMs: number; sessions: WaitStats[] };
  byType: AgentTypeStats[];
  /** file più toccati: basename e numero di agenti e sessioni che l'hanno letto o modificato */
  files: { name: string; count: number }[];
}
