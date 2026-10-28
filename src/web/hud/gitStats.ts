import type { GitCommit, GitCommitAuthor } from '../../shared/types';
import { t } from '../../shared/i18n';

/*
 * Conti della scheda Git (#109), dai commit del giorno restituiti da /api/git: riepilogo per autore, file più
 * toccati, righe per ora e tipi di file. Tutte pure.
 */

/** colori degli agenti nella barra per autore: quelli delle aree dell'HUD, in tema chiaro e scuro */
const AGENT_COLORS = [
  'var(--area-frontend)', 'var(--area-architecture)', 'var(--area-test)', 'var(--area-docs)',
  'var(--area-devops)', 'var(--area-research)', 'var(--area-design)',
];

export interface AuthorStats {
  key: string;
  label: string;
  /** tooltip: tipo dell'agente, o la spiegazione di "fuori da Claude" */
  title: string;
  color: string;
  count: number;
  added: number;
  removed: number;
}

export interface DaySummary {
  commits: number;
  added: number;
  removed: number;
  /** file diversi toccati nel giorno */
  files: number;
  /** autori dal più attivo; Claude prima degli agenti a parità, "fuori da Claude" per ultimo */
  authors: AuthorStats[];
}

export const authorKey = (a: GitCommitAuthor): string => (a.kind === 'agent' ? `agent:${a.agentId}` : a.kind);

/** Nome dell'autore: "Claude", il nickname dell'agente o "Fuori da Claude". */
export const authorLabel = (a: GitCommitAuthor): string =>
  a.kind === 'claude' ? t('gitTab.claude') : a.kind === 'agent' ? a.nickname : t('gitTab.outside');

const authorTitle = (a: GitCommitAuthor): string =>
  a.kind === 'agent' ? `${a.nickname} (${a.agentType})` : a.kind === 'outside' ? t('gitTab.outsideHint') : t('gitTab.claude');

const ORDER = { claude: 0, agent: 1, outside: 2 } as const;

/** Colore di ogni autore: Claude nell'accento, gli agenti nei colori delle aree (nell'ordine in cui compaiono), il resto grigio. */
export function authorColors(commits: readonly GitCommit[]): Map<string, string> {
  const colors = new Map<string, string>([['claude', 'var(--hud-accent)'], ['outside', 'var(--hud-muted)']]);
  let next = 0;
  // dal più vecchio: il colore di un agente non cambia quando arrivano commit nuovi
  for (const c of [...commits].reverse()) {
    const key = authorKey(c.author);
    if (!colors.has(key)) colors.set(key, AGENT_COLORS[next++ % AGENT_COLORS.length]!);
  }
  return colors;
}

export function summarize(commits: readonly GitCommit[]): DaySummary {
  const colors = authorColors(commits);
  const authors = new Map<string, AuthorStats & { order: number }>();
  const paths = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const c of commits) {
    added += c.added;
    removed += c.removed;
    for (const f of c.files) paths.add(f.path);
    const key = authorKey(c.author);
    let a = authors.get(key);
    if (!a) {
      a = { key, label: authorLabel(c.author), title: authorTitle(c.author), color: colors.get(key)!, count: 0, added: 0, removed: 0, order: ORDER[c.author.kind] };
      authors.set(key, a);
    }
    a.count++;
    a.added += c.added;
    a.removed += c.removed;
  }
  const sorted = [...authors.values()]
    .sort((a, b) => (a.key === 'outside' ? 1 : 0) - (b.key === 'outside' ? 1 : 0) || b.count - a.count || a.order - b.order || a.label.localeCompare(b.label))
    .map(({ order: _order, ...a }) => a);
  return { commits: commits.length, added, removed, files: paths.size, authors: sorted };
}

export interface FileStats {
  path: string;
  name: string;
  commits: number;
  added: number;
  removed: number;
}

/** basename di un percorso del repository */
export const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path;

/** File più toccati: per numero di commit, poi per righe cambiate. */
export function topFiles(commits: readonly GitCommit[], limit = 10): FileStats[] {
  const files = new Map<string, FileStats>();
  for (const c of commits) {
    for (const f of c.files) {
      let s = files.get(f.path);
      if (!s) files.set(f.path, (s = { path: f.path, name: baseName(f.path), commits: 0, added: 0, removed: 0 }));
      s.commits++;
      s.added += f.added;
      s.removed += f.removed;
    }
  }
  return [...files.values()]
    .sort((a, b) => b.commits - a.commits || b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** Righe aggiunte e tolte per ora del giorno (0–23, ora locale del browser, come l'orario dei commit). */
export function byHour(commits: readonly GitCommit[]): { added: number; removed: number; commits: number }[] {
  const hours = Array.from({ length: 24 }, () => ({ added: 0, removed: 0, commits: 0 }));
  for (const c of commits) {
    const h = hours[new Date(c.at).getHours()]!;
    h.added += c.added;
    h.removed += c.removed;
    h.commits++;
  }
  return hours;
}

export interface TypeStats {
  /** ".ts", ".css"…; "" senza estensione */
  ext: string;
  files: number;
  added: number;
  removed: number;
}

/** Estensione di un file: ".ts", ".d.ts" resta ".ts"; i file nascosti senza punto dopo il primo (".gitignore") non ne hanno. */
export function extOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** Ripartizione per tipo di file: modifiche ai file (un file in due commit conta due) e righe, dalle più righe. */
export function byType(commits: readonly GitCommit[], limit = 6): TypeStats[] {
  const types = new Map<string, TypeStats>();
  for (const c of commits) {
    for (const f of c.files) {
      const ext = extOf(f.path);
      let s = types.get(ext);
      if (!s) types.set(ext, (s = { ext, files: 0, added: 0, removed: 0 }));
      s.files++;
      s.added += f.added;
      s.removed += f.removed;
    }
  }
  return [...types.values()]
    .sort((a, b) => b.added + b.removed - (a.added + a.removed) || b.files - a.files || a.ext.localeCompare(b.ext))
    .slice(0, limit);
}
