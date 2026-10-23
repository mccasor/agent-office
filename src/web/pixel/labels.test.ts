import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY } from '../../shared/settings';
import type { AgentState } from '../../shared/types';
import { actorTag, LABEL, labelBox, labelText, officeShow, themeFrom } from './labels';

describe('sopra la testa, secondo le impostazioni (#94)', () => {
  const agent = { id: 'a1', name: 'Build', nickname: 'Marta Commit', area: 'frontend' } as AgentState;
  const actor = (over: { boss?: boolean; waiting?: boolean; alert?: boolean } = {}) => ({ agent, boss: false, waiting: false, alert: false, ...over });
  const all = officeShow(DEFAULT_DISPLAY);
  const off = (...keys: (keyof typeof all)[]) => ({ ...all, ...Object.fromEntries(keys.map((k) => [k, false])) });

  it('preferenze → voci dell\'ufficio', () => {
    expect(all).toEqual({ labels: true, role: true, bubbles: true, alerts: true });
    const show = { ...DEFAULT_DISPLAY.show, 'office.labels': false, 'agent.alerts': false };
    expect(officeShow({ show })).toEqual({ labels: false, role: true, bubbles: true, alerts: false });
  });

  it('di default: targhetta col ruolo e fumetto per chi aspetta o ha un avviso; niente per chi lavora tranquillo', () => {
    expect(actorTag(actor({ waiting: true }), false, false, all)).toEqual({
      spec: { text: 'Marta Commit', area: 'frontend', selected: false, waiting: true }, mark: 'waiting',
    });
    expect(actorTag(actor({ alert: true }), false, false, all)?.mark).toBe('alert');
    expect(actorTag(actor(), false, false, all)).toBeNull();
    // ingrandito: tutti, compatti senza ruolo
    expect(actorTag(actor(), false, true, all)?.spec?.area).toBeNull();
  });

  it('nomi spenti: restano solo i fumetti', () => {
    expect(actorTag(actor({ waiting: true }), true, true, off('labels'))).toEqual({ spec: null, mark: 'waiting' });
    expect(actorTag(actor({ boss: true }), true, true, off('labels'))).toBeNull();
  });

  it('ruolo, fumetto e avviso spenti', () => {
    expect(actorTag(actor({ waiting: true }), false, false, off('role'))?.spec?.area).toBeNull();
    expect(actorTag(actor({ waiting: true }), false, false, off('bubbles'))).toMatchObject({ spec: { waiting: true }, mark: null });
    // l'avviso spento sparisce del tutto: né "!" né targhetta di chi è in evidenza solo per quello
    expect(actorTag(actor({ alert: true }), false, false, off('alerts'))).toBeNull();
    expect(actorTag(actor({ alert: true }), true, false, off('alerts'))?.mark).toBeNull();
  });
});

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
