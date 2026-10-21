import { execFileSync } from 'node:child_process';
import { hookCommand, parseArgs } from './cli';

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
