import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** variabile d'ambiente con cui l'app passa il token al server */
export const TOKEN_ENV = 'AGENT_OFFICE_TOKEN';
/** header con cui le rotte di scrittura ricevono il token */
export const TOKEN_HEADER = 'x-agent-office-token';
const MIN_TOKEN_LENGTH = 32;
/** tipi che un browser invia senza preflight (richieste "semplici"): mai accettati in scrittura */
const SIMPLE_TYPES = new Set(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']);

/**
 * Token di questo avvio (#116): quello passato dall'app in AGENT_OFFICE_TOKEN, altrimenti (o se troppo corto) uno casuale.
 * Lo toglie dall'ambiente perché i processi figli (git, ps…) non lo ereditino. Mai da scrivere nei log.
 */
export function launchToken(env: NodeJS.ProcessEnv = process.env): string {
  const given = env[TOKEN_ENV];
  delete env[TOKEN_ENV];
  return given && given.length >= MIN_TOKEN_LENGTH ? given : randomBytes(32).toString('hex');
}

/** confronto a tempo costante (anche sulla lunghezza: si confrontano gli hash) */
function sameToken(given: string, token: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(token));
}

/**
 * Guardia di ogni metodo diverso da GET/HEAD (#116), da applicare prima di qualunque rotta di scrittura.
 * Origin dello stesso server (127.0.0.1 o localhost sulla porta) → altrimenti 403; niente richieste "semplici"
 * (text/plain, form) → 415; header X-Agent-Office-Token uguale al token di avvio → altrimenti 401.
 * Nessun header CORS: le pagine di altre origini non ottengono mai il permesso del preflight.
 * Restituisce lo status d'errore, o null se la richiesta può proseguire.
 */
export function checkWrite(req: IncomingMessage, port: number, token: string): 401 | 403 | 415 | null {
  const origin = req.headers.origin;
  if (origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return 403;
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (SIMPLE_TYPES.has(type)) return 415;
  const given = req.headers[TOKEN_HEADER];
  if (typeof given !== 'string' || !sameToken(given, token)) return 401;
  return null;
}
