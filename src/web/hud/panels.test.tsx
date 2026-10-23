// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HudOverlay } from './panels';
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
