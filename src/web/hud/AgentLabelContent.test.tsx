// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../shared/types';
import { AgentLabelContent, agentWaiting } from './AgentLabelContent';

afterEach(cleanup);

const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1',
  sessionId: 's1',
  name: 'Implementa HUD',
  agentType: 'general-purpose',
  description: 'Implementa HUD',
  area: 'frontend',
  status: 'working',
  model: null,
  tokens: { input: 10_000, output: 2_345, cacheRead: 0, cacheCreation: 0, total: 12_345 },
  progress: { completed: 1, total: 4 },
  issues: [],
  startedAt: 0,
  updatedAt: 0,
  ...over,
});

describe('AgentLabelContent', () => {
  it('sempre compatta: nome e barra, niente dettaglio (sta nella scheda)', () => {
    render(<AgentLabelContent agent={agent()} />);
    expect(screen.getByText('Implementa HUD')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(screen.queryByText('frontend')).toBeNull();
    expect(screen.queryByText('12.3k')).toBeNull();
    expect(screen.queryByText('1/4 · 25%')).toBeNull();
  });

  it('niente hover: il passaggio del mouse non cambia l\'etichetta', () => {
    const { container } = render(<AgentLabelContent agent={agent()} />);
    const label = container.firstElementChild!;
    const before = label.innerHTML;
    fireEvent.mouseEnter(label);
    expect(label.innerHTML).toBe(before);
    expect(screen.queryByText('frontend')).toBeNull();
  });

  it('clic o Invio selezionano l\'agente; selezionata evidenziata', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<AgentLabelContent agent={agent()} onSelect={onSelect} />);
    const label = screen.getByRole('button', { name: /Implementa HUD/ });
    expect(label.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(label);
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith('a1');
    rerender(<AgentLabelContent agent={agent()} onSelect={onSelect} selected />);
    expect(label.className).toContain('hud-label--selected');
    expect(label.getAttribute('aria-pressed')).toBe('true');
  });

  it('senza onSelect non è un pulsante', () => {
    render(<AgentLabelContent agent={agent()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('niente barra senza todo list (progress null o total 0)', () => {
    render(<AgentLabelContent agent={agent({ progress: null })} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    cleanup();
    render(<AgentLabelContent agent={agent({ progress: { completed: 0, total: 0 } })} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('da quanto lavora, quanto ha lavorato o, se bloccato, che aspetta un input', () => {
    const t = Date.now();
    render(<AgentLabelContent agent={agent({ startedAt: t - 3 * 60_000, updatedAt: t })} />);
    expect(screen.getByTestId('agent-time').textContent).toBe('da 3 min');
    cleanup();
    render(<AgentLabelContent agent={agent({ status: 'done', startedAt: t - 5 * 60_000, updatedAt: t - 60_000 })} />);
    expect(screen.getByTestId('agent-time').textContent).toBe('in 4 min');
    cleanup();
    const { container } = render(<AgentLabelContent agent={agent()} waiting={{ kind: 'permission', since: t - 2 * 60_000 }} />);
    expect(screen.getByTestId('agent-time').textContent).toBe('aspetta un tuo permesso · da 2 min');
    expect(container.firstElementChild?.className).toContain('hud-label--waiting');
  });

  it('agentWaiting: motivo e inizio del blocco del subagente, null se non aspetta o ha terminato', () => {
    const t = Date.now();
    expect(agentWaiting(agent())).toBeNull();
    expect(agentWaiting(agent({ waiting: true, waitingKind: 'permission', waitingSince: t }))).toEqual({ kind: 'permission', since: t });
    expect(agentWaiting(agent({ waiting: true, status: 'done' }))).toBeNull();
  });

  it('tool in uso accanto alla durata; Claudio Code a fine turno è pronto', () => {
    const t = Date.now();
    const tool = { name: 'Edit', target: 'parser.ts', since: t };
    render(<AgentLabelContent agent={agent({ startedAt: t - 60_000, tool })} />);
    expect(screen.getByTestId('agent-time').textContent).toBe('Edit parser.ts · da 1 min');
    cleanup();
    render(<AgentLabelContent agent={agent({ agentType: 'main', status: 'done' })} />);
    expect(screen.getByTestId('agent-time').textContent).toBe('pronto');
  });

  it('nome lungo troncato con titolo completo', () => {
    const long = 'Un nome davvero molto lungo per una etichetta 3D';
    render(<AgentLabelContent agent={agent({ name: long })} />);
    const el = screen.getByTitle(long);
    expect(el.textContent!.length).toBeLessThanOrEqual(24);
    expect(el.textContent!.endsWith('…')).toBe(true);
  });

  it('idle attenuato', () => {
    const { container } = render(<AgentLabelContent agent={agent({ status: 'idle' })} />);
    expect(container.firstElementChild!.className).toContain('hud-label--idle');
  });
});
