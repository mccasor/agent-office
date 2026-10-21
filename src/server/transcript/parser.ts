import type { TodoProgress, TokenUsage } from '../../shared/types.js';

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
  tokensLeft: { value: number; at: number } | null;
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
  /**
   * risposta finale dell'agente: 'confirmed' (stop_reason end_turn o structured_output),
   * 'tentative' (ultima riga solo testo senza stop_reason: in streaming potrebbe seguire un tool_use)
   */
  finished: false | 'tentative' | 'confirmed';
}

export interface Accumulator {
  ingest(line: string): void;
  readonly state: FileSummary;
}

type Json = Record<string, unknown>;
type Usage4 = [input: number, output: number, cacheRead: number, cacheCreation: number];

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** tool che restano in attesa di una risposta dell'utente finché non arriva il tool_result */
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const MAX_FILE_PATHS = 200;
const TOKENS_LEFT_RE = /<total_tokens>\s*(\d+)\s*tokens left/;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseUsage(u: unknown): Usage4 | null {
  if (!isObj(u)) return null;
  return [num(u.input_tokens), num(u.output_tokens), num(u.cache_read_input_tokens), num(u.cache_creation_input_tokens)];
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
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
    contextUsed: null,
    tokensLeft: null,
    firstAt: null,
    lastAt: null,
    progress: null,
    filePaths: [],
    hasAssistant: false,
    issues: [],
    cwd: null,
    gitBranch: null,
    awaitingUser: false,
    finished: false,
  };
  /** tool_use che aspettano una risposta dell'utente, per id */
  const pendingQuestions = new Set<string>();
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

  const addUsage = (u: Usage4, sign: 1 | -1) => {
    const t = state.tokens;
    t.input += sign * u[0];
    t.output += sign * u[1];
    t.cacheRead += sign * u[2];
    t.cacheCreation += sign * u[3];
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

  const onToolUse = (block: Json) => {
    const name = str(block.name);
    const input = isObj(block.input) ? block.input : {};
    if (QUESTION_TOOLS.has(name ?? '')) {
      const id = str(block.id);
      if (id) pendingQuestions.add(id);
      state.awaitingUser = pendingQuestions.size > 0;
    }
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

  const onAssistant = (row: Json) => {
    const msg = row.message;
    if (!isObj(msg)) return;
    const model = str(msg.model);
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
      if (id) counted.set(id, usage);
      state.contextUsed = usage[0] + usage[2] + usage[3];
    }

    let hasToolUse = false;
    let hasText = false;
    let handback = false;
    for (const block of Array.isArray(msg.content) ? msg.content.filter(isObj) : []) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        if (block.name === 'SubagentHandback') handback = true;
        onToolUse(block);
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

  const onAttachment = (row: Json, at: number) => {
    const att = isObj(row.attachment) ? row.attachment : {};
    if (att.type === 'total_tokens_reminder') {
      const m = typeof att.text === 'string' ? TOKENS_LEFT_RE.exec(att.text) : null;
      if (m?.[1]) state.tokensLeft = { value: Number(m[1]), at: Number.isFinite(at) ? at : (state.lastAt ?? 0) };
    } else if (att.type === 'model') {
      const identity = isObj(att.identity) ? att.identity : {};
      state.declaredModel = str(identity.modelId) ?? state.declaredModel;
    } else if (att.type === 'structured_output') {
      state.finished = 'confirmed';
      structuredOutputPending = true;
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
        onAssistant(row);
        break;
      case 'user': {
        const issues = promptIssues(row);
        if (issues.length > 0) state.issues = issues;
        for (const id of toolResultIds(row)) pendingQuestions.delete(id);
        state.awaitingUser = pendingQuestions.size > 0;
        // un nuovo input (prompt o tool_result) riapre il lavoro, salvo il tool_result di StructuredOutput
        if (!structuredOutputPending) state.finished = false;
        structuredOutputPending = false;
        break;
      }
      case 'attachment':
        onAttachment(row, at);
        break;
    }
  };

  return { ingest, state };
}
