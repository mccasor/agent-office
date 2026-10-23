import { describe, expect, it } from 'vitest';
import { BOSS_PRESET, CHARACTER_PRESETS, pickPreset } from './presets';

const HEX = /^#[0-9a-f]{6}$/i;

describe('CHARACTER_PRESETS', () => {
  it('contiene almeno 12 preset', () => {
    expect(CHARACTER_PRESETS.length).toBeGreaterThanOrEqual(12);
  });

  it('ha id unici', () => {
    const ids = CHARACTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('usa colori hex validi', () => {
    for (const p of CHARACTER_PRESETS) {
      for (const c of [p.skin, p.hair, p.shirt, p.pants]) expect(c).toMatch(HEX);
      if (p.beard !== null) expect(p.beard).toMatch(HEX);
    }
  });

  it('alterna personaggi con e senza barba', () => {
    const bearded = CHARACTER_PRESETS.filter((p) => p.beard !== null).length;
    expect(bearded).toBeGreaterThan(0);
    expect(bearded).toBeLessThan(CHARACTER_PRESETS.length);
  });

  it('copre tutti gli stili di capelli e accessori', () => {
    const styles = new Set(CHARACTER_PRESETS.map((p) => p.hairStyle));
    const accessories = new Set(CHARACTER_PRESETS.map((p) => p.accessory));
    for (const s of ['short', 'long', 'bun', 'bald', 'cap'] as const) expect(styles).toContain(s);
    for (const a of ['none', 'glasses', 'headphones', 'tie'] as const) expect(accessories).toContain(a);
  });

  it('ha incarnati variati', () => {
    expect(new Set(CHARACTER_PRESETS.map((p) => p.skin)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('pickPreset', () => {
  it('è deterministico', () => {
    for (const id of ['a', 'agent-1', 'f3c9e2a1-0000-4b4b-9c9c-123456789abc', '']) {
      expect(pickPreset(id)).toBe(pickPreset(id));
    }
  });

  it('restituisce sempre un preset della lista', () => {
    for (let i = 0; i < 100; i++) expect(CHARACTER_PRESETS).toContain(pickPreset(`agent-${i}`));
  });

  it('distribuisce 1000 id in modo non degenere', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const p = pickPreset(`agent-${i}`);
      counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
    expect(counts.size).toBe(CHARACTER_PRESETS.length);
    const expected = 1000 / CHARACTER_PRESETS.length;
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(expected * 0.4);
      expect(n).toBeLessThan(expected * 1.8);
    }
  });

  it('id simili producono preset diversi', () => {
    const ids = ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e'];
    expect(new Set(ids.map((id) => pickPreset(id).id)).size).toBeGreaterThan(1);
  });
});

describe('BOSS_PRESET', () => {
  it('è Claudio Code con camicia arancio Claude e cravatta, fuori dalla rotazione', () => {
    expect(BOSS_PRESET.shirt).toBe('#d97757');
    expect(BOSS_PRESET.accessory).toBe('tie');
    expect(CHARACTER_PRESETS).not.toContain(BOSS_PRESET);
  });
});
