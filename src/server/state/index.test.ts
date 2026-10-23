import { describe, expect, it } from 'vitest';
import type { AgentState, AgentStatus, HookEvent, RepoState, TranscriptSession } from '../../shared/types.js';
import { nicknameOf } from '../../shared/nickname.js';
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

function session(over: Partial<TranscriptSession> = {}): TranscriptSession {
  return {
    id: 's1',
    title: null,
    model: null,
    effort: null,
    context: { used: 0, window: null },
    tokensUsed: zeroTokens,
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
    const snap = buildSnapshot({ transcript: { sessions: [], agents: [agent(over)] }, hookEvents: hooks, now: NOW });
    expect(snap.agents[0]?.status ?? null).toBe(expected);
    expect(snap.agents).toHaveLength(expected === null ? 0 : 1);
  });

  it('updatedAt avanza al timestamp dell\'hook applicato', () => {
    const snap = buildSnapshot({
      transcript: { sessions: [], agents: [agent({ updatedAt: NOW - 5_000 })] },
      hookEvents: [hook('PostToolUse', NOW - 100)],
      now: NOW,
    });
    expect(snap.agents[0]?.updatedAt).toBe(NOW - 100);
  });

  it('hook per agenti assenti dal transcript non creano agenti', () => {
    const snap = buildSnapshot({
      transcript: { sessions: [], agents: [] },
      hookEvents: [hook('SubagentStart', NOW - 100, { agentId: 'ghost' })],
      now: NOW,
    });
    expect(snap.agents).toEqual([]);
  });

  it('preserva l\'ordine e gli altri campi degli agenti', () => {
    const a = agent({ id: 'a1', name: 'uno' });
    const b = agent({ id: 'a2', name: 'due' });
    const snap = buildSnapshot({ transcript: { sessions: [], agents: [a, b] }, hookEvents: [], now: NOW });
    expect(snap.agents).toEqual([{ ...a, nickname: nicknameOf('a1') }, { ...b, nickname: nicknameOf('a2') }]);
  });

  it('ogni agente ha un nome di persona stabile (#88)', () => {
    const build = () => buildSnapshot({ transcript: { sessions: [], agents: [agent({ id: 'a1' })] }, hookEvents: [], now: NOW });
    expect(build().agents[0]?.nickname).toMatch(/^\S+ \S+$/);
    expect(build().agents[0]?.nickname).toBe(build().agents[0]?.nickname);
  });
});

describe('buildSnapshot: sessioni', () => {
  const cases: Array<{ name: string; sessions: Partial<TranscriptSession>[]; hooks?: HookEvent[]; expected: Array<[string, boolean]> }> = [
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
      now: NOW,
    });
    expect(snap.sessions.map((s) => [s.id, s.active])).toEqual(expected);
  });
});

describe('buildSnapshot: snapshot', () => {
  it('include generatedAt, non muta l\'input', () => {
    const transcript = { sessions: [session()], agents: [agent({ status: 'working' })] };
    const frozen = structuredClone(transcript);
    const snap = buildSnapshot({ transcript, hookEvents: [hook('SubagentStop', NOW - 100), hook('SessionEnd', NOW - 100)], now: NOW });
    expect(snap.generatedAt).toBe(NOW);
    expect(transcript).toEqual(frozen);
  });

  it('diff per sessione dalla sua cartella, solo per le sessioni attive', () => {
    const at = (cwd: string) => (cwd === '/p' ? { ...repo('main'), linesAdded: 4 } : null);
    const build = (over: Partial<TranscriptSession>) =>
      buildSnapshot({ transcript: { sessions: [session(over)], agents: [] }, hookEvents: [], repoAt: at, now: NOW }).sessions[0]!;
    expect(build({ cwd: '/p' }).diff).toEqual({ linesAdded: 4, linesRemoved: 0, filesChanged: 0 });
    expect(build({ cwd: '/altro' }).diff).toBeNull();
    expect(build({ cwd: '/p', active: false }).diff).toBeNull();
  });

  it('input vuoto', () => {
    expect(buildSnapshot({ transcript: { sessions: [], agents: [] }, hookEvents: [], now: NOW })).toEqual({
      status: 'idle',
      sessions: [],
      agents: [],
      finished: [],
      generatedAt: NOW,
    });
  });
});

describe('buildSnapshot: area relax', () => {
  const build = (agents: AgentState[]) =>
    buildSnapshot({ transcript: { sessions: [], agents }, hookEvents: [], now: NOW }).agents.map((a) => a.id);

  it('chi ha finito resta (in area relax) finché un altro agente lavora', () => {
    const old = agent({ id: 'old', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 60_000 });
    expect(build([old, agent({ id: 'busy', startedAt: NOW - 120_000 })])).toEqual(['old', 'busy']);
  });

  it('i terminati di un turno precedente, già usciti, non tornano quando entra un nuovo agente', () => {
    const gone = agent({ id: 'gone', status: 'done', startedAt: NOW - 3_600_000, updatedAt: NOW - 3_000_000 });
    const lingering = agent({ id: 'lingering', status: 'done', startedAt: NOW - 60_000, updatedAt: NOW - 25_000 });
    expect(build([gone, lingering, agent({ id: 'new', startedAt: NOW - 5_000 })])).toEqual(['lingering', 'new']);
  });

  it('a catena: resta chi ha lavorato insieme a uno rimasto in ufficio', () => {
    const a = agent({ id: 'a', status: 'done', startedAt: NOW - 300_000, updatedAt: NOW - 200_000 });
    const b = agent({ id: 'b', status: 'done', startedAt: NOW - 250_000, updatedAt: NOW - 100_000 });
    expect(build([a, b, agent({ id: 'busy', startedAt: NOW - 120_000 })])).toEqual(['a', 'b', 'busy']);
  });

  it('quando hanno finito tutti escono insieme: restano DONE_LINGER_MS dopo l\'ultimo', () => {
    const first = agent({ id: 'first', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 60_000 });
    expect(build([first, agent({ id: 'last', status: 'done', startedAt: NOW - 120_000, updatedAt: NOW - 1_000 })])).toEqual(['first', 'last']);
    expect(build([first, agent({ id: 'last', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 })])).toEqual([]);
  });

  it('un agente fermo da più di LOUNGE_WAIT_MS non trattiene gli altri', () => {
    const stale = agent({ id: 'stale', status: 'idle', updatedAt: NOW - LOUNGE_WAIT_MS - 1 });
    const done = agent({ id: 'done', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 });
    expect(build([stale, done])).toEqual(['stale']);
  });
});

describe('buildSnapshot: terminati di oggi', () => {
  it('chi ha finito oggi ed è già uscito, dal più recente; non chi è ancora in ufficio né chi ha finito ieri', () => {
    // istante in ora locale, lontano dalla mezzanotte: il test non dipende dal fuso orario
    const now = new Date(2026, 0, 10, 15, 0).getTime();
    const midnight = new Date(2026, 0, 10).getTime();
    const done = (id: string, updatedAt: number) => agent({ id, status: 'done', startedAt: updatedAt - 60_000, updatedAt });
    const busy = agent({ id: 'busy', startedAt: now - 20_000, updatedAt: now - 1_000 });
    const transcript = {
      sessions: [],
      agents: [done('gone', now - 3 * 3_600_000), done('later', now - 3_600_000), done('ieri', midnight - 1), done('relax', now - 1_000), busy],
    };
    const snap = buildSnapshot({ transcript, hookEvents: [], now });
    expect(snap.agents.map((a) => a.id)).toEqual(['relax', 'busy']);
    expect(snap.finished!.map((a) => a.id)).toEqual(['later', 'gone']);
  });
});

describe('buildSnapshot: esito e avvisi (#97)', () => {
  const alerts = { staleMs: 60 * 60_000, loopRepeats: 5 };
  const build = (agents: AgentState[], hookEvents: HookEvent[] = []) => {
    const snap = buildSnapshot({ transcript: { sessions: [session()], agents }, hookEvents, alerts, now: NOW + 2 * 3_600_000 });
    // in ufficio o già usciti
    return new Map([...snap.agents, ...(snap.finished ?? [])].map((a) => [a.id, a]));
  };

  it('fermo da più della soglia: avviso stale; in attesa dell\'utente o terminato no', () => {
    const later = NOW + 2 * 3_600_000;
    const by = build([
      agent({ id: 'fermo', updatedAt: later - 72 * 60_000 }),
      agent({ id: 'attivo', updatedAt: later - 59 * 60_000 }),
      agent({ id: 'chiede', updatedAt: later - 72 * 60_000, waiting: true, waitingKind: 'question' }),
      agent({ id: 'finito', status: 'done', updatedAt: later - 72 * 60_000 }),
    ]);
    expect(by.get('fermo')?.alert).toEqual({ kind: 'stale', since: later - 72 * 60_000 });
    expect(by.get('attivo')?.alert).toBeUndefined();
    expect(by.get('chiede')?.alert).toBeUndefined();
    expect(by.get('finito')).toMatchObject({ outcome: 'ok' });
    expect(by.get('finito')?.alert).toBeUndefined();
  });

  it('in loop dalla soglia di ripetizioni; terminato dall\'hook: esito ok e niente ripetizioni', () => {
    const later = NOW + 2 * 3_600_000;
    const by = build(
      [
        agent({ id: 'loop', updatedAt: later - 1000, repeat: { tool: 'Bash', count: 5 } }),
        agent({ id: 'quasi', updatedAt: later - 1000, repeat: { tool: 'Bash', count: 4 } }),
        agent({ id: 'stop', updatedAt: later - 5000, repeat: { tool: 'Read', count: 9 } }),
      ],
      [{ event: 'SubagentStop', sessionId: 's1', agentId: 'stop', agentType: null, toolName: null, cwd: '/w', timestamp: later - 1000 }],
    );
    expect(by.get('loop')?.alert).toEqual({ kind: 'loop', tool: 'Bash', count: 5 });
    expect(by.get('quasi')?.alert).toBeUndefined();
    expect(by.get('stop')).toMatchObject({ status: 'done', outcome: 'ok' });
    expect(by.get('stop')).not.toHaveProperty('repeat');
  });
});

describe('buildSnapshot: sessione principale (Claudio Code)', () => {
  const build = (over: Partial<TranscriptSession>, hookEvents: HookEvent[] = [], branch: string | null = null) =>
    buildSnapshot({
      transcript: { sessions: [session({ cwd: '/p', ...over })], agents: [] },
      hookEvents,
      repoAt: () => (branch === null ? null : repo(branch)),
      now: NOW,
    }).sessions[0]!;

  it('inizio del turno: il più recente tra il prompt nel transcript e l\'hook UserPromptSubmit', () => {
    expect(build({ turnStartedAt: NOW - 5_000 }).turnStartedAt).toBe(NOW - 5_000);
    expect(build({ turnStartedAt: NOW - 5_000 }, [hook('UserPromptSubmit', NOW - 200, { agentId: null })]).turnStartedAt).toBe(NOW - 200);
    expect(build({ turnStartedAt: NOW - 5_000 }, [hook('UserPromptSubmit', NOW - 9_000, { agentId: null })]).turnStartedAt).toBe(NOW - 5_000);
    expect(build({}, [hook('UserPromptSubmit', NOW - 200, { agentId: null, sessionId: 'altra' })]).turnStartedAt).toBeNull();
  });

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
  const notif = (t: number, notification: NonNullable<HookEvent['notification']>) => hook('Notification', t, { agentId: null, notification });
  const build = (sessions: TranscriptSession[], hookEvents: HookEvent[] = [], agents: AgentState[] = []) =>
    buildSnapshot({ transcript: { sessions, agents }, hookEvents, now: NOW });

  it('notifica di permesso senza attività successiva → waiting; quella di attesa prompt no', () => {
    expect(build([session()], [notif(NOW - 500, 'input')]).sessions[0]!.waiting).toBe(true);
    expect(build([session()], [notif(NOW - 500, 'idle')]).sessions[0]!.waiting).toBe(false);
    expect(build([session()], [notif(NOW - 500, 'input'), hook('PostToolUse', NOW - 100, { agentId: null })]).sessions[0]!.waiting).toBe(false);
    // il transcript è andato avanti dopo la notifica
    expect(build([session({ updatedAt: NOW - 100 })], [notif(NOW - 60_000, 'input')]).sessions[0]!.waiting).toBe(false);
    expect(build([session({ waiting: true })]).sessions[0]!.waiting).toBe(true);
  });

  it('motivo e inizio del blocco: dalla domanda nel transcript o dalla notifica dell\'hook', () => {
    const fromHook = build([session()], [notif(NOW - 500, 'permission')]).sessions[0]!;
    expect(fromHook).toMatchObject({ waiting: true, waitingKind: 'permission', waitingSince: NOW - 500 });
    const fromTranscript = build([session({ waiting: true, waitingKind: 'plan', waitingSince: NOW - 9_000 })]).sessions[0]!;
    expect(fromTranscript).toMatchObject({ waitingKind: 'plan', waitingSince: NOW - 9_000 });
    expect(build([session()]).sessions[0]).toMatchObject({ waiting: false, waitingKind: null, waitingSince: null });
  });

  it('status: waiting > working > idle, solo sessioni attive', () => {
    expect(build([]).status).toBe('idle');
    expect(build([session({ status: 'working' })]).status).toBe('working');
    expect(build([session({ status: 'done' })], [], [agent({ status: 'working' })]).status).toBe('working');
    expect(build([session({ status: 'done' })]).status).toBe('idle');
    expect(build([session({ status: 'working', waiting: true })]).status).toBe('waiting');
    expect(build([session({ status: 'working', waiting: true, active: false })]).status).toBe('idle');
  });

  it('pallino per sessione: solo i suoi agenti contano; le sessioni non attive sono grigie', () => {
    const dots = (sessions: TranscriptSession[], agents: AgentState[] = []) => build(sessions, [], agents).sessions.map((s) => [s.id, s.dot]);
    expect(dots([session({ waiting: true })])).toEqual([['s1', 'waiting']]);
    expect(dots([session()])).toEqual([['s1', 'working']]);
    expect(dots([session({ status: 'done' })], [agent()])).toEqual([['s1', 'working']]);
    expect(dots([session({ status: 'done' })], [agent({ status: 'idle', updatedAt: NOW - IDLE_MS - 1 })])).toEqual([['s1', 'idle']]);
    expect(dots([session({ active: false, waiting: true })])).toEqual([['s1', 'idle']]);
    // l'agente al lavoro di s1 non colora s2
    expect(dots([session({ status: 'done' }), session({ id: 's2', status: 'done', updatedAt: NOW - 2_000 })], [agent()])).toEqual([
      ['s1', 'working'],
      ['s2', 'idle'],
    ]);
  });

  it('progetto: ultima cartella del cwd, null senza cwd', () => {
    expect(build([session({ cwd: '/Users/x/agent-office/' })]).sessions[0]!.project).toBe('agent-office');
    expect(build([session({ cwd: null })]).sessions[0]!.project).toBeNull();
  });

  describe('subagente bloccato', () => {
    const permission = (t: number, agentId: string | null) => hook('Notification', t, { agentId, notification: 'permission' });
    const pre = (t: number, agentId: string | null, toolName = 'Bash') => hook('PreToolUse', t, { agentId, toolName });
    const a1 = agent({ id: 'a1', updatedAt: NOW - 10_000 });
    const a2 = agent({ id: 'a2', updatedAt: NOW - 10_000 });
    const main = session({ updatedAt: NOW - 10_000 });

    it('notifica con agentId: attesa sul subagente, la sessione la eredita con il motivo', () => {
      const snap = build([main], [permission(NOW - 8_000, 'a1')], [a1, a2]);
      expect(snap.agents.find((a) => a.id === 'a1')).toMatchObject({ waiting: true, waitingKind: 'permission', waitingSince: NOW - 8_000 });
      expect(snap.agents.find((a) => a.id === 'a2')!.waiting).toBeUndefined();
      expect(snap.sessions[0]).toMatchObject({ waiting: true, waitingKind: 'permission', waitingSince: NOW - 8_000, waitingAgentId: 'a1' });
      expect(snap.status).toBe('waiting');
    });

    it('l\'attività del subagente chiude l\'attesa, quella di un altro no', () => {
      const other = build([main], [permission(NOW - 8_000, 'a1'), hook('PostToolUse', NOW - 1_000, { agentId: 'a2' })], [a1, a2]);
      expect(other.sessions[0]).toMatchObject({ waiting: true, waitingAgentId: 'a1' });
      const own = build([main], [permission(NOW - 8_000, 'a1'), hook('PostToolUse', NOW - 1_000)], [a1, a2]);
      expect(own.agents.every((a) => !a.waiting)).toBe(true);
      expect(own.sessions[0]).toMatchObject({ waiting: false, waitingAgentId: null });
    });

    it('permesso senza agentId: attribuito alla richiesta di permesso aperta', () => {
      const events = [pre(NOW - 9_500, 'a2'), pre(NOW - 9_000, 'a1'), hook('PermissionRequest', NOW - 9_000, { agentId: 'a1' }), permission(NOW - 3_000, null)];
      const snap = build([main], events, [a1, a2]);
      expect(snap.agents.find((a) => a.id === 'a1')!.waiting).toBe(true);
      expect(snap.agents.find((a) => a.id === 'a2')!.waiting).toBeUndefined();
      expect(snap.sessions[0]!.waitingAgentId).toBe('a1');
    });

    it('permesso senza agentId: attribuito all\'unico tool avviato senza risultato, se non è di Claude', () => {
      // Claude aspetta il subagente (Agent), il subagente aspetta il permesso per il suo Bash
      const unique = build([main], [pre(NOW - 9_500, null, 'Agent'), pre(NOW - 9_000, 'a1'), permission(NOW - 3_000, null)], [a1, a2]);
      expect(unique.sessions[0]!.waitingAgentId).toBe('a1');
      // ambiguo (due tool aperti) o Claude con un tool suo: il blocco resta della sessione, nessun subagente segnato
      const twice = build([main], [pre(NOW - 9_500, 'a2'), pre(NOW - 9_000, 'a1'), permission(NOW - 3_000, null)], [a1, a2]);
      expect(twice.agents.some((a) => a.waiting)).toBe(false);
      expect(twice.sessions[0]).toMatchObject({ waiting: true, waitingKind: 'permission', waitingAgentId: null });
      const mainTool = build([main], [pre(NOW - 9_500, null, 'Edit'), pre(NOW - 9_000, 'a1'), permission(NOW - 3_000, null)], [a1, a2]);
      expect(mainTool.agents.some((a) => a.waiting)).toBe(false);
      // un tool lungo in esecuzione senza notifica non è un'attesa
      expect(build([main], [pre(NOW - 9_000, 'a1')], [a1]).agents[0]!.waiting).toBeUndefined();
    });

    it('domanda nel transcript del subagente; un subagente terminato non aspetta', () => {
      const asking = agent({ waiting: true, waitingKind: 'question', waitingSince: NOW - 4_000 });
      expect(build([main], [], [asking]).sessions[0]).toMatchObject({ waiting: true, waitingKind: 'question', waitingAgentId: 'a1' });
      const done = build([main], [permission(NOW - 8_000, 'a1')], [agent({ status: 'done', updatedAt: NOW - 10_000 })]);
      expect(done.agents[0]!.waiting).toBeFalsy();
      expect(done.sessions[0]!.waiting).toBe(false);
    });

    it('se Claude stesso è bloccato il motivo è il suo', () => {
      const asking = agent({ waiting: true, waitingKind: 'question', waitingSince: NOW - 4_000 });
      const snap = build([session({ waiting: true, waitingKind: 'plan', waitingSince: NOW - 9_000 })], [], [asking]);
      expect(snap.sessions[0]).toMatchObject({ waitingKind: 'plan', waitingAgentId: null });
    });
  });

  it('area relax per sessione: i terminati di una sessione non aspettano gli agenti di un\'altra', () => {
    const done = agent({ id: 'd', sessionId: 's2', status: 'done', updatedAt: NOW - DONE_LINGER_MS - 1 });
    expect(build([], [], [done, agent({ id: 'w', sessionId: 's1' })]).agents.map((a) => a.id)).toEqual(['w']);
  });
});
