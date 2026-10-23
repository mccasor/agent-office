// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryReport, SessionState } from '../../shared/types';
import { toView } from '../store';
import { eventDuration, eventLabel } from './historyLabels';
import { finishedAsAgent, HistoryReportView, HistoryView } from './HistoryView';
import { ListView } from './ListView';

afterEach(cleanup);

const MIN = 60_000;
const at = (h: number, m: number) => new Date(2026, 9, 23, h, m).getTime();

const report = (over: Partial<HistoryReport> = {}): HistoryReport => ({
  day: '2026-10-23',
  days: ['2026-10-23', '2026-10-22'],
  events: [
    { at: at(10, 42), kind: 'agent-end', sessionId: 's1', project: 'agent-office', agent: 'Marta Commit', agentType: 'Explore', durationMs: 4 * MIN },
    { at: at(10, 30), kind: 'wait', sessionId: 's1', project: 'agent-office', tool: 'Bash', waitingKind: 'permission' },
  ],
  waits: { count: 3, totalMs: 12 * MIN, sessions: [{ sessionId: 's1', project: 'agent-office', count: 3, totalMs: 12 * MIN }] },
  byType: [{ agentType: 'Explore', count: 2, avgMs: 6 * MIN, cost: 1.2, avgCost: 0.6 }],
  files: [{ name: 'parser.ts', count: 4 }, { name: 'types.ts', count: 1 }],
  ...over,
});

describe('HistoryReportView', () => {
  it('attese, cronologia, statistiche per tipo e file più toccati', () => {
    render(<HistoryReportView report={report()} />);
    const waits = screen.getByRole('region', { name: 'Attese' });
    expect(waits.textContent).toContain('3 attese · 12 min in attesa');
    expect(waits.textContent).toContain('agent-office');

    const items = within(screen.getByRole('region', { name: 'Cronologia' })).getAllByRole('listitem');
    expect(items[0]!.textContent).toBe('10:42agente terminato · Marta Commit (Explore) · agent-office · in 4 min');
    expect(items[1]!.textContent).toBe('10:30in attesa di un permesso · Bash · agent-office');

    const row = within(screen.getByRole('region', { name: 'Per tipo di agente' })).getByRole('row', { name: /Explore/ });
    expect(row.textContent).toBe('Explore26 min≈ $1,20≈ $0,60');

    const files = within(screen.getByRole('region', { name: 'File più toccati' })).getAllByRole('listitem');
    expect(files.map((f) => f.textContent)).toEqual(['parser.ts4', 'types.ts1']);
  });

  it('sezioni vuote con il loro messaggio', () => {
    render(<HistoryReportView report={report({ events: [], waits: { count: 0, totalMs: 0, sessions: [] }, byType: [], files: [] })} />);
    expect(screen.getByText('Nessuna attesa')).toBeTruthy();
    expect(screen.getByText('Nessun evento')).toBeTruthy();
    expect(screen.getByText('Nessun agente terminato')).toBeTruthy();
    expect(screen.getByText('Nessun file')).toBeTruthy();
  });
});

describe('HistoryView', () => {
  it('carica oggi, poi il giorno scelto; un errore mostra il messaggio', async () => {
    const load = vi.fn(async (day: string | null) => report({ day: day ?? '2026-10-23' }));
    render(<HistoryView load={load} />);
    expect(screen.getByText('Caricamento…')).toBeTruthy();
    const select = await screen.findByRole('combobox', { name: 'Giorno' });
    expect(load).toHaveBeenCalledWith(null);
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['2026-10-23 (oggi)', '2026-10-22']);
    fireEvent.change(select, { target: { value: '2026-10-22' } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('2026-10-22'));
    cleanup();

    render(<HistoryView load={() => Promise.reject(new Error('no'))} />);
    expect(await screen.findByText('Storico non disponibile')).toBeTruthy();
  });
});

describe('etichette', () => {
  it('evento e durata', () => {
    expect(eventLabel({ kind: 'wait', waitingKind: 'question' })).toBe('in attesa di una risposta');
    expect(eventLabel({ kind: 'session-close' })).toBe('istanza chiusa');
    expect(eventDuration({ kind: 'unblock', durationMs: 3 * MIN })).toBe('dopo 3 min');
    expect(eventDuration({ kind: 'compact' })).toBeNull();
  });

  it('la vista analisi è una vista valida', () => {
    expect(toView('history')).toBe('history');
  });
});

describe('terminati delle istanze chiuse nella lista (B5)', () => {
  const session: SessionState = {
    id: 's1', title: null, model: null, effort: null, context: { used: 0, window: null }, tokensUsed: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
    startedAt: 0, updatedAt: 0, active: true, status: 'working', issues: [], cwd: '/x/agent-office', branch: null, waiting: false, dot: 'working', project: 'agent-office',
  };
  const closed = { id: 'a9', sessionId: 's9', project: 'vecchio', nickname: 'Rita Lint', agentType: 'Plan', area: 'docs' as const, startedAt: 0, endedAt: 5 * MIN, outputTokens: 2400, cost: 0.3 };

  it('in fondo alla lista, con nickname, tipo e progetto, durata, token e costo', () => {
    render(<ListView sessions={[session]} agents={[]} closedFinished={[closed]} hidden={[]} onToggle={() => {}} />);
    const block = screen.getByRole('region', { name: 'Terminati oggi nelle istanze chiuse' });
    expect(block.querySelector('summary')!.textContent).toBe('Terminati oggi nelle istanze chiuse (1)');
    expect(block.querySelector('li')!.textContent).toContain('Rita Lint');
    expect(block.querySelector('li')!.textContent).toContain('Plan · vecchio');
    expect(block.querySelector('li')!.textContent).toContain('in 5 min · 2.4k token · ≈ $0,30');
  });

  it('niente blocco senza terminati chiusi', () => {
    render(<ListView sessions={[session]} agents={[]} hidden={[]} onToggle={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Terminati oggi nelle istanze chiuse' })).toBeNull();
    expect(finishedAsAgent({ ...closed, project: null }).name).toBe('Plan');
  });
});
