//! Quanto cambia tra macOS e Linux (#107) e non ha un modulo suo: cartella home, apertura di un indirizzo nel browser
//! di sistema e, su Linux, il tema scuro per l'icona del tray.

use std::path::PathBuf;
use std::process::Command;

/// Cartella home dell'utente (`HOME`, impostata da launchd su macOS e dalla sessione su Linux). Unica fonte per
/// config.rs, settings.rs, server.rs, updates.rs e autostart.rs.
pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").filter(|h| !h.is_empty()).map(PathBuf::from)
}

/// Apre `url` nel browser di sistema (`open` su macOS, `xdg-open` su Linux). true se il comando è riuscito.
pub fn open_url(url: &str) -> bool {
    #[cfg(target_os = "macos")]
    let opener = "/usr/bin/open";
    // xdg-open dal PATH: /usr/bin su quasi tutte le distribuzioni, ma non è garantito
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    Command::new(opener).arg(url).status().is_ok_and(|s| s.success())
}

/// Valore di `color-scheme` del portale `org.freedesktop.appearance` nell'output di `gdbus call … Settings.Read`
/// (`(<<uint32 1>>,)`): 1 scuro, 2 chiaro, 0 nessuna preferenza (None). Pura.
#[cfg(any(target_os = "linux", test))]
pub fn portal_dark(gdbus: &str) -> Option<bool> {
    let digits: String = gdbus.rsplit("uint32").next()?.chars().skip_while(|c| !c.is_ascii_digit()).take_while(char::is_ascii_digit).collect();
    match digits.as_str() {
        "1" => Some(true),
        "2" => Some(false),
        _ => None,
    }
}

/// Tema scuro da `gsettings get org.gnome.desktop.interface color-scheme` (`'prefer-dark'`) o `gtk-theme`
/// (`'Adwaita-dark'`, `'Yaru-dark'`): None se il valore non dice niente (`'default'`, vuoto). Pura.
#[cfg(any(target_os = "linux", test))]
pub fn gsettings_dark(color_scheme: &str, gtk_theme: &str) -> Option<bool> {
    let scheme = color_scheme.trim().trim_matches('\'');
    match scheme {
        "prefer-dark" => return Some(true),
        "prefer-light" => return Some(false),
        _ => {}
    }
    let theme = gtk_theme.trim().trim_matches('\'').to_ascii_lowercase();
    (!theme.is_empty()).then(|| theme.contains("dark"))
}

/// Pannello del desktop scuro, per l'icona del tray: bianca invece che nera. GNOME (e Ubuntu) ha la barra in alto
/// sempre scura, qualunque sia il tema; altrove si legge il portale freedesktop, poi gsettings. Se nessuno risponde,
/// scuro: è il caso più comune dei pannelli Linux. Il risultato resta valido CACHE_FOR (il polling è ogni 2 s).
#[cfg(target_os = "linux")]
pub fn panel_is_dark() -> bool {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    const CACHE_FOR: Duration = Duration::from_secs(30);
    static CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
    if let Some((at, dark)) = *CACHE.lock().unwrap() {
        if at.elapsed() < CACHE_FOR {
            return dark;
        }
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_lowercase();
    let run = |cmd: &str, args: &[&str]| {
        Command::new(cmd)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default()
    };
    let dark = if desktop.split(':').any(|d| d == "gnome" || d == "unity") {
        true
    } else {
        portal_dark(&run(
            "gdbus",
            &[
                "call",
                "--session",
                "--timeout",
                "1",
                "--dest",
                "org.freedesktop.portal.Desktop",
                "--object-path",
                "/org/freedesktop/portal/desktop",
                "--method",
                "org.freedesktop.portal.Settings.Read",
                "org.freedesktop.appearance",
                "color-scheme",
            ],
        ))
        .or_else(|| {
            gsettings_dark(
                &run("gsettings", &["get", "org.gnome.desktop.interface", "color-scheme"]),
                &run("gsettings", &["get", "org.gnome.desktop.interface", "gtk-theme"]),
            )
        })
        .unwrap_or(true)
    };
    *CACHE.lock().unwrap() = Some((Instant::now(), dark));
    dark
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tema_dal_portale() {
        assert_eq!(portal_dark("(<<uint32 1>>,)\n"), Some(true));
        assert_eq!(portal_dark("(<uint32 2>,)"), Some(false));
        assert_eq!(portal_dark("(<<uint32 0>>,)"), None);
        assert_eq!(portal_dark(""), None);
    }

    #[test]
    fn tema_da_gsettings() {
        assert_eq!(gsettings_dark("'prefer-dark'\n", "'Adwaita'"), Some(true));
        assert_eq!(gsettings_dark("'prefer-light'", "'Yaru-dark'"), Some(false));
        assert_eq!(gsettings_dark("'default'", "'Yaru-dark'\n"), Some(true));
        assert_eq!(gsettings_dark("'default'", "'Breeze'"), Some(false));
        assert_eq!(gsettings_dark("", ""), None);
    }
}
