//! Ruoli delle istanze (#122): testi Markdown ("Sei il Tech Lead…") in `~/.agent-office/roles/<nome>.md`, gestiti
//! dalla finestra Impostazioni e passati a `claude` all'avvio con `--append-system-prompt-file <file>` (si aggiungono
//! al prompt di sistema, non lo sostituiscono). Il ruolo usato da una sessione si ricorda in
//! `~/.agent-office/session-roles.json` per ripassarlo quando la si riprende (#121).
//!
//! Privacy: il testo di un ruolo è come un prompt. Passa solo tra la finestra Impostazioni e questo modulo (IPC) e da
//! qui al file; mai al server Node, mai nei log, mai in launched.json. Fuori da qui circola solo il nome.
//!
//! Sicurezza: il nome arriva dalle pagine, quindi si accetta solo `^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$` senza `..`, e il
//! file risolto (link simbolici compresi) deve stare dentro `roles/`; il pannello sceglie solo tra i ruoli presenti.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::i18n::{t, tf};

/// dimensione massima del testo di un ruolo
pub const MAX_SIZE: usize = 64 * 1024;
/// lunghezza massima del nome
const MAX_NAME: usize = 64;
/// sessioni ricordate al più in session-roles.json (le più recenti)
const MAX_SESSIONS: usize = 500;
const EXT: &str = "md";

/// `~/.agent-office/roles`.
pub fn dir() -> Option<PathBuf> {
    Some(crate::system::home()?.join(".agent-office/roles"))
}

/// `~/.agent-office/session-roles.json`.
fn sessions_path() -> Option<PathBuf> {
    Some(crate::system::home()?.join(".agent-office/session-roles.json"))
}

/// Nome di ruolo ammesso: lettera o cifra, poi lettere, cifre, spazi, `_`, `.`, `-` (al più 64), niente `..`. Pura.
pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.len() <= MAX_NAME
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '.' | '-'))
        && !name.contains("..")
}

fn name_error(name: &str) -> String {
    tf("error.roleName", &[("name", name)])
}

/// Ruoli in `dir`: i nomi validi dei file `<nome>.md`, in ordine alfabetico. Cartella assente: nessuno.
pub fn list_in(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file() || t.is_symlink()))
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != EXT {
                return None;
            }
            path.file_stem()?.to_str().filter(|n| valid_name(n)).map(str::to_string)
        })
        .filter(|name| file_in(dir, name).is_ok())
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names
}

/// File del ruolo `name` in `dir` (deve esistere), assoluto: il nome è valido e il file risolto sta dentro `dir`.
pub fn file_in(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(name_error(name));
    }
    let missing = || tf("error.roleMissing", &[("name", name)]);
    let base = std::fs::canonicalize(dir).map_err(|_| missing())?;
    let file = std::fs::canonicalize(base.join(format!("{name}.{EXT}"))).map_err(|_| missing())?;
    if file.parent() != Some(base.as_path()) || !file.is_file() {
        return Err(missing());
    }
    Ok(file)
}

/// Testo del ruolo `name` in `dir`.
pub fn read_in(dir: &Path, name: &str) -> Result<String, String> {
    let file = file_in(dir, name)?;
    if std::fs::metadata(&file).map_err(|e| e.to_string())?.len() > MAX_SIZE as u64 {
        return Err(tf("error.roleTooLong", &[("kb", &(MAX_SIZE / 1024).to_string())]));
    }
    std::fs::read_to_string(file).map_err(|e| e.to_string())
}

/// Crea o sostituisce il ruolo `name` in `dir` con `text`: file temporaneo e rename (`claude` non legge mai un file a
/// metà); un link simbolico al suo posto si sostituisce, non si segue.
pub fn write_in(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err(name_error(name));
    }
    if text.len() > MAX_SIZE {
        return Err(tf("error.roleTooLong", &[("kb", &(MAX_SIZE / 1024).to_string())]));
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let base = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let file = base.join(format!("{name}.{EXT}"));
    let tmp = base.join(format!(".{name}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &file)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Elimina il ruolo `name` in `dir` (un link simbolico si toglie senza toccare il file a cui punta).
pub fn delete_in(dir: &Path, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err(name_error(name));
    }
    let file = dir.join(format!("{name}.{EXT}"));
    if !std::fs::symlink_metadata(&file).is_ok_and(|m| m.is_file() || m.is_symlink()) {
        return Err(tf("error.roleMissing", &[("name", name)]));
    }
    std::fs::remove_file(file).map_err(|e| e.to_string())
}

fn need_dir() -> Result<PathBuf, String> {
    dir().ok_or_else(|| t("error.noHome"))
}

/// Ruoli presenti in `~/.agent-office/roles`.
pub fn list() -> Vec<String> {
    dir().map(|d| list_in(&d)).unwrap_or_default()
}

pub fn file(name: &str) -> Result<PathBuf, String> {
    file_in(&need_dir()?, name)
}

pub fn read(name: &str) -> Result<String, String> {
    read_in(&need_dir()?, name)
}

pub fn write(name: &str, text: &str) -> Result<(), String> {
    write_in(&need_dir()?, name, text)
}

pub fn delete(name: &str) -> Result<(), String> {
    delete_in(&need_dir()?, name)
}

/// Coppie (session id, ruolo) di session-roles.json, dalla più vecchia: `[{"sessionId", "role"}]` (un elenco e non un
/// oggetto per sapere quali sono le più recenti). Voci non valide scartate. Pura.
pub fn sessions_from_json(text: &str) -> Vec<(String, String)> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(text) else { return vec![] };
    items
        .iter()
        .filter_map(|v| {
            let id = v["sessionId"].as_str().filter(|id| crate::pty::is_uuid(id))?;
            let role = v["role"].as_str().filter(|r| valid_name(r))?;
            Some((id.to_string(), role.to_string()))
        })
        .collect()
}

/// Ricorda `role` per `session_id` (in fondo, tolta un'eventuale voce vecchia), tenendo le ultime MAX_SESSIONS. Pura.
pub fn remember_in_list(sessions: &mut Vec<(String, String)>, session_id: &str, role: &str) {
    sessions.retain(|(id, _)| id != session_id);
    sessions.push((session_id.to_string(), role.to_string()));
    let extra = sessions.len().saturating_sub(MAX_SESSIONS);
    sessions.drain(..extra);
}

/// serializza le scritture di session-roles.json (lettura, modifica, riscrittura)
static SESSIONS_LOCK: Mutex<()> = Mutex::new(());

/// Ricorda in `path` il ruolo `role` della sessione `session_id`: file temporaneo e rename.
pub fn remember_at(path: &Path, session_id: &str, role: &str) -> std::io::Result<()> {
    let _guard = SESSIONS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut sessions = std::fs::read_to_string(path).map(|t| sessions_from_json(&t)).unwrap_or_default();
    remember_in_list(&mut sessions, session_id, role);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let value: Vec<Value> = sessions.iter().map(|(id, role)| json!({ "sessionId": id, "role": role })).collect();
    let text = serde_json::to_string_pretty(&value)? + "\n";
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, path)).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Ruolo ricordato in `path` per la sessione `session_id`.
pub fn recall_at(path: &Path, session_id: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    sessions_from_json(&text).into_iter().rev().find(|(id, _)| id == session_id).map(|(_, role)| role)
}

/// Ricorda il ruolo della sessione (errori ignorati: al più, riprendendola, il ruolo non si ripassa).
pub fn remember(session_id: &str, role: &str) {
    if let Some(path) = sessions_path() {
        let _ = remember_at(&path, session_id, role);
    }
}

/// Ruolo della sessione `session_id` e il suo file, se è ricordato e il file c'è ancora.
pub fn recall(session_id: &str) -> Option<(String, PathBuf)> {
    let role = recall_at(&sessions_path()?, session_id)?;
    let file = file(&role).ok()?;
    Some((role, file))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const OTHER: &str = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent-office-roles-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn nomi_ammessi() {
        for ok in ["Tech Lead", "reviewer", "a", "QA_2", "back-end.v2", "1", &"x".repeat(64)] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in [
            "", " lead", ".hidden", "-x", "_x", "..", "a..b", "../x", "a/b", "a\\b", "/etc/passwd", "~/x", "a\0b", "à",
            "lead\n", "a:b", "a*", &"x".repeat(65),
        ] {
            assert!(!valid_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn crea_legge_elenca_elimina() {
        let dir = temp_dir("crud").join("roles");
        // cartella assente: nessun ruolo
        assert!(list_in(&dir).is_empty());
        assert!(file_in(&dir, "Lead").is_err());
        write_in(&dir, "Tech Lead", "Sei il Tech Lead.\n").unwrap();
        write_in(&dir, "alpha", "a").unwrap();
        assert_eq!(list_in(&dir), ["alpha", "Tech Lead"]);
        assert_eq!(read_in(&dir, "Tech Lead").unwrap(), "Sei il Tech Lead.\n");
        let file = file_in(&dir, "Tech Lead").unwrap();
        assert!(file.is_absolute() && file.ends_with("roles/Tech Lead.md"));
        // sostituito, nessun file temporaneo rimasto
        write_in(&dir, "Tech Lead", "nuovo").unwrap();
        assert_eq!(read_in(&dir, "Tech Lead").unwrap(), "nuovo");
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        files.sort();
        assert_eq!(files, ["Tech Lead.md", "alpha.md"]);
        delete_in(&dir, "alpha").unwrap();
        assert_eq!(list_in(&dir), ["Tech Lead"]);
        assert!(delete_in(&dir, "alpha").is_err());
        assert!(read_in(&dir, "alpha").is_err());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn elenco_solo_dei_file_md_validi() {
        let dir = temp_dir("list");
        std::fs::write(dir.join("buono.md"), "x").unwrap();
        std::fs::write(dir.join(".nascosto.md"), "x").unwrap();
        std::fs::write(dir.join("note.txt"), "x").unwrap();
        std::fs::write(dir.join("a..b.md"), "x").unwrap();
        std::fs::create_dir_all(dir.join("cartella.md")).unwrap();
        assert_eq!(list_in(&dir), ["buono"]);
        assert!(file_in(&dir, "cartella").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn niente_fuori_da_roles() {
        let root = temp_dir("escape");
        let dir = root.join("roles");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(root.join("segreto.md"), "fuori").unwrap();
        for bad in ["../segreto", "..", "/etc/passwd", "a/../../segreto", ".segreto"] {
            assert!(file_in(&dir, bad).is_err(), "{bad}");
            assert!(read_in(&dir, bad).is_err(), "{bad}");
            assert!(write_in(&dir, bad, "x").is_err(), "{bad}");
            assert!(delete_in(&dir, bad).is_err(), "{bad}");
        }
        assert_eq!(std::fs::read_to_string(root.join("segreto.md")).unwrap(), "fuori");
        // un link simbolico che porta fuori non vale come ruolo, e scrivendo si sostituisce senza seguirlo
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("segreto.md"), dir.join("link.md")).unwrap();
            assert!(file_in(&dir, "link").is_err());
            assert!(read_in(&dir, "link").is_err());
            assert!(list_in(&dir).is_empty());
            write_in(&dir, "link", "dentro").unwrap();
            assert_eq!(std::fs::read_to_string(root.join("segreto.md")).unwrap(), "fuori");
            assert_eq!(read_in(&dir, "link").unwrap(), "dentro");
            std::os::unix::fs::symlink(root.join("segreto.md"), dir.join("altro.md")).unwrap();
            delete_in(&dir, "altro").unwrap();
            assert!(root.join("segreto.md").exists());
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn dimensione_massima() {
        let dir = temp_dir("size");
        write_in(&dir, "pieno", &"x".repeat(MAX_SIZE)).unwrap();
        assert_eq!(read_in(&dir, "pieno").unwrap().len(), MAX_SIZE);
        assert!(write_in(&dir, "troppo", &"x".repeat(MAX_SIZE + 1)).is_err());
        assert!(!dir.join("troppo.md").exists());
        // scritto a mano più grande: non si legge
        std::fs::write(dir.join("grande.md"), "x".repeat(MAX_SIZE + 1)).unwrap();
        assert!(read_in(&dir, "grande").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ruoli_delle_sessioni_limitati() {
        let mut list = vec![];
        for i in 0..MAX_SESSIONS + 10 {
            remember_in_list(&mut list, &format!("{i:08}-0000-4000-8000-000000000000"), "Lead");
        }
        assert_eq!(list.len(), MAX_SESSIONS);
        // si tengono le più recenti
        assert_eq!(list[0].0, "00000010-0000-4000-8000-000000000000");
        // stessa sessione: una voce sola, in fondo
        remember_in_list(&mut list, "00000010-0000-4000-8000-000000000000", "QA");
        assert_eq!(list.len(), MAX_SESSIONS);
        assert_eq!(list.last().unwrap(), &("00000010-0000-4000-8000-000000000000".to_string(), "QA".to_string()));
    }

    #[test]
    fn ruoli_delle_sessioni_su_file() {
        let dir = temp_dir("sessions");
        let path = dir.join("sub/session-roles.json");
        assert_eq!(recall_at(&path, ID), None);
        remember_at(&path, ID, "Tech Lead").unwrap();
        remember_at(&path, OTHER, "QA").unwrap();
        assert_eq!(recall_at(&path, ID).as_deref(), Some("Tech Lead"));
        assert_eq!(recall_at(&path, OTHER).as_deref(), Some("QA"));
        remember_at(&path, ID, "Reviewer").unwrap();
        assert_eq!(recall_at(&path, ID).as_deref(), Some("Reviewer"));
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(sessions_from_json(&text), [(OTHER.to_string(), "QA".to_string()), (ID.to_string(), "Reviewer".to_string())]);
        // nessun file temporaneo rimasto
        let names: Vec<_> = std::fs::read_dir(dir.join("sub")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["session-roles.json"]);
        // file rotto: si riparte da vuoto
        std::fs::write(&path, "{rotto").unwrap();
        assert_eq!(recall_at(&path, ID), None);
        remember_at(&path, ID, "QA").unwrap();
        assert_eq!(recall_at(&path, ID).as_deref(), Some("QA"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn voci_non_valide_scartate() {
        let text = format!(
            r#"[{{"sessionId":"{ID}","role":"../x"}},{{"sessionId":"x","role":"QA"}},{{"sessionId":"{OTHER}","role":"QA"}},42,{{"role":"QA"}}]"#
        );
        assert_eq!(sessions_from_json(&text), [(OTHER.to_string(), "QA".to_string())]);
        assert!(sessions_from_json(r#"{"a":"b"}"#).is_empty());
    }
}
