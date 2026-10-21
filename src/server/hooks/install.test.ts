import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOOK_EVENTS, installHooks, installHooksIn, uninstallHooks } from './index.js';

const CMD = 'npx -y agent-office-hook';

describe('installHooks / uninstallHooks', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-office-install-'));
    file = join(dir, '.claude', 'settings.local.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const read = async () => JSON.parse(await readFile(file, 'utf8'));

  it('settings.json come link simbolico (dotfiles): resta un link e si aggiorna il file reale, con i suoi permessi', async () => {
    const real = join(dir, 'dotfiles', 'settings.json');
    const link = join(dir, 'settings.json');
    await mkdir(join(dir, 'dotfiles'), { recursive: true });
    await writeFile(real, JSON.stringify({ model: 'opus' }), { mode: 0o600 });
    await symlink(real, link);
    expect((await installHooksIn(link, CMD)).changed).toBe(true);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    const written = JSON.parse(await readFile(real, 'utf8'));
    expect(written.model).toBe('opus');
    expect(Object.keys(written.hooks)).toEqual([...HOOK_EVENTS]);
    expect((await stat(real)).mode & 0o777).toBe(0o600);
  });

  it('crea settings.local.json con tutti gli eventi', async () => {
    expect(await installHooks(dir, CMD)).toEqual({ changed: true, file });
    const s = await read();
    expect(Object.keys(s.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(s.hooks.PreToolUse).toEqual([{ matcher: '*', hooks: [{ type: 'command', command: CMD }] }]);
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: CMD }] }]);
    expect(HOOK_EVENTS).toEqual(
      expect.arrayContaining(['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse', 'Stop']),
    );
  });

  it('è idempotente', async () => {
    await installHooks(dir, CMD);
    const before = await readFile(file, 'utf8');
    expect(await installHooks(dir, CMD)).toEqual({ changed: false, file });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('aggiorna il comando se cambiato, senza duplicare', async () => {
    await installHooks(dir, CMD);
    expect((await installHooks(dir, 'node /x/bin/agent-office-hook.mjs')).changed).toBe(true);
    const s = await read();
    expect(s.hooks.PreToolUse).toEqual([{ matcher: '*', hooks: [{ type: 'command', command: 'node /x/bin/agent-office-hook.mjs' }] }]);
  });

  it('preserva chiavi e hook esistenti; uninstall rimuove solo le proprie voci', async () => {
    const original = {
      permissions: { allow: ['Bash(ls)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }],
        Notification: [{ hooks: [{ type: 'command', command: 'say hi' }] }],
      },
    };
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(file, JSON.stringify(original, null, 2));

    await installHooks(dir, CMD);
    const s = await read();
    expect(s.permissions).toEqual(original.permissions);
    expect(s.hooks.Notification).toEqual([original.hooks.Notification[0], { hooks: [{ type: 'command', command: CMD }] }]);
    expect(s.hooks.PreToolUse).toEqual([
      original.hooks.PreToolUse[0],
      { matcher: '*', hooks: [{ type: 'command', command: CMD }] },
    ]);

    expect(await uninstallHooks(dir)).toEqual({ changed: true, file });
    expect(await read()).toEqual(original);
    expect((await uninstallHooks(dir)).changed).toBe(false);
  });

  it('uninstall rimuove le proprie voci anche dentro gruppi misti', async () => {
    const mixed = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'echo keep' },
              { type: 'command', command: '/usr/local/bin/agent-office-hook' },
            ],
          },
        ],
      },
    };
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(file, JSON.stringify(mixed));
    await uninstallHooks(dir);
    expect(await read()).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } });
  });

  it('uninstall dopo install su progetto vuoto elimina il file creato', async () => {
    await installHooks(dir, CMD);
    expect(await uninstallHooks(dir)).toEqual({ changed: true, file });
    await expect(readFile(file)).rejects.toThrow();
  });

  it('uninstall senza file: nessuna modifica', async () => {
    expect(await uninstallHooks(dir)).toEqual({ changed: false, file });
    await expect(readFile(file)).rejects.toThrow();
  });

  it('non sovrascrive un settings con JSON non valido', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(file, '{ broken');
    await expect(installHooks(dir, CMD)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{ broken');
  });
});
