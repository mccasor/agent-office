import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DISPLAY } from '../../shared/settings.js';
import type { Snapshot } from '../../shared/types.js';
import { startServer, type OfficeServer } from './index.js';

const snap = (generatedAt: number): Snapshot => ({ status: 'idle', sessions: [], agents: [], generatedAt });

/** Richiesta raw (path non normalizzato, Host arbitrario): fetch non permette né l'uno né l'altro. */
function raw(
  url: string,
  path: string,
  opts: { method?: string; host?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(port),
        path,
        method: opts.method ?? 'GET',
        headers: { host: opts.host ?? `127.0.0.1:${port}` },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Legge eventi SSE `snapshot` dallo stream finché non ne ha `count`. */
async function readEvents(body: ReadableStream<Uint8Array>, count: number): Promise<Snapshot[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const out: Snapshot[] = [];
  let buf = '';
  while (out.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = block.split('\n');
      if (!lines.includes('event: snapshot')) continue;
      const data = lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      out.push(JSON.parse(data) as Snapshot);
    }
  }
  reader.releaseLock();
  return out;
}

describe('startServer', () => {
  let root: string;
  let webDir: string;
  let server: OfficeServer;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-office-http-'));
    webDir = join(root, 'web');
    await mkdir(join(webDir, 'assets'), { recursive: true });
    await writeFile(join(webDir, 'index.html'), '<!doctype html><title>office</title>');
    await writeFile(join(webDir, 'assets', 'app.js'), 'console.log(1);');
    await writeFile(join(webDir, 'assets', 'style.css'), 'body{}');
    await writeFile(join(root, 'secret.txt'), 'TOP SECRET');
    server = await startServer({ port: 0, webDir, initial: snap(1) });
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it('ascolta su 127.0.0.1 con porta reale', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.url).not.toMatch(/:0$/);
  });

  it('GET /api/snapshot restituisce l\'ultimo snapshot', async () => {
    let res = await fetch(`${server.url}/api/snapshot`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual(snap(1));

    server.publish(snap(2));
    res = await fetch(`${server.url}/api/snapshot`);
    expect(await res.json()).toEqual(snap(2));
  });

  it('publish con lo snapshot già serializzato: /api/snapshot restituisce quel testo senza riserializzare', async () => {
    const json = JSON.stringify(snap(4));
    server.publish(snap(4), json);
    const res = await fetch(`${server.url}/api/snapshot`);
    expect(await res.text()).toBe(json);
  });

  it('GET /api/snapshot con If-None-Match: 304 finché non arriva uno snapshot nuovo', async () => {
    const first = await fetch(`${server.url}/api/snapshot`);
    const tag = first.headers.get('etag')!;
    expect(tag).toBeTruthy();
    const same = await fetch(`${server.url}/api/snapshot`, { headers: { 'If-None-Match': tag } });
    expect(same.status).toBe(304);
    server.publish(snap(3));
    const fresh = await fetch(`${server.url}/api/snapshot`, { headers: { 'If-None-Match': tag } });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('etag')).not.toBe(tag);
  });

  it('GET /api/status: stato per l\'icona e numero di sessioni attive', async () => {
    const res = await fetch(`${server.url}/api/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: 'agent-office', status: 'idle', activeSessions: 0 });
  });

  it('GET /api/events invia lo snapshot iniziale e poi ogni publish', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${server.url}/api/events`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    const body = res.body!;

    const [first] = await readEvents(body, 1);
    expect(first).toEqual(snap(1));

    server.publish(snap(2));
    server.publish(snap(3));
    const next = await readEvents(body, 2);
    expect(next).toEqual([snap(2), snap(3)]);
    ctrl.abort();
  });

  it('GET /api/config e evento SSE `config`: preferenze di visualizzazione, alla connessione e a ogni cambio', async () => {
    let res = await fetch(`${server.url}/api/config`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_DISPLAY);

    const ctrl = new AbortController();
    const events = await fetch(`${server.url}/api/events`, { signal: ctrl.signal });
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const configs = () => text.split('\n\n').filter((b) => b.startsWith('event: config\n')).map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6)));
    while (configs().length < 1) text += decoder.decode((await reader.read()).value, { stream: true });
    expect(configs()[0]).toEqual(DEFAULT_DISPLAY);

    const hidden = { ...DEFAULT_DISPLAY, show: { ...DEFAULT_DISPLAY.show, 'session.diff': false } };
    server.setSettings(hidden);
    while (configs().length < 2) text += decoder.decode((await reader.read()).value, { stream: true });
    expect(configs()[1]).toEqual(hidden);
    res = await fetch(`${server.url}/api/config`);
    expect(await res.json()).toEqual(hidden);
    ctrl.abort();
  });

  it('close() termina i client SSE aperti', async () => {
    const res = await fetch(`${server.url}/api/events`);
    const reader = res.body!.getReader();
    await reader.read();
    await server.close();
    // lo stream deve chiudersi (done o errore), non restare appeso
    const ended = await reader.read().then(
      async function drain(r): Promise<boolean> {
        return r.done ? true : reader.read().then(drain);
      },
      () => true,
    );
    expect(ended).toBe(true);
    // re-instanzia per afterEach
    server = await startServer({ port: 0, webDir, initial: snap(1) });
  });

  it('serve statici con MIME corretto e header di sicurezza, senza CORS', async () => {
    const js = await fetch(`${server.url}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await js.text()).toBe('console.log(1);');

    const css = await fetch(`${server.url}/assets/style.css`);
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);

    const html = await fetch(`${server.url}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await html.text()).toContain('office');
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('referrer-policy')).toBe('no-referrer');
    const csp = html.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(html.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('fallback a index.html per path senza estensione, 404 per file mancanti con estensione', async () => {
    const res = await fetch(`${server.url}/qualche/rotta`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('office');

    const missing = await fetch(`${server.url}/assets/nope.js`);
    expect(missing.status).toBe(404);
  });

  it.each([
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
    '/%00index.html',
  ])('blocca path traversal: %s', async (path) => {
    const res = await raw(server.url, path);
    expect([400, 403, 404]).toContain(res.status);
    expect(res.body).not.toContain('TOP SECRET');
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s → 405', async (method) => {
    const res = await raw(server.url, '/api/snapshot', { method });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  it('HEAD funziona senza body', async () => {
    const res = await raw(server.url, '/index.html', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });

  it('accetta Host 127.0.0.1:<port> e localhost:<port>, rifiuta gli altri', async () => {
    const { port } = new URL(server.url);
    expect((await raw(server.url, '/api/snapshot', { host: `localhost:${port}` })).status).toBe(200);
    expect((await raw(server.url, '/api/snapshot', { host: `127.0.0.1:${port}` })).status).toBe(200);
    for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1:1', `localhost.evil:${port}`]) {
      const res = await raw(server.url, '/api/snapshot', { host });
      expect(res.status).toBe(403);
      expect(res.body).not.toContain('generatedAt');
    }
  });
});

describe('GET /api/history', () => {
  let webDir: string;
  afterEach(async () => {
    await rm(webDir, { recursive: true, force: true });
  });

  it('passa il giorno richiesto (null = oggi) e risponde 400 se non è valido; 404 senza storico', async () => {
    webDir = await mkdtemp(join(tmpdir(), 'agent-office-http-history-'));
    const asked: (string | null)[] = [];
    const server = await startServer({
      port: 0,
      webDir,
      initial: snap(1),
      history: async (day) => {
        asked.push(day);
        if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
        return { day: day ?? '2026-10-23', days: ['2026-10-23'], events: [], waits: { count: 0, totalMs: 0, sessions: [] }, byType: [], files: [] };
      },
    });
    const without = await startServer({ port: 0, webDir, initial: snap(1) });
    try {
      let res = await fetch(`${server.url}/api/history`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).day).toBe('2026-10-23');
      res = await fetch(`${server.url}/api/history?day=2026-10-20`);
      expect((await res.json()).day).toBe('2026-10-20');
      expect((await fetch(`${server.url}/api/history?day=../x`)).status).toBe(400);
      expect(asked).toEqual([null, '2026-10-20', '../x']);
      expect((await fetch(`${without.url}/api/history`)).status).toBe(404);
    } finally {
      await Promise.all([server.close(), without.close()]);
    }
  });
});
