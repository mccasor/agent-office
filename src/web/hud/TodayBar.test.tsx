// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TodayBar, todayItems } from './TodayBar';

afterEach(cleanup);

const today = { since: 0, cost: 12.4, costLastHour: 1.2, launched: 1, finished: 0, failed: 0, waitingMs: 0 };

describe('TodayBar', () => {
  it('voci: singolare e plurale, nessuna attesa, costo senza listino', () => {
    expect(todayItems(today).map((i) => `${i.value} ${i.label}`)).toEqual([
      '≈ $12,40 costo', '≈ $1,20/h ultima ora', '1 lanciato', '0 terminati', '0 falliti', '0 min in attesa',
    ]);
    expect(todayItems({ ...today, cost: null, costLastHour: null, waitingMs: 65 * 60_000 }).map((i) => i.value)).toEqual(['—', '—/h', '1', '0', '0', '1 h 05']);
  });

  it('in breve sull\'ufficio: una riga, con i limiti dei numeri nel tooltip', () => {
    render(<TodayBar today={{ ...today, failed: 2 }} compact />);
    const bar = screen.getByLabelText('Oggi');
    expect(bar.textContent).toBe('Oggi≈ $12,40≈ $1,20/h1 lanciato0 terminati2 falliti0 min in attesa');
    expect(bar.getAttribute('title')).toMatch(/^Da mezzanotte, anche dopo un riavvio/);
    expect(screen.getByText('2 falliti').className).toBe('today-bar__alarm');
  });
});
