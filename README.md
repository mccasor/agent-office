# Agent Office

Ufficio 3D, visto dall'alto, che mostra in tempo reale gli agenti di Claude Code al lavoro nella cartella corrente: entrano dalla porta, si siedono a un posto libero e mostrano nome, area di lavoro, avanzamento e token.

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
- Gli agenti terminati escono dall'ufficio dopo 30 secondi: è normale.

Le sessioni di Claude Code avviate in una **cartella superiore** (es. `/Library/WebServer/Documents`) che lavorano nel progetto vengono trovate automaticamente. Di conseguenza, monitorando una cartella padre compaiono anche le sessioni attive nelle sue sottocartelle.

### Hook (opzionale, consigliato)

Senza hook l'app legge solo i transcript (aggiornamento quasi in tempo reale). Con gli hook gli stati degli agenti (ingresso, lavoro, uscita) sono immediati:

```bash
agent-office install-hooks     # scrive in .claude/settings.local.json del progetto
agent-office uninstall-hooks   # rimuove solo le voci di agent-office
```

L'installazione è idempotente e preserva le altre impostazioni. L'hook non scrive mai su stdout ed esce sempre con 0: non può bloccare Claude Code. Richiede `npm run build` (il binario usa `dist/`).

## Cosa mostra

| Dato | Fonte |
|---|---|
| Agenti: nome, tipo, area, stato, token | `~/.claude/projects/<cwd>/<sessione>/subagents/agent-*.jsonl` + `.meta.json` |
| Avanzamento % | todo list dell'agente (`TodoWrite`/`TaskCreate`/`TaskUpdate`); barra indeterminata se assente |
| Modello, effort, contesto, token usati/rimanenti | transcript della sessione principale |
| Progetto, branch, righe +/- | `git` nella cartella monitorata |
| Stato immediato degli agenti | eventi hook in `~/.agent-office/events/<cwd>.jsonl` |

**Area di lavoro** (backend, frontend, architecture, test, docs, devops, research, other): dedotta da tipo di agente, descrizione e file toccati.

**Token usati** comprende input, output e cache (lettura e creazione) della sessione e di tutti i subagenti.

## Privacy e sicurezza

- Il server ascolta solo su `127.0.0.1` e rifiuta richieste con header `Host` diverso (anti DNS rebinding).
- Espone solo metadati e numeri: mai il testo di prompt, risposte o input dei tool.
- Nessuna chiamata di rete verso l'esterno.

## Limiti noti

- Il formato dei transcript di Claude Code non è documentato: verificato su Claude Code 2.1.306; la lettura è isolata in `src/server/transcript`.
- La finestra di contesto da 1M è riconosciuta dal suffisso `[1m]` (model id o attachment "model") o quando l'uso supera 200k: su Claude Code 2.1.306 non esiste un dato affidabile per riconoscerla prima.

## Architettura

```
~/.claude/projects/<cwd>/*.jsonl ─┐
~/.agent-office/events/*.jsonl  ──┼─> server Node (127.0.0.1) ──SSE──> React + react-three-fiber
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
| `src/web/scene` | openspace, posti, pathfinding A*, movimento |
| `src/web/characters` | personaggi procedurali da preset |
| `src/web/hud` | pannelli ed etichette |
| `src/web/store` | stato client + stream SSE |

## Sviluppo

```bash
npm run dev     # server (tsx watch, porta 4317) + vite con proxy /api
npm run check   # lint + typecheck + build + test
```

Variabili d'ambiente: `CLAUDE_CONFIG_DIR` (default `~/.claude`), `AGENT_OFFICE_DATA_DIR` (default `~/.agent-office`).
