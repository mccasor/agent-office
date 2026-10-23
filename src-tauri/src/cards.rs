//! Schede staccabili (#92): nella WebView di Tauri `window.open` non apre nulla, quindi le richieste di nuova finestra
//! dell'ufficio (e delle schede stesse) si intercettano qui. Si accettano solo le schede del server locale
//! (`http://127.0.0.1:<porta>/?card=agent|session&id=...`) e per ognuna si apre una finestra Tauri dedicata, riusata
//! se è già aperta; tutto il resto si nega. Nessun comando né permesso esposto alla pagina remota.
//!
//! La finestra prende l'altezza del contenuto: WKWebView ignora `window.resizeTo`/`resizeBy`, quindi la pagina (che
//! qui riceve `app=1` nell'URL) mette l'altezza desiderata in coda al titolo, dopo un carattere di uso privato
//! (`<nome>\u{E000}<altezza>-<n>`, vedi `src/web/hud/fit.ts`). Il titolo è un canale che l'app legge già, a senso unico
//! e senza IPC: qui si valida (cifre in un intervallo), si toglie la coda dal titolo della finestra e si ridimensiona
//! tenendo fermo l'angolo in alto a sinistra.

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

/// prefisso delle etichette delle finestre delle schede
const LABEL_PREFIX: &str = "card-";
const MAX_ID: usize = 128;
/// separatore tra il nome e l'altezza desiderata nel titolo della pagina
const TITLE_SEPARATOR: char = '\u{E000}';
/// altezze accettate dal titolo (px logici), prima del limite dello schermo
const HEIGHTS: std::ops::RangeInclusive<u32> = 100..=4000;
/// altezza minima della finestra, come `MIN_HEIGHT` in fit.ts
const MIN_HEIGHT: f64 = 280.0;
/// frazione massima dell'altezza dello schermo
const MAX_SCREEN_FRACTION: f64 = 0.85;

/// Finestra di una scheda: etichetta univoca, URL ricostruito (non quello ricevuto) e dimensioni iniziali (l'altezza
/// è una stima: poi la decide il contenuto).
#[derive(Debug, PartialEq)]
pub struct Card {
    pub label: String,
    pub url: String,
    pub size: (f64, f64),
}

/// La finestra è quella di una scheda (si chiude davvero, non si nasconde come l'ufficio).
pub fn is_card(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX)
}

/// Scheda chiesta da `url`, solo se è una scheda del server locale sulla porta `port` con i parametri attesi. Pura.
pub fn card_for(url: &Url, port: u16) -> Option<Card> {
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port() != Some(port) || url.path() != "/" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    let (mut kind, mut id) = (None, None);
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "card" if kind.is_none() => kind = Some(v.into_owned()),
            "id" if id.is_none() => id = Some(v.into_owned()),
            _ => return None,
        }
    }
    let kind = kind.filter(|k| k == "agent" || k == "session")?;
    // id di agente o sessione (`boss:<uuid>`, `a0123…`): lettere, cifre, trattini, trattini bassi e due punti
    let id = id.filter(|id| !id.is_empty() && id.len() <= MAX_ID && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_:".contains(c)))?;
    let size = if kind == "agent" { (360.0, 480.0) } else { (380.0, 360.0) };
    Some(Card {
        label: format!("{LABEL_PREFIX}{kind}-{}", id.replace(':', "_")),
        url: format!("http://127.0.0.1:{port}/?card={kind}&id={}&app=1", id.replace(':', "%3A")),
        size,
    })
}

/// Titolo della pagina della scheda diviso in nome e altezza desiderata (se valida). Pura.
pub fn parse_title(title: &str) -> (&str, Option<u32>) {
    let Some((name, tail)) = title.rsplit_once(TITLE_SEPARATOR) else { return (title, None) };
    let height = tail.split_once('-').and_then(|(height, seq)| {
        let digits = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_digit());
        if !digits(height, 4) || !digits(seq, 1) {
            return None;
        }
        height.parse().ok().filter(|h| HEIGHTS.contains(h))
    });
    (name, height)
}

/// Altezza della finestra: quella chiesta, al massimo l'85% dell'area utile dello schermo (`screen`, se nota). Pura.
pub fn clamp_height(height: u32, screen: Option<f64>) -> f64 {
    let max = screen.map_or(f64::MAX, |s| (s * MAX_SCREEN_FRACTION).floor()).max(MIN_HEIGHT);
    f64::from(height).clamp(MIN_HEIGHT, max)
}

/// Porta la finestra all'altezza chiesta, stessa larghezza, senza spostarne l'angolo in alto a sinistra (in AppKit
/// `setContentSize` tiene fermo quello in basso).
pub(crate) fn fit(window: &WebviewWindow, height: u32) {
    let (Ok(scale), Ok(size), Ok(position)) = (window.scale_factor(), window.inner_size(), window.outer_position()) else {
        return;
    };
    let screen = window.current_monitor().ok().flatten().map(|m| f64::from(m.work_area().size.height) / m.scale_factor());
    let height = clamp_height(height, screen);
    let size = size.to_logical::<f64>(scale);
    if (size.height - height).abs() < 1.0 {
        return;
    }
    let position: LogicalPosition<f64> = position.to_logical(scale);
    let _ = window.set_size(LogicalSize::new(size.width, height));
    let _ = window.set_position(position);
}

/// Gestore delle richieste di nuova finestra: apre (o porta in primo piano) la scheda e nega la finestra di WebKit.
pub fn on_new_window(app: AppHandle, port: u16) -> impl Fn(Url, NewWindowFeatures) -> NewWindowResponse<Wry> + Send + 'static {
    move |url, _| {
        if let Some(card) = card_for(&url, port) {
            let handle = app.clone();
            // dopo il callback di WebKit: creare la finestra al suo interno può bloccare il ciclo degli eventi
            let _ = app.run_on_main_thread(move || open(&handle, card, port));
        }
        NewWindowResponse::Deny
    }
}

/// Finestra della scheda: riusata se già aperta; il titolo segue quello della pagina (nome dell'agente o progetto),
/// l'altezza quella chiesta in coda al titolo.
fn open(app: &AppHandle, card: Card, port: u16) {
    if let Some(window) = app.get_webview_window(&card.label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let Ok(url) = card.url.parse() else { return };
    let window = WebviewWindowBuilder::new(app, &card.label, WebviewUrl::External(url))
        .title("Agent Office")
        .inner_size(card.size.0, card.size.1)
        .min_inner_size(300.0, 280.0)
        .on_document_title_changed(|window, title| {
            let (name, height) = parse_title(&title);
            let _ = window.set_title(name);
            if let Some(height) = height {
                fit(&window, height);
            }
        })
        // anche dalla scheda di un'istanza si apre la scheda di un suo agente
        .on_new_window(on_new_window(app.clone(), port))
        .build();
    if let Ok(window) = window {
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(url: &str) -> Option<Card> {
        card_for(&url.parse().unwrap(), 4318)
    }

    #[test]
    fn scheda_di_un_agente_e_di_un_istanza() {
        assert_eq!(
            card("http://127.0.0.1:4318/?card=agent&id=boss%3A1111-aa"),
            Some(Card {
                label: "card-agent-boss_1111-aa".into(),
                url: "http://127.0.0.1:4318/?card=agent&id=boss%3A1111-aa&app=1".into(),
                size: (360.0, 480.0),
            })
        );
        let s = card("http://127.0.0.1:4318/?card=session&id=s1").unwrap();
        assert_eq!(s.label, "card-session-s1");
        assert!(is_card(&s.label));
        assert!(!is_card("office"));
        // l'ordine dei parametri non conta; l'URL è ricostruito, l'etichetta resta la stessa
        assert_eq!(card("http://127.0.0.1:4318/?id=s1&card=session"), Some(s));
    }

    #[test]
    fn altezza_nel_titolo() {
        assert_eq!(parse_title("Marta Commit"), ("Marta Commit", None));
        assert_eq!(parse_title("Marta Commit\u{E000}412-3"), ("Marta Commit", Some(412)));
        assert_eq!(parse_title("a\u{E000}b\u{E000}300-0"), ("a\u{E000}b", Some(300)));
        assert_eq!(parse_title("\u{E000}300-0"), ("", Some(300)));
        // coda non valida: si toglie dal titolo ma non si ridimensiona
        for tail in ["", "412", "412-", "-3", "412-33", "99-1", "4001-1", "12345-1", "+412-1", "41.2-1", "412-x", "٤١٢-1"] {
            assert_eq!(parse_title(&format!("Marta\u{E000}{tail}")), ("Marta", None), "{tail}");
        }
        assert_eq!(clamp_height(412, Some(1000.0)), 412.0);
        assert_eq!(clamp_height(2000, Some(1000.0)), 850.0);
        assert_eq!(clamp_height(100, Some(1000.0)), MIN_HEIGHT);
        assert_eq!(clamp_height(4000, None), 4000.0);
        // schermo minuscolo: almeno l'altezza minima
        assert_eq!(clamp_height(500, Some(200.0)), MIN_HEIGHT);
    }

    #[test]
    fn rifiuta_tutto_il_resto() {
        for url in [
            "https://127.0.0.1:4318/?card=agent&id=a1",
            "http://localhost:4318/?card=agent&id=a1",
            "http://127.0.0.1:4317/?card=agent&id=a1",
            "http://evil.example/?card=agent&id=a1",
            "http://127.0.0.1:4318/api/snapshot?card=agent&id=a1",
            "http://127.0.0.1:4318/?card=office&id=a1",
            "http://127.0.0.1:4318/?card=agent",
            "http://127.0.0.1:4318/?card=agent&id=",
            "http://127.0.0.1:4318/?card=agent&id=a1&view=list",
            "http://127.0.0.1:4318/?card=agent&id=a1&id=a2",
            "http://127.0.0.1:4318/?card=agent&id=%27);alert(1)//",
            "http://127.0.0.1:4318/?card=agent&id=a1#x",
            "http://127.0.0.1:4318/?card=agent&id=%C3%A01",
            "http://127.0.0.1:4318/?card=agent&id=a%2F..%2Fx",
            "http://u:p@127.0.0.1:4318/?card=agent&id=a1",
            "file:///etc/passwd",
        ] {
            assert_eq!(card(url), None, "{url}");
        }
        assert_eq!(card(&format!("http://127.0.0.1:4318/?card=agent&id={}", "a".repeat(129))), None);
    }
}
