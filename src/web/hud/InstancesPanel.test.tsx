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

  it('subagente: nome di persona, ruolo e compito; Claudio Code senza ruolo (#88)', () => {
    render(<InstancesPanel sessions={[session()]} agents={[agent({ nickname: 'Dario Merge', area: 'test' })]} bosses={[boss('s1')]} onSelect={() => {}} />);
    const row = screen.getByRole('button', { name: /Dario Merge/ });
    expect(within(row).getByText('QA').getAttribute('data-area')).toBe('test');
    expect(within(row).getByText('Build HUD panel')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Claudio Code/ })).queryByText('architect')).toBeNull();
  });

  it('apri e chiudi: dati della sessione e agenti', () => {
    render(
      <InstancesPanel
        sessions={[session({ diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 } })]}
        agents={[agent({ tool: { name: 'Edit', target: 'parser.ts', since: Date.now() } })]}
        bosses={[boss('s1')]}
        onSelect={() => {}}
      />,
    );
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/claude-opus-5-5 · high · 2.3k token generati/)).toBeTruthy();
    // sotto il 50% il contesto è una pillola, senza barra
    expect(screen.getByText('Contesto 25%').className).toBe('hud-pill');
    expect(screen.queryByRole('progressbar', { name: /Contesto usato/ })).toBeNull();
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('al lavoro · Edit parser.ts')).toBeTruthy();
    fireEvent.click(head(/agent-office/));
    expect(head(/agent-office/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Build HUD panel')).toBeNull();
    fireEvent.click(head(/agent-office/));
    expect(screen.getByText('Build HUD panel')).toBeTruthy();
  });

  it('agenti per urgenza, terminati in un gruppo chiuso, contatore per stato nella testata (B2, B3)', () => {
    const t = Date.now();
    const { container } = render(
      <InstancesPanel
        sessions={[session({ context: { used: 190_000, window: 200_000 } })]}
        agents={[
          agent({ id: 'd1', name: 'Finito', status: 'done' }),
          agent({ id: 'i1', name: 'Fermo', status: 'idle', updatedAt: t - 12 * 60_000 }),
          agent({ id: 'w1', name: 'Lavora' }),
          agent({ id: 'q1', name: 'Aspetta', waiting: true, waitingKind: 'question', waitingSince: t }),
          agent({ id: 'd2', name: 'Finito 2', status: 'done' }),
        ]}
        bosses={[boss('s1')]}
        onSelect={() => {}}
      />,
    );
    const names = [...container.querySelectorAll('.hud-instance__agent-name')].map((e) => e.textContent);
    expect(names).toEqual(['Claudio Code', 'Aspetta', 'Lavora', 'Fermo', 'Finito', 'Finito 2']);
    const group = screen.getByText('2 terminati').closest('details')!;
    expect(group.open).toBe(false);
    expect(within(group).getByText('Finito')).toBeTruthy();
    expect(within(head(/agent-office/)).getByText('1 al lavoro · 1 in attesa · 1 inattivo · 2 terminati')).toBeTruthy();
    expect(screen.getByText('fermo da 12 min')).toBeTruthy();
    // oltre il 90% la barra e il suggerimento di compattare
    expect(screen.getByRole('progressbar', { name: /Contesto usato/ }).getAttribute('data-level')).toBe('danger');
    expect(screen.getByText('conviene /compact')).toBeTruthy();
  });

  it('con la scheda di Claude aperta, riga meta e contesto solo nella scheda', () => {
    render(<InstancesPanel sessions={[session()]} agents={[]} bosses={[boss('s1')]} selected="boss:s1" onSelect={() => {}} />);
    expect(screen.queryByText(/token generati/)).toBeNull();
    expect(screen.queryByText(/Contesto/)).toBeNull();
  });

  it('riga di Claude: turno corrente dall\'ultimo prompt', () => {
    render(<InstancesPanel sessions={[session({ turnStartedAt: Date.now() - 4 * 60_000 })]} agents={[]} bosses={[boss('s1')]} onSelect={() => {}} />);
    expect(screen.getByText('al lavoro · turno da 4 min')).toBeTruthy();
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

  it('subagente bloccato: motivo sulla sua riga, in rosso, e avviso col suo nome; Claude resta col suo stato', () => {
    const t = Date.now();
    render(
      <InstancesPanel
        sessions={[session({ dot: 'waiting', waiting: true, waitingKind: 'permission', waitingSince: t - 3 * 60_000, waitingAgentId: 'a1' })]}
        agents={[agent({ waiting: true, waitingKind: 'permission', waitingSince: t - 3 * 60_000 })]}
        bosses={[boss('s1')]}
        onSelect={() => {}}
      />,
    );
    expect(within(head(/agent-office/)).getByRole('img', { name: /aspetta un tuo input/ })).toBeTruthy();
    expect(screen.getByText('Build HUD panel aspetta un tuo permesso · da 3 min')).toBeTruthy();
    const row = screen.getByRole('button', { name: /Build HUD panel/ });
    expect(row.className).toContain('hud-instance__agent--waiting');
    expect(within(row).getByText('aspetta un tuo permesso · da 3 min')).toBeTruthy();
    const claude = screen.getByRole('button', { name: /Claudio Code/ });
    expect(claude.className).not.toContain('--waiting');
    expect(within(claude).getByText('al lavoro')).toBeTruthy();
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

  it('istanza aperta: pulsante per aprirla in una finestra (#92)', () => {
    const onPopOut = vi.fn();
    render(<InstancesPanel sessions={[session()]} agents={[]} bosses={[boss('s1')]} onSelect={() => {}} onPopOut={onPopOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri agent-office in una finestra' }));
    expect(onPopOut).toHaveBeenCalledWith('s1');
  });
});
