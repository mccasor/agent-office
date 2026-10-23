// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appTitle, fitHeight, followHeight, inApp, MIN_HEIGHT, shouldResize, SHRINK_SLACK, TITLE_SEPARATOR } from './fit';

describe('finestra della scheda a misura del contenuto', () => {
  it('altezza desiderata: intera, tra minimo e massimo', () => {
    expect(fitHeight(412.3, 900)).toBe(413);
    expect(fitHeight(100, 900)).toBe(MIN_HEIGHT);
    expect(fitHeight(2000, 900.7)).toBe(900);
    // schermo minuscolo: vince il massimo
    expect(fitHeight(500, 200)).toBe(200);
    expect(fitHeight(100, 200)).toBe(200);
  });

  it('soglia anti-sfarfallio: cresce sempre, si restringe solo oltre la soglia', () => {
    expect(shouldResize(500, 501)).toBe(true);
    expect(shouldResize(500, 500)).toBe(false);
    expect(shouldResize(500, 500 - SHRINK_SLACK)).toBe(false);
    expect(shouldResize(500, 499 - SHRINK_SLACK)).toBe(true);
  });

  it('titolo per l\'app: nome, separatore, altezza e contatore a una cifra', () => {
    expect(appTitle('Marta Commit', 412.4, 3)).toBe(`Marta Commit${TITLE_SEPARATOR}412-3`);
    expect(appTitle('x', 300, 12)).toBe(`x${TITLE_SEPARATOR}300-2`);
    expect(inApp('?card=agent&id=a1&app=1')).toBe(true);
    expect(inApp('?card=agent&id=a1')).toBe(false);
  });

  describe('followHeight', () => {
    let height = 0;
    let observed: (() => void) | null = null;
    const el = { getBoundingClientRect: () => ({ height }) } as unknown as HTMLElement;
    class FakeObserver {
      constructor(cb: () => void) {
        observed = cb;
      }
      observe() {}
      disconnect() {
        observed = null;
      }
    }
    const tick = (h: number) => {
      height = h;
      observed!();
    };
    afterEach(() => vi.unstubAllGlobals());

    it('chiede di ridimensionare solo quando il contenuto cambia davvero', () => {
      vi.stubGlobal('ResizeObserver', FakeObserver);
      const win = { max: 800, current: 600 };
      const apply = vi.fn((h: number) => {
        win.current = h;
      });
      height = 412;
      const stop = followHeight(el, () => win, apply);
      expect(apply).toHaveBeenLastCalledWith(412);
      tick(412);
      expect(apply).toHaveBeenCalledTimes(1);
      // cresce: subito; oltre il massimo: il massimo
      tick(450);
      expect(apply).toHaveBeenLastCalledWith(450);
      tick(1200);
      expect(apply).toHaveBeenLastCalledWith(800);
      // si restringe di poco: niente; di molto: sì
      tick(790);
      expect(apply).toHaveBeenCalledTimes(3);
      tick(500);
      expect(apply).toHaveBeenLastCalledWith(500);
      // finestra ridimensionata a mano, contenuto uguale: resta com'è
      win.current = 700;
      tick(500);
      expect(apply).toHaveBeenCalledTimes(4);
      stop();
      expect(observed).toBeNull();
    });

    it('senza ResizeObserver misura una volta sola', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      const apply = vi.fn();
      height = 300;
      followHeight(el, () => ({ max: 800, current: 600 }), apply)();
      expect(apply).toHaveBeenCalledWith(300);
    });
  });
});
