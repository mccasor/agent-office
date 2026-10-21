import type {
  AgentState,
  AgentStatus,
  HookEvent,
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

const HOOK_STATUS: Readonly<Record<string, AgentStatus>> = {
  SubagentStart: 'entering',
  PreToolUse: 'working',
  PostToolUse: 'working',
  SubagentStop: 'done',
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

function resolveSessions(sessions: SessionState[], events: HookEvent[]): SessionState[] {
  const endedAt = new Map<string, number>();
  for (const e of events) {
    if (e.event !== 'SessionEnd') continue;
    endedAt.set(e.sessionId, Math.max(endedAt.get(e.sessionId) ?? -Infinity, e.timestamp));
  }
  return sessions
    .map((s) => {
      const end = endedAt.get(s.id);
      return s.active && end !== undefined && end > s.updatedAt ? { ...s, active: false } : s;
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
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
  const agents = transcript.agents
    .map((a) => resolveAgent(a, hooks.get(a.id), now))
    .filter((a) => !(a.status === 'done' && now - a.updatedAt > DONE_LINGER_MS));
  return { repo, sessions: resolveSessions(transcript.sessions, hookEvents), agents, generatedAt: now };
}
