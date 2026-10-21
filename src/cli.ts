import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RepoState } from './shared/types.js';
import { createTranscriptWatcher } from './server/transcript/index.js';
import { createHookEventsWatcher, installHooks, uninstallHooks } from './server/hooks/index.js';
import { readRepoState } from './server/git/index.js';
import { buildSnapshot } from './server/state/index.js';
import { startServer } from './server/http/index.js';

export interface CliOptions {
  command: 'serve' | 'install-hooks' | 'uninstall-hooks';
  port: number;
  open: boolean;
  cwd: string;
}

export interface RunningOffice {
  url: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4317;
const GIT_POLL_MS = 3000;
/** ricalcolo periodico: gli stati entering/idle/done dipendono dal tempo */
const TICK_MS = 5000;

// risolti rispetto a src/cli.ts (tsx) e a dist/cli.js (build): entrambi puntano alla root del pacchetto
const WEB_DIR = fileURLToPath(new URL('../dist/web', import.meta.url));
const HOOK_BIN = fileURLToPath(new URL('../bin/agent-office-hook.mjs', import.meta.url));

export function parseArgs(argv: string[], cwd: string): CliOptions {
  const opts: CliOptions = { command: 'serve', port: DEFAULT_PORT, open: true, cwd };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'install-hooks' || arg === 'uninstall-hooks') opts.command = arg;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--port') {
      const port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Porta non valida: ${argv[i]}`);
      opts.port = port;
    } else if (arg === '--cwd' && argv[i + 1]) opts.cwd = argv[++i]!;
    else throw new Error(`Argomento sconosciuto: ${arg}\nUso: agent-office [--port N] [--no-open] [--cwd DIR] | install-hooks | uninstall-hooks`);
  }
  return opts;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

async function serve(opts: CliOptions): Promise<RunningOffice> {
  const dataDir = process.env.AGENT_OFFICE_DATA_DIR || undefined;
  const transcript = createTranscriptWatcher({ cwd: opts.cwd, claudeHome: process.env.CLAUDE_CONFIG_DIR || undefined });
  const hooks = createHookEventsWatcher({ cwd: opts.cwd, dataDir });
  let repo: RepoState | null = await readRepoState(opts.cwd);

  await Promise.all([transcript.start(), hooks.start()]);
  const snapshot = () =>
    buildSnapshot({ transcript: transcript.current(), hookEvents: hooks.current(), repo, now: Date.now() });

  const server = await startServer({ port: opts.port, webDir: WEB_DIR, initial: snapshot() });

  let last = '';
  const publish = () => {
    const next = snapshot();
    const key = JSON.stringify({ ...next, generatedAt: 0 });
    if (key === last) return;
    last = key;
    server.publish(next);
  };
  const unsubscribe = [transcript.onChange(publish), hooks.onChange(publish)];
  const tick = setInterval(publish, TICK_MS);
  const gitPoll = setInterval(async () => {
    repo = await readRepoState(opts.cwd);
    publish();
  }, GIT_POLL_MS);

  return {
    url: server.url,
    async close() {
      clearInterval(tick);
      clearInterval(gitPoll);
      unsubscribe.forEach((off) => off());
      await Promise.all([transcript.stop(), hooks.stop()]);
      await server.close();
    },
  };
}

/** Entry point: `agent-office [--port N] [--no-open] [--cwd DIR]` · `agent-office install-hooks` · `agent-office uninstall-hooks` */
export async function main(argv: string[]): Promise<RunningOffice | void> {
  const opts = parseArgs(argv, process.cwd());

  if (opts.command === 'install-hooks') {
    const { changed, file } = await installHooks(opts.cwd, `node "${HOOK_BIN}"`);
    console.log(changed ? `Hook installati in ${file}` : `Hook già presenti in ${file}`);
    return;
  }
  if (opts.command === 'uninstall-hooks') {
    const { changed, file } = await uninstallHooks(opts.cwd);
    console.log(changed ? `Hook rimossi da ${file}` : 'Nessun hook agent-office da rimuovere');
    return;
  }

  const office = await serve(opts);
  console.log(`Agent Office: ${office.url}  (cartella monitorata: ${opts.cwd})`);
  if (opts.open) openBrowser(office.url);
  return office;
}
