import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { toView, useOfficeStore } from './store';

declare global {
  interface Window {
    /** usata dall'app della menu bar per cambiare vista (ed evidenziare una sessione) senza ricaricare la pagina */
    agentOfficeFocus?: (view: string, sessionId: string) => void;
  }
}
// le versioni dell'app della menu bar precedenti alla rimozione del 3D chiedono ancora 'office'
window.agentOfficeFocus = (view, sessionId) => useOfficeStore.getState().focus(toView(view) ?? 'pixel', sessionId);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
