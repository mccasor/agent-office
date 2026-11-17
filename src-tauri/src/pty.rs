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
//! Solo per lo spike la finestra si apre con la variabile d'ambiente `AGENT_OFFICE_TERMINAL=<cartella>` (e, se c'è,
//! `AGENT_OFFICE_TERMINAL_SESSION=<uuid>` per `--session-id`): la UX vera è #119.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// etichetta della finestra del terminale; per ora una sola (#120 ne aprirà una per istanza, con un suffisso)
pub const TERMINAL_ID: &str = "terminal";
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
    session_id: Option<String>,
    session: Option<Session>,
}

/// Terminali per etichetta di finestra.
#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Entry>>);

pub fn is_terminal(label: &str) -> bool {
    label == TERMINAL_ID
}

/// I comandi `pty_*` rispondono solo alla finestra del terminale (come only_settings in settings.rs).
fn only_terminal(window: &WebviewWindow) -> Result<(), String> {
    if is_terminal(window.label()) {
        Ok(())
    } else {
        Err("command reserved for the terminal window".into())
    }
}

/// Apre la finestra del terminale con `claude` in `cwd` (o la riporta in primo piano se è già aperta).
pub fn open(app: &AppHandle, cwd: PathBuf, session_id: Option<String>) {
    if let Some(window) = app.get_webview_window(TERMINAL_ID) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let session_id = session_id.filter(|s| is_uuid(s));
    let title = format!("Claude · {}", cwd.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    app.state::<Terminals>().0.lock().unwrap().insert(TERMINAL_ID.into(), Entry { cwd, session_id, session: None });
    let window = WebviewWindowBuilder::new(app, TERMINAL_ID, WebviewUrl::App("terminal.html".into()))
        .title(title)
        .inner_size(900.0, 600.0)
        .min_inner_size(400.0, 240.0)
        .center()
        .build();
    if let Ok(window) = window {
        let _ = window.set_focus();
    }
}

/// Solo per lo spike: `AGENT_OFFICE_TERMINAL=<cartella>` all'avvio apre il terminale lì.
pub fn open_from_env(app: &AppHandle) {
    let Some(dir) = std::env::var_os("AGENT_OFFICE_TERMINAL").map(PathBuf::from) else { return };
    let cwd = if dir.is_dir() { dir } else { crate::system::home().unwrap_or_else(|| PathBuf::from("/")) };
    open(app, cwd, std::env::var("AGENT_OFFICE_TERMINAL_SESSION").ok());
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
    let args: Vec<String> = entry.session_id.iter().flat_map(|id| ["--session-id".to_string(), id.clone()]).collect();
    let out = output.clone();
    let session = spawn(
        command(&claude, &args, &entry.cwd, Some(&path)),
        cols,
        rows,
        move |bytes| {
            let _ = out.send(InvokeResponseBody::Raw(bytes.to_vec()));
        },
        move |code| {
            let _ = output.send(InvokeResponseBody::Json(json!({ "exit": code }).to_string()));
        },
    )?;
    entry.session = Some(session);
    Ok(())
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

#[tauri::command]
pub fn pty_kill(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    only_terminal(&window)?;
    if let Some(entry) = app.state::<Terminals>().0.lock().unwrap().get_mut(window.label()) {
        entry.session = None;
    }
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
