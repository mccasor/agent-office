import { describe, expect, it } from 'vitest';
import { FIRST_NAMES, LAST_NAMES, nicknameOf } from './nickname';

describe('nicknameOf', () => {
  it('stabile per lo stesso id', () => {
    expect(nicknameOf('aa90d25bed00dc240')).toBe(nicknameOf('aa90d25bed00dc240'));
  });

  it('nome e cognome dalle liste, mai quelli di Claudio Code', () => {
    const [first, last] = nicknameOf('a0000000000000001').split(' ');
    expect(FIRST_NAMES).toContain(first);
    expect(LAST_NAMES).toContain(last);
    expect(FIRST_NAMES).not.toContain('Claudio');
    expect(LAST_NAMES).not.toContain('Code');
  });

  it('liste ampie e senza doppioni', () => {
    expect(new Set(FIRST_NAMES).size).toBe(40);
    expect(new Set(LAST_NAMES).size).toBe(40);
  });

  it('id diversi danno nomi vari', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => nicknameOf(`a${i.toString(16).padStart(16, '0')}`)));
    expect(names.size).toBeGreaterThan(180);
    const firsts = new Set([...names].map((n) => n.split(' ')[0]));
    const lasts = new Set([...names].map((n) => n.split(' ')[1]));
    expect(firsts.size).toBeGreaterThan(35);
    expect(lasts.size).toBeGreaterThan(35);
  });

  it('anche id che differiscono solo nelle ultime cifre (subagenti in fila) hanno cognomi vari', () => {
    const lasts = new Set(Array.from({ length: 14 }, (_, i) => nicknameOf(`a00000000000001${String(i).padStart(2, '0')}`).split(' ')[1]));
    expect(lasts.size).toBeGreaterThanOrEqual(10);
  });
});
