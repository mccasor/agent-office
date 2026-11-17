# Changelog

## 0.9.0 — 2026-11-17

Agent Office can now start and resume Claude Code sessions itself, in a terminal built into the app.

### Added

- **Integrated terminal** (#118, #119, #120). A new "New Instance…" entry in the menu bar panel (and in the tray menu on Linux) lets you pick a folder and, optionally, a model and permission mode. Claude Code then starts in its own terminal window inside the app.
  - Instances started this way appear in the office right away, even before the first prompt.
  - Closing a terminal window only hides it while Claude is still running. The terminal button on the instance, in the office or in a detached card, brings it back.
  - "Terminate Instance" in the terminal window stops the process after a confirmation.
  - Quitting the app with instances still running asks for confirmation first.
- **Resume a session** (#121). Sessions that have ended show a resume button in the instance list and in Analysis. It reopens the session with `claude --resume` in the integrated terminal, in the folder where the session started. If the session is still running somewhere else, the app offers to open a copy (a fork) instead.
- **Roles** (#122). A new "Roles" section in Settings lets you write reusable instructions for Claude. When you start a new instance you can pick a role; it is passed to Claude with `--append-system-prompt-file` and is applied again when that session is resumed. Roles are stored in `~/.agent-office/roles/` and are never sent to the local server.

### Security

- Explicit Content Security Policy for the app's local pages, plus per-window Tauri capabilities: each window can call only the commands it needs (#117).

### Fixed

- Sessions are attributed to the folder they were started in, so a session that later moves into the watched folder is no longer included by mistake (#115).
- Hook events are rescanned every 5 seconds, so the office keeps updating when macOS misses a file-change notification (#114).
