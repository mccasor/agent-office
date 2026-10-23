// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentVerdict } from '../../shared/types';
import { StatusCheck, VerdictNote } from './StatusCheck';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const verdict = (v: AgentVerdict) => ({ kind: 'verdict' as const, verdict: v });
const details = { tool: null, waiting: null, background: 0, lastOutputAt: null, claude: null };

describe('VerdictNote (#104)', () => {
  it('chiuso e terminato', () => {
    const { unmount } = render(<VerdictNote result={verdict({ kind: 'closed', checkedAt: Date.now() })} />);
    expect(screen.getByRole('status').textContent).toMatch(/^ChiusoLa sessione di Claude Code è terminata: l'agente risulta terminato \(interrotto\)/);
    unmount();
    render(<VerdictNote result={verdict({ kind: 'done', outcome: 'failed', checkedAt: Date.now() })} />);
    expect(screen.getByText('L\'agente ha finito: fallito.')).toBeTruthy();
  });

  it('in esecuzione: tool da quanto, comandi in background e ultimo output', () => {
    const t = Date.now();
    render(
      <VerdictNote
        result={verdict({ kind: 'running', checkedAt: t, ...details, tool: { name: 'Bash', since: t - 72 * 60_000 }, background: 2, lastOutputAt: t - 3 * 60_000 })}
      />,
    );
    expect(screen.getByText('In esecuzione')).toBeTruthy();
    expect(screen.getByText('Aspetta Bash da 1 h 12 min · aspetta 2 comandi in background (ultimo output 3 min fa)')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('in esecuzione: attesa dell\'utente; un comando senza output noto', () => {
    render(<VerdictNote result={verdict({ kind: 'running', checkedAt: Date.now(), ...details, waiting: 'permission', background: 1 })} />);
    expect(screen.getByText(/^Aspetta un tuo permesso · aspetta 1 comando in background \(output sconosciuto\)$/)).toBeTruthy();
  });

  it('probabilmente finito: "Segna come terminato" solo con onMarkDone', () => {
    const onMarkDone = vi.fn();
    const result = verdict({ kind: 'silent', checkedAt: Date.now(), ...details, claude: 'busy' });
    const { unmount } = render(<VerdictNote result={result} onMarkDone={onMarkDone} />);
    expect(screen.getByText('Probabilmente finito senza notifica')).toBeTruthy();
    expect(screen.queryByText('Claude è fermo in attesa di un prompt.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Segna come terminato' }));
    expect(onMarkDone).toHaveBeenCalledTimes(1);
    unmount();
    render(<VerdictNote result={result} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sconosciuto, con quello che si sa dal transcript; agente sparito; server che non risponde', () => {
    const t = Date.now();
    const { unmount } = render(<VerdictNote result={verdict({ kind: 'unknown', checkedAt: t, ...details, tool: { name: 'Read', since: t - 60_000 } })} />);
    expect(screen.getByText('Sconosciuto')).toBeTruthy();
    expect(screen.getByText(/^Manca il file di sessione di Claude Code/)).toBeTruthy();
    expect(screen.getByText('Aspetta Read da 1 min')).toBeTruthy();
    unmount();
    const { unmount: u2 } = render(<VerdictNote result={{ kind: 'missing' }} />);
    expect(screen.getByRole('status').textContent).toMatch(/^Agente non trovato/);
    u2();
    render(<VerdictNote result={{ kind: 'error' }} />);
    expect(screen.getByRole('status').textContent).toMatch(/^Controllo non riuscito/);
  });
});

describe('StatusCheck (#104)', () => {
  it('chiuso dal controllo stesso: l\'agente risulta terminato, il pulsante sparisce e il verdetto resta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ kind: 'closed', checkedAt: Date.now() }) })));
    const { rerender } = render(<StatusCheck agentId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Controlla stato' }));
    expect(await screen.findByText('Chiuso')).toBeTruthy();
    rerender(<StatusCheck agentId="a1" done />);
    expect(screen.getByText('Chiuso')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // terminato senza un controllo: niente
    rerender(<StatusCheck agentId="a2" done />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('chiede il verdetto al server ("Controllo…" mentre aspetta) e lo mostra; 404 = agente sparito; rete giù = errore', async () => {
    let answer: () => unknown = () => ({ ok: true, status: 200, json: async () => ({ kind: 'closed', checkedAt: Date.now() }) });
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal('fetch', fetchMock);
    render(<StatusCheck agentId="a/1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Controlla stato' }));
    expect(screen.getByRole('button', { name: 'Controllo…' }).hasAttribute('disabled')).toBe(true);
    expect(await screen.findByText('Chiuso')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/a%2F1/status', { cache: 'no-store' });
    answer = () => ({ ok: false, status: 404, json: async () => null });
    fireEvent.click(screen.getByRole('button', { name: 'Controlla stato' }));
    expect(await screen.findByText(/^Agente non trovato/)).toBeTruthy();
    answer = () => {
      throw new TypeError('rete');
    };
    fireEvent.click(screen.getByRole('button', { name: 'Controlla stato' }));
    expect(await screen.findByText(/^Controllo non riuscito/)).toBeTruthy();
  });
});
