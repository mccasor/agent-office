//! Terminale integrato (spike #118, architettura A di #91): `claude` gira in uno pseudo-terminale (portable-pty) e la
//! finestra locale `splash/terminal.html` lo mostra con xterm.js.
//!
//! Privacy: input e output del terminale passano solo per l'IPC tra quella finestra e questo modulo (comandi `pty_*`
//! e un `Channel` verso la sola pagina che ha avviato il processo). Mai dal server Node, mai su disco né nei log: qui
//! non si scrive niente di quello che passa.
//!
//! Il processo muore con la finestra (`forget` su `WindowEvent::Destroyed`) e con l'app (`kill_all` su
//! `RunEvent::Exit`): niente PR_SET_PDEATHSIG su macOS, quindi si segnala tutto il gruppo di processi (il figlio del
//! PTY è capo di sessione e di gruppo) con SIGHUP e, se non basta, SIGKILL.
//!
//! Ciclo di vita (#120): chiudere la finestra la nasconde finché il processo è vivo (la pagina resta, con lo scrollback
//! di xterm solo in memoria) e la riapre l'ufficio con `window.open('http://127.0.0.1:<porta>/?terminal=<uuid>')`
//! (cards.rs, `reveal`). "Termina istanza" nella pagina (`pty_kill`) chiede conferma e chiude la finestra davvero; a
//! processo uscito la finestra si chiude davvero (e se era nascosta si chiude da sola). Uscendo dall'app con istanze
//! ancora in esecuzione si chiede conferma (`must_confirm_quit`, `ask_quit`).
//!
//! "Nuova istanza" (#119, pannello e menu del tray su Linux): cartella scelta con il selettore nativo, modello e
//! modalità dei permessi facoltativi (solo valori di un elenco fisso, mai testo libero), poi `claude --session-id
//! <uuid nuovo>` in una finestra `terminal-<uuid>` sua (più istanze insieme). Ogni processo avviato sta nel registro
//! `~/.agent-office/launched.json` (launched.rs) finché non esce. Per provare senza interfaccia resta
//! `AGENT_OFFICE_TERMINAL=<cartella>` all'avvio (e, se c'è, `AGENT_OFFICE_TERMINAL_SESSION=<uuid>`), che passa di qui.
//!
//! "Riprendi" (#121, resume.rs): `claude --resume <id>` nella cartella della sessione, finestra e registro con lo
//! stesso session id; se la sessione è ancora aperta altrove, su conferma una copia (`--fork-session`) con un session
//! id nuovo passato con `--session-id`.
//!
//! Ruolo (#122, roles.rs): facoltativo, scelto per nome tra i file di `~/.agent-office/roles`; si passa con
//! `--append-system-prompt-file <file>` e si ricorda per session id, così "Riprendi" lo ripassa.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::i18n::{t, tf};
use crate::launched::{Launched, Registry};

/// etichetta della finestra di un terminale: il prefisso e il session id dell'istanza
pub const TERMINAL_PREFIX: &str = "terminal-";
/// modelli ammessi per `--model` (alias della CLI); senza scelta il flag non si passa e vale il default della CLI
pub const MODELS: &[&str] = &["opus", "sonnet", "haiku", "fable"];
/// modalità ammesse per `--permission-mode` (le scelte di `claude --help`); senza scelta vale il default della CLI
pub const PERMISSION_MODES: &[&str] = &["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"];
/// tempo concesso al processo per chiudersi dopo SIGHUP prima di SIGKILL
const GRACE: Duration = Duration::from_millis(1500);
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// marcatore della riga col PATH nell'output della shell di login (prima può esserci il saluto della shell)
const PATH_MARKER: &str = "__AGENT_OFFICE_PATH__=";

/// Un processo in un PTY. Lasciarlo (drop) lo termina.
pub struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    pid: Option<u32>,
    exited: Arc<AtomicBool>,
}

impl Session {
    /// Il processo non è ancora uscito.
    fn running(&self) -> bool {
        !self.exited.load(Ordering::SeqCst)
    }

    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writer.write_all(data).and_then(|_| self.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }

    /// SIGHUP a tutto il gruppo; dopo GRACE, SIGKILL se è ancora vivo. Ritorna l'attesa da fare (in un thread, o qui
    /// all'uscita dall'app); None se il processo è già uscito.
    fn terminate(&self) -> Option<impl FnOnce() + Send + 'static> {
        let (pid, exited) = (self.pid?, self.exited.clone());
        if exited.load(Ordering::SeqCst) {
            return None;
        }
        signal_group(pid, Signal::Hangup);
        Some(move || {
            let start = Instant::now();
            while start.elapsed() < GRACE {
                if exited.load(Ordering::SeqCst) {
                    return;
                }
                thread::sleep(Duration::from_millis(25));
            }
            if !exited.load(Ordering::SeqCst) {
                signal_group(pid, Signal::Kill);
            }
        })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(finish) = self.terminate() {
            thread::spawn(finish);
        }
    }
}

enum Signal {
    Hangup,
    Kill,
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: Signal) {
    let sig = match signal {
        Signal::Hangup => libc::SIGHUP,
        Signal::Kill => libc::SIGKILL,
    };
    // il figlio del PTY ha fatto setsid: il suo pid è anche l'id del gruppo (Bash, MCP… che ha avviato)
    unsafe {
        if libc::killpg(pid as libc::pid_t, sig) != 0 {
            libc::kill(pid as libc::pid_t, sig);
        }
    }
}

#[cfg(not(unix))]
fn signal_group(_pid: u32, _signal: Signal) {}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

/// Avvia `cmd` in un PTY di `cols`×`rows`. L'output arriva a `on_output` (da un thread) così com'è, a pezzi; alla fine
/// `on_exit` riceve il codice d'uscita (None se sconosciuto), dopo l'ultimo output.
pub fn spawn(
    cmd: CommandBuilder,
    cols: u16,
    rows: u16,
    mut on_output: impl FnMut(&[u8]) + Send + 'static,
    on_exit: impl FnOnce(Option<u32>) + Send + 'static,
) -> Result<Session, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // il lato slave resta solo al figlio: quando esce, la lettura del master finisce
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let pid = child.process_id();
    let exited = Arc::new(AtomicBool::new(false));

    let (code_tx, code_rx) = mpsc::channel();
    let flag = exited.clone();
    thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        flag.store(true, Ordering::SeqCst);
        let _ = code_tx.send(code);
    });
    thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => on_output(&buf[..n]),
            }
        }
        // EOF può arrivare prima che wait() ritorni: si aspetta un poco il codice
        on_exit(code_rx.recv_timeout(GRACE).ok().flatten());
    });
    Ok(Session { master: pair.master, writer, pid, exited })
}

/// Esegue un comando aspettandolo al più `timeout` (una shell di login lenta o interattiva non blocca l'app). Come in
/// server.rs.
fn output_with_timeout(cmd: &mut Command, timeout: Duration) -> Option<Output> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if start.elapsed() < timeout => thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// PATH stampato dalla shell di login (riga col marcatore). Pura.
pub fn path_from_output(out: &str) -> Option<String> {
    out.lines().find_map(|l| l.trim().strip_prefix(PATH_MARKER)).map(str::to_string).filter(|p| !p.is_empty())
}

/// Primo `name` eseguibile nelle cartelle di `path`.
pub fn which_in(path: &str, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path).map(|dir| dir.join(name)).find(|p| is_executable(p))
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

/// PATH della shell di login dell'utente: l'app parte da launchd (macOS) o dalla sessione grafica (Linux) con un PATH
/// minimo, senza ~/.local/bin, nvm, Homebrew…
fn login_path() -> Option<String> {
    #[cfg(target_os = "macos")]
    let shell = PathBuf::from("/bin/zsh");
    #[cfg(not(target_os = "macos"))]
    let shell = std::env::var_os("SHELL").map(PathBuf::from).filter(|s| s.is_absolute() && s.exists()).unwrap_or_else(|| PathBuf::from("/bin/bash"));
    let script = format!("printf '\\n{PATH_MARKER}%s\\n' \"$PATH\"");
    let out = output_with_timeout(Command::new(shell).args(["-lic", &script]), PROBE_TIMEOUT)?;
    path_from_output(&String::from_utf8_lossy(&out.stdout))
}

/// `claude` da avviare e il PATH da dargli (Claude Code installato con npm è uno script `node`: gli serve il PATH
/// dell'utente). Ordine: `AGENT_OFFICE_CLAUDE`, PATH della shell di login, posti noti. Trovato una volta resta in
/// memoria.
pub fn find_claude() -> Result<(PathBuf, OsString), String> {
    static FOUND: Mutex<Option<(PathBuf, OsString)>> = Mutex::new(None);
    if let Some(found) = FOUND.lock().unwrap().clone() {
        return Ok(found);
    }
    let login = login_path();
    let current = std::env::var("PATH").unwrap_or_default();
    let mut candidates: Vec<PathBuf> = std::env::var_os("AGENT_OFFICE_CLAUDE").map(PathBuf::from).into_iter().collect();
    candidates.extend(login.as_deref().and_then(|p| which_in(p, "claude")));
    if let Some(home) = crate::system::home() {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
    }
    candidates.extend(["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"].map(PathBuf::from));
    let claude = candidates.into_iter().find(|p| p.is_absolute() && is_executable(p)).ok_or("claude not found")?;
    // la cartella di claude in testa, poi il PATH di login (o quello dell'app)
    let dirs = claude.parent().map(Path::to_path_buf).into_iter().chain(std::env::split_paths(login.as_deref().unwrap_or(&current)));
    let path = std::env::join_paths(dirs).map_err(|e| e.to_string())?;
    *FOUND.lock().unwrap() = Some((claude.clone(), path.clone()));
    Ok((claude, path))
}

/// uuid nella forma 8-4-4-4-12 (cifre esadecimali): l'unico valore accettato per `--session-id`. Pura.
pub fn is_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Comando per `claude` (o `program`) nella cartella `cwd`, con il terminale che si aspetta la sua TUI.
pub fn command(program: &Path, args: &[String], cwd: &Path, path: Option<&OsString>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(path) = path {
        cmd.env("PATH", path);
    }
    // da launchd non c'è una locale: senza UTF-8 unicode e bordi della TUI si rompono
    if ["LC_ALL", "LC_CTYPE", "LANG"].iter().all(|k| std::env::var_os(k).is_none()) {
        cmd.env("LANG", "en_US.UTF-8");
    }
    // l'app avviata da dentro Claude Code (npm run app:dev) non deve far credere a claude di essere annidato
    cmd.env_remove("CLAUDECODE");
    cmd
}

/// Cosa avviare nella finestra (lo decide Rust all'apertura, non la pagina) e il processo, se avviato.
struct Entry {
    cwd: PathBuf,
    session_id: String,
    args: Vec<String>,
    session: Option<Session>,
}

/// Terminali per etichetta di finestra.
#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Entry>>);

/// Opzioni di una nuova istanza; None = flag omesso (default della CLI).
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct LaunchOptions {
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    /// nome di un ruolo (roles.rs), non il suo testo né un percorso
    pub role: Option<String>,
}

/// `value` se è nell'elenco `list`; vuoto o assente → None. Mai testo libero verso la CLI. Pura.
fn allowed(value: Option<&str>, list: &[&str]) -> Result<Option<String>, String> {
    match value.filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(v) if list.contains(&v) => Ok(Some(v.to_string())),
        Some(v) => Err(tf("error.launchOption", &[("value", v)])),
    }
}

impl LaunchOptions {
    /// Opzioni dal pannello: `{"model": "sonnet" | null, "permissionMode": "plan" | null, "role": "<nome>" | null}`
    /// (assente o vuoto → default), validate contro gli elenchi; del ruolo qui si controlla il nome, che il file ci sia
    /// lo vede `launch`. Pura.
    pub fn parse(arg: Option<&str>) -> Result<LaunchOptions, String> {
        let value: Value = match arg {
            Some(text) => serde_json::from_str(text).map_err(|e| e.to_string())?,
            None => Value::Null,
        };
        Ok(LaunchOptions {
            model: allowed(value["model"].as_str(), MODELS)?,
            permission_mode: allowed(value["permissionMode"].as_str(), PERMISSION_MODES)?,
            role: match value["role"].as_str().filter(|r| !r.is_empty()) {
                None => None,
                Some(r) if crate::roles::valid_name(r) => Some(r.to_string()),
                Some(r) => return Err(tf("error.launchOption", &[("value", r)])),
            },
        })
    }
}

/// `--append-system-prompt-file <file>` del ruolo (un file assoluto, già risolto da roles::file), se c'è. Pura.
fn role_args(role_file: Option<&Path>) -> Result<Vec<String>, String> {
    let Some(file) = role_file else { return Ok(vec![]) };
    let file = file.to_str().filter(|_| file.is_absolute()).ok_or_else(|| tf("error.launchOption", &[("value", &file.to_string_lossy())]))?;
    Ok(vec!["--append-system-prompt-file".to_string(), file.to_string()])
}

/// Argomenti di `claude` per l'istanza `session_id` con `options` (rivalidate qui: nessun altro valore arriva alla
/// CLI) e il file del ruolo, se c'è. Pura.
pub fn claude_args(session_id: &str, options: &LaunchOptions, role_file: Option<&Path>) -> Result<Vec<String>, String> {
    if !is_uuid(session_id) {
        return Err(tf("error.launchOption", &[("value", session_id)]));
    }
    let mut args = vec!["--session-id".to_string(), session_id.to_string()];
    if let Some(model) = allowed(options.model.as_deref(), MODELS)? {
        args.extend(["--model".to_string(), model]);
    }
    if let Some(mode) = allowed(options.permission_mode.as_deref(), PERMISSION_MODES)? {
        args.extend(["--permission-mode".to_string(), mode]);
    }
    args.extend(role_args(role_file)?);
    Ok(args)
}

/// Argomenti di `claude` per riprendere la sessione `session_id` (#121): `--resume <id>`; con `fork` (session id
/// nuovo, per la sessione ancora aperta altrove) anche `--fork-session --session-id <fork>`, così il session id della
/// copia è noto prima dell'avvio (finestra, registro). Modello e permessi restano i default della CLI; il ruolo
/// ricordato per la sessione (#122) si ripassa, se il suo file c'è ancora. Pura.
pub fn resume_args(session_id: &str, fork: Option<&str>, role_file: Option<&Path>) -> Result<Vec<String>, String> {
    if let Some(bad) = std::iter::once(session_id).chain(fork).find(|id| !is_uuid(id)) {
        return Err(tf("error.launchOption", &[("value", bad)]));
    }
    let mut args = vec!["--resume".to_string(), session_id.to_string()];
    if let Some(fork) = fork {
        args.extend(["--fork-session".to_string(), "--session-id".to_string(), fork.to_string()]);
    }
    args.extend(role_args(role_file)?);
    Ok(args)
}

/// Session id nuovo (uuid v4) per `--session-id`.
pub fn new_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Etichetta della finestra dell'istanza `session_id`. Pura.
pub fn label_for(session_id: &str) -> String {
    format!("{TERMINAL_PREFIX}{session_id}")
}

/// Finestra di un terminale: `terminal-<uuid>`. Pura.
pub fn is_terminal(label: &str) -> bool {
    label.strip_prefix(TERMINAL_PREFIX).is_some_and(is_uuid)
}

/// I comandi `pty_*` rispondono solo alle finestre dei terminali (come only_settings in settings.rs).
fn only_terminal(window: &WebviewWindow) -> Result<(), String> {
    if is_terminal(window.label()) {
        Ok(())
    } else {
        Err("command reserved for the terminal window".into())
    }
}

/// Nuova istanza: `claude` con un session id nuovo e `options` in `cwd`, nella sua finestra. Il ruolo scelto deve
/// essere uno dei file presenti; si ricorda per la sessione. Ritorna il session id.
pub fn launch(app: &AppHandle, cwd: PathBuf, options: &LaunchOptions) -> Result<String, String> {
    let session_id = new_session_id();
    let role_file = options.role.as_deref().map(crate::roles::file).transpose()?;
    open(app, cwd, &session_id, claude_args(&session_id, options, role_file.as_deref())?)?;
    if let Some(role) = &options.role {
        crate::roles::remember(&session_id, role);
    }
    Ok(session_id)
}

/// Riprende la sessione `session_id` (#121) in `cwd`, nella sua finestra; con `fork` in una copia con un session id
/// nuovo (finestra e registro sono di quella). Ritorna il session id dell'istanza.
pub fn resume(app: &AppHandle, cwd: PathBuf, session_id: &str, fork: bool) -> Result<String, String> {
    let fork_id = fork.then(new_session_id);
    let role = crate::roles::recall(session_id);
    let args = resume_args(session_id, fork_id.as_deref(), role.as_ref().map(|(_, file)| file.as_path()))?;
    open(app, cwd, &fork_id.clone().unwrap_or_else(|| session_id.to_string()), args)?;
    // la copia ha lo stesso ruolo, ricordato col suo session id
    if let (Some(fork_id), Some((role, _))) = (&fork_id, &role) {
        crate::roles::remember(fork_id, role);
    }
    Ok(fork_id.unwrap_or_else(|| session_id.to_string()))
}

/// Apre la finestra dell'istanza `session_id` con `claude` e gli argomenti `args` (già validati) in `cwd`, o la
/// riporta in primo piano se è già aperta.
fn open(app: &AppHandle, cwd: PathBuf, session_id: &str, args: Vec<String>) -> Result<(), String> {
    let label = label_for(session_id);
    if reveal(app, session_id) {
        return Ok(());
    }
    // assoluta: va nel registro, e il server la confronta con quella del transcript
    let cwd = std::fs::canonicalize(&cwd).unwrap_or(cwd);
    let title = format!("Claude · {}", cwd.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let entry = Entry { cwd, session_id: session_id.to_string(), args, session: None };
    app.state::<Terminals>().0.lock().unwrap().insert(label.clone(), entry);
    // `lang`: lingua dei testi della pagina, già risolta (come lo splash)
    let page = format!("terminal.html?lang={}", crate::i18n::current().code());
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 240.0)
        .center()
        .build();
    match window {
        Ok(window) => {
            let _ = window.set_focus();
            Ok(())
        }
        Err(e) => {
            app.state::<Terminals>().0.lock().unwrap().remove(&label);
            Err(e.to_string())
        }
    }
}

/// Per provare senza interfaccia: `AGENT_OFFICE_TERMINAL=<cartella>` all'avvio apre lì un'istanza, con
/// `AGENT_OFFICE_TERMINAL_SESSION=<uuid>` come session id se valido (altrimenti uno nuovo).
pub fn open_from_env(app: &AppHandle) {
    let Some(dir) = std::env::var_os("AGENT_OFFICE_TERMINAL").map(PathBuf::from) else { return };
    let cwd = if dir.is_dir() { dir } else { crate::system::home().unwrap_or_else(|| PathBuf::from("/")) };
    let session_id = std::env::var("AGENT_OFFICE_TERMINAL_SESSION").ok().filter(|s| is_uuid(s)).unwrap_or_else(new_session_id);
    if let Ok(args) = claude_args(&session_id, &LaunchOptions::default(), None) {
        let _ = open(app, cwd, &session_id, args);
    }
}

/// Mostra (anche se nascosta o ridotta) e porta in primo piano la finestra dell'istanza `session_id`, se esiste.
pub fn reveal(app: &AppHandle, session_id: &str) -> bool {
    let label = label_for(session_id);
    if !app.state::<Terminals>().0.lock().unwrap().contains_key(&label) {
        return false;
    }
    let Some(window) = app.get_webview_window(&label) else { return false };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    true
}

/// Il processo della finestra `label` è ancora in esecuzione.
pub fn is_running(app: &AppHandle, label: &str) -> bool {
    app.state::<Terminals>().0.lock().unwrap().get(label).and_then(|e| e.session.as_ref()).is_some_and(Session::running)
}

/// Istanze ancora in esecuzione.
pub fn running_count(app: &AppHandle) -> usize {
    app.state::<Terminals>().0.lock().unwrap().values().filter(|e| e.session.as_ref().is_some_and(Session::running)).count()
}

/// uscita dall'app già confermata: la prossima richiesta d'uscita passa
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
/// dialog di conferma dell'uscita aperto: non se ne apre un secondo
static QUIT_ASKING: AtomicBool = AtomicBool::new(false);

/// All'uscita dall'app (`RunEvent::ExitRequested`, codice `code`) si chiede conferma solo se ci sono `running` istanze
/// in esecuzione e non è già stata data; il riavvio di Tauri non si può fermare. Pura.
pub fn must_confirm_quit(running: usize, confirmed: bool, code: Option<i32>) -> bool {
    running > 0 && !confirmed && code != Some(tauri::RESTART_EXIT_CODE)
}

/// Dialog nativo: quante istanze sono ancora in esecuzione; confermando l'app esce (e `kill_all` le chiude).
pub fn ask_quit(app: &AppHandle, running: usize) {
    if QUIT_ASKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let n = running.to_string();
    let text = if running == 1 { t("terminal.quitRunning.one") } else { tf("terminal.quitRunning.other", &[("n", &n)]) };
    let app2 = app.clone();
    app.dialog()
        .message(text)
        .title("Agent Office")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(t("terminal.quit"), t("terminal.cancel")))
        .show(move |ok| {
            QUIT_ASKING.store(false, Ordering::SeqCst);
            if ok {
                QUIT_CONFIRMED.store(true, Ordering::SeqCst);
                app2.exit(0);
            }
        });
}

/// Uscita dall'app già confermata (o niente da confermare).
pub fn quit_confirmed() -> bool {
    QUIT_CONFIRMED.load(Ordering::SeqCst)
}

/// La finestra è chiusa: il suo processo termina.
pub fn forget(app: &AppHandle, label: &str) {
    let entry = app.state::<Terminals>().0.lock().unwrap().remove(label);
    drop(entry);
}

/// Uscita dall'app: termina tutti i processi e aspetta che escano (al più GRACE ciascuno, in parallelo).
pub fn kill_all(app: &AppHandle) {
    let entries: Vec<Entry> = app.state::<Terminals>().0.lock().unwrap().drain().map(|(_, e)| e).collect();
    let waits: Vec<_> = entries.iter().filter_map(|e| e.session.as_ref()?.terminate()).collect();
    let threads: Vec<_> = waits.into_iter().map(thread::spawn).collect();
    for t in threads {
        let _ = t.join();
    }
    // il drop delle sessioni ora non ha più niente da fare
    drop(entries);
    app.state::<Registry>().clear();
}

/// Avvia `claude` per la finestra (una ricarica della pagina lo riavvia). L'output arriva su `output` come byte
/// (ArrayBuffer nella pagina); alla fine un oggetto `{ exit: codice | null }`.
#[tauri::command]
pub fn pty_start(window: WebviewWindow, app: AppHandle, cols: u16, rows: u16, output: Channel<InvokeResponseBody>) -> Result<(), String> {
    only_terminal(&window)?;
    let label = window.label().to_string();
    // prima del lock: la shell di login può metterci qualche secondo
    let (claude, path) = find_claude()?;
    let terminals = app.state::<Terminals>();
    let mut map = terminals.0.lock().unwrap();
    let entry = map.get_mut(&label).ok_or("terminal not configured")?;
    entry.session = None;
    let out = output.clone();
    // il pid si sa solo dopo l'avvio: all'uscita il processo si toglie dal registro
    let pid_cell = Arc::new(OnceLock::<u32>::new());
    let (exit_pid, exit_app, exit_id) = (pid_cell.clone(), app.clone(), entry.session_id.clone());
    let exit_label = label.clone();
    let session = spawn(
        command(&claude, &entry.args, &entry.cwd, Some(&path)),
        cols,
        rows,
        move |bytes| {
            let _ = out.send(InvokeResponseBody::Raw(bytes.to_vec()));
        },
        move |code| {
            if let Some(pid) = exit_pid.get() {
                exit_app.state::<Registry>().remove(&exit_id, *pid);
            }
            let _ = output.send(InvokeResponseBody::Json(json!({ "exit": code }).to_string()));
            // uscito con la finestra nascosta: nessuno la vedrebbe più, si chiude davvero
            if let Some(window) = exit_app.get_webview_window(&exit_label) {
                if window.is_visible().is_ok_and(|v| !v) {
                    let _ = window.destroy();
                }
            }
        },
    )?;
    if let Some(pid) = session.pid {
        let _ = pid_cell.set(pid);
        let registry = app.state::<Registry>();
        let cwd = entry.cwd.to_string_lossy().into_owned();
        registry.add(Launched { session_id: entry.session_id.clone(), pid, cwd, launched_at: now_ms() });
        // uscito prima che il pid fosse noto: on_exit non l'ha potuto togliere
        if session.exited.load(Ordering::SeqCst) {
            registry.remove(&entry.session_id, pid);
        }
    }
    entry.session = Some(session);
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[tauri::command]
pub fn pty_write(window: WebviewWindow, app: AppHandle, data: String) -> Result<(), String> {
    only_terminal(&window)?;
    let terminals = app.state::<Terminals>();
    let mut map = terminals.0.lock().unwrap();
    map.get_mut(window.label()).and_then(|e| e.session.as_mut()).ok_or("terminal not running")?.write(data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(window: WebviewWindow, app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    only_terminal(&window)?;
    let terminals = app.state::<Terminals>();
    let map = terminals.0.lock().unwrap();
    map.get(window.label()).and_then(|e| e.session.as_ref()).ok_or("terminal not running")?.resize(cols, rows)
}

/// "Termina istanza" (#120): con il processo vivo chiede conferma (dialog nativo sulla finestra), poi chiude la
/// finestra davvero, e la sua chiusura (`forget`) termina il gruppo di processi; a processo uscito la chiude e basta.
#[tauri::command]
pub fn pty_kill(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    only_terminal(&window)?;
    if !is_running(&app, window.label()) {
        return window.destroy().map_err(|e| e.to_string());
    }
    let target = window.clone();
    app.dialog()
        .message(t("terminal.confirmTerminate"))
        .title(t("terminal.terminate"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(t("terminal.terminate"), t("terminal.cancel")))
        .parent(&window)
        .show(move |ok| {
            if ok {
                let _ = target.destroy();
            }
        });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    type Started = (Session, mpsc::Receiver<Vec<u8>>, mpsc::Receiver<Option<u32>>);

    /// Avvia `cmd` in un PTY: output e codice d'uscita arrivano sui due canali.
    fn start(cmd: CommandBuilder, cols: u16, rows: u16) -> Started {
        let (out_tx, out_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();
        let on_output = move |b: &[u8]| {
            let _ = out_tx.send(b.to_vec());
        };
        let on_exit = move |c| {
            let _ = exit_tx.send(c);
        };
        (spawn(cmd, cols, rows, on_output, on_exit).unwrap(), out_rx, exit_rx)
    }

    /// `sh -c script` in un PTY.
    fn run(script: &str, cols: u16, rows: u16) -> Started {
        start(command(Path::new("/bin/sh"), &["-c".into(), script.into()], Path::new("/"), None), cols, rows)
    }

    /// Output raccolto finché contiene `needle` (o fino a 5 s).
    fn read_until(rx: &mpsc::Receiver<Vec<u8>>, needle: &str) -> String {
        let start = Instant::now();
        let mut all = Vec::new();
        while start.elapsed() < Duration::from_secs(5) {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(50)) {
                all.extend(chunk);
            }
            if String::from_utf8_lossy(&all).contains(needle) {
                break;
            }
        }
        String::from_utf8_lossy(&all).into_owned()
    }

    #[test]
    fn output_ed_uscita() {
        let (_s, out, exit) = run("echo ciao-pty; exit 3", 80, 24);
        assert!(read_until(&out, "ciao-pty").contains("ciao-pty"));
        assert_eq!(exit.recv_timeout(Duration::from_secs(5)).unwrap(), Some(3));
    }

    #[test]
    fn terminale_e_locale() {
        let (_s, out, _exit) = run("echo \"term=$TERM utf8=$LANG$LC_ALL$LC_CTYPE\"; [ -t 0 ] && echo tty-si", 80, 24);
        let text = read_until(&out, "tty-si");
        assert!(text.contains("term=xterm-256color"), "{text}");
        assert!(text.contains("UTF-8") || text.contains("utf8"), "{text}");
        assert!(text.contains("tty-si"), "{text}");
    }

    #[test]
    fn input_e_ridimensionamento() {
        let (mut s, out, exit) = run("stty size; read riga; echo \"letto:$riga\"; stty size", 100, 30);
        assert!(read_until(&out, "30 100").contains("30 100"));
        s.resize(120, 40).unwrap();
        s.write(b"\xc3\xa8 \xe2\x9c\x93\r").unwrap();
        let text = read_until(&out, "40 120");
        assert!(text.contains("letto:è ✓"), "{text}");
        assert!(text.contains("40 120"), "{text}");
        assert_eq!(exit.recv_timeout(Duration::from_secs(5)).unwrap(), Some(0));
    }

    #[test]
    fn drop_termina_il_gruppo() {
        // un figlio in background nello stesso gruppo: deve morire anche lui
        let (s, out, exit) = run("sleep 30 & echo \"figlio:$!\"; wait", 80, 24);
        let text = read_until(&out, "figlio:");
        let child: i32 = text.split("figlio:").nth(1).unwrap().split_whitespace().next().unwrap().parse().unwrap();
        let exited = s.exited.clone();
        drop(s);
        assert!(exit.recv_timeout(Duration::from_secs(5)).is_ok());
        assert!(exited.load(Ordering::SeqCst));
        thread::sleep(Duration::from_millis(100));
        assert_ne!(unsafe { libc::kill(child, 0) }, 0, "il figlio {child} è ancora vivo");
    }

    #[test]
    fn sigkill_se_sighup_non_basta() {
        let (s, out, exit) = run("trap '' HUP; echo pronto; while :; do sleep 1; done", 80, 24);
        read_until(&out, "pronto");
        let start = Instant::now();
        drop(s);
        assert!(exit.recv_timeout(Duration::from_secs(5)).is_ok());
        assert!(start.elapsed() >= GRACE - Duration::from_millis(100));
    }

    #[test]
    fn conferma_dell_uscita() {
        // nessuna istanza in esecuzione: si esce subito
        assert!(!must_confirm_quit(0, false, Some(0)));
        assert!(!must_confirm_quit(0, false, None));
        // istanze vive: si chiede, da qualunque parte arrivi l'uscita (pannello, tray, Cmd-Q, ultima finestra)
        assert!(must_confirm_quit(1, false, Some(0)));
        assert!(must_confirm_quit(3, false, None));
        // già confermata: si esce
        assert!(!must_confirm_quit(3, true, Some(0)));
        // il riavvio non si può fermare
        assert!(!must_confirm_quit(2, false, Some(tauri::RESTART_EXIT_CODE)));
    }

    #[test]
    fn processo_vivo_finche_non_esce() {
        let (s, out, exit) = run("echo pronto; read riga", 80, 24);
        read_until(&out, "pronto");
        assert!(s.running());
        let mut s = s;
        s.write(b"\r").unwrap();
        assert!(exit.recv_timeout(Duration::from_secs(5)).is_ok());
        assert!(!s.running());
    }

    #[test]
    fn path_della_shell_di_login() {
        assert_eq!(path_from_output("Benvenuto!\n__AGENT_OFFICE_PATH__=/a:/b\n").as_deref(), Some("/a:/b"));
        assert_eq!(path_from_output("\n__AGENT_OFFICE_PATH__=\n"), None);
        assert_eq!(path_from_output("niente"), None);
    }

    #[test]
    fn which_trova_solo_eseguibili() {
        assert_eq!(which_in("/nonesiste:/bin", "sh"), Some(PathBuf::from("/bin/sh")));
        assert_eq!(which_in("/etc", "hosts"), None);
        assert_eq!(which_in("/bin", "nonesiste-xyz"), None);
    }

    #[test]
    fn uuid_valido() {
        assert!(is_uuid("0f8fad5b-d9cb-469f-a165-70867728950e"));
        assert!(!is_uuid("0f8fad5b-d9cb-469f-a165-70867728950"));
        assert!(!is_uuid("0f8fad5b-d9cb-469f-a165-70867728950e; rm -rf"));
        assert!(!is_uuid(""));
    }

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

    fn options(model: Option<&str>, mode: Option<&str>) -> LaunchOptions {
        LaunchOptions { model: model.map(Into::into), permission_mode: mode.map(Into::into), role: None }
    }

    #[test]
    fn argomenti_di_claude() {
        assert_eq!(claude_args(ID, &LaunchOptions::default(), None).unwrap(), ["--session-id", ID]);
        assert_eq!(claude_args(ID, &options(Some("sonnet"), None), None).unwrap(), ["--session-id", ID, "--model", "sonnet"]);
        assert_eq!(
            claude_args(ID, &options(Some("opus"), Some("plan")), None).unwrap(),
            ["--session-id", ID, "--model", "opus", "--permission-mode", "plan"]
        );
        // vuoto = default della CLI, flag omesso
        assert_eq!(claude_args(ID, &options(Some(""), Some("")), None).unwrap(), ["--session-id", ID]);
    }

    #[test]
    fn argomenti_rifiutati() {
        assert!(claude_args("non-uuid", &LaunchOptions::default(), None).is_err());
        assert!(claude_args(ID, &options(Some("sonnet --dangerously-skip-permissions"), None), None).is_err());
        assert!(claude_args(ID, &options(Some("gpt-4"), None), None).is_err());
        assert!(claude_args(ID, &options(None, Some("yolo")), None).is_err());
        assert!(claude_args(ID, &options(None, Some("PLAN")), None).is_err());
    }

    #[test]
    fn argomenti_per_riprendere() {
        const FORK: &str = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
        assert_eq!(resume_args(ID, None, None).unwrap(), ["--resume", ID]);
        assert_eq!(resume_args(ID, Some(FORK), None).unwrap(), ["--resume", ID, "--fork-session", "--session-id", FORK]);
        // solo uuid, mai testo libero
        assert!(resume_args("non-uuid", None, None).is_err());
        assert!(resume_args(&format!("{ID} --dangerously-skip-permissions"), None, None).is_err());
        assert!(resume_args(ID, Some("--help"), None).is_err());
        assert!(resume_args(ID, Some(""), None).is_err());
    }

    #[test]
    fn opzioni_dal_pannello() {
        assert_eq!(LaunchOptions::parse(None).unwrap(), LaunchOptions::default());
        assert_eq!(LaunchOptions::parse(Some(r#"{"model":null,"permissionMode":""}"#)).unwrap(), LaunchOptions::default());
        assert_eq!(
            LaunchOptions::parse(Some(r#"{"model":"haiku","permissionMode":"acceptEdits"}"#)).unwrap(),
            options(Some("haiku"), Some("acceptEdits"))
        );
        assert!(LaunchOptions::parse(Some(r#"{"model":"--help"}"#)).is_err());
        assert!(LaunchOptions::parse(Some(r#"{"permissionMode":"bypass"}"#)).is_err());
        assert!(LaunchOptions::parse(Some("non json")).is_err());
        // ruolo (#122): solo un nome valido, mai un percorso
        assert_eq!(LaunchOptions::parse(Some(r#"{"role":"Tech Lead"}"#)).unwrap().role.as_deref(), Some("Tech Lead"));
        assert_eq!(LaunchOptions::parse(Some(r#"{"role":""}"#)).unwrap().role, None);
        for bad in [r#"{"role":"../x"}"#, r#"{"role":"/etc/passwd"}"#, r#"{"role":".nascosto"}"#, r#"{"role":"a/b"}"#] {
            assert!(LaunchOptions::parse(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn argomenti_con_il_ruolo() {
        const FORK: &str = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
        let file = Path::new("/home/a/.agent-office/roles/Tech Lead.md");
        let flag = ["--append-system-prompt-file", "/home/a/.agent-office/roles/Tech Lead.md"];
        assert_eq!(claude_args(ID, &LaunchOptions::default(), Some(file)).unwrap(), [&["--session-id", ID][..], &flag].concat());
        assert_eq!(
            claude_args(ID, &options(Some("opus"), None), Some(file)).unwrap(),
            [&["--session-id", ID, "--model", "opus"][..], &flag].concat()
        );
        // resume col ruolo ricordato, anche per la copia
        assert_eq!(resume_args(ID, None, Some(file)).unwrap(), [&["--resume", ID][..], &flag].concat());
        assert_eq!(
            resume_args(ID, Some(FORK), Some(file)).unwrap(),
            [&["--resume", ID, "--fork-session", "--session-id", FORK][..], &flag].concat()
        );
        // solo percorsi assoluti
        assert!(claude_args(ID, &LaunchOptions::default(), Some(Path::new("roles/x.md"))).is_err());
        assert!(resume_args(ID, None, Some(Path::new("x.md"))).is_err());
    }

    #[test]
    fn session_id_nuovo_e_finestra() {
        let (a, b) = (new_session_id(), new_session_id());
        assert!(is_uuid(&a) && a != b);
        // versione 4
        assert_eq!(a.as_bytes()[14], b'4');
        assert_eq!(label_for(&a), format!("terminal-{a}"));
        assert!(is_terminal(&label_for(&a)));
        assert!(!is_terminal("terminal"));
        assert!(!is_terminal("terminal-x"));
        assert!(!is_terminal("panel"));
        assert!(!is_terminal(&format!("card-{a}")));
    }

    /// Claude Code vero nel PTY (se installato): stampa la versione.
    #[test]
    fn claude_version_nel_pty() {
        let Ok((claude, path)) = find_claude() else { return eprintln!("claude non trovato: salto") };
        let (_s, out_rx, exit_rx) = start(command(&claude, &["--version".into()], Path::new("/"), Some(&path)), 80, 24);
        let text = read_until(&out_rx, "Claude Code");
        eprintln!("{} --version nel PTY: {}", claude.display(), text.trim());
        assert!(text.contains("Claude Code"), "{text}");
        assert_eq!(exit_rx.recv_timeout(Duration::from_secs(10)).unwrap(), Some(0));
    }
}
