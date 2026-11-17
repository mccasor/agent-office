import { launchToken } from './guard.js';

describe('launchToken (#116)', () => {
  it("usa il token passato dall'app e lo toglie dall'ambiente (i processi figli non lo ereditano)", () => {
    const env: NodeJS.ProcessEnv = { AGENT_OFFICE_TOKEN: 'f'.repeat(64), ALTRO: '1' };
    expect(launchToken(env)).toBe('f'.repeat(64));
    expect(env).toEqual({ ALTRO: '1' });
  });

  it('senza token (o troppo corto) ne genera uno casuale di 256 bit', () => {
    const a = launchToken({});
    const env: NodeJS.ProcessEnv = { AGENT_OFFICE_TOKEN: 'corto' };
    const b = launchToken(env);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(env.AGENT_OFFICE_TOKEN).toBeUndefined();
  });
});
