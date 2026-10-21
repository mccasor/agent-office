// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentState } from '../../shared/types';
import { AgentLabelContent } from './AgentLabelContent';

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
  startedAt: 0,
  updatedAt: 0,
  ...over,
});

describe('AgentLabelContent', () => {
  it('nome, chip area, token, stato', () => {
    render(<AgentLabelContent agent={agent()} />);
    expect(screen.getByText('Implementa HUD')).toBeTruthy();
    const chip = screen.getByText('frontend');
    expect(chip.getAttribute('data-area')).toBe('frontend');
    expect(screen.getByText('12.3k')).toBeTruthy();
    expect(screen.getByText(/al lavoro/i)).toBeTruthy();
  });

  it('barra determinata completed/total con %', () => {
    render(<AgentLabelContent agent={agent()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('1/4 · 25%')).toBeTruthy();
  });

  it('barra indeterminata se progress null (senza aria-valuenow)', () => {
    render(<AgentLabelContent agent={agent({ progress: null })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.className).toContain('hud-bar--indeterminate');
  });

  it('total 0 → indeterminata', () => {
    render(<AgentLabelContent agent={agent({ progress: { completed: 0, total: 0 } })} />);
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
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
    expect(screen.getByText(/inattivo/i)).toBeTruthy();
  });
});
