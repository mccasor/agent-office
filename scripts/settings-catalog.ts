// Scrive i file generati per l'app dal catalogo delle impostazioni (src/shared/settings.ts) e dai testi
// (src/shared/i18n): src-tauri/splash/settings-catalog.js e src-tauri/splash/i18n.js per le pagine locali (Impostazioni,
// pannello, splash), src-tauri/src/i18n.json per l'app in Rust. Da rilanciare quando cambiano: un test lo ricorda.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appJson, pagesScript } from '../src/shared/i18n/index.js';
import { catalogScript } from '../src/shared/settings.js';

const files: [string, string][] = [
  ['../src-tauri/splash/settings-catalog.js', catalogScript()],
  ['../src-tauri/splash/i18n.js', pagesScript()],
  ['../src-tauri/src/i18n.json', appJson()],
];
for (const [path, text] of files) {
  const out = fileURLToPath(new URL(path, import.meta.url));
  writeFileSync(out, text);
  console.log(`Scritto ${out}`);
}
