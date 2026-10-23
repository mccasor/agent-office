import { describe, expect, it } from 'vitest';
import { LABEL, labelBox, labelText, themeFrom } from './labels';

// misura finta: 6 px per carattere del nome, 5 per la chip (pixel fisici)
const measure = (text: string, chip: boolean) => text.length * (chip ? 5 : 6);

describe('etichette 2D', () => {
  it('nomi lunghi accorciati con i puntini', () => {
    expect(labelText('Marta Commit')).toBe('Marta Commit');
    const long = labelText('Un nome descrittivo davvero troppo lungo');
    expect(long).toHaveLength(LABEL.maxChars);
    expect(long.endsWith('…')).toBe(true);
  });

  it('targhetta centrata sul personaggio, con la freccina che tocca il punto indicato', () => {
    const box = labelBox({ text: 'Marta Commit', area: null, selected: false, waiting: false }, 500, 300, 1, measure);
    expect(box.chipW).toBe(0);
    expect(box.w).toBe(12 * 6 + 2 * LABEL.padX);
    expect(box.left + box.w / 2).toBeCloseTo(500, 0);
    expect(box.top + box.h + LABEL.tail).toBe(300);
  });

  it('con il ruolo la chip si aggiunge a destra; al dpr 2 tutto raddoppia', () => {
    const plain = labelBox({ text: 'Ugo Lint', area: null, selected: false, waiting: false }, 0, 0, 2, measure);
    const role = labelBox({ text: 'Ugo Lint', area: 'test', selected: true, waiting: false }, 0, 0, 2, measure);
    // "QA": 2 caratteri
    expect(role.chipW).toBe(2 * 5 + 2 * 2 * LABEL.chipPadX);
    expect(role.w - plain.w).toBe(role.chipW + 2 * LABEL.gap);
    expect(role.h).toBe(2 * LABEL.height);
  });

  it('colori dalle variabili CSS dell\'HUD, con riserva se mancano', () => {
    const vars: Record<string, string> = { '--hud-bg': ' #111 ', '--area-design': '#b6d84a' };
    const theme = themeFrom((name) => vars[name] ?? '');
    expect(theme.bg).toBe('#111');
    expect(theme.areas.design).toBe('#b6d84a');
    expect(theme.areas.backend).toMatch(/^#/);
    expect(theme.fg).toMatch(/^#/);
  });
});
