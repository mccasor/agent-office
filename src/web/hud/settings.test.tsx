// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, type SettingKey } from '../../shared/settings';
import type { AgentState, SessionState } from '../../shared/types';
import { useOfficeStore } from '../store';
import { AgentCard } from './AgentCard';
import { InstancesPanel } from './InstancesPanel';
import { ListView } from './ListView';
import { TodayBar } from './TodayBar';

/** Voci nascoste dalla finestra Impostazioni (#94) applicate ai componenti: ogni voce sparisce da tutti i suoi posti. */

afterEach(() => {
  cleanup();
  useOfficeStore.setState({ settings: DEFAULT_DISPLAY });
});

const tokens = { input: 0, output: 2_345, cacheRead: 0, cacheCreation: 0, total: 9_999 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: null, model: 'claude-opus-5-5', effort: 'high', context: { used: 50_000, window: 200_000 },
  tokensUsed: tokens, startedAt: 0, updatedAt: 10, active: true, status: 'working', issues: [],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office',
  diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 }, ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0, ...over,
});
const boss = agent({ id: 'boss:s1', name: 'Claudio Code', agentType: 'main' });
const today = { since: 0, cost: 3.4, costLastHour: 0.25, launched: 5, finished: 3, failed: 1, waitingMs: 0 };
/** subagente con tutto: nome di persona e compito, issue, avanzamento, errori dei tool, avviso "in loop" */
const busy = agent({
  id: 'a2', nickname: 'Marta Commit', issues: [14], progress: { completed: 1, total: 4 }, model: 'claude-haiku', effort: 'low',
  toolErrors: { count: 2, tool: 'Edit', at: 0 }, alert: { kind: 'loop', tool: 'Bash', count: 6 },
});
const failed = agent({ id: 'a3', nickname: 'Rita Lint', status: 'done', outcome: 'failed', cost: 0.3, updatedAt: 5 * 60_000, toolErrors: { count: 1, tool: 'Bash', at: 0 } });
/** nessun separatore orfano: né " ·  · ", né all'inizio o alla fine */
const noOrphans = (text: string | null | undefined) => {
  expect(text ?? '').not.toMatch(/·\s*·|^\s*·|·\s*$/);
};

const hide = (...keys: SettingKey[]) =>
  act(() => useOfficeStore.getState().setSettings({ ...DEFAULT_DISPLAY, show: { ...DEFAULT_DISPLAY.show, ...Object.fromEntries(keys.map((k) => [k, false])) } }));

describe('voci da mostrare (#94)', () => {
  it('accordion: diff, contesto e conteggio per stato spariscono e ricompaiono subito', () => {
    render(<InstancesPanel sessions={[session()]} agents={[agent()]} bosses={[boss]} onSelect={() => {}} />);
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('1 al lavoro')).toBeTruthy();
    hide('session.diff', 'session.context', 'instances.counts');
    expect(screen.queryByText('+12')).toBeNull();
    expect(screen.queryByText('25%')).toBeNull();
    expect(screen.queryByText('1 al lavoro')).toBeNull();
    // il resto resta
    expect(screen.getByText('feat/board')).toBeTruthy();
    act(() => useOfficeStore.getState().setSettings(DEFAULT_DISPLAY));
    expect(screen.getByText('+12')).toBeTruthy();
  });

  it('lista e scheda di Claude: stesse voci, stessi interruttori', () => {
    hide('session.diff', 'session.context');
    render(<ListView sessions={[session({ context: { used: 150_000, window: 200_000 } })]} agents={[agent()]} hidden={[]} onToggle={() => {}} />);
    expect(screen.queryByText('+12')).toBeNull();
    expect(screen.queryByText(/Contesto 75%/)).toBeNull();
    cleanup();
    render(<AgentCard agent={boss} session={session()} />);
    expect(screen.queryByText('Contesto')).toBeNull();
    expect(screen.queryByText('+12')).toBeNull();
    expect(screen.getByText('feat/board')).toBeTruthy();
  });
});

describe('voci da mostrare: scheda (#94)', () => {
  it('subagente: ruolo, compito, issue, tipo, avviso, durata, modello, effort, avanzamento, errori, token e costo', () => {
    render(<AgentCard agent={busy} />);
    for (const text of ['frontend', 'Build HUD panel', '#14', 'Explore', 'claude-haiku', 'low', 'Avanzamento', 'Errori', 'Token', 'Costo stimato', 'Durata']) {
      expect(screen.queryAllByText(text, { exact: false }).length, text).toBeGreaterThan(0);
    }
    expect(screen.getByRole('status').textContent).toContain('Bash');
    hide(
      'agent.role', 'agent.task', 'agent.issues', 'agent.type', 'agent.alerts', 'agent.duration', 'agent.model', 'agent.effort',
      'agent.progress', 'agent.toolErrors', 'agent.tokens', 'agent.cost',
    );
    for (const text of ['frontend', 'Build HUD panel', '#14', 'Explore', 'claude-haiku', 'Avanzamento', 'Errori', 'Token', 'Costo stimato', 'Durata', 'Tipo', 'Effort']) {
      expect(screen.queryByText(text), text).toBeNull();
    }
    expect(screen.queryByRole('status')).toBeNull();
    // niente riga vuota delle chip, niente riquadro dei token
    expect(document.querySelector('.hud-card__chips')).toBeNull();
    expect(document.querySelector('.hud-tokens')).toBeNull();
    // il nome e lo stato restano
    expect(screen.getByText('Marta Commit')).toBeTruthy();
    expect(screen.getByText('Stato')).toBeTruthy();
  });

  it('subagente terminato: esito spento', () => {
    render(<AgentCard agent={failed} />);
    expect(screen.getByText('fallito')).toBeTruthy();
    hide('agent.outcome');
    expect(screen.queryByText('Esito')).toBeNull();
    expect(screen.queryByText('fallito')).toBeNull();
  });

  it('Claude stesso: voci della sessione, sezioni dei token sparite col titolo', () => {
    const s = session({ title: 'Rifare il pannello', issues: [7], toolErrors: { count: 1, tool: 'Bash', at: 0 }, turnStartedAt: 1, ownCost: 1, cost: 2 });
    render(<AgentCard agent={{ ...boss, description: 'Rifare il pannello', issues: [7] }} session={s} />);
    for (const text of ['Rifare il pannello', '#7', 'feat/board', 'Turno', 'Modello', 'Effort', 'Errori', 'Con i subagenti']) expect(screen.getByText(text), text).toBeTruthy();
    hide('session.title', 'session.issues', 'session.branch', 'session.turn', 'session.model', 'session.effort', 'session.toolErrors', 'session.tokens', 'session.cost');
    for (const text of ['Rifare il pannello', '#7', 'feat/board', 'Turno', 'Modello', 'Effort', 'Errori', 'Con i subagenti', 'Claude', 'Token']) {
      expect(screen.queryByText(text), text).toBeNull();
    }
    expect(document.querySelector('.hud-card__chips')).toBeNull();
    expect(screen.getByText('Progetto')).toBeTruthy();
  });

  it('solo il costo spento: i token restano, senza la riga del costo', () => {
    render(<AgentCard agent={busy} />);
    hide('agent.cost');
    expect(screen.getByText('Token')).toBeTruthy();
    expect(screen.queryByText('Costo stimato')).toBeNull();
  });
});

describe('voci da mostrare: lista (#94)', () => {
  const s = session({ title: 'Rifare il pannello', issues: [7], lastTurnMs: 60_000, cost: 1.5 });
  const list = (over: Partial<Parameters<typeof ListView>[0]> = {}) => (
    <ListView
      sessions={[s]} agents={[busy, failed]} finished={[failed]} hidden={[]} onToggle={() => {}} today={today} onMarkDone={() => {}}
      closedFinished={[{ id: 'a9', sessionId: 's9', project: 'vecchio', nickname: 'Ada Plan', agentType: 'Plan', area: 'docs', startedAt: 0, endedAt: 60_000, outputTokens: 10, cost: null }]}
      {...over}
    />
  );

  it('riga meta senza le voci spente e senza separatori orfani', () => {
    render(list());
    const meta = () => document.querySelector('.list-session__meta')!.textContent;
    expect(meta()).toContain('claude-opus-5-5 · high · 2.3k token generati');
    hide('session.model', 'session.effort', 'session.tokens', 'session.cost', 'session.turn');
    expect(meta()).toBe('al lavoro');
    hide('session.title', 'session.branch', 'session.issues');
    expect(screen.queryByText('Rifare il pannello')).toBeNull();
    expect(screen.queryByText('feat/board')).toBeNull();
    expect(screen.queryByText('#7')).toBeNull();
  });

  it('righe dei subagenti: ruolo (con il posto in griglia), compito, issue, avviso, durata, errori', () => {
    const { container } = render(list());
    const line = () => container.querySelector('.list-agent--working')!;
    expect(line().textContent).toContain('Bash ripetuto 6 volte · al lavoro · da ');
    expect(line().querySelector('.hud-alert__mark')).toBeTruthy();
    hide('agent.role', 'agent.task', 'agent.issues', 'agent.alerts', 'agent.duration', 'agent.progress', 'agent.toolErrors');
    expect(line().className).not.toContain('list-agent--alert');
    expect(line().querySelector('.hud-alert__mark')).toBeNull();
    expect(line().querySelector('.hud-chip')).toBeNull();
    expect(line().querySelector('.hud-bar')).toBeNull();
    // quattro colonne anche senza ruolo
    expect(line().children).toHaveLength(4);
    expect(line().querySelector('.list-agent__status')!.textContent).toBe('al lavoro');
    expect(line().textContent).not.toContain('Build HUD panel');
    expect(line().textContent).not.toContain('#14');
  });

  it('terminati: esito, costo, token e durata spenti senza separatori orfani', () => {
    const { container } = render(list());
    const done = () => [...container.querySelectorAll('.list-agent--done')];
    expect(done().some((li) => li.querySelector('.hud-outcome--failed'))).toBe(true);
    hide('agent.outcome', 'agent.duration', 'agent.tokens', 'agent.cost');
    for (const li of done()) {
      expect(li.querySelector('.hud-outcome')).toBeNull();
      noOrphans(li.querySelector('.list-agent__status')!.textContent);
    }
    // solo gli errori: senza " · " davanti
    expect(done().map((li) => li.querySelector('.list-agent__status')!.textContent)).toContain('1 errore');
  });

  it('barra "Oggi", gruppo dei terminati, terminati di oggi e delle istanze chiuse', () => {
    render(list());
    expect(screen.getByRole('region', { name: 'Oggi' })).toBeTruthy();
    expect(screen.getByText('1 terminato')).toBeTruthy();
    expect(screen.getByText('Terminati oggi (1)')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Terminati oggi nelle istanze chiuse' })).toBeTruthy();
    hide('today.list', 'instances.done', 'list.finishedToday', 'list.closedFinished');
    expect(screen.queryByRole('region', { name: 'Oggi' })).toBeNull();
    expect(screen.queryByText('1 terminato')).toBeNull();
    expect(screen.queryByText('Terminati oggi (1)')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Terminati oggi nelle istanze chiuse' })).toBeNull();
  });
});

describe('voci da mostrare: accordion e barra dell\'ufficio (#94)', () => {
  it('accordion: branch, issue, meta, turno, ruolo, compito, avviso e terminati', () => {
    const s = session({ issues: [7], lastTurnMs: 60_000, status: 'done', cost: 1 });
    const { container } = render(<InstancesPanel sessions={[s]} agents={[busy, failed]} bosses={[boss]} onSelect={() => {}} />);
    expect(container.querySelector('.hud-instance__meta')!.textContent).toBe('claude-opus-5-5 · high · 2.3k token generati · ≈ $1,00');
    expect(screen.getByText('Bash ripetuto 6 volte · al lavoro')).toBeTruthy();
    hide(
      'session.branch', 'session.issues', 'session.model', 'session.effort', 'session.tokens', 'session.cost', 'session.turn',
      'agent.role', 'agent.task', 'agent.alerts', 'instances.done',
    );
    expect(screen.queryByText('feat/board')).toBeNull();
    expect(screen.queryByText('#7')).toBeNull();
    // meta vuota: niente riga
    expect(container.querySelector('.hud-instance__meta')).toBeNull();
    expect(screen.queryByText(/ultimo turno/)).toBeNull();
    expect(screen.getByText('al lavoro')).toBeTruthy();
    expect(container.querySelector('.hud-chip')).toBeNull();
    expect(container.querySelector('.hud-alert__mark')).toBeNull();
    expect(screen.queryByText('Build HUD panel')).toBeNull();
    expect(container.querySelector('.hud-done-group')).toBeNull();
  });

  it('barra "Oggi" compatta dell\'ufficio, a parte da quella della lista', () => {
    render(<TodayBar today={today} compact />);
    expect(screen.getByLabelText('Oggi')).toBeTruthy();
    hide('today.list');
    expect(screen.getByLabelText('Oggi')).toBeTruthy();
    hide('today.office');
    expect(screen.queryByLabelText('Oggi')).toBeNull();
  });
});
