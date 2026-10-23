import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Impostazioni lette da <dataDir>/config.json (lo stesso file in cui l'app della menu bar salva le notifiche). */
export interface ServerConfig {
  /** una sessione senza attività da più di questi minuti non è più attiva (sparisce da ufficio, lista e menu) */
  activeWindowMinutes: number;
}

export const DEFAULT_CONFIG: ServerConfig = { activeWindowMinutes: 10 };

/** Valori mancanti o non validi -> default; file assente o illeggibile -> tutto default. */
export async function loadConfig(dataDir = join(homedir(), '.agent-office')): Promise<ServerConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
  } catch {
    return DEFAULT_CONFIG;
  }
  const minutes = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).activeWindowMinutes : undefined;
  return {
    activeWindowMinutes: typeof minutes === 'number' && minutes >= 1 && minutes <= 24 * 60 ? minutes : DEFAULT_CONFIG.activeWindowMinutes,
  };
}
