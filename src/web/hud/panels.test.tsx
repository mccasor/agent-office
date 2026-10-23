// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoState } from '../../shared/types';
import { HudOverlay, RepoPanel } from './panels';
import { readFileSync } from 'node:fs';

const hudCss = readFileSync('src/web/hud/hud.css', 'utf8'); // cwd = root vitest

afterEach(cleanup);

const repo: RepoState = { project: 'olimpo-ui', branch: 'main', linesAdded: 120, linesRemoved: 7, filesChanged: 3 };

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
