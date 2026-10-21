import { parseArgs } from './cli';

describe('parseArgs', () => {
  it('default: serve sulla cwd, porta 4317, apre il browser', () => {
    expect(parseArgs([], '/p')).toEqual({ command: 'serve', port: 4317, open: true, cwd: '/p' });
  });

  it('opzioni --port, --no-open, --cwd', () => {
    expect(parseArgs(['--port', '0', '--no-open', '--cwd', '/x'], '/p')).toEqual({
      command: 'serve', port: 0, open: false, cwd: '/x',
    });
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
