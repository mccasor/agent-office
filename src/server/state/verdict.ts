import { open, stat } from 'node:fs/promises';
import type { AgentState, AgentVerdict } from '../../shared/types.js';
import type { SessionProcessInfo } from '../sessions/index.js';

/**
 * Verdetto di "Controlla stato" su un subagente (#104), dallo stato già risolto nello snapshot (in ufficio o già
 * uscito), dal processo della sua sessione e dai comandi in background. Pura; null se l'agente non c'è.
 * Chiuso se il processo è terminato; altrimenti com'è finito, oppure cosa sta facendo: un tool, un'attesa o dei
 * comandi in background (in esecuzione), niente di tutto ciò con la sessione viva (probabilmente finito senza
 * notifica), o senza un file di sessione (sconosciuto, con gli stessi dettagli).
 */
export function agentVerdict(input: {
  agent: AgentState | undefined;
  process: SessionProcessInfo | undefined;
  /** comandi in background aperti e ultima scrittura sul loro output; null se il transcript non è seguito */
  background: { count: number; lastOutputAt: number | null } | null;
  now: number;
}): AgentVerdict | null {
  const { agent, process, now: checkedAt } = input;
  if (!agent) return null;
  if (process?.process === 'gone') return { kind: 'closed', checkedAt };
  if (agent.status === 'done') return { kind: 'done', outcome: agent.outcome ?? 'ok', checkedAt };
  const details = {
    tool: agent.tool ? { name: agent.tool.name, since: agent.tool.since } : null,
    waiting: agent.waiting ? (agent.waitingKind ?? 'input') : null,
    background: input.background?.count ?? 0,
    lastOutputAt: input.background?.lastOutputAt ?? null,
    claude: process?.status ?? null,
  };
  if (!process) return { kind: 'unknown', checkedAt, ...details };
  const busy = details.tool !== null || details.waiting !== null || details.background > 0;
  return { kind: busy ? 'running' : 'silent', checkedAt, ...details };
}

/** riga con cui Claude Code chiude l'output di un comando in background: fermato o uscito con un codice */
const OUTPUT_END_RE = /\[(?:killed|exited with code -?\d+)\]\s*$/;
/** byte letti in fondo a ogni output: bastano per la riga di fine */
const TAIL_BYTES = 64;

/**
 * Quanti dei comandi in background risultano chiusi dalla riga di fine in coda al loro output (#110): un comando
 * chiuso da fuori non manda la notifica all'agente, che altrimenti sembrerebbe in esecuzione per sempre. Si leggono
 * solo gli ultimi TAIL_BYTES byte e si cerca solo quella riga: dell'output non si tiene né si espone nulla.
 */
export async function endedCount(paths: readonly string[]): Promise<number> {
  const ended = await Promise.all(
    paths.map(async (p) => {
      const file = await open(p, 'r').catch(() => null);
      if (!file) return false;
      try {
        const { size } = await file.stat();
        const length = Math.min(TAIL_BYTES, size);
        const { buffer } = await file.read(Buffer.alloc(length), 0, length, size - length);
        return OUTPUT_END_RE.test(buffer.toString('utf8'));
      } catch {
        return false;
      } finally {
        await file.close();
      }
    }),
  );
  return ended.filter(Boolean).length;
}

/** Ultima modifica tra i file di output dei comandi in background (solo stat, mai il contenuto); null se nessuno. */
export async function lastWrite(paths: readonly string[]): Promise<number | null> {
  const times = await Promise.all(paths.map((p) => stat(p).then((st) => Math.floor(st.mtimeMs), () => null)));
  const known = times.filter((t): t is number => t !== null);
  return known.length > 0 ? Math.max(...known) : null;
}
