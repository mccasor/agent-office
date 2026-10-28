//! ~/.agent-office/config.json, il file delle impostazioni condiviso con il server Node (che lo osserva e applica
//! subito le modifiche, #94). Lo scrive solo l'app: una chiave alla volta, validata, conservando tutte le altre
//! (anche quelle che non conosce, come le chiavi del server aggiunte in versioni future).
//!
//! Schema (chiavi mancanti o non valide valgono il default, lato app e lato server):
//! - `notifyWaiting`, `notifyDone`, `notifyAlerts`: notifiche dell'app (notify.rs; `notifyAlerts` per gli avvisi, #100)
//! - `activeWindowMinutes`: minuti dopo cui una sessione non è più attiva (server)
//! - `staleAgentMinutes`, `loopRepeats`: soglie degli avvisi "fermo" e "in loop" sui subagenti (server, #97)
//! - `language`: "system" | "it" | "en" | "es" (#93)
//! - `show`: `{ "<voce>": bool }`, voci del catalogo in src/shared/settings.ts
//! - `office`: `{ "rooms": [{ "type", "variant" }] }`, composizione dell'ufficio (#108, src/shared/office.ts)

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::i18n::{t, tf};

pub const LANGUAGES: [&str; 4] = ["system", "it", "en", "es"];
/// minuti accettati per `activeWindowMinutes`, come in src/server/config.ts
pub const ACTIVE_WINDOW_MINUTES: std::ops::RangeInclusive<u64> = 1..=24 * 60;
/// minuti senza attività dopo cui un subagente ha l'avviso "fermo", come in src/server/config.ts
pub const STALE_AGENT_MINUTES: std::ops::RangeInclusive<u64> = 1..=24 * 60;
/// chiamate uguali di fila da cui un subagente ha l'avviso "in loop", come in src/server/config.ts
pub const LOOP_REPEATS: std::ops::RangeInclusive<u64> = 2..=100;
const MAX_ITEM_KEY: usize = 64;
/// tipi di stanza con il numero di stili (piante), come ROOM_VARIANTS in src/shared/office.ts; le ultime tre sono hobby
pub const ROOM_TYPES: [(&str, u64); 6] = [("work4", 8), ("work8", 4), ("work12", 4), ("relax", 1), ("console", 1), ("pingpong", 1)];
const HOBBY_ROOMS: [&str; 3] = ["relax", "console", "pingpong"];
/// al massimo 8 stanze, da 1 a 7 di lavoro e da 1 a 3 sale hobby (OFFICE_LIMITS)
const MAX_ROOMS: usize = 8;
const WORK_ROOMS: std::ops::RangeInclusive<usize> = 1..=7;
const HOBBY_ROOMS_COUNT: std::ops::RangeInclusive<usize> = 1..=3;

pub fn path() -> Option<PathBuf> {
    Some(crate::system::home()?.join(".agent-office/config.json"))
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
        _ => Err(io::Error::new(io::ErrorKind::InvalidData, t("error.configInvalid"))),
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
    update_at(&path().ok_or_else(|| t("error.noHome"))?, change)
}

/// Chiave di una voce di `show`: lettere, cifre e punti (es. `session.diff`), come nel catalogo.
fn valid_item(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_ITEM_KEY && key.contains('.') && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

/// Composizione dell'ufficio valida (stesse regole di parseOfficeRooms in src/shared/office.ts): ogni stanza con un
/// tipo noto e lo stile da 1 al numero di piante, oppure null o assente (automatico), e i limiti per tipo. Pura.
pub fn valid_office_rooms(value: &Value) -> bool {
    let Some(rooms) = value.as_array() else { return false };
    if rooms.len() > MAX_ROOMS {
        return false;
    }
    let mut hobby = 0;
    for room in rooms {
        let Some(kind) = room.get("type").and_then(Value::as_str) else { return false };
        let Some(&(_, variants)) = ROOM_TYPES.iter().find(|(t, _)| *t == kind) else { return false };
        match room.get("variant") {
            None | Some(Value::Null) => {}
            Some(v) => {
                if !v.as_u64().is_some_and(|n| (1..=variants).contains(&n)) {
                    return false;
                }
            }
        }
        if HOBBY_ROOMS.contains(&kind) {
            hobby += 1;
        }
    }
    WORK_ROOMS.contains(&(rooms.len() - hobby)) && HOBBY_ROOMS_COUNT.contains(&hobby)
}

/// Imposta `key` a `value` se sono una chiave e un valore ammessi (`show.<voce>` per gli interruttori). Pura.
pub fn set(config: &mut Map<String, Value>, key: &str, value: Value) -> Result<(), String> {
    // nella lingua dell'app: la finestra Impostazioni li mostra dopo "Impostazione non salvata" (#103)
    let invalid = || tf("error.invalidValue", &[("key", key)]);
    match key {
        "notifyWaiting" | "notifyDone" | "notifyAlerts" => {
            value.as_bool().ok_or_else(invalid)?;
        }
        "activeWindowMinutes" => {
            value.as_u64().filter(|m| ACTIVE_WINDOW_MINUTES.contains(m)).ok_or_else(invalid)?;
        }
        "staleAgentMinutes" => {
            value.as_u64().filter(|m| STALE_AGENT_MINUTES.contains(m)).ok_or_else(invalid)?;
        }
        "loopRepeats" => {
            value.as_u64().filter(|n| LOOP_REPEATS.contains(n)).ok_or_else(invalid)?;
        }
        "language" => {
            value.as_str().filter(|l| LANGUAGES.contains(l)).ok_or_else(invalid)?;
        }
        "office.rooms" => {
            if !valid_office_rooms(&value) {
                return Err(invalid());
            }
            let office = config.entry("office").or_insert_with(|| Value::Object(Map::new()));
            if !office.is_object() {
                *office = Value::Object(Map::new());
            }
            if let Some(office) = office.as_object_mut() {
                office.insert("rooms".to_string(), value);
            }
            return Ok(());
        }
        _ => {
            let item = key.strip_prefix("show.").filter(|k| valid_item(k)).ok_or_else(|| tf("error.unknownSetting", &[("key", key)]))?;
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
        for bad in ["show.", "show.diff", "show.a b.c", "show.__proto__.x", "staleAgent", "show"] {
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

    #[test]
    fn errori_nella_lingua_scelta() {
        use crate::i18n::{with_locale, Locale};
        let mut c = Map::new();
        assert_eq!(with_locale(Locale::En, || set(&mut c, "loopRepeats", json!(1))), Err("invalid value for loopRepeats".into()));
        assert_eq!(with_locale(Locale::Es, || set(&mut c, "show.x", json!(true))), Err("ajuste desconocido: show.x".into()));
        assert_eq!(with_locale(Locale::It, || set(&mut c, "language", json!("fr"))), Err("valore non valido per language".into()));
        // file rotto: l'errore arriva alla pagina così com'è
        let dir = temp_dir("lang");
        let file = dir.join("config.json");
        std::fs::write(&file, "[1]").unwrap();
        let err = with_locale(Locale::En, || update_at(&file, |c| set(c, "notifyDone", json!(true))));
        assert_eq!(err, Err("config.json is not a valid JSON object".into()));
        let err = with_locale(Locale::Es, || update_at(&file, |c| set(c, "notifyDone", json!(true))));
        assert_eq!(err, Err("config.json no es un objeto JSON válido".into()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn soglie_degli_avvisi() {
        // interi negli stessi limiti del server (src/server/config.ts)
        let mut c = Map::new();
        assert!(set(&mut c, "staleAgentMinutes", json!(120)).is_ok());
        for bad in [json!(0), json!(1441), json!(-1), json!(30.5), json!("60"), json!(true)] {
            assert!(set(&mut c, "staleAgentMinutes", bad.clone()).is_err(), "{bad}");
        }
        assert!(set(&mut c, "loopRepeats", json!(2)).is_ok());
        assert!(set(&mut c, "loopRepeats", json!(10)).is_ok());
        for bad in [json!(1), json!(0), json!(101), json!(5.5), json!("5")] {
            assert!(set(&mut c, "loopRepeats", bad.clone()).is_err(), "{bad}");
        }
        assert_eq!(Value::Object(c), json!({ "staleAgentMinutes": 120, "loopRepeats": 10 }));
        // scritte nel file accanto alle altre chiavi
        let dir = temp_dir("alerts");
        let file = dir.join("config.json");
        std::fs::write(&file, "{\"activeWindowMinutes\":30}").unwrap();
        update_at(&file, |c| set(c, "staleAgentMinutes", json!(15))).unwrap();
        update_at(&file, |c| set(c, "loopRepeats", json!(3))).unwrap();
        assert!(update_at(&file, |c| set(c, "loopRepeats", json!(1))).is_err());
        assert_eq!(read_json(&file), json!({ "activeWindowMinutes": 30, "staleAgentMinutes": 15, "loopRepeats": 3 }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn notifica_degli_avvisi() {
        // interruttore come le altre notifiche (#100): solo booleani
        let mut c = Map::new();
        assert!(set(&mut c, "notifyAlerts", json!(true)).is_ok());
        for bad in [json!("true"), json!(1), json!(null)] {
            assert!(set(&mut c, "notifyAlerts", bad.clone()).is_err(), "{bad}");
        }
        assert_eq!(Value::Object(c), json!({ "notifyAlerts": true }));
        let dir = temp_dir("notify-alerts");
        let file = dir.join("config.json");
        std::fs::write(&file, "{\"notifyDone\":true}").unwrap();
        update_at(&file, |c| set(c, "notifyAlerts", json!(false))).unwrap();
        assert_eq!(read_json(&file), json!({ "notifyDone": true, "notifyAlerts": false }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn composizione_dell_ufficio() {
        // stesse regole di src/shared/office.ts: tipi, stili, limiti
        let rooms = |list: &[(&str, Value)]| Value::Array(list.iter().map(|(t, v)| json!({ "type": t, "variant": v })).collect());
        let default = json!([
            { "type": "work8", "variant": null }, { "type": "work8", "variant": null }, { "type": "work8", "variant": null },
            { "type": "work8", "variant": null }, { "type": "work8", "variant": null }, { "type": "relax", "variant": null }
        ]);
        assert!(valid_office_rooms(&default));
        assert!(valid_office_rooms(&json!([{ "type": "work4" }, { "type": "pingpong" }])));
        assert!(valid_office_rooms(&rooms(&[("work4", json!(8)), ("work12", json!(4)), ("relax", json!(1)), ("console", json!(null)), ("pingpong", json!(null))])));
        let seven: Vec<(&str, Value)> = std::iter::repeat_n(("work12", json!(null)), 7).chain([("relax", json!(null))]).collect();
        assert!(valid_office_rooms(&rooms(&seven)));
        for bad in [
            json!([]),
            json!({ "rooms": [] }),
            json!([{ "type": "work8" }]),
            json!([{ "type": "relax" }]),
            rooms(&[("work8", json!(5)), ("relax", json!(null))]),
            rooms(&[("work4", json!(0)), ("relax", json!(null))]),
            rooms(&[("work4", json!(1.5)), ("relax", json!(null))]),
            rooms(&[("work4", json!("1")), ("relax", json!(null))]),
            rooms(&[("relax", json!(2)), ("work8", json!(null))]),
            rooms(&[("work16", json!(null)), ("relax", json!(null))]),
            rooms(&[("work8", json!(null)), ("relax", json!(null)), ("relax", json!(null)), ("relax", json!(null)), ("relax", json!(null))]),
            rooms(&std::iter::repeat_n(("work8", json!(null)), 8).chain([("relax", json!(null))]).collect::<Vec<_>>()),
            rooms(&std::iter::repeat_n(("work8", json!(null)), 6).chain(std::iter::repeat_n(("relax", json!(null)), 3)).collect::<Vec<_>>()),
            json!([{ "variant": 1 }, { "type": "relax" }]),
            json!([1, { "type": "relax" }]),
        ] {
            assert!(!valid_office_rooms(&bad), "{bad}");
        }
        // salvata dentro `office`, accanto alle altre chiavi
        let mut c = Map::new();
        c.insert("office".into(), json!({ "futuro": 1 }));
        set(&mut c, "office.rooms", default.clone()).unwrap();
        assert_eq!(c["office"], json!({ "futuro": 1, "rooms": default }));
        assert!(set(&mut c, "office.rooms", json!([])).is_err());
        assert!(set(&mut c, "office.altro", json!(1)).is_err());
        c.insert("office".into(), json!(3));
        set(&mut c, "office.rooms", json!([{ "type": "work4" }, { "type": "relax" }])).unwrap();
        assert_eq!(c["office"], json!({ "rooms": [{ "type": "work4" }, { "type": "relax" }] }));
    }
}
