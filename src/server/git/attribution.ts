import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nicknameOf } from '../../shared/nickname.js';
import type { GitCommit, GitCommitAuthor } from '../../shared/types.js';
import { createLineReader, type LineReader } from '../transcript/reader.js';
import type { LogCommit } from './log.js';

/*
 * Attribuzione dei commit (#109). L'autore git è sempre l'utente, e il trailer Co-Authored-By non distingue Claude
 * dai subagenti: chi ha fatto il commit si ricava dai transcript della sessione. Un tool_use Bash con `git commit`
 * nel transcript principale vale Claude stesso, in `subagents/agent-<id>.jsonl` quell'agente; il suo tool_result
 * contiene `[branch abc1234] messaggio`, da cui si prendono hash e messaggio per legarlo al commit di git log. Con
 * `git commit -q` l'output è vuoto: resta l'intervallo tra il tool_use e il suo risultato (vedi `attribute`).
 *
 * Privacy: dei transcript si guardano solo i tool_use Bash (il comando, per riconoscere `git commit`, non si
 * conserva) e i tool_result di quei tool_use, da cui si tengono solo hash, branch e messaggio del commit. Il testo
 * dei prompt e gli altri risultati non si leggono né si conservano.
 */

/**
 * Commit visto nel transcript: l'output di `git commit` di Claude o di un subagente. Senza hash (`git commit -q`,
 * output tagliato) resta solo l'intervallo in cui il comando è girato.
 */
export interface TranscriptCommit {
  /** hash corto come stampato da git (7+ caratteri); null se l'output non lo riporta */
  hash: string | null;
  branch: string | null;
  message: string | null;
  /** orario del tool_use (epoch ms): da quando il comando può aver fatto il commit */
  startedAt: number;
  /** orario del tool_result (epoch ms) */
  at: number;
  author: Exclude<GitCommitAuthor, { kind: 'outside' }>;
}

/** transcript da leggere: della sessione (Claude stesso) o di un subagente */
export interface TranscriptSource {
  path: string;
  /** null = sessione principale */
  agentId: string | null;
}

/** tool_use di commit in attesa del risultato, al più per file */
const MAX_PENDING = 64;
/** commit ricordati al più per file */
const MAX_FILE_COMMITS = 2000;
/** file seguiti al più (gli altri si rileggono da capo se servono di nuovo) */
const MAX_FILES = 300;
/** ripiego per cherry-pick, rebase e amend: stesso messaggio e author date entro questi ms dal tool_result */
export const FALLBACK_WINDOW_MS = 2 * 60_000;
/** margine sull'intervallo di un `git commit` senza hash nell'output (le date di git sono al secondo) */
const TIME_SLACK_MS = 1_500;

/** `git commit` in un comando Bash (anche `git -C dir commit`, dopo `&&`, con heredoc) */
const COMMIT_CMD_RE = /\bgit\b(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+commit\b/;
/** riga di output di git commit: "[main abc1234] messaggio", "[main (root-commit) abc1234] …", "[detached HEAD abc1234] …" */
const COMMIT_OUT_RE = /^\[(.+?) ([0-9a-f]{7,40})\] (.+)$/gm;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Testo di un tool_result (stringa o blocchi text): solo per cercarvi la riga del commit. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (isObj(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n');
}

/** Righe "[branch hash] messaggio" di un output di git commit. Pura. */
export function parseCommitOutput(text: string): { branch: string | null; hash: string; message: string }[] {
  const out: { branch: string | null; hash: string; message: string }[] = [];
  for (const m of text.matchAll(COMMIT_OUT_RE)) {
    const ref = m[1]!.replace(/\s*\(root-commit\)$/, '').trim();
    out.push({ branch: ref === 'detached HEAD' || ref === '' ? null : ref, hash: m[2]!, message: m[3]!.trim() });
  }
  return out;
}

interface FileScan {
  reader: LineReader;
  /** tool_use Bash con `git commit` ancora senza risultato: id → orario */
  pending: Map<string, number>;
  commits: Omit<TranscriptCommit, 'author'>[];
}

const timeOf = (row: Json): number => {
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
  return Number.isFinite(at) ? at : 0;
};

/** Una riga del transcript: registra i tool_use di commit e raccoglie i loro risultati. */
function ingest(scan: FileScan, line: string): void {
  // filtro veloce sul testo grezzo: si analizzano solo le righe che possono interessare
  const maybeUse = line.includes('"tool_use"') && line.includes('commit');
  const maybeResult = scan.pending.size > 0 && line.includes('"tool_result"');
  if (!maybeUse && !maybeResult) return;
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return;
  }
  if (!isObj(row) || !isObj(row.message) || !Array.isArray(row.message.content)) return;
  if (row.type === 'assistant') {
    for (const b of row.message.content) {
      if (!isObj(b) || b.type !== 'tool_use' || b.name !== 'Bash' || typeof b.id !== 'string') continue;
      const command = isObj(b.input) ? b.input.command : null;
      if (typeof command === 'string' && COMMIT_CMD_RE.test(command) && scan.pending.size < MAX_PENDING) scan.pending.set(b.id, timeOf(row));
    }
  } else if (row.type === 'user') {
    const at = timeOf(row);
    for (const b of row.message.content) {
      // solo i risultati dei tool_use di commit: mai i prompt né gli altri risultati
      if (!isObj(b) || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
      const startedAt = scan.pending.get(b.tool_use_id);
      if (startedAt === undefined) continue;
      scan.pending.delete(b.tool_use_id);
      const printed = parseCommitOutput(resultText(b.content));
      // senza la riga "[branch hash]" (git commit -q) resta l'intervallo del comando
      for (const c of printed.length > 0 ? printed : [{ hash: null, branch: null, message: null }]) {
        if (scan.commits.length >= MAX_FILE_COMMITS) scan.commits.shift();
        scan.commits.push({ ...c, startedAt: startedAt || at, at });
      }
    }
  }
}

/** transcript dei subagenti di una sessione: <cartella del transcript>/<sessione>/subagents/[workflows/<x>/]agent-<id>.jsonl */
export async function sessionSources(sessionPath: string, sessionId: string): Promise<TranscriptSource[]> {
  const sources: TranscriptSource[] = [{ path: sessionPath, agentId: null }];
  const dir = join(dirname(sessionPath), sessionId, 'subagents');
  const names = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  for (const name of names) {
    const m = /^(?:workflows[\\/][^\\/]+[\\/])?agent-([^\\/]+)\.jsonl$/.exec(name);
    if (m?.[1]) sources.push({ path: join(dir, name), agentId: m[1] });
  }
  return sources;
}

export interface CommitScanner {
  /** commit nei transcript, letti in modo incrementale (solo i byte nuovi dall'ultima volta) */
  scan(sources: TranscriptSource[]): Promise<TranscriptCommit[]>;
}

/** Lettore incrementale dei commit nei transcript, con il tipo di agente dal meta.json accanto. */
export function createCommitScanner(): CommitScanner {
  const files = new Map<string, FileScan>();
  const types = new Map<string, string>();

  const agentType = async (path: string): Promise<string> => {
    const known = types.get(path);
    if (known) return known;
    try {
      const meta: unknown = JSON.parse(await readFile(path.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      const type = isObj(meta) && typeof meta.agentType === 'string' && meta.agentType ? meta.agentType : 'unknown';
      types.set(path, type);
      return type;
    } catch {
      return 'unknown';
    }
  };

  const read = async (path: string): Promise<FileScan> => {
    let scan = files.get(path);
    if (scan) files.delete(path);
    else scan = { reader: createLineReader(path), pending: new Map(), commits: [] };
    files.set(path, scan);
    while (files.size > MAX_FILES) files.delete(files.keys().next().value!);
    for (;;) {
      const { lines, reset, more } = await scan.reader.read();
      if (reset) {
        scan.pending.clear();
        scan.commits = [];
      }
      for (const line of lines) ingest(scan, line);
      if (!more) break;
    }
    return scan;
  };

  return {
    async scan(sources) {
      const out: TranscriptCommit[] = [];
      for (const s of sources) {
        const scan = await read(s.path);
        if (scan.commits.length === 0) continue;
        const author: TranscriptCommit['author'] = s.agentId === null
          ? { kind: 'claude' }
          : { kind: 'agent', agentId: s.agentId, nickname: nicknameOf(s.agentId), agentType: await agentType(s.path) };
        for (const c of scan.commits) out.push({ ...c, author });
      }
      return out;
    },
  };
}

/**
 * Attribuisce i commit di git log, in quest'ordine:
 * 1. per hash: l'hash stampato da `git commit` è un prefisso di quello completo (anche dopo un `--amend`, che stampa
 *    l'hash nuovo);
 * 2. per messaggio e minuto: cherry-pick, rebase e amend conservano messaggio e author date, quindi una copia del
 *    commit (es. dal worktree di un agente) vale chi ha fatto l'originale;
 * 3. per orario: un `git commit` senza hash nell'output (`-q`) vale i commit con data (o author date) nell'intervallo
 *    tra il tool_use e il suo risultato; con più intervalli, il più stretto.
 * Senza corrispondenza "fuori da Claude". Pura.
 */
export function attribute(commits: LogCommit[], seen: TranscriptCommit[]): GitCommit[] {
  const printed = seen.filter((s) => s.hash !== null);
  const quiet = seen.filter((s) => s.hash === null);
  return commits.map((c): GitCommit => {
    const base = {
      hash: c.short, at: c.at, branch: c.branch, message: c.message, added: c.added, removed: c.removed, files: c.files, filesCount: c.filesCount,
    };
    // a parità di hash vale il primo nel tempo
    const byHash = printed.filter((s) => c.hash.startsWith(s.hash!)).sort((a, b) => a.at - b.at)[0];
    if (byHash) return { ...base, branch: base.branch ?? byHash.branch, author: byHash.author, matchedBy: 'hash' };
    const byMessage = printed
      .filter((s) => s.message === c.message && Math.abs(s.at - c.authoredAt) <= FALLBACK_WINDOW_MS)
      .sort((a, b) => Math.abs(a.at - c.authoredAt) - Math.abs(b.at - c.authoredAt))[0];
    if (byMessage) return { ...base, author: byMessage.author, matchedBy: 'message' };
    // le date di git sono al secondo: margine di un secondo per parte
    const within = (s: TranscriptCommit, t: number) => t >= s.startedAt - TIME_SLACK_MS && t <= s.at + TIME_SLACK_MS;
    const byTime = quiet
      .filter((s) => within(s, c.at) || within(s, c.authoredAt))
      .sort((a, b) => a.at - a.startedAt - (b.at - b.startedAt))[0];
    if (byTime) return { ...base, author: byTime.author, matchedBy: 'time' };
    return { ...base, author: { kind: 'outside' } };
  });
}
