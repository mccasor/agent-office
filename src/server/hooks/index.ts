import type { HookEvent, Watcher } from '../../shared/types.js';

/** default: ~/.agent-office */
export interface HookPathsOptions {
  dataDir?: string;
}

/** file JSONL degli eventi hook per la cartella monitorata */
export function eventsFilePath(_cwd: string, _opts?: HookPathsOptions): string {
  throw new Error('not implemented');
}

/** Converte il JSON ricevuto su stdin da Claude Code in HookEvent; null se non valido. */
export function toHookEvent(_payload: unknown, _now: number): HookEvent | null {
  throw new Error('not implemented');
}

/** Eseguito dal binario hook: legge stdin, appende l'evento al file. Non deve mai far fallire Claude. */
export function runHook(_stdin: string, _opts?: HookPathsOptions & { now?: number }): Promise<void> {
  throw new Error('not implemented');
}

/** Aggiunge (idempotente) gli hook in <projectDir>/.claude/settings.local.json preservando il resto. */
export function installHooks(_projectDir: string, _hookCommand: string): Promise<{ changed: boolean; file: string }> {
  throw new Error('not implemented');
}

export function uninstallHooks(_projectDir: string): Promise<{ changed: boolean; file: string }> {
  throw new Error('not implemented');
}

export function createHookEventsWatcher(_opts: { cwd: string } & HookPathsOptions): Watcher<HookEvent[]> {
  throw new Error('not implemented');
}
