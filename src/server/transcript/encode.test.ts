import { describe, expect, it } from 'vitest';
import { encodeProjectPath } from './index.js';

describe('encodeProjectPath', () => {
  it.each([
    ['/Library/WebServer/Documents/olimpo-ui', '-Library-WebServer-Documents-olimpo-ui'],
    ['/tmp/agent-office-fixture', '-tmp-agent-office-fixture'],
    ['/Users/me/my.project/.claude/worktrees/agent_1', '-Users-me-my-project--claude-worktrees-agent-1'],
    ['/a b/c', '-a-b-c'],
  ])('%s -> %s', (cwd, encoded) => {
    expect(encodeProjectPath(cwd)).toBe(encoded);
  });
});
