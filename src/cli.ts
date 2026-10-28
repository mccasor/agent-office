import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  NotAnObjectError,
} from './server/hooks/index.js';
import { displaySettings, loadConfig, systemLanguages, watchConfig, type ServerConfig } from './server/config.js';
import { createRepoPoller } from './server/git/poller.js';
import { folderSources } from './server/git/attribution.js';
import { createGitReports } from './server/git/day.js';
import { buildSnapshot } from './server/state/index.js';
import { agentVerdict, endedCount, lastWrite } from './server/state/verdict.js';
import { createSessionProcesses } from './server/sessions/index.js';
import { createDayTracker } from './server/state/today.js';
import { startServer } from './server/http/index.js';
import { createThrottle } from './server/throttle.js';
import { createHistory } from './server/history/index.js';
import { resolveLocale, setLocale, t } from './shared/i18n/index.js';
import type { Snapshot } from './shared/types.js';

// per bin/agent-office.mjs: l'errore non gestito nella lingua dei messaggi
export { t };

export interface CliOptions {
  command: 'serve' | 'install-hooks' | 'uninstall-hooks' | 'help';
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
/** controllo dei processi di Claude Code (#104): stat dei file di sessione e kill(pid, 0), al più ogni 5 s */
const PROCESS_POLL_MS = 5000;
/** le modifiche arrivano a raffiche (transcript, hook, git): dopo una pausa si pubblica PUBLISH_DELAY_MS dopo la prima */
const PUBLISH_DELAY_MS = 150;
/** sotto carico al più una pubblicazione (SSE, /api/snapshot) ogni PUBLISH_INTERVAL_MS, l'ultima sempre */
const PUBLISH_INTERVAL_MS = 1000;

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
    else if (arg === '--help' || arg === '-h') opts.command = 'help';
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--all' || arg === '--global') opts.all = true;
    else if (arg === '--exit-with-stdin') opts.exitWithStdin = true;
    else if (arg === '--port') {
      const port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(t('cli.badPort', { value: String(argv[i]) }));
      opts.port = port;
    } else if (arg === '--cwd' && argv[i + 1]) opts.cwd = argv[++i]!;
    else throw new Error(`${t('cli.unknownArg', { arg: String(arg) })}\n${t('cli.usage')}`);
  }
  return opts;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

async function serve(opts: CliOptions, config: ServerConfig, dataDir: string | undefined): Promise<RunningOffice> {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const transcript = createTranscriptWatcher({
    cwd: opts.cwd,
    all: opts.all,
    claudeHome,
    activeWindowMs: config.activeWindowMinutes * 60_000,
  });
  const hooks = opts.all ? createAllHookEventsWatcher({ dataDir }) : createHookEventsWatcher({ cwd: opts.cwd, dataDir });
  // stato git: della cartella monitorata, oppure (con --all) della cartella di ciascuna sessione attiva
  const repos = createRepoPoller();
  if (!opts.all) {
    repos.follow([opts.cwd]);
    await repos.poll(Date.now());
  }

  // storico della giornata (#98): attese, cronologia, terminati delle sessioni chiuse, file toccati
  const history = createHistory({
    dir: join(dataDir ?? join(homedir(), '.agent-office'), 'history'),
    filesOf: (sessionId, agentId) => transcript.filesOf(sessionId, agentId),
  });
  // cruscotto della giornata (#97): conteggi dallo storico, costo ripreso da today.json dopo un riavvio (#102)
  const today = createDayTracker(Date.now(), { file: join(dataDir ?? join(homedir(), '.agent-office'), 'today.json') });
  // processi di Claude Code delle sessioni (#104): chi ha chiuso Claude Code non lascia agenti fantasma
  const processes = createSessionProcesses({ dir: join(claudeHome, 'sessions'), minIntervalMs: PROCESS_POLL_MS });
  await Promise.all([transcript.start(), hooks.start(), history.start(), processes.refresh(true)]);
  await today.start();
  const alerts = { staleMs: config.staleAgentMinutes * 60_000, loopRepeats: config.loopRepeats };
  const snapshot = (): Snapshot => {
    const now = Date.now();
    const next = buildSnapshot({
      transcript: transcript.current(),
      hookEvents: hooks.current(),
      repoAt: (cwd) => repos.get(cwd),
      alerts,
      processes: processes.current(),
      now,
    });
    // un confronto con lo stato già registrato a ogni pubblicazione; la lista dei terminati chiusi è in cache
    history.observe(next);
    const closedFinished = history.closedFinished();
    const withToday = { ...next, today: today.observe(next, now, history.counts(now)) };
    return closedFinished ? { ...withToday, closedFinished } : withToday;
  };

  /**
   * "Controlla stato" (#104): rifà subito il controllo dei processi, pubblica se qualcosa è cambiato (un agente chiuso
   * esce dall'ufficio) e dà il verdetto dallo snapshot aggiornato. Dei comandi in background l'mtime dell'output e la
   * riga di fine in coda (#110): quelli già chiusi non contano.
   */
  const checkAgent = async (agentId: string) => {
    if (await processes.refresh(true)) publish();
    const next = snapshot();
    const agent = next.agents.find((a) => a.id === agentId) ?? next.finished?.find((a) => a.id === agentId);
    const bg = agent ? transcript.backgroundOf(agent.sessionId, agent.id) : null;
    const background = bg && { count: Math.max(0, bg.count - (await endedCount(bg.outputs))), lastOutputAt: await lastWrite(bg.outputs) };
    return agentVerdict({ agent, process: agent && processes.get(agent.sessionId), background, now: Date.now() });
  };

  /**
   * Scheda Git (#109): commit del giorno nel repository della sessione, attribuiti con i transcript delle sessioni
   * della sua cartella e dei loro subagenti (anche di quelli già usciti dall'ufficio). Solo a richiesta, mai nel poller.
   */
  const gitReports = createGitReports();
  const gitDay = async (sessionId: string, day: string | null) => {
    const session = transcript.current().sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const path = transcript.transcriptOf(sessionId);
    return gitReports.report(session.cwd ?? (opts.all ? null : opts.cwd), day, async (since) => (path ? folderSources(path, since) : []));
  };

  const first = snapshot();
  const server = await startServer({
    port: opts.port, webDir: WEB_DIR, initial: first, settings: displaySettings(config), history: (day) => history.report(day),
    agentStatus: checkAgent, git: gitDay,
  });

  /** ultimo snapshot pubblicato, serializzato senza generatedAt: il confronto "è cambiato?" */
  let last = '';
  /** ultimo updatedAt visto per sessione: se cambia, il suo repository va riletto */
  const seenAt = new Map<string, number>();
  const publishNow = (next: Snapshot) => {
    const active = next.sessions.filter((s) => s.active && s.cwd);
    if (opts.all) repos.follow(active.map((s) => s.cwd!));
    const ids = new Set<string>();
    for (const s of next.sessions) {
      ids.add(s.id);
      if (seenAt.get(s.id) === s.updatedAt) continue;
      seenAt.set(s.id, s.updatedAt);
      repos.touch(opts.all ? (s.cwd ?? '') : opts.cwd);
    }
    for (const id of seenAt.keys()) if (!ids.has(id)) seenAt.delete(id);
    // una sola serializzazione: senza generatedAt per il confronto, poi lo stesso testo (con generatedAt) ai client
    const { generatedAt, ...rest } = next;
    const body = JSON.stringify(rest);
    if (body === last) return;
    last = body;
    server.publish(next, `${body.slice(0, -1)},"generatedAt":${generatedAt}}`);
  };
  // un solo snapshot (aggregate + buildSnapshot) per pubblicazione, al più uno al secondo sotto carico
  const throttle = createThrottle(() => publishNow(snapshot()), { delayMs: PUBLISH_DELAY_MS, intervalMs: PUBLISH_INTERVAL_MS });
  const publish = () => throttle.schedule();
  const unsubscribe = [transcript.onChange(publish), hooks.onChange(publish)];
  const tick = setInterval(publish, TICK_MS);
  const processPoll = setInterval(() => {
    void processes.refresh().then((changed) => changed && publish(), () => {});
  }, PROCESS_POLL_MS);
  const gitPoll = setInterval(() => {
    void repos.poll(Date.now()).then((changed) => changed && publish());
  }, GIT_POLL_MS);
  publishNow(first);
  // config.json cambiato (finestra Impostazioni dell'app, #94): vale subito, senza riavvio
  const unwatchConfig = await watchConfig(
    (next) => {
      setLocale(resolveLocale(next.language, systemLanguages()));
      transcript.setActiveWindowMs(next.activeWindowMinutes * 60_000);
      Object.assign(alerts, { staleMs: next.staleAgentMinutes * 60_000, loopRepeats: next.loopRepeats });
      server.setSettings(displaySettings(next));
      publish();
    },
    { dataDir, initial: config },
  );

  return {
    url: server.url,
    async close() {
      clearInterval(tick);
      clearInterval(processPoll);
      clearInterval(gitPoll);
      throttle.cancel();
      unwatchConfig();
      unsubscribe.forEach((off) => off());
      await Promise.all([transcript.stop(), hooks.stop()]);
      await Promise.all([server.close(), history.flush(), today.flush()]);
    },
  };
}

/** Impostazioni di Claude Code che non sono un oggetto JSON: l'errore nella lingua dei messaggi (#103). */
const translated = (err: unknown): unknown => (err instanceof NotAnObjectError ? new Error(t('cli.notAnObject', { file: err.file })) : err);

/**
 * Entry point: `agent-office [--port N] [--no-open] [--cwd DIR | --all]` ·
 * `agent-office install-hooks [--global]` · `agent-office uninstall-hooks [--global]` · `agent-office --help`
 */
export async function main(argv: string[]): Promise<RunningOffice | void> {
  const dataDir = process.env.AGENT_OFFICE_DATA_DIR || undefined;
  const config = await loadConfig(dataDir);
  // lingua dei messaggi (#103): quella di config.json, altrimenti quella del sistema (LANG, LC_*, o le lingue di
  // macOS passate dall'app), come per le pagine; vale anche per server.log, che l'app mostra se il server si chiude
  setLocale(resolveLocale(config.language, systemLanguages()));
  const opts = parseArgs(argv, process.cwd());

  if (opts.command === 'help') {
    console.log(`${t('cli.usage')}\n\n${t('cli.help', { port: DEFAULT_PORT })}`);
    return;
  }
  if (opts.command === 'install-hooks') {
    // l'app passa il Node che usa (es. /opt/homebrew/bin/node, stabile tra gli aggiornamenti di brew)
    const command = hookCommand(process.env.AGENT_OFFICE_NODE || process.execPath, HOOK_BIN);
    const { changed, file } = await (opts.all ? installHooksIn(globalSettingsFile(), command) : installHooks(opts.cwd, command)).catch((err) => {
      throw translated(err);
    });
    console.log(t(changed ? 'cli.hooksInstalled' : 'cli.hooksPresent', { file }));
    return;
  }
  if (opts.command === 'uninstall-hooks') {
    const { changed, file } = await (opts.all ? uninstallHooksIn(globalSettingsFile()) : uninstallHooks(opts.cwd)).catch((err) => {
      throw translated(err);
    });
    console.log(changed ? t('cli.hooksRemoved', { file }) : t('cli.noHooks'));
    return;
  }

  const office = await serve(opts, config, dataDir);
  const scope = opts.all ? t('cli.allSessions') : t('cli.watchedFolder', { cwd: opts.cwd });
  console.log(t('cli.serving', { url: office.url, scope }));
  if (opts.open) openBrowser(office.url);
  if (opts.exitWithStdin) {
    // l'app tiene aperta la pipe di stdin finché vive: se termina (anche con un segnale) la pipe si chiude
    process.stdin.on('end', () => void office.close().finally(() => process.exit(0)));
    process.stdin.resume();
  }
  return office;
}
