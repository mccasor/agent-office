// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Finestra del terminale (src-tauri/splash/terminal.html, #120): la pagina gira qui con i testi generati, xterm finto e
 * un `invoke` finto come farebbe l'app (pty.rs). Chiudere la finestra la nasconde soltanto (lo decide l'app);
 * "Termina istanza" chiede all'app di terminare (pty_kill, che chiede conferma) e a processo uscito diventa "Chiudi".
 */

const splash = (name: string) => readFileSync(join(import.meta.dirname, '../src-tauri/splash', name), 'utf8');
const html = splash('terminal.html');
const body = /<body>([\s\S]*?)<script/.exec(html)![1]!;
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)![1]!;

type Message = ArrayBuffer | { exit: number | null };

async function load(lang: string) {
  const calls: string[] = [];
  const written: string[] = [];
  let channel: { onmessage?: (msg: Message) => void } = {};
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: { output?: typeof channel }) => {
        calls.push(cmd);
        if (cmd === 'pty_start') channel = args!.output!;
      },
      Channel: class {},
    },
  };
  w.Terminal = class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    onData() {}
    onResize() {}
    write(text: string) {
      written.push(text);
    }
  };
  w.FitAddon = { FitAddon: class { fit() {} } };
  w.ResizeObserver = class { observe() {} };
  history.replaceState(null, '', `/terminal.html?lang=${lang}`);
  document.body.innerHTML = body;
  new Function(splash('i18n.js'))();
  new Function(script)();
  await Promise.resolve();
  return { calls, written, send: (msg: Message) => channel.onmessage!(msg), end: document.getElementById('end')! };
}

describe('finestra del terminale (#120)', () => {
  it('"Termina istanza" chiede all\'app di terminare, nella lingua dell\'app', async () => {
    const page = await load('en');
    expect(page.calls).toEqual(['pty_start']);
    expect(page.end.textContent).toBe('Terminate Instance');
    page.end.click();
    expect(page.calls).toEqual(['pty_start', 'pty_kill']);
  });

  it('processo uscito: lo dice nel terminale e il bottone chiude', async () => {
    const page = await load('it');
    expect(page.end.textContent).toBe('Termina istanza');
    page.send({ exit: 3 });
    expect(page.written.join('')).toContain('[processo terminato (3)]');
    expect(page.end.textContent).toBe('Chiudi');
    page.send({ exit: null });
    expect(page.written.join('')).toContain('[processo terminato]');
  });
});
