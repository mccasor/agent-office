import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { DEFAULT_DISPLAY, type DisplaySettings } from '../../shared/settings.js';
import type { AgentVerdict, HistoryReport, Snapshot } from '../../shared/types.js';

export interface OfficeServer {
  url: string;
  /** `json`: lo snapshot già serializzato da chi pubblica (altrimenti lo serializza il server) */
  publish(snapshot: Snapshot, json?: string): void;
  /** preferenze di visualizzazione nuove (config.json cambiato): ai client SSE come evento `config` */
  setSettings(settings: DisplaySettings): void;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const HEARTBEAT_MS = 15_000;
/** un client SSE che non legge (buffer oltre questa soglia) viene chiuso invece di accumulare snapshot */
const MAX_SSE_BUFFER = 4 * 1024 * 1024;
/** GET /api/agents/<id>/status: id di un subagente (solo lettere, cifre, - e _) */
const AGENT_STATUS_RE = /^\/api\/agents\/([\w-]{1,128})\/status$/;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; worker-src 'self' blob:",
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

/**
 * Ascolta solo su 127.0.0.1. GET /api/snapshot, GET /api/status, GET /api/config (preferenze di visualizzazione),
 * GET /api/events (SSE: eventi `snapshot` e `config`), GET /api/history (storico della giornata, se c'è `history`),
 * GET /api/agents/<id>/status ("Controlla stato" di un subagente, se c'è `agentStatus`), statici da webDir.
 * Nessuna scrittura: config.json lo scrive l'app della menu bar.
 */
export async function startServer(opts: {
  port: number;
  webDir: string;
  initial: Snapshot;
  settings?: DisplaySettings;
  /** riepilogo di un giorno ("YYYY-MM-DD", null = oggi); null se il giorno non è valido */
  history?: (day: string | null) => Promise<HistoryReport | null>;
  /** verdetto aggiornato su un subagente (#104), rifacendo subito i controlli; null se l'agente non c'è */
  agentStatus?: (agentId: string) => Promise<AgentVerdict | null>;
}): Promise<OfficeServer> {
  let current = opts.initial;
  // serializzato una volta per pubblicazione e condiviso da SSE e /api/snapshot; la versione fa da ETag
  let currentJson = JSON.stringify(current);
  let version = 1;
  let settingsJson = JSON.stringify(opts.settings ?? DEFAULT_DISPLAY);
  const etag = () => `"v${version}"`;
  const clients = new Set<ServerResponse>();
  // realpath: confronto coerente anche se webDir passa per symlink (es. /var → /private/var su macOS)
  const root = await realpath(resolve(opts.webDir));
  let allowedHosts: string[] = [];

  const sseWrite = (res: ServerResponse, json: string): void => {
    if (res.writableLength > MAX_SSE_BUFFER) {
      res.destroy();
      return;
    }
    res.write(`event: snapshot\ndata: ${json}\n\n`);
  };
  const sseSettings = (res: ServerResponse): void => {
    res.write(`event: config\ndata: ${settingsJson}\n\n`);
  };

  /** Risolve il path richiesto dentro root; null se non valido o fuori da root. */
  const resolveInRoot = async (pathname: string): Promise<string | null> => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;
    const target = resolve(root, `.${decoded}`);
    if (target !== root && !target.startsWith(root + sep)) return null;
    try {
      const real = await realpath(target);
      if (real !== root && !real.startsWith(root + sep)) return null;
      return real;
    } catch {
      return target; // inesistente: il chiamante gestisce 404/fallback
    }
  };

  const isFile = async (path: string): Promise<boolean> => {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  };

  const serveFile = (req: IncomingMessage, res: ServerResponse, path: string): void => {
    res.writeHead(200, { 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(path)
      .on('error', () => res.destroy())
      .pipe(res);
  };

  const serveStatic = async (req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> => {
    const target = await resolveInRoot(pathname);
    if (target === null) {
      send(res, 403, 'Forbidden');
      return;
    }
    if (await isFile(target)) {
      serveFile(req, res, target);
      return;
    }
    const index = join(root, 'index.html');
    if (extname(target) === '' && (await isFile(index))) {
      serveFile(req, res, index);
      return;
    }
    send(res, 404, 'Not Found');
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    // protezione DNS rebinding
    if (!allowedHosts.includes((req.headers.host ?? '').toLowerCase())) {
      send(res, 403, 'Forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const [pathname = '/', query = ''] = (req.url ?? '/').split('?');

    if (pathname === '/api/snapshot') {
      // l'app della menu bar lo interroga ogni 2 s: senza cambiamenti risponde 304 senza corpo
      if (req.headers['if-none-match'] === etag()) {
        res.writeHead(304, { ETag: etag(), 'Cache-Control': 'no-cache' });
        res.end();
        return;
      }
      send(res, 200, currentJson, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        ETag: etag(),
      });
      return;
    }

    if (pathname === '/api/status') {
      // piccolo e senza stream: l'app della menu bar lo usa per riconoscere il server (firma `app`) prima di usarlo
      const active = current.sessions.filter((s) => s.active).length;
      send(res, 200, JSON.stringify({ app: 'agent-office', status: current.status, activeSessions: active }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return;
    }

    if (pathname === '/api/config') {
      send(res, 200, settingsJson, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return;
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.flushHeaders();
      sseWrite(res, currentJson);
      sseSettings(res);
      clients.add(res);
      const drop = (): void => {
        clients.delete(res);
      };
      req.on('close', drop);
      res.on('close', drop);
      return;
    }

    if (pathname === '/api/history' && opts.history) {
      const report = await opts.history(new URLSearchParams(query).get('day'));
      if (!report) {
        send(res, 400, 'Bad Request');
        return;
      }
      send(res, 200, JSON.stringify(report), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return;
    }

    const agentStatus = AGENT_STATUS_RE.exec(pathname);
    if (agentStatus && opts.agentStatus) {
      const verdict = await opts.agentStatus(agentStatus[1]!);
      if (!verdict) {
        send(res, 404, 'Not Found');
        return;
      }
      send(res, 200, JSON.stringify(verdict), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      send(res, 404, 'Not Found');
      return;
    }

    await serveStatic(req, res, pathname);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Internal Server Error');
      else res.destroy();
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port, HOST, () => {
      server.off('error', fail);
      ok();
    });
  });

  const port = (server.address() as AddressInfo).port;
  allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    url: `http://${HOST}:${port}`,
    publish(snapshot, json = JSON.stringify(snapshot)) {
      current = snapshot;
      currentJson = json;
      version++;
      for (const res of clients) sseWrite(res, currentJson);
    },
    setSettings(settings) {
      settingsJson = JSON.stringify(settings);
      for (const res of clients) sseSettings(res);
    },
    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
      return new Promise<void>((ok, fail) => {
        server.close((err) => (err ? fail(err) : ok()));
        server.closeAllConnections();
      });
    },
  };
}
