// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomControls } from './ZoomControls';

afterEach(cleanup);

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('ZoomControls', () => {
  it('adattata: si può solo ingrandire', () => {
    const zoomIn = vi.fn();
    render(<ZoomControls canZoomIn canZoomOut={false} zoomIn={zoomIn} zoomOut={vi.fn()} fit={vi.fn()} />);
    expect(button('Riduci').disabled).toBe(true);
    expect(button('Adatta alla finestra').disabled).toBe(true);
    fireEvent.click(button('Ingrandisci'));
    expect(zoomIn).toHaveBeenCalledOnce();
  });

  it('al massimo: si riduce o si torna ad "adatta"', () => {
    const zoomOut = vi.fn();
    const fit = vi.fn();
    render(<ZoomControls canZoomIn={false} canZoomOut zoomIn={vi.fn()} zoomOut={zoomOut} fit={fit} />);
    expect(button('Ingrandisci').disabled).toBe(true);
    fireEvent.click(button('Riduci'));
    fireEvent.click(button('Adatta alla finestra'));
    expect(zoomOut).toHaveBeenCalledOnce();
    expect(fit).toHaveBeenCalledOnce();
  });
});
