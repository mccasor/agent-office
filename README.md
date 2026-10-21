# Agent Office

Ufficio 3D, visto dall'alto, che mostra in tempo reale gli agenti di Claude Code al lavoro nella cartella corrente.

```bash
cd /percorso/del/progetto     # es. olimpo-ui
npx agent-office              # apre http://127.0.0.1:4317
npx agent-office install-hooks  # opzionale: eventi in tempo reale via hook
```

## Architettura

```
~/.claude/projects/<cwd>/*.jsonl ─┐
~/.agent-office/events/*.jsonl  ──┼─> server Node (127.0.0.1) ──SSE──> React + react-three-fiber
git (branch, diff --shortstat) ───┘
```

| Modulo | Responsabilità |
|---|---|
| `src/shared` | contratto dati (`Snapshot`) |
| `src/server/transcript` | parsing incrementale dei transcript di Claude Code |
| `src/server/hooks` | hook Claude Code → eventi JSONL |
| `src/server/git` | progetto, branch, righe +/- |
| `src/server/state` | aggregazione in `Snapshot` |
| `src/server/http` | API + SSE + statici |
| `src/web/scene` | openspace, posti, pathfinding, movimento |
| `src/web/characters` | personaggi procedurali da preset |
| `src/web/hud` | pannelli ed etichette |
| `src/web/store` | stato client + stream SSE |

Il server non espone mai il contenuto dei prompt: solo metadati e numeri.

## Sviluppo

```bash
npm install
npm run dev     # server + vite
npm run check   # lint + typecheck + test + build
```
