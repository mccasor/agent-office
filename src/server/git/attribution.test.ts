import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nicknameOf } from '../../shared/nickname.js';
import { attribute, createCommitScanner, folderSources, parseCommitOutput, sessionSources, type TranscriptCommit } from './attribution.js';
import type { LogCommit } from './log.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-10-20T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** riga assistant con un tool_use Bash */
const bash = (id: string, command: string, at: number) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(at), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
/** riga utente con il risultato di un tool_use */
const result = (id: string, text: string, at: number, asBlocks = false) =>
  JSON.stringify({
    type: 'user',
    timestamp: iso(at),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: asBlocks ? [{ type: 'text', text }] : text }] },
  });
/** prompt dell'utente: non va mai letto */
const prompt = (text: string, at: number) => JSON.stringify({ type: 'user', timestamp: iso(at), message: { role: 'user', content: text } });

const lines = (...rows: string[]) => `${rows.join('\n')}\n`;

function project(): { dir: string; session: string; sub: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-attr-'));
  dirs.push(dir);
  const session = join(dir, 's1.jsonl');
  const sub = join(dir, 's1', 'subagents');
  mkdirSync(join(sub, 'workflows', 'w1'), { recursive: true });
  return { dir, session, sub };
}

const log = (hash: string, message: string, at: number, extra: Partial<LogCommit> = {}): LogCommit => ({
  hash, short: hash.slice(0, 7), at, authoredAt: at, branch: 'main', message, added: 1, removed: 0, files: [{ path: 'a.ts', added: 1, removed: 0 }], filesCount: 1, ...extra,
});

describe('parseCommitOutput', () => {
  it('branch, hash e messaggio; root-commit e HEAD staccato', () => {
    expect(parseCommitOutput('[main abc1234] feat: uno\n 1 file changed, 2 insertions(+)')).toEqual([{ branch: 'main', hash: 'abc1234', message: 'feat: uno' }]);
    expect(parseCommitOutput('[main (root-commit) abc1234] primo')).toEqual([{ branch: 'main', hash: 'abc1234', message: 'primo' }]);
    expect(parseCommitOutput('[detached HEAD 1234567] staccato')).toEqual([{ branch: null, hash: '1234567', message: 'staccato' }]);
    expect(parseCommitOutput('[feat/x-y 89abcdef0] a\n[feat/x-y 1111111] b')).toHaveLength(2);
    expect(parseCommitOutput('nothing to commit, working tree clean')).toEqual([]);
  });
});

describe('sessionSources', () => {
  it('sessione, subagenti e subagenti dei workflow', async () => {
    const { session, sub } = project();
    writeFileSync(session, '');
    writeFileSync(join(sub, 'agent-a1.jsonl'), '');
    writeFileSync(join(sub, 'agent-a1.meta.json'), '{}');
    writeFileSync(join(sub, 'workflows', 'w1', 'agent-w2.jsonl'), '');
    writeFileSync(join(sub, 'altro.jsonl'), '');
    const sources = await sessionSources(session, 's1');
    expect(sources[0]).toEqual({ path: session, agentId: null, sessionId: 's1' });
    expect(sources.every((s) => s.sessionId === 's1')).toBe(true);
    expect(sources.slice(1).map((s) => s.agentId).sort()).toEqual(['a1', 'w2']);
  });

  it('sessioni della stessa cartella, la sessione data per prima; `since` salta i transcript fermi da prima', async () => {
    const { dir, session, sub } = project();
    writeFileSync(session, '');
    writeFileSync(join(sub, 'agent-a1.jsonl'), '');
    const other = join(dir, 's0.jsonl');
    writeFileSync(other, '');
    const old = join(dir, 'vecchia.jsonl');
    writeFileSync(old, '');
    utimesSync(old, new Date(T0 - 86_400_000), new Date(T0 - 86_400_000));
    const all = await folderSources(session);
    expect(all[0]).toEqual({ path: session, agentId: null, sessionId: 's1' });
    expect(all.find((s) => s.path === other)?.sessionId).toBe('s0');
    expect(all.map((s) => s.path).sort()).toEqual([join(sub, 'agent-a1.jsonl'), old, other, session].sort());
    const recent = await folderSources(session, T0);
    expect(recent.map((s) => s.path)).not.toContain(old);
    expect(recent).toHaveLength(3);
  });

  it('senza cartella dei subagenti: solo la sessione', async () => {
    const { dir } = project();
    expect(await sessionSources(join(dir, 'nuova.jsonl'), 'nuova')).toEqual([{ path: join(dir, 'nuova.jsonl'), agentId: null, sessionId: 'nuova' }]);
  });
});

describe('attribuzione dai transcript', () => {
  it('sessione = Claude, subagente = quell\'agente (nickname e tipo), resto fuori da Claude; amend con l\'hash nuovo', async () => {
    const { session, sub } = project();
    writeFileSync(
      session,
      lines(
        prompt('fai il commit [main 9999999] finto', T0),
        bash('u1', 'git add -A && git commit -m "feat: claude"', T0 + 1000),
        result('u1', '[main aaaaaaa] feat: claude\n 1 file changed', T0 + 2000),
        // amend: l'hash vecchio sparisce da git log, quello nuovo è nell'output
        bash('u2', 'git commit --amend --no-edit', T0 + 60_000),
        result('u2', '[main bbbbbbb] feat: claude\n Date: Tue Oct 20 10:00:01 2026 +0000', T0 + 61_000, true),
      ),
    );
    writeFileSync(join(sub, 'agent-a1.jsonl'), lines(bash('v1', 'git -C /repo/wt commit -q -F - <<EOF\nfix: agente\nEOF\necho ok', T0 + 5000), result('v1', '[worktree-a1 ccccccc] fix: agente', T0 + 6000)));
    writeFileSync(join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'non serve' }));
    const scanner = createCommitScanner();
    const seen = await scanner.scan(await sessionSources(session, 's1'));
    const commits = attribute(
      [
        log('b'.repeat(40), 'feat: claude', T0 + 61_000),
        log('c'.repeat(40), 'fix: agente', T0 + 6000, { branch: null }),
        log('d'.repeat(40), 'chore: a mano', T0 + 600_000),
        // il prompt contiene una riga da commit: non vale
        log(`9999999${'0'.repeat(33)}`, 'finto', T0),
      ],
      seen,
    );
    expect(commits.map((c) => [c.hash, c.author, c.matchedBy])).toEqual([
      ['bbbbbbb', { kind: 'claude', sessionId: 's1' }, 'hash'],
      ['ccccccc', { kind: 'agent', agentId: 'a1', nickname: nicknameOf('a1'), agentType: 'Explore' }, 'hash'],
      ['ddddddd', { kind: 'outside' }, undefined],
      ['9999999', { kind: 'outside' }, undefined],
    ]);
    // branch dal transcript quando git log non lo sa
    expect(commits[1]!.branch).toBe('worktree-a1');
    // dei transcript restano solo hash, branch, messaggio e orari
    for (const s of seen) expect(Object.keys(s).sort()).toEqual(['at', 'author', 'branch', 'hash', 'message', 'startedAt']);
    expect(JSON.stringify(seen)).not.toContain('fai il commit');
  });

  it('il risultato di un comando che non è git commit non vale, anche se ne ha la forma', async () => {
    const { session } = project();
    writeFileSync(session, lines(bash('u1', 'cat notes.txt', T0), result('u1', '[main aaaaaaa] feat: x', T0 + 1000)));
    const seen = await createCommitScanner().scan([{ path: session, agentId: null }]);
    expect(seen).toEqual([]);
  });

  it('cherry-pick e merge dal worktree: stesso messaggio e minuto (author date) valgono l\'autore originale', () => {
    const seen: TranscriptCommit[] = [
      { hash: 'ccccccc', branch: 'wt', message: 'fix: agente', startedAt: T0 - 1000, at: T0, author: { kind: 'agent', agentId: 'a1', nickname: 'X', agentType: 'Plan' } },
    ];
    const [picked, other, late] = attribute(
      [
        log('e'.repeat(40), 'fix: agente', T0 + 3_600_000, { authoredAt: T0 - 500 }),
        log('f'.repeat(40), 'fix: diverso', T0 + 3_600_000, { authoredAt: T0 - 500 }),
        log('1'.repeat(40), 'fix: agente', T0 + 3_600_000, { authoredAt: T0 + 10 * 60_000 }),
      ],
      seen,
    );
    expect(picked).toMatchObject({ author: { kind: 'agent', agentId: 'a1' }, matchedBy: 'message' });
    expect(other!.author).toEqual({ kind: 'outside' });
    expect(late!.author).toEqual({ kind: 'outside' });
  });

  it('git commit -q (nessun hash nell\'output): vale l\'intervallo del comando, il più stretto se più d\'uno', async () => {
    const { session, sub } = project();
    writeFileSync(session, lines(bash('u1', 'npm test && git commit -q -m "x"', T0), result('u1', '', T0 + 60_000)));
    writeFileSync(join(sub, 'agent-a2.jsonl'), lines(bash('v1', 'git commit -qm y', T0 + 10_000), result('v1', '', T0 + 12_000)));
    const seen = await createCommitScanner().scan(await sessionSources(session, 's1'));
    expect(seen.map((s) => s.hash)).toEqual([null, null]);
    const [inAgent, inClaude, outside] = attribute(
      [log('a'.repeat(40), 'y', T0 + 11_000), log('b'.repeat(40), 'x', T0 + 50_000), log('c'.repeat(40), 'z', T0 + 120_000)],
      seen,
    );
    expect(inAgent).toMatchObject({ author: { kind: 'agent', agentId: 'a2' }, matchedBy: 'time' });
    expect(inClaude).toMatchObject({ author: { kind: 'claude' }, matchedBy: 'time' });
    expect(outside!.author).toEqual({ kind: 'outside' });
  });

  it('lettura incrementale: i commit nuovi si aggiungono, un transcript riscritto riparte da capo', async () => {
    const { session } = project();
    writeFileSync(session, lines(bash('u1', 'git commit -m a', T0), result('u1', '[main aaaaaaa] a', T0 + 1000)));
    const scanner = createCommitScanner();
    const src = [{ path: session, agentId: null }];
    expect((await scanner.scan(src)).map((s) => s.hash)).toEqual(['aaaaaaa']);
    // tool_use e risultato in due letture diverse
    appendFileSync(session, lines(bash('u2', 'git commit -m b', T0 + 5000)));
    expect((await scanner.scan(src)).map((s) => s.hash)).toEqual(['aaaaaaa']);
    appendFileSync(session, lines(result('u2', '[main bbbbbbb] b', T0 + 6000)));
    expect((await scanner.scan(src)).map((s) => s.hash)).toEqual(['aaaaaaa', 'bbbbbbb']);
    writeFileSync(session, lines(bash('u3', 'git commit -m c', T0), result('u3', '[main ccccccc] c', T0 + 1000)));
    expect((await scanner.scan(src)).map((s) => s.hash)).toEqual(['ccccccc']);
  });
});
