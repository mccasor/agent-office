// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoState, SessionState } from '../../shared/types';
import { HudOverlay, RepoPanel, SessionPanel } from './panels';
import { readFileSync } from 'node:fs';

const hudCss = readFileSync('src/web/hud/hud.css', 'utf8'); // cwd = root vitest

afterEach(cleanup);

const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1',
  title: 'Sessione',
  model: 'claude-opus-5-5',
  effort: 'high',
  context: { used: 50_000, window: 200_000 },
  tokensUsed: { input: 1000, output: 234, cacheRead: 0, cacheCreation: 0, total: 1234 },
  tokensLeft: 2_500_000,
  startedAt: 0,
  updatedAt: 0,
  active: true,
  ...over,
});

const repo: RepoState = { project: 'olimpo-ui', branch: 'main', linesAdded: 120, linesRemoved: 7, filesChanged: 3 };

describe('SessionPanel', () => {
  it('placeholder se session null', () => {
    render(<SessionPanel session={null} />);
    expect(screen.getByText(/nessuna sessione/i)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('mostra modello, effort, token usati e rimanenti', () => {
    render(<SessionPanel session={session()} />);
    expect(screen.getByText('claude-opus-5-5')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
    expect(screen.getByTestId('tokens-used').textContent).toBe('1.2k');
    expect(screen.getByTestId('tokens-left').textContent).toBe('2.5M');
  });

  it('barra contesto con % e aria-valuenow, livello ok', () => {
    render(<SessionPanel session={session()} />);
    const bar = screen.getByRole('progressbar', { name: /contesto/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('data-level')).toBe('ok');
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('50k / 200k')).toBeTruthy();
  });

  it('livello ambra >70% e rosso >90%', () => {
    const { rerender } = render(<SessionPanel session={session({ context: { used: 150_000, window: 200_000 } })} />);
    expect(screen.getByRole('progressbar').getAttribute('data-level')).toBe('warn');
    rerender(<SessionPanel session={session({ context: { used: 190_000, window: 200_000 } })} />);
    expect(screen.getByRole('progressbar').getAttribute('data-level')).toBe('danger');
  });

  it('finestra sconosciuta, campi nulli → trattini, niente barra', () => {
    render(
      <SessionPanel session={session({ model: null, effort: null, tokensLeft: null, context: { used: 1234, window: null } })} />,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('1.2k / ?')).toBeTruthy();
    expect(screen.getByTestId('tokens-left').textContent).toBe('—');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});

describe('SessionPanel ripartizione token', () => {
  it('details con input, output, cache read, cache creation', () => {
    render(
      <SessionPanel
        session={session({ tokensUsed: { input: 1_200, output: 3_400, cacheRead: 17_700_000, cacheCreation: 90_000, total: 17_794_600 } })}
      />,
    );
    expect(screen.getByTestId('tokens-used').textContent).toBe('17.8M');
    const details = screen.getByText(/ripartizione/i).closest('details');
    expect(details).toBeTruthy();
    expect(screen.getByTestId('tokens-input').textContent).toBe('1.2k');
    expect(screen.getByTestId('tokens-output').textContent).toBe('3.4k');
    expect(screen.getByTestId('tokens-cacheRead').textContent).toBe('17.7M');
    expect(screen.getByTestId('tokens-cacheCreation').textContent).toBe('90k');
    expect(details!.contains(screen.getByTestId('tokens-cacheRead'))).toBe(true);
  });
});

describe('RepoPanel', () => {
  it('placeholder se repo null', () => {
    render(<RepoPanel repo={null} />);
    expect(screen.getByText(/nessun repository/i)).toBeTruthy();
  });

  it('progetto, branch, +N verde, -N rosso, file modificati', () => {
    render(<RepoPanel repo={repo} />);
    expect(screen.getByText('olimpo-ui')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    const add = screen.getByText('+120');
    const del = screen.getByText('-7');
    expect(add.className).toContain('hud-added');
    expect(del.className).toContain('hud-removed');
    expect(screen.getByText(/3 file/)).toBeTruthy();
  });

  it('branch null → detached', () => {
    render(<RepoPanel repo={{ ...repo, branch: null }} />);
    expect(screen.getByText(/detached/i)).toBeTruthy();
  });
});

describe('HudOverlay', () => {
  it('contenitore con i figli', () => {
    render(
      <HudOverlay>
        <span>figlio</span>
      </HudOverlay>,
    );
    const el = screen.getByText('figlio').parentElement!;
    expect(el.className).toContain('hud-overlay');
  });

  it('sinistra e destra nello stesso contenitore (impilabili sotto 680px)', () => {
    render(
      <>
        <HudOverlay side="right">
          <span>destra</span>
        </HudOverlay>
        <HudOverlay side="left">
          <span>sinistra</span>
        </HudOverlay>
      </>,
    );
    const left = screen.getByText('sinistra').parentElement!;
    const right = screen.getByText('destra').parentElement!;
    expect(left.parentElement).toBe(right.parentElement);
    expect(left.parentElement!.className).toContain('hud-stack');
  });

  it('css: media query < 680px a tutta larghezza con gutter 16px', () => {
    const media = hudCss.match(/@media \(max-width: 679\.98px\) \{([\s\S]*?)\n\}/);
    expect(media).toBeTruthy();
    expect(media![1]).toMatch(/\.hud-stack \{[^}]*flex-direction: column/);
    expect(media![1]).toMatch(/\.hud-stack \{[^}]*left: 16px;[^}]*right: 16px/);
  });
});
