import { describe, expect, it } from 'vitest';
import type { AgentState, AgentStatus, HookEvent, RepoState, SessionState } from '../../shared/types.js';
import { branchIssue, buildSnapshot, DONE_LINGER_MS, ENTERING_MS, IDLE_MS, LOUNGE_WAIT_MS } from './index.js';

const NOW = 1_000_000;
const zeroTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

function agent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 'a1',
    sessionId: 's1',
    name: 'agent',
    agentType: 'general-purpose',
    description: '',
    area: 'other',
    status: 'working',
    model: null,
    tokens: zeroTokens,
    progress: null,
    issues: [],
    startedAt: NOW - 20_000,
    updatedAt: NOW - 1_000,
    ...over,
  };
}

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 's1',
    title: null,
    model: null,
    effort: null,
    context: { used: 0, window: null },
    tokensUsed: zeroTokens,
    tokensLeft: null,
    startedAt: NOW - 100_000,
    updatedAt: NOW - 1_000,
    active: true,
    status: 'working',
    issues: [],
    cwd: null,
    branch: null,
    waiting: false,
    ...over,
  };
}

function repo(branch: string): RepoState {
  return { project: 'p', branch, linesAdded: 0, linesRemoved: 0, filesChanged: 0 };
}

function hook(event: string, timestamp: number, over: Partial<HookEvent> = {}): HookEvent {
  return { event, sessionId: 's1', agentId: 'a1', agentType: null, toolName: null, cwd: '/x', timestamp, ...over };
}

describe('costanti', () => {
  it('valori documentati', () => {
    expect({ ENTERING_MS, IDLE_MS, DONE_LINGER_MS }).toEqual({ ENTERING_MS: 5_000, IDLE_MS: 60_000, DONE_LINGER_MS: 30_000 });
  });
});

describe('buildSnapshot: stato agente', () => {
  const cases: Array<{ name: string; agent: Partial<AgentState>; hooks?: HookEvent[]; expected: AgentStatus | null }> = [
    // senza hook
    { name: 'transcript working, attività recente', agent: { status: 'working' }, expected: 'working' },
    { name: 'appena partito → entering', agent: { status: 'working', startedAt: NOW - 1_000 }, expected: 'entering' },
    { name: 'limite entering escluso', agent: { status: 'working', startedAt: NOW - ENTERING_MS }, expected: 'working' },
    { name: 'transcript entering scaduto → working', agent: { status: 'entering', startedAt: NOW - 10_000 }, expected: 'working' },
    { name: 'inattivo da > 60s → idle', agent: { status: 'working', updatedAt: NOW - IDLE_MS - 1 }, expected: 'idle' },
    { name: 'limite idle escluso', agent: { status: 'working', updatedAt: NOW - IDLE_MS }, expected: 'working' },
    { name: 'transcript idle con attività recente resta idle', agent: { status: 'idle' }, expected: 'idle' },
    { name: 'transcript done recente', agent: { status: 'done', updatedAt: NOW - 1_000 }, expected: 'done' },
    { name: 'transcript done appena partito resta done', agent: { status: 'done', startedAt: NOW - 1_000 }, expected: 'done' },
    { name: 'done vecchio > 30s → rimosso', agent: { status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 }, expected: null },
    { name: 'done al limite dei 30s resta', agent: { status: 'done', updatedAt: NOW - DONE_LINGER_MS }, expected: 'done' },
    // hook
    { name: 'SubagentStop → done', agent: { status: 'working' }, hooks: [hook('SubagentStop', NOW - 500)], expected: 'done' },
    { name: 'PreToolUse → working', agent: { status: 'idle' }, hooks: [hook('PreToolUse', NOW - 500)], expected: 'working' },
    { name: 'PostToolUse → working', agent: { status: 'entering', startedAt: NOW - 1_000 }, hooks: [hook('PostToolUse', NOW - 500)], expected: 'working' },
    { name: 'SubagentStart → entering', agent: { status: 'working' }, hooks: [hook('SubagentStart', NOW - 500)], expected: 'entering' },
    {
      name: 'vince l\'hook più recente (ordine di input irrilevante)',
      agent: { status: 'working' },
      hooks: [hook('SubagentStop', NOW - 200), hook('PreToolUse', NOW - 600)],
      expected: 'done',
    },
    {
      name: 'hook più vecchio di updatedAt ignorato',
      agent: { status: 'working', updatedAt: NOW - 1_000 },
      hooks: [hook('SubagentStop', NOW - 2_000)],
      expected: 'working',
    },
    {
      name: 'hook con timestamp uguale a updatedAt ignorato',
      agent: { status: 'working', updatedAt: NOW - 1_000 },
      hooks: [hook('SubagentStop', NOW - 1_000)],
      expected: 'working',
    },
    { name: 'hook di altro agente ignorato', agent: { status: 'working' }, hooks: [hook('SubagentStop', NOW - 500, { agentId: 'a2' })], expected: 'working' },
    { name: 'hook con agentId null ignorato', agent: { status: 'working' }, hooks: [hook('SubagentStop', NOW - 500, { agentId: null })], expected: 'working' },
    { name: 'evento non mappato ignorato', agent: { status: 'working' }, hooks: [hook('Notification', NOW - 500)], expected: 'working' },
    {
      name: 'evento non mappato più recente non nasconde quello mappato',
      agent: { status: 'working' },
      hooks: [hook('SubagentStop', NOW - 600), hook('Notification', NOW - 100)],
      expected: 'done',
    },
    {
      name: 'SubagentStop vecchio > 30s → rimosso',
      agent: { status: 'working', updatedAt: NOW - 50_000 },
      hooks: [hook('SubagentStop', NOW - DONE_LINGER_MS - 1)],
      expected: null,
    },
    {
      name: 'SubagentStop recente su transcript vecchio → done (linger dal timestamp hook)',
      agent: { status: 'working', updatedAt: NOW - 120_000 },
      hooks: [hook('SubagentStop', NOW - 1_000)],
      expected: 'done',
    },
    {
      name: 'PreToolUse senza seguito da > 60s → idle',
      agent: { status: 'working', updatedAt: NOW - 120_000 },
      hooks: [hook('PreToolUse', NOW - IDLE_MS - 1)],
      expected: 'idle',
    },
  ];

  it.each(cases)('$name', ({ agent: over, hooks = [], expected }) => {
    const snap = buildSnapshot({ transcript: { sessions: [], agents: [agent(over)] }, hookEvents: hooks, repo: null, now: NOW });
    expect(snap.agents[0]?.status ?? null).toBe(expected);
    expect(snap.agents).toHaveLength(expected === null ? 0 : 1);
  });

  it('updatedAt avanza al timestamp dell\'hook applicato', () => {
    const snap = buildSnapshot({
      transcript: { sessions: [], agents: [agent({ updatedAt: NOW - 5_000 })] },
      hookEvents: [hook('PostToolUse', NOW - 100)],
      repo: null,
      now: NOW,
    });
    expect(snap.agents[0]?.updatedAt).toBe(NOW - 100);
  });

  it('hook per agenti assenti dal transcript non creano agenti', () => {
    const snap = buildSnapshot({
      transcript: { sessions: [], agents: [] },
      hookEvents: [hook('SubagentStart', NOW - 100, { agentId: 'ghost' })],
      repo: null,
      now: NOW,
    });
    expect(snap.agents).toEqual([]);
  });

  it('preserva l\'ordine e gli altri campi degli agenti', () => {
    const a = agent({ id: 'a1', name: 'uno' });
    const b = agent({ id: 'a2', name: 'due' });
    const snap = buildSnapshot({ transcript: { sessions: [], agents: [a, b] }, hookEvents: [], repo: null, now: NOW });
    expect(snap.agents).toEqual([a, b]);
  });
});

describe('buildSnapshot: sessioni', () => {
  const cases: Array<{ name: string; sessions: Partial<SessionState>[]; hooks?: HookEvent[]; expected: Array<[string, boolean]> }> = [
    {
      name: 'attive prima, poi updatedAt desc',
      sessions: [
        { id: 'old-inactive', active: false, updatedAt: NOW - 1_000 },
        { id: 'active-old', active: true, updatedAt: NOW - 50_000 },
        { id: 'active-new', active: true, updatedAt: NOW - 10 },
        { id: 'very-old-inactive', active: false, updatedAt: NOW - 900_000 },
      ],
      expected: [
        ['active-new', true],
        ['active-old', true],
        ['old-inactive', false],
        ['very-old-inactive', false],
      ],
    },
    {
      name: 'SessionEnd successivo a updatedAt → non attiva',
      sessions: [{ id: 's1', updatedAt: NOW - 1_000 }],
      hooks: [hook('SessionEnd', NOW - 500, { agentId: null })],
      expected: [['s1', false]],
    },
    {
      name: 'Stop non disattiva la sessione',
      sessions: [{ id: 's1', updatedAt: NOW - 1_000 }],
      hooks: [hook('Stop', NOW - 500, { agentId: null })],
      expected: [['s1', true]],
    },
    {
      name: 'SessionEnd precedente a updatedAt (sessione ripresa) ignorato',
      sessions: [{ id: 's1', updatedAt: NOW - 1_000 }],
      hooks: [hook('SessionEnd', NOW - 5_000, { agentId: null })],
      expected: [['s1', true]],
    },
    {
      name: 'SessionEnd di altra sessione ignorato; la sessione chiusa scende in fondo',
      sessions: [
        { id: 's1', updatedAt: NOW - 1_000 },
        { id: 's2', updatedAt: NOW - 2_000 },
      ],
      hooks: [hook('SessionEnd', NOW - 500, { sessionId: 's1', agentId: null })],
      expected: [
        ['s2', true],
        ['s1', false],
      ],
    },
  ];

  it.each(cases)('$name', ({ sessions, hooks = [], expected }) => {
    const snap = buildSnapshot({
      transcript: { sessions: sessions.map((s) => session(s)), agents: [] },
      hookEvents: hooks,
      repo: null,
      now: NOW,
    });
    expect(snap.sessions.map((s) => [s.id, s.active])).toEqual(expected);
  });
});

describe('buildSnapshot: snapshot', () => {
  it('include repo e generatedAt, non muta l\'input', () => {
    const repo: RepoState = { project: 'p', branch: 'main', linesAdded: 1, linesRemoved: 2, filesChanged: 3 };
    const transcript = { sessions: [session()], agents: [agent({ status: 'working' })] };
    const frozen = structuredClone(transcript);
    const snap = buildSnapshot({ transcript, hookEvents: [hook('SubagentStop', NOW - 100), hook('SessionEnd', NOW - 100)], repo, now: NOW });
    expect(snap.repo).toBe(repo);
    expect(snap.generatedAt).toBe(NOW);
    expect(transcript).toEqual(frozen);
  });

  it('input vuoto', () => {
    expect(buildSnapshot({ transcript: { sessions: [], agents: [] }, hookEvents: [], repo: null, now: NOW })).toEqual({
      status: 'idle',
      repo: null,
      sessions: [],
      agents: [],
      generatedAt: NOW,
    });
  });
});

describe('buildSnapshot: area relax', () => {
  const build = (agents: AgentState[]) =>
    buildSnapshot({ transcript: { sessions: [], agents }, hookEvents: [], repo: null, now: NOW }).agents.map((a) => a.id);

  it('chi ha finito resta (in area relax) finché un altro agente lavora', () => {
    const old = agent({ id: 'old', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 60_000 });
    expect(build([old, agent({ id: 'busy' })])).toEqual(['old', 'busy']);
  });

  it('quando hanno finito tutti escono insieme: restano DONE_LINGER_MS dopo l\'ultimo', () => {
    const first = agent({ id: 'first', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 60_000 });
    expect(build([first, agent({ id: 'last', status: 'done', updatedAt: NOW - 1_000 })])).toEqual(['first', 'last']);
    expect(build([first, agent({ id: 'last', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 })])).toEqual([]);
  });

  it('un agente fermo da più di LOUNGE_WAIT_MS non trattiene gli altri', () => {
    const stale = agent({ id: 'stale', status: 'idle', updatedAt: NOW - LOUNGE_WAIT_MS - 1 });
    const done = agent({ id: 'done', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 });
    expect(build([stale, done])).toEqual(['stale']);
  });
});

describe('buildSnapshot: sessione principale (Claudio Code)', () => {
  const build = (over: Partial<SessionState>, hookEvents: HookEvent[] = [], branch: string | null = null) =>
    buildSnapshot({
      transcript: { sessions: [session(over)], agents: [] },
      hookEvents,
      repo: branch === null ? null : repo(branch),
      now: NOW,
    }).sessions[0]!;

  it('stato dagli hook senza agentId più recenti del transcript', () => {
    expect(build({ status: 'done' }, [hook('UserPromptSubmit', NOW - 100, { agentId: null })]).status).toBe('working');
    expect(build({ status: 'working' }, [hook('Stop', NOW - 100, { agentId: null })]).status).toBe('done');
    expect(build({ status: 'working' }, [hook('Stop', NOW - 100)]).status).toBe('working');
    expect(build({ status: 'working', updatedAt: NOW - 50 }, [hook('Stop', NOW - 100, { agentId: null })]).status).toBe('working');
    expect(build({ status: 'working' }, [hook('SessionEnd', NOW - 100, { agentId: null })]).status).toBe('done');
  });

  it('issue dal prompt, altrimenti dal branch', () => {
    expect(build({ issues: [14] }, [], 'fix/21-foo').issues).toEqual([14]);
    expect(build({ issues: [] }, [], 'fix/21-foo').issues).toEqual([21]);
    expect(build({ issues: [] }, [], 'main').issues).toEqual([]);
  });

  it.each([
    ['fix/21-foo', 21],
    ['feat/issue-7', 7],
    ['42-bar', 42],
    ['feat/arredamento-relax', null],
    [null, null],
  ])('branchIssue(%s) = %s', (branch, expected) => {
    expect(branchIssue(branch)).toBe(expected);
  });
});

describe('buildSnapshot: sessione bloccata e stato per l\'icona', () => {
  const notif = (t: number, notification: 'input' | 'idle') => hook('Notification', t, { agentId: null, notification });
  const build = (sessions: SessionState[], hookEvents: HookEvent[] = [], agents: AgentState[] = []) =>
    buildSnapshot({ transcript: { sessions, agents }, hookEvents, repo: null, now: NOW });

  it('notifica di permesso senza attività successiva → waiting; quella di attesa prompt no', () => {
    expect(build([session()], [notif(NOW - 500, 'input')]).sessions[0]!.waiting).toBe(true);
    expect(build([session()], [notif(NOW - 500, 'idle')]).sessions[0]!.waiting).toBe(false);
    expect(build([session()], [notif(NOW - 500, 'input'), hook('PostToolUse', NOW - 100, { agentId: null })]).sessions[0]!.waiting).toBe(false);
    // il transcript è andato avanti dopo la notifica
    expect(build([session({ updatedAt: NOW - 100 })], [notif(NOW - 60_000, 'input')]).sessions[0]!.waiting).toBe(false);
    expect(build([session({ waiting: true })]).sessions[0]!.waiting).toBe(true);
  });

  it('status: waiting > working > idle, solo sessioni attive', () => {
    expect(build([]).status).toBe('idle');
    expect(build([session({ status: 'working' })]).status).toBe('working');
    expect(build([session({ status: 'done' })], [], [agent({ status: 'working' })]).status).toBe('working');
    expect(build([session({ status: 'done' })]).status).toBe('idle');
    expect(build([session({ status: 'working', waiting: true })]).status).toBe('waiting');
    expect(build([session({ status: 'working', waiting: true, active: false })]).status).toBe('idle');
  });

  it('area relax per sessione: i terminati di una sessione non aspettano gli agenti di un\'altra', () => {
    const done = agent({ id: 'd', sessionId: 's2', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 });
    expect(build([], [], [done, agent({ id: 'w', sessionId: 's1' })]).agents.map((a) => a.id)).toEqual(['w']);
  });
});
