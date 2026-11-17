//! "Riprendi" (#121): una sessione esistente di Claude Code (dallo storico, o chiusa nel terminale) riparte nel
//! terminale integrato. L'ufficio apre `http://127.0.0.1:<porta>/?resume=<uuid>` (cards.rs, `resume_for`), poi:
//!
//! 1. se la sessione ha già una finestra del terminale nell'app, si mostra quella;
//! 2. la cartella è il `cwd` della prima riga del transcript `<cartella di Claude Code>/projects/*/<uuid>.jsonl` che
//!    ce l'ha (lettura limitata, del resto del transcript non si tiene né si scrive niente); senza transcript o senza
//!    una cartella esistente: dialog d'errore, nessun avvio;
//! 3. se il processo della sessione è vivo (un `sessions/<pid>.json` con quel sessionId e il pid vivo; i `.key` della
//!    stessa cartella non si aprono mai), due processi sulla stessa sessione non sono previsti: il dialog propone una
//!    copia (`--fork-session`, session id nuovo) o di annullare;
//! 4. `claude --resume <id>` (o la copia) nella sua finestra, con il registro launched.json (pty.rs).

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::i18n::t;

/// byte letti al più dall'inizio del transcript per trovare il `cwd` (le prime righe lo hanno)
const MAX_SCAN: u64 = 4 * 1024 * 1024;

/// Transcript della sessione `session_id` (un uuid) in `<claude_home>/projects/<progetto>/<uuid>.jsonl`.
pub fn find_transcript(claude_home: &Path, session_id: &str) -> Option<PathBuf> {
    if !crate::pty::is_uuid(session_id) {
        return None;
    }
    let name = format!("{session_id}.jsonl");
    std::fs::read_dir(claude_home.join("projects")).ok()?.flatten().map(|dir| dir.path().join(&name)).find(|p| p.is_file())
}

/// `cwd` (percorso assoluto) della prima riga JSON che lo ha, nei primi `limit` byte di `reader`; righe rotte o
/// troncate dal limite si saltano.
pub fn cwd_from_transcript(reader: impl Read, limit: u64) -> Option<String> {
    let mut reader = BufReader::new(reader.take(limit));
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line).ok()? == 0 {
            return None;
        }
        // prima del parse: quasi tutte le righe senza cwd si scartano subito
        if !line.windows(5).any(|w| w == b"\"cwd\"") {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else { continue };
        if let Some(cwd) = value["cwd"].as_str().filter(|c| Path::new(c).is_absolute()) {
            return Some(cwd.to_string());
        }
    }
}

/// Cartella in cui riprendere la sessione: il `cwd` del transcript, se è una cartella che esiste.
pub fn session_cwd(claude_home: &Path, session_id: &str) -> Option<PathBuf> {
    let file = std::fs::File::open(find_transcript(claude_home, session_id)?).ok()?;
    Some(PathBuf::from(cwd_from_transcript(file, MAX_SCAN)?)).filter(|p| p.is_dir())
}

/// pid e sessionId di un file di sessione di Claude Code (`sessions/<pid>.json`). Pura.
fn session_entry(text: &str) -> Option<(u32, String)> {
    let value: Value = serde_json::from_str(text).ok()?;
    let pid = u32::try_from(value["pid"].as_u64()?).ok().filter(|p| *p > 0)?;
    Some((pid, value["sessionId"].as_str()?.to_string()))
}

/// Un processo vivo (`alive`) di Claude Code ha aperta la sessione `session_id`, secondo i file `<pid>.json` di
/// `sessions_dir`. Solo quei file: i `<pid>.<hash>.key` contengono dei token e non si aprono mai.
pub fn running_elsewhere(sessions_dir: &Path, session_id: &str, alive: impl Fn(u32) -> bool) -> bool {
    let Ok(dir) = std::fs::read_dir(sessions_dir) else { return false };
    dir.flatten().any(|f| {
        let name = f.file_name();
        let is_session_file = name.to_str().and_then(|n| n.strip_suffix(".json")).is_some_and(|stem| !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit()));
        is_session_file
            && std::fs::read_to_string(f.path()).ok().and_then(|text| session_entry(&text)).is_some_and(|(pid, id)| id == session_id && alive(pid))
    })
}

/// Dialog nativo d'errore (nessun avvio).
fn error(app: &AppHandle, text: String) {
    app.dialog().message(text).title("Agent Office").kind(MessageDialogKind::Error).show(|_| {});
}

/// Avvia `claude --resume` (o la copia) sul thread principale, dove si creano le finestre.
fn launch(app: AppHandle, cwd: PathBuf, session_id: String, fork: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = crate::pty::resume(&handle, cwd, &session_id, fork) {
            error(&handle, e);
        }
    });
}

/// "Riprendi" della sessione `session_id` (già validata da `resume_for`), dal thread principale.
pub fn start(app: AppHandle, session_id: String) {
    if crate::pty::reveal(&app, &session_id) {
        return;
    }
    // letture su disco fuori dal thread principale
    std::thread::spawn(move || {
        let home = crate::system::claude_home();
        let Some(cwd) = home.as_deref().and_then(|h| session_cwd(h, &session_id)) else {
            return error(&app, t("resume.notFound"));
        };
        let busy = home.is_some_and(|h| running_elsewhere(&h.join("sessions"), &session_id, crate::launched::alive));
        if !busy {
            return launch(app, cwd, session_id, false);
        }
        let app2 = app.clone();
        app.dialog()
            .message(t("resume.runningElsewhere"))
            .title("Agent Office")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(t("resume.fork"), t("resume.cancel")))
            .show(move |ok| {
                if ok {
                    launch(app2, cwd, session_id, true);
                }
            });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const OTHER: &str = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

    /// Cartella vuota nuova per un test.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agent-office-resume-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cwd(text: &str) -> Option<String> {
        cwd_from_transcript(text.as_bytes(), MAX_SCAN)
    }

    #[test]
    fn cwd_dalla_prima_riga_che_lo_ha() {
        let transcript = concat!(
            r#"{"type":"mode","mode":"normal"}"#,
            "\n",
            r#"{"type":"file-history-snapshot","snapshot":{}}"#,
            "\n",
            r#"{"type":"user","cwd":"/Users/a/progetto","message":{"content":"ciao \"cwd\""}}"#,
            "\n",
            r#"{"type":"user","cwd":"/Users/a/altro"}"#,
            "\n"
        );
        assert_eq!(cwd(transcript).as_deref(), Some("/Users/a/progetto"));
        // ultima riga senza a capo
        assert_eq!(cwd(r#"{"cwd":"/tmp"}"#).as_deref(), Some("/tmp"));
    }

    #[test]
    fn cwd_mancante_o_rotto() {
        assert_eq!(cwd(""), None);
        assert_eq!(cwd("{\"type\":\"user\"}\n{\"type\":\"assistant\"}\n"), None);
        // righe rotte, cwd non stringa o relativo: si saltano
        let transcript = "{\"cwd\":\"/rotto\n{\"cwd\":42}\n{\"cwd\":\"relativo/x\"}\n{\"cwd\":\"\"}\nnon json \"cwd\"\n{\"cwd\":\"/buono\"}\n";
        assert_eq!(cwd(transcript).as_deref(), Some("/buono"));
        // byte non UTF-8 in una riga: saltata
        let mut bytes = b"{\"cwd\":\"/a\xff\"}\n".to_vec();
        bytes.extend(b"{\"cwd\":\"/b\"}\n");
        assert_eq!(cwd_from_transcript(&bytes[..], MAX_SCAN).as_deref(), Some("/b"));
    }

    #[test]
    fn cwd_con_lettura_limitata() {
        // una prima riga enorme senza cwd: oltre il limite non si legge
        let big = format!("{{\"type\":\"summary\",\"text\":\"{}\"}}\n{{\"cwd\":\"/dopo\"}}\n", "x".repeat(2000));
        assert_eq!(cwd_from_transcript(big.as_bytes(), 1000), None);
        assert_eq!(cwd_from_transcript(big.as_bytes(), 10_000).as_deref(), Some("/dopo"));
        // riga del cwd tagliata dal limite: niente valore a metà
        assert_eq!(cwd_from_transcript(&b"{\"cwd\":\"/molto/lungo\"}\n"[..], 12), None);
        // cwd in testa a un file grande: trovato senza leggere il resto
        let mut huge = b"{\"cwd\":\"/presto\"}\n".to_vec();
        huge.resize(huge.len() + 2 * MAX_SCAN as usize, b'x');
        assert_eq!(cwd_from_transcript(&huge[..], MAX_SCAN).as_deref(), Some("/presto"));
    }

    #[test]
    fn transcript_e_cartella_della_sessione() {
        let home = temp_dir("transcript");
        let project = home.join("projects/-Users-a-progetto");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(home.join("projects/vuoto")).unwrap();
        let dir = home.join("lavoro");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(project.join(format!("{ID}.jsonl")), format!("{{\"type\":\"mode\"}}\n{{\"cwd\":{:?}}}\n", dir.to_str().unwrap())).unwrap();
        assert_eq!(find_transcript(&home, ID), Some(project.join(format!("{ID}.jsonl"))));
        assert_eq!(session_cwd(&home, ID), Some(dir.clone()));
        // nessun transcript, id non valido, cartella senza projects
        assert_eq!(session_cwd(&home, OTHER), None);
        assert_eq!(find_transcript(&home, "../x"), None);
        assert_eq!(session_cwd(&home.join("nessuna"), ID), None);
        // cartella del transcript sparita: nessun avvio
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(session_cwd(&home, ID), None);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn sessione_aperta_altrove() {
        let dir = temp_dir("sessions");
        std::fs::write(dir.join("100.json"), format!(r#"{{"pid":100,"sessionId":"{ID}","status":"idle"}}"#)).unwrap();
        std::fs::write(dir.join("200.json"), format!(r#"{{"pid":200,"sessionId":"{OTHER}"}}"#)).unwrap();
        std::fs::write(dir.join("300.json"), "{rotto").unwrap();
        // un `.key` con dentro la sessione non conta: non si apre
        std::fs::write(dir.join(format!("400.{}.key", "ab".repeat(32))), format!(r#"{{"pid":400,"sessionId":"{ID}"}}"#)).unwrap();
        std::fs::write(dir.join("x500.json"), format!(r#"{{"pid":500,"sessionId":"{ID}"}}"#)).unwrap();
        assert!(running_elsewhere(&dir, ID, |pid| pid == 100));
        // file rimasto ma processo terminato
        assert!(!running_elsewhere(&dir, ID, |pid| pid == 200));
        assert!(!running_elsewhere(&dir, ID, |pid| pid == 400 || pid == 500));
        assert!(running_elsewhere(&dir, OTHER, |pid| pid == 200));
        // nessuna cartella: sconosciuta, si riprende
        assert!(!running_elsewhere(&dir.join("nessuna"), ID, |_| true));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn file_di_sessione() {
        assert_eq!(session_entry(&format!(r#"{{"pid":7,"sessionId":"{ID}"}}"#)), Some((7, ID.into())));
        assert_eq!(session_entry(r#"{"pid":0,"sessionId":"a"}"#), None);
        assert_eq!(session_entry(r#"{"pid":-1,"sessionId":"a"}"#), None);
        assert_eq!(session_entry(r#"{"pid":"7","sessionId":"a"}"#), None);
        assert_eq!(session_entry(r#"{"pid":7}"#), None);
        assert_eq!(session_entry("[]"), None);
    }
}
