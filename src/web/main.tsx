import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useOfficeStore } from './store';

declare global {
  interface Window {
    /** usate dall'app della menu bar per cambiare vista (ed evidenziare una sessione) senza ricaricare la pagina */
    agentOfficeSetView?: (view: 'office' | 'list') => void;
    agentOfficeFocus?: (view: 'office' | 'list', sessionId: string) => void;
  }
}
window.agentOfficeSetView = (view) => useOfficeStore.getState().setView(view);
window.agentOfficeFocus = (view, sessionId) => useOfficeStore.getState().focus(view, sessionId);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
