import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import type { Snapshot } from '../../shared/types.js';

export interface OfficeServer {
  url: string;
  publish(snapshot: Snapshot): void;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const HEARTBEAT_MS = 15_000;

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

/** Ascolta solo su 127.0.0.1. GET /api/snapshot, GET /api/events (SSE), statici da webDir. */
export async function startServer(opts: { port: number; webDir: string; initial: Snapshot }): Promise<OfficeServer> {
  let current = opts.initial;
  const clients = new Set<ServerResponse>();
  // realpath: confronto coerente anche se webDir passa per symlink (es. /var → /private/var su macOS)
  const root = await realpath(resolve(opts.webDir));
  let allowedHosts: string[] = [];

  const sseWrite = (res: ServerResponse, snapshot: Snapshot): void => {
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
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

    const pathname = (req.url ?? '/').split('?')[0] ?? '/';

    if (pathname === '/api/snapshot') {
      send(res, 200, JSON.stringify(current), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
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
      sseWrite(res, current);
      clients.add(res);
      const drop = (): void => {
        clients.delete(res);
      };
      req.on('close', drop);
      res.on('close', drop);
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
    publish(snapshot) {
      current = snapshot;
      for (const res of clients) sseWrite(res, snapshot);
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
