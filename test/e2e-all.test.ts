import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, type RunningOffice } from '../src/cli';
import { encodeProjectPath } from '../src/server/transcript/encode';
import type { Snapshot } from '../src/shared/types';

// cartelle fittizie (non esistono): il poller git le tratta come cartelle senza repository
const ROOT = '/nonexistent/agent-office-e2e';
const ALPHA = `${ROOT}/alpha`;

const MIN = 60_000;
/** finestra di attività scritta in config.json: più corta del default (10 min) per verificare che venga letta */
const ACTIVE_MINUTES = 5;

const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const A = id(1); // alpha, attiva, con subagente
const B = id(2); // beta, attiva, con subagente
const C = id(3); // gamma, ferma da 7 minuti: fuori dalla finestra di 5 ma dentro quella di default
const D = id(4); // delta, vecchia di un giorno: fuori anche dalla finestra di scoperta
const E = id(5); // cartella "altro" ma cwd dentro alpha (es. sessione avviata altrove e poi spostata)
const F = id(6); // alpha, ferma da 7 minuti

interface Fixture {
  dir: string;
  session: string;
  cwd: string;
  /** ms prima di "adesso" dell'ultima riga (e mtime del file) */
  ago: number;
  agent?: string;
}

const FIXTURES: Fixture[] = [
  { dir: ALPHA, session: A, cwd: ALPHA, ago: MIN, agent: 'a0000000000000011' },
  { dir: `${ROOT}/beta`, session: B, cwd: `${ROOT}/beta`, ago: 2 * MIN, agent: 'a0000000000000012' },
  { dir: `${ROOT}/gamma`, session: C, cwd: `${ROOT}/gamma`, ago: 7 * MIN, agent: 'a0000000000000013' },
  { dir: `${ROOT}/delta`, session: D, cwd: `${ROOT}/delta`, ago: 24 * 60 * MIN },
  { dir: `${ROOT}/altro`, session: E, cwd: `${ALPHA}/pkg`, ago: MIN },
  { dir: ALPHA, session: F, cwd: ALPHA, ago: 7 * MIN },
];

const line = (o: object) => JSON.stringify(o) + '\n';

/** transcript minimale: prompt e tool_use ancora aperto (né terminato né "done") */
function transcript(f: Fixture, at: number, agentId?: string): string {
  const base = { sessionId: f.session, ...(agentId ? { isSidechain: true, agentId } : { isSidechain: false }) };
  const iso = (t: number) => new Date(t).toISOString();
  return (
    line({ ...base, type: 'user', message: { role: 'user', content: 'x' }, uuid: `${f.session}-u`, timestamp: iso(at - 1000), cwd: f.cwd }) +
    line({
      ...base,
      type: 'assistant',
      message: {
        id: `msg-${agentId ?? f.session}`,
        role: 'assistant',
        model: 'claude-opus-4-5',
        content: [{ type: 'tool_use', id: `toolu-${agentId ?? f.session}`, name: 'Bash', input: { command: 'true' } }],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      uuid: `${f.session}-a`,
      timestamp: iso(at),
    })
  );
}

/** scrive le fixture con timestamp e mtime relativi a `now` */
function writeFixtures(claudeHome: string, now: number): void {
  for (const f of FIXTURES) {
    const dir = join(claudeHome, 'projects', encodeProjectPath(f.dir));
    mkdirSync(dir, { recursive: true });
    const at = new Date(now - f.ago);
    const main = join(dir, `${f.session}.jsonl`);
    writeFileSync(main, transcript(f, at.getTime()));
    utimesSync(main, at, at);
    if (f.agent) {
      const sub = join(dir, f.session, 'subagents');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, `agent-${f.agent}.meta.json`), JSON.stringify({ agentType: 'Explore', description: 'fixture' }));
      writeFileSync(join(sub, `agent-${f.agent}.jsonl`), transcript(f, at.getTime(), f.agent));
      for (const name of [`agent-${f.agent}.meta.json`, `agent-${f.agent}.jsonl`]) utimesSync(join(sub, name), at, at);
    }
  }
}

async function start(argv: string[]): Promise<{ office: RunningOffice; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent-office-e2e-all-'));
  const claudeHome = join(dataDir, 'claude');
  const events = join(dataDir, 'events');
  writeFixtures(claudeHome, Date.now());
  mkdirSync(events, { recursive: true });
  writeFileSync(join(events, 'config.json'), JSON.stringify({ activeWindowMinutes: ACTIVE_MINUTES }));
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  process.env.AGENT_OFFICE_DATA_DIR = events;
  const office = await main(['--no-open', '--port', '0', ...argv]);
  if (!office) throw new Error('main non ha avviato il server');
  return { office, dataDir };
}

async function get<T>(office: RunningOffice, path: string): Promise<T> {
  const res = await fetch(`${office.url}${path}`);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe.each([
  {
    mode: '--all',
    argv: ['--all'],
    // tutte le cartelle, solo le sessioni attive e i loro subagenti
    sessions: [{ id: A }, { id: B }, { id: E }].map((s) => ({ ...s, active: true })),
    agents: [
      ['a0000000000000011', A],
      ['a0000000000000012', B],
    ],
    activeSessions: 3,
  },
  {
    mode: '--cwd',
    argv: ['--cwd', ALPHA],
    // solo la cartella monitorata (anche le sessioni ferme) più le sessioni di altre cartelle con cwd interna
    sessions: [
      { id: A, active: true },
      { id: E, active: true },
      { id: F, active: false },
    ],
    agents: [['a0000000000000011', A]],
    activeSessions: 2,
  },
])('e2e: server $mode su più cartelle di progetto', ({ argv, sessions, agents, activeSessions }) => {
  let office: RunningOffice;
  let dataDir: string;

  beforeAll(async () => {
    ({ office, dataDir } = await start(argv));
  });

  afterAll(async () => {
    await office?.close();
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.AGENT_OFFICE_DATA_DIR;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('/api/snapshot espone le sessioni attese con i loro agenti', async () => {
    const snap = await get<Snapshot>(office, '/api/snapshot');
    const byId = [...snap.sessions].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId.map((s) => ({ id: s.id, active: s.active }))).toEqual(sessions);
    expect(snap.agents.map((a) => [a.id, a.sessionId]).sort()).toEqual(agents);
  });

  it('/api/status conta solo le sessioni attive', async () => {
    expect(await get(office, '/api/status')).toMatchObject({ app: 'agent-office', activeSessions });
  });
});
