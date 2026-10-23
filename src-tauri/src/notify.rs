//! Notifiche di macOS: quando una sessione si blocca in attesa dell'utente e, se richiesto, quando finisce il
//! lavoro o quando un subagente riceve l'avviso "fermo" o "in loop" (#100). Preferenze in ~/.agent-office/config.json
//! (config.rs), scelte nella finestra Impostazioni; testi nella lingua dell'app (i18n.rs).

use serde_json::{Map, Value};

use crate::i18n::{t, tf};

/// Preferenze dell'app.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Prefs {
    /// notifica quando Claude aspetta un input (permesso, domanda, piano)
    pub notify_waiting: bool,
    /// notifica quando Claude finisce il turno
    pub notify_done: bool,
    /// notifica gli avvisi dei subagenti, fermi o in loop (#100)
    pub notify_alerts: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { notify_waiting: true, notify_done: false, notify_alerts: false }
    }
}

impl Prefs {
    /// Dal contenuto di config.json: chiavi mancanti o non booleane al default.
    pub fn from_config(config: &Map<String, Value>) -> Prefs {
        let d = Prefs::default();
        let flag = |key: &str, default: bool| config.get(key).and_then(Value::as_bool).unwrap_or(default);
        Prefs {
            notify_waiting: flag("notifyWaiting", d.notify_waiting),
            notify_done: flag("notifyDone", d.notify_done),
            notify_alerts: flag("notifyAlerts", d.notify_alerts),
        }
    }
}

pub fn load() -> Prefs {
    Prefs::from_config(&crate::config::read())
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

fn waiting_title(kind: &str) -> String {
    match kind {
        "permission" => t("notify.permission"),
        "question" => t("notify.question"),
        "plan" => t("notify.plan"),
        _ => t("tray.waiting"),
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
                out.push((waiting_title(kind), s.place.clone()));
            }
            continue;
        }
        let was_busy = before.is_some_and(|b| b.waiting.is_none() && matches!(b.status.as_str(), "working" | "entering"));
        if prefs.notify_done && was_busy && s.status == "done" {
            out.push((t("notify.ready"), s.place.clone()));
        }
    }
    out
}

/// Avviso di un subagente, calcolato dal server (`alert` di AgentState): solo nome e numero del tool, mai l'input.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Alert {
    /// nessuna attività da `minutes` minuti
    Stale { minutes: u64 },
    /// `count` chiamate uguali di fila a `tool`
    Loop { tool: String, count: u64 },
}

/// Quanto serve per notificare l'avviso di un subagente.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AlertFacts {
    pub id: String,
    /// nickname del subagente ("Flavia Fetch"), mai la descrizione del compito
    pub name: String,
    /// "progetto · branch" della sessione
    pub place: String,
    pub alert: Alert,
}

/// "1 h 5 min", nelle unità della lingua corrente.
fn duration(minutes: u64) -> String {
    match (minutes / 60, minutes % 60) {
        (0, m) => tf("notify.min", &[("m", &m.max(1).to_string())]),
        (h, 0) => tf("notify.h", &[("h", &h.to_string())]),
        (h, m) => tf("notify.hm", &[("h", &h.to_string()), ("m", &m.to_string())]),
    }
}

/// Notifiche (titolo, testo) per gli avvisi comparsi da `prev` a `next`, con `notify_alerts`: una per avviso, di nuovo
/// solo se l'avviso sparisce e torna o se cambia tipo (da fermo a in loop e viceversa). Pura.
pub fn alert_messages(prev: &[AlertFacts], next: &[AlertFacts], prefs: Prefs) -> Vec<(String, String)> {
    if !prefs.notify_alerts {
        return vec![];
    }
    let same_kind = |a: &Alert, b: &Alert| std::mem::discriminant(a) == std::mem::discriminant(b);
    next.iter()
        .filter(|a| !prev.iter().any(|p| p.id == a.id && same_kind(&p.alert, &a.alert)))
        .map(|a| {
            let title = match &a.alert {
                Alert::Stale { minutes } => tf("notify.alertStale", &[("name", &a.name), ("d", &duration(*minutes))]),
                Alert::Loop { tool, count } => tf("notify.alertLoop", &[("name", &a.name), ("tool", tool), ("n", &count.to_string())]),
            };
            (title, a.place.clone())
        })
        .collect()
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
        assert!(messages(&working, &blocked, Prefs { notify_waiting: false, ..Prefs::default() }).is_empty());
    }

    #[test]
    fn preferenze_da_config() {
        let config = serde_json::json!({ "notifyDone": true, "notifyWaiting": "sì" });
        assert_eq!(Prefs::from_config(config.as_object().unwrap()), Prefs { notify_waiting: true, notify_done: true, notify_alerts: false });
        let config = serde_json::json!({ "notifyAlerts": true });
        assert!(Prefs::from_config(config.as_object().unwrap()).notify_alerts);
        assert_eq!(Prefs::from_config(&Map::new()), Prefs::default());
    }

    #[test]
    fn fine_lavoro_solo_se_richiesta_e_dopo_il_lavoro() {
        let on = Prefs { notify_done: true, ..Prefs::default() };
        let working = [facts("a", "working", None)];
        let done = [facts("a", "done", None)];
        assert!(messages(&working, &done, Prefs::default()).is_empty());
        assert_eq!(messages(&working, &done, on), vec![("Claude è pronto".into(), "a · main".into())]);
        assert!(messages(&done, &done, on).is_empty());
        // dopo una domanda a cui si risponde no: il turno non era "al lavoro"
        assert!(messages(&[facts("a", "working", Some("question"))], &done, on).is_empty());
    }

    fn alert(id: &str, alert: Alert) -> AlertFacts {
        AlertFacts { id: id.into(), name: "Flavia Fetch".into(), place: "agent-office · main".into(), alert }
    }

    #[test]
    fn avvisi_notificati_una_volta_per_avviso() {
        let on = Prefs { notify_alerts: true, ..Prefs::default() };
        let stale = [alert("a", Alert::Stale { minutes: 60 })];
        let later = [alert("a", Alert::Stale { minutes: 75 })];
        let looping = [alert("a", Alert::Loop { tool: "Bash".into(), count: 5 })];
        assert_eq!(alert_messages(&[], &stale, on), vec![("Flavia Fetch è senza attività da 1 h".into(), "agent-office · main".into())]);
        // spento di default
        assert!(alert_messages(&[], &stale, Prefs::default()).is_empty());
        // l'avviso resta (anche con la durata cresciuta): niente doppioni
        assert!(alert_messages(&stale, &later, on).is_empty());
        // cambia tipo: di nuovo
        assert_eq!(alert_messages(&later, &looping, on), vec![("Flavia Fetch ripete Bash 5 volte di fila".into(), "agent-office · main".into())]);
        // più chiamate uguali: è lo stesso avviso
        assert!(alert_messages(&looping, &[alert("a", Alert::Loop { tool: "Bash".into(), count: 6 })], on).is_empty());
        // sparisce e torna: di nuovo
        assert!(alert_messages(&looping, &[], on).is_empty());
        assert_eq!(alert_messages(&[], &looping, on).len(), 1);
        // un altro subagente con lo stesso avviso
        assert_eq!(alert_messages(&stale, &[stale[0].clone(), alert("b", Alert::Stale { minutes: 60 })], on).len(), 1);
    }

    #[test]
    fn durate_degli_avvisi() {
        assert_eq!(duration(0), "1 min");
        assert_eq!(duration(45), "45 min");
        assert_eq!(duration(120), "2 h");
        assert_eq!(duration(65), "1 h 5 min");
    }
}
