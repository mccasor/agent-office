import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, type RunningOffice } from '../src/cli';
import type { Snapshot } from '../src/shared/types';

const fixtures = fileURLToPath(new URL('./fixtures/transcript', import.meta.url));
/** mtime fissa nel passato: lo stato degli agenti non deve dipendere da quando è stato fatto il checkout */
const OLD = new Date('2026-01-01T00:00:00Z');

describe('e2e: CLI -> API', () => {
  let office: RunningOffice;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-office-e2e-'));
    const claudeHome = join(dataDir, 'claude');
    cpSync(fixtures, claudeHome, { recursive: true });
    for (const f of readdirSync(claudeHome, { recursive: true, withFileTypes: true })) {
      if (f.isFile()) utimesSync(join(f.parentPath, f.name), OLD, OLD);
    }
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    process.env.AGENT_OFFICE_DATA_DIR = join(dataDir, 'events');
    const res = await main(['--no-open', '--port', '0', '--cwd', '/tmp/agent-office-fixture']);
    if (!res) throw new Error('main non ha avviato il server');
    office = res;
  });

  afterAll(async () => {
    await office?.close();
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.AGENT_OFFICE_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('/api/snapshot espone sessione e subagenti delle fixture, senza contenuti dei prompt', async () => {
    const res = await fetch(`${office.url}/api/snapshot`);
    expect(res.status).toBe(200);
    const snap = (await res.json()) as Snapshot;
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({ effort: 'high' });
    expect(snap.sessions[0]!.tokensUsed.total).toBe(7484);
    // a0000000000000001 ha terminato da più di DONE_LINGER_MS: è già uscito dall'ufficio
    expect(snap.agents.map((a) => a.id)).toEqual(['a0000000000000002']);
    expect(snap.agents.find((a) => a.id === 'a0000000000000002')!.progress).toEqual({ completed: 1, total: 3 });
    expect(JSON.stringify(snap)).not.toMatch(/"content"|"text"|"prompt"/);
  });

  it('"Controlla stato" (#104): senza file di sessione sconosciuto; con il processo terminato l\'agente è chiuso', async () => {
    let snap = (await (await fetch(`${office.url}/api/snapshot`)).json()) as Snapshot;
    expect(snap.sessions[0]!.process).toBe('unknown');
    let res = await fetch(`${office.url}/api/agents/a0000000000000002/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'unknown', claude: null });
    expect((await fetch(`${office.url}/api/agents/nessuno/status`)).status).toBe(404);
    // Claude Code ha lasciato il file di sessione di un processo che non c'è più (pid oltre il massimo di macOS e Linux)
    const sessions = join(dataDir, 'claude', 'sessions');
    mkdirSync(sessions);
    writeFileSync(join(sessions, '4194399.json'), JSON.stringify({ pid: 4194399, sessionId: snap.sessions[0]!.id, procStart: 'Wed Oct 21 11:21:15 2026', status: 'busy' }));
    writeFileSync(join(sessions, '4194399.0123abcd.key'), 'token-segreto');
    res = await fetch(`${office.url}/api/agents/a0000000000000002/status`);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ kind: 'closed', checkedAt: expect.any(Number) });
    expect(body).not.toMatch(/token-segreto|sessions|4194399/);
    await vi.waitFor(async () => {
      snap = (await (await fetch(`${office.url}/api/snapshot`)).json()) as Snapshot;
      expect(snap.sessions[0]!.process).toBe('gone');
    });
    // esce dall'ufficio come gli altri terminati, con esito "interrotto"
    expect(snap.agents.find((a) => a.id === 'a0000000000000002')).toMatchObject({ status: 'done', outcome: 'interrupted' });
    expect(JSON.stringify(snap)).not.toMatch(/token-segreto|4194399/);
  });

  it('config.json cambiato: preferenze nuove su /api/config senza riavvio (#94)', async () => {
    let res = await fetch(`${office.url}/api/config`);
    expect(((await res.json()) as { show: Record<string, boolean> }).show['session.diff']).toBe(true);
    writeFileSync(join(dataDir, 'events', 'config.json'), JSON.stringify({ show: { 'session.diff': false }, notifyDone: true }));
    await vi.waitFor(async () => {
      res = await fetch(`${office.url}/api/config`);
      expect(((await res.json()) as { show: Record<string, boolean> }).show['session.diff']).toBe(false);
    });
  });

  it('serve la pagina web', async () => {
    const res = await fetch(`${office.url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
