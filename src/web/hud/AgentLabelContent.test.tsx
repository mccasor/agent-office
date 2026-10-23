// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  issues: [],
  startedAt: 0,
  updatedAt: 0,
  ...over,
});

describe('AgentLabelContent', () => {
  it('compatta di default: solo nome e barra, niente dettaglio', () => {
    render(<AgentLabelContent agent={agent()} />);
    expect(screen.getByText('Implementa HUD')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText('frontend')).toBeNull();
    expect(screen.queryByText('12.3k')).toBeNull();
    expect(screen.queryByText(/al lavoro/i)).toBeNull();
    expect(screen.queryByText('1/4 · 25%')).toBeNull();
  });

  it('hover sull\'etichetta mostra il dettaglio e notifica', () => {
    const changes: boolean[] = [];
    const { container } = render(<AgentLabelContent agent={agent()} onHoverChange={(h) => changes.push(h)} />);
    const label = container.firstElementChild!;
    fireEvent.mouseEnter(label);
    expect(screen.getByText('frontend')).toBeTruthy();
    expect(label.className).toContain('hud-label--expanded');
    fireEvent.mouseLeave(label);
    expect(screen.queryByText('frontend')).toBeNull();
    expect(changes).toEqual([true, false]);
  });

  it('ripartizione token nel dettaglio', () => {
    render(
      <AgentLabelContent
        expanded
        agent={agent({ tokens: { input: 1_200, output: 3_400, cacheRead: 17_700_000, cacheCreation: 90_000, total: 17_794_600 } })}
      />,
    );
    expect(screen.getByText('17.8M')).toBeTruthy();
    expect(screen.getByTestId('tokens-input').textContent).toBe('1.2k');
    expect(screen.getByTestId('tokens-output').textContent).toBe('3.4k');
    expect(screen.getByTestId('tokens-cacheRead').textContent).toBe('17.7M');
    expect(screen.getByTestId('tokens-cacheCreation').textContent).toBe('90k');
  });

  it('expanded (hover dalla scena): nome, chip area, token, stato', () => {
    render(<AgentLabelContent agent={agent()} expanded />);
    expect(screen.getByText('Implementa HUD')).toBeTruthy();
    const chip = screen.getByText('frontend');
    expect(chip.getAttribute('data-area')).toBe('frontend');
    expect(screen.getByText('12.3k')).toBeTruthy();
    expect(screen.getByText(/al lavoro/i)).toBeTruthy();
  });

  it('barra determinata completed/total con %', () => {
    render(<AgentLabelContent agent={agent()} expanded />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('1/4 · 25%')).toBeTruthy();
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
    const { container } = render(<AgentLabelContent agent={agent({ status: 'idle' })} expanded />);
    expect(container.firstElementChild!.className).toContain('hud-label--idle');
    expect(screen.getByText(/inattivo/i)).toBeTruthy();
  });
});
