//! Pannello sotto l'icona della menu bar, al posto del menu nativo (che non permette banner colorati né icone):
//! finestra senza bordi con lo sfondo dei pannelli di macOS (Liquid Glass su macOS 26), chiusa al clic fuori.
//! Il contenuto è `splash/panel.html`, che legge lo stato con `panel_state` e agisce con `panel_action`.

use std::time::{Duration, Instant};

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PANEL_ID: &str = "panel";
/// larghezza del pannello in punti
pub const WIDTH: f64 = 340.0;
const MAX_HEIGHT: f64 = 640.0;
/// un clic sull'icona subito dopo la chiusura per perdita del focus (lo stesso clic) non lo riapre
const REOPEN_GUARD: Duration = Duration::from_millis(300);

/// Crea il pannello (nascosto) all'avvio: alla prima apertura è già pronto.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, PANEL_ID, WebviewUrl::App("panel.html".into()))
        .title("Agent Office")
        .inner_size(WIDTH, 420.0)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .shadow(true)
        .effects(WindowEffectsConfig {
            // Liquid Glass su macOS 26, materiale dei popover sulle versioni precedenti
            effects: vec![Effect::LiquidGlassRegular, Effect::Popover],
            state: Some(EffectState::Active),
            radius: Some(14.0),
            color: None,
            interactive: false,
        })
        .build()
}

/// Apre il pannello centrato sotto l'icona (`icon` = posizione e dimensioni dell'icona), o lo chiude se aperto.
pub fn toggle(app: &AppHandle, icon: Rect, hidden_at: Option<Instant>) {
    let Some(panel) = app.get_webview_window(PANEL_ID) else { return };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    if hidden_at.is_some_and(|at| at.elapsed() < REOPEN_GUARD) {
        return;
    }
    let scale = panel.scale_factor().unwrap_or(1.0);
    let pos = icon.position.to_physical::<f64>(scale);
    let size = icon.size.to_physical::<f64>(scale);
    let width = WIDTH * scale;
    let mut x = pos.x + size.width / 2.0 - width / 2.0;
    // dentro lo schermo, con un piccolo margine
    if let Ok(Some(monitor)) = panel.current_monitor().or_else(|_| panel.primary_monitor()) {
        let left = monitor.position().x as f64 + 8.0 * scale;
        let right = left + monitor.size().width as f64 - width - 16.0 * scale;
        x = x.clamp(left, right.max(left));
    }
    let _ = panel.set_position(PhysicalPosition::new(x, pos.y + size.height + 6.0 * scale));
    let _ = panel.eval("window.agentPanelRefresh?.()");
    let _ = panel.show();
    let _ = panel.set_focus();
}

/// Altezza richiesta dal contenuto (in punti), entro il massimo.
pub fn resize(panel: &WebviewWindow, height: f64) {
    let scale = panel.scale_factor().unwrap_or(1.0);
    let h = height.clamp(120.0, MAX_HEIGHT);
    let _ = panel.set_size(PhysicalSize::new(WIDTH * scale, h * scale));
}
