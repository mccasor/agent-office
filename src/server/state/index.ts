import type {
  AgentState,
  AgentStatus,
  HookEvent,
  OfficeStatus,
  RepoState,
  SessionState,
  Snapshot,
  TranscriptSnapshot,
} from '../../shared/types.js';

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

function resolveSessions(sessions: SessionState[], events: HookEvent[], repo: RepoState | null, now: number): SessionState[] {
  const endedAt = new Map<string, number>();
  const mainHook = new Map<string, HookEvent>();
  /** ultima notifica "bloccato su input" e ultima attività successiva, per sessione */
  const askedAt = new Map<string, number>();
  const activeAt = new Map<string, number>();
  const later = (m: Map<string, number>, id: string, t: number) => m.set(id, Math.max(m.get(id) ?? -Infinity, t));
  for (const e of events) {
    if (e.event === 'SessionEnd') endedAt.set(e.sessionId, Math.max(endedAt.get(e.sessionId) ?? -Infinity, e.timestamp));
    if (e.event === 'Notification') {
      if (e.notification !== 'idle') later(askedAt, e.sessionId, e.timestamp);
    } else later(activeAt, e.sessionId, e.timestamp);
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
      const fromBranch = branchIssue(s.branch ?? repo?.branch ?? null);
      const issues = s.issues.length > 0 || fromBranch === null ? s.issues : [fromBranch];
      // bloccata: domanda senza risposta nel transcript, o notifica di permesso/input senza attività successiva
      const asked = askedAt.get(s.id) ?? -Infinity;
      const blocked = asked > (activeAt.get(s.id) ?? -Infinity) && asked >= s.updatedAt - ASK_GRACE_MS;
      const waiting = !ended && (s.waiting || blocked);
      return { ...s, status, issues, waiting, active: ended ? false : s.active };
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
 */
function keepFinished(agents: AgentState[], now: number): AgentState[] {
  const drop = new Set<string>();
  for (const sessionId of new Set(agents.map((a) => a.sessionId))) {
    const group = agents.filter((a) => a.sessionId === sessionId);
    if (group.some((a) => a.status !== 'done' && now - a.updatedAt <= LOUNGE_WAIT_MS)) continue;
    const lastDone = Math.max(-Infinity, ...group.filter((a) => a.status === 'done').map((a) => a.updatedAt));
    if (now - lastDone > DONE_LINGER_MS) drop.add(sessionId);
  }
  return drop.size === 0 ? agents : agents.filter((a) => a.status !== 'done' || !drop.has(a.sessionId));
}

/** Stato per l'icona: una sessione attiva bloccata sull'utente > qualcuno lavora > nessuna attività. */
export function officeStatus(sessions: SessionState[], agents: AgentState[]): OfficeStatus {
  const active = sessions.filter((s) => s.active);
  if (active.some((s) => s.waiting)) return 'waiting';
  const busy = (st: AgentStatus) => st === 'working' || st === 'entering';
  const ids = new Set(active.map((s) => s.id));
  if (active.some((s) => busy(s.status)) || agents.some((a) => ids.has(a.sessionId) && busy(a.status))) return 'working';
  return 'idle';
}

/** Funzione pura: combina transcript + eventi hook + git nello Snapshot inviato al browser. */
export function buildSnapshot(input: {
  transcript: TranscriptSnapshot;
  hookEvents: HookEvent[];
  repo: RepoState | null;
  now: number;
}): Snapshot {
  const { transcript, hookEvents, repo, now } = input;
  const hooks = latestAgentHooks(hookEvents);
  const agents = keepFinished(transcript.agents.map((a) => resolveAgent(a, hooks.get(a.id), now)), now);
  const sessions = resolveSessions(transcript.sessions, hookEvents, repo, now);
  return { status: officeStatus(sessions, agents), repo, sessions, agents, generatedAt: now };
}
