//! Agent Office nella menu bar di macOS: un pallino nella topbar (verde: Claude lavora, rosso: aspetta un tuo
//! input, grigio: niente di attivo) e, al clic, una finestra con l'ufficio 3D e la vista lista.
//! Il server Node di agent-office (`--all`) gira in background come processo figlio e chiude con l'app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Porta dedicata all'app, diversa dal default della CLI (4317) per non scontrarsi con un'istanza da terminale.
const PORT: u16 = 4318;
const TRAY_ID: &str = "status";
const WINDOW_ID: &str = "office";
const POLL: Duration = Duration::from_secs(2);

/// Processo del server, terminato all'uscita.
struct Server(Mutex<Option<Child>>);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Status {
    Working,
    Waiting,
    Idle,
    /// server non raggiungibile: pallino grigio, ma lo si dice nel tooltip
    Offline,
}

impl Status {
    fn icon(self) -> &'static [u8] {
        match self {
            Status::Working => include_bytes!("../icons/tray/working.png"),
            Status::Waiting => include_bytes!("../icons/tray/waiting.png"),
            Status::Idle | Status::Offline => include_bytes!("../icons/tray/idle.png"),
        }
    }

    fn tooltip(self) -> &'static str {
        match self {
            Status::Working => "Agent Office: Claude sta lavorando",
            Status::Waiting => "Agent Office: Claude aspetta un tuo input",
            Status::Idle => "Agent Office: nessuna attività",
            Status::Offline => "Agent Office: server non raggiungibile",
        }
    }
}

/// Legge `status` da GET /api/status del server locale (HTTP minimale, nessuna dipendenza).
fn fetch_status() -> Status {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return Status::Offline;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request = format!("GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return Status::Offline;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() && response.is_empty() {
        return Status::Offline;
    }
    parse_status(&response)
}

fn parse_status(response: &str) -> Status {
    let body = response.split("\r\n\r\n").nth(1).unwrap_or("");
    if body.contains("\"status\":\"waiting\"") {
        Status::Waiting
    } else if body.contains("\"status\":\"working\"") {
        Status::Working
    } else if body.contains("\"status\":\"idle\"") {
        Status::Idle
    } else {
        Status::Offline
    }
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
    if fetch_status() != Status::Offline {
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

/// Installa gli hook globali di Claude Code (servono per il pallino rosso e per stati immediati).
fn install_hooks(app: &AppHandle) {
    if let Some(node) = find_node() {
        let _ = Command::new(node)
            .arg(app_dir(app).join("bin/agent-office.mjs"))
            .args(["install-hooks", "--global"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Mostra la finestra dell'ufficio, creandola alla prima apertura (passa dallo splash finché il server non risponde).
fn show_office(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_ID) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let url = WebviewUrl::App(format!("index.html?port={PORT}").into());
    let window = WebviewWindowBuilder::new(app, WINDOW_ID, url)
        .title("Agent Office")
        .inner_size(1200.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .build();
    if let Ok(window) = window {
        let _ = window.set_focus();
    }
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

            let open = MenuItem::with_id(app, "open", "Apri Agent Office", true, None::<&str>)?;
            let hooks = MenuItem::with_id(app, "hooks", "Installa gli hook di Claude Code", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &hooks, &PredefinedMenuItem::separator(app)?, &quit])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::from_bytes(Status::Offline.icon())?)
                .icon_as_template(false)
                .tooltip(Status::Offline.tooltip())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_office(app),
                    "hooks" => install_hooks(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_office(tray.app_handle());
                    }
                })
                .build(app)?;

            // pallino aggiornato ogni POLL secondi, solo quando lo stato cambia
            thread::spawn(move || {
                let mut last: Option<Status> = None;
                loop {
                    let status = fetch_status();
                    if last != Some(status) {
                        if let (Some(tray), Ok(icon)) = (handle.tray_by_id(TRAY_ID), Image::from_bytes(status.icon())) {
                            let _ = tray.set_icon(Some(icon));
                            let _ = tray.set_icon_as_template(false);
                            let _ = tray.set_tooltip(Some(status.tooltip()));
                        }
                        last = Some(status);
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

    #[test]
    fn stato_dalla_risposta_http() {
        let ok = |body: &str| format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}");
        assert_eq!(parse_status(&ok(r#"{"status":"waiting","activeSessions":1}"#)), Status::Waiting);
        assert_eq!(parse_status(&ok(r#"{"status":"working","activeSessions":2}"#)), Status::Working);
        assert_eq!(parse_status(&ok(r#"{"status":"idle","activeSessions":0}"#)), Status::Idle);
        assert_eq!(parse_status("HTTP/1.1 403 Forbidden\r\n\r\nForbidden"), Status::Offline);
        assert_eq!(parse_status(""), Status::Offline);
    }
}
