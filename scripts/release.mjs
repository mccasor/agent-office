#!/usr/bin/env node
// Release dell'app per la menu bar via Homebrew.
//   node scripts/release.mjs            build universale + .dmg + cask in release/ (niente su GitHub)
//   node scripts/release.mjs --publish  in più: release GitHub nel tap con il .dmg e cask aggiornato nel tap
// La versione è solo in package.json (tauri.conf.json la legge da lì): prima alzala con
//   npm version patch|minor|major --no-git-tag-version
// Richiede rustup con il target x86_64-apple-darwin; per --publish, gh autenticato con accesso al tap.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAP = 'mccasor/homebrew-agent-office';
const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const publish = process.argv.includes('--publish');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

run('npx', ['tauri', 'build', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg']);

// nome senza spazi: GitHub li sostituirebbe con dei punti negli asset
const dmgName = `Agent-Office_${version}_universal.dmg`;
const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const dmg = join(outDir, dmgName);
copyFileSync(join(root, `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Agent Office_${version}_universal.dmg`), dmg);
const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');

const cask = readFileSync(join(root, 'packaging/homebrew/agent-office.rb'), 'utf8')
  .replace(/version "[^"]*"/, `version "${version}"`)
  .replace(/sha256 "[^"]*"/, `sha256 "${sha256}"`);
writeFileSync(join(outDir, 'agent-office.rb'), cask);
console.log(`\n${dmg}\nsha256 ${sha256}\ncask: ${join(outDir, 'agent-office.rb')}`);

if (publish) {
  const tag = `v${version}`;
  // release in bozza (invisibile all'app) finché il cask non è pubblicato: l'app non propone mai una versione
  // che brew non trova ancora
  run('gh', ['release', 'create', tag, dmg, '--repo', TAP, '--draft', '--title', `Agent Office ${version}`, '--notes', `App per la menu bar, versione ${version}.`]);
  const tap = mkdtempSync(join(tmpdir(), 'agent-office-tap-'));
  try {
    run('gh', ['repo', 'clone', TAP, tap]);
    mkdirSync(join(tap, 'Casks'), { recursive: true });
    writeFileSync(join(tap, 'Casks/agent-office.rb'), cask);
    run('git', ['add', 'Casks/agent-office.rb'], { cwd: tap });
    run('git', ['commit', '-m', `agent-office ${version}`], { cwd: tap });
    run('git', ['push'], { cwd: tap });
  } finally {
    rmSync(tap, { recursive: true, force: true });
  }
  run('gh', ['release', 'edit', tag, '--repo', TAP, '--draft=false', '--latest']);
  console.log(`\nPubblicata ${tag}: brew install --cask mccasor/agent-office/agent-office`);
}
