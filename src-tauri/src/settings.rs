//! Finestra Impostazioni (#94), aperta dal pannello ("Impostazioni…", ⌘,): una sola istanza, a schede come le
//! Impostazioni di macOS, larga fissa e alta quanto la scheda mostrata. Il contenuto è `splash/settings.html`, pagina
//! locale che parla con l'app via IPC (`settings_*` in main.rs): funziona anche con il server fermo. Le scelte vanno
//! in config.json (config.rs), da cui il server le riprende da solo.

use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const SETTINGS_ID: &str = "settings";
/// larghezza fissa in punti; l'altezza la chiede la pagina (settings_layout)
const WIDTH: f64 = 600.0;

/// Eventi degli hook di agent-office, come HOOK_EVENTS in src/server/hooks/install.ts: se ne manca qualcuno gli hook
/// sono di una versione vecchia e vanno reinstallati.
const HOOK_EVENTS: [&str; 10] =
    ["SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit", "Notification", "PermissionRequest"];
/// marcatore dei comandi degli hook di agent-office (MARKER in install.ts)
const HOOK_MARKER: &str = "agent-office-hook";

/// Apre la finestra, o la riporta in primo piano se è già aperta.
pub fn open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_ID) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let window = WebviewWindowBuilder::new(app, SETTINGS_ID, WebviewUrl::App("settings.html".into()))
        .title(crate::i18n::t("window.settings"))
        .inner_size(WIDTH, 420.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .build();
    if let Ok(window) = window {
        let _ = window.set_focus();
    }
}

/// I comandi delle impostazioni rispondono solo alla loro finestra (non al pannello né ad altre pagine locali).
pub fn only_settings(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == SETTINGS_ID {
        Ok(())
    } else {
        Err(crate::i18n::t("error.settingsOnly"))
    }
}

/// Riletta dalla pagina (stato degli aggiornamenti, esito degli hook), se è aperta.
pub fn refresh(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_ID) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.eval("window.agentSettingsRefresh?.()");
        }
    }
}

/// Altezza chiesta dalla pagina per la scheda mostrata e titolo della finestra (il nome della scheda, come in macOS).
pub fn layout(window: &WebviewWindow, height: f64, title: &str) {
    let _ = window.set_title(title);
    if height.is_finite() && height > 0.0 {
        crate::cards::fit(window, height.ceil() as u32);
    }
}

fn claude_settings_file() -> Option<PathBuf> {
    let home = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join(".claude")))?;
    Some(home.join("settings.json"))
}

/// Hook di agent-office nelle impostazioni globali di Claude Code: "installed", "outdated" (manca qualche evento),
/// "missing". Pura.
pub fn hooks_status_in(settings: &Value) -> &'static str {
    let ours = |event: &str| {
        settings["hooks"][event].as_array().into_iter().flatten().any(|group| {
            group["hooks"].as_array().into_iter().flatten().any(|h| h["command"].as_str().is_some_and(|c| c.contains(HOOK_MARKER)))
        })
    };
    match HOOK_EVENTS.iter().filter(|e| ours(e)).count() {
        0 => "missing",
        n if n == HOOK_EVENTS.len() => "installed",
        _ => "outdated",
    }
}

/// Stato degli hook globali; "unknown" se il file c'è ma non si legge.
pub fn hooks_status() -> &'static str {
    let Some(file) = claude_settings_file() else { return "unknown" };
    match std::fs::read_to_string(file) {
        Ok(text) => serde_json::from_str::<Value>(&text).map_or("unknown", |v| hooks_status_in(&v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
        Err(_) => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stato_degli_hook() {
        let ours = json!([{ "matcher": "*", "hooks": [{ "type": "command", "command": "'/x/node' '/x/agent-office-hook.mjs' || true" }] }]);
        let all: serde_json::Map<String, Value> = HOOK_EVENTS.iter().map(|e| (e.to_string(), ours.clone())).collect();
        assert_eq!(hooks_status_in(&json!({ "hooks": all })), "installed");
        assert_eq!(hooks_status_in(&json!({ "hooks": { "Stop": ours } })), "outdated");
        assert_eq!(hooks_status_in(&json!({ "hooks": { "Stop": [{ "hooks": [{ "command": "altro" }] }] } })), "missing");
        assert_eq!(hooks_status_in(&json!({ "permissions": {} })), "missing");
        assert_eq!(hooks_status_in(&json!([])), "missing");
    }
}
