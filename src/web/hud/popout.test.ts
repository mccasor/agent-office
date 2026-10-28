// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cardFromSearch, cardUrl, cardWindowName, openCardWindow, requestedTab, requestTab, tabFromSearch, tabKey } from './popout';

describe('schede staccabili (#92)', () => {
  it('scheda chiesta dall\'URL', () => {
    expect(cardFromSearch('?card=agent&id=boss%3As1')).toEqual({ kind: 'agent', id: 'boss:s1' });
    expect(cardFromSearch('?card=session&id=s1')).toEqual({ kind: 'session', id: 's1' });
    expect(cardFromSearch('?view=pixel')).toBeNull();
    expect(cardFromSearch('?card=altro&id=x')).toBeNull();
    expect(cardFromSearch('?card=agent')).toBeNull();
  });

  it('URL e nome della finestra, uno per scheda', () => {
    expect(cardUrl('agent', 'boss:s1', 'http://127.0.0.1:4318')).toBe('http://127.0.0.1:4318/?card=agent&id=boss%3As1');
    expect(cardWindowName('agent', 'boss:s1')).toBe('agent-office-agent-boss_s1');
    expect(cardWindowName('session', 's1')).not.toBe(cardWindowName('agent', 's1'));
  });

  it('apre la finestra con window.open e la porta in primo piano', () => {
    const focus = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window);
    openCardWindow('session', 's1');
    expect(open).toHaveBeenCalledWith(`${location.origin}/?card=session&id=s1`, 'agent-office-session-s1', expect.stringMatching(/^popup,width=\d+,height=\d+$/));
    expect(focus).toHaveBeenCalled();
    // finestra negata (popup bloccato o app della menu bar, dove la apre Tauri): nessun errore
    open.mockReturnValue(null);
    expect(() => openCardWindow('agent', 'a1')).not.toThrow();
    open.mockRestore();
  });

  it('scheda Git dell\'istanza (#109): nell\'URL e in localStorage (l\'app ricostruisce l\'URL senza `tab`)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openCardWindow('session', 's1', 'git');
    expect(open).toHaveBeenCalledWith(`${location.origin}/?card=session&id=s1&tab=git`, 'agent-office-session-s1', expect.any(String));
    expect(requestedTab(localStorage.getItem(tabKey('s1')))).toBe('git');
    open.mockRestore();
    expect(tabFromSearch('?card=session&id=s1&tab=git')).toBe('git');
    expect(tabFromSearch('?card=session&id=s1&tab=altro')).toBeNull();
    // richiesta scaduta o illeggibile: ignorata
    requestTab('s2', 'git', 1000);
    expect(requestedTab(localStorage.getItem(tabKey('s2')), 1000 + 60_000)).toBeNull();
    expect(requestedTab('{rotto')).toBeNull();
    expect(requestedTab(null)).toBeNull();
    localStorage.clear();
  });
});
