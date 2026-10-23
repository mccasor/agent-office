// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, SessionState } from '../../shared/types';
import { ListView, sameProps } from './ListView';

// conta le righe di agente ridisegnate: ogni riga con avanzamento disegna una barra
const bars = vi.hoisted(() => ({ n: 0 }));
vi.mock('./ProgressBar', async (load) => {
  const real = await load<typeof import('./ProgressBar')>();
  return { ...real, ProgressBar: (p: Parameters<typeof real.ProgressBar>[0]) => (bars.n++, real.ProgressBar(p)) };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 1234 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Rifare la board', model: 'claude-opus-5-5', effort: 'high', context: { used: 0, window: null },
  tokensUsed: tokens, startedAt: 0, updatedAt: 0, active: true, status: 'working', issues: [],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office', ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: { completed: 1, total: 4 }, issues: [], startedAt: 0, updatedAt: 0, ...over,
});

describe('lista memoizzata', () => {
  it('props uguali: per identità, gli array elemento per elemento', () => {
    const a = agent();
    expect(sameProps({ x: 1, list: [a] }, { x: 1, list: [a] })).toBe(true);
    expect(sameProps({ x: 1, list: [a] }, { x: 1, list: [agent()] })).toBe(false);
    expect(sameProps({ x: 1, list: [a] }, { x: 2, list: [a] })).toBe(false);
    expect(sameProps({ list: [a] }, { list: [a, a] })).toBe(false);
  });

  it('a un nuovo snapshot si ridisegnano solo le righe cambiate', () => {
    const sessions = [session(), session({ id: 's2', project: 'altro', cwd: '/altro' })];
    const agents = [agent(), agent({ id: 'a2', sessionId: 's2' }), agent({ id: 'a3', sessionId: 's2', name: 'Altro' })];
    const view = (s: SessionState[], a: AgentState[]) => <ListView sessions={s} agents={a} hidden={[]} onToggle={() => {}} />;
    const { rerender } = render(view(sessions, agents));
    expect(bars.n).toBeGreaterThanOrEqual(3);
    bars.n = 0;
    // snapshot nuovo con gli stessi oggetti (condivisione strutturale dello store): nessuna riga
    rerender(view([...sessions], [...agents]));
    expect(bars.n).toBe(0);
    // cambia un agente della seconda sessione: solo la sua riga
    rerender(view([...sessions], [agents[0]!, agents[1]!, { ...agents[2]!, progress: { completed: 2, total: 4 } }]));
    expect(bars.n).toBe(1);
  });

  it('gli orari relativi continuano ad aggiornarsi', () => {
    vi.useFakeTimers();
    const t = Date.now();
    const sessions = [session()];
    const agents = [agent({ startedAt: t - 5 * 60_000, progress: null })];
    render(<ListView sessions={sessions} agents={agents} hidden={[]} onToggle={() => {}} />);
    expect(screen.getByText('al lavoro · da 5 min')).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('al lavoro · da 6 min')).toBeTruthy();
  });
});
