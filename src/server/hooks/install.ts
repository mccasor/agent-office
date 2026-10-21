import { chmod, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Eventi registrati (verificati su https://code.claude.com/docs/en/hooks). */
export const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit', 'Notification'] as const;

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

/** Impostazioni utente di Claude Code: hook validi per tutte le sessioni, in qualunque cartella. */
export const globalSettingsFile = (claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')) =>
  join(claudeHome, 'settings.json');

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function parseSettings(file: string, text: string | null): Json | null {
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  if (!isObj(parsed)) throw new Error(`${file}: atteso un oggetto JSON`);
  return parsed;
}

/** tentativi quando il file cambia mentre lo si aggiorna (es. Claude Code salva i permessi nello stesso istante) */
const UPDATE_ATTEMPTS = 5;

/**
 * Aggiorna il file di impostazioni con `change` (null = da eliminare); false se non cambia nulla.
 * Scrive sul file reale se è un link simbolico (dotfiles), conserva i permessi e, se il file viene modificato da
 * altri tra lettura e scrittura, riparte dal contenuto nuovo invece di sovrascriverlo.
 */
async function updateSettings(file: string, change: (current: Json | null) => Json | null): Promise<boolean> {
  const target = await realpath(file).catch(() => file);
  for (let attempt = 1; ; attempt++) {
    const before = await readText(target);
    const current = parseSettings(file, before);
    const next = change(current);
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    if (next === null) {
      await unlink(target);
      return true;
    }
    await mkdir(join(target, '..'), { recursive: true });
    const mode = await stat(target).then((s) => s.mode & 0o777, () => null);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2) + '\n');
    if (mode !== null) await chmod(tmp, mode);
    if ((await readText(target)) !== before && attempt < UPDATE_ATTEMPTS) {
      await unlink(tmp);
      continue;
    }
    await rename(tmp, target);
    return true;
  }
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

export function installHooks(projectDir: string, hookCommand: string): Promise<{ changed: boolean; file: string }> {
  return installHooksIn(settingsFile(projectDir), hookCommand);
}

export function uninstallHooks(projectDir: string): Promise<{ changed: boolean; file: string }> {
  return uninstallHooksIn(settingsFile(projectDir));
}

/** Installa gli hook nel file di impostazioni indicato (progetto o globale). Idempotente. */
export async function installHooksIn(file: string, hookCommand: string): Promise<{ changed: boolean; file: string }> {
  const changed = await updateSettings(file, (current) => {
    const next = strip(current ?? {}, hookCommand);
    const hooks: Json = isObj(next.hooks) ? { ...next.hooks } : {};
    for (const event of HOOK_EVENTS) {
      const handlers = [{ type: 'command', command: hookCommand }];
      const group = TOOL_EVENTS.has(event) ? { matcher: '*', hooks: handlers } : { hooks: handlers };
      const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
      hooks[event] = [...existing, group];
    }
    return { ...next, hooks };
  });
  return { changed, file };
}

/** Rimuove solo le voci di agent-office dal file di impostazioni indicato. */
export async function uninstallHooksIn(file: string): Promise<{ changed: boolean; file: string }> {
  const changed = await updateSettings(file, (current) => {
    if (current === null) return null;
    const next = strip(current);
    // file rimasto vuoto: lo avevamo creato noi (o non conteneva nulla) -> rimosso
    return Object.keys(next).length === 0 && JSON.stringify(next) !== JSON.stringify(current) ? null : next;
  });
  return { changed, file };
}
