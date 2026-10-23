//! Notifiche di macOS: quando una sessione si blocca in attesa dell'utente e, se richiesto, quando finisce il
//! lavoro. Preferenze in ~/.agent-office/config.json, file condiviso con il server (che ne legge altre chiavi).

use std::path::PathBuf;

use serde_json::{Map, Value};

/// Preferenze dell'app.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Prefs {
    /// notifica quando Claude aspetta un input (permesso, domanda, piano)
    pub notify_waiting: bool,
    /// notifica quando Claude finisce il turno
    pub notify_done: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { notify_waiting: true, notify_done: false }
    }
}

fn prefs_path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join(".agent-office/config.json"))
}

pub fn load() -> Prefs {
    let stored = prefs_path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let d = Prefs::default();
    let flag = |key: &str, default: bool| stored.as_ref().and_then(|v| v.get(key)?.as_bool()).unwrap_or(default);
    Prefs { notify_waiting: flag("notifyWaiting", d.notify_waiting), notify_done: flag("notifyDone", d.notify_done) }
}

/// Salva le preferenze lasciando intatte le altre chiavi del file (es. activeWindowMinutes del server).
pub fn save(p: Prefs) {
    let Some(path) = prefs_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut config = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_else(Map::new);
    config.insert("notifyWaiting".into(), Value::Bool(p.notify_waiting));
    config.insert("notifyDone".into(), Value::Bool(p.notify_done));
    if let Ok(text) = serde_json::to_string_pretty(&Value::Object(config)) {
        let _ = std::fs::write(path, text + "\n");
    }
}

/// Quanto serve per decidere le notifiche di una sessione attiva.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SessionFacts {
    pub id: String,
    /// "progetto · branch"
    pub place: String,
    /// stato della sessione principale (working, entering, idle, done)
    pub status: String,
    /// con la sessione bloccata: permission, question, plan, input
    pub waiting: Option<String>,
}

fn waiting_title(kind: &str) -> &'static str {
    match kind {
        "permission" => "Claude aspetta un tuo permesso",
        "question" => "Claude ti ha fatto una domanda",
        "plan" => "Claude aspetta l'ok al piano",
        _ => "Claude aspetta un tuo input",
    }
}

/// Notifiche (titolo, testo) per il passaggio da `prev` a `next`: una sessione che si blocca e, con
/// `notify_done`, una che passa da al lavoro a fine turno. Pura.
pub fn messages(prev: &[SessionFacts], next: &[SessionFacts], prefs: Prefs) -> Vec<(String, String)> {
    let mut out = vec![];
    for s in next {
        let before = prev.iter().find(|p| p.id == s.id);
        if let Some(kind) = &s.waiting {
            if prefs.notify_waiting && before.is_none_or(|b| b.waiting.is_none()) {
                out.push((waiting_title(kind).to_string(), s.place.clone()));
            }
            continue;
        }
        let was_busy = before.is_some_and(|b| b.waiting.is_none() && matches!(b.status.as_str(), "working" | "entering"));
        if prefs.notify_done && was_busy && s.status == "done" {
            out.push(("Claude è pronto".to_string(), s.place.clone()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(id: &str, status: &str, waiting: Option<&str>) -> SessionFacts {
        SessionFacts { id: id.into(), place: format!("{id} · main"), status: status.into(), waiting: waiting.map(String::from) }
    }

    #[test]
    fn notifica_quando_una_sessione_si_blocca_una_volta_sola() {
        let prefs = Prefs::default();
        let working = [facts("a", "working", None)];
        let blocked = [facts("a", "working", Some("permission"))];
        assert_eq!(messages(&working, &blocked, prefs), vec![("Claude aspetta un tuo permesso".into(), "a · main".into())]);
        // ancora bloccata al giro dopo: niente doppioni
        assert!(messages(&blocked, &blocked, prefs).is_empty());
        // nuova sessione già bloccata
        assert_eq!(messages(&[], &[facts("b", "done", Some("plan"))], prefs).len(), 1);
        assert!(messages(&working, &blocked, Prefs { notify_waiting: false, notify_done: false }).is_empty());
    }

    #[test]
    fn fine_lavoro_solo_se_richiesta_e_dopo_il_lavoro() {
        let on = Prefs { notify_waiting: true, notify_done: true };
        let working = [facts("a", "working", None)];
        let done = [facts("a", "done", None)];
        assert!(messages(&working, &done, Prefs::default()).is_empty());
        assert_eq!(messages(&working, &done, on), vec![("Claude è pronto".into(), "a · main".into())]);
        assert!(messages(&done, &done, on).is_empty());
        // dopo una domanda a cui si risponde no: il turno non era "al lavoro"
        assert!(messages(&[facts("a", "working", Some("question"))], &done, on).is_empty());
    }
}
