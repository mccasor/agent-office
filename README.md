# Agent Office

Ufficio 3D, visto dall'alto, che mostra in tempo reale gli agenti di Claude Code al lavoro nella cartella corrente: entrano dalla porta, si siedono a un posto libero e mostrano nome, area di lavoro, avanzamento e token.

## Installazione

```bash
git clone git@github.com:mccasor/agent-office.git
cd agent-office
npm install && npm run build
npm link            # rende disponibili i comandi agent-office e agent-office-hook
```

## Uso

Avvialo dalla stessa cartella in cui lavora Claude Code:

```bash
cd /Library/WebServer/Documents/olimpo-ui
agent-office                 # apre http://127.0.0.1:4317
agent-office --port 5000 --no-open
agent-office --cwd /altro/progetto
```

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
- La finestra di contesto da 1M è riconosciuta dal suffisso `[1m]` o quando l'uso supera 200k.

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
