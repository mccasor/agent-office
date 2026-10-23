import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentState } from '../../shared/types.js';
import { agentVerdict, lastWrite } from './verdict.js';

const NOW = 5_000_000;
const zeroTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'x', agentType: 'Explore', description: 'Prompt segreto', area: 'other', status: 'idle',
  model: null, tokens: zeroTokens, progress: null, issues: [], startedAt: 0, updatedAt: NOW - 3_600_000, ...over,
});
const alive = { process: 'alive' as const, status: 'busy' as const, goneAt: null };
const none = { background: null, now: NOW };

describe('agentVerdict (#104)', () => {
  it('chiuso se il processo è terminato, anche per chi risulta già terminato; null se l\'agente non c\'è', () => {
    const gone = { process: 'gone' as const, status: null, goneAt: NOW };
    expect(agentVerdict({ agent: agent(), process: gone, ...none })).toEqual({ kind: 'closed', checkedAt: NOW });
    expect(agentVerdict({ agent: agent({ status: 'done', outcome: 'interrupted' }), process: gone, ...none })?.kind).toBe('closed');
    expect(agentVerdict({ agent: undefined, process: alive, ...none })).toBeNull();
  });

  it('terminato normalmente: l\'esito', () => {
    expect(agentVerdict({ agent: agent({ status: 'done', outcome: 'failed' }), process: alive, ...none })).toEqual({ kind: 'done', outcome: 'failed', checkedAt: NOW });
  });

  it('in esecuzione: tool in corso, attesa dell\'utente o comandi in background; solo nome del tool, orari e conteggi', () => {
    const tool = { name: 'Bash', target: 'segreto.ts', since: NOW - 72 * 60_000 };
    const v = agentVerdict({ agent: agent({ tool }), process: alive, ...none });
    expect(v).toEqual({ kind: 'running', checkedAt: NOW, tool: { name: 'Bash', since: tool.since }, waiting: null, background: 0, lastOutputAt: null, claude: 'busy' });
    expect(JSON.stringify(v)).not.toMatch(/segreto|Prompt/);
    expect(agentVerdict({ agent: agent({ waiting: true, waitingKind: 'permission' }), process: alive, ...none })).toMatchObject({ kind: 'running', waiting: 'permission' });
    expect(agentVerdict({ agent: agent(), process: alive, background: { count: 2, lastOutputAt: NOW - 180_000 }, now: NOW }))
      .toMatchObject({ kind: 'running', background: 2, lastOutputAt: NOW - 180_000 });
  });

  it('probabilmente finito senza notifica: sessione viva e niente in corso; sconosciuto senza file di sessione', () => {
    expect(agentVerdict({ agent: agent(), process: { ...alive, status: 'idle' }, background: { count: 0, lastOutputAt: null }, now: NOW }))
      .toMatchObject({ kind: 'silent', claude: 'idle', background: 0 });
    expect(agentVerdict({ agent: agent({ tool: { name: 'Read', target: 'a.ts', since: 1 } }), process: undefined, ...none }))
      .toMatchObject({ kind: 'unknown', tool: { name: 'Read', since: 1 }, claude: null });
  });
});

describe('lastWrite', () => {
  it('l\'mtime più recente tra gli output esistenti, senza leggerli; null se nessuno', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ao-verdict-'));
    const a = join(dir, 'tasks', 'b1.output');
    const b = join(dir, 'b2.output');
    await writeFile(b, 'output dei comandi');
    await utimes(b, new Date(2_000_000), new Date(2_000_000));
    expect(await lastWrite([a, b])).toBe(2_000_000);
    expect(await lastWrite([a])).toBeNull();
    expect(await lastWrite([])).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
