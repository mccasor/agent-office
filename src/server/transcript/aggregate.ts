import { estimateCost } from '../../shared/pricing.js';
import type { AgentOutcome, AgentState, AgentStatus, TokenUsage, TranscriptSession, TranscriptSnapshot } from '../../shared/types.js';
import { classifyArea } from './classify.js';
import { contextWindowFor } from './models.js';
import { extractIssues, type FileSummary, type TaskEnd } from './parser.js';
import { agentKey, type Parsed } from './paths.js';

export interface AgentMeta {
  agentType: string;
  description: string;
}

/** transcript già letto: riassunto numerico e mtime del file */
export interface AggregateFile {
  parsed: Exclude<Parsed, { kind: 'meta' }>;
  state: FileSummary;
  mtime: number;
}

export interface AggregateOptions {
  /** una sessione è attiva se modificata negli ultimi N ms */
  activeWindowMs: number;
  /** un agente non terminato è idle se fermo da più di N ms */
  idleAfterMs: number;
  /** risposta finale senza stop_reason: considerata definitiva dopo N ms di silenzio */
  doneGraceMs: number;
  /** solo il lavoro in corso: sessioni attive e i loro subagenti (modalità all) */
  onlyActive?: boolean;
}

export const UNKNOWN_AGENT_TYPE = 'unknown';

const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation1h: 0, total: 0 });

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  const input = a.input + b.input;
  const output = a.output + b.output;
  const cacheRead = a.cacheRead + b.cacheRead;
  const cacheCreation = a.cacheCreation + b.cacheCreation;
  const cacheCreation1h = (a.cacheCreation1h ?? 0) + (b.cacheCreation1h ?? 0);
  return { input, output, cacheRead, cacheCreation, cacheCreation1h, total: input + output + cacheRead + cacheCreation };
}

/** Esito di un subagente terminato: dal suo transcript (interruzione, errore dell'API) e dalla notifica alla sessione. */
export function outcomeOf(s: Pick<FileSummary, 'stop'>, end: TaskEnd | undefined): AgentOutcome {
  if (s.stop === 'failed' || end === 'failed') return 'failed';
  return s.stop === 'interrupted' || end === 'killed' ? 'interrupted' : 'ok';
}

const mergeIssues = (a: number[], b: number[]): number[] => [...new Set([...a, ...b])].slice(0, 3);

function agentStatus(s: FileSummary, updatedAt: number, t: number, opts: AggregateOptions, end?: TaskEnd): AgentStatus {
  const { finished, hasAssistant, backgroundTasks } = s;
  // fallito o fermato secondo la notifica alla sessione: non arriverà altro, anche se il suo transcript non lo dice
  if (end === 'failed' || end === 'killed') return 'done';
  // fine del turno ma con comandi in background aperti: riprenderà alla loro notifica, non ha finito; tranne se la
  // sessione ha già avuto la sua notifica di fine (#110): ha consegnato il rapporto, e un comando chiuso da fuori o
  // dopo di lui non gli manderà mai la notifica che lo farebbe scendere a zero
  const done = finished === 'confirmed' || (finished === 'tentative' && t - updatedAt >= opts.doneGraceMs);
  if (done && (backgroundTasks === 0 || end === 'completed')) return 'done';
  if (!hasAssistant) return 'entering';
  return t - updatedAt > opts.idleAfterMs ? 'idle' : 'working';
}

/**
 * Snapshot dei transcript all'istante `t`: sessioni (token e costo sommati ai subagenti) e subagenti.
 * Pura: niente filesystem né orologio. `metas` è indicizzata da `agentKey(sessionId, agentId)`.
 */
export function aggregate(
  files: Iterable<AggregateFile>,
  metas: ReadonlyMap<string, AgentMeta>,
  t: number,
  opts: AggregateOptions,
): TranscriptSnapshot {
  let agents: AgentState[] = [];
  const bySession = new Map<string, { files: AggregateFile[]; tokens: TokenUsage; cost: number | null }>();
  const group = (sessionId: string) => {
    let g = bySession.get(sessionId);
    if (!g) bySession.set(sessionId, (g = { files: [], tokens: emptyTokens(), cost: null }));
    return g;
  };

  const all = [...files];
  // fine dei subagenti notificata nei transcript della sessione (Claude o un subagente che ne lancia altri)
  const ends = new Map<string, TaskEnd>();
  for (const f of all) for (const [id, end] of f.state.taskEnds) ends.set(agentKey(f.parsed.sessionId, id), end);

  for (const f of all) {
    const p = f.parsed;
    const s = f.state;
    const g = group(p.sessionId);
    g.files.push(f);
    g.tokens = addTokens(g.tokens, s.tokens);
    // costo per file: la sessione e i suoi subagenti possono usare modelli diversi
    const cost = estimateCost(s.model ?? s.declaredModel, s.tokens);
    if (cost !== null) g.cost = (g.cost ?? 0) + cost;
    if (p.kind !== 'agent') continue;

    const meta = metas.get(agentKey(p.sessionId, p.agentId));
    const agentType = meta?.agentType || UNKNOWN_AGENT_TYPE;
    const description = meta?.description ?? '';
    const updatedAt = Math.max(s.lastAt ?? 0, f.mtime);
    const end = ends.get(agentKey(p.sessionId, p.agentId));
    const status = agentStatus(s, updatedAt, t, opts, end);
    agents.push({
      id: p.agentId,
      sessionId: p.sessionId,
      name: description || agentType,
      agentType,
      description,
      area: classifyArea({ agentType, description, filePaths: s.filePaths }),
      status,
      model: s.model,
      tokens: { ...s.tokens },
      progress: s.progress ? { ...s.progress } : null,
      issues: mergeIssues(extractIssues(description), s.issues),
      startedAt: s.firstAt ?? f.mtime,
      updatedAt,
      tool: status === 'done' ? null : s.tool,
      cost: estimateCost(s.model ?? s.declaredModel, s.tokens),
      effort: s.effort,
      // esito, errori e ripetizioni solo se ci sono: lo snapshot resta snello
      ...(status === 'done' ? { outcome: outcomeOf(s, end) } : {}),
      ...(s.toolErrors ? { toolErrors: { ...s.toolErrors } } : {}),
      ...(status !== 'done' && s.repeat ? { repeat: { ...s.repeat } } : {}),
      // domanda all'utente (AskUserQuestion, ExitPlanMode) del subagente ancora senza risposta
      ...(s.awaitingUser && !s.finished ? { waiting: true, waitingKind: s.awaitingKind, waitingSince: s.awaitingSince } : {}),
    });
  }

  let sessions: TranscriptSession[] = [];
  for (const [sessionId, g] of bySession) {
    const main = g.files.find((f) => f.parsed.kind === 'session');
    if (!main) continue;
    const s = main.state;
    let updatedAt = 0;
    for (const f of g.files) {
      updatedAt = Math.max(updatedAt, f.state.lastAt ?? 0, f.mtime);
    }
    sessions.push({
      id: sessionId,
      title: s.title,
      model: s.model,
      effort: s.effort,
      context: { used: s.contextUsed ?? 0, window: contextWindowFor(s.model, s.contextUsed ?? 0, s.declaredModel) },
      tokensUsed: g.tokens,
      startedAt: s.firstAt ?? main.mtime,
      updatedAt,
      active: t - updatedAt <= opts.activeWindowMs,
      status: agentStatus(s, Math.max(s.lastAt ?? 0, main.mtime), t, opts),
      issues: [...s.issues],
      cwd: s.cwd,
      branch: s.gitBranch,
      waiting: s.awaitingUser && !s.finished,
      waitingKind: s.awaitingUser && !s.finished ? s.awaitingKind : null,
      waitingSince: s.awaitingUser && !s.finished ? s.awaitingSince : null,
      tool: s.finished ? null : s.tool,
      cost: g.cost,
      // Claude stesso, senza i subagenti
      ownTokens: { ...s.tokens },
      ownCost: estimateCost(s.model ?? s.declaredModel, s.tokens),
      turnStartedAt: s.lastPromptAt,
      lastTurnMs: s.lastTurnMs,
      compactions: s.compactions,
      lastCompaction: s.lastCompaction && { ...s.lastCompaction },
      ...(s.toolErrors ? { toolErrors: { ...s.toolErrors } } : {}),
    });
  }

  if (opts.onlyActive) {
    const active = new Set(sessions.filter((x) => x.active).map((x) => x.id));
    sessions = sessions.filter((x) => active.has(x.id));
    agents = agents.filter((a) => active.has(a.sessionId));
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  agents.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  return { sessions, agents };
}

/**
 * Dimentica i meta.json dei subagenti senza un transcript seguito (sessioni finite, dimenticate o rimosse): senza
 * sfoltimento `metas` crescerebbe per tutta la vita del server. Un subagente visibile ha sempre il suo transcript.
 */
export function pruneMetas(metas: Map<string, AgentMeta>, files: Iterable<{ parsed: AggregateFile['parsed'] }>): void {
  const followed = new Set<string>();
  for (const { parsed: p } of files) if (p.kind === 'agent') followed.add(agentKey(p.sessionId, p.agentId));
  for (const key of metas.keys()) if (!followed.has(key)) metas.delete(key);
}
