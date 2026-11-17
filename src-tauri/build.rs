/// Comandi dell'app (invoke_handler in main.rs). Con il manifest ogni comando va concesso da una capability
/// (capabilities/*.json, #117); senza, qualunque pagina locale potrebbe chiamarli tutti.
const COMMANDS: &[&str] = &[
    "panel_state",
    "panel_action",
    "panel_resize",
    "settings_state",
    "settings_set",
    "settings_action",
    "settings_layout",
    "settings_role",
    "pty_start",
    "pty_write",
    "pty_resize",
    "pty_kill",
];

fn main() {
    // la versione dell'app viene da package.json (vedi tauri.conf.json): ricompila quando cambia
    println!("cargo:rerun-if-changed=../package.json");
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("failed to run tauri-build");
}
