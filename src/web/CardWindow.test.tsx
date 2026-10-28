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
    // inattivo: da quanto è fermo (B1)
    expect(screen.getByText(/^fermo da /)).toBeTruthy();
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

  it('istanza: schede "Istanza" e "Git" (#109), aperta su Git con `tab=git` nell\'URL', async () => {
    const report = { day: '2026-10-28', days: ['2026-10-28'], status: 'not-repo', project: null, branch: null, commits: [], truncated: false };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(report), { status: 200 })));
    history.replaceState(null, '', '/?card=session&id=s1&tab=git');
    render(<CardWindow kind="session" id="s1" />);
    push(snap());
    expect(screen.getByRole('tab', { name: 'Git' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('La cartella dell\'istanza non è un repository git')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Istanza' }));
    expect(screen.getByRole('button', { name: /Claudio Code/ })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('istanza chiusa: ultimo stato noto con una nota', () => {
    render(<CardWindow kind="session" id="s1" />);
    push(snap());
    push(snap({ sessions: [], agents: [] }));
    expect(screen.getByRole('status').textContent).toMatch(/Istanza chiusa/);
    expect(screen.getByRole('region', { name: 'Istanza agent-office' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marta Commit/ })).toBeTruthy();
  });

  describe('"Controlla stato" e segnati come terminati (#104)', () => {
    const stale = () => agent({ status: 'idle', updatedAt: 1_000, alert: { kind: 'stale', since: 1_000 } });
    const silent = { kind: 'silent', checkedAt: 5_000, tool: null, waiting: null, background: 0, lastOutputAt: null, claude: null };
    beforeEach(() => {
      useOfficeStore.setState({ markedDone: {} });
      localStorage.clear();
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => silent })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('dalla scheda staccata: verdetto, "Segna come terminato" salvato per le altre finestre, poi "Annulla"', async () => {
      render(<CardWindow kind="agent" id="a1" />);
      push(snap({ agents: [stale()] }));
      expect(screen.queryByRole('button', { name: 'Fallo uscire' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Controlla stato' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Segna come terminato' }));
      expect(Object.keys(JSON.parse(localStorage.getItem('agent-office.markedDone')!))).toEqual(['a1']);
      expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/^Segnato come terminato da te/);
      expect(screen.getByRole('region', { name: 'Scheda di Marta Commit' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Controlla stato' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
      expect(JSON.parse(localStorage.getItem('agent-office.markedDone')!)).toEqual({});
      expect(screen.getByRole('button', { name: 'Controlla stato' })).toBeTruthy();
    });

    it('segnato in un\'altra finestra: l\'evento storage aggiorna la scheda; tornato attivo, rientra da solo', () => {
      render(<CardWindow kind="agent" id="a1" />);
      push(snap({ agents: [stale()] }));
      act(() => {
        localStorage.setItem('agent-office.markedDone', JSON.stringify({ a1: 2_000 }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'agent-office.markedDone' }));
      });
      expect(screen.getByRole('button', { name: 'Annulla' })).toBeTruthy();
      push(snap({ agents: [agent({ updatedAt: 3_000 })] }));
      expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
    });

    it('scheda di un\'istanza: senza i segnati come terminati, e niente "N fatti uscire"', () => {
      useOfficeStore.setState({ markedDone: { a2: 5_000 } });
      render(<CardWindow kind="session" id="s1" />);
      push(snap({ agents: [agent(), agent({ id: 'a2', nickname: 'Gino Fermo', updatedAt: 1_000 })] }));
      expect(screen.queryByText('Gino Fermo')).toBeNull();
      expect(screen.getByText('Marta Commit')).toBeTruthy();
      expect(document.querySelector('.hud-dismissed')).toBeNull();
    });
  });
});
