//! Lingua dell'app (#93): icona, tooltip, notifiche, aggiornamenti, esito degli hook, errori del server e delle impostazioni (#103) e titolo
//! della finestra Impostazioni. I testi stanno in `i18n.json`, generato da src/shared/i18n (`npm run
//! settings:catalog`, un test controlla che sia aggiornato) e incluso in compilazione: una sola fonte con le pagine.
//!
//! La lingua è `language` di config.json ("system" | "it" | "en" | "es"): "system" vuol dire la prima lingua
//! supportata tra quelle preferite di macOS, altrimenti italiano. Le stesse lingue di macOS vanno al server
//! (AGENT_OFFICE_LANGUAGES, server.rs), che le risolve allo stesso modo per ufficio e schede; pannello e Impostazioni
//! ricevono la lingua già risolta (`locale` in panel_state e settings_state). Si rilegge quando la finestra
//! Impostazioni salva `language` (load), e vale subito.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::LazyLock;

use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Locale {
    It,
    En,
    Es,
}

impl Locale {
    const ALL: [Locale; 3] = [Locale::It, Locale::En, Locale::Es];

    pub fn code(self) -> &'static str {
        match self {
            Locale::It => "it",
            Locale::En => "en",
            Locale::Es => "es",
        }
    }

    fn from_code(code: &str) -> Option<Locale> {
        Locale::ALL.into_iter().find(|l| l.code() == code)
    }
}

/// testi per lingua: `{ "it": { chiave: testo }, "en": …, "es": … }`
static TEXTS: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("i18n.json")).unwrap_or(Value::Null));
/// lingua corrente, come indice in Locale::ALL
static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn current() -> Locale {
    test_locale().unwrap_or_else(|| Locale::ALL[usize::from(CURRENT.load(Ordering::Relaxed)).min(Locale::ALL.len() - 1)])
}

#[cfg(test)]
thread_local! {
    /// lingua del solo thread di un test (with_locale): i test girano in parallelo e CURRENT è di tutti
    static TEST_LOCALE: std::cell::Cell<Option<Locale>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn test_locale() -> Option<Locale> {
    TEST_LOCALE.get()
}

#[cfg(not(test))]
fn test_locale() -> Option<Locale> {
    None
}

/// Esegue `f` con la lingua `locale`, solo nel thread del test.
#[cfg(test)]
pub fn with_locale<R>(locale: Locale, f: impl FnOnce() -> R) -> R {
    TEST_LOCALE.set(Some(locale));
    let result = f();
    TEST_LOCALE.set(None);
    result
}

fn set(locale: Locale) {
    let index = Locale::ALL.iter().position(|l| *l == locale).unwrap_or(0);
    CURRENT.store(index as u8, Ordering::Relaxed);
}

/// Lingua da usare: quella scelta o, con "system" (o un valore sconosciuto), la prima supportata tra le preferite
/// (`["fr-FR", "es-ES"]`, `"en_US.UTF-8"`); nessuna → italiano. Pura, come resolveLocale in src/shared/i18n.
pub fn resolve(language: &str, preferred: &[String]) -> Locale {
    Locale::from_code(language)
        .or_else(|| {
            preferred.iter().find_map(|tag| {
                let base = tag.trim().to_ascii_lowercase();
                Locale::from_code(base.split(['-', '_', '.', '@']).next().unwrap_or(""))
            })
        })
        .unwrap_or(Locale::It)
}

/// Lingue preferite di macOS (Impostazioni di Sistema → Lingua e Zona), dalla più gradita.
#[cfg(target_os = "macos")]
pub fn system_languages() -> Vec<String> {
    objc2_foundation::NSLocale::preferredLanguages().to_vec().iter().map(|l| l.to_string()).collect()
}

/// Lingue della sessione (Linux), come le sceglie gettext: `LANGUAGE` (elenco separato da `:`), poi la prima tra
/// `LC_ALL`, `LC_MESSAGES` e `LANG`.
#[cfg(not(target_os = "macos"))]
pub fn system_languages() -> Vec<String> {
    env_languages(|name| std::env::var(name).ok())
}

/// Lingue preferite dalle variabili d'ambiente lette con `var`. Con la locale "C" o "POSIX" gettext ignora
/// `LANGUAGE`, e qui si ignora tutto: non sono lingue (vale il default). Pura.
#[cfg(any(not(target_os = "macos"), test))]
pub fn env_languages(var: impl Fn(&str) -> Option<String>) -> Vec<String> {
    let real = |v: &String| !v.is_empty() && v != "C" && v != "POSIX" && !v.starts_with("C.");
    let locale = ["LC_ALL", "LC_MESSAGES", "LANG"].into_iter().find_map(|name| var(name).filter(|v| !v.is_empty()));
    if locale.as_ref().is_some_and(|l| !real(l)) {
        return vec![];
    }
    let mut list: Vec<String> = var("LANGUAGE").unwrap_or_default().split(':').map(str::to_string).filter(real).collect();
    list.extend(locale);
    list
}

/// Rilegge la lingua da config.json e la rende corrente; restituisce quella nuova.
pub fn load() -> Locale {
    let config = crate::config::read();
    let language = config.get("language").and_then(Value::as_str).unwrap_or("system");
    let locale = resolve(language, &system_languages());
    set(locale);
    locale
}

/// Testo `key` nella lingua `locale` (in italiano se manca; la chiave stessa se manca anche lì). Pura.
pub fn text_in(locale: Locale, key: &str) -> String {
    let find = |l: Locale| TEXTS.get(l.code()).and_then(|t| t.get(key)).and_then(Value::as_str);
    find(locale).or_else(|| find(Locale::It)).unwrap_or(key).to_string()
}

/// Testo `key` nella lingua corrente.
pub fn t(key: &str) -> String {
    text_in(current(), key)
}

/// Testo `key` nella lingua corrente con i parametri `{nome}` sostituiti.
pub fn tf(key: &str, params: &[(&str, &str)]) -> String {
    params.iter().fold(t(key), |text, (name, value)| text.replace(&format!("{{{name}}}"), value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn langs(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn lingua_scelta_o_di_sistema() {
        assert_eq!(resolve("en", &langs(&["es-ES"])), Locale::En);
        assert_eq!(resolve("system", &langs(&["fr-FR", "es-MX", "en-US"])), Locale::Es);
        assert_eq!(resolve("system", &langs(&["en_GB.UTF-8"])), Locale::En);
        assert_eq!(resolve("system", &langs(&["de-DE"])), Locale::It);
        assert_eq!(resolve("system", &[]), Locale::It);
        assert_eq!(resolve("klingon", &langs(&["EN"])), Locale::En);
    }

    #[test]
    fn lingue_dalle_variabili_d_ambiente() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| pairs.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string())
        };
        assert_eq!(env_languages(env(&[("LANGUAGE", "es:en"), ("LANG", "it_IT.UTF-8")])), langs(&["es", "en", "it_IT.UTF-8"]));
        assert_eq!(env_languages(env(&[("LC_ALL", "en_US.UTF-8"), ("LANG", "it_IT.UTF-8")])), langs(&["en_US.UTF-8"]));
        assert_eq!(env_languages(env(&[("LC_MESSAGES", "es_ES.UTF-8"), ("LANG", "it_IT.UTF-8")])), langs(&["es_ES.UTF-8"]));
        // locale "C": nessuna lingua, nemmeno da LANGUAGE
        assert_eq!(env_languages(env(&[("LANGUAGE", "en"), ("LC_ALL", "C")])), Vec::<String>::new());
        assert_eq!(env_languages(env(&[("LANG", "C.UTF-8")])), Vec::<String>::new());
        assert_eq!(env_languages(env(&[])), Vec::<String>::new());
        assert_eq!(resolve("system", &env_languages(env(&[("LANGUAGE", "fr:es"), ("LANG", "en_US.UTF-8")]))), Locale::Es);
    }

    #[test]
    fn testi_nelle_tre_lingue() {
        assert_eq!(text_in(Locale::It, "tray.idle"), "Claude è inattivo");
        assert_eq!(text_in(Locale::En, "tray.working"), "Claude is working");
        assert_eq!(text_in(Locale::Es, "notify.ready"), "Claude está listo");
        assert_eq!(text_in(Locale::En, "chiave.inesistente"), "chiave.inesistente");
    }

    /// Ogni chiave usata nel codice (in `t`, `tf` e `text_in`) c'è in tutte le lingue di i18n.json.
    #[test]
    fn chiavi_usate_presenti_in_tutte_le_lingue() {
        let sources = [
            include_str!("main.rs"),
            include_str!("notify.rs"),
            include_str!("updates.rs"),
            include_str!("server.rs"),
            include_str!("settings.rs"),
            include_str!("config.rs"),
            include_str!("i18n.rs"),
            include_str!("tray_menu.rs"),
        ];
        let mut keys = vec![];
        for source in sources {
            for start in ["t(\"", "tf(\"", "text_in(Locale::It, \"", "text_in(Locale::En, \"", "text_in(Locale::Es, \"", "text_in(locale, \""] {
                for (i, _) in source.match_indices(start) {
                    // `t(` e non `expect(` o `set_text(`
                    if source[..i].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_') {
                        continue;
                    }
                    let rest = &source[i + start.len()..];
                    if let Some(end) = rest.find('"') {
                        keys.push(rest[..end].to_string());
                    }
                }
            }
        }
        keys.retain(|k| k != "chiave.inesistente" && !k.is_empty());
        assert!(keys.len() > 20, "{keys:?}");
        for locale in Locale::ALL {
            for key in &keys {
                assert!(TEXTS[locale.code()][key].is_string(), "{} {key}", locale.code());
            }
        }
    }
}
