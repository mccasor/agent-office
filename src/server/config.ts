import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LANGUAGES, resolveShow, type DisplaySettings } from '../shared/settings.js';

/**
 * Impostazioni lette da <dataDir>/config.json. Il file è condiviso: lo scrive l'app della menu bar (finestra
 * Impostazioni, #94), che conserva le chiavi che non conosce; il server lo legge all'avvio e lo riosserva
 * (watchConfig), così le modifiche valgono subito. Valori mancanti o non validi -> default.
 *
 * Per aggiungere una chiave: una riga in FIELDS (con il suo parser) e il campo compare in ServerConfig.
 */

/** Lettore di una chiave: il valore se valido, altrimenti undefined (vale il default). */
type Parse<T> = (raw: unknown) => T | undefined;

interface Field<T> {
  default: T;
  parse: Parse<T>;
}

const number = (min: number, max: number, fallback: number): Field<number> => ({
  default: fallback,
  parse: (v) => (typeof v === 'number' && v >= min && v <= max ? v : undefined),
});

const oneOf = <T extends string>(values: readonly T[], fallback: T): Field<T> => ({
  default: fallback,
  parse: (v) => values.find((x) => x === v),
});

const integer = (min: number, max: number, fallback: number): Field<number> => ({
  default: fallback,
  parse: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined),
});

const FIELDS = {
  /** una sessione senza attività da più di questi minuti non è più attiva (sparisce da ufficio, lista e menu) */
  activeWindowMinutes: number(1, 24 * 60, 10),
  /** un subagente non terminato senza attività da più di questi minuti ha l'avviso "fermo" (#97) */
  staleAgentMinutes: number(1, 24 * 60, 60),
  /** chiamate consecutive allo stesso tool con lo stesso input da cui un subagente ha l'avviso "in loop" (#97) */
  loopRepeats: integer(2, 100, 5),
  /** lingua dell'interfaccia (#93, non ancora usata) */
  language: oneOf(LANGUAGES, 'system'),
  /** voci da mostrare (catalogo in shared/settings.ts): sempre tutte, risolte con i default */
  show: { default: resolveShow(undefined), parse: resolveShow } satisfies Field<DisplaySettings['show']>,
};

export type ServerConfig = { [K in keyof typeof FIELDS]: (typeof FIELDS)[K]['default'] };

export const DEFAULT_CONFIG = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.default])) as ServerConfig;

export const defaultDataDir = (): string => join(homedir(), '.agent-office');

/** Contenuto di config.json (qualunque) → impostazioni valide. Pura. */
export function parseConfig(raw: unknown): ServerConfig {
  const stored = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(FIELDS) as [string, Field<unknown>][]) {
    out[key] = field.parse(stored[key]) ?? field.default;
  }
  return out as ServerConfig;
}

/** Preferenze di visualizzazione per le pagine: niente che non serva a disegnare (né percorsi né prompt). */
export const displaySettings = (c: ServerConfig): DisplaySettings => ({ language: c.language, show: c.show });

/** File assente o illeggibile -> tutto default. */
export async function loadConfig(dataDir = defaultDataDir()): Promise<ServerConfig> {
  try {
    return parseConfig(JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')));
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** le scritture arrivano a raffiche (file temporaneo, rename): si rilegge dopo una pausa */
const WATCH_DEBOUNCE_MS = 200;

/**
 * Osserva config.json e chiama `onChange` con le impostazioni nuove quando cambiano davvero (non a ogni evento del
 * file system). Si osserva la cartella, non il file: l'app lo sostituisce con un rename e il file può non esistere
 * ancora. Ritorna la funzione che smette di osservare.
 */
export async function watchConfig(
  onChange: (config: ServerConfig) => void,
  opts: { dataDir?: string; initial?: ServerConfig; debounceMs?: number } = {},
): Promise<() => void> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const debounceMs = opts.debounceMs ?? WATCH_DEBOUNCE_MS;
  let last = JSON.stringify(opts.initial ?? (await loadConfig(dataDir)));
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const reload = async () => {
    timer = null;
    const next = await loadConfig(dataDir);
    const text = JSON.stringify(next);
    if (closed || text === last) return;
    last = text;
    onChange(next);
  };

  let watcher: FSWatcher | null = null;
  try {
    await mkdir(dataDir, { recursive: true });
    watcher = watch(dataDir, (_event, file) => {
      // senza nome (alcuni file system) si rilegge comunque: il confronto evita notifiche inutili
      if (closed || (file !== null && file !== 'config.json')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), debounceMs);
      timer.unref();
    });
    watcher.on('error', () => watcher?.close());
  } catch {
    // cartella non osservabile: valgono le impostazioni lette all'avvio
  }
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
