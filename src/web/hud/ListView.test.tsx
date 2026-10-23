// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, SessionState } from '../../shared/types';
import { ListView, ViewToggle } from './ListView';

afterEach(cleanup);

const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 1234 };
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', title: 'Rifare la board', model: 'claude-opus-5-5', effort: 'high', context: { used: 0, window: null },
  tokensUsed: tokens, startedAt: 0, updatedAt: 0, active: true, status: 'working', issues: [14],
  cwd: '/Users/x/agent-office', branch: 'feat/board', waiting: false, dot: 'working', project: 'agent-office', ...over,
});
const agent = (over: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', sessionId: 's1', name: 'Build HUD panel', agentType: 'Explore', description: '', area: 'frontend',
  status: 'working', model: null, tokens, progress: { completed: 1, total: 4 }, issues: [22], startedAt: 0, updatedAt: 0, ...over,
});

describe('pallino e progetto dal server', () => {
  it('il pallino è quello calcolato dal server, il progetto il suo nome (o l\'inizio dell\'id)', () => {
    const { container } = render(
      <ListView
        sessions={[session({ dot: 'idle', status: 'working' }), session({ id: 'abcdef1234', project: null, updatedAt: 1 })]}
        agents={[agent()]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    expect([...container.querySelectorAll('.list-dot')].map((d) => d.className)).toEqual(['list-dot list-dot--idle', 'list-dot list-dot--working']);
    expect(screen.getByRole('region', { name: 'abcdef12' })).toBeTruthy();
  });
});

describe('ListView', () => {
  it('una scheda per sessione attiva con progetto, branch, issue e agenti; la casella sceglie l\'ufficio', () => {
    const onToggle = vi.fn();
    render(
      <ListView
        sessions={[session(), session({ id: 's2', active: false, cwd: '/old', project: 'old' })]}
        agents={[agent()]}
        hidden={[]}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByRole('region', { name: 'agent-office' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'old' })).toBeNull();
    expect(screen.getByText('feat/board')).toBeTruthy();
    expect(screen.getByText('#14')).toBeTruthy();
    expect(screen.getByText('#22')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'al lavoro' })).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: "Nell'ufficio" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith('s1');
  });

  it('diff del repository della sessione e durata degli agenti', () => {
    const t = Date.now();
    render(
      <ListView
        sessions={[session({ diff: { linesAdded: 12, linesRemoved: 3, filesChanged: 2 }, startedAt: t - 90 * 60_000 })]}
        agents={[agent({ startedAt: t - 5 * 60_000, progress: null }), agent({ id: 'a2', status: 'done', startedAt: t - 9 * 60_000, updatedAt: t - 7 * 60_000 })]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('-3')).toBeTruthy();
    expect(screen.getByText(/aperta da 1 h 30/)).toBeTruthy();
    expect(screen.getByText('al lavoro · da 5 min')).toBeTruthy();
    expect(screen.getByText('terminato · in 2 min')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('sessione pronta, bloccata con motivo, contesto e tool in uso', () => {
    const t = Date.now();
    render(
      <ListView
        sessions={[
          session({ status: 'done', context: { used: 150_000, window: 200_000 } }),
          session({ id: 's2', cwd: '/x/blocco', project: 'blocco', dot: 'waiting', waiting: true, waitingKind: 'permission', waitingSince: t - 3 * 60_000 }),
        ]}
        agents={[agent({ tool: { name: 'Edit', target: 'parser.ts', since: t }, startedAt: t })]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText(/· pronto/)).toBeTruthy();
    expect(screen.getByText(/aspetta un tuo permesso · da 3 min/)).toBeTruthy();
    expect(screen.getByText('Contesto 75%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /Contesto usato/ }).getAttribute('data-level')).toBe('warn');
    expect(screen.getByText(/Edit parser\.ts/)).toBeTruthy();
  });

  it('subagente bloccato: riga rossa con il motivo al posto dello stato e del tool', () => {
    const t = Date.now();
    const { container } = render(
      <ListView
        sessions={[session({ dot: 'waiting', waiting: true, waitingKind: 'question', waitingSince: t - 2 * 60_000, waitingAgentId: 'a1' })]}
        agents={[
          agent({ waiting: true, waitingKind: 'question', waitingSince: t - 2 * 60_000, startedAt: t, tool: { name: 'Bash', target: null, since: t } }),
          agent({ id: 'a2', name: 'Altro' }),
        ]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    const rows = container.querySelectorAll('.list-agent');
    expect(rows[0]?.className).toContain('list-agent--waiting');
    expect(rows[1]?.className).not.toContain('list-agent--waiting');
    expect(rows[0]?.querySelector('.list-agent__status')?.textContent).toBe('ti ha fatto una domanda · da 2 min · da <1 min');
    expect(screen.getByRole('img', { name: /aspetta un tuo input/ })).toBeTruthy();
  });

  it('terminati oggi della sessione, chiusi di default', () => {
    const t = Date.now();
    const { container } = render(
      <ListView
        sessions={[session()]}
        agents={[]}
        finished={[agent({ id: 'f1', name: 'Ricerca finita', status: 'done', startedAt: t - 5 * 60_000, updatedAt: t - 60_000, cost: 0.42 }), agent({ id: 'f2', sessionId: 'altra' })]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('Terminati oggi (1)')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(screen.getByText(/in 4 min · .* token · ≈ \$0,42/)).toBeTruthy();
  });

  it('filtro: ricerca su progetto e agenti, solo in attesa, nascondi terminati', () => {
    localStorage.clear();
    render(
      <ListView
        sessions={[session(), session({ id: 's2', cwd: '/x/olimpo-ui', project: 'olimpo-ui', dot: 'waiting', waiting: true })]}
        agents={[agent(), agent({ id: 'a2', name: 'Vecchio lavoro', status: 'done' })]}
        hidden={[]}
        onToggle={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca' }), { target: { value: 'OLIMPO' } });
    expect(screen.queryByRole('region', { name: 'agent-office' })).toBeNull();
    expect(screen.getByRole('region', { name: 'olimpo-ui' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca' }), { target: { value: 'hud' } });
    expect(screen.getByRole('region', { name: 'agent-office' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo in attesa' }));
    expect(screen.queryByRole('region', { name: 'agent-office' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo in attesa' }));
    expect(screen.getByText('Vecchio lavoro')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nascondi terminati' }));
    expect(screen.queryByText('Vecchio lavoro')).toBeNull();
    // ricordato per la prossima volta
    expect(JSON.parse(localStorage.getItem('agent-office:list-filter')!)).toMatchObject({ hideDone: true });
    localStorage.clear();
  });

  it('sessione nascosta: casella non spuntata; nessuna sessione: messaggio', () => {
    render(<ListView sessions={[session()]} agents={[]} hidden={['s1']} onToggle={() => {}} />);
    expect((screen.getByRole('checkbox', { name: "Nell'ufficio" }) as HTMLInputElement).checked).toBe(false);
    cleanup();
    render(<ListView sessions={[]} agents={[]} hidden={[]} onToggle={() => {}} />);
    expect(screen.getByText('Nessuna istanza di Claude Code aperta')).toBeTruthy();
  });
});

describe('ViewToggle', () => {
  it('due viste (ufficio, lista): evidenzia quella corrente e notifica il cambio', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ViewToggle view="pixel" onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Vista' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Ufficio', 'Lista']);
    expect(screen.getByRole('button', { name: 'Ufficio' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    expect(onChange).toHaveBeenCalledWith('list');
    rerender(<ViewToggle view="list" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ufficio' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Ufficio' }));
    expect(onChange).toHaveBeenCalledWith('pixel');
  });
});
