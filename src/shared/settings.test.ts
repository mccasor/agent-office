import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  catalogScript, DEFAULT_DISPLAY, isShown, resolveShow, SETTINGS_CATALOG, SETTINGS_TABS, toDisplaySettings,
} from './settings';

describe('catalogo delle impostazioni', () => {
  it('chiavi univoche e stabili, schede esistenti, almeno un posto per voce', () => {
    const keys = SETTINGS_CATALOG.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const tabs = new Set<string>(SETTINGS_TABS.map((t) => t.id));
    for (const item of SETTINGS_CATALOG) {
      // lettere, cifre e punti: le stesse regole con cui l'app valida le chiavi di `show` (src-tauri/src/config.rs)
      expect(item.key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
      expect(tabs.has(item.tab) && (item.tab as string) !== 'general').toBe(true);
      expect(item.places.length).toBeGreaterThan(0);
      expect(item.label.length).toBeLessThanOrEqual(32);
    }
    // ogni scheda (tranne Generali) ha qualcosa da mostrare
    for (const tab of SETTINGS_TABS.filter((t) => t.id !== 'general')) {
      expect(SETTINGS_CATALOG.some((i) => i.tab === tab.id)).toBe(true);
    }
  });

  it('show: booleani tenuti, il resto ai default, chiavi sconosciute scartate', () => {
    const show = resolveShow({ 'session.diff': false, 'session.context': 'no', 'futura.voce': false });
    expect(show['session.diff']).toBe(false);
    expect(show['session.context']).toBe(true);
    expect(Object.keys(show)).toHaveLength(SETTINGS_CATALOG.length);
    expect('futura.voce' in show).toBe(false);
    expect(resolveShow(null)).toEqual(DEFAULT_DISPLAY.show);
    expect(resolveShow([false])).toEqual(DEFAULT_DISPLAY.show);
  });

  it('preferenze ricevute: lingua valida o "system"; voce assente al default', () => {
    expect(toDisplaySettings({ language: 'en', show: { 'panel.agents': false } })).toMatchObject({ language: 'en', show: { 'panel.agents': false } });
    expect(toDisplaySettings({ language: 'fr' }).language).toBe('system');
    expect(toDisplaySettings('rotto')).toEqual(DEFAULT_DISPLAY);
    expect(isShown({ show: {} as never }, 'session.diff')).toBe(true);
    expect(isShown({ show: { ...DEFAULT_DISPLAY.show, 'session.diff': false } }, 'session.diff')).toBe(false);
  });

  it('settings-catalog.js dell\'app è aggiornato (altrimenti: npm run settings:catalog)', () => {
    const file = fileURLToPath(new URL('../../src-tauri/splash/settings-catalog.js', import.meta.url));
    expect(readFileSync(file, 'utf8')).toBe(catalogScript());
  });
});
