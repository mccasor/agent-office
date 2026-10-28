import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, displaySettings, loadConfig, parseConfig, systemLanguages, watchConfig, type ServerConfig } from './config.js';

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-office-config-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('file assente o non valido: valori predefiniti', async () => {
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    await writeFile(join(dir, 'config.json'), '{ rotto');
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('legge la finestra di attività e ignora valori fuori misura e chiavi dell\'app', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 30, notifyWaiting: false }));
    expect(await loadConfig(dir)).toEqual({ ...DEFAULT_CONFIG, activeWindowMinutes: 30 });
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 0 }));
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('soglie degli avvisi sugli agenti (#97): fermo e in loop', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ staleAgentMinutes: 90, loopRepeats: 8 }));
    expect(await loadConfig(dir)).toEqual({ ...DEFAULT_CONFIG, staleAgentMinutes: 90, loopRepeats: 8 });
    await writeFile(join(dir, 'config.json'), JSON.stringify({ staleAgentMinutes: -1, loopRepeats: 2.5 }));
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });
});

describe('parseConfig', () => {
  it('ogni chiave per conto suo: le valide restano, le altre al default', () => {
    const c = parseConfig({ activeWindowMinutes: 'tanti', language: 'en', show: { 'session.diff': false, 'session.context': 1 }, notifyDone: true });
    expect(c.activeWindowMinutes).toBe(DEFAULT_CONFIG.activeWindowMinutes);
    expect(c.language).toBe('en');
    expect(c.show['session.diff']).toBe(false);
    expect(c.show['session.context']).toBe(true);
    // chiavi di altri (l'app, versioni future): non lette, non rompono nulla
    expect('notifyDone' in c).toBe(false);
    expect(parseConfig({ language: 'klingon', show: 'tutto' })).toEqual(DEFAULT_CONFIG);
    expect(parseConfig([1, 2])).toEqual(DEFAULT_CONFIG);
  });

  it('alle pagine solo lingua (scelta e risolta), voci da mostrare e composizione dell\'ufficio', () => {
    expect(Object.keys(displaySettings(DEFAULT_CONFIG)).sort()).toEqual(['language', 'locale', 'office', 'show']);
  });

  it('lingua "system" risolta una volta qui: macOS (dall\'app), poi il terminale, poi italiano', () => {
    expect(systemLanguages({ AGENT_OFFICE_LANGUAGES: 'fr-FR, es-ES', LANG: 'en_US.UTF-8' })).toEqual(['fr-FR', 'es-ES']);
    expect(systemLanguages({ LC_ALL: 'C', LANG: 'en_US.UTF-8' })).toEqual(['en_US.UTF-8']);
    expect(systemLanguages({})).toEqual([]);
    expect(displaySettings(DEFAULT_CONFIG, ['fr-FR', 'es-ES']).locale).toBe('es');
    expect(displaySettings(DEFAULT_CONFIG, ['en_US.UTF-8']).locale).toBe('en');
    expect(displaySettings(DEFAULT_CONFIG, ['de-DE']).locale).toBe('it');
    expect(displaySettings(DEFAULT_CONFIG, []).locale).toBe('it');
    // una lingua scelta vale su quella del sistema
    expect(displaySettings(parseConfig({ language: 'es' }), ['en-US']).locale).toBe('es');
  });
});

describe('watchConfig', () => {
  let dir: string;
  let stop: (() => void) | null = null;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-office-watch-'));
  });
  afterEach(async () => {
    stop?.();
    stop = null;
    await rm(dir, { recursive: true, force: true });
  });

  const seen = () => {
    const changes: ServerConfig[] = [];
    const onChange = vi.fn((c: ServerConfig) => void changes.push(c));
    return { changes, onChange };
  };

  /** su macOS l'osservazione (FSEvents) parte con un attimo di ritardo: una scrittura immediata può andare persa */
  const settle = () => new Promise((r) => setTimeout(r, 100));

  it('notifica le impostazioni nuove, anche con il file sostituito da un rename, e una volta sola per raffica', async () => {
    const { changes, onChange } = seen();
    stop = await watchConfig(onChange, { dataDir: dir, debounceMs: 20 });
    await settle();
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 5 }));
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 15 }));
    await vi.waitFor(() => expect(changes.at(-1)?.activeWindowMinutes).toBe(15), { timeout: 3000 });
    // come l'app: scrive un file temporaneo e lo rinomina
    await writeFile(join(dir, 'config.json.tmp'), JSON.stringify({ activeWindowMinutes: 15, show: { 'panel.agents': false } }));
    await rename(join(dir, 'config.json.tmp'), join(dir, 'config.json'));
    await vi.waitFor(() => expect(changes.at(-1)?.show['panel.agents']).toBe(false), { timeout: 3000 });
    const calls = onChange.mock.calls.length;
    // contenuto diverso ma impostazioni uguali (chiave sconosciuta): nessuna notifica
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeWindowMinutes: 15, show: { 'panel.agents': false }, altro: 1 }));
    await new Promise((r) => setTimeout(r, 120));
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('cartella assente: la crea e osserva lo stesso; dopo lo stop nessuna notifica', async () => {
    const { onChange } = seen();
    const nested = join(dir, 'nuova');
    stop = await watchConfig(onChange, { dataDir: nested, debounceMs: 20 });
    await settle();
    await writeFile(join(nested, 'config.json'), JSON.stringify({ language: 'es' }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 });
    stop();
    stop = null;
    await writeFile(join(nested, 'config.json'), JSON.stringify({ language: 'it' }));
    await new Promise((r) => setTimeout(r, 120));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
