//! Agent Office nella menu bar di macOS: icona (scrivania) con il pallino di stato in basso a destra
//! (verde: Claude lavora, rosso: aspetta un tuo input, grigio: niente di attivo). Al clic un menu a tendina con lo
//! stato, l'apertura dell'ufficio, le impostazioni, le istanze di Claude Code e gli agenti attivi.
//! Il server Node di agent-office (`--all`) gira in background come processo figlio e chiude con l'app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{
    CheckMenuItemBuilder, IconMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_notification::NotificationExt;

/// Porta dedicata all'app, diversa dal default della CLI (4317) per non scontrarsi con un'istanza da terminale.
const PORT: u16 = 4318;
const TRAY_ID: &str = "status";
const WINDOW_ID: &str = "office";
const POLL: Duration = Duration::from_secs(2);
const LAUNCH_AGENT: &str = "app.agent-office.menubar";
/// voci al massimo in ciascun sottomenu delle istanze
const MAX_ITEMS: usize = 20;

mod notify;
mod server;
mod updates;
use notify::{Prefs, SessionFacts};
use server::{find_node, probe, Probe, Supervisor};
use updates::{Upgrade, UpdateState};

/// Server Node: avviato, sorvegliato e terminato all'uscita.
struct Server(Mutex<Supervisor>);

/// Stato delle voci del menu che non vengono dal server, e segnale per ridisegnarlo subito quando cambia.
struct Ui {
    update: Mutex<UpdateState>,
    /// esito di un'azione (es. installazione degli hook), mostrato nel menu per NOTICE_FOR
    notice: Mutex<Option<(String, Instant)>>,
    prefs: Mutex<Prefs>,
    wake: Mutex<Sender<()>>,
}

/// Quanto mostra il menu oltre allo snapshot; il menu si ricostruisce quando cambia.
#[derive(Clone, PartialEq, Debug)]
struct Extras {
    update: UpdateState,
    notice: Option<String>,
    server_error: Option<String>,
    prefs: Prefs,
}

const NOTICE_FOR: Duration = Duration::from_secs(60);

/// versione dell'app (Cargo.toml, allineata a package.json e tauri.conf.json da scripts/release.mjs)
const VERSION: &str = env!("CARGO_PKG_VERSION");
/// ricerca automatica degli aggiornamenti: poco dopo l'avvio e poi a questo intervallo
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

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
    /// subagenti non terminati delle sessioni attive (agenti attivi)
    agents: Vec<Entry>,
    /// stato delle sessioni attive per le notifiche
    facts: Vec<SessionFacts>,
}

impl Overview {
    fn offline() -> Overview {
        Overview { status: Status::Offline, sessions: vec![], agents: vec![], facts: vec![] }
    }
}

/// Risposta del server a una GET condizionale.
enum Fetched {
    /// 200: corpo ed ETag
    Body(String, Option<String>),
    /// 304: niente di nuovo dall'ultima volta
    NotModified,
    /// risposta HTTP con un altro codice: sulla porta c'è qualcosa, ma non risponde come il nostro server
    Other,
    /// nessuna risposta
    Failed,
}

/// GET dal server locale in HTTP/1.0 (risposta senza chunking), senza dipendenze. Con `etag` la richiesta è
/// condizionale: se lo snapshot non è cambiato il server risponde 304 senza corpo.
fn http_get(path: &str, etag: Option<&str>) -> Fetched {
    let fetch = || -> Option<Fetched> {
        let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
        let condition = etag.map(|e| format!("If-None-Match: {e}\r\n")).unwrap_or_default();
        let request = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1:{PORT}\r\n{condition}\r\n");
        stream.write_all(request.as_bytes()).ok()?;
        let mut response = String::new();
        stream.read_to_string(&mut response).ok()?;
        let (head, body) = response.split_once("\r\n\r\n").unwrap_or((response.as_str(), ""));
        match head.split(' ').nth(1)? {
            "304" => Some(Fetched::NotModified),
            "200" => {
                let tag = head
                    .lines()
                    .find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("etag")).map(|(_, v)| v.trim().to_string()));
                Some(Fetched::Body(body.to_string(), tag))
            }
            _ => Some(Fetched::Other),
        }
    };
    fetch().unwrap_or(Fetched::Failed)
}

/// Pallini del menu decodificati una volta sola (il menu si ricostruisce a ogni cambio di stato).
fn dot_image(status: Status) -> tauri::Result<Image<'static>> {
    static DOTS: OnceLock<Vec<(Status, Image<'static>)>> = OnceLock::new();
    let dots = DOTS.get_or_init(|| {
        [Status::Working, Status::Waiting, Status::Idle]
            .into_iter()
            .filter_map(|s| Image::from_bytes(s.dot()).ok().map(|img| (s, img)))
            .collect()
    });
    let key = if status == Status::Offline { Status::Idle } else { status };
    match dots.iter().find(|(s, _)| *s == key) {
        Some((_, img)) => Ok(img.clone()),
        None => Image::from_bytes(status.dot()),
    }
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

    let facts = sessions
        .iter()
        .map(|s| {
            let cwd = str_of(s, "cwd");
            let project = cwd.rsplit('/').find(|p| !p.is_empty()).map(str::to_string).unwrap_or_else(|| str_of(s, "id").chars().take(8).collect());
            let branch = str_of(s, "branch");
            let waiting = (s.get("waiting").and_then(Value::as_bool) == Some(true))
                .then(|| s.get("waitingKind").and_then(Value::as_str).unwrap_or("input").to_string());
            SessionFacts {
                id: str_of(s, "id"),
                place: if branch.is_empty() { project } else { format!("{project} · {branch}") },
                status: str_of(s, "status"),
                waiting,
            }
        })
        .collect();
    Overview { status: Status::from_str(&str_of(&v, "status")), sessions: session_entries, agents: agent_entries, facts }
}

/// Stato del menu dal server; None se lo snapshot non è cambiato dall'ETag indicato (aggiornato in place).
fn fetch_overview(etag: &mut Option<String>) -> Option<Overview> {
    match http_get("/api/snapshot", etag.as_deref()) {
        Fetched::NotModified => None,
        Fetched::Body(body, tag) => {
            *etag = tag;
            Some(overview_from(&body))
        }
        Fetched::Other | Fetched::Failed => {
            *etag = None;
            Some(Overview::offline())
        }
    }
}

/// Barra dei menu scura: icona bianca invece che nera. Si legge l'aspetto effettivo del pulsante dell'icona
/// (su macOS 26 la barra è trasparente e segue lo sfondo); se non disponibile, il tema di sistema.
fn dark_menu_bar(handle: &AppHandle) -> bool {
    status_item_is_dark(handle).unwrap_or_else(system_is_dark)
}

#[cfg(target_os = "macos")]
fn status_item_is_dark(handle: &AppHandle) -> Option<bool> {
    let tray = handle.tray_by_id(TRAY_ID)?;
    tray.with_inner_tray_icon(|inner| {
        use objc2_app_kit::{NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua};
        use objc2_foundation::{MainThreadMarker, NSArray};
        let mtm = MainThreadMarker::new()?;
        let button = inner.ns_status_item()?.button(mtm)?;
        // SAFETY: costanti di AppKit, valide per tutta la vita del processo
        let (aqua, dark) = unsafe { (NSAppearanceNameAqua, NSAppearanceNameDarkAqua) };
        let best = button.effectiveAppearance().bestMatchFromAppearancesWithNames(&NSArray::from_slice(&[aqua, dark]))?;
        Some(best.isEqualToString(dark))
    })
    .ok()
    .flatten()
}

#[cfg(not(target_os = "macos"))]
fn status_item_is_dark(_: &AppHandle) -> Option<bool> {
    None
}

fn system_is_dark() -> bool {
    Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Dark"))
        .unwrap_or(false)
}

/// Node ≥ 22: variabile AGENT_OFFICE_NODE, poi Homebrew, poi quello della shell di login (nvm, volta...).
/// Le app avviate dal Finder non ereditano il PATH del terminale.
/// Cartella con bin/ e dist/: le risorse dell'app impacchettata, altrimenti (sviluppo) la root del repository.
fn app_dir(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("app"));
    match bundled {
        Ok(dir) if dir.join("bin/agent-office.mjs").exists() => dir,
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
    }
}

/// Installa o rimuove gli hook globali di Claude Code (servono per il pallino rosso e per stati immediati).
/// In un thread: la ricerca di Node e il comando non bloccano il menu; l'esito compare nel menu.
fn run_hooks(app: &AppHandle, command: &'static str) {
    let app = app.clone();
    thread::spawn(move || {
        let install = command == "install-hooks";
        let result = find_node().and_then(|node| {
            let out = Command::new(&node)
                .arg(app_dir(&app).join("bin/agent-office.mjs"))
                .args([command, "--global"])
                // gli hook useranno lo stesso Node, con percorso assoluto
                .env("AGENT_OFFICE_NODE", &node)
                .stdin(Stdio::null())
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                return Ok(());
            }
            let err = String::from_utf8_lossy(&out.stderr);
            Err(err.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("errore sconosciuto").to_string())
        });
        set_notice(&app, match (result, install) {
            (Ok(()), true) => "Hook di Claude Code installati".into(),
            (Ok(()), false) => "Hook di Claude Code rimossi".into(),
            (Err(e), true) => format!("Installazione degli hook non riuscita: {}", truncate(&e, 80)),
            (Err(e), false) => format!("Rimozione degli hook non riuscita: {}", truncate(&e, 80)),
        });
    });
}

/// Registra il bundle dell'app in LaunchServices e in Spotlight: così compare tra le applicazioni e nella ricerca
/// anche quando è stata spostata o installata da un processo che non lo fa (es. Homebrew in sandbox).
fn register_bundle() {
    let Ok(exe) = std::env::current_exe() else { return };
    // .../Agent Office.app/Contents/MacOS/agent-office-menubar
    let Some(bundle) = exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|e| e == "app")) else { return };
    let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    let quiet = |cmd: &mut Command| {
        let _ = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    };
    quiet(Command::new(lsregister).args(["-f", "-R"]).arg(bundle));
    quiet(Command::new("/usr/bin/mdimport").arg(bundle));
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
        // cambio di vista senza ricaricare: la scena resta com'è (posizioni, post-it); ricarica solo se serve
        let _ = window.eval(format!(
            "window.agentOfficeSetView ? window.agentOfficeSetView('{view}') : location.assign('http://127.0.0.1:{PORT}/?view={view}')"
        ));
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

fn update_state(app: &AppHandle) -> UpdateState {
    app.state::<Ui>().update.lock().unwrap().clone()
}

fn set_update_state(app: &AppHandle, state: UpdateState) {
    let ui = app.state::<Ui>();
    *ui.update.lock().unwrap() = state;
    let _ = ui.wake.lock().unwrap().send(());
}

fn set_notice(app: &AppHandle, text: String) {
    let ui = app.state::<Ui>();
    *ui.notice.lock().unwrap() = Some((text, Instant::now()));
    let _ = ui.wake.lock().unwrap().send(());
}

fn toggle_pref(app: &AppHandle, change: impl FnOnce(&mut Prefs)) {
    let ui = app.state::<Ui>();
    let mut prefs = ui.prefs.lock().unwrap();
    change(&mut prefs);
    notify::save(*prefs);
    let _ = ui.wake.lock().unwrap().send(());
}

/// Mostra le notifiche per il passaggio da uno snapshot al successivo.
fn send_notifications(app: &AppHandle, prev: &[SessionFacts], next: &[SessionFacts]) {
    let prefs = *app.state::<Ui>().prefs.lock().unwrap();
    for (title, body) in notify::messages(prev, next, prefs) {
        let _ = app.notification().builder().title(title).body(body).sound("default").show();
    }
}

fn extras(app: &AppHandle) -> Extras {
    let notice = app.state::<Ui>().notice.lock().unwrap().clone();
    Extras {
        update: update_state(app),
        notice: notice.filter(|(_, at)| at.elapsed() < NOTICE_FOR).map(|(text, _)| text),
        server_error: app.state::<Server>().0.lock().unwrap().error(),
        prefs: *app.state::<Ui>().prefs.lock().unwrap(),
    }
}

/// Cerca versioni più recenti (se non è già in corso una ricerca o un aggiornamento).
fn check_updates(app: &AppHandle) {
    if !update_state(app).enabled() {
        return;
    }
    set_update_state(app, UpdateState::Checking);
    let app = app.clone();
    thread::spawn(move || set_update_state(&app, updates::check(VERSION)));
}

/// Clic su "Aggiornamenti": con una versione nuova la installa, altrimenti cerca.
fn on_updates_click(app: &AppHandle) {
    let state = update_state(app);
    if !matches!(state, UpdateState::Available { .. }) {
        check_updates(app);
        return;
    }
    set_update_state(app, UpdateState::Upgrading);
    let app = app.clone();
    thread::spawn(move || match updates::upgrade() {
        // se riesce brew chiude l'app prima di finire; se l'app è ancora qui l'aggiornamento non è avvenuto
        Upgrade::Brew(mut child) => match child.wait() {
            Ok(status) if status.success() => set_update_state(&app, updates::check(VERSION)),
            _ => set_update_state(&app, UpdateState::UpgradeFailed),
        },
        Upgrade::Page => set_update_state(&app, state),
        Upgrade::Failed => set_update_state(&app, UpdateState::UpgradeFailed),
    });
}

/// Menu a tendina: stato, apri ufficio, impostazioni, aggiornamenti, istanze di Claude Code, agenti attivi, esci.
fn build_menu(app: &AppHandle, o: &Overview, extras: &Extras) -> tauri::Result<Menu<Wry>> {
    let update = &extras.update;
    // server non disponibile: al posto di un generico "non raggiungibile" il motivo (Node mancante, porta occupata…)
    let status_label = match (&extras.server_error, o.status) {
        (Some(error), Status::Offline) => truncate(error, 90),
        _ => o.status.label().to_string(),
    };
    let status = IconMenuItemBuilder::with_id("status", status_label)
        .icon(dot_image(o.status)?)
        .enabled(false)
        .build(app)?;
    let notice = extras.notice.as_deref().map(|text| MenuItemBuilder::new(text).enabled(false).build(app)).transpose()?;
    let open = MenuItemBuilder::with_id("open", "Apri ufficio").build(app)?;

    let settings = SubmenuBuilder::new(app, "Impostazioni")
        .item(&CheckMenuItemBuilder::with_id("autostart", "Avvia al login").checked(autostart_enabled()).build(app)?)
        .separator()
        .item(&CheckMenuItemBuilder::with_id("notify-waiting", "Notifica quando Claude aspetta").checked(extras.prefs.notify_waiting).build(app)?)
        .item(&CheckMenuItemBuilder::with_id("notify-done", "Notifica quando Claude ha finito").checked(extras.prefs.notify_done).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("hooks-install", "Installa gli hook di Claude Code").build(app)?)
        .item(&MenuItemBuilder::with_id("hooks-remove", "Rimuovi gli hook di Claude Code").build(app)?)
        .build()?;

    let label = update.label(VERSION);
    let updates: Box<dyn tauri::menu::IsMenuItem<Wry>> = match update.badge() {
        Some(badge) => Box::new(
            IconMenuItemBuilder::with_id("updates", label).icon(Image::from_bytes(badge.png())?).enabled(update.enabled()).build(app)?,
        ),
        None => Box::new(MenuItemBuilder::with_id("updates", label).enabled(update.enabled()).build(app)?),
    };

    let list = |title: String, entries: &[Entry], empty: &str| -> tauri::Result<_> {
        let mut sub = SubmenuBuilder::new(app, title);
        if entries.is_empty() {
            sub = sub.item(&MenuItemBuilder::new(empty).enabled(false).build(app)?);
        }
        for e in entries {
            sub = sub.item(&IconMenuItemBuilder::with_id(e.id.as_str(), e.label.as_str()).icon(dot_image(e.status)?).build(app)?);
        }
        sub.build()
    };
    let sessions = list(format!("Istanze aperte ({})", o.sessions.len()), &o.sessions, "Nessuna sessione di Claude Code attiva")?;
    let agents = list(format!("Agenti attivi ({})", o.agents.len()), &o.agents, "Nessun agente al lavoro")?;

    let mut menu = MenuBuilder::new(app).item(&status);
    if let Some(notice) = &notice {
        menu = menu.item(notice);
    }
    menu.separator()
        .item(&open)
        .item(&settings)
        .item(updates.as_ref())
        .separator()
        .item(&sessions)
        .item(&agents)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "Esci").build(app)?)
        .build()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Server(Mutex::new(Supervisor::default())))
        .setup(|app| {
            // solo menu bar: niente icona nel Dock
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            // avvio al login già attivo: il LaunchAgent punta all'eseguibile corrente (l'app può essere stata
            // spostata o reinstallata, es. da Homebrew in /Applications)
            if autostart_enabled() {
                set_autostart(true);
            }
            thread::spawn(register_bundle);

            let handle = app.handle().clone();
            let (wake, woken) = mpsc::channel::<()>();
            app.manage(Ui {
                update: Mutex::new(UpdateState::Unknown),
                notice: Mutex::new(None),
                prefs: Mutex::new(notify::load()),
                wake: Mutex::new(wake),
            });

            let initial = Overview::offline();
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::from_bytes(initial.status.tray_icon(system_is_dark()))?)
                .icon_as_template(false)
                .tooltip("Agent Office")
                .menu(&build_menu(&handle, &initial, &extras(&handle))?)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_office(app, "office"),
                    "autostart" => set_autostart(!autostart_enabled()),
                    "hooks-install" => run_hooks(app, "install-hooks"),
                    "hooks-remove" => run_hooks(app, "uninstall-hooks"),
                    "updates" => on_updates_click(app),
                    "notify-waiting" => toggle_pref(app, |p| p.notify_waiting = !p.notify_waiting),
                    "notify-done" => toggle_pref(app, |p| p.notify_done = !p.notify_done),
                    "quit" => app.exit(0),
                    id if id.starts_with("session:") || id.starts_with("agent:") => show_office(app, "list"),
                    _ => {}
                })
                .build(app)?;

            // ricerca automatica degli aggiornamenti: il pallino compare anche senza aprire il menu
            let checker = handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(10));
                loop {
                    check_updates(&checker);
                    thread::sleep(UPDATE_EVERY);
                }
            });

            // ogni POLL (o subito, quando cambia lo stato di aggiornamenti o avvisi): server sorvegliato, poi icona
            // e menu ricostruiti solo se cambia qualcosa
            let dir = app_dir(&handle);
            thread::spawn(move || {
                let mut last: Option<(Overview, bool, Extras)> = None;
                let mut etag: Option<String> = None;
                // stato delle sessioni al giro precedente: al primo snapshot nessuna notifica (non è un cambiamento)
                let mut seen: Option<Vec<SessionFacts>> = None;
                loop {
                    let status = match http_get("/api/status", None) {
                        Fetched::Body(body, _) => probe(Some(&body)),
                        Fetched::NotModified | Fetched::Other => Probe::Foreign,
                        Fetched::Failed => Probe::Down,
                    };
                    handle.state::<Server>().0.lock().unwrap().tick(&dir, PORT, status);
                    let dark = dark_menu_bar(&handle);
                    let extra = extras(&handle);
                    let Some(overview) = fetch_overview(&mut etag).or_else(|| last.as_ref().map(|(o, ..)| o.clone())) else {
                        let _ = woken.recv_timeout(POLL);
                        continue;
                    };
                    if overview.status != Status::Offline {
                        if let Some(prev) = &seen {
                            send_notifications(&handle, prev, &overview.facts);
                        }
                        seen = Some(overview.facts.clone());
                    }
                    let changed = last.as_ref().is_none_or(|(o, d, x)| *o != overview || *d != dark || *x != extra);
                    if changed {
                        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                            if let Ok(icon) = Image::from_bytes(overview.status.tray_icon(dark)) {
                                let _ = tray.set_icon(Some(icon));
                                let _ = tray.set_icon_as_template(false);
                            }
                            let _ = tray.set_tooltip(Some(format!("Agent Office: {}", overview.status.label())));
                            if let Ok(menu) = build_menu(&handle, &overview, &extra) {
                                let _ = tray.set_menu(Some(menu));
                            }
                        }
                        last = Some((overview, dark, extra));
                    }
                    let _ = woken.recv_timeout(POLL);
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
            app.state::<Server>().0.lock().unwrap().stop();
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
