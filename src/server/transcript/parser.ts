import { createHash } from 'node:crypto';
import type { Compaction, TodoProgress, TokenUsage, ToolErrors, ToolInUse, ToolRepeat } from '../../shared/types.js';

/** stato di fine di un subagente o di un task in background, dalla task-notification (<status>) */
export type TaskEnd = 'completed' | 'failed' | 'killed';

/** Riassunto numerico di un file transcript. Non contiene mai testo dei messaggi. */
export interface FileSummary {
  title: string | null;
  model: string | null;
  /** modelId dichiarato dall'attachment "model" (può avere il suffisso "[1m]"); solo per la finestra di contesto */
  declaredModel: string | null;
  effort: string | null;
  tokens: TokenUsage;
  /** input + cache dell'ultima richiesta */
  contextUsed: number | null;
  firstAt: number | null;
  lastAt: number | null;
  progress: TodoProgress | null;
  /** percorsi toccati da Read/Edit/Write/... (solo per classifyArea, non esposti nello Snapshot) */
  filePaths: string[];
  hasAssistant: boolean;
  /** numeri di issue dell'ultimo prompt che ne cita (solo i numeri, mai il testo) */
  issues: number[];
  /** ultimo `cwd` e `gitBranch` dichiarati dalle righe del transcript */
  cwd: string | null;
  gitBranch: string | null;
  /** domanda all'utente (AskUserQuestion, ExitPlanMode) ancora senza risposta */
  awaitingUser: boolean;
  /** con awaitingUser: tipo dell'ultima domanda aperta e da quando */
  awaitingKind: 'question' | 'plan' | null;
  awaitingSince: number | null;
  /** tool in uso: l'ultimo tool_use del messaggio corrente ancora senza risultato */
  tool: ToolInUse | null;
  /** comandi o agenti avviati in background e non ancora terminati (l'agente riprenderà alla loro notifica) */
  backgroundTasks: number;
  /**
   * risposta finale dell'agente: 'confirmed' (stop_reason end_turn o structured_output),
   * 'tentative' (ultima riga solo testo senza stop_reason: in streaming potrebbe seguire un tool_use)
   */
  finished: false | 'tentative' | 'confirmed';
  /** ultimo prompt scritto dall'utente (solo l'orario, mai il testo): inizio del turno */
  lastPromptAt: number | null;
  /** durata dell'ultimo turno chiuso (riga system turn_duration) */
  lastTurnMs: number | null;
  /** compattazioni del contesto (righe system compact_boundary) e l'ultima */
  compactions: number;
  lastCompaction: Compaction | null;
  /** errori dei tool (tool_result con is_error, esclusi i rifiuti dell'utente): quanti e l'ultimo; null se nessuno */
  toolErrors: ToolErrors | null;
  /** stesso tool con lo stesso input più volte di fila (l'input si confronta per hash); null se meno di 2 */
  repeat: ToolRepeat | null;
  /** fine dell'ultimo turno diversa da una risposta: interrotto dall'utente o errore dell'API; null altrimenti */
  stop: 'interrupted' | 'failed' | null;
  /** fine dei subagenti e dei task in background notificata a questo transcript (task-notification), per id */
  taskEnds: Map<string, TaskEnd>;
}

export interface Accumulator {
  ingest(line: string): void;
  readonly state: FileSummary;
}

type Json = Record<string, unknown>;
type Usage4 = [input: number, output: number, cacheRead: number, cacheCreation: number, cacheCreation1h: number];

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** tool che restano in attesa di una risposta dell'utente finché non arriva il tool_result */
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
/** tool che chiudono il lavoro dell'agente: non sono "in uso" */
const FINAL_TOOLS = new Set(['SubagentHandback', 'StructuredOutput']);

/** Nome del file (mai la cartella) per i tool sui file, host per WebFetch: niente input, comandi o query. */
function toolTarget(name: string, input: Json): string | null {
  if (FILE_TOOLS.has(name)) {
    const path = str(input.file_path) ?? str(input.notebook_path);
    return path ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? null) : null;
  }
  if (name === 'WebFetch') {
    try {
      return new URL(str(input.url) ?? '').hostname || null;
    } catch {
      return null;
    }
  }
  return null;
}
const MAX_FILE_PATHS = 200;
const MAX_COUNTED = 32;
/** nomi dei tool_use recenti per id, per dare un nome agli errori (i risultati seguono di poco le chiamate) */
const MAX_TOOL_NAMES = 64;
/** esiti dei task ricordati al più (i più vecchi si dimenticano) */
const MAX_TASK_ENDS = 200;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseUsage(u: unknown): Usage4 | null {
  if (!isObj(u)) return null;
  // dettaglio della scrittura in cache: la parte da 1 ora costa di più (pricing.ts)
  const creation = isObj(u.cache_creation) ? u.cache_creation : {};
  return [
    num(u.input_tokens),
    num(u.output_tokens),
    num(u.cache_read_input_tokens),
    num(u.cache_creation_input_tokens),
    num(creation.ephemeral_1h_input_tokens),
  ];
}

const MAX_ISSUES = 3;
const ISSUE_RE = /(?<![\w&/])(?:#|\bissues?\s+#?)(\d{1,6})\b/gi;
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Numeri di issue in un testo ("#14", "issue 14"), senza duplicati, nell'ordine di comparsa. */
export function extractIssues(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(REMINDER_RE, '').matchAll(ISSUE_RE)) {
    const n = Number(m[1]);
    if (n > 0 && !out.includes(n)) out.push(n);
    if (out.length === MAX_ISSUES) break;
  }
  return out;
}

/** id dei tool_use a cui risponde una riga utente (blocchi tool_result) */
function toolResultIds(row: Json): string[] {
  const content = isObj(row.message) ? row.message.content : null;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Json => isObj(b) && b.type === 'tool_result').map((b) => str(b.tool_use_id) ?? '');
}

/**
 * Testo dei blocchi di una riga utente (stringa, text, tool_result), solo per cercarvi degli id; con `results`,
 * solo dei tool_result che rispondono a quei tool_use.
 */
function userTexts(row: Json, results?: ReadonlySet<string>): string[] {
  const content = isObj(row.message) ? row.message.content : null;
  if (typeof content === 'string') return results ? [] : [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (!isObj(b)) continue;
    if (results && !(b.type === 'tool_result' && results.has(str(b.tool_use_id) ?? ''))) continue;
    if (typeof b.text === 'string') out.push(b.text);
    if (typeof b.content === 'string') out.push(b.content);
    else if (Array.isArray(b.content)) for (const c of b.content) if (isObj(c) && typeof c.text === 'string') out.push(c.text);
  }
  return out;
}

/** avvio di un comando o di un agente in background, cercato solo nel tool_result del Bash o dell'Agent che lo lancia */
const BACKGROUND_STARTED_RE = /(?:running in background with ID|agentId): ([\w-]+)/g;
/** riga scritta da Claude Code quando il turno viene interrotto ("... by user" o "... by user for tool use") */
const INTERRUPTED = '[Request interrupted by user';
/** notifica di fine di un task in background */
const BACKGROUND_DONE_RE = /<task-id>([\w-]+)<\/task-id>/g;

/** rifiuto di un tool da parte dell'utente: è un tool_result con is_error, ma non un errore del tool */
const REJECTED = "The user doesn't want to proceed";
/** stato di fine dentro una task-notification (fallito, fermato, completato) */
const TASK_STATUS_RE = /<status>(completed|failed|killed)<\/status>/;
/** id dell'agente nel risultato del tool Agent */
const AGENT_ID_RE = /agentId: ([\w-]+)/;

/** Esiti nelle task-notification di un testo: id e stato di ciascuna, mai il riassunto o il risultato. */
function taskEndsIn(text: string): [id: string, end: TaskEnd][] {
  const out: [string, TaskEnd][] = [];
  for (const part of text.split('<task-notification>').slice(1)) {
    const id = /<task-id>([\w-]+)<\/task-id>/.exec(part)?.[1];
    const end = TASK_STATUS_RE.exec(part)?.[1] as TaskEnd | undefined;
    if (id && end) out.push([id, end]);
  }
  return out;
}

/** righe utente scritte da Claude Code e non dall'utente (output di comandi locali, notifiche di task) */
const NOT_PROMPT_RE = /^<(?:local-command-|task-notification)/;

/**
 * Prompt scritto dall'utente: niente meta, riassunti di compattazione, tool_result, interruzioni e notifiche
 * (`origin.kind` diverso da "human" nelle versioni che lo scrivono).
 */
function isPrompt(row: Json): boolean {
  if (row.isMeta === true || row.isCompactSummary === true) return false;
  if (isObj(row.origin) && row.origin.kind !== 'human') return false;
  if (toolResultIds(row).length > 0) return false;
  const texts = userTexts(row);
  return texts.length > 0 && !texts.some((t) => t.startsWith(INTERRUPTED) || NOT_PROMPT_RE.test(t));
}

/** Issue citate in un prompt utente (testo scritto, non tool_result né messaggi meta). */
function promptIssues(row: Json): number[] {
  if (row.isMeta === true || !isObj(row.message)) return [];
  const content = row.message.content;
  if (typeof content === 'string') return extractIssues(content);
  if (!Array.isArray(content)) return [];
  const text = content.filter((b): b is Json => isObj(b) && b.type === 'text').map((b) => str(b.text) ?? '').join('\n');
  return extractIssues(text);
}

export function createAccumulator(): Accumulator {
  const state: FileSummary = {
    title: null,
    model: null,
    declaredModel: null,
    effort: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation1h: 0, total: 0 },
    contextUsed: null,
    firstAt: null,
    lastAt: null,
    progress: null,
    filePaths: [],
    hasAssistant: false,
    issues: [],
    cwd: null,
    gitBranch: null,
    awaitingUser: false,
    awaitingKind: null,
    awaitingSince: null,
    tool: null,
    backgroundTasks: 0,
    finished: false,
    lastPromptAt: null,
    lastTurnMs: null,
    compactions: 0,
    lastCompaction: null,
    toolErrors: null,
    repeat: null,
    stop: null,
    taskEnds: new Map(),
  };
  /** tool_use che aspettano una risposta dell'utente, per id */
  const pendingQuestions = new Map<string, { kind: 'question' | 'plan'; at: number | null }>();
  /** tool_use del messaggio corrente ancora senza risultato, per id (in ordine di chiamata) */
  const pendingTools = new Map<string, ToolInUse>();
  let toolMessageId: string | null = null;
  const updateAwaiting = () => {
    const last = [...pendingQuestions.values()].at(-1);
    state.awaitingUser = last !== undefined;
    state.awaitingKind = last?.kind ?? null;
    state.awaitingSince = last?.at ?? null;
  };
  const updateTool = () => {
    state.tool = [...pendingTools.values()].at(-1) ?? null;
  };
  /** id dei task in background ancora aperti (solo gli id, mai il testo dei messaggi) */
  const background = new Set<string>();
  /**
   * tool_use che possono avviare un task in background (Bash con run_in_background, Agent), in attesa del risultato:
   * l'id si cerca solo lì, non nel testo di un file letto che contiene per caso "agentId: string"
   */
  const launches = new Set<string>();
  /**
   * Usage già conteggiato per message.id. Claude Code scrive una riga per blocco di contenuto
   * (thinking, text, tool_use) dello stesso messaggio ripetendo l'usage, a volte con output_tokens
   * crescente: si sottrae il precedente e si somma l'ultimo.
   */
  const counted = new Map<string, Usage4>();
  const filePaths = new Set<string>();
  let todos: TodoProgress | null = null;
  let tasks: Map<string, string> | null = null;
  let nextTaskId = 1;
  let structuredOutputPending = false;
  /** nome del tool per id dei tool_use recenti (per gli errori) */
  const toolNames = new Map<string, string>();
  /** ultima chiamata (id e chiave nome + hash dell'input) per contare le ripetizioni */
  let lastCall: { id: string | null; key: string } | null = null;
  const taskEnd = (id: string, end: TaskEnd) => {
    state.taskEnds.delete(id);
    state.taskEnds.set(id, end);
    if (state.taskEnds.size > MAX_TASK_ENDS) state.taskEnds.delete(state.taskEnds.keys().next().value!);
  };
  /** notifiche di fine: liberano i task in background e ne ricordano lo stato */
  const onTaskText = (text: string) => {
    for (const m of text.matchAll(BACKGROUND_DONE_RE)) background.delete(m[1]!);
    for (const [id, end] of taskEndsIn(text)) taskEnd(id, end);
  };
  /** stesso tool con lo stesso input della chiamata precedente: la serie cresce, altrimenti riparte da 1 */
  const countRepeat = (name: string, id: string | null, input: Json) => {
    if (id !== null && lastCall?.id === id) return;
    const key = `${name}:${createHash('sha1').update(JSON.stringify(input)).digest('base64')}`;
    const count = lastCall?.key === key ? (state.repeat?.count ?? 1) + 1 : 1;
    lastCall = { id, key };
    state.repeat = count >= 2 ? { tool: name, count } : null;
  };
  /** tool_result con is_error di una riga utente: si contano solo nome del tool e ora, mai il testo */
  const onToolErrors = (row: Json, at: number | null) => {
    const content = isObj(row.message) ? row.message.content : null;
    if (!Array.isArray(content) || userTexts(row).some((t) => t.startsWith(INTERRUPTED))) return;
    for (const b of content) {
      if (!isObj(b) || b.type !== 'tool_result' || b.is_error !== true) continue;
      const texts = userTexts({ message: { content: [b] } });
      if (texts.some((t) => t.startsWith(REJECTED))) continue;
      const tool = toolNames.get(str(b.tool_use_id) ?? '') ?? 'tool';
      state.toolErrors = { count: (state.toolErrors?.count ?? 0) + 1, tool, at: at ?? state.lastAt ?? 0 };
      // subagente lanciato in primo piano e fallito: l'id è nel risultato dell'Agent
      if (tool === 'Agent' || tool === 'Task') {
        const agentId = texts.map((t) => AGENT_ID_RE.exec(t)?.[1]).find(Boolean);
        if (agentId) taskEnd(agentId, 'failed');
      }
    }
  };

  const addUsage = (u: Usage4, sign: 1 | -1) => {
    const t = state.tokens;
    t.input += sign * u[0];
    t.output += sign * u[1];
    t.cacheRead += sign * u[2];
    t.cacheCreation += sign * u[3];
    t.cacheCreation1h = (t.cacheCreation1h ?? 0) + sign * u[4];
    t.total = t.input + t.output + t.cacheRead + t.cacheCreation;
  };

  const updateProgress = () => {
    if (tasks) {
      const statuses = [...tasks.values()];
      state.progress = { completed: statuses.filter((s) => s === 'completed').length, total: statuses.length };
    } else {
      state.progress = todos;
    }
  };

  const onToolUse = (block: Json, at: number | null) => {
    const name = str(block.name);
    const input = isObj(block.input) ? block.input : {};
    const id = str(block.id);
    if (name) {
      if (id) {
        toolNames.set(id, name);
        if (toolNames.size > MAX_TOOL_NAMES) toolNames.delete(toolNames.keys().next().value!);
      }
      countRepeat(name, id, input);
    }
    if (QUESTION_TOOLS.has(name ?? '')) {
      if (id) pendingQuestions.set(id, { kind: name === 'ExitPlanMode' ? 'plan' : 'question', at });
      updateAwaiting();
    } else if (name && id && !FINAL_TOOLS.has(name)) {
      pendingTools.set(id, { name, target: toolTarget(name, input), since: at ?? state.lastAt ?? 0 });
      updateTool();
    }
    if (id && ((name === 'Bash' && input.run_in_background === true) || name === 'Agent' || name === 'Task')) launches.add(id);
    if (FILE_TOOLS.has(name ?? '')) {
      const path = str(input.file_path) ?? str(input.notebook_path);
      if (path && filePaths.size < MAX_FILE_PATHS && !filePaths.has(path)) {
        filePaths.add(path);
        state.filePaths = [...filePaths];
      }
    } else if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      const list = input.todos.filter(isObj);
      todos = { completed: list.filter((t) => t.status === 'completed').length, total: list.length };
      tasks = null;
      updateProgress();
    } else if (name === 'TaskCreate') {
      // Claude Code assegna id sequenziali "1", "2", ... nell'ordine di creazione
      tasks ??= new Map();
      tasks.set(String(nextTaskId++), 'pending');
      updateProgress();
    } else if (name === 'TaskUpdate') {
      const id = input.taskId === undefined ? null : String(input.taskId);
      const status = str(input.status);
      if (tasks && id && tasks.has(id) && status) {
        if (status === 'deleted') tasks.delete(id);
        else tasks.set(id, status);
        updateProgress();
      }
    }
  };

  const onAssistant = (row: Json, at: number | null) => {
    const msg = row.message;
    if (!isObj(msg)) return;
    // nuovo messaggio: i tool rimasti senza risultato (es. interrotti) non sono più in uso
    const messageId = str(msg.id);
    if (messageId && messageId !== toolMessageId) {
      toolMessageId = messageId;
      pendingTools.clear();
      updateTool();
    }
    const model = str(msg.model);
    if (row.isApiErrorMessage === true) {
      // errore dell'API dopo i tentativi di Claude Code: il turno (o il subagente) si chiude con un fallimento
      state.stop = 'failed';
      state.finished = 'confirmed';
      pendingTools.clear();
      updateTool();
      return;
    }
    if (model === '<synthetic>') return;
    if (model) state.model = model;
    const effort = str(row.effort);
    if (effort) state.effort = effort;

    const usage = parseUsage(msg.usage);
    if (usage) {
      const id = str(msg.id);
      const previous = id ? counted.get(id) : undefined;
      if (previous) addUsage(previous, -1);
      addUsage(usage, 1);
      if (id) {
        counted.set(id, usage);
        // le righe di uno stesso messaggio sono consecutive: bastano gli ultimi id (la mappa non cresce col transcript)
        if (counted.size > MAX_COUNTED) counted.delete(counted.keys().next().value!);
      }
      state.contextUsed = usage[0] + usage[2] + usage[3];
    }

    let hasToolUse = false;
    let hasText = false;
    let handback = false;
    for (const block of Array.isArray(msg.content) ? msg.content.filter(isObj) : []) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        if (block.name === 'SubagentHandback') handback = true;
        onToolUse(block, at);
      } else if (block.type === 'text') {
        hasText = true;
      }
    }
    state.hasAssistant = true;
    if (handback) {
      // report finale del subagente: il tool_result che segue non lo riattiva
      state.finished = 'confirmed';
      structuredOutputPending = true;
    } else if (!hasText || hasToolUse || msg.stop_reason === 'tool_use') state.finished = false;
    else state.finished = msg.stop_reason === 'end_turn' ? 'confirmed' : 'tentative';
  };

  const onAttachment = (row: Json) => {
    const att = isObj(row.attachment) ? row.attachment : {};
    if (att.type === 'model') {
      const identity = isObj(att.identity) ? att.identity : {};
      state.declaredModel = str(identity.modelId) ?? state.declaredModel;
    } else if (att.type === 'structured_output') {
      state.finished = 'confirmed';
      structuredOutputPending = true;
    } else if (att.type === 'queued_command' && typeof att.prompt === 'string') {
      // nei subagenti le notifiche di fine dei task in background arrivano così, senza una riga utente
      onTaskText(att.prompt);
      state.backgroundTasks = background.size;
    }
  };

  /** fine di un turno (durata) e compattazioni del contesto: solo numeri */
  const onSystem = (row: Json, at: number | null) => {
    if (row.subtype === 'turn_duration' && typeof row.durationMs === 'number') {
      state.lastTurnMs = num(row.durationMs);
    } else if (row.subtype === 'compact_boundary') {
      const meta = isObj(row.compactMetadata) ? row.compactMetadata : {};
      state.compactions++;
      state.lastCompaction = {
        at: at ?? state.lastAt ?? 0,
        trigger: str(meta.trigger) ?? 'auto',
        preTokens: num(meta.preTokens),
        postTokens: num(meta.postTokens),
      };
    }
  };

  const ingest = (line: string) => {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObj(row)) return;

    state.cwd = str(row.cwd) ?? state.cwd;
    state.gitBranch = str(row.gitBranch) ?? state.gitBranch;
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    if (Number.isFinite(at)) {
      state.firstAt = state.firstAt === null ? at : Math.min(state.firstAt, at);
      state.lastAt = state.lastAt === null ? at : Math.max(state.lastAt, at);
    }

    switch (row.type) {
      case 'ai-title':
        state.title = str(row.aiTitle) ?? state.title;
        break;
      case 'api-request': {
        const params = isObj(row.params) ? row.params : {};
        state.model = str(params.model) ?? state.model;
        state.effort = (isObj(params.output_config) ? str(params.output_config.effort) : null) ?? state.effort;
        break;
      }
      case 'assistant':
        onAssistant(row, Number.isFinite(at) ? at : null);
        break;
      case 'user': {
        if (Number.isFinite(at) && isPrompt(row)) state.lastPromptAt = Math.max(state.lastPromptAt ?? 0, at);
        const issues = promptIssues(row);
        if (issues.length > 0) state.issues = issues;
        for (const id of toolResultIds(row)) {
          pendingQuestions.delete(id);
          pendingTools.delete(id);
        }
        updateAwaiting();
        updateTool();
        for (const text of userTexts(row, launches)) for (const m of text.matchAll(BACKGROUND_STARTED_RE)) background.add(m[1]!);
        for (const text of userTexts(row)) onTaskText(text);
        onToolErrors(row, Number.isFinite(at) ? at : null);
        for (const id of toolResultIds(row)) launches.delete(id);
        state.backgroundTasks = background.size;
        // un nuovo input (prompt o tool_result) riapre il lavoro, salvo il tool_result di StructuredOutput
        if (!structuredOutputPending) {
          state.finished = false;
          state.stop = null;
        }
        structuredOutputPending = false;
        // interrotto (Esc, tool rifiutato, agente fermato): il turno è finito, non arriverà altro
        if (userTexts(row).some((t) => t.startsWith(INTERRUPTED))) {
          state.finished = 'confirmed';
          state.stop = 'interrupted';
        }
        break;
      }
      case 'attachment':
        onAttachment(row);
        break;
      case 'system':
        onSystem(row, Number.isFinite(at) ? at : null);
        break;
      case 'queue-operation':
        // notifiche di fine messe in coda mentre Claude lavora: arrivano qui anche senza una riga utente
        if (typeof row.content === 'string') onTaskText(row.content);
        state.backgroundTasks = background.size;
        break;
    }
  };

  return { ingest, state };
}
