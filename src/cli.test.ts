import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookCommand, main, parseArgs } from './cli';
import { setLocale } from './shared/i18n/index.js';

describe('parseArgs', () => {
  it('default: serve sulla cwd, porta 4317, apre il browser', () => {
    expect(parseArgs([], '/p')).toEqual({ command: 'serve', port: 4317, open: true, cwd: '/p', all: false, exitWithStdin: false });
  });

  it('opzioni --port, --no-open, --cwd', () => {
    expect(parseArgs(['--port', '0', '--no-open', '--cwd', '/x'], '/p')).toEqual({
      command: 'serve', port: 0, open: false, cwd: '/x', all: false, exitWithStdin: false,
    });
  });

  it('--all: tutte le sessioni; install-hooks --global: hook globali', () => {
    expect(parseArgs(['--all', '--no-open'], '/p')).toMatchObject({ command: 'serve', all: true, open: false });
    expect(parseArgs(['install-hooks', '--global'], '/p')).toMatchObject({ command: 'install-hooks', all: true });
    expect(parseArgs(['--exit-with-stdin'], '/p').exitWithStdin).toBe(true);
  });

  it('sottocomandi install-hooks / uninstall-hooks', () => {
    expect(parseArgs(['install-hooks'], '/p').command).toBe('install-hooks');
    expect(parseArgs(['uninstall-hooks'], '/p').command).toBe('uninstall-hooks');
  });

  it('argomenti non validi -> errore', () => {
    expect(() => parseArgs(['--port', 'abc'], '/p')).toThrow(/porta/i);
    expect(() => parseArgs(['--boh'], '/p')).toThrow(/sconosciut/i);
  });
});

describe('hookCommand', () => {
  it('percorsi tra apici singoli, anche con spazi, virgolette e $', () => {
    expect(hookCommand('/opt/homebrew/bin/node', "/Applications/Agent Office.app/hook's $HOME.mjs")).toBe(
      "[ -f '/Applications/Agent Office.app/hook'\\''s $HOME.mjs' ] && '/opt/homebrew/bin/node' '/Applications/Agent Office.app/hook'\\''s $HOME.mjs' || true",
    );
  });

  it('eseguito da sh: lancia il file se esiste, altrimenti esce senza errori', () => {
    const run = (cmd: string) => execFileSync('/bin/sh', ['-c', cmd], { input: '{}' }).toString();
    expect(run(hookCommand('/bin/echo', '/bin/sh'))).toBe('/bin/sh\n');
    expect(run(hookCommand('/bin/echo', '/non/esiste/hook.mjs'))).toBe('');
  });
});

describe('messaggi nella lingua scelta (#103)', () => {
  let dir: string;
  let log: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-office-cli-'));
    log = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void log.push(args.join(' ')));
    vi.stubEnv('AGENT_OFFICE_DATA_DIR', dir);
    for (const name of ['AGENT_OFFICE_LANGUAGES', 'LC_ALL', 'LC_MESSAGES', 'LANG']) vi.stubEnv(name, '');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setLocale('it');
    await rm(dir, { recursive: true, force: true });
  });

  const language = (value: string) => writeFile(join(dir, 'config.json'), JSON.stringify({ language: value }));

  it('errori degli argomenti in italiano, inglese e spagnolo', () => {
    expect(() => parseArgs(['--port', 'abc'], '/p')).toThrow('Porta non valida: abc');
    setLocale('en');
    expect(() => parseArgs(['--port', '70000'], '/p')).toThrow('Invalid port: 70000');
    expect(() => parseArgs(['--boh'], '/p')).toThrow(/^Unknown argument: --boh\nUsage: agent-office /);
    setLocale('es');
    expect(() => parseArgs(['--boh'], '/p')).toThrow(/^Argumento desconocido: --boh\nUso: agent-office /);
  });

  it('lingua di config.json, anche con un terminale in un\'altra lingua', async () => {
    await language('es');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    await main(['--help']);
    expect(log[0]).toMatch(/^Uso: agent-office /);
    expect(log[0]).toContain('puerto del servidor (por omisión 4317)');
    expect(log[0]).toContain('--help       muestra esta ayuda');
  });

  it('"system": la lingua del terminale (LANG) o quelle passate dall\'app', async () => {
    await language('system');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    await main(['install-hooks', '--cwd', dir]);
    await main(['install-hooks', '--cwd', dir]);
    await main(['uninstall-hooks', '--cwd', dir]);
    await main(['uninstall-hooks', '--cwd', dir]);
    const file = join(dir, '.claude', 'settings.local.json');
    expect(log).toEqual([`Hooks installed in ${file}`, `Hooks already in ${file}`, `Hooks removed from ${file}`, 'No agent-office hooks to remove']);
    // AGENT_OFFICE_LANGUAGES (lingue di macOS passate dall'app) prima di LANG
    vi.stubEnv('AGENT_OFFICE_LANGUAGES', 'fr-FR,it-IT');
    await main(['install-hooks', '--cwd', dir]);
    expect(log.at(-1)).toBe(`Hook installati in ${file}`);
  });

  it('impostazioni di Claude Code non valide: errore tradotto', async () => {
    await language('en');
    await mkdir(join(dir, '.claude'));
    const file = join(dir, '.claude', 'settings.local.json');
    await writeFile(file, '[1]');
    await expect(main(['install-hooks', '--cwd', dir])).rejects.toThrow(`${file}: expected a JSON object`);
    await language('es');
    await expect(main(['uninstall-hooks', '--cwd', dir])).rejects.toThrow(`${file}: se esperaba un objeto JSON`);
  });
});
