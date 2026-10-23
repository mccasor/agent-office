import { en } from './en.js';
import { es } from './es.js';
import { it, type TextKey, type Texts } from './it.js';

/**
 * Lingua dell'interfaccia (#93): testi in italiano (riferimento), inglese e spagnolo, con le stesse chiavi.
 *
 * - Pagine web (ufficio, lista, schede, Analisi): importano questo modulo; la lingua corrente la decide lo store con
 *   setLocale, dalle preferenze che il server manda con l'evento `config` (già risolte: vedi resolveLocale).
 * - Pagine locali dell'app (pannello, Impostazioni, splash): `src-tauri/splash/i18n.js`, generato da pagesScript.
 * - App della menu bar (Rust): `src-tauri/src/i18n.json`, generato da appJson.
 * I due file si rigenerano con `npm run settings:catalog`; un test controlla che siano aggiornati.
 */

export type { TextKey, Texts };

export const LOCALES = ['it', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const TEXTS: Record<Locale, Texts> = { it, en, es };

/** tag BCP 47 per Intl (orari, plurali) */
export const LOCALE_TAG: Record<Locale, string> = { it: 'it-IT', en: 'en-US', es: 'es-ES' };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/**
 * Lingua da usare: quella scelta, oppure con "system" la prima lingua supportata tra quelle preferite (`preferred`,
 * es. `["fr-FR", "en-US"]` o `"it_IT.UTF-8"`); nessuna supportata → italiano. Pura.
 */
export function resolveLocale(language: string, preferred: readonly string[]): Locale {
  if (isLocale(language)) return language;
  for (const tag of preferred) {
    const base = tag.trim().toLowerCase().split(/[-_.@]/)[0];
    if (isLocale(base)) return base;
  }
  return 'it';
}

export type Params = Record<string, string | number>;

/** Sostituisce i parametri `{nome}`; quelli senza valore restano come sono. Pura. */
export const fill = (text: string, params?: Params): string =>
  params ? text.replace(/\{(\w+)\}/g, (all, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : all)) : text;

let current: Locale = 'it';

/** Lingua corrente delle pagine web; italiano finché lo store non riceve le preferenze. */
export const getLocale = (): Locale => current;

export function setLocale(locale: Locale): void {
  current = locale;
}

/** Testo `key` nella lingua corrente, con i parametri. */
export function t(key: TextKey, params?: Params): string {
  return fill(TEXTS[current][key] ?? it[key], params);
}

/** Chiavi con il plurale: `x.one` e `x.other` → `x`. */
export type PluralKey = TextKey extends infer K ? (K extends `${infer Base}.other` ? Base : never) : never;

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** "one" o "other" per `n` nella lingua `locale` (le altre categorie, es. "many" in spagnolo, valgono "other"). */
export function pluralOf(locale: Locale, n: number): 'one' | 'other' {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(LOCALE_TAG[locale])));
  return rules.select(n) === 'one' ? 'one' : 'other';
}

/** Testo al singolare o al plurale secondo `n`, che è anche il parametro `{n}`: tn('count.done', 3) → "3 terminati". */
export function tn(key: PluralKey, n: number, params?: Params): string {
  return t(`${key}.${pluralOf(current, n)}` as TextKey, { n, ...params });
}

/** Ora del giorno nella lingua corrente: "14:32" (in inglese "02:32 PM"). */
export const clock = (at: number): string =>
  new Date(at).toLocaleTimeString(LOCALE_TAG[current], { hour: '2-digit', minute: '2-digit' });

/** Testi usati dalle pagine locali dell'app (pannello, Impostazioni, splash). */
export const PAGE_PREFIXES = [
  'format.', 'dur.', 'status.', 'waiting.', 'activity.', 'instances.', 'tray.', 'update.', 'panel.', 'settings.', 'tab.', 'place.',
  'setting.', 'splash.',
] as const;
/** Testi usati dall'app della menu bar in Rust (icona, notifiche, aggiornamenti, hook, server, errori dei comandi). */
export const APP_PREFIXES = ['tray.', 'notify.', 'update.', 'hooks.', 'server.', 'window.', 'error.'] as const;

/** Testi delle chiavi con uno dei prefissi, per lingua. Pura. */
export function pick(prefixes: readonly string[]): Record<Locale, Record<string, string>> {
  const keys = (Object.keys(it) as TextKey[]).filter((k) => prefixes.some((p) => k.startsWith(p)));
  return Object.fromEntries(LOCALES.map((l) => [l, Object.fromEntries(keys.map((k) => [k, TEXTS[l][k]]))])) as Record<Locale, Record<string, string>>;
}

/**
 * Contenuto di `src-tauri/splash/i18n.js`: i testi delle pagine locali e una piccola funzione per usarli,
 * `agentOfficeTexts(lingua)` → `t(chiave, parametri)`, con `t.n(chiave, n, parametri)` per i plurali (come tn).
 */
export function pagesScript(): string {
  return `// Generato da src/shared/i18n con \`npm run settings:catalog\`: non modificare a mano.\n` +
    `globalThis.AGENT_OFFICE_I18N = ${JSON.stringify(pick(PAGE_PREFIXES), null, 2)};\n` +
    `/** Testi della lingua \`locale\` (italiano se sconosciuta): t(chiave, parametri), t.n(chiave, n, parametri) per i plurali. */\n` +
    `globalThis.agentOfficeTexts = (locale) => {\n` +
    `  const all = globalThis.AGENT_OFFICE_I18N;\n` +
    `  const lang = Object.hasOwn(all, locale) ? locale : 'it';\n` +
    `  const rules = new Intl.PluralRules(lang);\n` +
    `  const t = (key, params) => String(all[lang][key] ?? all.it[key] ?? key)\n` +
    `    .replace(/\\{(\\w+)\\}/g, (m, name) => (params && Object.hasOwn(params, name) ? String(params[name]) : m));\n` +
    `  t.n = (key, n, params) => t(\`\${key}.\${rules.select(n) === 'one' ? 'one' : 'other'}\`, { n, ...params });\n` +
    `  t.locale = lang;\n` +
    `  return t;\n` +
    `};\n`;
}

/** Contenuto di `src-tauri/src/i18n.json`, incluso nell'app in compilazione (i18n.rs). */
export const appJson = (): string => `${JSON.stringify(pick(APP_PREFIXES), null, 2)}\n`;
