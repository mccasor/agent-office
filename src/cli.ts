import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTranscriptWatcher } from './server/transcript/index.js';
import {
  createAllHookEventsWatcher,
  createHookEventsWatcher,
  globalSettingsFile,
  installHooks,
  installHooksIn,
  uninstallHooks,
  uninstallHooksIn,
} from './server/hooks/index.js';
import { createRepoPoller } from './server/git/poller.js';
import { buildSnapshot } from './server/state/index.js';
import { startServer } from './server/http/index.js';

export interface CliOptions {
  command: 'serve' | 'install-hooks' | 'uninstall-hooks';
  port: number;
  open: boolean;
  cwd: string;
  /** tutte le sessioni attive di qualunque cartella (app della menu bar); con install-hooks: hook globali */
  all: boolean;
  /** chiude il server quando si chiude stdin: il processo padre (l'app della menu bar) è terminato */
  exitWithStdin: boolean;
}

export interface RunningOffice {
  url: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4317;
/** giro del poller git: legge solo i repository con attività recente o letture vecchie */
const GIT_POLL_MS = 3000;
/** ricalcolo periodico: gli stati entering/idle/done dipendono dal tempo */
const TICK_MS = 5000;
/** le modifiche arrivano a raffiche (transcript, hook, git): una sola pubblicazione ogni PUBLISH_DELAY_MS */
const PUBLISH_DELAY_MS = 150;

// risolti rispetto a src/cli.ts (tsx) e a dist/cli.js (build): entrambi puntano alla root del pacchetto
const WEB_DIR = fileURLToPath(new URL('../dist/web', import.meta.url));
const HOOK_BIN = fileURLToPath(new URL('../bin/agent-office-hook.mjs', import.meta.url));

/** Argomento per sh tra apici singoli: nessuna espansione di `$`, backtick o virgolette. */
const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Comando degli hook: Node con percorso assoluto (Claude Code esegue gli hook con un PATH che può non contenerlo)
 * e mai un errore se l'app è stata disinstallata senza togliere gli hook.
 */
export function hookCommand(node: string, hookBin: string): string {
  return `[ -f ${shQuote(hookBin)} ] && ${shQuote(node)} ${shQuote(hookBin)} || true`;
}

export function parseArgs(argv: string[], cwd: string): CliOptions {
  const opts: CliOptions = { command: 'serve', port: DEFAULT_PORT, open: true, cwd, all: false, exitWithStdin: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'install-hooks' || arg === 'uninstall-hooks') opts.command = arg;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--all' || arg === '--global') opts.all = true;
    else if (arg === '--exit-with-stdin') opts.exitWithStdin = true;
    else if (arg === '--port') {
      const port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Porta non valida: ${argv[i]}`);
      opts.port = port;
    } else if (arg === '--cwd' && argv[i + 1]) opts.cwd = argv[++i]!;
    else throw new Error(`Argomento sconosciuto: ${arg}\nUso: agent-office [--port N] [--no-open] [--cwd DIR | --all] | install-hooks [--global] | uninstall-hooks [--global]`);
  }
  return opts;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

async function serve(opts: CliOptions): Promise<RunningOffice> {
  const dataDir = process.env.AGENT_OFFICE_DATA_DIR || undefined;
  const transcript = createTranscriptWatcher({ cwd: opts.cwd, all: opts.all, claudeHome: process.env.CLAUDE_CONFIG_DIR || undefined });
  const hooks = opts.all ? createAllHookEventsWatcher({ dataDir }) : createHookEventsWatcher({ cwd: opts.cwd, dataDir });
  // stato git: della cartella monitorata, oppure (con --all) della cartella di ciascuna sessione attiva
  const repos = createRepoPoller();
  if (!opts.all) {
    repos.follow([opts.cwd]);
    await repos.poll(Date.now());
  }

  await Promise.all([transcript.start(), hooks.start()]);
  const snapshot = () =>
    buildSnapshot({
      transcript: transcript.current(),
      hookEvents: hooks.current(),
      repo: opts.all ? null : repos.get(opts.cwd),
      repoAt: (cwd) => repos.get(cwd),
      now: Date.now(),
    });

  const server = await startServer({ port: opts.port, webDir: WEB_DIR, initial: snapshot() });

  let last = '';
  /** ultimo updatedAt visto per sessione: se cambia, il suo repository va riletto */
  const seenAt = new Map<string, number>();
  const publishNow = () => {
    pending = null;
    const next = snapshot();
    const active = next.sessions.filter((s) => s.active && s.cwd);
    if (opts.all) repos.follow(active.map((s) => s.cwd!));
    for (const s of next.sessions) {
      if (seenAt.get(s.id) === s.updatedAt) continue;
      seenAt.set(s.id, s.updatedAt);
      repos.touch(opts.all ? (s.cwd ?? '') : opts.cwd);
    }
    for (const id of seenAt.keys()) if (!next.sessions.some((s) => s.id === id)) seenAt.delete(id);
    const key = JSON.stringify({ ...next, generatedAt: 0 });
    if (key === last) return;
    last = key;
    server.publish(next);
  };
  let pending: NodeJS.Timeout | null = null;
  const publish = () => {
    pending ??= setTimeout(publishNow, PUBLISH_DELAY_MS);
  };
  const unsubscribe = [transcript.onChange(publish), hooks.onChange(publish)];
  const tick = setInterval(publish, TICK_MS);
  const gitPoll = setInterval(() => {
    void repos.poll(Date.now()).then((changed) => changed && publish());
  }, GIT_POLL_MS);
  publishNow();

  return {
    url: server.url,
    async close() {
      clearInterval(tick);
      clearInterval(gitPoll);
      if (pending) clearTimeout(pending);
      unsubscribe.forEach((off) => off());
      await Promise.all([transcript.stop(), hooks.stop()]);
      await server.close();
    },
  };
}

/**
 * Entry point: `agent-office [--port N] [--no-open] [--cwd DIR | --all]` ·
 * `agent-office install-hooks [--global]` · `agent-office uninstall-hooks [--global]`
 */
export async function main(argv: string[]): Promise<RunningOffice | void> {
  const opts = parseArgs(argv, process.cwd());

  if (opts.command === 'install-hooks') {
    // l'app passa il Node che usa (es. /opt/homebrew/bin/node, stabile tra gli aggiornamenti di brew)
    const command = hookCommand(process.env.AGENT_OFFICE_NODE || process.execPath, HOOK_BIN);
    const { changed, file } = opts.all ? await installHooksIn(globalSettingsFile(), command) : await installHooks(opts.cwd, command);
    console.log(changed ? `Hook installati in ${file}` : `Hook già presenti in ${file}`);
    return;
  }
  if (opts.command === 'uninstall-hooks') {
    const { changed, file } = opts.all ? await uninstallHooksIn(globalSettingsFile()) : await uninstallHooks(opts.cwd);
    console.log(changed ? `Hook rimossi da ${file}` : 'Nessun hook agent-office da rimuovere');
    return;
  }

  const office = await serve(opts);
  console.log(`Agent Office: ${office.url}  (${opts.all ? 'tutte le sessioni attive' : `cartella monitorata: ${opts.cwd}`})`);
  if (opts.open) openBrowser(office.url);
  if (opts.exitWithStdin) {
    // l'app tiene aperta la pipe di stdin finché vive: se termina (anche con un segnale) la pipe si chiude
    process.stdin.on('end', () => void office.close().finally(() => process.exit(0)));
    process.stdin.resume();
  }
  return office;
}
