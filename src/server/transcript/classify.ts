import type { WorkArea } from '../../shared/types.js';

type Rule = [area: WorkArea, pattern: RegExp];

/** Token di agentType (separati da - _ spazio), in ordine di priorità. */
const AGENT_TYPE_RULES: Rule[] = [
  ['frontend', /^(ui|ux|frontend|front|web|css|design(er)?)$/],
  ['docs', /^(docs?|documentation|writer)$/],
  ['test', /^(tests?|testing|tester|qa|e2e|nyquist|uat)$/],
  ['architecture', /^(plan|planner|architect|architecture|roadmapper|spec)$/],
  ['research', /^(explore|explorer|research|researcher|mapper|analyzer|analyst|advisor|assumptions)$/],
  ['devops', /^(devops|ops|infra|deploy|deployer|ci|cd|sre|release)$/],
  ['backend', /^(backend|back|server|api|db|database)$/],
];

/** Keyword (it/en) della description, a parola intera, in ordine di priorità. */
const DESCRIPTION_RULES: Rule[] = [
  ['test', /\b(tests?|testing|e2e|unit|spec|vitest|jest|playwright|cypress|qa|coverage|collaudo)\b/],
  ['docs', /\b(docs?|documentation|documentazione|readme|changelog|guida|guide|manuale)\b/],
  ['devops', /\b(ci|cd|pipeline|deploy\w*|docker\w*|kubernetes|k8s|helm|terraform|infra\w*|release|rilascio|github actions)\b/],
  ['frontend', /\b(ui|ux|frontend|front-end|react|css|components?|componenti?|pages?|pagina|view|hud|scene|scena|3d|layout|styles?|stile|web|characters?|personaggi)\b/],
  ['backend', /\b(backend|back-end|server|api|endpoints?|database|db|sql|migrations?|migrazion[ei]|sse|http|services?|servizi?o?|watcher)\b/],
  ['architecture', /\b(architecture|architettura|plan|piano|pianifica\w*|refactor\w*|struttura|structure|contract|contratto|design)\b/],
  ['research', /\b(explore|esplora\w*|research|ricerca|analy[sz]e|analisi|investigate|indaga\w*|survey|audit|review|search|cerca)\b/],
];

/** Regole sui percorsi dei file toccati; vince la maggioranza (pari merito: ordine di priorità). */
const PATH_RULES: Rule[] = [
  ['test', /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/(__tests__|tests?|e2e|fixtures?)\/)/],
  ['docs', /(\.(md|mdx|rst|adoc|txt)$)|(\/docs?\/)/],
  ['devops', /(\/\.github\/)|(\/dockerfile[^/]*$)|(docker-compose[^/]*$)|(\.tf$)|(\/makefile$)|(\/jenkinsfile$)|(\.gitlab-ci\.ya?ml$)|(\/(k8s|helm|deploy|infra)\/)/],
  ['frontend', /(\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$)|(\/(web|client|frontend|ui|components?|pages)\/)/],
  ['backend', /(\.(go|py|rb|java|kt|rs|php|cs|sql)$)|(\/(server|api|backend|db|migrations?)\/)/],
];

const firstMatch = (rules: Rule[], test: (re: RegExp) => boolean): WorkArea | null =>
  rules.find(([, re]) => test(re))?.[0] ?? null;

export function classifyArea(input: { agentType: string; description: string; filePaths: string[] }): WorkArea {
  const tokens = input.agentType.toLowerCase().split(/[-_\s]+/).filter(Boolean);
  const byType = firstMatch(AGENT_TYPE_RULES, (re) => tokens.some((t) => re.test(t)));
  if (byType) return byType;

  const description = input.description.toLowerCase();
  const byDescription = firstMatch(DESCRIPTION_RULES, (re) => re.test(description));
  if (byDescription) return byDescription;

  const votes = new Map<WorkArea, number>();
  for (const raw of input.filePaths) {
    const path = raw.toLowerCase().replace(/\\/g, '/');
    const area = firstMatch(PATH_RULES, (re) => re.test(path));
    if (area) votes.set(area, (votes.get(area) ?? 0) + 1);
  }
  let best: WorkArea = 'other';
  let bestVotes = 0;
  for (const [area] of PATH_RULES) {
    const n = votes.get(area) ?? 0;
    if (n > bestVotes) [best, bestVotes] = [area, n];
  }
  return best;
}
