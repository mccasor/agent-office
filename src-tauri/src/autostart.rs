//! Avvio al login: su macOS un LaunchAgent dell'utente, su Linux una voce in `~/.config/autostart` (specifica XDG
//! Autostart, la seguono GNOME, KDE, Xfce e gli altri desktop). In entrambi i casi lancia l'eseguibile corrente.

use std::path::PathBuf;

#[cfg(target_os = "macos")]
const LAUNCH_AGENT: &str = "app.agent-office.menubar";

#[cfg(target_os = "macos")]
fn path() -> Option<PathBuf> {
    crate::system::home().map(|h| h.join("Library/LaunchAgents").join(format!("{LAUNCH_AGENT}.plist")))
}

/// `$XDG_CONFIG_HOME/autostart/agent-office.desktop`, o `~/.config/autostart/…`.
#[cfg(not(target_os = "macos"))]
fn path() -> Option<PathBuf> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| crate::system::home().map(|h| h.join(".config")))?;
    Some(config.join("autostart/agent-office.desktop"))
}

pub fn enabled() -> bool {
    path().is_some_and(|p| p.exists())
}

/// Eseguibile da lanciare al login. Un AppImage gira da un punto di montaggio temporaneo: va lanciato il file
/// .AppImage stesso, che il runtime indica in `APPIMAGE`.
fn executable() -> Option<PathBuf> {
    #[cfg(not(target_os = "macos"))]
    if let Some(appimage) = std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|p| p.is_absolute()) {
        return Some(appimage);
    }
    std::env::current_exe().ok()
}

#[cfg(target_os = "macos")]
fn entry(exe: &str) -> String {
    let exe = exe.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
         <key>Label</key><string>{LAUNCH_AGENT}</string>\n\
         <key>ProgramArguments</key><array><string>{exe}</string></array>\n\
         <key>RunAtLoad</key><true/>\n\
         </dict></plist>\n"
    )
}

#[cfg(not(target_os = "macos"))]
fn entry(exe: &str) -> String {
    desktop_entry(exe)
}

/// Voce .desktop che lancia `exe`, tra virgolette con l'escape della specifica Desktop Entry (`"`, `` ` ``, `$`,
/// `\`; `%` raddoppiato perché introduce i codici di campo). Pura.
#[cfg(any(not(target_os = "macos"), test))]
pub fn desktop_entry(exe: &str) -> String {
    let mut quoted = String::from("\"");
    for c in exe.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(c);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }
    quoted.push('"');
    format!(
        "[Desktop Entry]\nType=Application\nName=Agent Office\nExec={}\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n",
        // nel file .desktop la barra rovescia va a sua volta raddoppiata (escape delle stringhe)
        quoted.replace('\\', "\\\\")
    )
}

/// Attiva o disattiva l'avvio al login. Si richiama all'avvio se già attivo: l'eseguibile può essere cambiato (app
/// spostata, reinstallata da Homebrew, AppImage nuovo).
pub fn set(enabled: bool) {
    let (Some(path), Some(exe)) = (path(), executable()) else {
        return;
    };
    if !enabled {
        let _ = std::fs::remove_file(path);
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, entry(&exe.to_string_lossy()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voce_desktop_con_escape() {
        let e = desktop_entry("/home/me/Apps/Agent Office.AppImage");
        assert!(e.starts_with("[Desktop Entry]\n"));
        assert!(e.contains("\nExec=\"/home/me/Apps/Agent Office.AppImage\"\n"));
        assert!(desktop_entry("/x/$a\"b%").contains("Exec=\"/x/\\\\$a\\\\\"b%%\"\n"));
    }
}
