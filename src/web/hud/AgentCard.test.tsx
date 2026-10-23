// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, SessionState } from '../../shared/types';
import { AgentCard } from './AgentCard';

afterEach(cleanup);

const tokens = { input: 1_200, output: 3_400, cacheRead: 17_700_000, cacheCreation: 90_000, total: 17_794_600 };
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Implementa HUD', agentType: 'general-purpose', description: 'Pannelli del HUD e scheda agente',
  area: 'frontend', status: 'working', model: 'claude-sonnet-5', tokens, progress: { completed: 1, total: 4 }, issues: [77],
  startedAt: 0, updatedAt: 0, cost: 0.42, ...over,
});
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Vista 2D', model: 'claude-opus-5-5', effort: 'high', context: { used: 150_000, window: 200_000 },
  tokensUsed: tokens, startedAt: 0, updatedAt: 0, active: true, status: 'working', issues: [71],
  cwd: '/Users/x/agent-office', branch: 'feat/vista-2d', waiting: false, cost: 3.5, ...over,
});

describe('AgentCard', () => {
  it('subagente: nome, descrizione, tipo, stato, tool, durata, modello, avanzamento, issue, costo e token', () => {
    const t = Date.now();
    render(
      <AgentCard agent={agent({ startedAt: t - 5 * 60_000, tool: { name: 'Edit', target: 'hud.css', since: t } })} onClose={() => {}} />,
    );
    expect(screen.getByRole('region', { name: 'Scheda di Implementa HUD' })).toBeTruthy();
    expect(screen.getByText('Pannelli del HUD e scheda agente')).toBeTruthy();
    expect(screen.getByText('general-purpose')).toBeTruthy();
    expect(screen.getByText('frontend').getAttribute('data-area')).toBe('frontend');
    expect(screen.getByText('al lavoro')).toBeTruthy();
    expect(screen.getByText('Edit hud.css')).toBeTruthy();
    expect(screen.getByText('da 5 min')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
    expect(screen.getByText('#77')).toBeTruthy();
    expect(screen.getByTestId('agent-cost').textContent).toBe('≈ $0,42');
    expect(screen.getByText('1/4 · 25%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Avanzamento Implementa HUD' }).getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByTestId('tokens-total').textContent).toBe('17.8M');
    expect(screen.getByTestId('tokens-cacheRead').textContent).toBe('17.7M');
    // niente dati di sessione per un subagente
    expect(screen.queryByText('Progetto')).toBeNull();
  });

  it('terminato: quanto ha lavorato, niente tool né barra senza todo list', () => {
    const t = Date.now();
    render(
      <AgentCard
        agent={agent({ status: 'done', startedAt: t - 5 * 60_000, updatedAt: t - 60_000, progress: null, model: null, tool: { name: 'Bash', target: null, since: t } })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('terminato')).toBeTruthy();
    expect(screen.getByText('in 4 min')).toBeTruthy();
    expect(screen.queryByText('Bash')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('Claude stesso: progetto, branch, contesto, motivo del blocco e costo della sessione', () => {
    const t = Date.now();
    const boss = agent({ id: 'boss:s1', name: 'Claudio Code', agentType: 'main', description: '', progress: null, status: 'done' });
    render(
      <AgentCard
        agent={boss}
        session={session({ status: 'done', waiting: true, waitingKind: 'permission', waitingSince: t - 3 * 60_000, diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 } })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('agent-office')).toBeTruthy();
    expect(screen.getByText('feat/vista-2d')).toBeTruthy();
    expect(screen.getByText('Aspetta un tuo permesso · da 3 min')).toBeTruthy();
    expect(screen.getByText('pronta')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Contesto usato' }).getAttribute('data-level')).toBe('warn');
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByTestId('agent-cost').textContent).toBe('≈ $3,50');
  });

  it('si chiude con il pulsante e con Esc', () => {
    const onClose = vi.fn();
    render(<AgentCard agent={agent()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la scheda' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
