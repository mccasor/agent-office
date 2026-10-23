import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTING_PLACES, SETTINGS_CATALOG, SETTINGS_TABS } from '../settings.js';
import {
  appJson, fill, LOCALES, PAGE_PREFIXES, pagesScript, pick, pluralOf, resolveLocale, setLocale, t, TEXTS, tn, type TextKey,
} from './index.js';

afterEach(() => setLocale('it'));

/** parametri `{x}` di un testo, in ordine alfabetico */
const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('testi (#93)', () => {
  it('inglese e spagnolo hanno le chiavi dell\'italiano, non vuote e con gli stessi parametri', () => {
    const keys = Object.keys(TEXTS.it).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(TEXTS[locale]).sort()).toEqual(keys);
      for (const key of keys as TextKey[]) {
        expect(TEXTS[locale][key].trim(), `${locale} ${key}`).not.toBe('');
        expect(params(TEXTS[locale][key]), `${locale} ${key}`).toEqual(params(TEXTS.it[key]));
      }
    }
  });

  it('plurali in coppia: a ogni .one il suo .other', () => {
    const keys = Object.keys(TEXTS.it);
    for (const key of keys.filter((k) => k.endsWith('.one'))) expect(keys).toContain(key.replace(/\.one$/, '.other'));
  });

  it('schede, posti e voci del catalogo hanno il loro nome, abbastanza corto per la finestra Impostazioni', () => {
    const names: TextKey[] = [
      ...SETTINGS_TABS.map((tab) => `tab.${tab.id}` as const),
      ...SETTING_PLACES.map((p) => `place.${p}` as const),
      ...SETTINGS_CATALOG.map((i) => `setting.${i.key}` as const),
    ];
    for (const locale of LOCALES) {
      for (const key of names) {
        expect(TEXTS[locale][key], `${locale} ${key}`).toBeTruthy();
        expect(TEXTS[locale][key].length, `${locale} ${key}`).toBeLessThanOrEqual(34);
      }
    }
  });

  it('"system": la prima lingua supportata tra le preferite, altrimenti italiano', () => {
    expect(resolveLocale('en', ['es-ES'])).toBe('en');
    expect(resolveLocale('system', ['fr-FR', 'es-MX', 'en-US'])).toBe('es');
    expect(resolveLocale('system', ['en_GB.UTF-8'])).toBe('en');
    expect(resolveLocale('system', ['EN'])).toBe('en');
    expect(resolveLocale('system', ['de', 'fr'])).toBe('it');
    expect(resolveLocale('system', [])).toBe('it');
    expect(resolveLocale('klingon', ['en'])).toBe('en');
  });

  it('parametri e plurali nella lingua corrente', () => {
    expect(fill('{a} e {b}', { a: 1 })).toBe('1 e {b}');
    expect(tn('count.done', 1)).toBe('1 terminato');
    expect(tn('count.done', 0)).toBe('0 terminati');
    expect(tn('count.done', 12)).toBe('12 terminati');
    setLocale('en');
    expect(tn('panel.open', 1)).toBe('1 open instance');
    expect(tn('panel.open', 3)).toBe('3 open instances');
    expect(t('panel.quit')).toBe('Quit Agent Office');
    setLocale('es');
    expect(tn('count.idle', 1)).toBe('1 inactivo');
    expect(tn('count.idle', 2)).toBe('2 inactivos');
    // in spagnolo i milioni sono "many": valgono come plurale
    expect(pluralOf('es', 1_000_000)).toBe('other');
    expect(tn('history.waitsCount', 1_000_000)).toBe('1000000 esperas');
    expect(t('panel.settings')).toBe('Ajustes…');
  });

  it('i18n.js delle pagine locali e i18n.json dell\'app sono aggiornati (altrimenti: npm run settings:catalog)', () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    expect(read('../../../src-tauri/splash/i18n.js')).toBe(pagesScript());
    expect(read('../../../src-tauri/src/i18n.json')).toBe(appJson());
  });

  it('le chiavi usate da pannello, Impostazioni e splash sono in i18n.js', () => {
    const shipped = new Set(Object.keys(pick(PAGE_PREFIXES).it));
    for (const page of ['panel.html', 'settings.html', 'index.html']) {
      const html = readFileSync(fileURLToPath(new URL(`../../../src-tauri/splash/${page}`, import.meta.url)), 'utf8');
      const used = [...html.matchAll(/\bT(\.n)?\('([\w.]+)'/g)];
      expect(used.length, page).toBeGreaterThan(0);
      for (const [, plural, key] of used) {
        for (const k of plural ? [`${key}.one`, `${key}.other`] : [key!]) expect(shipped.has(k), `${page}: ${k}`).toBe(true);
      }
    }
  });

  it('i18n.js: testi e plurali per le pagine locali, italiano se la lingua è sconosciuta', () => {
    const page: Record<string, unknown> = { Intl, Object, String };
    runInNewContext(pagesScript(), page);
    type PageT = ((key: string, params?: object) => string) & { n: (key: string, n: number) => string; locale: string };
    const texts = page.agentOfficeTexts as (locale: string) => PageT;
    expect(texts('es')('panel.quit')).toBe('Salir de Agent Office');
    expect(texts('en').n('panel.agentsWorking', 2)).toBe('2 agents working');
    expect(texts('en')('update.available', { v: '0.7.0' })).toBe('Update to Version 0.7.0');
    expect(texts('fr').locale).toBe('it');
    expect(texts('fr')('panel.settings')).toBe('Impostazioni…');
    // solo i testi delle pagine locali, non quelli dell'ufficio
    expect(texts('it')('history.title')).toBe('history.title');
  });
});
