import type { TranscriptSnapshot, Watcher, WorkArea } from '../../shared/types.js';

export interface TranscriptWatcherOptions {
  /** cartella monitorata (cwd dell'utente) */
  cwd: string;
  /** default: ~/.claude */
  claudeHome?: string;
  /** una sessione è attiva se modificata negli ultimi N ms (default 10 min) */
  activeWindowMs?: number;
  now?: () => number;
}

/** "/Library/WebServer/Documents/olimpo-ui" -> "-Library-WebServer-Documents-olimpo-ui" */
export function encodeProjectPath(_cwd: string): string {
  throw new Error('not implemented');
}

export function classifyArea(_input: { agentType: string; description: string; filePaths: string[] }): WorkArea {
  throw new Error('not implemented');
}

export function createTranscriptWatcher(_opts: TranscriptWatcherOptions): Watcher<TranscriptSnapshot> {
  throw new Error('not implemented');
}
