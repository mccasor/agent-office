//! Server Node dell'ufficio: ricerca di Node (>= MIN_NODE), avvio, riavvio se si chiude e riconoscimento di chi
//! risponde sulla porta. Gli errori diventano un testo da mostrare nel menu invece di sparire.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

/// versione minima di Node (engines di package.json)
pub const MIN_NODE: u64 = 22;
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// attesa massima tra due riavvii consecutivi falliti
const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// Esegue un comando aspettandolo al più `timeout` (una shell di login lenta o interattiva non blocca l'app).
fn output_with_timeout(cmd: &mut Command, timeout: Duration) -> Option<Output> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if start.elapsed() < timeout => thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// "v26.12.0" -> 26
pub fn node_major(version: &str) -> Option<u64> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

fn version_of(node: &Path) -> Option<u64> {
    let out = output_with_timeout(Command::new(node).arg("--version"), PROBE_TIMEOUT)?;
    out.status.success().then(|| node_major(&String::from_utf8_lossy(&out.stdout))).flatten()
}

fn candidates() -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = std::env::var_os("AGENT_OFFICE_NODE").map(PathBuf::from).into_iter().collect();
    list.extend(["/opt/homebrew/bin/node", "/usr/local/bin/node"].map(PathBuf::from));
    // l'app parte da launchd con un PATH minimo: nvm, fnm, asdf… si trovano solo con una shell di login
    if let Some(out) = output_with_timeout(Command::new("/bin/zsh").args(["-lic", "command -v node"]), PROBE_TIMEOUT) {
        if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().last() {
            list.push(PathBuf::from(line.trim()));
        }
    }
    list.into_iter().filter(|p| p.is_absolute() && p.exists()).collect()
}

/// Node da usare: il primo abbastanza recente. Trovato una volta resta in memoria; l'errore no (si riprova).
pub fn find_node() -> Result<PathBuf, String> {
    static FOUND: Mutex<Option<PathBuf>> = Mutex::new(None);
    if let Some(p) = FOUND.lock().unwrap().clone() {
        return Ok(p);
    }
    let mut too_old = None;
    for path in candidates() {
        match version_of(&path) {
            Some(major) if major >= MIN_NODE => {
                *FOUND.lock().unwrap() = Some(path.clone());
                return Ok(path);
            }
            Some(major) => too_old = too_old.or(Some(major)),
            None => {}
        }
    }
    Err(match too_old {
        Some(major) => format!("Node {major} è troppo vecchio: serve Node {MIN_NODE} o successivo"),
        None => "Node non trovato: installalo con `brew install node`".into(),
    })
}

/// Chi risponde sulla porta del server.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Probe {
    /// un server di Agent Office (questo o un'altra istanza)
    Ours,
    /// un altro programma
    Foreign,
    Down,
}

/// Risposta di /api/status (None = nessuna risposta) -> chi c'è sulla porta.
pub fn probe(status_body: Option<&str>) -> Probe {
    let Some(body) = status_body else { return Probe::Down };
    let app = serde_json::from_str::<serde_json::Value>(body).ok().and_then(|v| v.get("app")?.as_str().map(str::to_string));
    if app.as_deref() == Some("agent-office") { Probe::Ours } else { Probe::Foreign }
}

fn log_path() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("HOME")?).join(".agent-office");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("server.log"))
}

/// Ultima riga non vuota del log del server, accorciata per il menu.
fn last_log_line(path: &Path) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(4096))).ok()?;
    let mut tail = String::new();
    f.read_to_string(&mut tail).ok()?;
    let line = tail.lines().rev().map(str::trim).find(|l| !l.is_empty())?;
    Some(if line.chars().count() > 90 { format!("{}…", line.chars().take(89).collect::<String>()) } else { line.to_string() })
}

/// Avvia il server e lo riavvia se si chiude, con attese crescenti tra un tentativo fallito e l'altro.
pub struct Supervisor {
    child: Option<Child>,
    /// motivo per cui il server non è disponibile, da mostrare nel menu
    error: Option<String>,
    retry_at: Instant,
    failures: u32,
}

impl Default for Supervisor {
    fn default() -> Self {
        Supervisor { child: None, error: None, retry_at: Instant::now(), failures: 0 }
    }
}

impl Supervisor {
    pub fn error(&self) -> Option<String> {
        self.error.clone()
    }

    fn retry_later(&mut self, error: String) {
        self.failures += 1;
        let backoff = Duration::from_secs(2u64.saturating_pow(self.failures.min(6))).min(MAX_BACKOFF);
        self.retry_at = Instant::now() + backoff;
        self.error = Some(error);
    }

    /// Da chiamare a ogni giro di polling con l'esito di /api/status.
    pub fn tick(&mut self, app_dir: &Path, port: u16, status: Probe) {
        if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(None) => {
                    if status == Probe::Ours {
                        self.failures = 0;
                        self.error = None;
                    }
                    return;
                }
                Ok(Some(code)) => {
                    self.child = None;
                    let detail = log_path().and_then(|p| last_log_line(&p)).map(|l| format!(": {l}")).unwrap_or_default();
                    self.retry_later(format!("Il server si è chiuso ({code}){detail}"));
                }
                Err(_) => self.child = None,
            }
        }
        match status {
            Probe::Ours => {
                // un'altra istanza già attiva (es. avviata da terminale): la si usa così com'è
                self.failures = 0;
                self.error = None;
                return;
            }
            Probe::Foreign => {
                self.error = Some(format!("La porta {port} è occupata da un altro programma"));
                return;
            }
            Probe::Down => {}
        }
        if Instant::now() < self.retry_at {
            return;
        }
        let node = match find_node() {
            Ok(node) => node,
            Err(e) => return self.retry_later(e),
        };
        // log del server sovrascritto a ogni avvio: contiene l'errore dell'ultima chiusura
        let log = log_path().and_then(|p| OpenOptions::new().create(true).write(true).truncate(true).open(p).ok());
        let (out, err) = match log.and_then(|f| Some((f.try_clone().ok()?, f))) {
            Some((a, b)) => (Stdio::from(a), Stdio::from(b)),
            None => (Stdio::null(), Stdio::null()),
        };
        let spawned = Command::new(node)
            .arg(app_dir.join("bin/agent-office.mjs"))
            .args(["--all", "--no-open", "--exit-with-stdin", "--port", &port.to_string()])
            // pipe tenuta aperta dall'app: se l'app termina in qualunque modo il server si chiude da solo
            .stdin(Stdio::piped())
            .stdout(out)
            .stderr(err)
            .spawn();
        match spawned {
            Ok(child) => self.child = Some(child),
            Err(e) => self.retry_later(format!("Avvio del server non riuscito: {e}")),
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versione_di_node() {
        assert_eq!(node_major("v26.12.0\n"), Some(26));
        assert_eq!(node_major("v18.20.1"), Some(18));
        assert_eq!(node_major("boh"), None);
    }

    #[test]
    fn chi_risponde_sulla_porta() {
        assert_eq!(probe(None), Probe::Down);
        assert_eq!(probe(Some(r#"{"app":"agent-office","status":"idle"}"#)), Probe::Ours);
        assert_eq!(probe(Some(r#"{"status":"idle"}"#)), Probe::Foreign);
        assert_eq!(probe(Some("<html>altro programma</html>")), Probe::Foreign);
    }

    #[test]
    fn server_che_si_chiude_viene_riavviato_con_attesa_crescente() {
        let mut s = Supervisor::default();
        s.retry_later("chiuso".into());
        let first = s.retry_at;
        s.retry_later("chiuso".into());
        assert!(s.retry_at > first);
        assert_eq!(s.error(), Some("chiuso".into()));
        // tornato raggiungibile: niente errore
        s.tick(Path::new("/inesistente"), 0, Probe::Ours);
        assert_eq!(s.error(), None);
    }
}
