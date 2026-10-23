// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { diffBlocks, GitSection, HudOverlay } from './panels';
import { readFileSync } from 'node:fs';

const hudCss = readFileSync('src/web/hud/hud.css', 'utf8'); // cwd = root vitest

afterEach(cleanup);

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

describe('sezione Git', () => {
  it('branch, issue e diff in una sezione sola; senza nulla da mostrare non c\'è', () => {
    render(<GitSection session={{ branch: 'feat/42-board', issues: [42], diff: { linesAdded: 30, linesRemoved: 10, filesChanged: 3 } }} />);
    const git = within(screen.getByRole('region', { name: 'Git' }));
    for (const text of ['feat/42-board', '#42', '+30', '-10', '3 file']) expect(git.getByText(text), text).toBeTruthy();
    cleanup();
    const { container } = render(<GitSection session={{ branch: null, issues: [], diff: null }} />);
    expect(container.innerHTML).toBe('');
  });

  it('quadratini del diff in proporzione alle righe; grigi senza righe', () => {
    expect(diffBlocks({ linesAdded: 30, linesRemoved: 10, filesChanged: 1 })).toEqual(['added', 'added', 'added', 'added', 'removed']);
    expect(diffBlocks({ linesAdded: 0, linesRemoved: 7, filesChanged: 1 })).toEqual(Array(5).fill('removed'));
    expect(diffBlocks({ linesAdded: 0, linesRemoved: 0, filesChanged: 0 })).toEqual(Array(5).fill('none'));
  });
});
