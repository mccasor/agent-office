import './zoom.css';

/** icone a tratto 16×16, come quelle del pannello della menu bar */
const ICON = {
  in: 'M8 3.5v9M3.5 8h9',
  out: 'M3.5 8h9',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/**
 * Pulsanti di zoom della vista 2D (#87), in basso a destra sopra l'ufficio: riduci, ingrandisci e "adatta alla
 * finestra". Con ⌘/ctrl e la rotella (o il pinch del trackpad) si ingrandisce sotto il cursore.
 */
export function ZoomControls({ canZoomIn, canZoomOut, zoomIn, zoomOut, fit }: {
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}) {
  return (
    <div className="hud-zoom" role="group" aria-label="Zoom">
      <button type="button" title="Riduci (⌘/ctrl + rotella)" aria-label="Riduci" disabled={!canZoomOut} onClick={zoomOut}>
        <Icon d={ICON.out} />
      </button>
      <button type="button" title="Ingrandisci (⌘/ctrl + rotella)" aria-label="Ingrandisci" disabled={!canZoomIn} onClick={zoomIn}>
        <Icon d={ICON.in} />
      </button>
      <button type="button" title="Adatta alla finestra" aria-label="Adatta alla finestra" disabled={!canZoomOut} onClick={fit}>
        <Icon d={ICON.fit} />
      </button>
    </div>
  );
}
