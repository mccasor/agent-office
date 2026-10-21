import { appendFile, mkdir } from 'node:fs/promises';
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
    // una sola write in O_APPEND: righe piccole, atomiche rispetto ad hook concorrenti
    await appendFile(file, JSON.stringify(event) + '\n');
  } catch {
    // mai far fallire Claude
  }
}
