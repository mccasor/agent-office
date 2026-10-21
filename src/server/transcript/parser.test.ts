import { describe, expect, it } from 'vitest';
import { createAccumulator } from './parser.js';

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
      tokensLeft: null,
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
    expect(acc.state.tokens).toEqual({ input: 3, output: 305, cacheRead: 300, cacheCreation: 30, total: 638 });
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
    expect(acc.state.tokensLeft).toEqual({ value: 14969158, at: Date.parse('2026-01-01T10:00:05.000Z') });
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
});
