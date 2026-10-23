# Agent Office

A pixel-art 2D office that shows your Claude Code agents at work, in real time. Each Claude Code instance gets its own room, where Claude itself sits at the boss's desk as **Claudio Code**. Its subagents walk in from the corridor, take a workstation and work at the computer; those who finish wait in the lounge while another agent of the same instance is still working, then they all leave together.

It runs as a macOS menu bar app (all active Claude Code sessions, in any folder) or as a command-line server for a single folder, viewed in the browser. Everything stays on your Mac: Agent Office only reads Claude Code's local transcripts and, optionally, events from its hooks.

## Installation

### macOS app (recommended)

```bash
brew install --cask mccasor/agent-office/agent-office
```

The cask comes from the public tap [`mccasor/homebrew-agent-office`](https://github.com/mccasor/homebrew-agent-office) and installs Node as a dependency (the office server runs on Node ≥ 22). The app is ad-hoc signed and not notarized; the cask removes the quarantine flag so macOS opens it without asking.

After installing, open the panel from the menu bar icon and, under "Impostazioni" (Settings):

- **"Hook di Claude Code" → "Installa"** (Claude Code hooks → Install): installs the global hooks, needed for the red dot (permissions and questions) and for instant agent states;
- **"Avvia al login"** (Launch at login): keeps the app in the menu bar after a restart.

Updates: click the update banner in the panel ("Aggiorna alla versione X", Update to version X), or run

```bash
brew upgrade --cask agent-office
```

Then reinstall the hooks (see [Hooks](#hooks)). To uninstall, remove the hooks first ("Rimuovi", Remove), then `brew uninstall --cask agent-office` (`--zap` also deletes `~/.agent-office`).

### From source (CLI)

Requirements: Node ≥ 22, git.

```bash
git clone git@github.com:mccasor/agent-office.git
cd agent-office
npm install
npm run build       # required: builds dist/ (server, hook and web page)
npm link            # optional: global agent-office and agent-office-hook commands
```

After every `git pull`, run `npm install && npm run build` again.

## Usage (CLI)

By default Agent Office shows the Claude Code agents of the **folder it is started from** (or the one given with `--cwd`). Run it in a second terminal next to Claude Code, in the same project folder:

```bash
cd /path/to/project
agent-office                      # starts the server and opens http://127.0.0.1:4317
```

Without `npm link`:

```bash
node /path/to/agent-office/bin/agent-office.mjs --cwd /path/to/project
```

| Option | Effect | Default |
|---|---|---|
| `--cwd DIR` | folder to monitor | current folder |
| `--all` | all active Claude Code sessions, in any folder (what the menu bar app uses) | off |
| `--port N` | server port (`0` = random free port) | `4317` |
| `--no-open` | do not open the browser | opens the browser |

| Command | Effect |
|---|---|
| `agent-office install-hooks` | installs the hooks for this project (`.claude/settings.local.json`) |
| `agent-office install-hooks --global` | installs the hooks for every session (`~/.claude/settings.json`) |
| `agent-office uninstall-hooks [--global]` | removes only Agent Office's entries |

`--cwd` accepts any folder: sessions started in a **parent folder** (e.g. `~/code`) that work inside the project are found automatically, so monitoring a parent folder also shows the active sessions of its subfolders. To watch several projects at once, start one server per project, each with a different `--port`, or a single one with `--all`. Stop it with `Ctrl+C`.

### Empty office?

- Claude Code has not been used in that folder yet, or no session has been active in the last 10 minutes (`activeWindowMinutes`, see [Settings](#settings)).
- Finished agents wait in the lounge while another agent of the same instance is working (active in the last 10 minutes); once everyone is done they leave after 30 seconds. This is expected.

## Hooks

Without hooks Agent Office only reads the transcripts (near real time). With the hooks, agent states (entering, working, leaving) are instant and Agent Office knows when Claude is blocked on you (tool permission, question).

The hooks register these Claude Code events: `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`, `Notification`, `PermissionRequest`. Each event is appended as one JSON line (event name, session and agent id, agent type, tool name, working folder, time) to `~/.agent-office/events/<folder>.jsonl`.

- Installing is idempotent and keeps your other settings; uninstalling removes only Agent Office's entries.
- The hook never writes to stdout and always exits with 0: it cannot block Claude Code. If Agent Office is removed without uninstalling the hooks, the hook command does nothing.
- The hook runs with an absolute Node path (`AGENT_OFFICE_NODE` if set, otherwise the Node running the command; the app passes the one it uses). From source it needs `npm run build`.
- **After updating, reinstall the hooks** (panel → "Installa", or `agent-office install-hooks [--global]`): older installs lack `PermissionRequest`, which is used to tell which subagent is waiting for a permission.

## Menu bar app (macOS)

The menu bar icon (a pixel-art monitor on a desk) has a status dot: **green** when Claude is working, **red** when it is waiting for your input (tool permission, question, plan approval), **grey** when nothing is active. Clicking it opens a panel with:

| Section | Content |
|---|---|
| Update banner | shown when a newer version exists; blue arrow, red "!" when 4 or more versions behind. Clicking it updates via Homebrew (only this tap is refreshed), then the new version starts, closes the old one and says "Aggiornata alla versione X" (Updated to version X) in the panel and in a notification; if the app was not installed with Homebrew it opens the release page |
| Status | what Claude is doing (working, waiting for you, idle), how many instances are open, or why the server is unreachable |
| "Impostazioni" (Settings) | "Apri ufficio" (Open office), "Avvia al login" (Launch at login), "Notifica quando Claude aspetta" / "Notifica quando Claude è pronto" (notify when Claude is waiting / done), "Hook di Claude Code" with "Installa" / "Rimuovi" (install / remove the global hooks), "Cerca aggiornamenti" (Check for updates) |
| "Istanze aperte" (Open instances) | each active instance with project, branch and context used; below it, its agents with the tool in use. Clicking one opens the list view on that instance |
| "Esci da Agent Office" | quits the app (and its server) |

Other behaviour:

- **One copy at a time**: the most recently launched copy closes the others (e.g. an old version still open after an update, or a local build).
- **Server supervisor**: the app runs `agent-office --all` on port **4318** (the CLI defaults to 4317, so both can run together) and restarts it if it exits, with increasing delays. Server output goes to `~/.agent-office/server.log` (overwritten at each start); the panel shows the last error. If another Agent Office server already answers on 4318 it is reused; if another program holds the port, the panel says so. The server stops when the app quits.
- **Node lookup**: `AGENT_OFFICE_NODE`, then `/opt/homebrew/bin/node`, `/usr/local/bin/node`, then the login shell's `node` (nvm, fnm, asdf...). Version 22 or later is required.
- **Notifications**: macOS notifications when a session gets blocked on you (on by default) and, optionally, when Claude finishes its turn.
- **Office window**: closing it only hides it; the app stays in the menu bar.
- **Detachable cards**: an agent card or an instance's details open in their own window (one window per card, reused if already open).
- **Launch at login** uses a user LaunchAgent (`~/Library/LaunchAgents/app.agent-office.menubar.plist`).
- **Updates** are checked shortly after launch, every 6 hours and from "Cerca aggiornamenti"; the output of `brew upgrade` goes to `~/.agent-office/upgrade.log`.

## What it shows

### Office ("Ufficio")

- A fixed floor plan: a corridor with the entrance on the west side, **5 instance rooms** (8 workstations and the boss's desk each) and a **lounge** with foosball table, arcade cabinet, vending machine, fridge, coffee machine and sofas. Instances beyond the fifth have no room: their agents work in the corridor.
- Zoom with the buttons or ⌘/Ctrl + scroll wheel, fit to window, pan by dragging.
- Every subagent gets a stable person name derived from its id (e.g. "Marta Commit"), shown with a role chip: backend, frontend, design, architect, QA, docs, devops, research, generalist. The role is inferred from the agent type, its description and the files it touches.
- Screens at the workstations are animated with a theme that matches the role of whoever is working there; agents resting in the lounge may be playing foosball.
- A red "!" marks who is blocked on you, subagents included: the instance inherits the wait of its subagents.
- Clicking a character opens its **agent card**: name, task, issue, role, type, status, tool in use, duration, model, estimated cost, token breakdown, progress, and (for Claudio Code) project, branch, effort and context used.
- The left panel lists the instances as an accordion (branch, uncommitted diff, context, agents with status and tool). Agent cards and instance details can be **detached** into separate windows.

### List ("Lista")

Switch views from the top-right toggle. One block per instance: status dot, project, branch, issues, session title, diff, model, effort, output tokens, estimated cost, age, status or tool, context bar, and its agents with role, status, tool, duration and progress. A filter bar searches project, branch or agent and offers "Solo in attesa" (only waiting) and "Nascondi terminati" (hide finished). The "Nell'ufficio" (In the office) checkbox picks which instances appear in the office. "Terminati oggi" (Finished today) lists the agents that finished today and have already left.

### Data sources

| Data | Source |
|---|---|
| Agents: name, type, role, status, tokens, tool in use | `~/.claude/projects/<folder>/<session>/subagents/agent-*.jsonl` + `.meta.json` |
| Claudio Code (main session): status, title, model, effort, context, tokens | main session transcript + hooks |
| Issues (e.g. #14) | numbers mentioned in the description or in the latest prompt (`#14`, `issue 14`); for Claudio Code, as a fallback, from the branch (`fix/14-...`). Only the number is exposed |
| Progress % | the agent's todo list (`TodoWrite`/`TaskCreate`/`TaskUpdate`); no bar if it has none |
| Context used | input tokens of the last request over the model's window (200k, or 1M, see [Known limitations](#known-limitations)) |
| Tokens and estimated cost | input, output and cache (read and write) of the session and all its subagents; cost from the public Anthropic API price list (an estimate) |
| Project, branch, lines +/- | `git` in each instance's working folder (uncommitted changes) |
| Instant agent states | hook events in `~/.agent-office/events/<folder>.jsonl` |
| Waiting for your input | unanswered question in the transcript (`AskUserQuestion`, `ExitPlanMode`) + `Notification` hook, attributed to the subagent through `PermissionRequest`/`PreToolUse`. Never the text of the question |

## Settings

Optional, in `~/.agent-office/config.json` (the app creates it when you change a notification setting):

```json
{
  "activeWindowMinutes": 10,
  "notifyWaiting": true,
  "notifyDone": false
}
```

| Key | Read by | Meaning |
|---|---|---|
| `activeWindowMinutes` | server, at startup | minutes without activity after which a session is no longer considered open (it disappears from office, list and panel); 1 to 1440 |
| `notifyWaiting` | app | notify when Claude is waiting for your input; also in the panel |
| `notifyDone` | app | notify when Claude finishes its turn; also in the panel |

Environment variables: `CLAUDE_CONFIG_DIR` (default `~/.claude`), `AGENT_OFFICE_DATA_DIR` (data folder: hook events are written and read there, default `~/.agent-office`; set it for Claude Code too), `AGENT_OFFICE_NODE` (Node used by the app and by the hooks).

## Privacy and security

- The server listens only on `127.0.0.1` and rejects requests with a different `Host` header (DNS rebinding protection).
- It exposes metadata and numbers only: never the text of prompts, responses or tool inputs. For the tool in use it shows the tool name plus just the file name (no folder) for file tools, or the host for `WebFetch`.
- **Text derived from prompts:** the session title (written by Claude Code) and the agents' names and descriptions (written by Claude when it starts them) summarise the requested work and are shown as they are. Working folder and branch are exposed too. The API has no authentication: any process on the same Mac, even another user's, can read them from `127.0.0.1`. Keep this in mind on a shared Mac.
- The hooks record event names, ids, agent type, tool name and working folder: no prompt or tool input.
- The server makes no outbound network calls. The menu bar app queries GitHub (`api.github.com`, releases of the `mccasor/homebrew-agent-office` tap) to look for updates: shortly after launch, every 6 hours and when you click "Cerca aggiornamenti".

## Known limitations

- Claude Code's transcript format is undocumented: verified on Claude Code 2.1.306; reading it is isolated in `src/server/transcript`.
- The 1M context window is recognised from the `[1m]` suffix (model id or "model" attachment) or once usage goes over 200k: on Claude Code 2.1.306 there is no reliable signal to detect it earlier.
- The menu bar app is macOS only (11 or later).

## Architecture

```
~/.claude/projects/<folder>/*.jsonl ─┐
~/.agent-office/events/*.jsonl  ─────┼─> Node server (127.0.0.1) ──SSE──> React + 2D canvas
git (branch, diff --shortstat) ──────┘            ▲
                                                  └── menu bar app (Tauri): starts it, reads /api/snapshot
```

| Module | Responsibility |
|---|---|
| `src/shared` | data contract (`Snapshot`, `types.ts`), person names (`nickname.ts`), price list (`pricing.ts`) |
| `src/server/transcript` | transcripts: `watcher` (files and changes), `discovery` (sessions from other folders), `cwdscan`, `reader` (incremental reads), `parser`, `aggregate` (sessions and agents), `classify` (role), `models` (context window), `paths`, `encode` |
| `src/server/hooks` | hook → JSONL events (`events`), install/uninstall (`install`), watcher |
| `src/server/git` | project, branch, lines +/- per working folder (`poller`) |
| `src/server/state` | aggregation into the `Snapshot`: statuses, waits, lounge, finished today |
| `src/server/http` | API (`/api/snapshot`, `/api/status`, `/api/events` SSE) + static files |
| `src/server/config.ts` | `config.json` settings |
| `src/cli.ts` | `agent-office` command |
| `src/web/pixel` | pixel-art office: floor plan, seats, A* pathfinding, motion, sprites, animated screens, camera and zoom |
| `src/web/hud` | panels, agent card, instance list, list view, detachable cards |
| `src/web/CardWindow.tsx` | page of a detached card (`?card=agent\|session&id=...`) |
| `src/web/store` | client state + SSE stream |
| `src-tauri/src` | menu bar app: `main` (icon, polling, actions), `panel` (panel under the icon, content in `src-tauri/splash/panel.html`), `server` (Node lookup and supervisor), `instance` (single copy), `notify` (notifications and preferences), `updates` (GitHub releases, `brew upgrade`), `cards` (card windows) |
| `scripts` | `release.mjs` (release), `prepare-tauri.mjs` (app resources), `make-icons.py` (icons), `pixel-preview.ts` (sprite preview PNG) |
| `packaging/homebrew` | cask template |
| `test` | end-to-end test and fixtures |

## Development

```bash
npm run dev     # server (tsx watch, port 4317) + Vite with /api proxy
npm run check   # lint + typecheck + build + test
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests of the app
npx tsx scripts/pixel-preview.ts preview.png 2 pianta   # PNG preview of sprites ("pianta": whole floor plan)
python3 scripts/make-icons.py && npx tauri icon src-tauri/icons/app-icon.png   # regenerate icons (needs Pillow and NumPy; keep only the files listed in tauri.conf.json)
```

### Menu bar app

Requires Rust (`brew install rustup`; for the universal build also `rustup target add x86_64-apple-darwin`).

```bash
npm run app:dev      # development
npm run app:build    # src-tauri/target/release/bundle/macos/Agent Office.app
```

Both run `npm run build` and `scripts/prepare-tauri.mjs` first, which copies `bin/`, `dist/` and the server's runtime dependencies into the app's resources.

### Release

The version lives only in `package.json` (`src-tauri/tauri.conf.json` reads it from there; `Cargo.toml` stays at `0.0.0`).

```bash
npm version minor --no-git-tag-version   # bump the version (or patch / major)
npm run app:release -- --publish         # universal build, .dmg released on the tap, cask updated
```

Without `--publish` it only builds the `.dmg` and the cask in `release/`. With `--publish` (needs `gh` authenticated with access to the tap) it creates a draft release on `mccasor/homebrew-agent-office`, pushes the updated cask, then publishes the release, so the app never offers a version that Homebrew cannot find yet.
