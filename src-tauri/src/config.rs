//! ~/.agent-office/config.json, il file delle impostazioni condiviso con il server Node (che lo osserva e applica
//! subito le modifiche, #94). Lo scrive solo l'app: una chiave alla volta, validata, conservando tutte le altre
//! (anche quelle che non conosce, come le chiavi del server aggiunte in versioni future).
//!
//! Schema (chiavi mancanti o non valide valgono il default, lato app e lato server):
//! - `notifyWaiting`, `notifyDone`: notifiche dell'app (notify.rs)
//! - `activeWindowMinutes`: minuti dopo cui una sessione non è più attiva (server)
//! - `language`: "system" | "it" | "en" | "es" (#93)
//! - `show`: `{ "<voce>": bool }`, voci del catalogo in src/shared/settings.ts

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub const LANGUAGES: [&str; 4] = ["system", "it", "en", "es"];
/// minuti accettati per `activeWindowMinutes`, come in src/server/config.ts
pub const ACTIVE_WINDOW_MINUTES: std::ops::RangeInclusive<u64> = 1..=24 * 60;
const MAX_ITEM_KEY: usize = 64;

pub fn path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join(".agent-office/config.json"))
}

/// Contenuto del file; assente → oggetto vuoto. Err se c'è ma non è un oggetto JSON: non va sovrascritto.
pub fn read_at(path: &Path) -> io::Result<Map<String, Value>> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(e),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(io::Error::new(io::ErrorKind::InvalidData, "config.json non è un oggetto JSON valido")),
    }
}

/// Lettura per chi deve solo consultare: file assente o rotto → nessuna chiave (valgono i default).
pub fn read() -> Map<String, Value> {
    path().and_then(|p| read_at(&p).ok()).unwrap_or_default()
}

/// Applica `change` al contenuto attuale e riscrive il file: file temporaneo e rename (il server non legge mai un file
/// a metà), sul file reale se è un link simbolico. Un file non valido non si tocca.
pub fn update_at(path: &Path, change: impl FnOnce(&mut Map<String, Value>) -> Result<(), String>) -> Result<(), String> {
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut config = read_at(&target).map_err(|e| e.to_string())?;
    change(&mut config)?;
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&Value::Object(config)).map_err(|e| e.to_string())? + "\n";
    let tmp = target.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &target)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn update(change: impl FnOnce(&mut Map<String, Value>) -> Result<(), String>) -> Result<(), String> {
    update_at(&path().ok_or("cartella home sconosciuta")?, change)
}

/// Chiave di una voce di `show`: lettere, cifre e punti (es. `session.diff`), come nel catalogo.
fn valid_item(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_ITEM_KEY && key.contains('.') && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

/// Imposta `key` a `value` se sono una chiave e un valore ammessi (`show.<voce>` per gli interruttori). Pura.
pub fn set(config: &mut Map<String, Value>, key: &str, value: Value) -> Result<(), String> {
    let invalid = || format!("valore non valido per {key}");
    match key {
        "notifyWaiting" | "notifyDone" => {
            value.as_bool().ok_or_else(invalid)?;
        }
        "activeWindowMinutes" => {
            value.as_u64().filter(|m| ACTIVE_WINDOW_MINUTES.contains(m)).ok_or_else(invalid)?;
        }
        "language" => {
            value.as_str().filter(|l| LANGUAGES.contains(l)).ok_or_else(invalid)?;
        }
        _ => {
            let item = key.strip_prefix("show.").filter(|k| valid_item(k)).ok_or_else(|| format!("impostazione sconosciuta: {key}"))?;
            value.as_bool().ok_or_else(invalid)?;
            let show = config.entry("show").or_insert_with(|| Value::Object(Map::new()));
            if !show.is_object() {
                *show = Value::Object(Map::new());
            }
            if let Some(show) = show.as_object_mut() {
                show.insert(item.to_string(), value);
            }
            return Ok(());
        }
    }
    config.insert(key.to_string(), value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent-office-config-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_json(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn scrittura_conserva_le_chiavi_sconosciute() {
        let dir = temp_dir("keep");
        let file = dir.join("config.json");
        let before = json!({ "activeWindowMinutes": 30, "staleAgentMinutes": 7, "futuro": { "a": [1, 2] }, "show": { "session.diff": false, "x.y": true } });
        std::fs::write(&file, before.to_string()).unwrap();
        update_at(&file, |c| set(c, "notifyDone", json!(true))).unwrap();
        update_at(&file, |c| set(c, "show.panel.agents", json!(false))).unwrap();
        let after = read_json(&file);
        assert_eq!(after["staleAgentMinutes"], json!(7));
        assert_eq!(after["futuro"], json!({ "a": [1, 2] }));
        assert_eq!(after["activeWindowMinutes"], json!(30));
        assert_eq!(after["notifyDone"], json!(true));
        assert_eq!(after["show"], json!({ "session.diff": false, "x.y": true, "panel.agents": false }));
        // nessun file temporaneo lasciato in giro
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_assente_creato_file_rotto_lasciato_stare() {
        let dir = temp_dir("broken");
        let file = dir.join("sub/config.json");
        assert_eq!(read_at(&file).unwrap(), Map::new());
        update_at(&file, |c| set(c, "language", json!("en"))).unwrap();
        assert_eq!(read_json(&file), json!({ "language": "en" }));
        std::fs::write(&file, "{ rotto").unwrap();
        assert!(read_at(&file).is_err());
        assert!(update_at(&file, |c| set(c, "notifyDone", json!(true))).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ rotto");
        std::fs::write(&file, "[1]").unwrap();
        assert!(update_at(&file, |c| set(c, "notifyDone", json!(true))).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn modifica_rifiutata_file_intatto() {
        let dir = temp_dir("reject");
        let file = dir.join("config.json");
        std::fs::write(&file, "{\"a\":1}").unwrap();
        assert!(update_at(&file, |c| set(c, "activeWindowMinutes", json!(0))).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"a\":1}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn chiavi_e_valori_ammessi() {
        let mut c = Map::new();
        assert!(set(&mut c, "notifyWaiting", json!(false)).is_ok());
        assert!(set(&mut c, "notifyWaiting", json!("no")).is_err());
        assert!(set(&mut c, "activeWindowMinutes", json!(45)).is_ok());
        for bad in [json!(0), json!(1441), json!(-5), json!(2.5), json!("10")] {
            assert!(set(&mut c, "activeWindowMinutes", bad.clone()).is_err(), "{bad}");
        }
        assert!(set(&mut c, "language", json!("es")).is_ok());
        assert!(set(&mut c, "language", json!("fr")).is_err());
        assert!(set(&mut c, "show.list.finishedToday", json!(false)).is_ok());
        for bad in ["show.", "show.diff", "show.a b.c", "show.__proto__.x", "staleAgentMinutes", "show"] {
            assert!(set(&mut c, bad, json!(false)).is_err(), "{bad}");
        }
        assert!(set(&mut c, "show.session.diff", json!(1)).is_err());
        assert_eq!(
            Value::Object(c),
            json!({ "notifyWaiting": false, "activeWindowMinutes": 45, "language": "es", "show": { "list.finishedToday": false } })
        );
        // `show` non oggetto (scritto a mano): sostituito
        let mut c = Map::new();
        c.insert("show".into(), json!(true));
        set(&mut c, "show.session.diff", json!(false)).unwrap();
        assert_eq!(c["show"], json!({ "session.diff": false }));
    }
}
