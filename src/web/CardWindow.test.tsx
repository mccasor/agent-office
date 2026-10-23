// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, SessionState, Snapshot } from '../shared/types';
import { CardWindow } from './CardWindow';
import { useOfficeStore } from './store';

// niente EventSource in jsdom: lo snapshot si imposta a mano nello store
vi.mock('./store', async (orig) => ({ ...(await orig<typeof import('./store')>()), connectSnapshotStream: () => () => {} }));

const tokens = { input: 0, output: 2_345, cacheRead: 0, cacheCreation: 0, total: 9_999 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Board', model: 'claude-opus-5-5', effort: 'high', context: { used: 50_000, window: 200_000 },
  tokensUsed: tokens, startedAt: 0, updatedAt: 10, active: true, status: 'working', issues: [92],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office', ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', nickname: 'Marta Commit', agentType: 'Explore', description: '',
  area: 'frontend', status: 'working', model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0, ...over,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  status: 'working', sessions: [session()], agents: [agent()], finished: [], generatedAt: 0, ...over,
});
const push = (s: Snapshot) => act(() => useOfficeStore.getState().setSnapshot(s));

beforeEach(() => {
  useOfficeStore.setState({ snapshot: null, connected: true });
  document.title = 'Agent Office';
  vi.spyOn(window, 'resizeBy').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('CardWindow', () => {
  it('a misura del contenuto: nel browser il popup si ridimensiona, il titolo resta il nome', () => {
    render(<CardWindow kind="agent" id="a1" />);
    expect(document.documentElement.classList.contains('card-window-root')).toBe(true);
    // contenuto vuoto in jsdom: l'altezza minima, dalla finestra di 768px
    expect(window.resizeBy).toHaveBeenCalledWith(0, 280 - window.innerHeight);
    push(snap());
    expect(document.title).toBe('Marta Commit');
    cleanup();
    expect(document.documentElement.classList.contains('card-window-root')).toBe(false);
  });

  it('nell\'app (app=1) l\'altezza viaggia nel titolo, dopo il nome', () => {
    history.replaceState(null, '', '/?card=agent&id=a1&app=1');
    render(<CardWindow kind="agent" id="a1" />);
    expect(window.resizeBy).not.toHaveBeenCalled();
    expect(document.title).toBe('Agent Office280-1');
    push(snap());
    expect(document.title).toBe('Marta Commit280-1');
  });

  it('scheda di un agente: solo la scheda, titolo della finestra = nome, senza pulsanti di chiusura', () => {
    render(<CardWindow kind="agent" id="a1" />);
    expect(screen.getByText('Connessione all\'ufficio…')).toBeTruthy();
    push(snap());
    expect(screen.getByRole('region', { name: 'Scheda di Marta Commit' })).toBeTruthy();
    expect(screen.getByText('al lavoro')).toBeTruthy();
    expect(document.title).toBe('Marta Commit');
    expect(screen.queryByRole('button', { name: 'Chiudi la scheda' })).toBeNull();
    expect(screen.queryByRole('button', { name: /in una finestra/ })).toBeNull();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('aggiornata in tempo reale; agente sparito: ultimo stato noto con una nota', () => {
    render(<CardWindow kind="agent" id="a1" />);
    push(snap());
    push(snap({ agents: [agent({ status: 'idle' })] }));
    expect(screen.getByText('inattivo')).toBeTruthy();
    push(snap({ agents: [] }));
    expect(screen.getByRole('status').textContent).toMatch(/Uscito dall'ufficio/);
    expect(screen.getByRole('region', { name: 'Scheda di Marta Commit' })).toBeTruthy();
    expect(screen.getByText('terminato')).toBeTruthy();
  });

  it('agente già uscito (cronologia): la scheda resta, senza nota', () => {
    render(<CardWindow kind="agent" id="a1" />);
    push(snap({ agents: [], finished: [agent({ status: 'done' })] }));
    expect(screen.getByText('terminato')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Claude stesso: dati della sessione; istanza chiusa: ultimo stato noto', () => {
    render(<CardWindow kind="agent" id="boss:s1" />);
    push(snap());
    expect(screen.getByRole('region', { name: 'Scheda di Claudio Code' })).toBeTruthy();
    expect(screen.getByText('feat/board')).toBeTruthy();
    push(snap({ sessions: [session({ active: false })] }));
    expect(screen.getByRole('status').textContent).toMatch(/Istanza chiusa/);
    expect(screen.getByRole('region', { name: 'Scheda di Claudio Code' })).toBeTruthy();
  });

  it('agente mai visto: lo dice', () => {
    render(<CardWindow kind="agent" id="nessuno" />);
    push(snap());
    expect(screen.getByRole('status').textContent).toMatch(/Agente non trovato/);
  });

  it('istanza: informazioni e agenti, titolo = progetto; il clic su un agente apre la sua scheda', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<CardWindow kind="session" id="s1" />);
    push(snap());
    expect(screen.getByRole('region', { name: 'Istanza agent-office' })).toBeTruthy();
    expect(screen.getByText('#92')).toBeTruthy();
    expect(document.title).toBe('agent-office');
    expect(screen.getByRole('button', { name: /Claudio Code/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Marta Commit/ }));
    expect(open).toHaveBeenCalledWith(`${location.origin}/?card=agent&id=a1`, 'agent-office-agent-a1', expect.stringContaining('popup'));
    open.mockRestore();
  });

  it('istanza chiusa: ultimo stato noto con una nota', () => {
    render(<CardWindow kind="session" id="s1" />);
    push(snap());
    push(snap({ sessions: [], agents: [] }));
    expect(screen.getByRole('status').textContent).toMatch(/Istanza chiusa/);
    expect(screen.getByRole('region', { name: 'Istanza agent-office' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marta Commit/ })).toBeTruthy();
  });
});
