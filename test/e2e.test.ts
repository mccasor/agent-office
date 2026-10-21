import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, type RunningOffice } from '../src/cli';
import type { Snapshot } from '../src/shared/types';

const fixtures = fileURLToPath(new URL('./fixtures/transcript', import.meta.url));

describe('e2e: CLI -> API', () => {
  let office: RunningOffice;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agent-office-e2e-'));
    process.env.CLAUDE_CONFIG_DIR = fixtures;
    process.env.AGENT_OFFICE_DATA_DIR = dataDir;
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
    expect(snap.sessions[0]).toMatchObject({ effort: 'high', tokensLeft: 140_000 });
    expect(snap.sessions[0]!.tokensUsed.total).toBe(7484);
    // a0000000000000001 ha terminato da più di DONE_LINGER_MS: è già uscito dall'ufficio
    expect(snap.agents.map((a) => a.id)).toEqual(['a0000000000000002']);
    expect(snap.agents.find((a) => a.id === 'a0000000000000002')!.progress).toEqual({ completed: 1, total: 3 });
    expect(snap.repo).toBeNull();
    expect(JSON.stringify(snap)).not.toMatch(/"content"|"text"|"prompt"/);
  });

  it('serve la pagina web', async () => {
    const res = await fetch(`${office.url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
