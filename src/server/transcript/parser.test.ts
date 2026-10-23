import { describe, expect, it } from 'vitest';
import { createAccumulator, extractIssues } from './parser.js';

const assistant = (id: string, usage: [number, number, number, number], content: unknown[] = [{ type: 'text', text: 'x' }], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-01-01T10:00:00.000Z',
    message: {
      id,
      model: 'claude-opus-4-5',
      content,
      stop_reason: null,
      usage: { input_tokens: usage[0], output_tokens: usage[1], cache_read_input_tokens: usage[2], cache_creation_input_tokens: usage[3] },
    },
    ...extra,
  });

const toolUse = (name: string, input: unknown) => [{ type: 'tool_use', id: 't', name, input }];

describe('createAccumulator', () => {
  it('stato iniziale vuoto', () => {
    const acc = createAccumulator();
    expect(acc.state).toMatchObject({
      title: null,
      model: null,
      effort: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      contextUsed: null,
      firstAt: null,
      lastAt: null,
      progress: null,
      hasAssistant: false,
      finished: false,
    });
  });

  it('ignora righe malformate, vuote e tipi sconosciuti', () => {
    const acc = createAccumulator();
    expect(() => {
      acc.ingest('{"type":"assistant","message":');
      acc.ingest('');
      acc.ingest('null');
      acc.ingest('42');
      acc.ingest('{"type":"whatever","x":1}');
      acc.ingest('{"type":"assistant","message":null}');
      acc.ingest('{"type":"assistant","message":{"usage":"bad","content":"str"}}');
    }).not.toThrow();
    expect(acc.state.tokens.total).toBe(0);
  });

  it('deduplica righe dello stesso message.id tenendo l’ultimo usage (streaming)', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [2, 8, 100, 10], [{ type: 'thinking', thinking: 'x' }]));
    acc.ingest(assistant('m1', [2, 300, 100, 10], toolUse('Bash', { command: 'ls' })));
    acc.ingest(assistant('m1', [2, 300, 100, 10], [{ type: 'text', text: 'x' }]));
    acc.ingest(assistant('m2', [1, 5, 200, 20]));
    expect(acc.state.tokens).toEqual({ input: 3, output: 305, cacheRead: 300, cacheCreation: 30, cacheCreation1h: 0, total: 638 });
    expect(acc.state.contextUsed).toBe(1 + 200 + 20);
  });

  it('ignora i messaggi <synthetic> per il modello', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [1, 1, 1, 1]));
    acc.ingest(JSON.stringify({ type: 'assistant', message: { id: 'm2', model: '<synthetic>', content: [], usage: { input_tokens: 0, output_tokens: 0 } } }));
    expect(acc.state.model).toBe('claude-opus-4-5');
  });

  it('legge titolo, effort (api-request o campo effort), tokens left e timestamp', () => {
    const acc = createAccumulator();
    acc.ingest('{"type":"ai-title","aiTitle":"First"}');
    acc.ingest('{"type":"ai-title","aiTitle":"Second"}');
    acc.ingest(JSON.stringify({ type: 'assistant', effort: 'medium', timestamp: '2026-01-01T09:59:00.000Z', message: { id: 'a', model: 'claude-opus-4-5', content: [] } }));
    expect(acc.state.effort).toBe('medium');
    acc.ingest(JSON.stringify({ type: 'api-request', timestamp: '2026-01-01T10:00:00.000Z', params: { model: 'claude-sonnet-4-5', output_config: { effort: 'xhigh' } } }));
    acc.ingest(JSON.stringify({ type: 'attachment', timestamp: '2026-01-01T10:00:05.000Z', attachment: { type: 'total_tokens_reminder', text: '<total_tokens>14969158 tokens left</total_tokens>' } }));
    acc.ingest(JSON.stringify({ type: 'attachment', attachment: { type: 'total_tokens_reminder', text: 'garbage' } }));
    expect(acc.state.title).toBe('Second');
    expect(acc.state.effort).toBe('xhigh');
    expect(acc.state.model).toBe('claude-sonnet-4-5');
    expect(acc.state.firstAt).toBe(Date.parse('2026-01-01T09:59:00.000Z'));
    expect(acc.state.lastAt).toBe(Date.parse('2026-01-01T10:00:05.000Z'));
  });

  it('progress da TodoWrite (sostituisce la lista)', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [0, 0, 0, 0], toolUse('TodoWrite', { todos: [{ status: 'pending' }, { status: 'pending' }] })));
    expect(acc.state.progress).toEqual({ completed: 0, total: 2 });
    acc.ingest(assistant('m2', [0, 0, 0, 0], toolUse('TodoWrite', { todos: [{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }] })));
    expect(acc.state.progress).toEqual({ completed: 2, total: 3 });
  });

  it('progress da TaskCreate/TaskUpdate (id sequenziali, deleted rimuove)', () => {
    const acc = createAccumulator();
    for (let i = 0; i < 3; i++) acc.ingest(assistant(`c${i}`, [0, 0, 0, 0], toolUse('TaskCreate', { subject: 's', description: 'd' })));
    expect(acc.state.progress).toEqual({ completed: 0, total: 3 });
    acc.ingest(assistant('u1', [0, 0, 0, 0], toolUse('TaskUpdate', { taskId: '1', status: 'completed' })));
    acc.ingest(assistant('u2', [0, 0, 0, 0], toolUse('TaskUpdate', { taskId: '2', status: 'in_progress' })));
    acc.ingest(assistant('u3', [0, 0, 0, 0], toolUse('TaskUpdate', { taskId: '3', status: 'deleted' })));
    acc.ingest(assistant('u4', [0, 0, 0, 0], toolUse('TaskUpdate', { taskId: '99', status: 'completed' })));
    expect(acc.state.progress).toEqual({ completed: 1, total: 2 });
  });

  it('raccoglie i percorsi dei file toccati (deduplicati) senza contenuti', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [0, 0, 0, 0], [
      ...toolUse('Edit', { file_path: '/p/a.ts', old_string: 'secret', new_string: 'secret2' }),
      ...toolUse('Write', { file_path: '/p/b.tsx', content: 'secret' }),
      ...toolUse('Read', { file_path: '/p/a.ts' }),
      ...toolUse('NotebookEdit', { notebook_path: '/p/n.ipynb' }),
      ...toolUse('Bash', { command: 'cat /etc/passwd' }),
    ]));
    expect(acc.state.filePaths).toEqual(['/p/a.ts', '/p/b.tsx', '/p/n.ipynb']);
    expect(JSON.stringify(acc.state)).not.toContain('secret');
  });

  it('finished: ultima risposta solo testo, oppure structured_output; riattivato da nuove righe', () => {
    const acc = createAccumulator();
    acc.ingest('{"type":"user","message":{"role":"user","content":"x"}}');
    expect(acc.state.hasAssistant).toBe(false);
    acc.ingest(assistant('m1', [0, 0, 0, 0], toolUse('Read', { file_path: '/a' })));
    expect(acc.state.hasAssistant).toBe(true);
    expect(acc.state.finished).toBe(false);
    acc.ingest('{"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}');
    acc.ingest(assistant('m2', [0, 0, 0, 0], [{ type: 'text', text: 'done' }]));
    expect(acc.state.finished).toBe('tentative');
    acc.ingest(JSON.stringify({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } }));
    expect(acc.state.finished).toBe('confirmed');
    acc.ingest('{"type":"user","message":{"role":"user","content":"again"}}');
    expect(acc.state.finished).toBe(false);
    acc.ingest(assistant('m3', [0, 0, 0, 0], toolUse('StructuredOutput', {})));
    acc.ingest('{"type":"attachment","attachment":{"type":"structured_output"}}');
    acc.ingest('{"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}');
    expect(acc.state.finished).toBe('confirmed');
  });

  it('finished: tool_use SubagentHandback (report finale) seguito dal suo tool_result', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [0, 0, 0, 0], toolUse('SubagentHandback', {})));
    acc.ingest('{"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}');
    expect(acc.state.finished).toBe('confirmed');
  });

  it('una riga di testo seguita da tool_use dello stesso messaggio non è finale', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [0, 0, 0, 0], [{ type: 'text', text: 'x' }]));
    acc.ingest(assistant('m1', [0, 0, 0, 0], toolUse('Bash', {})));
    expect(acc.state.finished).toBe(false);
  });

  it('le righe di metadati non cambiano lo stato di finished', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [0, 0, 0, 0], [{ type: 'text', text: 'done' }]));
    acc.ingest('{"type":"attachment","attachment":{"type":"total_tokens_reminder","text":"<total_tokens>5 tokens left</total_tokens>"}}');
    acc.ingest('{"type":"ai-title","aiTitle":"t"}');
    expect(acc.state.finished).toBe('tentative');
  });

  it('declaredModel: modelId dell\'attachment "model", senza testo', () => {
    const acc = createAccumulator();
    expect(acc.state.declaredModel).toBeNull();
    acc.ingest(JSON.stringify({ type: 'attachment', attachment: { type: 'model', identity: { modelId: 'claude-opus-5[1m]', marketingName: 'Opus 5' }, text: 'secret' } }));
    expect(acc.state.declaredModel).toBe('claude-opus-5[1m]');
    acc.ingest(JSON.stringify({ type: 'attachment', attachment: { type: 'model', identity: {} } }));
    expect(acc.state.declaredModel).toBe('claude-opus-5[1m]');
    expect(JSON.stringify(acc.state)).not.toContain('secret');
  });
});


describe('issue citate', () => {
  it('extractIssues: "#14" e "issue 7", senza duplicati, max 3, ignora colori e system-reminder', () => {
    expect(extractIssues('lavora su #14 e issue 7, poi #14')).toEqual([14, 7]);
    expect(extractIssues('#1 #2 #3 #4')).toEqual([1, 2, 3]);
    expect(extractIssues('colore #2b2b2b, url a/#5, &#39;')).toEqual([]);
    expect(extractIssues('<system-reminder>#99</system-reminder> fix #3')).toEqual([3]);
  });

  it("l'ultimo prompt con riferimenti vince; tool_result e messaggi meta non contano", () => {
    const acc = createAccumulator();
    acc.ingest(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Risolvi #14' } }));
    expect(acc.state.issues).toEqual([14]);
    acc.ingest(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '#99' }] } }));
    acc.ingest(JSON.stringify({ type: 'user', isMeta: true, message: { content: '#98' } }));
    acc.ingest(JSON.stringify({ type: 'user', message: { content: 'continua' } }));
    expect(acc.state.issues).toEqual([14]);
    acc.ingest(JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'ora #21 e #20' }] } }));
    expect(acc.state.issues).toEqual([21, 20]);
  });
});

describe('cwd, branch e domande in attesa', () => {
  it('ultimo cwd/gitBranch; AskUserQuestion senza risposta = in attesa finché non arriva il tool_result', () => {
    const acc = createAccumulator();
    acc.ingest(JSON.stringify({ type: 'user', cwd: '/p', gitBranch: 'fix/14-x', message: { content: 'via' } }));
    expect([acc.state.cwd, acc.state.gitBranch]).toEqual(['/p', 'fix/14-x']);
    acc.ingest(JSON.stringify({
      type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }] },
    }));
    expect(acc.state.awaitingUser).toBe(true);
    acc.ingest(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'altro' }] } }));
    expect(acc.state.awaitingUser).toBe(true);
    acc.ingest(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1' }] } }));
    expect(acc.state.awaitingUser).toBe(false);
  });
});

describe('task in background', () => {
  const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } });
  const toolResult = (text: string, id = 't1') =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const endTurn = JSON.stringify({ type: 'assistant', message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text: 'aspetto' }], stop_reason: 'end_turn' } });

  it('conta i comandi e gli agenti avviati in background finché non arriva la loro notifica', () => {
    const acc = createAccumulator();
    acc.ingest(toolUse('b1', 'Bash', { command: 'npm run dev', run_in_background: true }));
    acc.ingest(toolResult('Command running in background with ID: bxqc4zf1o. Output is being written to: /tmp/x', 'b1'));
    acc.ingest(toolUse('a1', 'Agent', { prompt: 'x' }));
    acc.ingest(toolResult('Async agent launched successfully.\nagentId: a816d6b49e4346d22 (internal ID)', 'a1'));
    expect(acc.state.backgroundTasks).toBe(2);
    acc.ingest(endTurn);
    expect(acc.state.finished).toBe('confirmed');
    acc.ingest(JSON.stringify({ type: 'user', message: { role: 'user', content: '<task-notification>\n<task-id>bxqc4zf1o</task-id>\n<status>completed</status>' } }));
    expect(acc.state.backgroundTasks).toBe(1);
    acc.ingest(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<task-id>a816d6b49e4346d22</task-id>' }] } }));
    expect(acc.state.backgroundTasks).toBe(0);
  });

  it('chiude un task anche con la notifica messa in coda (queue-operation)', () => {
    const acc = createAccumulator();
    acc.ingest(toolUse('a1', 'Agent', { prompt: 'x', run_in_background: true }));
    acc.ingest(toolResult('Async agent launched successfully.\nagentId: a816d6b49e4346d22 (internal ID)', 'a1'));
    expect(acc.state.backgroundTasks).toBe(1);
    acc.ingest(JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>a816d6b49e4346d22</task-id>' }));
    expect(acc.state.backgroundTasks).toBe(0);
  });

  it('non scambia per un task il testo di un file letto o di un comando in primo piano', () => {
    const acc = createAccumulator();
    acc.ingest(toolUse('r1', 'Read', { file_path: '/p/types.ts' }));
    acc.ingest(toolResult('export interface AgentState {\n  agentId: string;', 'r1'));
    acc.ingest(toolUse('b1', 'Bash', { command: 'cat parser.ts' }));
    acc.ingest(toolResult('const RE = /running in background with ID: ([\\w-]+)/', 'b1'));
    expect(acc.state.backgroundTasks).toBe(0);
    acc.ingest(endTurn);
    expect(acc.state.finished).toBe('confirmed');
  });
});

describe('turno interrotto', () => {
  const working = JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], stop_reason: 'tool_use' } });
  const user = (content: unknown) => JSON.stringify({ type: 'user', message: { role: 'user', content } });

  it('un agente fermato o un turno interrotto risulta finito, un prompt normale no', () => {
    const acc = createAccumulator();
    acc.ingest(working);
    acc.ingest(user([{ type: 'text', text: '[Request interrupted by user]' }]));
    expect(acc.state.finished).toBe('confirmed');
    acc.ingest(user('continua'));
    expect(acc.state.finished).toBe(false);
    acc.ingest(working);
    acc.ingest(user([{ type: 'tool_result', tool_use_id: 't1', content: 'no' }, { type: 'text', text: '[Request interrupted by user for tool use]' }]));
    expect(acc.state.finished).toBe('confirmed');
  });
});

describe('tool in uso e domande aperte', () => {
  const assistant = (id: string, content: unknown[], at = '2026-01-01T10:00:00.000Z') =>
    JSON.stringify({ type: 'assistant', timestamp: at, message: { id, role: 'assistant', content, stop_reason: 'tool_use' } });
  const result = (toolUseId: string) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] } });

  it('ultimo tool_use senza risultato, con solo il nome del file; mai comandi o input', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/Users/x/repo/src/parser.ts', old_string: 'segreto' } }]));
    expect(acc.state.tool).toEqual({ name: 'Edit', target: 'parser.ts', since: Date.parse('2026-01-01T10:00:00.000Z') });
    acc.ingest(result('t1'));
    expect(acc.state.tool).toBeNull();
    acc.ingest(assistant('m2', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'echo segreto' } }]));
    expect(acc.state.tool).toMatchObject({ name: 'Bash', target: null });
    expect(JSON.stringify(acc.state.tool)).not.toMatch(/segreto/);
    // nuovo messaggio senza il risultato del precedente (es. interrotto): il vecchio tool non è più in uso
    acc.ingest(assistant('m3', [{ type: 'text', text: 'fatto' }]));
    expect(acc.state.tool).toBeNull();
  });

  it('domanda e piano: tipo e inizio dell\'ultima aperta', () => {
    const acc = createAccumulator();
    acc.ingest(assistant('m1', [{ type: 'tool_use', id: 'q1', name: 'ExitPlanMode', input: {} }], '2026-01-01T10:00:05.000Z'));
    expect(acc.state).toMatchObject({ awaitingUser: true, awaitingKind: 'plan', awaitingSince: Date.parse('2026-01-01T10:00:05.000Z') });
    expect(acc.state.tool).toBeNull();
    acc.ingest(result('q1'));
    expect(acc.state).toMatchObject({ awaitingUser: false, awaitingKind: null, awaitingSince: null });
  });
});

describe('turni, compattazioni e cache da 1 ora', () => {
  const row = (type: string, timestamp: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, timestamp, ...extra });
  const prompt = (timestamp: string, content: unknown, extra: Record<string, unknown> = {}) =>
    row('user', timestamp, { message: { role: 'user', content }, ...extra });

  it('inizio del turno: ultimo prompt scritto dall\'utente, non meta, tool_result, notifiche o interruzioni', () => {
    const acc = createAccumulator();
    acc.ingest(prompt('2026-01-01T10:00:00.000Z', 'primo prompt', { origin: { kind: 'human' } }));
    expect(acc.state.lastPromptAt).toBe(Date.parse('2026-01-01T10:00:00.000Z'));
    acc.ingest(prompt('2026-01-01T10:01:00.000Z', [{ type: 'tool_result', tool_use_id: 't', content: 'x' }]));
    acc.ingest(prompt('2026-01-01T10:02:00.000Z', 'meta', { isMeta: true }));
    acc.ingest(prompt('2026-01-01T10:03:00.000Z', '<task-notification>x</task-notification>', { origin: { kind: 'task-notification' } }));
    acc.ingest(prompt('2026-01-01T10:04:00.000Z', [{ type: 'text', text: '[Request interrupted by user]' }]));
    acc.ingest(prompt('2026-01-01T10:05:00.000Z', 'riassunto', { isCompactSummary: true }));
    acc.ingest(prompt('2026-01-01T10:06:00.000Z', '<local-command-stdout>ok</local-command-stdout>'));
    expect(acc.state.lastPromptAt).toBe(Date.parse('2026-01-01T10:00:00.000Z'));
    // senza origin (versioni vecchie) un prompt normale conta
    acc.ingest(prompt('2026-01-01T10:07:00.000Z', [{ type: 'text', text: 'secondo' }]));
    expect(acc.state.lastPromptAt).toBe(Date.parse('2026-01-01T10:07:00.000Z'));
    expect(JSON.stringify(acc.state)).not.toMatch(/primo|secondo/);
  });

  it('durata dell\'ultimo turno (turn_duration) e compattazioni (compact_boundary), solo numeri', () => {
    const acc = createAccumulator();
    acc.ingest(row('system', '2026-01-01T10:00:00.000Z', { subtype: 'turn_duration', durationMs: 39_231, messageCount: 24 }));
    acc.ingest(row('system', '2026-01-01T10:10:00.000Z', { subtype: 'turn_duration', durationMs: 10_578 }));
    expect(acc.state.lastTurnMs).toBe(10_578);
    expect(acc.state.compactions).toBe(0);
    acc.ingest(row('system', '2026-01-01T11:00:00.000Z', { subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 253_619, postTokens: 7_593 } }));
    acc.ingest(row('system', '2026-01-01T12:00:00.000Z', { subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 699_680, postTokens: 12_385 } }));
    expect(acc.state.compactions).toBe(2);
    expect(acc.state.lastCompaction).toEqual({ at: Date.parse('2026-01-01T12:00:00.000Z'), trigger: 'manual', preTokens: 699_680, postTokens: 12_385 });
  });

  it('separa la scrittura nella cache da 1 ora (cache_creation.ephemeral_1h_input_tokens)', () => {
    const acc = createAccumulator();
    const usage = (id: string, oneHour: number) =>
      row('assistant', '2026-01-01T10:00:00.000Z', {
        message: {
          id,
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'x' }],
          usage: {
            input_tokens: 2,
            output_tokens: 10,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 1000,
            cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: 1000 - oneHour },
          },
        },
      });
    acc.ingest(usage('m1', 1000));
    // stesso messaggio ripetuto (streaming): contato una volta
    acc.ingest(usage('m1', 1000));
    acc.ingest(usage('m2', 400));
    expect(acc.state.tokens).toMatchObject({ cacheCreation: 2000, cacheCreation1h: 1400 });
  });
});
