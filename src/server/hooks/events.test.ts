import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventsFilePath, runHook, toHookEvent } from './index.js';

describe('eventsFilePath', () => {
  it('usa ~/.agent-office/events/<cwd codificata>.jsonl di default', () => {
    expect(eventsFilePath('/Library/WebServer/Documents/olimpo-ui')).toBe(
      join(homedir(), '.agent-office', 'events', '-Library-WebServer-Documents-olimpo-ui.jsonl'),
    );
  });

  it('codifica ogni carattere non alfanumerico e non "-" come "-"', () => {
    expect(eventsFilePath('/a/b.c_d e-f', { dataDir: '/data' })).toBe(join('/data', 'events', '-a-b-c-d-e-f.jsonl'));
  });
});

describe('toHookEvent', () => {
  const NOW = 1_700_000_000_000;

  it('converte un payload PreToolUse di un subagente', () => {
    expect(
      toHookEvent(
        {
          session_id: 's1',
          transcript_path: '/x.jsonl',
          cwd: '/proj',
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'secret' },
          agent_id: 'a1',
          agent_type: 'Explore',
        },
        NOW,
      ),
    ).toEqual({
      event: 'PreToolUse',
      sessionId: 's1',
      agentId: 'a1',
      agentType: 'Explore',
      toolName: 'Bash',
      cwd: '/proj',
      timestamp: NOW,
    });
  });

  it('agent_id con prefisso "agent-" normalizzato come negli id dei transcript', () => {
    expect(
      toHookEvent({ session_id: 's1', hook_event_name: 'SubagentStart', agent_id: 'agent-abc123' }, NOW)?.agentId,
    ).toBe('abc123');
  });

  it('campi opzionali mancanti o di tipo errato -> null', () => {
    expect(toHookEvent({ session_id: 's1', hook_event_name: 'Stop', cwd: '/p', agent_id: 3, tool_name: '' }, NOW)).toEqual({
      event: 'Stop',
      sessionId: 's1',
      agentId: null,
      agentType: null,
      toolName: null,
      cwd: '/p',
      timestamp: NOW,
    });
  });

  it('cwd mancante -> stringa vuota', () => {
    expect(toHookEvent({ session_id: 's1', hook_event_name: 'SessionEnd' }, NOW)?.cwd).toBe('');
  });

  it.each([null, undefined, 'x', 42, [], {}, { session_id: 's1' }, { hook_event_name: 'Stop' }, { session_id: '', hook_event_name: 'Stop' }])(
    'payload non valido %j -> null',
    (payload) => {
      expect(toHookEvent(payload, NOW)).toBeNull();
    },
  );
});

describe('runHook', () => {
  let dataDir: string;
  const prevProjectDir = process.env.CLAUDE_PROJECT_DIR;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agent-office-hook-'));
    delete process.env.CLAUDE_PROJECT_DIR;
  });

  afterEach(async () => {
    if (prevProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prevProjectDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  const payload = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ session_id: 's1', hook_event_name: 'SubagentStart', cwd: '/proj/x', agent_id: 'a1', agent_type: 'Explore', ...extra });

  it('appende una riga JSON per evento (crea cartella e file)', async () => {
    await runHook(payload(), { dataDir, now: 1 });
    await runHook(payload({ hook_event_name: 'SubagentStop' }), { dataDir, now: 2 });
    const lines = (await readFile(eventsFilePath('/proj/x', { dataDir }), 'utf8')).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { event: 'SubagentStart', sessionId: 's1', agentId: 'a1', agentType: 'Explore', toolName: null, cwd: '/proj/x', timestamp: 1 },
      { event: 'SubagentStop', sessionId: 's1', agentId: 'a1', agentType: 'Explore', toolName: null, cwd: '/proj/x', timestamp: 2 },
    ]);
  });

  it('usa CLAUDE_PROJECT_DIR (se presente) per scegliere il file', async () => {
    process.env.CLAUDE_PROJECT_DIR = '/proj';
    await runHook(payload(), { dataDir, now: 1 });
    const line = JSON.parse(await readFile(eventsFilePath('/proj', { dataDir }), 'utf8'));
    expect(line.cwd).toBe('/proj/x');
  });

  it('non scrive nulla e non lancia con input non valido', async () => {
    await expect(runHook('not json', { dataDir })).resolves.toBeUndefined();
    await expect(runHook('', { dataDir })).resolves.toBeUndefined();
    await expect(runHook('{"cwd":"/proj/x"}', { dataDir })).resolves.toBeUndefined();
    await expect(readFile(eventsFilePath('/proj/x', { dataDir }))).rejects.toThrow();
  });

  it('non lancia se la scrittura fallisce', async () => {
    const spy = vi.spyOn(process.stdout, 'write');
    await expect(runHook(payload(), { dataDir: '/dev/null/nope', now: 1 })).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('non include mai tool_input né prompt', async () => {
    await runHook(payload({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'SEGRETO' }, prompt: 'SEGRETO' }), {
      dataDir,
      now: 1,
    });
    expect(await readFile(eventsFilePath('/proj/x', { dataDir }), 'utf8')).not.toContain('SEGRETO');
  });
});
