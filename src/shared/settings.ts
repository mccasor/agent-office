/**
 * Impostazioni di visualizzazione (#94): il catalogo delle voci che si possono mostrare o nascondere in ufficio,
 * nell'accordion delle istanze, nella scheda dell'agente, nella lista e nel pannello della menu bar.
 * Fonte unica per server, pagine web e finestra Impostazioni dell'app (che lo riceve come
 * `src-tauri/splash/settings-catalog.js`, generato da questo modulo: `npm run settings:catalog`).
 *
 * In ~/.agent-office/config.json gli interruttori stanno in `show: { [chiave]: boolean }`; chiavi mancanti o non
 * valide valgono il default del catalogo. Le chiavi sono stabili: rinominarle perde le scelte salvate.
 */

/** schede della finestra Impostazioni, nell'ordine della barra */
export const SETTINGS_TABS = [
  { id: 'general', label: 'Generali' },
  { id: 'claude', label: 'Claude' },
  { id: 'agents', label: 'Agenti' },
  { id: 'git', label: 'Git' },
  { id: 'instances', label: 'Istanze' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/** dove compare una voce: ufficio 2D, accordion delle istanze, scheda dell'agente, vista lista, pannello della menu bar */
export type SettingPlace = 'office' | 'instances' | 'card' | 'list' | 'panel';

export const PLACE_LABEL: Record<SettingPlace, string> = {
  office: 'Ufficio',
  instances: 'Istanze',
  card: 'Scheda',
  list: 'Lista',
  panel: 'Menu bar',
};

export interface SettingItem {
  key: string;
  tab: Exclude<SettingsTab, 'general'>;
  label: string;
  /** dove si vede: l'interruttore lo dice sotto l'etichetta */
  places: readonly SettingPlace[];
  default: boolean;
}

/**
 * Catalogo delle voci. Tutte visibili di default (com'era prima delle impostazioni). Le voci senza effetto nei
 * componenti sono già nel catalogo, così la finestra le mostra tutte; l'applicazione arriva con la seconda parte di #94.
 */
export const SETTINGS_CATALOG = [
  // Claude stesso (la sessione principale)
  { key: 'session.model', tab: 'claude', label: 'Modello', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.effort', tab: 'claude', label: 'Effort', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.tokens', tab: 'claude', label: 'Token generati', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.cost', tab: 'claude', label: 'Costo stimato', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.context', tab: 'claude', label: 'Contesto usato', places: ['instances', 'list', 'card', 'panel'], default: true },
  { key: 'session.turn', tab: 'claude', label: 'Durata del turno', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.title', tab: 'claude', label: 'Titolo della conversazione', places: ['list'], default: true },
  { key: 'session.activity', tab: 'claude', label: 'Attività in corso', places: ['panel'], default: true },
  // subagenti
  { key: 'agent.role', tab: 'agents', label: 'Ruolo', places: ['office', 'instances', 'list', 'card'], default: true },
  { key: 'agent.task', tab: 'agents', label: 'Compito', places: ['instances', 'list', 'card'], default: true },
  { key: 'agent.issues', tab: 'agents', label: 'Issue', places: ['list', 'card'], default: true },
  { key: 'agent.progress', tab: 'agents', label: 'Avanzamento', places: ['list', 'card'], default: true },
  { key: 'agent.duration', tab: 'agents', label: 'Durata', places: ['list', 'card'], default: true },
  { key: 'agent.model', tab: 'agents', label: 'Modello', places: ['card'], default: true },
  { key: 'agent.effort', tab: 'agents', label: 'Effort', places: ['card'], default: true },
  { key: 'agent.tokens', tab: 'agents', label: 'Token', places: ['list', 'card'], default: true },
  { key: 'agent.cost', tab: 'agents', label: 'Costo stimato', places: ['list', 'card'], default: true },
  { key: 'office.labels', tab: 'agents', label: 'Nomi sopra i personaggi', places: ['office'], default: true },
  { key: 'office.bubbles', tab: 'agents', label: 'Fumetto di chi aspetta', places: ['office'], default: true },
  { key: 'panel.agents', tab: 'agents', label: 'Agenti sotto le istanze', places: ['panel'], default: true },
  // repository
  { key: 'session.branch', tab: 'git', label: 'Branch', places: ['instances', 'list', 'card', 'panel'], default: true },
  { key: 'session.diff', tab: 'git', label: 'Modifiche non committate', places: ['instances', 'list', 'card'], default: true },
  { key: 'session.issues', tab: 'git', label: 'Issue del branch', places: ['instances', 'list'], default: true },
  // istanze
  { key: 'instances.counts', tab: 'instances', label: 'Subagenti per stato', places: ['instances', 'list'], default: true },
  { key: 'instances.done', tab: 'instances', label: 'Subagenti terminati', places: ['instances', 'list'], default: true },
  { key: 'list.finishedToday', tab: 'instances', label: 'Terminati oggi', places: ['list'], default: true },
] as const satisfies readonly SettingItem[];

export type SettingKey = (typeof SETTINGS_CATALOG)[number]['key'];

/** lingue dell'interfaccia (#93); "system" segue la lingua di macOS */
export const LANGUAGES = ['system', 'it', 'en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Preferenze di visualizzazione inviate alle pagine (evento SSE `config`, GET /api/config). */
export interface DisplaySettings {
  language: Language;
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

export const DEFAULT_DISPLAY: DisplaySettings = { language: 'system', show: resolveShow(undefined) };

/** La voce è da mostrare: valore delle preferenze, o default del catalogo se manca (server vecchio). Pura. */
export function isShown(settings: Pick<DisplaySettings, 'show'>, key: SettingKey): boolean {
  return settings.show[key] ?? DEFAULT_DISPLAY.show[key];
}

/** Preferenze ricevute dal server (JSON non fidato) → valide. Pura. */
export function toDisplaySettings(raw: unknown): DisplaySettings {
  const v = isObject(raw) ? raw : {};
  const language = LANGUAGES.find((l) => l === v.language) ?? 'system';
  return { language, show: resolveShow(v.show) };
}

/**
 * Contenuto di `src-tauri/splash/settings-catalog.js`: le pagine locali dell'app (Impostazioni e pannello) non
 * importano moduli TypeScript, e devono funzionare anche se il server non risponde. Un test controlla che il file sia
 * aggiornato.
 */
export function catalogScript(): string {
  const data = { tabs: SETTINGS_TABS, places: PLACE_LABEL, items: SETTINGS_CATALOG, languages: LANGUAGES };
  return `// Generato da src/shared/settings.ts con \`npm run settings:catalog\`: non modificare a mano.\n` +
    `globalThis.AGENT_OFFICE_SETTINGS = ${JSON.stringify(data, null, 2)};\n`;
}
