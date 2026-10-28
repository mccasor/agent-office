//! Agent Office nella menu bar di macOS: icona (scrivania) con il pallino di stato in basso a destra
//! (verde: Claude lavora, rosso: aspetta un tuo input, grigio: niente di attivo). Al clic un pannello con gli
//! aggiornamenti, lo stato, le istanze di Claude Code con i loro agenti, le impostazioni e l'uscita (panel.rs); le
//! impostazioni stanno in una finestra a sé (settings.rs) e si salvano in ~/.agent-office/config.json (config.rs).
//! Il server Node di agent-office (`--all`) gira in background come processo figlio e chiude con l'app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// Porta dedicata all'app, diversa dal default della CLI (4317) per non scontrarsi con un'istanza da terminale.
const PORT: u16 = 4318;
const TRAY_ID: &str = "status";
const WINDOW_ID: &str = "office";
const POLL: Duration = Duration::from_secs(2);
const LAUNCH_AGENT: &str = "app.agent-office.menubar";

mod cards;
mod config;
mod i18n;
mod instance;
mod notify;
mod panel;
mod server;
mod settings;
mod updates;
use notify::{Alert, AlertFacts, Prefs, SessionFacts};
use server::{find_node, probe, Probe, Supervisor};
use updates::{Upgrade, UpdateState};

/// Server Node: avviato, sorvegliato e terminato all'uscita.
struct Server(Mutex<Supervisor>);

/// Stato mostrato dal pannello oltre allo snapshot, e segnale per aggiornare subito icona e pannello.
struct Ui {
    update: Mutex<UpdateState>,
    /// esito di un'azione (es. installazione degli hook), mostrato nel pannello per NOTICE_FOR
    notice: Mutex<Option<(String, Instant)>>,
    prefs: Mutex<Prefs>,
    /// ultimo snapshot del server, per il pannello
    snapshot: Mutex<Value>,
    /// quando il pannello si è chiuso per perdita del focus (vedi panel::toggle)
    panel_hidden_at: Mutex<Option<Instant>>,
    /// ultima ricerca silenziosa degli aggiornamenti (vedi check_updates_quietly)
    last_quiet_check: Mutex<Option<Instant>>,
    wake: Mutex<Sender<()>>,
}

const NOTICE_FOR: Duration = Duration::from_secs(60);

/// ricerca automatica degli aggiornamenti: poco dopo l'avvio e poi a questo intervallo
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// intervallo minimo tra due ricerche silenziose (apertura del pannello)
const QUIET_CHECK_EVERY: Duration = Duration::from_secs(60);

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

    /// Stato a parole, nella lingua dell'app (i18n.rs).
    fn label(self) -> String {
        i18n::t(match self {
            Status::Working => "tray.working",
            Status::Waiting => "tray.waiting",
            Status::Idle => "tray.idle",
            Status::Offline => "tray.offline",
        })
    }
}

/// Quanto serve all'icona e alle notifiche, ricavato dallo snapshot (che il pannello legge per intero).
#[derive(Clone, PartialEq, Debug)]
struct Overview {
    status: Status,
    /// stato delle sessioni attive per le notifiche
    facts: Vec<SessionFacts>,
    /// subagenti con un avviso, per le notifiche (#100)
    alerts: Vec<AlertFacts>,
    snapshot: Value,
}

impl Overview {
    fn offline() -> Overview {
        Overview { status: Status::Offline, facts: vec![], alerts: vec![], snapshot: Value::Null }
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

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max - 1).collect::<String>())
    }
}

/// Snapshot → stato dell'icona e delle sessioni attive per le notifiche.
fn overview_from(snapshot: &str) -> Overview {
    let Ok(v) = serde_json::from_str::<Value>(snapshot) else {
        return Overview::offline();
    };
    let str_of = |x: &Value, k: &str| x.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let list = |k: &str| v.get(k).and_then(Value::as_array).into_iter().flatten();
    // "progetto · branch": progetto calcolato dal server; senza (cwd assente o server vecchio) l'inizio dell'id
    let place_of = |s: &Value| {
        let project = Some(str_of(s, "project")).filter(|p| !p.is_empty()).unwrap_or_else(|| str_of(s, "id").chars().take(8).collect());
        let branch = str_of(s, "branch");
        if branch.is_empty() { project } else { format!("{project} · {branch}") }
    };
    let facts = list("sessions")
        .filter(|s| s.get("active").and_then(Value::as_bool) == Some(true))
        .map(|s| {
            let waiting = (s.get("waiting").and_then(Value::as_bool) == Some(true))
                .then(|| s.get("waitingKind").and_then(Value::as_str).unwrap_or("input").to_string());
            SessionFacts { id: str_of(s, "id"), place: place_of(s), status: str_of(s, "status"), waiting }
        })
        .collect();
    // avvisi dei subagenti nell'ufficio (#100): nickname e mai la descrizione, che viene dal prompt
    let now = v.get("generatedAt").and_then(Value::as_u64);
    let alerts = list("agents")
        .filter_map(|a| {
            let alert = a.get("alert")?;
            let alert = match alert.get("kind").and_then(Value::as_str)? {
                "stale" => {
                    let since = alert.get("since").and_then(Value::as_u64).unwrap_or(0);
                    Alert::Stale { minutes: now.unwrap_or(since).saturating_sub(since) / 60_000 }
                }
                "loop" => Alert::Loop { tool: str_of(alert, "tool"), count: alert.get("count").and_then(Value::as_u64).unwrap_or(0) },
                _ => return None,
            };
            let session = str_of(a, "sessionId");
            let place = list("sessions").find(|s| str_of(s, "id") == session).map(place_of).unwrap_or_default();
            let name = Some(str_of(a, "nickname")).filter(|n| !n.is_empty()).unwrap_or_else(|| str_of(a, "agentType"));
            Some(AlertFacts { id: str_of(a, "id"), name, place, alert })
        })
        .collect();
    Overview { status: Status::from_str(&str_of(&v, "status")), facts, alerts, snapshot: v }
}

/// Stato dal server; None se lo snapshot non è cambiato dall'ETag indicato (aggiornato in place).
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

/// Icona da aggiornare: al primo giro o se cambiano lo stato o l'aspetto della barra (non a ogni snapshot).
fn icon_changed(last: Option<&(Overview, bool)>, status: Status, dark: bool) -> bool {
    last.is_none_or(|(o, d)| o.status != status || *d != dark)
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
/// In un thread: la ricerca di Node e il comando non bloccano le impostazioni; l'esito compare lì e nel pannello.
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
                // lingue di macOS, come per il server: l'errore della CLI arriva nell'esito nella lingua dell'app (#103)
                .env("AGENT_OFFICE_LANGUAGES", i18n::system_languages().join(","))
                .stdin(Stdio::null())
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                return Ok(());
            }
            let err = String::from_utf8_lossy(&out.stderr);
            Err(err.lines().rev().map(str::trim).find(|l| !l.is_empty()).map_or_else(|| i18n::t("hooks.unknownError"), str::to_string))
        });
        set_notice(&app, match (result, install) {
            (Ok(()), true) => i18n::t("hooks.installed"),
            (Ok(()), false) => i18n::t("hooks.removed"),
            (Err(e), true) => i18n::tf("hooks.installFailed", &[("e", &truncate(&e, 80))]),
            (Err(e), false) => i18n::tf("hooks.removeFailed", &[("e", &truncate(&e, 80))]),
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

/// Mostra la finestra dell'ufficio sulla vista indicata ("pixel" o "list"), evidenziando la sessione `focus`;
/// la crea alla prima apertura (passa dallo splash finché il server non risponde).
fn show_office(app: &AppHandle, view: &str, focus: Option<&str>) {
    // solo id di sessione (lettere, cifre, trattini): nessun rischio di iniettare codice nell'eval
    let focus = focus.filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).unwrap_or("");
    if let Some(window) = app.get_webview_window(WINDOW_ID) {
        // cambio di vista senza ricaricare: l'ufficio resta com'è (posizioni); ricarica solo se serve
        let _ = window.eval(format!(
            "window.agentOfficeFocus ? window.agentOfficeFocus('{view}', '{focus}') : location.assign('http://127.0.0.1:{PORT}/?view={view}&session={focus}')"
        ));
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    // `lang`: lingua dello splash (#93), finché il server non risponde
    let lang = i18n::current().code();
    let url = WebviewUrl::App(format!("index.html?port={PORT}&view={view}&session={focus}&lang={lang}").into());
    let window = WebviewWindowBuilder::new(app, WINDOW_ID, url)
        .title("Agent Office")
        .inner_size(1200.0, 800.0)
        .min_inner_size(480.0, 360.0)
        // schede staccabili (#92): window.open della pagina apre una finestra Tauri dedicata
        .on_new_window(cards::on_new_window(app.clone(), PORT))
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

/// Mostra le notifiche per il passaggio da uno snapshot al successivo.
fn send_notifications(app: &AppHandle, prev: &Overview, next: &Overview) {
    let prefs = *app.state::<Ui>().prefs.lock().unwrap();
    let mut messages = notify::messages(&prev.facts, &next.facts, prefs);
    messages.extend(notify::alert_messages(&prev.alerts, &next.alerts, prefs));
    for (title, body) in messages {
        let _ = app.notification().builder().title(title).body(body).sound("default").show();
    }
}

/// Versione dell'app: quella di package.json, letta da tauri.conf.json in compilazione (Cargo.toml resta fisso).
fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Cerca versioni più recenti (se non è già in corso una ricerca o un aggiornamento).
fn check_updates(app: &AppHandle) {
    if !update_state(app).enabled() {
        return;
    }
    set_update_state(app, UpdateState::Checking);
    let app = app.clone();
    thread::spawn(move || set_update_state(&app, updates::check(&version(&app))));
}

/// Ricerca senza passare da "Ricerca in corso": la sezione dell'aggiornamento nel pannello non sparisce mentre si
/// cerca (vedi UpdateState::after_quiet_check). Al più una ogni QUIET_CHECK_EVERY: l'API di GitHub senza token
/// accetta 60 richieste l'ora.
fn check_updates_quietly(app: &AppHandle) {
    {
        let ui = app.state::<Ui>();
        let mut last = ui.last_quiet_check.lock().unwrap();
        if last.is_some_and(|at| at.elapsed() < QUIET_CHECK_EVERY) || !update_state(app).enabled() {
            return;
        }
        *last = Some(Instant::now());
    }
    let app = app.clone();
    thread::spawn(move || {
        let found = updates::check(&version(&app));
        let next = update_state(&app).after_quiet_check(found);
        if let Some(next) = next {
            set_update_state(&app, next);
        }
    });
}

/// Clic su "Aggiorna" o "Aggiornamenti": con una versione nuova la installa, altrimenti cerca.
fn on_updates_click(app: &AppHandle) {
    let state = update_state(app);
    let Some(latest) = state.target().map(str::to_string) else {
        check_updates(app);
        return;
    };
    set_update_state(app, UpdateState::Upgrading { latest: latest.clone() });
    let app = app.clone();
    thread::spawn(move || match updates::upgrade() {
        // riuscito: si avvia la versione nuova, che chiude questa; se non parte, si ricontrolla
        Upgrade::Brew(mut child) => match child.wait() {
            Ok(status) if status.success() => {
                if !updates::relaunch(&version(&app)) {
                    set_update_state(&app, updates::check(&version(&app)));
                }
            }
            _ => set_update_state(&app, UpdateState::UpgradeFailed { latest }),
        },
        Upgrade::Page => set_update_state(&app, state),
        Upgrade::Failed => set_update_state(&app, UpdateState::UpgradeFailed { latest }),
    });
}

fn update_json(update: &UpdateState, current: &str) -> Value {
    let (kind, latest, behind) = match update {
        UpdateState::Unknown => ("unknown", None, 0),
        UpdateState::Checking => ("checking", None, 0),
        UpdateState::UpToDate => ("uptodate", None, 0),
        UpdateState::Available { latest, behind } => ("available", Some(latest.clone()), *behind),
        UpdateState::Upgrading { latest } => ("upgrading", Some(latest.clone()), 0),
        UpdateState::Failed => ("failed", None, 0),
        UpdateState::UpgradeFailed { latest } => ("upgradefailed", Some(latest.clone()), 0),
    };
    json!({ "kind": kind, "label": update.label(current), "latest": latest, "behind": behind, "outdated": update.badge() == Some(updates::Badge::Outdated) })
}

/// Avviso recente (es. esito degli hook), se non è scaduto.
fn current_notice(ui: &Ui) -> Option<String> {
    ui.notice.lock().unwrap().clone().filter(|(_, at)| at.elapsed() < NOTICE_FOR).map(|(text, _)| text)
}

/// Tutto quello che mostra il pannello: snapshot del server, aggiornamenti, avvisi e le voci da mostrare (`show`).
#[tauri::command]
fn panel_state(app: AppHandle) -> Value {
    let ui = app.state::<Ui>();
    let notice = current_notice(&ui);
    json!({
        "version": version(&app),
        "snapshot": ui.snapshot.lock().unwrap().clone(),
        "serverError": app.state::<Server>().0.lock().unwrap().error(),
        "update": update_json(&ui.update.lock().unwrap(), &version(&app)),
        "notice": notice,
        // lingua già risolta (#93): i testi li prende la pagina (i18n.js)
        "locale": i18n::current().code(),
        // interruttori così come sono nel file: i default li applica la pagina (settings-catalog.js)
        "show": config::read().remove("show").unwrap_or(Value::Null),
    })
}

/// Azioni del pannello; quelle che aprono qualcosa lo chiudono.
#[tauri::command]
fn panel_action(app: AppHandle, action: String, arg: Option<String>) {
    let hide = || {
        if let Some(panel) = app.get_webview_window(panel::PANEL_ID) {
            let _ = panel.hide();
        }
    };
    match action.as_str() {
        "open-office" => {
            hide();
            show_office(&app, "pixel", None);
        }
        "open-session" => {
            hide();
            show_office(&app, "list", arg.as_deref());
        }
        "settings" => {
            hide();
            settings::open(&app);
        }
        "update" => on_updates_click(&app),
        "close" => hide(),
        "quit" => app.exit(0),
        _ => {}
    }
    refresh_panel(&app);
}

/// Il contenuto del pannello chiede l'altezza che gli serve.
#[tauri::command]
fn panel_resize(app: AppHandle, height: f64) {
    if let Some(panel) = app.get_webview_window(panel::PANEL_ID) {
        panel::resize(&panel, height);
    }
}

/// Qualcuno sta lavorando davvero: una sessione attiva al lavoro o in attesa (pallino verde o rosso; il grigio no).
/// Finché è così la composizione dell'ufficio non si cambia (#108), come officeBusy in src/shared/office.ts.
fn office_locked(snapshot: &Value) -> bool {
    snapshot["sessions"].as_array().into_iter().flatten().any(|s| {
        s["active"].as_bool() == Some(true) && matches!(s["dot"].as_str(), Some("working" | "waiting"))
    })
}

/// Stato della finestra Impostazioni: config.json com'è (i default li applica la pagina) e quanto non sta nel file.
#[tauri::command]
fn settings_state(app: AppHandle) -> Value {
    let ui = app.state::<Ui>();
    let office_locked = office_locked(&ui.snapshot.lock().unwrap());
    json!({
        "officeLocked": office_locked,
        "version": version(&app),
        "config": Value::Object(config::read()),
        "autostart": autostart_enabled(),
        "hooks": settings::hooks_status(),
        "update": update_json(&ui.update.lock().unwrap(), &version(&app)),
        "notice": current_notice(&ui),
        "locale": i18n::current().code(),
    })
}

/// Cambia un'impostazione in config.json (chiave e valore validati in config::set). Il server se ne accorge da solo;
/// le notifiche, la lingua (#93) e il pannello qui.
#[tauri::command]
fn settings_set(window: WebviewWindow, app: AppHandle, key: String, value: Value) -> Result<(), String> {
    settings::only_settings(&window)?;
    // l'ufficio non si ricompone mentre gli agenti lavorano (#108): la pagina lo impedisce, qui si ripete
    if key.starts_with("office.") && office_locked(&app.state::<Ui>().snapshot.lock().unwrap()) {
        return Err(i18n::t("office.locked"));
    }
    config::update(|c| config::set(c, &key, value))?;
    if key.starts_with("notify") {
        *app.state::<Ui>().prefs.lock().unwrap() = notify::load();
    }
    if key == "language" {
        i18n::load();
        // tooltip dell'icona subito, senza aspettare il prossimo giro
        let _ = app.state::<Ui>().wake.lock().unwrap().send(());
    }
    refresh_panel(&app);
    Ok(())
}

/// Azioni della finestra Impostazioni che non sono chiavi di config.json.
#[tauri::command]
fn settings_action(window: WebviewWindow, app: AppHandle, action: String) -> Result<(), String> {
    settings::only_settings(&window)?;
    match action.as_str() {
        "autostart" => set_autostart(!autostart_enabled()),
        "hooks-install" => run_hooks(&app, "install-hooks"),
        "hooks-remove" => run_hooks(&app, "uninstall-hooks"),
        "update" => on_updates_click(&app),
        "close" => {
            let _ = window.close();
        }
        _ => return Err(i18n::tf("error.unknownAction", &[("action", &action)])),
    }
    Ok(())
}

/// La pagina delle impostazioni chiede l'altezza della scheda mostrata e ne dà il nome come titolo.
#[tauri::command]
fn settings_layout(window: WebviewWindow, height: f64, title: String) -> Result<(), String> {
    settings::only_settings(&window)?;
    settings::layout(&window, height, &title);
    Ok(())
}

/// Il pannello rilegge lo stato (se è aperto).
fn refresh_panel(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window(panel::PANEL_ID) {
        if panel.is_visible().unwrap_or(false) {
            let _ = panel.eval("window.agentPanelRefresh?.()");
        }
    }
}

fn main() {
    // prima di tutto: il server sulla porta deve essere il nostro, non quello di una copia vecchia
    instance::take_over();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            panel_state,
            panel_action,
            panel_resize,
            settings_state,
            settings_set,
            settings_action,
            settings_layout
        ])
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
            // lingua prima di tutto il resto: pannello, notifiche e tooltip la usano da subito
            i18n::load();
            let (wake, woken) = mpsc::channel::<()>();
            app.manage(Ui {
                update: Mutex::new(UpdateState::Unknown),
                notice: Mutex::new(None),
                prefs: Mutex::new(notify::load()),
                snapshot: Mutex::new(Value::Null),
                panel_hidden_at: Mutex::new(None),
                last_quiet_check: Mutex::new(None),
                wake: Mutex::new(wake),
            });
            panel::create(&handle)?;
            // prima apertura dopo un aggiornamento dal pannello: esito nel pannello e in una notifica
            if let Some(text) = updates::take_updated_from().and_then(|from| updates::updated_message(&from, &version(&handle))) {
                set_notice(&handle, text.clone());
                let _ = handle.notification().builder().title("Agent Office").body(text).show();
            }

            let initial = Overview::offline();
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::from_bytes(initial.status.tray_icon(system_is_dark()))?)
                .icon_as_template(false)
                .tooltip("Agent Office")
                // niente menu nativo: il clic apre il pannello
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { rect, button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        let hidden_at = *app.state::<Ui>().panel_hidden_at.lock().unwrap();
                        // a ogni apertura si cerca un aggiornamento: la sezione compare solo se ce n'è uno davvero
                        if panel::toggle(app, rect, hidden_at) {
                            check_updates_quietly(app);
                        }
                    }
                })
                .build(app)?;

            // ricerca automatica degli aggiornamenti: la sezione compare anche senza aprire il pannello
            let checker = handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(10));
                loop {
                    check_updates_quietly(&checker);
                    thread::sleep(UPDATE_EVERY);
                }
            });

            // ogni POLL (o subito, quando cambia lo stato di aggiornamenti o avvisi): server sorvegliato, notifiche,
            // icona aggiornata solo se cambia e pannello aggiornato se aperto
            let dir = app_dir(&handle);
            thread::spawn(move || {
                let mut last: Option<(Overview, bool)> = None;
                // tooltip mostrato: cambia con lo stato e con la lingua
                let mut tooltip = String::new();
                let mut etag: Option<String> = None;
                // stato delle sessioni e avvisi al giro precedente: al primo snapshot nessuna notifica (non è un
                // cambiamento)
                let mut seen: Option<Overview> = None;
                loop {
                    let status = match http_get("/api/status", None) {
                        Fetched::Body(body, _) => probe(Some(&body)),
                        Fetched::NotModified | Fetched::Other => Probe::Foreign,
                        Fetched::Failed => Probe::Down,
                    };
                    handle.state::<Server>().0.lock().unwrap().tick(&dir, PORT, status);
                    // config.json cambiato a mano, o lingua di macOS cambiata: vale dal giro successivo
                    i18n::load();
                    let dark = dark_menu_bar(&handle);
                    let Some(overview) = fetch_overview(&mut etag).or_else(|| last.as_ref().map(|(o, ..)| o.clone())) else {
                        let _ = woken.recv_timeout(POLL);
                        continue;
                    };
                    if overview.status != Status::Offline {
                        if let Some(prev) = &seen {
                            send_notifications(&handle, prev, &overview);
                        }
                        // senza lo snapshot, che le notifiche non leggono
                        seen = Some(Overview { facts: overview.facts.clone(), alerts: overview.alerts.clone(), ..Overview::offline() });
                    }
                    // l'icona dipende solo da stato e aspetto della barra: non va ridisegnata a ogni snapshot nuovo
                    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                        if icon_changed(last.as_ref(), overview.status, dark) {
                            if let Ok(icon) = Image::from_bytes(overview.status.tray_icon(dark)) {
                                let _ = tray.set_icon(Some(icon));
                                let _ = tray.set_icon_as_template(false);
                            }
                        }
                        let text = format!("Agent Office: {}", overview.status.label());
                        if text != tooltip {
                            let _ = tray.set_tooltip(Some(text.as_str()));
                            tooltip = text;
                        }
                    }
                    let changed = last.as_ref().is_none_or(|(o, d)| *o != overview || *d != dark);
                    if changed {
                        *handle.state::<Ui>().snapshot.lock().unwrap() = overview.snapshot.clone();
                        last = Some((overview, dark));
                    }
                    // pannello e impostazioni aperti rileggono lo stato: cambia anche senza un nuovo snapshot (avvisi,
                    // aggiornamenti, hook)
                    refresh_panel(&handle);
                    settings::refresh(&handle);
                    let _ = woken.recv_timeout(POLL);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // chiudere l'ufficio lo nasconde: l'app resta nella menu bar; le finestre delle schede e le impostazioni si
            // chiudono davvero
            WindowEvent::CloseRequested { api, .. } if !cards::is_card(window.label()) && window.label() != settings::SETTINGS_ID => {
                api.prevent_close();
                let _ = window.hide();
            }
            // il pannello si chiude al clic fuori, come un menu
            WindowEvent::Focused(false) if window.label() == panel::PANEL_ID => {
                let _ = window.hide();
                *window.app_handle().state::<Ui>().panel_hidden_at.lock().unwrap() = Some(Instant::now());
            }
            _ => {}
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
        {"id": "s1", "active": true, "cwd": "/Users/x/agent-office", "project": "agent-office", "branch": "feat/board", "status": "working", "waiting": true, "waitingKind": "permission"},
        {"id": "s2", "active": true, "cwd": "/Users/x/olimpo-ui", "project": "olimpo-ui", "branch": null, "status": "done", "waiting": false},
        {"id": "s3", "active": false, "cwd": "/old", "project": "old", "branch": "main", "status": "done", "waiting": false}
      ],
      "agents": []
    }"#;

    #[test]
    fn ufficio_bloccato_solo_con_sessioni_al_lavoro_o_in_attesa() {
        let snap = |sessions: Value| json!({ "status": "idle", "sessions": sessions, "agents": [] });
        assert!(!office_locked(&Value::Null));
        assert!(!office_locked(&snap(json!([]))));
        assert!(!office_locked(&snap(json!([{ "id": "a", "active": true, "dot": "idle" }]))));
        assert!(!office_locked(&snap(json!([{ "id": "a", "active": false, "dot": "working" }]))));
        assert!(office_locked(&snap(json!([{ "id": "a", "active": true, "dot": "idle" }, { "id": "b", "active": true, "dot": "working" }]))));
        assert!(office_locked(&snap(json!([{ "id": "a", "active": true, "dot": "waiting" }]))));
    }

    #[test]
    fn stato_e_sessioni_attive_dallo_snapshot() {
        let o = overview_from(SNAPSHOT);
        assert_eq!(o.status, Status::Waiting);
        assert_eq!(
            o.facts,
            vec![
                SessionFacts { id: "s1".into(), place: "agent-office · feat/board".into(), status: "working".into(), waiting: Some("permission".into()) },
                SessionFacts { id: "s2".into(), place: "olimpo-ui".into(), status: "done".into(), waiting: None },
            ]
        );
    }

    #[test]
    fn avvisi_dei_subagenti_dallo_snapshot() {
        let o = overview_from(
            r#"{"status":"working","generatedAt":3900000,"sessions":[{"id":"s1","active":true,"project":"agent-office","branch":"main","status":"working"}],
            "agents":[
              {"id":"a1","sessionId":"s1","name":"Testo del prompt","nickname":"Flavia Fetch","agentType":"Explore","alert":{"kind":"stale","since":300000}},
              {"id":"a2","sessionId":"s9","name":"Altro","agentType":"general-purpose","alert":{"kind":"loop","tool":"Bash","count":5}},
              {"id":"a3","sessionId":"s1","nickname":"Leo Lint","alert":null},
              {"id":"a4","sessionId":"s1","nickname":"Ugo Git","alert":{"kind":"nuovo"}}
            ]}"#,
        );
        assert_eq!(
            o.alerts,
            vec![
                AlertFacts { id: "a1".into(), name: "Flavia Fetch".into(), place: "agent-office · main".into(), alert: Alert::Stale { minutes: 60 } },
                // senza nickname (server vecchio) il tipo, mai la descrizione; sessione sconosciuta: nessun luogo
                AlertFacts { id: "a2".into(), name: "general-purpose".into(), place: String::new(), alert: Alert::Loop { tool: "Bash".into(), count: 5 } },
            ]
        );
    }

    #[test]
    fn progetto_assente_inizio_dell_id() {
        let o = overview_from(r#"{"status":"idle","sessions":[{"id":"0123456789ab","active":true,"cwd":"/x/y","project":null,"status":"done"}]}"#);
        assert_eq!(o.facts[0].place, "01234567");
    }

    #[test]
    fn etichette_di_stato() {
        assert_eq!(Status::Idle.label(), "Claude è inattivo");
        assert_eq!(Status::Waiting.label(), "Claude aspetta un tuo input");
    }

    #[test]
    fn snapshot_non_valido_o_vuoto() {
        assert_eq!(overview_from("non json"), Overview::offline());
        let o = overview_from(r#"{"status":"idle","sessions":[],"agents":[]}"#);
        assert_eq!((o.status, o.facts.len()), (Status::Idle, 0));
    }

    #[test]
    fn icona_aggiornata_solo_se_cambiano_stato_o_aspetto() {
        let working = (overview_from(r#"{"status":"working","sessions":[]}"#), false);
        assert!(icon_changed(None, Status::Working, false));
        assert!(!icon_changed(Some(&working), Status::Working, false));
        assert!(icon_changed(Some(&working), Status::Waiting, false));
        assert!(icon_changed(Some(&working), Status::Working, true));
    }

    #[test]
    fn testo_troncato() {
        assert_eq!(truncate("abc", 5), "abc");
        assert_eq!(truncate("abcdefgh", 5), "abcd…");
    }
}
