import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useOfficeStore } from './store';

declare global {
  interface Window {
    /** usata dall'app della menu bar per cambiare vista senza ricaricare la pagina (e la scena) */
    agentOfficeSetView?: (view: 'office' | 'list') => void;
  }
}
window.agentOfficeSetView = (view) => useOfficeStore.getState().setView(view);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
