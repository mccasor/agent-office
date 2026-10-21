import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Eventi registrati (verificati su https://code.claude.com/docs/en/hooks). */
export const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit'] as const;

/** Eventi con matcher sul nome del tool: "*" = tutti. Per gli altri il matcher omesso significa "tutti". */
const TOOL_EVENTS = new Set<string>(['PreToolUse', 'PostToolUse']);

/** Marcatore con cui riconosciamo le nostre voci. */
const MARKER = 'agent-office-hook';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function isOurs(handler: unknown, extra?: string): boolean {
  if (!isObj(handler) || typeof handler.command !== 'string') return false;
  return handler.command.includes(MARKER) || (extra !== undefined && handler.command === extra);
}

const settingsFile = (projectDir: string) => join(projectDir, '.claude', 'settings.local.json');

async function readSettings(file: string): Promise<Json | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isObj(parsed)) throw new Error(`${file}: atteso un oggetto JSON`);
  return parsed;
}

async function writeSettings(file: string, settings: Json): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n');
  await rename(tmp, file);
}

/** Rimuove le nostre voci (puro); elimina gruppi/array/oggetto hooks svuotati dalla rimozione. */
function strip(settings: Json, extra?: string): Json {
  if (!isObj(settings.hooks)) return settings;
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    let removed = false;
    const kept: unknown[] = [];
    for (const g of groups as unknown[]) {
      if (!isObj(g) || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const handlers = (g.hooks as unknown[]).filter((h) => !isOurs(h, extra));
      if (handlers.length === g.hooks.length) kept.push(g);
      else {
        removed = true;
        if (handlers.length > 0) kept.push({ ...g, hooks: handlers });
      }
    }
    if (kept.length > 0 || !removed) hooks[event] = kept;
  }
  const out: Json = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

export async function installHooks(projectDir: string, hookCommand: string): Promise<{ changed: boolean; file: string }> {
  const file = settingsFile(projectDir);
  const current = await readSettings(file);
  const next = strip(current ?? {}, hookCommand);
  const hooks: Json = isObj(next.hooks) ? { ...next.hooks } : {};
  for (const event of HOOK_EVENTS) {
    const handlers = [{ type: 'command', command: hookCommand }];
    const group = TOOL_EVENTS.has(event) ? { matcher: '*', hooks: handlers } : { hooks: handlers };
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, group];
  }
  next.hooks = hooks;
  const changed = current === null || JSON.stringify(current) !== JSON.stringify(next);
  if (changed) await writeSettings(file, next);
  return { changed, file };
}

export async function uninstallHooks(projectDir: string): Promise<{ changed: boolean; file: string }> {
  const file = settingsFile(projectDir);
  const current = await readSettings(file);
  if (current === null) return { changed: false, file };
  const next = strip(current);
  if (JSON.stringify(current) === JSON.stringify(next)) return { changed: false, file };
  // file rimasto vuoto: lo avevamo creato noi (o non conteneva nulla) -> rimosso
  if (Object.keys(next).length === 0) await unlink(file);
  else await writeSettings(file, next);
  return { changed: true, file };
}
