import { isAbsolute, relative, sep } from 'node:path';

/** file di projects pertinenti: transcript della sessione, transcript e meta.json dei subagenti */
export type Parsed =
  | { kind: 'session'; sessionId: string }
  | { kind: 'agent'; sessionId: string; agentId: string }
  | { kind: 'meta'; sessionId: string; agentId: string };

export const SESSION_RE = /^([^/]+)\.jsonl$/;
const AGENT_RE = /^([^/]+)\/subagents\/(?:workflows\/[^/]+\/)?agent-([^/]+)\.(jsonl|meta\.json)$/;

/** path relativo alla cartella di un progetto (separatori `/`) */
export function parsePath(rel: string): Parsed | null {
  const session = SESSION_RE.exec(rel);
  if (session?.[1]) return { kind: 'session', sessionId: session[1] };
  const agent = AGENT_RE.exec(rel);
  if (agent?.[1] && agent[2]) return { kind: agent[3] === 'jsonl' ? 'agent' : 'meta', sessionId: agent[1], agentId: agent[2] };
  return null;
}

export const posixRel = (from: string, to: string) => relative(from, to).split(sep).join('/');
export const outside = (rel: string) => rel === '..' || rel.startsWith('../') || isAbsolute(rel);
export const agentKey = (sessionId: string, agentId: string) => `${sessionId}/${agentId}`;
