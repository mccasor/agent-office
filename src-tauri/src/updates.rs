//! Aggiornamenti dell'app: confronto con le release del tap Homebrew su GitHub e voce "Aggiornamenti" del menu.
//! Con una versione nuova la voce diventa "Aggiorna alla versione X" con un pallino blu (freccia in giù), rosso
//! (punto esclamativo) se le versioni mancanti sono OUTDATED_AFTER o più. Il clic aggiorna via Homebrew.

use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use serde_json::Value;

/// Repository del tap: le sue release contengono il .dmg di ogni versione.
pub const TAP: &str = "mccasor/homebrew-agent-office";
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
    Upgrading,
    Failed,
    /// brew non è riuscito ad aggiornare (dettagli nel log)
    UpgradeFailed,
}

/// Badge accanto alla voce: blu con freccia, rosso con "!" oltre OUTDATED_AFTER versioni.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Badge {
    Available,
    Outdated,
}

impl Badge {
    pub fn png(self) -> &'static [u8] {
        match self {
            Badge::Available => include_bytes!("../icons/tray/update-available.png"),
            Badge::Outdated => include_bytes!("../icons/tray/update-outdated.png"),
        }
    }
}

impl UpdateState {
    pub fn from_releases(newer: Vec<String>) -> UpdateState {
        match newer.first() {
            None => UpdateState::UpToDate,
            Some(latest) => UpdateState::Available { latest: latest.clone(), behind: newer.len() },
        }
    }

    pub fn label(&self, current: &str) -> String {
        match self {
            UpdateState::Unknown => "Aggiornamenti".into(),
            UpdateState::Checking => "Ricerca aggiornamenti…".into(),
            UpdateState::UpToDate => format!("Aggiornamenti: la {current} è la più recente"),
            UpdateState::Available { latest, behind } if *behind >= OUTDATED_AFTER => {
                format!("Aggiorna alla versione {latest} ({behind} versioni indietro)")
            }
            UpdateState::Available { latest, .. } => format!("Aggiorna alla versione {latest}"),
            UpdateState::Upgrading => "Aggiornamento in corso…".into(),
            UpdateState::Failed => "Aggiornamenti: ricerca non riuscita, riprova".into(),
            UpdateState::UpgradeFailed => "Aggiornamento non riuscito (~/.agent-office/upgrade.log), riprova".into(),
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
        !matches!(self, UpdateState::Checking | UpdateState::Upgrading)
    }
}

/// Release del tap dall'API di GitHub (curl di sistema: niente TLS da includere nell'app).
pub fn check(current: &str) -> UpdateState {
    let url = format!("https://api.github.com/repos/{TAP}/releases?per_page=100");
    let out = Command::new("/usr/bin/curl")
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

fn brew() -> Option<PathBuf> {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].into_iter().map(PathBuf::from).find(|p| p.exists())
}

/// Come è partito l'aggiornamento.
#[derive(Debug)]
pub enum Upgrade {
    /// brew in corso: chiuderà l'app, la sostituirà e la riaprirà
    Brew(Child),
    /// app non installata da Homebrew: aperta la pagina della release
    Page,
    Failed,
}

/// Aggiorna via Homebrew se l'app è installata dal cask: il processo è staccato dall'app, che brew chiude prima di
/// sostituirla e riapre alla fine. Altrimenti apre la pagina della release.
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
        let page = format!("https://github.com/{TAP}/releases/latest");
        let opened = Command::new("/usr/bin/open").arg(page).status().is_ok_and(|s| s.success());
        return if opened { Upgrade::Page } else { Upgrade::Failed };
    };
    let brew = brew.to_string_lossy().replace('\'', "'\\''");
    let script = format!("'{brew}' update --quiet; '{brew}' upgrade --cask {CASK} && /usr/bin/open -a 'Agent Office'");
    // uscita di brew in ~/.agent-office/upgrade.log, per capire un aggiornamento non riuscito
    let log = std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join(".agent-office/upgrade.log"))
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
    }
}
