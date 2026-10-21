import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { HookEvent } from '../../shared/types.js';

/** default: ~/.agent-office */
export interface HookPathsOptions {
  dataDir?: string;
}

/** stessa codifica delle cartelle in ~/.claude/projects: "/a/b.c" -> "-a-b-c" */
function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function eventsFilePath(cwd: string, opts?: HookPathsOptions): string {
  const dataDir = opts?.dataDir ?? join(homedir(), '.agent-office');
  return join(dataDir, 'events', `${encodePath(cwd)}.jsonl`);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Tipo di notifica senza conservarne il testo: `notification_type` se presente (idle_prompt, permission_prompt,
 * elicitation_dialog...), altrimenti dal messaggio ("Claude is waiting for your input" = attesa del prossimo prompt).
 */
export function notificationKind(p: Record<string, unknown>): 'input' | 'idle' {
  const type = str(p.notification_type);
  if (type) return type === 'idle_prompt' ? 'idle' : 'input';
  return /waiting for your input/i.test(str(p.message) ?? '') ? 'idle' : 'input';
}

export function toHookEvent(payload: unknown, now: number): HookEvent | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const event = str(p.hook_event_name);
  const sessionId = str(p.session_id);
  if (!event || !sessionId) return null;
  return {
    event,
    sessionId,
    // i transcript usano l'id senza prefisso (subagents/agent-<id>.jsonl)
    agentId: str(p.agent_id)?.replace(/^agent-/, '') || null,
    agentType: str(p.agent_type),
    toolName: str(p.tool_name),
    ...(event === 'Notification' ? { notification: notificationKind(p) } : {}),
    cwd: str(p.cwd) ?? '',
    timestamp: now,
  };
}

/** Valida una riga già scritta nel file eventi (formato HookEvent). */
export function parseEventLine(line: string): HookEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  const nullableStr = (x: unknown) => x === null || typeof x === 'string';
  if (
    typeof e.event !== 'string' ||
    typeof e.sessionId !== 'string' ||
    typeof e.cwd !== 'string' ||
    typeof e.timestamp !== 'number' ||
    !nullableStr(e.agentId) ||
    !nullableStr(e.agentType) ||
    !nullableStr(e.toolName)
  ) {
    return null;
  }
  return e as unknown as HookEvent;
}

/** oltre questa dimensione il file eventi viene ruotato in `<file>.old` (sostituendo la rotazione precedente) */
export const MAX_EVENTS_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Eseguito dal binario hook. Il file è scelto in base a CLAUDE_PROJECT_DIR (cartella del progetto,
 * stabile anche se il cwd della sessione cambia o il subagente lavora in un worktree), altrimenti cwd.
 * Non lancia mai.
 */
export async function runHook(stdin: string, opts?: HookPathsOptions & { now?: number }): Promise<void> {
  try {
    const event = toHookEvent(JSON.parse(stdin), opts?.now ?? Date.now());
    if (!event) return;
    const dir = str(process.env.CLAUDE_PROJECT_DIR) ?? event.cwd;
    if (!dir) return;
    const file = eventsFilePath(dir, opts);
    await mkdir(dirname(file), { recursive: true });
    // rotazione: il file non cresce senza limiti (rename atomico; il watcher riparte dal file nuovo)
    const size = await stat(file).then((s) => s.size, () => 0);
    if (size > MAX_EVENTS_FILE_BYTES) await rename(file, `${file}.old`).catch(() => {});
    // una sola write in O_APPEND: righe piccole, atomiche rispetto ad hook concorrenti
    await appendFile(file, JSON.stringify(event) + '\n');
  } catch {
    // mai far fallire Claude
  }
}
