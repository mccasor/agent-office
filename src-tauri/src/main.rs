//! Agent Office nella menu bar di macOS: icona (scrivania) con il pallino di stato in basso a destra
//! (verde: Claude lavora, rosso: aspetta un tuo input, grigio: niente di attivo). Al clic un menu a tendina con lo
//! stato, l'apertura dell'ufficio, le impostazioni, le istanze di Claude Code e gli agenti IA aperti.
//! Il server Node di agent-office (`--all`) gira in background come processo figlio e chiude con l'app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{
    CheckMenuItemBuilder, IconMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};

/// Porta dedicata all'app, diversa dal default della CLI (4317) per non scontrarsi con un'istanza da terminale.
const PORT: u16 = 4318;
const TRAY_ID: &str = "status";
const WINDOW_ID: &str = "office";
const POLL: Duration = Duration::from_secs(2);
/// il tema della barra (chiaro/scuro) si ricontrolla ogni N giri
const THEME_EVERY: u32 = 5;
const LAUNCH_AGENT: &str = "app.agent-office.menubar";
/// voci al massimo in ciascun sottomenu delle istanze
const MAX_ITEMS: usize = 20;

/// Processo del server, terminato all'uscita.
struct Server(Mutex<Option<Child>>);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
    Idle,
    /// server non raggiungibile: pallino grigio, ma lo si dice nel menu
    Offline,
}

impl Status {
    fn from_str(s: &str) -> Status {
        match s {
            "waiting" => Status::Waiting,
            "working" | "entering" => Status::Working,
            _ => Status::Idle,
        }
    }

    fn tray_icon(self, dark: bool) -> &'static [u8] {
        match (self, dark) {
            (Status::Working, false) => include_bytes!("../icons/tray/light-working.png"),
            (Status::Waiting, false) => include_bytes!("../icons/tray/light-waiting.png"),
            (Status::Idle | Status::Offline, false) => include_bytes!("../icons/tray/light-idle.png"),
            (Status::Working, true) => include_bytes!("../icons/tray/dark-working.png"),
            (Status::Waiting, true) => include_bytes!("../icons/tray/dark-waiting.png"),
            (Status::Idle | Status::Offline, true) => include_bytes!("../icons/tray/dark-idle.png"),
        }
    }

    fn dot(self) -> &'static [u8] {
        match self {
            Status::Working => include_bytes!("../icons/tray/dot-working.png"),
            Status::Waiting => include_bytes!("../icons/tray/dot-waiting.png"),
            Status::Idle | Status::Offline => include_bytes!("../icons/tray/dot-idle.png"),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Status::Working => "Claude sta lavorando",
            Status::Waiting => "Claude aspetta un tuo input",
            Status::Idle => "Nessuna attività",
            Status::Offline => "Server non raggiungibile",
        }
    }
}

/// Voce di un sottomenu: id dell'evento, testo e colore del pallino.
#[derive(Clone, PartialEq, Debug)]
struct Entry {
    id: String,
    label: String,
    status: Status,
}

/// Quanto serve al menu, ricavato dallo snapshot; il menu si ricostruisce solo quando cambia.
#[derive(Clone, PartialEq, Debug)]
struct Overview {
    status: Status,
    /// sessioni di Claude Code attive (istanze aperte)
    sessions: Vec<Entry>,
    /// subagenti non terminati delle sessioni attive (istanze IA aperte)
    agents: Vec<Entry>,
}

impl Overview {
    fn offline() -> Overview {
        Overview { status: Status::Offline, sessions: vec![], agents: vec![] }
    }
}

/// GET dal server locale in HTTP/1.0 (risposta senza chunking), senza dipendenze.
fn http_get(path: &str) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let request = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1:{PORT}\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let (head, body) = response.split_once("\r\n\r\n")?;
    (head.split(' ').nth(1) == Some("200")).then(|| body.to_string())
}

fn issues_text(v: &Value) -> String {
    v.get("issues")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_u64).map(|n| format!(" #{n}")).collect())
        .unwrap_or_default()
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max - 1).collect::<String>())
    }
}

/// Snapshot → stato del menu. Stessa regola del pallino della vista lista per ogni sessione.
fn overview_from(snapshot: &str) -> Overview {
    let Ok(v) = serde_json::from_str::<Value>(snapshot) else {
        return Overview::offline();
    };
    let str_of = |x: &Value, k: &str| x.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let empty = vec![];
    let agents = v.get("agents").and_then(Value::as_array).unwrap_or(&empty);
    let sessions: Vec<&Value> = v
        .get("sessions")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
        .iter()
        .filter(|s| s.get("active").and_then(Value::as_bool) == Some(true))
        .collect();
    let busy = |st: &str| st == "working" || st == "entering";

    let session_entries = sessions
        .iter()
        .take(MAX_ITEMS)
        .map(|s| {
            let id = str_of(s, "id");
            let own_busy = agents.iter().any(|a| str_of(a, "sessionId") == id && busy(&str_of(a, "status")));
            let status = if s.get("waiting").and_then(Value::as_bool) == Some(true) {
                Status::Waiting
            } else if busy(&str_of(s, "status")) || own_busy {
                Status::Working
            } else {
                Status::Idle
            };
            let cwd = str_of(s, "cwd");
            let project = cwd.rsplit('/').find(|p| !p.is_empty()).map(str::to_string).unwrap_or_else(|| id.chars().take(8).collect());
            let branch = str_of(s, "branch");
            let label = if branch.is_empty() { project } else { format!("{project} · {branch}") };
            Entry { id: format!("session:{id}"), label: truncate(&format!("{label}{}", issues_text(s)), 60), status }
        })
        .collect();

    let active_ids: Vec<String> = sessions.iter().map(|s| str_of(s, "id")).collect();
    let agent_entries = agents
        .iter()
        .filter(|a| active_ids.contains(&str_of(a, "sessionId")) && str_of(a, "status") != "done")
        .take(MAX_ITEMS)
        .map(|a| {
            let state = str_of(a, "status");
            let label = format!("{}{}", str_of(a, "name"), issues_text(a));
            Entry { id: format!("agent:{}", str_of(a, "id")), label: truncate(&label, 60), status: Status::from_str(&state) }
        })
        .collect();

    Overview { status: Status::from_str(&str_of(&v, "status")), sessions: session_entries, agents: agent_entries }
}

fn fetch_overview() -> Overview {
    http_get("/api/snapshot").map(|body| overview_from(&body)).unwrap_or_else(Overview::offline)
}

/// Barra dei menu scura (tema scuro di macOS): icona bianca invece che nera.
fn dark_menu_bar() -> bool {
    Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Dark"))
        .unwrap_or(false)
}

/// Node ≥ 22: variabile AGENT_OFFICE_NODE, poi Homebrew, poi quello della shell di login (nvm, volta...).
/// Le app avviate dal Finder non ereditano il PATH del terminale.
fn find_node() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("AGENT_OFFICE_NODE").map(PathBuf::from).filter(|p| p.exists()) {
        return Some(p);
    }
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if Path::new(p).exists() {
            return Some(PathBuf::from(p));
        }
    }
    let out = Command::new("/bin/zsh").args(["-lic", "command -v node"]).stderr(Stdio::null()).output().ok()?;
    let path = String::from_utf8_lossy(&out.stdout).lines().last()?.trim().to_string();
    Some(PathBuf::from(path)).filter(|p| p.is_absolute() && p.exists())
}

/// Cartella con bin/ e dist/: le risorse dell'app impacchettata, altrimenti (sviluppo) la root del repository.
fn app_dir(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("app"));
    match bundled {
        Ok(dir) if dir.join("bin/agent-office.mjs").exists() => dir,
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
    }
}

fn start_server(app: &AppHandle) -> Option<Child> {
    if http_get("/api/status").is_some() {
        return None; // già in esecuzione (es. un'altra istanza): lo si usa così com'è
    }
    let node = find_node()?;
    Command::new(node)
        .arg(app_dir(app).join("bin/agent-office.mjs"))
        .args(["--all", "--no-open", "--exit-with-stdin", "--port", &PORT.to_string()])
        // pipe tenuta aperta dall'app: se l'app termina in qualunque modo il server si chiude da solo
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

/// Installa o rimuove gli hook globali di Claude Code (servono per il pallino rosso e per stati immediati).
fn run_hooks(app: &AppHandle, command: &str) {
    if let Some(node) = find_node() {
        let _ = Command::new(node)
            .arg(app_dir(app).join("bin/agent-office.mjs"))
            .args([command, "--global"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn launch_agent_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/LaunchAgents").join(format!("{LAUNCH_AGENT}.plist")))
}

fn autostart_enabled() -> bool {
    launch_agent_path().is_some_and(|p| p.exists())
}

/// Avvio al login con un LaunchAgent dell'utente che lancia l'eseguibile dell'app.
fn set_autostart(enabled: bool) {
    let (Some(path), Ok(exe)) = (launch_agent_path(), std::env::current_exe()) else {
        return;
    };
    if !enabled {
        let _ = std::fs::remove_file(path);
        return;
    }
    let exe = exe.to_string_lossy().replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let plist = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
         <key>Label</key><string>{LAUNCH_AGENT}</string>\n\
         <key>ProgramArguments</key><array><string>{exe}</string></array>\n\
         <key>RunAtLoad</key><true/>\n\
         </dict></plist>\n"
    );
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, plist);
}

/// Mostra la finestra dell'ufficio sulla vista indicata ("office" o "list"), creandola alla prima apertura
/// (passa dallo splash finché il server non risponde).
fn show_office(app: &AppHandle, view: &str) {
    if let Some(window) = app.get_webview_window(WINDOW_ID) {
        if let Ok(url) = format!("http://127.0.0.1:{PORT}/?view={view}").parse() {
            let _ = window.navigate(url);
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let url = WebviewUrl::App(format!("index.html?port={PORT}&view={view}").into());
    let window = WebviewWindowBuilder::new(app, WINDOW_ID, url)
        .title("Agent Office")
        .inner_size(1200.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .build();
    if let Ok(window) = window {
        let _ = window.set_focus();
    }
}

/// Menu a tendina: stato, apri ufficio, impostazioni, istanze di Claude Code, agenti IA, esci.
fn build_menu(app: &AppHandle, o: &Overview) -> tauri::Result<Menu<Wry>> {
    let status = IconMenuItemBuilder::with_id("status", o.status.label())
        .icon(Image::from_bytes(o.status.dot())?)
        .enabled(false)
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Apri ufficio").build(app)?;

    let settings = SubmenuBuilder::new(app, "Impostazioni")
        .item(&CheckMenuItemBuilder::with_id("autostart", "Avvia al login").checked(autostart_enabled()).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("hooks-install", "Installa gli hook di Claude Code").build(app)?)
        .item(&MenuItemBuilder::with_id("hooks-remove", "Rimuovi gli hook di Claude Code").build(app)?)
        .build()?;

    let list = |title: String, entries: &[Entry], empty: &str| -> tauri::Result<_> {
        let mut sub = SubmenuBuilder::new(app, title);
        if entries.is_empty() {
            sub = sub.item(&MenuItemBuilder::new(empty).enabled(false).build(app)?);
        }
        for e in entries {
            sub = sub.item(&IconMenuItemBuilder::with_id(e.id.as_str(), e.label.as_str()).icon(Image::from_bytes(e.status.dot())?).build(app)?);
        }
        sub.build()
    };
    let sessions = list(format!("Istanze aperte ({})", o.sessions.len()), &o.sessions, "Nessuna sessione di Claude Code attiva")?;
    let agents = list(format!("Istanze IA aperte ({})", o.agents.len()), &o.agents, "Nessun agente al lavoro")?;

    MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&open)
        .item(&settings)
        .separator()
        .item(&sessions)
        .item(&agents)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "Esci").build(app)?)
        .build()
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            // solo menu bar: niente icona nel Dock
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            *app.state::<Server>().0.lock().unwrap() = start_server(&handle);

            let initial = Overview::offline();
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::from_bytes(initial.status.tray_icon(dark_menu_bar()))?)
                .icon_as_template(false)
                .tooltip("Agent Office")
                .menu(&build_menu(&handle, &initial)?)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_office(app, "office"),
                    "autostart" => set_autostart(!autostart_enabled()),
                    "hooks-install" => run_hooks(app, "install-hooks"),
                    "hooks-remove" => run_hooks(app, "uninstall-hooks"),
                    "quit" => app.exit(0),
                    id if id.starts_with("session:") || id.starts_with("agent:") => show_office(app, "list"),
                    _ => {}
                })
                .build(app)?;

            // icona e menu aggiornati ogni POLL, solo quando cambia qualcosa
            thread::spawn(move || {
                let mut last: Option<(Overview, bool)> = None;
                let mut dark = dark_menu_bar();
                for tick in 1u32.. {
                    if tick % THEME_EVERY == 0 {
                        dark = dark_menu_bar();
                    }
                    let overview = fetch_overview();
                    let changed = last.as_ref().is_none_or(|(o, d)| *o != overview || *d != dark);
                    if changed {
                        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                            if let Ok(icon) = Image::from_bytes(overview.status.tray_icon(dark)) {
                                let _ = tray.set_icon(Some(icon));
                                let _ = tray.set_icon_as_template(false);
                            }
                            let _ = tray.set_tooltip(Some(format!("Agent Office: {}", overview.status.label())));
                            if let Ok(menu) = build_menu(&handle, &overview) {
                                let _ = tray.set_menu(Some(menu));
                            }
                        }
                        last = Some((overview, dark));
                    }
                    thread::sleep(POLL);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // chiudere la finestra la nasconde: l'app resta nella menu bar
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("avvio di Agent Office");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNAPSHOT: &str = r#"{
      "status": "waiting",
      "sessions": [
        {"id": "s1", "active": true, "cwd": "/Users/x/agent-office", "branch": "feat/board", "status": "done", "waiting": true, "issues": [14]},
        {"id": "s2", "active": true, "cwd": "/Users/x/olimpo-ui", "branch": null, "status": "done", "waiting": false, "issues": []},
        {"id": "s3", "active": false, "cwd": "/old", "branch": "main", "status": "done", "waiting": false, "issues": []}
      ],
      "agents": [
        {"id": "a1", "sessionId": "s2", "name": "Build HUD panel", "status": "working", "issues": [22]},
        {"id": "a2", "sessionId": "s2", "name": "Survey", "status": "done", "issues": []},
        {"id": "a3", "sessionId": "s3", "name": "Vecchio", "status": "working", "issues": []}
      ]
    }"#;

    #[test]
    fn menu_dallo_snapshot() {
        let o = overview_from(SNAPSHOT);
        assert_eq!(o.status, Status::Waiting);
        assert_eq!(
            o.sessions,
            vec![
                Entry { id: "session:s1".into(), label: "agent-office · feat/board #14".into(), status: Status::Waiting },
                Entry { id: "session:s2".into(), label: "olimpo-ui".into(), status: Status::Working },
            ]
        );
        assert_eq!(o.agents, vec![Entry { id: "agent:a1".into(), label: "Build HUD panel #22".into(), status: Status::Working }]);
    }

    #[test]
    fn snapshot_non_valido_o_vuoto() {
        assert_eq!(overview_from("non json"), Overview::offline());
        let o = overview_from(r#"{"status":"idle","sessions":[],"agents":[]}"#);
        assert_eq!((o.status, o.sessions.len(), o.agents.len()), (Status::Idle, 0, 0));
    }

    #[test]
    fn testo_troncato() {
        assert_eq!(truncate("abc", 5), "abc");
        assert_eq!(truncate("abcdefgh", 5), "abcd…");
    }
}
