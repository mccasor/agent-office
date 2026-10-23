// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Finestra Impostazioni (src-tauri/splash/settings.html) e lingua (#93): la pagina gira qui con catalogo e testi
 * generati e un `invoke` finto che fa la parte dell'app (settings_state, settings_set, settings_layout in main.rs):
 * salvando `language` l'app risolve la lingua e la rimanda in `locale`.
 */

const splash = (name: string) => readFileSync(join(import.meta.dirname, '../src-tauri/splash', name), 'utf8');
const html = splash('settings.html');
const body = /<body>([\s\S]*?)<script/.exec(html)![1]!;
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)![1]!;

const state = {
  version: '0.6.3', config: {} as Record<string, unknown>, autostart: false, hooks: 'installed', update: { kind: 'unknown' }, notice: null,
  locale: 'it',
};
const saved: [string, unknown][] = [];
let title = '';
const tick = () => new Promise((r) => setTimeout(r, 0));

async function open(): Promise<HTMLElement> {
  const w = window as unknown as Record<string, unknown> & { agentSettingsRefresh?: () => Promise<void> };
  if (!w.agentSettingsRefresh) {
    w.__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          if (cmd === 'settings_state') return structuredClone(state);
          if (cmd === 'settings_layout') title = args.title as string;
          if (cmd === 'settings_set') {
            saved.push([args.key as string, args.value]);
            state.config[args.key as string] = args.value;
            // come i18n::load: "system" qui vale italiano
            if (args.key === 'language') state.locale = args.value === 'system' ? 'it' : (args.value as string);
          }
          return undefined;
        },
      },
    };
    document.body.innerHTML = body;
    new Function(splash('settings-catalog.js'))();
    new Function(splash('i18n.js'))();
    new Function(script)();
  }
  await w.agentSettingsRefresh!();
  return document.getElementById('app')!;
}

const tabs = (root: HTMLElement) => [...root.querySelectorAll('.tab span')].map((e) => e.textContent);

describe('finestra Impostazioni: lingua (#93)', () => {
  it('menu "Lingua" nei Generali, ogni lingua col suo nome; scelta salvata e applicata subito', async () => {
    let root = await open();
    expect(tabs(root)).toEqual(['Generali', 'Claude', 'Agenti', 'Git', 'Istanze']);
    expect(title).toBe('Generali');
    const menu = root.querySelector<HTMLSelectElement>('select[data-key="language"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Lingua');
    expect([...menu.options].map((o) => [o.value, o.textContent])).toEqual([
      ['system', 'Sistema'], ['it', 'Italiano'], ['en', 'English'], ['es', 'Español'],
    ]);
    expect(menu.value).toBe('system');

    menu.value = 'en';
    menu.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    await tick();
    expect(saved.at(-1)).toEqual(['language', 'en']);
    root = document.getElementById('app')!;
    expect(tabs(root)).toEqual(['General', 'Claude', 'Agents', 'Git', 'Instances']);
    expect(title).toBe('General');
    expect(document.documentElement.lang).toBe('en');
    expect(root.textContent).toContain('Open at login');
    expect(root.textContent).toContain('Check for Updates');
    const english = root.querySelector<HTMLSelectElement>('select[data-key="language"]')!;
    expect(english.value).toBe('en');
    expect(english.options[0]!.textContent).toBe('System');
    expect([...root.querySelectorAll('select[data-key="activeWindowMinutes"] option')].map((o) => o.textContent))
      .toEqual(['5 min', '10 min', '15 min', '30 min', '1 hour', '2 hours', '4 hours']);
  });

  it('in spagnolo anche le voci del catalogo e i posti in cui compaiono', async () => {
    state.config.language = 'es';
    state.locale = 'es';
    let root = await open();
    expect(tabs(root)).toEqual(['General', 'Claude', 'Agentes', 'Git', 'Instancias']);
    (root.querySelector('[data-tab="agents"]') as HTMLElement).click();
    root = document.getElementById('app')!;
    expect(title).toBe('Agentes');
    const role = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.row__text span')?.textContent === 'Rol')!;
    expect(role.querySelector('.row__sub')!.textContent).toBe('Oficina · Instancias · Lista · Ficha');
    expect(root.textContent).toContain('Aviso de agente detenido tras');
    expect(root.textContent).toContain('5 llamadas iguales');
    (root.querySelector('[data-tab="general"]') as HTMLElement).click();
  });
});
