import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { GitFileChange } from '../../shared/types.js';
import { GIT_TIMEOUT_MS } from './index.js';

/*
 * Commit di un giorno (#109): `git log --numstat --no-merges` sui branch locali, con i limiti del giorno in ora locale
 * (come dayOf dello storico). Calcolati solo a richiesta (scheda Git aperta), mai nel poller, con una cache per
 * repository, giorno e posizione dei branch: un commit nuovo sposta un branch e invalida la voce.
 */

/** commit al più per giorno */
export const MAX_DAY_COMMITS = 500;
/** file al più per commit (gli altri contano solo in `filesCount`) */
export const MAX_COMMIT_FILES = 100;
/** giorni indietro nel selettore */
export const GIT_DAYS = 30;
/** voci al più nella cache */
const MAX_CACHE = 64;
/** output al più di un comando git (un giorno con centinaia di commit e file) */
const MAX_BUFFER = 32 * 1024 * 1024;

/** Commit letto da git log, prima dell'attribuzione. */
export interface LogCommit {
  /** hash completo */
  hash: string;
  short: string;
  /** committer date (epoch ms): il giorno e l'ora */
  at: number;
  /** author date (epoch ms): si conserva con cherry-pick, rebase e amend, serve al ripiego dell'attribuzione */
  authoredAt: number;
  branch: string | null;
  message: string;
  added: number;
  removed: number;
  files: GitFileChange[];
  filesCount: number;
}

export type GitResult = { ok: true; stdout: string } | { ok: false; missing: boolean };
/** esegue git nella cartella; `missing`: git non è installato */
export type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>;

export const runGit: GitRunner = (cwd, args) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C', GIT_OPTIONAL_LOCKS: '0' },
      },
      (err, stdout) => {
        if (!err) resolve({ ok: true, stdout });
        // ENOENT anche con un cwd inesistente: si distingue controllando che git risponda altrove
        else resolve({ ok: false, missing: (err as NodeJS.ErrnoException).code === 'ENOENT' });
      },
    );
  });

const pad = (n: number) => String(n).padStart(2, '0');

/** Giorno in ora locale: "2026-10-23" (come dayOf dello storico). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mezzanotte locale di inizio e fine del giorno (epoch ms): con l'ora legale un giorno può durare 23 o 25 ore. Pura. */
export function dayBounds(day: string): { start: number; end: number } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
}

/**
 * Percorso di una riga di --numstat dopo una rinomina: `a => b` → b, `src/{a => b}/x.ts` → src/b/x.ts,
 * `src/{ => sub}/x.ts` → src/sub/x.ts. Pura.
 */
export function renamedPath(raw: string): string {
  const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braces) {
    const [, pre = '', , to = '', post = ''] = braces;
    return `${pre}${to}${post}`.replace(/\/{2,}/g, '/').replace(/^\//, '');
  }
  const i = raw.indexOf(' => ');
  return i >= 0 ? raw.slice(i + 4) : raw;
}

/** Riga di --numstat: "3\t1\tpath"; i binari hanno "-\t-". null se non è una riga di numstat. Pura. */
export function parseNumstatLine(line: string): GitFileChange | null {
  const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
  if (!m) return null;
  const path = renamedPath(m[3]!);
  if (m[1] === '-' || m[2] === '-') return { path, added: 0, removed: 0, binary: true };
  return { path, added: Number(m[1]), removed: Number(m[2]) };
}

const RS = '\x1e';
const US = '\x1f';
/** formato di ogni commit: separatore di record, poi i campi separati da US */
export const LOG_FORMAT = `--format=${RS}%H${US}%h${US}%ct${US}%at${US}%S${US}%s`;

/** ref di --source → nome del branch; null se non è un branch (HEAD staccato) */
function branchOf(source: string): string | null {
  const ref = source.replace(/^refs\/heads\//, '');
  return !ref || ref === 'HEAD' || ref.startsWith('refs/') ? null : ref;
}

/** Output di `git log --numstat` con LOG_FORMAT → commit. Righe e campi illeggibili scartati. Pura. */
export function parseLog(out: string): LogCommit[] {
  const commits: LogCommit[] = [];
  for (const record of out.split(RS)) {
    const nl = record.indexOf('\n');
    const head = nl < 0 ? record : record.slice(0, nl);
    const fields = head.split(US);
    if (fields.length < 6) continue;
    const [hash = '', short = '', ct, at, source = '', ...subject] = fields;
    if (!/^[0-9a-f]{7,64}$/.test(hash)) continue;
    const files: GitFileChange[] = [];
    let added = 0;
    let removed = 0;
    let filesCount = 0;
    for (const line of nl < 0 ? [] : record.slice(nl + 1).split('\n')) {
      const f = parseNumstatLine(line.replace(/\r$/, ''));
      if (!f) continue;
      filesCount++;
      added += f.added;
      removed += f.removed;
      if (files.length < MAX_COMMIT_FILES) files.push(f);
    }
    commits.push({
      hash,
      short,
      at: Number(ct) * 1000,
      authoredAt: Number(at) * 1000,
      branch: branchOf(source),
      // %s è già una riga sola; il resto del messaggio non si legge
      message: subject.join(US).split('\n')[0]!.trim(),
      added,
      removed,
      files,
      filesCount,
    });
  }
  return commits;
}

/** Commit di un giorno di un repository, prima dell'attribuzione. */
export interface RepoDay {
  status: 'ok' | 'not-repo' | 'no-git' | 'empty';
  project: string | null;
  branch: string | null;
  commits: LogCommit[];
  truncated: boolean;
  /** giorni degli ultimi GIT_DAYS con commit (non comprende per forza oggi) */
  days: string[];
}

export interface GitDayReaderOptions {
  run?: GitRunner;
  now?: () => number;
}

export interface GitDayReader {
  /** commit del giorno nel repository di `cwd` (null = nessuna cartella) */
  read(cwd: string | null, day: string): Promise<RepoDay>;
  /** voci in cache (per i test) */
  readonly cacheSize: number;
}

const empty = (status: RepoDay['status'], project: string | null = null, branch: string | null = null): RepoDay => ({
  status, project, branch, commits: [], truncated: false, days: [],
});

/** Lettore dei commit di un giorno con cache per (repository, giorno, branch e HEAD). */
export function createGitDayReader(opts: GitDayReaderOptions = {}): GitDayReader {
  const run = opts.run ?? runGit;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, RepoDay>();

  const remember = (key: string, value: RepoDay) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  };

  return {
    async read(cwd, day) {
      if (!cwd) return empty('not-repo');
      const top = await run(cwd, ['rev-parse', '--show-toplevel']);
      if (!top.ok) {
        if (top.missing) {
          // ENOENT anche con un cwd sparito: git è assente solo se non risponde nemmeno nella cartella corrente
          const probe = await run(process.cwd(), ['--version']);
          return empty(!probe.ok && probe.missing ? 'no-git' : 'not-repo');
        }
        return empty('not-repo');
      }
      const toplevel = top.stdout.trim();
      const project = basename(toplevel) || null;
      // posizione di HEAD e di tutti i branch (la chiave della cache), poi il branch corrente ("HEAD" se staccato)
      const refs = await run(cwd, ['rev-parse', 'HEAD', '--branches', '--abbrev-ref', 'HEAD']);
      if (!refs.ok) {
        // repository senza commit: HEAD non si risolve, il ref simbolico esiste già
        const branch = await run(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
        return empty('empty', project, branch.ok ? branch.stdout.trim() || null : null);
      }
      const branch = branchOf(refs.stdout.trim().split('\n').at(-1) ?? '');
      const today = localDay(now());
      const key = `${toplevel}\0${day}\0${today}\0${createHash('sha1').update(refs.stdout).digest('hex')}`;
      const hit = cache.get(key);
      if (hit) {
        remember(key, hit);
        return hit;
      }

      const { start, end } = dayBounds(day);
      const base = ['-c', 'core.quotepath=off', 'log', '--branches', 'HEAD', '--no-merges', '--source'];
      const range = [`--since=@${Math.floor(start / 1000)}`, `--until=@${Math.floor(end / 1000) - 1}`];
      const [log, recent, onHead] = await Promise.all([
        run(cwd, [...base, '--numstat', `--max-count=${MAX_DAY_COMMITS + 1}`, ...range, LOG_FORMAT]),
        run(cwd, ['log', '--branches', 'HEAD', '--no-merges', '--format=%ct', `--since=@${Math.floor(dayBounds(today).start / 1000) - GIT_DAYS * 86_400}`]),
        // --source dà il primo branch che raggiunge il commit (spesso il worktree di un agente con la punta più
        // recente): quelli raggiungibili da HEAD valgono il branch corrente
        branch ? run(cwd, ['rev-list', 'HEAD', '--no-merges', `--max-count=${MAX_DAY_COMMITS + 1}`, ...range]) : Promise.resolve(null),
      ]);
      const head = new Set(onHead?.ok ? onHead.stdout.split('\n').filter(Boolean) : []);
      // --since/--until di git sono euristiche sulla data del commit: il giorno si ricontrolla qui
      const all = log.ok
        ? parseLog(log.stdout)
          .filter((c) => c.at >= start && c.at < end)
          .map((c) => (head.has(c.hash) ? { ...c, branch } : c))
        : [];
      const days = recent.ok
        ? [...new Set(recent.stdout.split('\n').filter(Boolean).map((s) => localDay(Number(s) * 1000)))].sort().reverse()
        : [];
      const value: RepoDay = {
        status: 'ok',
        project,
        branch,
        commits: all.slice(0, MAX_DAY_COMMITS),
        truncated: all.length > MAX_DAY_COMMITS,
        days,
      };
      // un timeout non va in cache: al prossimo tentativo si riprova
      if (log.ok && recent.ok) remember(key, value);
      return value;
    },
    get cacheSize() {
      return cache.size;
    },
  };
}
