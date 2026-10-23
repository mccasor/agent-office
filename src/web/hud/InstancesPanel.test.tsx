// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, SessionState } from '../../shared/types';
import { InstancesPanel } from './InstancesPanel';

afterEach(cleanup);

const tokens = { input: 0, output: 2_345, cacheRead: 0, cacheCreation: 0, total: 9_999 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: null, model: 'claude-opus-5-5', effort: 'high', context: { used: 50_000, window: 200_000 },
  tokensUsed: tokens, startedAt: 0, updatedAt: 10, active: true, status: 'working', issues: [14],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office', ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0, ...over,
});
const boss = (sessionId: string): AgentState => agent({ id: `boss:${sessionId}`, sessionId, name: 'Claudio Code', agentType: 'main' });

const sessions = [session(), session({ id: 's2', cwd: '/x/olimpo-ui', project: 'olimpo-ui', branch: 'main', updatedAt: 99, issues: [] }), session({ id: 'old', active: false, cwd: '/x/vecchia', project: 'vecchia' })];
const head = (name: RegExp) => screen.getByRole('button', { name });

describe('InstancesPanel', () => {
  it('un accordion per sessione attiva: aperta di default la più recente', () => {
    render(<InstancesPanel sessions={sessions} agents={[agent()]} bosses={[boss('s1'), boss('s2')]} onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: /vecchia/ })).toBeNull();
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('false');
    expect(head(/olimpo-ui/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('feat/board')).toBeTruthy();
    expect(screen.getByText('#14')).toBeTruthy();
    expect(within(head(/agent-office/)).getByRole('img', { name: 'al lavoro' })).toBeTruthy();
  });

  it('apri e chiudi: dati della sessione e agenti', () => {
    render(
      <InstancesPanel
        sessions={[session({ diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 } })]}
        agents={[agent({ tool: { name: 'Edit', target: 'parser.ts', since: 0 } })]}
        bosses={[boss('s1')]}
        onSelect={() => {}}
      />,
    );
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/claude-opus-5-5 · high · 2.3k token generati/)).toBeTruthy();
    expect(screen.getByText('Contesto 25%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /Contesto usato/ }).getAttribute('data-level')).toBe('ok');
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('al lavoro · Edit parser.ts')).toBeTruthy();
    fireEvent.click(head(/agent-office/));
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Build HUD panel')).toBeNull();
    fireEvent.click(head(/agent-office/));
    expect(screen.getByText('Build HUD panel')).toBeTruthy();
  });

  it('clic su un agente o su Claude stesso lo seleziona; la selezione è evidenziata', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<InstancesPanel sessions={[session()]} agents={[agent()]} bosses={[boss('s1')]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Build HUD panel/ }));
    expect(onSelect).toHaveBeenLastCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: /Claudio Code/ }));
    expect(onSelect).toHaveBeenLastCalledWith('boss:s1');
    rerender(<InstancesPanel sessions={[session()]} agents={[agent()]} bosses={[boss('s1')]} onSelect={onSelect} selected="a1" />);
    expect(screen.getByRole('button', { name: /Build HUD panel/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Claude bloccato: motivo del blocco nella sua riga e avviso in evidenza', () => {
    const t = Date.now();
    render(
      <InstancesPanel
        sessions={[session({ dot: 'waiting', waiting: true, waitingKind: 'question', waitingSince: t - 2 * 60_000 })]}
        agents={[]}
        bosses={[boss('s1')]}
        onSelect={() => {}}
      />,
    );
    expect(within(head(/agent-office/)).getByRole('img', { name: 'aspetta un tuo input' })).toBeTruthy();
    expect(screen.getByText('Ti ha fatto una domanda · da 2 min')).toBeTruthy();
    expect(screen.getByText('ti ha fatto una domanda · da 2 min')).toBeTruthy();
  });

  it('sessione in evidenza aperta (anche se arriva dopo)', () => {
    const { rerender } = render(<InstancesPanel sessions={sessions} agents={[]} bosses={[]} focus="s1" onSelect={() => {}} />);
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('true');
    expect(head(/olimpo-ui/).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head(/agent-office/));
    rerender(<InstancesPanel sessions={sessions} agents={[]} bosses={[]} focus="s2" onSelect={() => {}} />);
    expect(head(/olimpo-ui/).getAttribute('aria-expanded')).toBe('true');
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('false');
  });

  it('nessuna istanza aperta: messaggio', () => {
    render(<InstancesPanel sessions={[]} agents={[]} bosses={[]} onSelect={() => {}} />);
    expect(screen.getByText('Nessuna istanza di Claude Code aperta')).toBeTruthy();
  });
});
