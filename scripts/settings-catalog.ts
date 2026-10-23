// Scrive src-tauri/splash/settings-catalog.js dal catalogo delle impostazioni (src/shared/settings.ts), per le pagine
// locali dell'app (Impostazioni, pannello). Da rilanciare quando cambia il catalogo: un test lo ricorda.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogScript } from '../src/shared/settings.js';

const out = fileURLToPath(new URL('../src-tauri/splash/settings-catalog.js', import.meta.url));
writeFileSync(out, catalogScript());
console.log(`Catalogo delle impostazioni scritto in ${out}`);
