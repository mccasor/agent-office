// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY } from '../../shared/settings';
import type { AgentState, GitCommit, GitDayReport, SessionState } from '../../shared/types';
import { useOfficeStore } from '../store';
import { AgentCard } from './AgentCard';
import { emptyText, GitDayView, GitPanel, GitTodayLine, InstanceTabs, isReport, onlyAuthor } from './GitTab';
import { requestTab, tabKey } from './popout';

afterEach(() => {
  cleanup();
  useOfficeStore.setState({ settings: DEFAULT_DISPLAY });
  localStorage.clear();
  vi.unstubAllGlobals();
});

const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m).getTime();

const commit = (over: Partial<GitCommit> = {}): GitCommit => ({
  hash: 'abc1234', at: at(10), branch: 'main', message: 'feat: uno', added: 10, removed: 2,
  files: [{ path: 'src/a.ts', added: 10, removed: 2 }], filesCount: 1, author: { kind: 'claude' }, matchedBy: 'hash', ...over,
});

const report = (over: Partial<GitDayReport> = {}): GitDayReport => ({
  day: '2026-10-28',
  days: ['2026-10-28', '2026-10-27'],
  status: 'ok',
  project: 'agent-office',
  branch: 'main',
  commits: [
    commit({ hash: 'ccc3333', at: at(15, 30), message: 'fix: agente', author: { kind: 'agent', agentId: 'a1', nickname: 'Marta Commit', agentType: 'Explore' }, branch: 'worktree-a1', files: [{ path: 'src/a.ts', added: 3, removed: 1 }, { path: 'logo.png', added: 0, removed: 0, binary: true }], filesCount: 2, added: 3, removed: 1 }),
    commit({ hash: 'bbb2222', at: at(12), message: 'chore: a mano', author: { kind: 'outside' }, matchedBy: undefined, files: [{ path: 'README.md', added: 4, removed: 0 }], added: 4, removed: 0 }),
    commit(),
  ],
  truncated: false,
  ...over,
});

const loader = (r: GitDayReport | ((day: string | null) => GitDayReport)) =>
  vi.fn(async (_session: string, day: string | null) => (typeof r === 'function' ? r(day) : r));

describe('GitDayView', () => {
  it('riepilogo con barra per autore, commit con autore e file, grafici', () => {
    render(<GitDayView report={report()} />);
    const summary = screen.getByRole('region', { name: 'Riepilogo del giorno' });
    expect(summary.textContent).toContain('3 commit');
    expect(summary.textContent).toContain('+17');
    expect(summary.textContent).toContain('−3');
    // file diversi: src/a.ts, logo.png, README.md
    expect(summary.textContent).toContain('3 file');
    const legend = within(summary).getAllByRole('listitem').map((li) => li.textContent);
    // Claude e l'agente con un commit ciascuno, fuori da Claude per ultimo
    expect(legend).toEqual(['Claude1', 'Marta Commit1', 'Fuori da Claude1']);
    expect(within(summary).getByRole('img').getAttribute('aria-label')).toBe('Claude: 1 commit, Marta Commit: 1 commit, Fuori da Claude: 1 commit');

    const list = screen.getByRole('region', { name: 'Commit' });
    const rows = within(list).getAllByRole('listitem').filter((li) => li.classList.contains('git-commit'));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('Marta Commit');
    expect(rows[0]!.textContent).toContain('fix: agente');
    // branch diverso da quello corrente: accanto al commit
    expect(rows[0]!.textContent).toContain('worktree-a1');
    expect(rows[2]!.textContent).not.toContain('main');
    expect(within(rows[0]!).getByTitle(/Marta Commit \(Explore\)/)).toBeTruthy();
    // i file del commit, il binario senza righe
    expect(rows[0]!.querySelector('.git-commit__files')!.textContent).toContain('binario');

    const files = within(screen.getByRole('region', { name: 'File più toccati' })).getAllByRole('listitem');
    expect(files[0]!.textContent).toMatch(/^a\.ts2/);
    expect(files[0]!.getAttribute('title')).toContain('src/a.ts');
    expect(screen.getByRole('img', { name: 'Righe aggiunte e tolte per ora del giorno' })).toBeTruthy();
    const types = within(screen.getByRole('region', { name: 'Tipi di file' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(types[0]).toBe('.ts2 file');
  });

  it('al più 10 file più toccati e la nota sui commit tagliati', () => {
    const many = Array.from({ length: 12 }, (_, i) => commit({ hash: `h${i}`, files: [{ path: `f${i}.ts`, added: i, removed: 0 }] }));
    render(<GitDayView report={report({ commits: many, truncated: true })} />);
    expect(within(screen.getByRole('region', { name: 'File più toccati' })).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('Solo i 12 commit più recenti')).toBeTruthy();
  });

  it('stati vuoti: non repo, git assente, repository senza commit, nessun commit nel giorno', () => {
    expect(emptyText(report({ status: 'not-repo', commits: [] }))).toBe('La cartella dell\'istanza non è un repository git');
    expect(emptyText(report({ status: 'no-git', commits: [] }))).toBe('Git non è installato o non risponde');
    expect(emptyText(report({ status: 'empty', commits: [] }))).toBe('Il repository non ha ancora commit');
    expect(emptyText(report({ commits: [] }))).toBe('Nessun commit in questo giorno');
    expect(emptyText(report())).toBeNull();
    render(<GitDayView report={report({ status: 'not-repo', commits: [] })} />);
    expect(screen.getByRole('status').textContent).toBe('La cartella dell\'istanza non è un repository git');
    expect(screen.queryByRole('region', { name: 'Commit' })).toBeNull();
  });

  it('isReport scarta le risposte estranee', () => {
    expect(isReport(report())).toBe(true);
    expect(isReport({ kind: 'silent' })).toBe(false);
    expect(isReport(null)).toBe(false);
  });
});

describe('GitPanel', () => {
  it('selettore del giorno come nella vista Analisi: oggi vale null, gli altri giorni il loro valore', async () => {
    const load = loader((day) => report({ day: day ?? '2026-10-28', commits: day ? [] : report().commits }));
    render(<GitPanel sessionId="s1" load={load} />);
    expect(screen.getByRole('status').textContent).toBe('Caricamento…');
    const select = await screen.findByRole('combobox', { name: 'Giorno' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026-10-28 (oggi)', '2026-10-27']);
    expect(load).toHaveBeenLastCalledWith('s1', null);
    fireEvent.change(select, { target: { value: '2026-10-27' } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('s1', '2026-10-27'));
    expect(await screen.findByText('Nessun commit in questo giorno')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Giorno' }), { target: { value: '2026-10-28' } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('s1', null));
  });

  it('un solo giorno: niente selettore; errore del server: messaggio', async () => {
    render(<GitPanel sessionId="s1" load={loader(report({ days: ['2026-10-28'] }))} />);
    await screen.findByRole('region', { name: 'Commit' });
    expect(screen.queryByRole('combobox')).toBeNull();
    cleanup();
    render(<GitPanel sessionId="s1" load={vi.fn(async () => Promise.reject(new Error('x')))} />);
    expect(await screen.findByText('Dati di git non disponibili')).toBeTruthy();
  });
});

describe('InstanceTabs', () => {
  it('"Istanza" con il contenuto di sempre, "Git" carica i commit solo quando si apre', async () => {
    const load = loader(report());
    render(<InstanceTabs sessionId="s1" load={load}><p>contenuto dell'istanza</p></InstanceTabs>);
    const [instance, git] = screen.getAllByRole('tab');
    expect(instance!.textContent).toBe('Istanza');
    expect(instance!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('contenuto dell\'istanza')).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(git!);
    expect(git!.getAttribute('aria-selected')).toBe('true');
    await screen.findByRole('region', { name: 'Commit' });
    expect(screen.queryByText('contenuto dell\'istanza')).toBeNull();
    fireEvent.click(instance!);
    expect(screen.getByText('contenuto dell\'istanza')).toBeTruthy();
  });

  it('voce spenta nelle impostazioni: nessuna scheda, solo il contenuto', () => {
    useOfficeStore.setState({ settings: { ...DEFAULT_DISPLAY, show: { ...DEFAULT_DISPLAY.show, 'session.gitTab': false } } });
    render(<InstanceTabs sessionId="s1" load={loader(report())}><p>contenuto</p></InstanceTabs>);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('contenuto')).toBeTruthy();
  });

  it('finestra staccata: si apre sulla scheda chiesta e segue le richieste delle altre finestre', async () => {
    requestTab('s1', 'git');
    render(<InstanceTabs sessionId="s1" watch load={loader(report())}><p>contenuto</p></InstanceTabs>);
    expect(screen.getByRole('tab', { name: 'Git' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Istanza' }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: tabKey('s1'), newValue: JSON.stringify({ tab: 'git', at: Date.now() }) }));
    });
    expect(screen.getByRole('tab', { name: 'Git' }).getAttribute('aria-selected')).toBe('true');
    // richieste per un'altra istanza o scadute: ignorate
    fireEvent.click(screen.getByRole('tab', { name: 'Istanza' }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: tabKey('s2'), newValue: JSON.stringify({ tab: 'git', at: Date.now() }) }));
      window.dispatchEvent(new StorageEvent('storage', { key: tabKey('s1'), newValue: JSON.stringify({ tab: 'git', at: 0 }) }));
    });
    expect(screen.getByRole('tab', { name: 'Istanza' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('scheda di Claude stesso (AgentCard)', () => {
  const tokens = { input: 0, output: 1, cacheRead: 0, cacheCreation: 0, total: 1 };
  const boss: AgentState = {
    id: 'boss:s1', sessionId: 's1', name: 'Claudio Code', agentType: 'main', description: '', area: 'other', status: 'working',
    model: null, tokens, progress: null, issues: [], startedAt: 0, updatedAt: 0,
  };
  const session: SessionState = {
    id: 's1', title: null, model: null, effort: null, context: { used: 0, window: 200_000 }, tokensUsed: tokens, startedAt: 0,
    updatedAt: 0, active: true, status: 'working', issues: [], cwd: '/x', branch: 'main', waiting: false, dot: 'working', project: 'x',
  };

  it('Claude ha le schede Istanza e Git, con solo i commit suoi; un subagente Agente e Git, con solo i suoi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(report()), { status: 200 })));
    render(<AgentCard agent={boss} session={session} />);
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Istanza', 'Git']);
    expect(screen.getByText('Progetto')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    const commits = await screen.findByRole('region', { name: 'Commit' });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/git?session=s1');
    // niente commit dell'agente né fuori da Claude
    expect(commits.textContent).not.toContain('fix: agente');
    expect(commits.textContent).not.toContain('chore: a mano');
    cleanup();
    render(<AgentCard agent={{ ...boss, id: 'a1', agentType: 'Explore' }} />);
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Agente', 'Git']);
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    const own = await screen.findByRole('region', { name: 'Commit' });
    expect(own.textContent).toContain('fix: agente');
    expect(own.textContent).not.toContain('chore: a mano');
    cleanup();
    // un subagente senza commit: la frase dei commit suoi
    render(<AgentCard agent={{ ...boss, id: 'a9', agentType: 'Explore' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    expect(await screen.findByText('Nessun commit suo in questo giorno')).toBeTruthy();
  });

  it('onlyAuthor: Claude della sua sessione (o senza sessione, server vecchio), il subagente per id', () => {
    const r = report({ commits: [
      commit({ hash: 'c1', author: { kind: 'claude', sessionId: 's1' } }),
      commit({ hash: 'c2', author: { kind: 'claude', sessionId: 's2' } }),
      commit({ hash: 'c3', author: { kind: 'claude' } }),
      commit({ hash: 'c4', author: { kind: 'agent', agentId: 'a1', nickname: 'X', agentType: 'Explore' } }),
      commit({ hash: 'c5', author: { kind: 'outside' } }),
    ] });
    expect(onlyAuthor(r, { kind: 'claude', sessionId: 's1' }).commits.map((c) => c.hash)).toEqual(['c1', 'c3']);
    expect(onlyAuthor(r, { kind: 'agent', agentId: 'a1' }).commits.map((c) => c.hash)).toEqual(['c4']);
  });
});

describe('GitTodayLine (lista)', () => {
  it('commit di oggi con la barra per autore e il pulsante per la scheda Git; niente senza commit', async () => {
    const onOpen = vi.fn();
    render(<GitTodayLine sessionId="s1" load={loader(report())} onOpen={onOpen} />);
    const button = await screen.findByRole('button', { name: 'Scheda Git' });
    expect(screen.getByLabelText('Riepilogo del giorno').textContent).toContain('3 commit');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    const load = loader(report({ status: 'not-repo', commits: [] }));
    const { container } = render(<GitTodayLine sessionId="s1" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('voce spenta: nessuna richiesta al server', () => {
    useOfficeStore.setState({ settings: { ...DEFAULT_DISPLAY, show: { ...DEFAULT_DISPLAY.show, 'session.gitTab': false } } });
    const load = loader(report());
    render(<GitTodayLine sessionId="s1" load={load} />);
    expect(load).not.toHaveBeenCalled();
  });
});
