# Agent Office

Ufficio 2D in pixel art che mostra in tempo reale gli agenti di Claude Code al lavoro nella cartella corrente. Ogni istanza di Claude Code ha la sua stanza, dove Claude stesso siede alla scrivania del boss come **Claudio Code**: i suoi subagenti entrano dal corridoio, prendono una postazione e lavorano al computer; chi finisce aspetta in sala relax finché lavora un altro agente della stessa istanza, poi escono insieme. A sinistra l'elenco delle istanze (branch, diff, contesto, agenti), a destra la scheda dell'agente cliccato; in alto a destra si passa alla vista lista.

## Installazione (una volta sola)

Requisiti: Node ≥ 22, git.

```bash
git clone git@github.com:mccasor/agent-office.git
cd agent-office
npm install
npm run build       # obbligatorio: crea dist/ (server, hook e pagina web)
npm link            # opzionale: comandi globali agent-office e agent-office-hook
```

Dopo ogni `git pull` rilancia `npm install && npm run build`.

## Avvio

Agent Office mostra gli agenti di Claude Code della **cartella da cui viene avviato** (o di quella indicata con `--cwd`). Avvialo in un secondo terminale, accanto a Claude Code, nella stessa cartella del progetto.

### In generale (con `npm link`)

```bash
cd /percorso/del/progetto         # es. /Library/WebServer/Documents/olimpo-ui
agent-office                      # avvia il server e apre il browser su http://127.0.0.1:4317
```

### Senza `npm link`

```bash
node /Library/WebServer/Documents/agent-office/bin/agent-office.mjs --cwd /percorso/del/progetto
```

### Sulla cartella agent-office stessa

```bash
cd /Library/WebServer/Documents/agent-office
node bin/agent-office.mjs         # oppure: agent-office (se hai fatto npm link)
```

### Opzioni

| Opzione | Effetto | Default |
|---|---|---|
| `--cwd DIR` | cartella da monitorare | cartella corrente |
| `--port N` | porta del server (`0` = porta libera casuale) | `4317` |
| `--no-open` | non apre il browser | apre il browser |

Più progetti contemporaneamente: un'istanza per progetto, ciascuna con una `--port` diversa. Si arresta con `Ctrl+C`.

### Ufficio vuoto?

- Claude Code non è ancora stato usato in quella cartella, oppure nessuna sessione è attiva negli ultimi 10 minuti.
- Gli agenti terminati aspettano in area relax finché lavora un altro agente (attivo negli ultimi 10 minuti); quando hanno finito tutti escono dopo 30 secondi: è normale.

Le sessioni di Claude Code avviate in una **cartella superiore** (es. `/Library/WebServer/Documents`) che lavorano nel progetto vengono trovate automaticamente. Di conseguenza, monitorando una cartella padre compaiono anche le sessioni attive nelle sue sottocartelle.

### Hook (opzionale, consigliato)

Senza hook l'app legge solo i transcript (aggiornamento quasi in tempo reale). Con gli hook gli stati degli agenti (ingresso, lavoro, uscita) sono immediati:

```bash
agent-office install-hooks     # scrive in .claude/settings.local.json del progetto
agent-office uninstall-hooks   # rimuove solo le voci di agent-office
```

L'installazione è idempotente e preserva le altre impostazioni. L'hook non scrive mai su stdout ed esce sempre con 0: non può bloccare Claude Code. Richiede `npm run build` (il binario usa `dist/`).

## App per la menu bar (macOS)

Icona nella topbar con un pallino: **verde** se Claude sta lavorando, **rosso** se aspetta un tuo input (permesso di un tool, domanda), **grigio** se non c'è attività. Al clic si apre una finestra con l'ufficio; in alto a destra si passa alla vista lista, da cui si sceglie quali sessioni mostrare nell'ufficio. Chiudere la finestra la nasconde: l'app resta nella menu bar (menu col tasto destro: apri, installa gli hook, esci).

L'app avvia in background `agent-office --all` sulla porta 4318: tutte le sessioni attive di Claude Code, in qualunque cartella. Richiede Node ≥ 22 (Homebrew o shell di login).

```bash
npm run app:build    # crea src-tauri/target/release/bundle/macos/Agent Office.app (richiede Rust: brew install rustup)
npm run app:dev      # sviluppo
agent-office install-hooks --global   # hook per tutte le sessioni (servono per il pallino rosso)
```

## Impostazioni

Facoltative, in `~/.agent-office/config.json` (lo crea l'app della menu bar quando cambi le notifiche):

```json
{
  "activeWindowMinutes": 10,
  "notifyWaiting": true,
  "notifyDone": false
}
```

- `activeWindowMinutes`: dopo quanti minuti senza attività una sessione non è più considerata aperta
  (sparisce da ufficio, lista e menu). Letto all'avvio del server.
- `notifyWaiting` / `notifyDone`: notifiche di macOS quando Claude aspetta un tuo input o finisce il lavoro;
  si cambiano anche dal menu dell'icona, in Impostazioni.

## Cosa mostra

| Dato | Fonte |
|---|---|
| Agenti: nome, tipo, area, stato, token | `~/.claude/projects/<cwd>/<sessione>/subagents/agent-*.jsonl` + `.meta.json` |
| Issue (es. #14) | numeri citati nella descrizione o nell'ultimo prompt (`#14`, `issue 14`); per Claudio Code, in mancanza, dal branch (`fix/14-...`). Si espone solo il numero |
| Claudio Code (sessione principale) | transcript della sessione principale + hook `UserPromptSubmit`/`Stop` |
| Avanzamento % | todo list dell'agente (`TodoWrite`/`TaskCreate`/`TaskUpdate`); barra indeterminata se assente |
| Modello, effort, contesto, token usati/rimanenti | transcript della sessione principale |
| Progetto, branch, righe +/- | `git` nella cartella monitorata |
| Stato immediato degli agenti | eventi hook in `~/.agent-office/events/<cwd>.jsonl` |
| Attesa di un tuo input ("!" rosso) | domanda senza risposta nel transcript (`AskUserQuestion`, `ExitPlanMode`) + hook `Notification`, attribuito al subagente con `PermissionRequest`/`PreToolUse`; la sessione eredita l'attesa dei suoi subagenti. Mai il testo della domanda |

**Area di lavoro** (backend, frontend, architecture, test, docs, devops, research, other): dedotta da tipo di agente, descrizione e file toccati.

**Token usati** comprende input, output e cache (lettura e creazione) della sessione e di tutti i subagenti.

## Privacy e sicurezza

- Il server ascolta solo su `127.0.0.1` e rifiuta richieste con header `Host` diverso (anti DNS rebinding).
- Espone solo metadati e numeri: mai il testo di prompt, risposte o input dei tool.
- **Testi derivati dai prompt:** il titolo della sessione (scritto da Claude Code) e il nome o la descrizione degli
  agenti (scritti da Claude quando li avvia) riassumono il lavoro richiesto, e vengono mostrati così come sono.
  Anche cartella di lavoro e branch sono esposti. L'API non ha autenticazione: qualunque processo dello stesso Mac,
  anche di un altro utente, può leggerli da `127.0.0.1`. Su un Mac condiviso tienilo presente.
- Il server non fa chiamate di rete verso l'esterno. L'app per la menu bar interroga GitHub
  (`api.github.com`, release del tap `mccasor/homebrew-agent-office`) per cercare gli aggiornamenti: poco dopo
  l'avvio, ogni 6 ore e quando clicchi "Aggiornamenti".

## Limiti noti

- Il formato dei transcript di Claude Code non è documentato: verificato su Claude Code 2.1.306; la lettura è isolata in `src/server/transcript`.
- La finestra di contesto da 1M è riconosciuta dal suffisso `[1m]` (model id o attachment "model") o quando l'uso supera 200k: su Claude Code 2.1.306 non esiste un dato affidabile per riconoscerla prima.

## Architettura

```
~/.claude/projects/<cwd>/*.jsonl ─┐
~/.agent-office/events/*.jsonl  ──┼─> server Node (127.0.0.1) ──SSE──> React + canvas 2D
git (branch, diff --shortstat) ───┘
```

| Modulo | Responsabilità |
|---|---|
| `src/shared` | contratto dati (`Snapshot`) |
| `src/server/transcript` | parsing incrementale dei transcript, classificazione area |
| `src/server/hooks` | hook Claude Code → eventi JSONL, install/uninstall, watcher |
| `src/server/git` | progetto, branch, righe +/- |
| `src/server/state` | aggregazione in `Snapshot` |
| `src/server/http` | API + SSE + statici |
| `src/cli.ts` | comando `agent-office` |
| `src/web/pixel` | ufficio 2D in pixel art: pianta, posti, pathfinding A*, movimento, sprite |
| `src/web/hud` | pannelli, scheda agente e vista lista |
| `src/web/store` | stato client + stream SSE |

## Sviluppo

```bash
npm run dev     # server (tsx watch, porta 4317) + vite con proxy /api
npm run check   # lint + typecheck + build + test
```

Variabili d'ambiente: `CLAUDE_CONFIG_DIR` (default `~/.claude`), `AGENT_OFFICE_DATA_DIR` (default `~/.agent-office`).
