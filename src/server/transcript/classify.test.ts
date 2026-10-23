import { describe, expect, it } from 'vitest';
import type { WorkArea } from '../../shared/types.js';
import { classifyArea } from './index.js';

type Case = [label: string, input: { agentType?: string; description?: string; filePaths?: string[] }, expected: WorkArea];

const cases: Case[] = [
  // 1. agentType ha la priorità
  ['gsd-ui-auditor', { agentType: 'gsd-ui-auditor' }, 'design'],
  ['gsd-ui-researcher batte "research"', { agentType: 'gsd-ui-researcher' }, 'design'],
  ['ux-designer', { agentType: 'ux-designer' }, 'design'],
  ['Explore', { agentType: 'Explore', description: 'Fix React component' }, 'research'],
  ['Plan', { agentType: 'Plan', description: 'write tests' }, 'architecture'],
  ['gsd-planner', { agentType: 'gsd-planner' }, 'architecture'],
  ['gsd-roadmapper', { agentType: 'gsd-roadmapper' }, 'architecture'],
  ['gsd-doc-writer', { agentType: 'gsd-doc-writer' }, 'docs'],
  ['gsd-doc-verifier (docs prima di test)', { agentType: 'gsd-doc-verifier' }, 'docs'],
  ['gsd-nyquist-auditor', { agentType: 'gsd-nyquist-auditor' }, 'test'],
  ['test-runner', { agentType: 'test-runner' }, 'test'],
  ['gsd-phase-researcher', { agentType: 'gsd-phase-researcher' }, 'research'],
  ['gsd-codebase-mapper', { agentType: 'gsd-codebase-mapper' }, 'research'],
  ['devops-engineer', { agentType: 'devops-engineer' }, 'devops'],
  ['backend-dev', { agentType: 'backend-dev' }, 'backend'],
  ['frontend-dev', { agentType: 'frontend-developer' }, 'frontend'],
  // 2. agentType generico -> keyword della description (it/en)
  ['general-purpose + hud', { agentType: 'general-purpose', description: 'HUD and store #12 #13' }, 'frontend'],
  ['icone', { agentType: 'general-purpose', description: 'Disegnare le icone della menu bar' }, 'design'],
  ['figma', { agentType: 'general-purpose', description: 'Port the Figma mockup' }, 'design'],
  ['CSS e palette', { agentType: 'general-purpose', description: 'Palette colori del tema scuro' }, 'design'],
  ['"design" da solo resta architettura', { agentType: 'general-purpose', description: 'Design of the module boundaries' }, 'architecture'],
  ['general-purpose + scena', { agentType: 'general-purpose', description: 'Scena 3D ufficio' }, 'frontend'],
  ['server watcher', { agentType: 'general-purpose', description: 'Transcript watcher server' }, 'backend'],
  ['API endpoint', { agentType: 'general-purpose', description: 'Add REST API endpoint' }, 'backend'],
  ['e2e', { agentType: 'general-purpose', description: 'Smoke e2e CLI' }, 'test'],
  ['test it', { agentType: 'claude', description: 'Scrivere i test unitari' }, 'test'],
  ['README', { agentType: 'general-purpose', description: 'Update README usage' }, 'docs'],
  ['documentazione', { agentType: 'general-purpose', description: 'Documentazione privacy' }, 'docs'],
  ['CI pipeline', { agentType: 'general-purpose', description: 'Setup CI pipeline' }, 'devops'],
  ['docker', { agentType: 'general-purpose', description: 'Dockerfile for deploy' }, 'devops'],
  ['architettura', { agentType: 'general-purpose', description: "Definire l'architettura" }, 'architecture'],
  ['refactor', { agentType: 'general-purpose', description: 'Refactor module structure' }, 'architecture'],
  ['ricerca', { agentType: 'general-purpose', description: 'Ricerca libreria grafici' }, 'research'],
  ['investigate', { agentType: 'general-purpose', description: 'Investigate flaky behaviour' }, 'research'],
  ['parole non intere non matchano ("build" non contiene "ui")', { agentType: 'general-purpose', description: 'Build things' }, 'other'],
  // 3. nessun indizio testuale -> file toccati
  ['tsx', { agentType: 'general-purpose', description: 'Procedural characters #11', filePaths: ['/p/src/web/characters/index.tsx'] }, 'frontend'],
  ['server dir', { agentType: 'general-purpose', description: 'Step 3', filePaths: ['/p/src/server/http/index.ts'] }, 'backend'],
  ['test files', { description: 'Step 4', filePaths: ['/p/src/a.test.ts', '/p/src/b.spec.tsx'] }, 'test'],
  ['markdown', { filePaths: ['/p/README.md', '/p/docs/guide.md'] }, 'docs'],
  ['workflows', { filePaths: ['/p/.github/workflows/ci.yml'] }, 'devops'],
  ['immagini e svg', { filePaths: ['/p/assets/logo.svg', '/p/src/icons/play.png', '/p/src/web/a.tsx'] }, 'design'],
  ['python', { filePaths: ['/p/app/models.py'] }, 'backend'],
  ['maggioranza', { filePaths: ['/p/src/web/a.tsx', '/p/src/web/b.css', '/p/src/server/c.ts'] }, 'frontend'],
  // 4. default
  ['vuoto', {}, 'other'],
  ['ts senza indizi', { agentType: 'general-purpose', description: 'Task', filePaths: ['/p/src/util.ts'] }, 'other'],
];

describe('classifyArea', () => {
  it.each(cases)('%s', (_label, input, expected) => {
    expect(classifyArea({ agentType: input.agentType ?? '', description: input.description ?? '', filePaths: input.filePaths ?? [] })).toBe(expected);
  });
});
