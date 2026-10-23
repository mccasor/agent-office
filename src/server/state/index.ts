import type {
  AgentAlert,
  AgentState,
  AgentStatus,
  HookEvent,
  OfficeStatus,
  RepoState,
  SessionState,
  Snapshot,
  TranscriptSession,
  TranscriptSnapshot,
  WaitingKind,
} from '../../shared/types.js';
import { nicknameOf } from '../../shared/nickname.js';

/** un agente è "entering" (cammina dalla porta) nei primi ms dopo startedAt */
export const ENTERING_MS = 5_000;
/** senza attività da più di questi ms un agente diventa "idle" */
export const IDLE_MS = 60_000;
/** un agente "done" resta visibile (animazione d'uscita) per questi ms, poi sparisce */
export const DONE_LINGER_MS = 30_000;
/** chi ha finito aspetta in area relax solo gli agenti non terminati attivi negli ultimi N ms (gli abbandonati no) */
export const LOUNGE_WAIT_MS = 10 * 60_000;
/** una notifica di permesso conta se arriva al più N ms prima dell'ultima riga del transcript (il tool_use la precede) */
const ASK_GRACE_MS = 5_000;

const HOOK_STATUS: Readonly<Record<string, AgentStatus>> = {
  SubagentStart: 'entering',
  PreToolUse: 'working',
  PostToolUse: 'working',
  SubagentStop: 'done',
};

/** stato della sessione principale dagli hook senza agentId */
const MAIN_HOOK_STATUS: Readonly<Record<string, AgentStatus>> = {
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  Stop: 'done',
};

/** evento mappabile più recente per agentId (gli eventi con agentId null non riguardano subagenti) */
function latestAgentHooks(events: HookEvent[]): Map<string, HookEvent> {
  const latest = new Map<string, HookEvent>();
  for (const e of events) {
    if (e.agentId === null || !(e.event in HOOK_STATUS)) continue;
    const prev = latest.get(e.agentId);
    if (!prev || e.timestamp > prev.timestamp) latest.set(e.agentId, e);
  }
  return latest;
}

function resolveAgent(agent: AgentState, hook: HookEvent | undefined, now: number): AgentState {
  if (hook && hook.timestamp > agent.updatedAt) {
    const status = HOOK_STATUS[hook.event] ?? agent.status;
    const updatedAt = hook.timestamp;
    const idle = status !== 'done' && now - updatedAt > IDLE_MS;
    return { ...agent, status: idle ? 'idle' : status, updatedAt };
  }
  let status = agent.status;
  if (status !== 'done') {
    if (now - agent.startedAt < ENTERING_MS) status = 'entering';
    else if (now - agent.updatedAt > IDLE_MS) status = 'idle';
    else if (status === 'entering') status = 'working';
  }
  return status === agent.status ? agent : { ...agent, status };
}

/** numero di issue nel branch: "fix/21-foo", "feat/issue-7", "42-bar" */
export function branchIssue(branch: string | null): number | null {
  const m = branch ? /(?:^|\/)(?:[a-z]+-)?(\d{1,6})(?:[-_]|$)/i.exec(branch) : null;
  return m ? Number(m[1]) : null;
}

interface Ask {
  at: number;
  kind: WaitingKind;
}

/** tool con cui Claude aspetta un subagente, non l'utente */
const AGENT_TOOLS = new Set(['Agent', 'Task']);

/**
 * Notifiche di blocco (permesso, domanda, input) e ultima attività successiva, per sessione e per subagente.
 * Chi è bloccato: l'agentId dell'hook se c'è; per un permesso senza agentId, chi ha l'unica richiesta di permesso
 * aperta (PermissionRequest), altrimenti l'unico con un tool avviato e senza risultato (PreToolUse precede la
 * richiesta di permesso). Se è ambiguo, o tocca a Claude, il blocco resta della sessione.
 */
function collectAsks(events: HookEvent[]) {
  const session = new Map<string, Ask>();
  const sessionActive = new Map<string, number>();
  const agent = new Map<string, Ask>();
  const agentActive = new Map<string, number>();
  /** per sessione: ultimo evento di ciascuno ("" = Claude) e chi ha una richiesta di permesso aperta */
  const last = new Map<string, Map<string, HookEvent>>();
  const permissions = new Map<string, Set<string>>();
  const later = (m: Map<string, number>, id: string, t: number) => m.set(id, Math.max(m.get(id) ?? -Infinity, t));
  const ask = (m: Map<string, Ask>, id: string, a: Ask) => {
    if (a.at >= (m.get(id)?.at ?? -Infinity)) m.set(id, a);
  };
  const owner = (e: HookEvent, kind: WaitingKind): string | null => {
    if (e.agentId !== null) return e.agentId;
    if (kind !== 'permission') return null;
    const asking = [...(permissions.get(e.sessionId) ?? [])];
    if (asking.length === 1) return asking[0] || null;
    const open = [...(last.get(e.sessionId) ?? [])].filter(([, x]) => x.event === 'PreToolUse');
    if (open.some(([who, x]) => who === '' && !AGENT_TOOLS.has(x.toolName ?? ''))) return null;
    const agents = open.filter(([who]) => who !== '');
    return agents.length === 1 ? agents[0]![0] : null;
  };
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (e.event === 'Notification') {
      if (e.notification === 'idle') continue;
      const a = { at: e.timestamp, kind: e.notification ?? 'input' };
      const id = owner(e, a.kind);
      ask(id === null ? session : agent, id ?? e.sessionId, a);
      continue;
    }
    later(sessionActive, e.sessionId, e.timestamp);
    if (e.agentId !== null) later(agentActive, e.agentId, e.timestamp);
    const who = e.agentId ?? '';
    const pending = permissions.get(e.sessionId) ?? new Set<string>();
    const byOwner = last.get(e.sessionId) ?? new Map<string, HookEvent>();
    permissions.set(e.sessionId, pending);
    last.set(e.sessionId, byOwner);
    if (e.event === 'PermissionRequest') {
      pending.add(who);
      continue;
    }
    pending.delete(who);
    if (e.event === 'SubagentStop') byOwner.delete(who);
    else byOwner.set(who, e);
  }
  return { session, sessionActive, agent, agentActive };
}

type Asks = ReturnType<typeof collectAsks>;

/** bloccato: notifica senza attività successiva e vicina all'ultima riga del transcript (il tool_use la precede) */
const blockedBy = (a: Ask | undefined, activeAt: number | undefined, updatedAt: number): a is Ask =>
  a !== undefined && a.at > (activeAt ?? -Infinity) && a.at >= updatedAt - ASK_GRACE_MS;

/** Attesa di un subagente: domanda senza risposta nel suo transcript, altrimenti notifica dell'hook attribuita a lui. */
function resolveAgentWaiting(agent: AgentState, asks: Asks): AgentState {
  const asked = asks.agent.get(agent.id);
  const blocked = blockedBy(asked, asks.agentActive.get(agent.id), agent.updatedAt);
  const waiting = agent.status !== 'done' && (agent.waiting === true || blocked);
  if (!waiting && !agent.waiting) return agent;
  const waitingKind = !waiting ? null : agent.waiting ? (agent.waitingKind ?? 'input') : (asked?.kind ?? 'input');
  const waitingSince = !waiting ? null : agent.waiting ? (agent.waitingSince ?? null) : (asked?.at ?? null);
  return { ...agent, waiting, waitingKind, waitingSince };
}

/** subagente della sessione in attesa da più tempo */
function firstWaiting(agents: AgentState[], sessionId: string): AgentState | undefined {
  const since = (a: AgentState) => a.waitingSince ?? Infinity;
  return agents.filter((a) => a.sessionId === sessionId && a.waiting).sort((a, b) => since(a) - since(b))[0];
}

function resolveSessions(
  sessions: TranscriptSession[],
  events: HookEvent[],
  asks: Asks,
  agents: AgentState[],
  repoAt: ((cwd: string) => RepoState | null) | undefined,
  now: number,
): TranscriptSession[] {
  const endedAt = new Map<string, number>();
  const mainHook = new Map<string, HookEvent>();
  /** ultimo prompt per sessione dall'hook (solo l'orario): arriva prima della riga nel transcript */
  const promptAt = new Map<string, number>();
  for (const e of events) {
    if (e.event === 'UserPromptSubmit') promptAt.set(e.sessionId, Math.max(promptAt.get(e.sessionId) ?? -Infinity, e.timestamp));
    if (e.event === 'SessionEnd') endedAt.set(e.sessionId, Math.max(endedAt.get(e.sessionId) ?? -Infinity, e.timestamp));
    if (e.agentId !== null || !(e.event in MAIN_HOOK_STATUS)) continue;
    const prev = mainHook.get(e.sessionId);
    if (!prev || e.timestamp > prev.timestamp) mainHook.set(e.sessionId, e);
  }
  return sessions
    .map((s) => {
      const end = endedAt.get(s.id);
      const ended = s.active && end !== undefined && end > s.updatedAt;
      const hook = mainHook.get(s.id);
      const status = ended ? 'done' : hook && hook.timestamp > s.updatedAt ? hookMainStatus(hook, now) : s.status;
      // stato git della cartella della sessione: branch di riserva per la issue e diff (solo se attiva)
      const r = s.cwd && repoAt ? repoAt(s.cwd) : null;
      const fromBranch = branchIssue(s.branch ?? r?.branch ?? null);
      const issues = s.issues.length > 0 || fromBranch === null ? s.issues : [fromBranch];
      // Claude bloccato: domanda senza risposta nel transcript, o notifica non attribuita a un subagente
      const asked = asks.session.get(s.id);
      const blocked = blockedBy(asked, asks.sessionActive.get(s.id), s.updatedAt);
      // altrimenti la sessione è bloccata dal suo subagente in attesa da più tempo, con il motivo di lui
      const agent = ended || s.waiting || blocked ? undefined : firstWaiting(agents, s.id);
      const waiting = !ended && (s.waiting || blocked || agent !== undefined);
      // motivo e inizio del blocco: la domanda nel transcript, poi la notifica dell'hook, poi il subagente
      const waitingKind = !waiting ? null : s.waiting ? (s.waitingKind ?? 'input') : blocked ? asked.kind : (agent?.waitingKind ?? 'input');
      const waitingSince = !waiting ? null : s.waiting ? (s.waitingSince ?? null) : blocked ? asked.at : (agent?.waitingSince ?? null);
      const waitingAgentId = agent?.id ?? null;
      const active = ended ? false : s.active;
      const diff = active && r ? { linesAdded: r.linesAdded, linesRemoved: r.linesRemoved, filesChanged: r.filesChanged } : null;
      const prompted = Math.max(s.turnStartedAt ?? -Infinity, promptAt.get(s.id) ?? -Infinity);
      const turnStartedAt = Number.isFinite(prompted) ? prompted : null;
      return { ...s, status, issues, waiting, waitingKind, waitingSince, waitingAgentId, active, diff, turnStartedAt };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
}

function hookMainStatus(hook: HookEvent, now: number): AgentStatus {
  const status = MAIN_HOOK_STATUS[hook.event] ?? 'working';
  return status !== 'done' && now - hook.timestamp > IDLE_MS ? 'idle' : status;
}

/**
 * Chi ha finito aspetta in area relax finché c'è un agente della stessa sessione non terminato e attivo di recente;
 * quando hanno finito tutti, restano per DONE_LINGER_MS dall'ultimo che ha finito (uscita) e poi spariscono.
 * Aspettano solo i terminati dello stesso "turno": quelli ancora in ufficio quando è entrato uno degli agenti al
 * lavoro (a catena), non quelli usciti in precedenza, che altrimenti tornerebbero a ogni nuovo agente.
 */
function keepFinished(agents: AgentState[], now: number): AgentState[] {
  const keep = new Set<string>();
  for (const sessionId of new Set(agents.map((a) => a.sessionId))) {
    const group = agents.filter((a) => a.sessionId === sessionId);
    const done = group.filter((a) => a.status === 'done');
    let seeds = group.filter((a) => a.status !== 'done' && now - a.updatedAt <= LOUNGE_WAIT_MS);
    if (seeds.length === 0) {
      const last = done.reduce<AgentState | null>((m, a) => (!m || a.updatedAt > m.updatedAt ? a : m), null);
      if (!last || now - last.updatedAt > DONE_LINGER_MS) continue;
      seeds = [last];
    }
    // inizio del turno: si allarga a ritroso con chi era ancora in ufficio (finito da meno di DONE_LINGER_MS)
    let from = Math.min(...seeds.map((a) => a.startedAt));
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of done) {
        if (keep.has(a.id) || a.updatedAt < from - DONE_LINGER_MS) continue;
        keep.add(a.id);
        from = Math.min(from, a.startedAt);
        grew = true;
      }
    }
  }
  return agents.filter((a) => a.status !== 'done' || keep.has(a.id));
}

/** soglie degli avvisi sugli agenti (config.json): fermo da troppo tempo, stesso tool ripetuto */
export interface AlertOptions {
  staleMs: number;
  loopRepeats: number;
}

export const DEFAULT_ALERTS: AlertOptions = { staleMs: 60 * 60_000, loopRepeats: 5 };

/**
 * Esito e avviso di un subagente risolto: l'esito solo se ha finito (ok se il transcript non dice altro, es. fine
 * vista dall'hook SubagentStop); l'avviso solo se non ha finito e non aspetta l'utente (ha già il suo fumetto).
 * "Fermo" prevale su "in loop": un agente che ripeteva un tool e poi si è fermato è soprattutto fermo.
 */
export function withAlert(agent: AgentState, now: number, opts: AlertOptions): AgentState {
  if (agent.status === 'done') {
    // la ripetizione conta solo per chi lavora
    const { repeat: _repeat, alert: _alert, ...rest } = agent;
    return { ...rest, outcome: agent.outcome ?? 'ok' };
  }
  const { outcome: _outcome, alert: _alert, ...rest } = agent;
  let alert: AgentAlert | null = null;
  if (!agent.waiting) {
    if (now - agent.updatedAt >= opts.staleMs) alert = { kind: 'stale', since: agent.updatedAt };
    else if (agent.repeat && agent.repeat.count >= opts.loopRepeats) alert = { kind: 'loop', tool: agent.repeat.tool, count: agent.repeat.count };
  }
  return alert ? { ...rest, alert } : rest;
}

/** quanti agenti terminati oggi restano nello snapshot al massimo */
export const MAX_FINISHED = 50;

/** Agenti terminati da oggi (ora locale) e già usciti dall'ufficio, dal più recente: la cronologia della giornata. */
function finishedToday(all: AgentState[], present: AgentState[], now: number): AgentState[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const inOffice = new Set(present.map((a) => a.id));
  return all
    .filter((a) => a.status === 'done' && !inOffice.has(a.id) && a.updatedAt >= midnight.getTime())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_FINISHED);
}

/** Nome del progetto: ultima cartella del cwd; null senza cwd. */
export const projectOf = (cwd: string | null): string | null => cwd?.split('/').filter(Boolean).at(-1) ?? null;

const busy = (st: AgentStatus) => st === 'working' || st === 'entering';

/** Pallino di una sessione: attiva e bloccata sull'utente > lei o un suo agente lavora > inattiva. */
export function sessionDot(session: TranscriptSession, agents: AgentState[]): OfficeStatus {
  if (!session.active) return 'idle';
  if (session.waiting) return 'waiting';
  return busy(session.status) || agents.some((a) => a.sessionId === session.id && busy(a.status)) ? 'working' : 'idle';
}

/** Stato per l'icona: il pallino più urgente tra le sessioni (waiting > working > idle). */
export function officeStatus(sessions: SessionState[]): OfficeStatus {
  if (sessions.some((s) => s.dot === 'waiting')) return 'waiting';
  return sessions.some((s) => s.dot === 'working') ? 'working' : 'idle';
}

/** Funzione pura: combina transcript + eventi hook + git nello Snapshot inviato al browser. */
export function buildSnapshot(input: {
  transcript: TranscriptSnapshot;
  hookEvents: HookEvent[];
  /** stato del repository di un cwd (diff per sessione, branch di riserva); assente = nessun dato git */
  repoAt?: (cwd: string) => RepoState | null;
  /** soglie degli avvisi; assenti = default */
  alerts?: AlertOptions;
  now: number;
}): Snapshot {
  const { transcript, hookEvents, now } = input;
  const hooks = latestAgentHooks(hookEvents);
  const asks = collectAsks(hookEvents);
  const resolved = transcript.agents.map((a) => ({
    ...withAlert(resolveAgentWaiting(resolveAgent(a, hooks.get(a.id), now), asks), now, input.alerts ?? DEFAULT_ALERTS),
    nickname: nicknameOf(a.id),
  }));
  const agents = keepFinished(resolved, now);
  // attesa su due livelli: la sessione eredita quella dei subagenti (pallino rosso, status 'waiting', menu bar)
  const sessions = resolveSessions(transcript.sessions, hookEvents, asks, agents, input.repoAt, now).map(
    (s): SessionState => ({ ...s, dot: sessionDot(s, agents), project: projectOf(s.cwd) }),
  );
  return { status: officeStatus(sessions), sessions, agents, finished: finishedToday(resolved, agents, now), generatedAt: now };
}
