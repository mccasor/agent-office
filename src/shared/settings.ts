/**
 * Impostazioni di visualizzazione (#94): il catalogo delle voci che si possono mostrare o nascondere in ufficio,
 * nell'accordion delle istanze, nella scheda dell'agente, nella lista e nel pannello della menu bar.
 * Fonte unica per server, pagine web e finestra Impostazioni dell'app (che lo riceve come
 * `src-tauri/splash/settings-catalog.js`, generato da questo modulo: `npm run settings:catalog`).
 *
 * In ~/.agent-office/config.json gli interruttori stanno in `show: { [chiave]: boolean }`; chiavi mancanti o non
 * valide valgono il default del catalogo. Le chiavi sono stabili: rinominarle perde le scelte salvate.
 */
import { isLocale, resolveLocale, type Locale } from './i18n/index.js';

/** schede della finestra Impostazioni, nell'ordine della barra; i nomi sono i testi `tab.<id>` (src/shared/i18n) */
export const SETTINGS_TABS = [{ id: 'general' }, { id: 'claude' }, { id: 'agents' }, { id: 'git' }, { id: 'instances' }] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/** dove compare una voce: ufficio 2D, accordion delle istanze, scheda dell'agente, vista lista, pannello della menu bar */
export type SettingPlace = 'office' | 'instances' | 'card' | 'list' | 'panel';

export const SETTING_PLACES: readonly SettingPlace[] = ['office', 'instances', 'card', 'list', 'panel'];

/** Voce del catalogo: il nome è il testo `setting.<key>` (src/shared/i18n), i posti i testi `place.<posto>`. */
export interface SettingItem {
  key: string;
  tab: Exclude<SettingsTab, 'general'>;
  /** dove si vede: l'interruttore lo dice sotto l'etichetta */
  places: readonly SettingPlace[];
  default: boolean;
}

/**
 * Catalogo delle voci. Tutte visibili di default (com'era prima delle impostazioni). `places` dice dove la voce è
 * applicata: in ognuno dei posti, spenta, sparisce senza lasciare separatori o righe vuote.
 */
export const SETTINGS_CATALOG = [
  // Claude stesso (la sessione principale)
  { key: 'session.model', tab: 'claude', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.effort', tab: 'claude', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.tokens', tab: 'claude', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.cost', tab: 'claude', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.context', tab: 'claude', places: ['instances', 'list', 'card', 'panel'], default: true },
  { key: 'session.turn', tab: 'claude', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.title', tab: 'claude', places: ['list', 'card'], default: true },
  { key: 'session.toolErrors', tab: 'claude', places: ['card'], default: true },
  { key: 'session.activity', tab: 'claude', places: ['panel'], default: true },
  // subagenti
  { key: 'agent.role', tab: 'agents', places: ['office', 'instances', 'list', 'card'], default: true },
  { key: 'agent.task', tab: 'agents', places: ['instances', 'list', 'card', 'panel'], default: true },
  { key: 'agent.type', tab: 'agents', places: ['card'], default: true },
  { key: 'agent.description', tab: 'agents', places: ['card'], default: true },
  { key: 'agent.issues', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.progress', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.duration', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.model', tab: 'agents', places: ['card'], default: true },
  { key: 'agent.effort', tab: 'agents', places: ['card'], default: true },
  { key: 'agent.tokens', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.cost', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.outcome', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.toolErrors', tab: 'agents', places: ['list', 'card'], default: true },
  { key: 'agent.alerts', tab: 'agents', places: ['office', 'instances', 'list', 'card'], default: true },
  { key: 'office.labels', tab: 'agents', places: ['office'], default: true },
  { key: 'office.bubbles', tab: 'agents', places: ['office'], default: true },
  { key: 'panel.agents', tab: 'agents', places: ['panel'], default: true },
  // repository
  { key: 'session.branch', tab: 'git', places: ['instances', 'list', 'card', 'panel'], default: true },
  { key: 'session.diff', tab: 'git', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.issues', tab: 'git', places: ['instances', 'list', 'card'], default: true },
  // scheda Git delle info sull'istanza (#109): commit del giorno, autori e grafici; nella lista il riepilogo
  { key: 'session.gitTab', tab: 'git', places: ['instances', 'list', 'card'], default: true },
  // istanze e giornata
  { key: 'instances.counts', tab: 'instances', places: ['instances', 'list'], default: true },
  { key: 'instances.done', tab: 'instances', places: ['instances', 'list'], default: true },
  { key: 'list.finishedToday', tab: 'instances', places: ['list'], default: true },
  { key: 'list.closedFinished', tab: 'instances', places: ['list'], default: true },
  { key: 'today.list', tab: 'instances', places: ['list'], default: true },
  { key: 'today.office', tab: 'instances', places: ['office'], default: true },
] as const satisfies readonly SettingItem[];

export type SettingKey = (typeof SETTINGS_CATALOG)[number]['key'];

/** lingue dell'interfaccia (#93); "system" segue la lingua di macOS */
export const LANGUAGES = ['system', 'it', 'en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Preferenze di visualizzazione inviate alle pagine (evento SSE `config`, GET /api/config). */
export interface DisplaySettings {
  /** lingua scelta in config.json */
  language: Language;
  /** lingua da usare, già risolta dal server ("system" → lingua del sistema se supportata, altrimenti italiano) */
  locale: Locale;
  /** tutte le voci del catalogo, già risolte con i default */
  show: Record<SettingKey, boolean>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `show` di config.json → tutte le voci del catalogo: valori booleani tenuti, il resto (o assente) al default. Pura. */
export function resolveShow(raw: unknown): Record<SettingKey, boolean> {
  const stored = isObject(raw) ? raw : {};
  return Object.fromEntries(
    SETTINGS_CATALOG.map((item) => [item.key, typeof stored[item.key] === 'boolean' ? stored[item.key] : item.default]),
  ) as Record<SettingKey, boolean>;
}

export const DEFAULT_DISPLAY: DisplaySettings = { language: 'system', locale: 'it', show: resolveShow(undefined) };

/** La voce è da mostrare: valore delle preferenze, o default del catalogo se manca (server vecchio). Pura. */
export function isShown(settings: Pick<DisplaySettings, 'show'>, key: SettingKey): boolean {
  return settings.show[key] ?? DEFAULT_DISPLAY.show[key];
}

/**
 * Preferenze ricevute dal server (JSON non fidato) → valide. Senza `locale` (server vecchio) vale la lingua scelta,
 * o l'italiano con "system". Pura.
 */
export function toDisplaySettings(raw: unknown): DisplaySettings {
  const v = isObject(raw) ? raw : {};
  const language = LANGUAGES.find((l) => l === v.language) ?? 'system';
  const locale = isLocale(v.locale) ? v.locale : resolveLocale(language, []);
  return { language, locale, show: resolveShow(v.show) };
}

/**
 * Contenuto di `src-tauri/splash/settings-catalog.js`: le pagine locali dell'app (Impostazioni e pannello) non
 * importano moduli TypeScript, e devono funzionare anche se il server non risponde. I nomi di schede, posti e voci
 * sono in `i18n.js` (src/shared/i18n). Un test controlla che il file sia aggiornato.
 */
export function catalogScript(): string {
  const data = { tabs: SETTINGS_TABS, places: SETTING_PLACES, items: SETTINGS_CATALOG, languages: LANGUAGES };
  return `// Generato da src/shared/settings.ts con \`npm run settings:catalog\`: non modificare a mano.\n` +
    `globalThis.AGENT_OFFICE_SETTINGS = ${JSON.stringify(data, null, 2)};\n`;
}
