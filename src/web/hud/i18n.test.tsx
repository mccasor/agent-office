// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, type Locale } from '../../shared/i18n';
import { DEFAULT_DISPLAY } from '../../shared/settings';
import type { AgentState, SessionState } from '../../shared/types';
import { useOfficeStore } from '../store';
import { AgentCard } from './AgentCard';
import { formatCost, formatDuration, formatTokens } from './format';
import { HistoryReportView } from './HistoryView';
import { eventLabel } from './historyLabels';
import { InstancesPanel } from './InstancesPanel';
import { alertShort, alertText, stateCounts, statusText, waitingText } from './labels';
import { ListView } from './ListView';
import { todayItems } from './TodayBar';

/** Lingua dell'interfaccia (#93): inglese e spagnolo, plurali, numeri e cambio al volo (l'italiano è nei test di sempre). */

const speak = (locale: Locale) => act(() => useOfficeStore.getState().setSettings({ ...DEFAULT_DISPLAY, language: locale, locale }));

afterEach(() => {
  cleanup();
  act(() => useOfficeStore.getState().setSettings(DEFAULT_DISPLAY));
});

const tokens = { input: 0, output: 2_345, cacheRead: 0, cacheCreation: 0, total: 9_999 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: null, model: 'claude-opus-5-5', effort: 'high', context: { used: 50_000, window: 200_000 },
  tokensUsed: tokens, startedAt: 0, updatedAt: 10, active: true, status: 'working', issues: [],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office',
  diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 }, cost: 1.5, ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', nickname: 'Marta Commit', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0, ...over,
});
const boss = agent({ id: 'boss:s1', name: 'Claudio Code', nickname: undefined, agentType: 'main' });
const MIN = 60_000;

describe('lingua dell\'interfaccia (#93)', () => {
  it('numeri, costi e durate secondo la lingua', () => {
    expect([formatTokens(1234), formatCost(0.42), formatCost(0.001), formatDuration(72 * MIN), formatDuration(72 * MIN, true)])
      .toEqual(['1.2k', '≈ $0,42', '< $0,01', '1 h 12', '1 h 12 min']);
    speak('en');
    expect([formatTokens(1234), formatCost(0.42), formatCost(0.001), formatDuration(72 * MIN), formatDuration(30 * 1000)])
      .toEqual(['1.2k', '≈ $0.42', '< $0.01', '1h 12m', '<1m']);
    speak('es');
    expect([formatTokens(1234), formatCost(12.5), formatCost(0.001), formatDuration(72 * MIN, true), formatDuration(120 * MIN)])
      .toEqual(['1,2k', '≈\u00a012,50\u00a0$', '< 0,01\u00a0$', '1 h 12 min', '2 h']);
  });

  it('stati, attese, avvisi e plurali in inglese e in spagnolo', () => {
    const agents = [agent(), agent({ status: 'idle' }), agent({ status: 'done' }), agent({ status: 'done' })];
    const now = 72 * MIN;
    speak('en');
    expect(stateCounts(agents)).toBe('1 working · 1 idle · 2 finished');
    expect(waitingText('permission', 3 * MIN, 6 * MIN)).toBe('waiting for your permission · for 3m');
    expect(statusText(agent({ status: 'idle', updatedAt: 0 }), now)).toBe('idle for 1h 12m');
    expect(alertShort({ kind: 'loop', tool: 'Bash', count: 6 }, now)).toBe('Bash repeated 6 times');
    expect(eventLabel({ kind: 'wait', waitingKind: 'plan' })).toBe('waiting for plan approval');
    expect(todayItems({ since: 0, cost: 3.4, costLastHour: 0.25, launched: 1, finished: 3, failed: 0, waitingMs: 0 }).map((i) => i.label))
      .toEqual(['cost', 'last hour', 'launched', 'finished', 'failed', 'waiting']);
    speak('es');
    expect(stateCounts(agents)).toBe('1 trabajando · 1 inactivo · 2 terminados');
    expect(stateCounts([agent({ status: 'idle' }), agent({ status: 'idle' })])).toBe('2 inactivos');
    expect(alertText({ kind: 'stale', since: 0 }, now)).toBe('Sin actividad desde hace 1 h 12 min: puede que haya terminado sin que la oficina lo notara');
    expect(todayItems({ since: 0, cost: 3.4, costLastHour: 0.25, launched: 1, finished: 3, failed: 2, waitingMs: 0 }).map((i) => i.label))
      .toEqual(['coste', 'última hora', 'lanzado', 'terminados', 'fallidos', 'esperando']);
  });

  it('cambio al volo: lista e accordion si ridisegnano nella lingua nuova, senza perdere lo stato', () => {
    render(
      <>
        <ListView sessions={[session()]} agents={[agent()]} hidden={[]} onToggle={() => {}} />
        <InstancesPanel sessions={[session()]} agents={[agent()]} bosses={[boss]} onSelect={() => {}} />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Istanze aperte' })).toBeTruthy();
    expect(screen.getByText('Nell\'ufficio')).toBeTruthy();
    speak('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('heading', { name: 'Open Instances' })).toBeTruthy();
    expect(screen.getByText('In the office')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search project, branch or agent')).toBeTruthy();
    expect(screen.getAllByText('Context 25%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 files').length).toBeGreaterThan(0);
    // l'accordion resta aperto: i nomi propri non si traducono
    expect(screen.getAllByText('Marta Commit').length).toBeGreaterThan(0);
    speak('es');
    expect(screen.getByRole('heading', { name: 'Instancias abiertas' })).toBeTruthy();
    expect(screen.getByText('En la oficina')).toBeTruthy();
    expect(screen.getAllByText('1 trabajando').length).toBeGreaterThan(0);
    speak('it');
    expect(screen.getByRole('heading', { name: 'Istanze aperte' })).toBeTruthy();
  });

  it('scheda dell\'agente e analisi in spagnolo', () => {
    speak('es');
    render(<AgentCard agent={agent({ toolErrors: { count: 2, tool: 'Edit', at: 0 } })} onClose={() => {}} />);
    expect(screen.getByRole('region', { name: 'Ficha de Marta Commit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar la ficha' })).toBeTruthy();
    expect(screen.getByText('Estado')).toBeTruthy();
    expect(screen.getByText(/^2 errores de herramientas · último Edit a las /)).toBeTruthy();
    cleanup();
    render(<HistoryReportView report={{ day: '2026-10-23', days: ['2026-10-23'], waits: { count: 1, totalMs: 3 * MIN, sessions: [] }, events: [], byType: [], files: [] }} />);
    expect(screen.getByText('1 espera · 3 min esperando')).toBeTruthy();
    expect(screen.getByText('Sin eventos')).toBeTruthy();
    expect(screen.getByText('Archivos más tocados')).toBeTruthy();
  });
});
