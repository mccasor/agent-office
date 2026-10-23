import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Impostazioni lette da <dataDir>/config.json (lo stesso file in cui l'app della menu bar salva le notifiche). */
export interface ServerConfig {
  /** una sessione senza attività da più di questi minuti non è più attiva (sparisce da ufficio, lista e menu) */
  activeWindowMinutes: number;
  /** un subagente non terminato senza attività da più di questi minuti ha l'avviso "fermo" (#97) */
  staleAgentMinutes: number;
  /** chiamate consecutive allo stesso tool con lo stesso input da cui un subagente ha l'avviso "in loop" (#97) */
  loopRepeats: number;
}

export const DEFAULT_CONFIG: ServerConfig = { activeWindowMinutes: 10, staleAgentMinutes: 60, loopRepeats: 5 };

/** numero nell'intervallo [min, max] (intero con `int`), altrimenti il default */
function inRange(v: unknown, min: number, max: number, fallback: number, int = false): number {
  return typeof v === 'number' && v >= min && v <= max && (!int || Number.isInteger(v)) ? v : fallback;
}

/** Valori mancanti o non validi -> default; file assente o illeggibile -> tutto default. */
export async function loadConfig(dataDir = join(homedir(), '.agent-office')): Promise<ServerConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
  } catch {
    return DEFAULT_CONFIG;
  }
  const c = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    activeWindowMinutes: inRange(c.activeWindowMinutes, 1, 24 * 60, DEFAULT_CONFIG.activeWindowMinutes),
    staleAgentMinutes: inRange(c.staleAgentMinutes, 1, 24 * 60, DEFAULT_CONFIG.staleAgentMinutes),
    loopRepeats: inRange(c.loopRepeats, 2, 100, DEFAULT_CONFIG.loopRepeats, true),
  };
}
