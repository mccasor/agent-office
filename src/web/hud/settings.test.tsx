// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, type SettingKey } from '../../shared/settings';
import type { AgentState, SessionState } from '../../shared/types';
import { useOfficeStore } from '../store';
import { AgentCard } from './AgentCard';
import { InstancesPanel } from './InstancesPanel';
import { ListView } from './ListView';

/** Voci nascoste dalla finestra Impostazioni (#94) applicate ai componenti: per ora le voci dimostrative. */

afterEach(() => {
  cleanup();
  useOfficeStore.setState({ settings: DEFAULT_DISPLAY });
});

const tokens = { input: 0, output: 2_345, cacheRead: 0, cacheCreation: 0, total: 9_999 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: null, model: 'claude-opus-5-5', effort: 'high', context: { used: 50_000, window: 200_000 },
  tokensUsed: tokens, startedAt: 0, updatedAt: 10, active: true, status: 'working', issues: [],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office',
  diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 }, ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0, ...over,
});
const boss = agent({ id: 'boss:s1', name: 'Claudio Code', agentType: 'main' });

const hide = (...keys: SettingKey[]) =>
  act(() => useOfficeStore.getState().setSettings({ ...DEFAULT_DISPLAY, show: { ...DEFAULT_DISPLAY.show, ...Object.fromEntries(keys.map((k) => [k, false])) } }));

describe('voci da mostrare (#94)', () => {
  it('accordion: diff, contesto e conteggio per stato spariscono e ricompaiono subito', () => {
    render(<InstancesPanel sessions={[session()]} agents={[agent()]} bosses={[boss]} onSelect={() => {}} />);
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('Contesto 25%')).toBeTruthy();
    expect(screen.getByText('1 al lavoro')).toBeTruthy();
    hide('session.diff', 'session.context', 'instances.counts');
    expect(screen.queryByText('+12')).toBeNull();
    expect(screen.queryByText('Contesto 25%')).toBeNull();
    expect(screen.queryByText('1 al lavoro')).toBeNull();
    // il resto resta
    expect(screen.getByText('feat/board')).toBeTruthy();
    act(() => useOfficeStore.getState().setSettings(DEFAULT_DISPLAY));
    expect(screen.getByText('+12')).toBeTruthy();
  });

  it('lista e scheda di Claude: stesse voci, stessi interruttori', () => {
    hide('session.diff', 'session.context');
    render(<ListView sessions={[session({ context: { used: 150_000, window: 200_000 } })]} agents={[agent()]} hidden={[]} onToggle={() => {}} />);
    expect(screen.queryByText('+12')).toBeNull();
    expect(screen.queryByText(/Contesto 75%/)).toBeNull();
    cleanup();
    render(<AgentCard agent={boss} session={session()} />);
    expect(screen.queryByText('Contesto')).toBeNull();
    expect(screen.queryByText('+12')).toBeNull();
    expect(screen.getByText('feat/board')).toBeTruthy();
  });
});
