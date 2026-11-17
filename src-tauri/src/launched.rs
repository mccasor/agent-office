//! Registro delle istanze di `claude` lanciate dall'app (#119): `~/.agent-office/launched.json`, letto dal server Node
//! per associare la stanza alla sessione con certezza (session id noto) anche prima che esista il transcript.
//!
//! Contratto (lo legge il server):
//! `{ "version": 1, "sessions": [ { "sessionId": "<uuid>", "pid": 12345, "cwd": "/abs/path", "launchedAt": 1763380000000 } ] }`
//!
//! Solo metadati del processo: niente prompt né output del terminale (privacy, #91). Il file si riscrive intero a ogni
//! cambiamento con file temporaneo e rename, come config.json: il server non legge mai un file a metà.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

const VERSION: u64 = 1;

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Launched {
    pub session_id: String,
    pub pid: u32,
    pub cwd: String,
    /// ms dall'epoca
    pub launched_at: u64,
}

/// Contenuto del file per `sessions`. Pura.
pub fn to_json(sessions: &[Launched]) -> Value {
    let list: Vec<Value> = sessions
        .iter()
        .map(|s| json!({ "sessionId": s.session_id, "pid": s.pid, "cwd": s.cwd, "launchedAt": s.launched_at }))
        .collect();
    json!({ "version": VERSION, "sessions": list })
}

/// Voci valide del file (versione 1); il resto si ignora. Pura.
pub fn from_json(text: &str) -> Vec<Launched> {
    let Ok(value) = serde_json::from_str::<Value>(text) else { return vec![] };
    if value["version"].as_u64() != Some(VERSION) {
        return vec![];
    }
    value["sessions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            Some(Launched {
                session_id: s["sessionId"].as_str()?.to_string(),
                pid: u32::try_from(s["pid"].as_u64()?).ok()?,
                cwd: s["cwd"].as_str()?.to_string(),
                launched_at: s["launchedAt"].as_u64()?,
            })
        })
        .collect()
}

/// Scrive `sessions` in `path`: file temporaneo nella stessa cartella e rename.
pub fn write_atomic(path: &Path, sessions: &[Launched]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(&to_json(sessions))? + "\n";
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, path)).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Il processo `pid` esiste ancora (anche se di un altro utente).
#[cfg(unix)]
pub fn alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else { return false };
    pid > 0 && (unsafe { libc::kill(pid, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}

#[cfg(not(unix))]
pub fn alive(_pid: u32) -> bool {
    false
}

/// Registro in memoria, specchio del file.
pub struct Registry {
    path: Option<PathBuf>,
    sessions: Mutex<Vec<Launched>>,
}

impl Registry {
    /// Registro su `path`: tiene le voci del file i cui processi sono ancora vivi (`alive`) e riscrive il file.
    pub fn open(path: Option<PathBuf>, alive: impl Fn(u32) -> bool) -> Registry {
        let sessions: Vec<Launched> = path
            .as_deref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|text| from_json(&text))
            .unwrap_or_default()
            .into_iter()
            .filter(|s| alive(s.pid))
            .collect();
        let registry = Registry { path, sessions: Mutex::new(sessions) };
        registry.save(&registry.sessions.lock().unwrap());
        registry
    }

    /// `~/.agent-office/launched.json`.
    pub fn default_path() -> Option<PathBuf> {
        Some(crate::system::home()?.join(".agent-office/launched.json"))
    }

    fn save(&self, sessions: &[Launched]) {
        if let Some(path) = &self.path {
            let _ = write_atomic(path, sessions);
        }
    }

    /// Aggiunge (o sostituisce, stesso session id) un'istanza lanciata.
    pub fn add(&self, entry: Launched) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|s| s.session_id != entry.session_id);
        sessions.push(entry);
        self.save(&sessions);
    }

    /// Toglie l'istanza `session_id` se è ancora quella del processo `pid` (una ricarica della pagina riavvia `claude`
    /// con lo stesso session id: l'uscita del processo vecchio non toglie quello nuovo).
    pub fn remove(&self, session_id: &str, pid: u32) {
        let mut sessions = self.sessions.lock().unwrap();
        let before = sessions.len();
        sessions.retain(|s| !(s.session_id == session_id && s.pid == pid));
        if sessions.len() != before {
            self.save(&sessions);
        }
    }

    /// Uscita dall'app: i processi muoiono con lei, il file si svuota.
    pub fn clear(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.clear();
        self.save(&sessions);
    }

    #[cfg(test)]
    fn list(&self) -> Vec<Launched> {
        self.sessions.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, pid: u32) -> Launched {
        Launched { session_id: id.into(), pid, cwd: "/abs/path".into(), launched_at: 1763380000000 }
    }

    /// Cartella vuota nuova per un test.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent-office-launched-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn json_come_da_contratto() {
        let value = to_json(&[entry("0f8fad5b-d9cb-469f-a165-70867728950e", 12345)]);
        assert_eq!(
            value,
            json!({ "version": 1, "sessions": [
                { "sessionId": "0f8fad5b-d9cb-469f-a165-70867728950e", "pid": 12345, "cwd": "/abs/path", "launchedAt": 1763380000000u64 }
            ] })
        );
        assert_eq!(to_json(&[]), json!({ "version": 1, "sessions": [] }));
    }

    #[test]
    fn lettura_del_file() {
        let list = vec![entry("a", 1), entry("b", 2)];
        assert_eq!(from_json(&to_json(&list).to_string()), list);
        // versione sconosciuta, testo rotto, voci incomplete: ignorati
        assert_eq!(from_json(r#"{"version":2,"sessions":[{"sessionId":"a","pid":1,"cwd":"/","launchedAt":1}]}"#), vec![]);
        assert_eq!(from_json("{rotto"), vec![]);
        assert_eq!(from_json(r#"{"version":1,"sessions":[{"sessionId":"a","cwd":"/","launchedAt":1}]}"#), vec![]);
    }

    #[test]
    fn scrittura_atomica() {
        let dir = temp_dir("atomic");
        let path = dir.join("sub/launched.json");
        write_atomic(&path, &[entry("a", 1)]).unwrap();
        assert_eq!(read(&path), to_json(&[entry("a", 1)]));
        write_atomic(&path, &[]).unwrap();
        assert_eq!(read(&path), to_json(&[]));
        // nessun file temporaneo rimasto
        let names: Vec<_> = std::fs::read_dir(dir.join("sub")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["launched.json"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn aggiunta_e_rimozione() {
        let dir = temp_dir("registry");
        let path = dir.join("launched.json");
        let registry = Registry::open(Some(path.clone()), |_| true);
        assert_eq!(read(&path), to_json(&[]));
        registry.add(entry("a", 1));
        registry.add(entry("b", 2));
        assert_eq!(read(&path), to_json(&[entry("a", 1), entry("b", 2)]));
        // stesso session id riavviato: sostituito
        registry.add(entry("a", 3));
        assert_eq!(registry.list(), [entry("b", 2), entry("a", 3)]);
        // l'uscita del processo vecchio non toglie quello nuovo
        registry.remove("a", 1);
        assert_eq!(registry.list(), [entry("b", 2), entry("a", 3)]);
        registry.remove("a", 3);
        assert_eq!(read(&path), to_json(&[entry("b", 2)]));
        registry.clear();
        assert_eq!(read(&path), to_json(&[]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn all_avvio_via_i_pid_morti() {
        let dir = temp_dir("stale");
        let path = dir.join("launched.json");
        write_atomic(&path, &[entry("vivo", 10), entry("morto", 20)]).unwrap();
        let registry = Registry::open(Some(path.clone()), |pid| pid == 10);
        assert_eq!(registry.list(), [entry("vivo", 10)]);
        assert_eq!(read(&path), to_json(&[entry("vivo", 10)]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn processo_vivo() {
        assert!(alive(std::process::id()));
        assert!(!alive(0));
        assert!(!alive(u32::MAX));
    }
}
