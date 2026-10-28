//! Menu nativo del tray su Linux (#107). Lì l'icona passa da AppIndicator, che mostra solo un menu e non manda i clic:
//! il pannello di macOS (panel.rs) non si aprirebbe mai. Il menu ne riprende l'essenziale: lo stato (non cliccabile),
//! le istanze aperte (aprono la lista su quella sessione), "Apri ufficio", "Impostazioni…", l'aggiornamento se ce n'è
//! uno e "Esci". Si ricostruisce solo quando cambia una voce (stato, istanze, aggiornamento, lingua).

use crate::i18n::{t, tf};
use crate::notify::SessionFacts;
use crate::updates::UpdateState;

/// prefisso dell'id delle voci delle istanze, seguito dall'id della sessione
const SESSION: &str = "session:";
/// istanze mostrate al più: il menu non deve uscire dallo schermo
const MAX_SESSIONS: usize = 12;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Entry {
    Item { id: String, label: String, enabled: bool },
    Separator,
}

fn item(id: &str, label: String, enabled: bool) -> Entry {
    Entry::Item { id: id.to_string(), label, enabled }
}

/// Voci del menu per lo stato `status` (già a parole), le istanze attive, l'aggiornamento e la versione corrente,
/// nella lingua dell'app. Pura.
pub fn entries(status: String, sessions: &[SessionFacts], update: &UpdateState, current: &str) -> Vec<Entry> {
    let mut list = vec![item("status", status, false)];
    if !sessions.is_empty() {
        list.push(Entry::Separator);
        for s in sessions.iter().take(MAX_SESSIONS) {
            let label = if s.waiting.is_some() { tf("tray.instanceWaiting", &[("place", &s.place)]) } else { s.place.clone() };
            list.push(item(&format!("{SESSION}{}", s.id), label, true));
        }
    }
    list.push(Entry::Separator);
    list.push(item("open-office", t("tray.openOffice"), true));
    list.push(item("settings", t("tray.settings"), true));
    // solo con un aggiornamento trovato (o in corso, o da riprovare): le ricerche stanno nelle Impostazioni
    if update.target().is_some() || matches!(update, UpdateState::Upgrading { .. }) {
        list.push(item("update", update.label(current), update.enabled()));
    }
    list.push(Entry::Separator);
    list.push(item("quit", t("tray.quit"), true));
    list
}

/// Testo per muda, che su GTK tratta `&` come segno della scorciatoia (`&&` è una `&` vera; `_` lo raddoppia lei).
/// Pura.
pub fn menu_label(label: &str) -> String {
    label.replace('&', "&&")
}

#[cfg(target_os = "linux")]
pub fn build(app: &tauri::AppHandle, entries: &[Entry]) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::new(app)?;
    for entry in entries {
        match entry {
            Entry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
            Entry::Item { id, label, enabled } => menu.append(&MenuItem::with_id(app, id.as_str(), menu_label(label), *enabled, None::<&str>)?)?,
        }
    }
    Ok(menu)
}

/// Sostituisce il menu del tray con `next`, se è diverso da quello mostrato (`shown`, aggiornato).
#[cfg(target_os = "linux")]
pub fn sync(app: &tauri::AppHandle, shown: &mut Vec<Entry>, next: Vec<Entry>) {
    if *shown == next {
        return;
    }
    let Some(tray) = app.tray_by_id(crate::TRAY_ID) else { return };
    if let Ok(menu) = build(app, &next) {
        if tray.set_menu(Some(menu)).is_ok() {
            *shown = next;
        }
    }
}

/// Clic su una voce del menu.
#[cfg(target_os = "linux")]
pub fn on_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    if let Some(session) = id.strip_prefix(SESSION) {
        crate::show_office(app, "list", Some(session));
        return;
    }
    match id {
        "open-office" => crate::show_office(app, "pixel", None),
        "settings" => crate::settings::open(app),
        "update" => crate::on_updates_click(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{with_locale, Locale};

    fn session(id: &str, place: &str, waiting: bool) -> SessionFacts {
        SessionFacts { id: id.into(), place: place.into(), status: "working".into(), waiting: waiting.then(|| "permission".into()) }
    }

    fn labels(entries: &[Entry]) -> Vec<String> {
        entries
            .iter()
            .map(|e| match e {
                Entry::Item { label, .. } => label.clone(),
                Entry::Separator => "-".into(),
            })
            .collect()
    }

    #[test]
    fn voci_senza_istanze_ne_aggiornamenti() {
        let list = with_locale(Locale::It, || entries("Claude è inattivo".into(), &[], &UpdateState::UpToDate, "0.7.5"));
        assert_eq!(labels(&list), ["Claude è inattivo", "-", "Apri ufficio", "Impostazioni…", "-", "Esci da Agent Office"]);
        // lo stato non è cliccabile
        assert_eq!(list[0], Entry::Item { id: "status".into(), label: "Claude è inattivo".into(), enabled: false });
    }

    #[test]
    fn voci_con_istanze_e_aggiornamento() {
        let sessions = [session("s1", "agent-office · main", true), session("s2", "olimpo-ui", false)];
        let update = UpdateState::Available { latest: "0.8.0".into(), behind: 1 };
        let list = with_locale(Locale::En, || entries("Claude is working".into(), &sessions, &update, "0.7.5"));
        assert_eq!(
            labels(&list),
            [
                "Claude is working",
                "-",
                "agent-office · main · waiting for your input",
                "olimpo-ui",
                "-",
                "Open Office",
                "Settings…",
                "Update to Version 0.8.0",
                "-",
                "Quit Agent Office"
            ]
        );
        assert!(matches!(&list[2], Entry::Item { id, enabled: true, .. } if id == "session:s1"));
        // aggiornamento in corso: voce presente ma non cliccabile
        let upgrading = with_locale(Locale::It, || entries(String::new(), &[], &UpdateState::Upgrading { latest: "0.8.0".into() }, "0.7.5"));
        assert!(upgrading.iter().any(|e| matches!(e, Entry::Item { id, enabled: false, .. } if id == "update")));
    }

    #[test]
    fn istanze_al_piu_max_sessions() {
        let sessions: Vec<_> = (0..20).map(|i| session(&format!("s{i}"), "p", false)).collect();
        let list = entries(String::new(), &sessions, &UpdateState::Unknown, "0.7.5");
        assert_eq!(list.iter().filter(|e| matches!(e, Entry::Item { id, .. } if id.starts_with(SESSION))).count(), MAX_SESSIONS);
    }

    #[test]
    fn e_commerciale_non_diventa_scorciatoia() {
        assert_eq!(menu_label("R&D · main"), "R&&D · main");
        assert_eq!(menu_label("snake_case"), "snake_case");
    }
}
