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
  cwd: '/Users/x/agent-office', branch: 'feat/vista-2d', waiting: false, cost: 3.5, dot: 'working', project: 'agent-office', ...over,
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
    expect(screen.getByText('al lavoro · Edit hud.css')).toBeTruthy();
    expect(screen.getByText('da 5 min')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
    expect(screen.getByText('#77')).toBeTruthy();
    expect(screen.getByTestId('agent-cost').textContent).toBe('≈ $0,42');
    expect(screen.getByText('1/4 · 25%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Avanzamento Implementa HUD' }).getAttribute('aria-valuenow')).toBe('25');
    // output e input effettivo (input + scrittura in cache); il dettaglio in un riquadro chiuso
    expect(screen.getByTestId('tokens-summary').textContent).toBe('Output 3.4k · Input effettivo 91.2k');
    expect(screen.getByTestId('tokens-cacheRead').textContent).toBe('17.7M');
    expect(screen.getByTestId('tokens-cacheRead').closest('details')?.open).toBe(false);
    // niente dati di sessione per un subagente
    expect(screen.queryByText('Progetto')).toBeNull();
  });

  it('nome di persona come titolo, il compito sotto, il ruolo nella chip (#88)', () => {
    render(<AgentCard agent={agent({ nickname: 'Marta Commit', area: 'architecture' })} onClose={() => {}} />);
    expect(screen.getByRole('region', { name: 'Scheda di Marta Commit' })).toBeTruthy();
    expect(screen.getByText('Implementa HUD')).toBeTruthy();
    expect(screen.getByText('architect').getAttribute('data-area')).toBe('architecture');
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
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('subagente: effort, tool aperto da minuti e inattivo fermo da quanto (B1, B7)', () => {
    const t = Date.now();
    const { unmount } = render(
      <AgentCard agent={agent({ effort: 'low', status: 'idle', tool: { name: 'Bash', target: null, since: t - 4 * 60_000 } })} />,
    );
    expect(screen.getByText('low')).toBeTruthy();
    expect(screen.getByText('Bash da 4 min')).toBeTruthy();
    unmount();
    render(<AgentCard agent={agent({ status: 'idle', updatedAt: t - 12 * 60_000 })} />);
    expect(screen.getByText('fermo da 12 min')).toBeTruthy();
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
    // lo stato è coerente con l'attesa
    expect(screen.getByText('aspetta un tuo permesso · da 3 min')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Contesto usato' }).getAttribute('data-level')).toBe('warn');
    expect(screen.getByText('+12')).toBeTruthy();
    // niente ruolo né tipo per Claude stesso
    expect(screen.queryByText('architect')).toBeNull();
    expect(screen.queryByText('Tipo')).toBeNull();
  });

  it('Claude stesso: token e costo suoi separati da quelli con i subagenti; turno corrente e ultimo; compattazioni', () => {
    const t = Date.now();
    const boss = agent({ id: 'boss:s1', name: 'Claudio Code', agentType: 'main', description: '', progress: null });
    const own = { input: 100, output: 1_000, cacheRead: 5_000, cacheCreation: 2_000, total: 8_100 };
    const { unmount } = render(
      <AgentCard
        agent={boss}
        session={session({
          ownTokens: own, ownCost: 1.25, turnStartedAt: t - 3 * 60_000, lastTurnMs: 12 * 60_000, context: { used: 190_000, window: 200_000 },
          compactions: 2, lastCompaction: { at: t, trigger: 'auto', preTokens: 253_619, postTokens: 7_593 },
        })}
      />,
    );
    expect(screen.getByTestId('agent-cost').textContent).toBe('≈ $1,25');
    expect(screen.getByTestId('session-cost').textContent).toBe('≈ $3,50');
    expect(screen.getAllByTestId('tokens-summary').map((e) => e.textContent)).toEqual([
      'Output 1k · Input effettivo 2.1k',
      'Output 3.4k · Input effettivo 91.2k',
    ]);
    expect(screen.getByText('al lavoro')).toBeTruthy();
    expect(screen.getByText('in corso da 3 min')).toBeTruthy();
    expect(screen.getByText('12 min')).toBeTruthy();
    expect(screen.getByText('Compattato 2 volte · ultima 254k → 7.6k (auto)')).toBeTruthy();
    expect(screen.getByText('conviene /compact')).toBeTruthy();
    unmount();
    // pronto: il turno è chiuso, resta l'ultimo; contesto sotto il 50% senza barra
    render(<AgentCard agent={boss} session={session({ status: 'done', turnStartedAt: t - 60_000, lastTurnMs: 60_000, context: { used: 20_000, window: 200_000 } })} />);
    expect(screen.getByText('pronto')).toBeTruthy();
    expect(screen.queryByText('Turno')).toBeNull();
    expect(screen.getByText('Ultimo turno')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('subagente bloccato: motivo del blocco; Claude bloccato da un subagente lo dice', () => {
    const t = Date.now();
    const { unmount } = render(
      <AgentCard agent={agent({ waiting: true, waitingKind: 'question', waitingSince: t - 2 * 60_000 })} onClose={() => {}} />,
    );
    expect(screen.getByText('Ti ha fatto una domanda · da 2 min')).toBeTruthy();
    unmount();
    const boss = agent({ id: 'boss:s1', name: 'Claudio Code', agentType: 'main', description: '', progress: null });
    render(
      <AgentCard
        agent={boss}
        session={session({ waiting: true, waitingKind: 'permission', waitingSince: t - 60_000, waitingAgentId: 'a1' })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Un subagente aspetta un tuo permesso · da 1 min')).toBeTruthy();
  });

  it('si chiude con il pulsante e con Esc', () => {
    const onClose = vi.fn();
    render(<AgentCard agent={agent()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi la scheda' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('pulsante "apri in una finestra" (#92); senza onClose e onPopOut niente pulsanti né Esc', () => {
    const onPopOut = vi.fn();
    const { unmount } = render(<AgentCard agent={agent()} onClose={() => {}} onPopOut={onPopOut} />);
    const btn = screen.getByRole('button', { name: 'Apri la scheda in una finestra' });
    expect(btn.getAttribute('title')).toBe('Apri la scheda in una finestra');
    fireEvent.click(btn);
    expect(onPopOut).toHaveBeenCalledTimes(1);
    unmount();
    render(<AgentCard agent={agent()} />);
    // solo "Controlla stato" (#104), che c'è sempre per un subagente non terminato
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Controlla stato']);
    fireEvent.keyDown(window, { key: 'Escape' });
  });
});

describe('AgentCard: cruscotto (#97)', () => {
  it('fermo: l\'avviso invita a usare "Controlla stato"; niente più "Fallo uscire" (#104)', () => {
    const t = Date.now();
    const stale = agent({ status: 'idle', updatedAt: t - 72 * 60_000, alert: { kind: 'stale', since: t - 72 * 60_000 } });
    render(<AgentCard agent={stale} onMarkDone={() => {}} />);
    expect(
      screen.getByText('Nessuna attività da 1 h 12 min: potrebbe aver finito senza che l\'ufficio se ne accorgesse. Usa «Controlla stato» per saperlo'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Controlla stato' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fallo uscire' })).toBeNull();
  });

  it('in loop: testo diverso, e "Controlla stato" come per tutti i subagenti al lavoro', () => {
    render(<AgentCard agent={agent({ alert: { kind: 'loop', tool: 'Bash', count: 6 } })} />);
    expect(screen.getByText('Ha chiamato Bash con lo stesso input 6 volte di fila: potrebbe essere in un loop')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Controlla stato' })).toBeTruthy();
  });

  it('niente "Controlla stato" per un terminato né per Claude stesso', () => {
    const { unmount } = render(<AgentCard agent={agent({ status: 'done', outcome: 'ok' })} />);
    expect(screen.queryByRole('button', { name: 'Controlla stato' })).toBeNull();
    unmount();
    render(<AgentCard agent={agent({ id: 'boss:s1' })} session={session()} />);
    expect(screen.queryByRole('button', { name: 'Controlla stato' })).toBeNull();
  });

  it('terminato: esito ed errori dei tool (nome e ora, mai il testo)', () => {
    const at = new Date(2026, 9, 23, 14, 32).getTime();
    render(<AgentCard agent={agent({ status: 'done', outcome: 'failed', toolErrors: { count: 3, tool: 'Edit', at } })} />);
    expect(screen.getByText('fallito').className).toContain('hud-outcome--failed');
    expect(screen.getByText('3 errori dei tool · ultimo Edit alle 14:32')).toBeTruthy();
  });
});
