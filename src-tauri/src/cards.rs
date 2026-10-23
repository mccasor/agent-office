//! Schede staccabili (#92): nella WebView di Tauri `window.open` non apre nulla, quindi le richieste di nuova finestra
//! dell'ufficio (e delle schede stesse) si intercettano qui. Si accettano solo le schede del server locale
//! (`http://127.0.0.1:<porta>/?card=agent|session&id=...`) e per ognuna si apre una finestra Tauri dedicata, riusata
//! se è già aperta; tutto il resto si nega. Nessun comando né permesso esposto alla pagina remota.

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};

/// prefisso delle etichette delle finestre delle schede
const LABEL_PREFIX: &str = "card-";
const MAX_ID: usize = 128;

/// Finestra di una scheda: etichetta univoca, URL ricostruito (non quello ricevuto) e dimensioni.
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
    let size = if kind == "agent" { (360.0, 640.0) } else { (380.0, 600.0) };
    Some(Card {
        label: format!("{LABEL_PREFIX}{kind}-{}", id.replace(':', "_")),
        url: format!("http://127.0.0.1:{port}/?card={kind}&id={}", id.replace(':', "%3A")),
        size,
    })
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

/// Finestra della scheda: riusata se già aperta; il titolo segue quello della pagina (nome dell'agente o progetto).
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
            let _ = window.set_title(&title);
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
                url: "http://127.0.0.1:4318/?card=agent&id=boss%3A1111-aa".into(),
                size: (360.0, 640.0),
            })
        );
        let s = card("http://127.0.0.1:4318/?card=session&id=s1").unwrap();
        assert_eq!(s.label, "card-session-s1");
        assert!(is_card(&s.label));
        assert!(!is_card("office"));
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
            "http://u:p@127.0.0.1:4318/?card=agent&id=a1",
            "file:///etc/passwd",
        ] {
            assert_eq!(card(url), None, "{url}");
        }
        assert_eq!(card(&format!("http://127.0.0.1:4318/?card=agent&id={}", "a".repeat(129))), None);
    }
}
