import { parseArgs } from './cli';

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
