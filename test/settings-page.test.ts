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
  locale: 'it', officeLocked: false,
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
            // come settings_set in main.rs: l'ufficio non si cambia mentre gli agenti lavorano
            if ((args.key as string).startsWith('office.') && state.officeLocked) throw new Error('bloccato');
            saved.push([args.key as string, args.value]);
            if ((args.key as string).startsWith('office.')) state.config.office = { rooms: args.value };
            else state.config[args.key as string] = args.value;
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

const tabs = (root: HTMLElement) => [...root.querySelectorAll('.tab__label')].map((e) => e.textContent);

describe('finestra Impostazioni: lingua (#93)', () => {
  it('menu "Lingua" nei Generali, ogni lingua col suo nome; scelta salvata e applicata subito', async () => {
    let root = await open();
    expect(tabs(root)).toEqual(['Generali', 'Claude', 'Agenti', 'Git', 'Istanze', 'Ufficio']);
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
    expect(tabs(root)).toEqual(['General', 'Claude', 'Agents', 'Git', 'Instances', 'Office']);
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
    expect(tabs(root)).toEqual(['General', 'Claude', 'Agentes', 'Git', 'Instancias', 'Oficina']);
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

describe('finestra Impostazioni: ufficio (#108)', () => {
  const app = () => document.getElementById('app')!;
  const labels = (root: HTMLElement) =>
    [...root.querySelectorAll('.group')].map((g) => [...g.querySelectorAll('.row__text > span:first-child')].map((e) => e.textContent).filter(Boolean));
  const officeSaved = () => saved.filter(([k]) => k === 'office.rooms').at(-1)?.[1] as { type: string; variant: number | null }[] | undefined;
  const settle = async () => {
    await tick();
    await tick();
  };
  const change = (sel: HTMLSelectElement, value: string) => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const DEFAULT_LABELS = [['Stanza 1', 'Stanza 2', 'Stanza 3', 'Stanza 4', 'Stanza 5'], ['Sala 1']];

  it('sezione Ufficio: stanze di lavoro e sale hobby del default, con tipo e stile', async () => {
    state.config = {};
    state.locale = 'it';
    state.officeLocked = false;
    let root = await open();
    (root.querySelector('[data-tab="office"]') as HTMLElement).click();
    root = app();
    expect(title).toBe('Ufficio');
    expect(root.querySelector('.tab[aria-selected="true"] .tab__icon svg')).not.toBeNull();
    expect(labels(root).slice(0, 2)).toEqual(DEFAULT_LABELS);
    const type = root.querySelector<HTMLSelectElement>('select[data-office="type"][data-index="0"]')!;
    expect([...type.options].map((o) => o.textContent)).toEqual(['4 postazioni', '8 postazioni', '12 postazioni']);
    expect(type.value).toBe('work8');
    const style = root.querySelector<HTMLSelectElement>('select[data-office="variant"][data-index="0"]')!;
    expect([...style.options].map((o) => o.textContent)).toEqual(['Automatico', 'Stile 1', 'Stile 2', 'Stile 3', 'Stile 4']);
    expect(style.value).toBe('auto');
    // sala hobby: tipi hobby, una pianta sola (niente stile), l'unica non si toglie
    const hobby = root.querySelector<HTMLSelectElement>('select[data-office="type"][data-index="5"]')!;
    expect([...hobby.options].map((o) => o.value)).toEqual(['relax', 'console', 'pingpong']);
    expect(root.querySelector('select[data-office="variant"][data-index="5"]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[data-office="remove"][data-index="5"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[data-office="remove"][data-index="0"]')!.disabled).toBe(false);
    expect(root.textContent).not.toContain('Impossibile modificare');
  });

  it('cambia tipo e stile, aggiunge e toglie nei limiti, ripristina i predefiniti', async () => {
    change(app().querySelector<HTMLSelectElement>('select[data-office="variant"][data-index="1"]')!, '3');
    await settle();
    expect(officeSaved()![1]).toEqual({ type: 'work8', variant: 3 });
    change(app().querySelector<HTMLSelectElement>('select[data-office="type"][data-index="1"]')!, 'work4');
    await settle();
    // cambiando tipo lo stile torna automatico; da 4 postazioni gli stili sono 8
    expect(officeSaved()![1]).toEqual({ type: 'work4', variant: null });
    expect(app().querySelectorAll('select[data-office="variant"][data-index="1"] option')).toHaveLength(9);

    // due sale hobby in più, dei tipi che mancano: ora le stanze sono 8 e non se ne aggiungono altre
    (app().querySelector('[data-office="add-hobby"]') as HTMLElement).click();
    await settle();
    expect(officeSaved()!.slice(-2)).toEqual([{ type: 'relax', variant: null }, { type: 'console', variant: null }]);
    (app().querySelector('[data-office="add-hobby"]') as HTMLElement).click();
    await settle();
    let root = app();
    expect(officeSaved()).toHaveLength(8);
    expect(officeSaved()!.at(-1)).toEqual({ type: 'pingpong', variant: null });
    expect(root.querySelector<HTMLButtonElement>('[data-office="add-hobby"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-office="add-work"]')!.disabled).toBe(true);
    expect(labels(root)[1]).toEqual(['Sala 1', 'Sala 2', 'Sala 3']);

    // tolta una stanza di lavoro se ne può aggiungere un'altra
    (root.querySelector('[data-office="remove"][data-index="0"]') as HTMLElement).click();
    await settle();
    expect(officeSaved()).toHaveLength(7);
    root = app();
    expect(root.querySelector<HTMLButtonElement>('[data-office="add-work"]')!.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[data-office="add-hobby"]')!.disabled).toBe(true);

    (root.querySelector('[data-office="reset"]') as HTMLElement).click();
    await settle();
    expect(officeSaved()).toEqual([...Array.from({ length: 5 }, () => ({ type: 'work8', variant: null })), { type: 'relax', variant: null }]);
  });

  it('config.json non valido scritto a mano: la pagina mostra il default', async () => {
    state.config = { office: { rooms: [{ type: 'relax' }] } };
    expect(labels(await open()).slice(0, 2)).toEqual(DEFAULT_LABELS);
    state.config = { office: { rooms: [{ type: 'work12', variant: 5 }, { type: 'relax' }] } };
    expect(labels(await open()).slice(0, 2)).toEqual(DEFAULT_LABELS);
    state.config = { office: { rooms: [{ type: 'work12', variant: 4 }, { type: 'pingpong' }] } };
    expect(labels(await open()).slice(0, 2)).toEqual([['Stanza 1'], ['Sala 1']]);
  });

  it('con agenti al lavoro: controlli disabilitati e avviso; si sblocca da solo quando la pagina si aggiorna', async () => {
    state.config = {};
    state.officeLocked = true;
    let root = await open();
    expect(root.textContent).toContain("Impossibile modificare l'ufficio: gli agenti sono al lavoro");
    const controls = [...root.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('.pane [data-office]')];
    expect(controls.length).toBeGreaterThan(10);
    expect(controls.every((c) => c.disabled)).toBe(true);
    const before = saved.length;
    (root.querySelector('[data-office="reset"]') as HTMLElement).click();
    await settle();
    expect(saved).toHaveLength(before);

    // l'app chiama agentSettingsRefresh a ogni giro: finito il lavoro la sezione torna modificabile
    state.officeLocked = false;
    root = await open();
    expect(root.textContent).not.toContain('Impossibile modificare');
    expect(root.querySelector<HTMLButtonElement>('[data-office="reset"]')!.disabled).toBe(false);

    state.officeLocked = true;
    state.locale = 'en';
    root = await open();
    expect(title).toBe('Office');
    expect(root.textContent).toContain("The office can't be changed: agents are at work");
    state.locale = 'es';
    root = await open();
    expect(root.textContent).toContain('No se puede modificar la oficina: los agentes están trabajando');
    state.locale = 'it';
    state.officeLocked = false;
  });
});
