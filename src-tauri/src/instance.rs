//! Una sola app attiva: l'ultima avviata chiude le altre copie (una versione vecchia rimasta aperta dopo un
//! aggiornamento, una build locale). Altrimenti le icone sarebbero due e la nuova userebbe il server della vecchia,
//! trovandolo già sulla porta. Il server di una copia chiusa si ferma da solo (--exit-with-stdin).

use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// eseguibile dentro un bundle .app (non `tauri dev`, che non è un bundle)
#[cfg(target_os = "macos")]
const PATTERN: &str = r"\.app/Contents/MacOS/agent-office-menubar$";
/// eseguibile installato dal deb (`/usr/bin/…`, o il solo nome se lanciato dal file .desktop) o dentro l'AppImage
/// (`/tmp/.mount_…/usr/bin/…`); non `tauri dev` (`target/debug/…`). Senza argomenti dopo: l'app non ne riceve.
#[cfg(not(target_os = "macos"))]
const PATTERN: &str = r"(^|/usr/bin/)agent-office-menubar$";
/// attesa massima per la chiusura delle altre copie
const WAIT: Duration = Duration::from_secs(3);

/// Pid delle altre copie nell'output di `pgrep -f`, escluso `me`. Pura.
pub fn other_pids(pgrep: &str, me: u32) -> Vec<u32> {
    pgrep.lines().filter_map(|l| l.trim().parse().ok()).filter(|&pid| pid != me).collect()
}

fn alive(pid: u32) -> bool {
    Command::new("/bin/kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

/// Chiude le altre copie dell'app e aspetta che escano (al più WAIT).
pub fn take_over() {
    let Ok(out) = Command::new("/usr/bin/pgrep").args(["-f", PATTERN]).output() else { return };
    let others = other_pids(&String::from_utf8_lossy(&out.stdout), std::process::id());
    for pid in &others {
        let _ = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).stderr(Stdio::null()).status();
    }
    let deadline = Instant::now() + WAIT;
    while Instant::now() < deadline && others.iter().any(|&pid| alive(pid)) {
        thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn altre_copie_escluso_se_stesso() {
        assert_eq!(other_pids("22350\n64075\n", 64075), vec![22350]);
        assert_eq!(other_pids("", 1), Vec::<u32>::new());
        assert_eq!(other_pids("42\n", 42), Vec::<u32>::new());
        // righe con spazi tollerate, quelle non numeriche ignorate
        assert_eq!(other_pids(" 7 \npgrep: errore\n\n9\n", 1), vec![7, 9]);
    }
}
