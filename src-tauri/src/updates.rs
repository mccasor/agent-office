//! Aggiornamenti dell'app: confronto con le release del tap Homebrew su GitHub e voce "Aggiornamenti" del menu.
//! Con una versione nuova la voce diventa "Aggiorna alla versione X" con un pallino blu (freccia in giù), rosso
//! (punto esclamativo) se le versioni mancanti sono OUTDATED_AFTER o più. Il clic aggiorna via Homebrew (su Linux
//! apre la pagina della release).

#[cfg(target_os = "macos")]
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use serde_json::Value;

use crate::i18n::{t, tf};

/// Repository del tap: le sue release contengono il .dmg di ogni versione.
pub const TAP: &str = "mccasor/homebrew-agent-office";
#[cfg(target_os = "macos")]
const CASK: &str = "mccasor/agent-office/agent-office";
/// da quante versioni indietro il pallino diventa rosso
pub const OUTDATED_AFTER: usize = 4;

/// Versione `major.minor.patch` (eventuale "v" iniziale; suffissi come "-beta" non sono release stabili).
pub fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let mut parts = s.trim().trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let v = (next()?, next()?, next()?);
    parts.next().is_none().then_some(v)
}

/// Versioni pubblicate più recenti di `current`, dalla più nuova; bozze e prerelease escluse.
pub fn newer_releases(releases_json: &str, current: &str) -> Option<Vec<String>> {
    let current = parse_version(current)?;
    let list: Vec<Value> = serde_json::from_str(releases_json).ok()?;
    let mut newer: Vec<((u64, u64, u64), String)> = list
        .iter()
        .filter(|r| r.get("draft").and_then(Value::as_bool) != Some(true))
        .filter(|r| r.get("prerelease").and_then(Value::as_bool) != Some(true))
        .filter_map(|r| r.get("tag_name").and_then(Value::as_str))
        .filter_map(|tag| parse_version(tag).map(|v| (v, tag.trim_start_matches('v').to_string())))
        .filter(|(v, _)| *v > current)
        .collect();
    newer.sort_by_key(|(v, _)| std::cmp::Reverse(*v));
    newer.dedup_by(|a, b| a.0 == b.0);
    Some(newer.into_iter().map(|(_, s)| s).collect())
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum UpdateState {
    /// ancora nessuna ricerca
    Unknown,
    Checking,
    UpToDate,
    /// versione più recente e quante versioni mancano
    Available { latest: String, behind: usize },
    /// aggiornamento alla versione `latest` in corso
    Upgrading { latest: String },
    Failed,
    /// brew non è riuscito ad aggiornare alla versione `latest` (dettagli nel log): si può riprovare
    UpgradeFailed { latest: String },
}

/// Segnale accanto alla voce (nel pannello): blu con freccia, rosso con "!" da OUTDATED_AFTER versioni indietro.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Badge {
    Available,
    Outdated,
}

impl UpdateState {
    pub fn from_releases(newer: Vec<String>) -> UpdateState {
        match newer.first() {
            None => UpdateState::UpToDate,
            Some(latest) => UpdateState::Available { latest: latest.clone(), behind: newer.len() },
        }
    }

    /// Testo della voce nella lingua dell'app (i18n.rs).
    pub fn label(&self, current: &str) -> String {
        match self {
            UpdateState::Unknown => t("update.idle"),
            UpdateState::Checking => t("update.checking"),
            UpdateState::UpToDate => tf("update.upToDate", &[("v", current)]),
            UpdateState::Available { latest, behind } if *behind >= OUTDATED_AFTER => {
                tf("update.availableBehind", &[("v", latest), ("n", &behind.to_string())])
            }
            UpdateState::Available { latest, .. } => tf("update.available", &[("v", latest)]),
            UpdateState::Upgrading { .. } => t("update.upgrading"),
            UpdateState::Failed => t("update.failed"),
            UpdateState::UpgradeFailed { .. } => t("update.upgradeFailed"),
        }
    }

    pub fn badge(&self) -> Option<Badge> {
        match self {
            UpdateState::Available { behind, .. } if *behind >= OUTDATED_AFTER => Some(Badge::Outdated),
            UpdateState::Available { .. } => Some(Badge::Available),
            _ => None,
        }
    }

    /// cliccabile tranne mentre una ricerca o un aggiornamento è in corso
    pub fn enabled(&self) -> bool {
        !matches!(self, UpdateState::Checking | UpdateState::Upgrading { .. })
    }

    /// Versione da installare col clic su "Aggiorna": quella trovata, o quella di un aggiornamento non riuscito.
    pub fn target(&self) -> Option<&str> {
        match self {
            UpdateState::Available { latest, .. } | UpdateState::UpgradeFailed { latest } => Some(latest),
            _ => None,
        }
    }

    /// Stato dopo una ricerca silenziosa (apertura del pannello, controllo periodico) che ha dato `found`: una ricerca
    /// non riuscita (rete, limite dell'API) non nasconde un aggiornamento già trovato, e niente sostituisce una ricerca
    /// o un aggiornamento in corso. None: lo stato resta com'è. Pura.
    pub fn after_quiet_check(&self, found: UpdateState) -> Option<UpdateState> {
        if !self.enabled() || (found == UpdateState::Failed && self.target().is_some()) || *self == found {
            return None;
        }
        Some(found)
    }
}

/// Release del tap dall'API di GitHub (curl di sistema: niente TLS da includere nell'app).
pub fn check(current: &str) -> UpdateState {
    let url = format!("https://api.github.com/repos/{TAP}/releases?per_page=100");
    // su Linux curl sta quasi sempre in /usr/bin, ma lo si cerca nel PATH
    let curl = if cfg!(target_os = "macos") { "/usr/bin/curl" } else { "curl" };
    let out = Command::new(curl)
        .args(["-fsSL", "-m", "15", "-H", "Accept: application/vnd.github+json", &url])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8(o.stdout)
            .ok()
            .and_then(|body| newer_releases(&body, current))
            .map_or(UpdateState::Failed, UpdateState::from_releases),
        _ => UpdateState::Failed,
    }
}

#[cfg(target_os = "macos")]
fn brew() -> Option<PathBuf> {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].into_iter().map(PathBuf::from).find(|p| p.exists())
}

fn release_page() -> String {
    format!("https://github.com/{TAP}/releases/latest")
}

/// Come è partito l'aggiornamento.
#[derive(Debug)]
pub enum Upgrade {
    /// brew in corso: sostituisce l'app (senza chiuderla: brew gira dentro di lei); poi `relaunch`. Solo macOS.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Brew(Child),
    /// app non installata da Homebrew: aperta la pagina della release
    Page,
    Failed,
}

/// Aggiorna via Homebrew se l'app è installata dal cask, altrimenti apre la pagina della release. brew sostituisce
/// il bundle ma non chiude l'app ("brew is running inside it"): a fine aggiornamento l'app chiama `relaunch`.
#[cfg(target_os = "macos")]
pub fn upgrade() -> Upgrade {
    let installed = brew().filter(|b| {
        Command::new(b)
            .args(["list", "--cask", "agent-office"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    });
    let Some(brew) = installed else {
        return if crate::system::open_url(&release_page()) { Upgrade::Page } else { Upgrade::Failed };
    };
    let brew = brew.to_string_lossy().replace('\'', "'\\''");
    // aggiorna solo il nostro tap: `brew update` passa da tutti i tap e uno irraggiungibile costa minuti
    let script = format!(
        "git -C \"$('{brew}' --repository {TAP})\" pull --quiet --ff-only; HOMEBREW_NO_AUTO_UPDATE=1 '{brew}' upgrade --cask {CASK}"
    );
    // uscita di brew in ~/.agent-office/upgrade.log, per capire un aggiornamento non riuscito
    let log = crate::system::home()
        .map(|h| h.join(".agent-office/upgrade.log"))
        .and_then(|p| {
            std::fs::create_dir_all(p.parent()?).ok()?;
            OpenOptions::new().create(true).append(true).open(p).ok()
        });
    let (out, err) = match log.and_then(|f| Some((f.try_clone().ok()?, f))) {
        Some((a, b)) => (Stdio::from(a), Stdio::from(b)),
        None => (Stdio::null(), Stdio::null()),
    };
    Command::new("/bin/sh")
        .args(["-c", &script])
        // PATH di Homebrew: l'app parte da launchd con un PATH minimo
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_or(Upgrade::Failed, Upgrade::Brew)
}

/// Su Linux niente Homebrew: deb e AppImage si aggiornano dalla pagina della release (il deb poi passa dal gestore
/// dei pacchetti), aperta con xdg-open.
#[cfg(not(target_os = "macos"))]
pub fn upgrade() -> Upgrade {
    if crate::system::open_url(&release_page()) { Upgrade::Page } else { Upgrade::Failed }
}

/// file che la versione appena aggiornata legge all'avvio: contiene la versione di prima
fn marker_path() -> Option<PathBuf> {
    Some(crate::system::home()?.join(".agent-office/updated-from"))
}

/// Dopo un aggiornamento riuscito: avvia la versione nuova (stesso bundle, sostituito da brew), che chiude questa
/// all'avvio (instance::take_over) e mostra l'esito. false se non è stato possibile avviarla.
pub fn relaunch(from: &str) -> bool {
    let Some(bundle) = std::env::current_exe().ok().and_then(|exe| exe.ancestors().nth(3).map(PathBuf::from)) else {
        return false;
    };
    if let Some(path) = marker_path() {
        let _ = std::fs::write(path, from);
    }
    Command::new("/usr/bin/open").arg("-n").arg(bundle).status().is_ok_and(|s| s.success())
}

/// Versione di prima, se l'app è stata appena aggiornata (il file si legge una volta sola).
pub fn take_updated_from() -> Option<String> {
    let path = marker_path()?;
    let from = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(path);
    Some(from.trim().to_string())
}

/// Testo dell'esito per chi è passato da `from` a `current`; None se la versione non è cambiata. Pura.
pub fn updated_message(from: &str, current: &str) -> Option<String> {
    (from != current).then(|| tf("update.done", &[("v", current)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELEASES: &str = r#"[
      {"tag_name": "v0.4.0", "draft": false, "prerelease": false},
      {"tag_name": "v0.5.0-beta", "draft": false, "prerelease": true},
      {"tag_name": "v0.6.0", "draft": true, "prerelease": false},
      {"tag_name": "v0.3.1", "draft": false, "prerelease": false},
      {"tag_name": "v0.3.0", "draft": false, "prerelease": false},
      {"tag_name": "v0.2.0", "draft": false, "prerelease": false},
      {"tag_name": "nightly", "draft": false, "prerelease": false}
    ]"#;

    #[test]
    fn versioni() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("0.10.0"), Some((0, 10, 0)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("1.2.3-beta"), None);
        assert!(parse_version("0.10.0") > parse_version("0.9.9"));
    }

    #[test]
    fn release_piu_recenti_senza_bozze_ne_prerelease() {
        assert_eq!(newer_releases(RELEASES, "0.3.0"), Some(vec!["0.4.0".to_string(), "0.3.1".to_string()]));
        assert_eq!(newer_releases(RELEASES, "0.4.0"), Some(vec![]));
        assert_eq!(newer_releases("non json", "0.3.0"), None);
    }

    #[test]
    fn voce_e_badge() {
        let current = "0.3.0";
        assert_eq!(UpdateState::from_releases(vec![]), UpdateState::UpToDate);
        assert_eq!(UpdateState::UpToDate.label(current), "Aggiornamenti: la 0.3.0 è la più recente");
        assert_eq!(UpdateState::UpToDate.badge(), None);

        let few = UpdateState::from_releases(vec!["0.5.0".into(), "0.4.0".into()]);
        assert_eq!(few, UpdateState::Available { latest: "0.5.0".into(), behind: 2 });
        assert_eq!(few.label(current), "Aggiorna alla versione 0.5.0");
        assert_eq!(few.badge(), Some(Badge::Available));

        let many = UpdateState::from_releases(["0.7.0", "0.6.0", "0.5.0", "0.4.0"].map(String::from).to_vec());
        assert_eq!(many.label(current), "Aggiorna alla versione 0.7.0 (4 versioni indietro)");
        assert_eq!(many.badge(), Some(Badge::Outdated));

        assert!(!UpdateState::Checking.enabled());
        assert!(UpdateState::Failed.enabled());
        assert!(!UpdateState::Upgrading { latest: "0.5.0".into() }.enabled());
        assert_eq!(few.target(), Some("0.5.0"));
        assert_eq!(UpdateState::UpgradeFailed { latest: "0.5.0".into() }.target(), Some("0.5.0"));
        assert_eq!(UpdateState::UpToDate.target(), None);
    }

    #[test]
    fn ricerca_silenziosa() {
        let available = UpdateState::Available { latest: "0.5.0".into(), behind: 1 };
        // la rete non risponde: l'aggiornamento trovato resta
        assert_eq!(available.after_quiet_check(UpdateState::Failed), None);
        assert_eq!(UpdateState::UpgradeFailed { latest: "0.5.0".into() }.after_quiet_check(UpdateState::Failed), None);
        assert_eq!(UpdateState::Unknown.after_quiet_check(UpdateState::Failed), Some(UpdateState::Failed));
        // versione nuova, o già aggiornati da un'altra parte
        let newer = UpdateState::Available { latest: "0.6.0".into(), behind: 2 };
        assert_eq!(available.after_quiet_check(newer.clone()), Some(newer));
        assert_eq!(available.after_quiet_check(UpdateState::UpToDate), Some(UpdateState::UpToDate));
        assert_eq!(available.after_quiet_check(available.clone()), None);
        // un aggiornamento in corso non si tocca
        assert_eq!(UpdateState::Upgrading { latest: "0.5.0".into() }.after_quiet_check(UpdateState::UpToDate), None);
    }

    #[test]
    fn esito_dopo_l_aggiornamento() {
        assert_eq!(updated_message("0.6.0", "0.6.1").as_deref(), Some("Aggiornata alla versione 0.6.1"));
        // brew non ha aggiornato (già all'ultima): niente messaggio
        assert_eq!(updated_message("0.6.1", "0.6.1"), None);
    }
}
