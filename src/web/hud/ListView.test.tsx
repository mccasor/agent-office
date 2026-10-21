// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, SessionState } from '../../shared/types';
import { ListView, sessionDot, ViewToggle } from './ListView';

afterEach(cleanup);

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 1234 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Rifare la board', model: 'claude-opus-5-5', effort: 'high', context: { used: 0, window: null },
  tokensUsed: tokens, startedAt: 0, updatedAt: 0, active: true, status: 'working', issues: [14],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: { completed: 1, total: 4 }, issues: [22], startedAt: 0, updatedAt: 0, ...over,
});

describe('sessionDot', () => {
  it('rosso se aspetta un input, verde se lavora (anche solo un agente), grigio altrimenti', () => {
    expect(sessionDot(session({ waiting: true }), [])).toBe('waiting');
    expect(sessionDot(session(), [])).toBe('working');
    expect(sessionDot(session({ status: 'done' }), [agent()])).toBe('working');
    expect(sessionDot(session({ status: 'done' }), [agent({ status: 'done' })])).toBe('idle');
    expect(sessionDot(session({ active: false, waiting: true }), [])).toBe('idle');
  });
});

describe('ListView', () => {
  it('una scheda per sessione attiva con progetto, branch, issue e agenti; la casella sceglie l\'ufficio', () => {
    const onToggle = vi.fn();
    render(
      <ListView
        sessions={[session(), session({ id: 's2', active: false, cwd: '/old' })]}
        agents={[agent()]}
        hidden={[]}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByRole('region', { name: 'agent-office' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'old' })).toBeNull();
    expect(screen.getByText('feat/board')).toBeTruthy();
    expect(screen.getByText('#14')).toBeTruthy();
    expect(screen.getByText('#22')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'al lavoro' })).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: "Nell'ufficio" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith('s1');
  });

  it('diff del repository della sessione e durata degli agenti', () => {
    const t = Date.now();
    render(
      <ListView
        sessions={[session({ diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 }, startedAt: t - 90 * 60_000 })]}
        agents={[agent({ startedAt: t - 5 * 60_000, progress: null }), agent({ id: 'a2', status: 'done', startedAt: t - 9 * 60_000, updatedAt: t - 7 * 60_000 })]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('-3')).toBeTruthy();
    expect(screen.getByText(/attiva da 1 h 30/)).toBeTruthy();
    expect(screen.getByText('al lavoro · da 5 min')).toBeTruthy();
    expect(screen.getByText('terminato · in 2 min')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('sessione nascosta: casella non spuntata; nessuna sessione: messaggio', () => {
    render(<ListView sessions={[session()]} agents={[]} hidden={['s1']} onToggle={() => {}} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    cleanup();
    render(<ListView sessions={[]} agents={[]} hidden={[]} onToggle={() => {}} />);
    expect(screen.getByText(/Nessuna sessione/)).toBeTruthy();
  });
});

describe('ViewToggle', () => {
  it('evidenzia la vista corrente e notifica il cambio', () => {
    const onChange = vi.fn();
    render(<ViewToggle view="office" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Ufficio' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});
