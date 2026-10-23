// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Pannello della menu bar (src-tauri/splash/panel.html) con le voci delle impostazioni (#94) e la lingua (#93): la
 * pagina gira qui con il catalogo e i testi generati e un `invoke` finto che le passa lo stato come farebbe l'app
 * (panel_state in main.rs).
 */

const splash = (name: string) => readFileSync(join(import.meta.dirname, '../src-tauri/splash', name), 'utf8');
const html = splash('panel.html');
const body = /<body>([\s\S]*?)<script/.exec(html)![1]!;
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)![1]!;

const snapshot = {
  status: 'working',
  sessions: [{
    id: 's1', project: 'agent-office', branch: 'feat/board', active: true, status: 'working', dot: 'working', waiting: false,
    context: { used: 150_000, window: 200_000 }, tool: { name: 'Edit', target: 'parser.ts', since: 0 },
  }],
  agents: [{ id: 'a1', sessionId: 's1', name: 'Build HUD panel', nickname: 'Marta Commit', status: 'working', updatedAt: 0 }],
};


let state: Record<string, unknown> = {};

/** stato passato dall'app; la pagina si carica una volta, poi rilegge lo stato con agentPanelRefresh come nell'app */
async function show(over: Record<string, boolean> = {}, snap: unknown = snapshot, locale = 'it'): Promise<HTMLElement> {
  state = { version: '0.6.3', snapshot: snap, serverError: null, update: { kind: 'unknown' }, notice: null, show: over, locale };
  const w = window as unknown as Record<string, unknown> & { agentPanelRefresh?: () => Promise<void> };
  if (!w.agentPanelRefresh) {
    w.__TAURI__ = { core: { invoke: async (cmd: string) => (cmd === 'panel_state' ? state : undefined) } };
    document.body.innerHTML = body;
    new Function(splash('settings-catalog.js'))();
    new Function(splash('i18n.js'))();
    new Function(script)();
  }
  await w.agentPanelRefresh!();
  return document.getElementById('root')!;
}

describe('pannello della menu bar: voci da mostrare (#94)', () => {
  it('di default: branch, contesto, attività, agenti col compito', async () => {
    const root = await show();
    const session = root.querySelector('.session')!;
    expect(session.querySelector('.session__name')!.textContent).toBe('agent-office feat/board');
    expect(session.querySelector('.pill')!.textContent).toBe('75%');
    expect(session.querySelector('.session__sub')!.textContent).toBe('Edit parser.ts');
    expect(root.querySelector('.agent__name')!.textContent).toBe('Marta Commit Build HUD panel');
  });

  it('voci spente: spariscono senza lasciare righe vuote', async () => {
    const root = await show({ 'session.branch': false, 'session.context': false, 'session.activity': false, 'agent.task': false });
    const session = root.querySelector('.session')!;
    expect(session.querySelector('.session__name')!.textContent).toBe('agent-office');
    expect(session.querySelector('.pill')).toBeNull();
    expect(session.querySelector('.session__sub')).toBeNull();
    expect(root.querySelector('.agent__name')!.textContent).toBe('Marta Commit');
    // il compito resta nel tooltip
    expect(root.querySelector('.agent__name')!.getAttribute('title')).toBe('Build HUD panel');
    expect((await show({ 'panel.agents': false })).querySelector('.agent')).toBeNull();
  });

  it('l\'attesa si vede anche con l\'attività spenta', async () => {
    const waiting = { ...snapshot, sessions: [{ ...snapshot.sessions[0], waiting: true, waitingKind: 'permission', dot: 'waiting' }] };
    const root = await show({ 'session.activity': false }, waiting);
    expect(root.querySelector('.session__sub--waiting')!.textContent).toBe('aspetta un tuo permesso');
  });
});

describe('pannello della menu bar: lingua (#93)', () => {
  const labels = (root: HTMLElement) => [...root.querySelectorAll('.row__label')].map((e) => e.textContent);
  const waiting = { ...snapshot, sessions: [{ ...snapshot.sessions[0], waiting: true, waitingKind: 'permission', dot: 'waiting' }] };

  it('cambia al volo con la lingua dell\'app, senza ricaricare la pagina', async () => {
    expect(labels(await show())).toEqual(['Apri ufficio', 'Impostazioni…', 'Esci da Agent Office']);
    let root = await show({}, snapshot, 'en');
    expect(labels(root)).toEqual(['Open Office', 'Settings…', 'Quit Agent Office']);
    expect(document.documentElement.lang).toBe('en');
    expect(root.querySelector('.status__title')!.textContent).toBe('Claude is working');
    expect(root.querySelector('.status__sub')!.textContent).toBe('1 agent working');
    expect(root.querySelector('.section')!.textContent).toBe('Open Instances');
    root = await show({}, snapshot, 'es');
    expect(labels(root)).toEqual(['Abrir oficina', 'Ajustes…', 'Salir de Agent Office']);
    expect(root.querySelector('.status__title')!.textContent).toBe('Claude está trabajando');
    expect(root.querySelector('.pill')!.getAttribute('title')).toBe('Contexto usado');
    expect(labels(await show())).toEqual(['Apri ufficio', 'Impostazioni…', 'Esci da Agent Office']);
  });

  it('attese, plurali e server fermo in inglese e spagnolo', async () => {
    let root = await show({}, waiting, 'en');
    expect(root.querySelector('.status__title')!.textContent).toBe('Claude is waiting for your input');
    expect(root.querySelector('.session__sub--waiting')!.textContent).toBe('waiting for your permission');
    root = await show({}, waiting, 'es');
    expect(root.querySelector('.session__sub--waiting')!.textContent).toBe('esperando tu permiso');
    root = await show({}, { ...snapshot, status: 'idle', sessions: [snapshot.sessions[0], { ...snapshot.sessions[0], id: 's2' }] }, 'es');
    expect(root.querySelector('.status__sub')!.textContent).toBe('2 instancias abiertas');
    root = await show({}, null, 'en');
    expect(root.querySelector('.status__title')!.textContent).toBe('Server unreachable');
    expect(root.querySelector('.status__sub')!.textContent).toBe('Starting…');
    // lingua sconosciuta (app più nuova): italiano
    root = await show({}, null, 'fr');
    expect(root.querySelector('.status__title')!.textContent).toBe('Server non raggiungibile');
  });
});
