// Prepara le risorse dell'app Tauri: server e pagina già compilati (dist), binari e le sole dipendenze di runtime del
// server (chokidar e readdirp). React e il resto sono già dentro dist/web.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}src-tauri/resources/app`;
const RUNTIME_DEPS = ['chokidar', 'readdirp'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of ['package.json', 'bin', 'dist']) cpSync(`${root}${p}`, `${out}/${p}`, { recursive: true });
for (const dep of RUNTIME_DEPS) cpSync(`${root}node_modules/${dep}`, `${out}/node_modules/${dep}`, { recursive: true });
console.log(`Risorse Tauri pronte in ${out}`);
