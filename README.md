<p align="center">
  <img src="logos/gitmorrow-mark.svg" alt="GitMorrow" width="88" height="88">
</p>

<h1 align="center">GitMorrow</h1>

<p align="center">
  <strong>The Git Client Of Tomorrow</strong><br>
  A fast, native Git client for macOS, Windows, and Linux — free to use and built for developers.<br>
  <a href="https://gitmorrow.org">gitmorrow.org</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platforms: macOS, Windows, Linux">
  <img src="https://img.shields.io/badge/status-pre--release-yellow.svg" alt="Status: pre-release">
</p>

---

**GitMorrow** is a cross-platform Git GUI client for macOS (primary), Windows, and Linux — built with
[Wails](https://wails.io) (Go + native WebView), React 19, and TypeScript. Designed for a
first-class working-copy experience: fast, native, and focused on your workflow.

GitMorrow is **free software**: free to use, free to modify, and free to share — your repositories
stay on your machine, and no account is required.

The project website with screenshots, a feature overview, and download links is
**[gitmorrow.org](https://gitmorrow.org)**.

> **Status:** GitMorrow is in active development and still pre-1.0. Preview builds for all three
> platforms are published on the [Releases page](https://github.com/ahilwers/gitmorrow/releases/latest);
> expect breaking changes between versions and please report what breaks.
> **First GitMorrow release:** switching from an earlier build is a clean break. Uninstall the old
> app and install GitMorrow fresh; preferences, recent repositories, and AI settings will need to be
> set up again. Your repositories and Git credentials are not changed.

## Features

- **Visual commit graph** — your entire repository history at a glance. Color-coded swimlanes,
  merge lines, and branch labels, rendered at 60 fps on a native Canvas.
- **Hunk-level staging** — stage individual hunks or even single lines in the Changes view, powered
  by a Monaco diff viewer. Review every change before it goes in.
- **Git worktrees** — work on multiple branches simultaneously without stashing. Create, switch, and
  remove worktrees directly from the UI.
- **No account required** — works with any Git host, or none at all. Local repositories, offline.
- **Native, not Electron** — built with Go and the OS WebView, launched in under a second with a
  fraction of the RAM of Electron apps.
- **Built for performance** — the commit graph layout is computed in Go; history and diffs render
  instantly, even in repositories with thousands of commits.
- **Your credentials stay yours** — authentication is delegated to Git's native helpers: the SSH
  agent, macOS Keychain, and Windows Credential Manager. GitMorrow never stores your credentials.
- **Auto-updates** — Sparkle (macOS), WinSparkle (Windows), and AppImageUpdate (Linux).
- **AI-assisted commit messages** — optional AI-generated commit messages right from the commit box,
  using an API key or a local assistant CLI you are already signed in to.

## Platform support

| Platform | Minimum | Distribution |
|---|---|---|
| macOS | 12 Monterey | `.dmg` (Intel & Apple Silicon) |
| Windows | 10 21H2 | NSIS installer (`.exe`) |
| Linux | modern distros | AppImage |

## AI commit messages

The commit box has a **Generate with AI** button. It reads the staged diff (up to 512 KiB), asks for
a commit message, and shows the suggestion in a preview — nothing is committed automatically. Open
**AI settings** next to the button and pick one of two authentication modes.

### Local CLI (no API key in GitMorrow)

GitMorrow writes the instruction and the staged diff to the standard input of a CLI that is already
installed and signed in on your machine. It never reads or stores that CLI's credentials, and it does
not run the command through a shell. The presets map to these non-interactive entry points:

| Preset | Command GitMorrow runs |
|---|---|
| Claude Code | `claude -p` |
| Codex CLI | `codex exec` |
| Copilot CLI | `copilot -p` |

Setup:

1. Install and sign in to one of these CLIs, and check that it answers in a terminal.
2. In GitMorrow, open **AI settings**, set **Authentication** to **Local CLI**, and choose the CLI.
3. Leave **Executable path** blank to use the command from `PATH`, or enter the full path to the
   executable when the command is not on `PATH` — typical on macOS, where an app started from Finder
   does not inherit your shell's `PATH`.
4. Save the settings, stage some changes, and press **Generate with AI**.

For a CLI that is not in the list, choose **Custom command** and enter the path of an executable that
reads the prompt from standard input and prints the message to standard output. GitMorrow passes no
arguments of its own in this mode, so a small wrapper script is the easiest way to add flags:

```bash
#!/bin/sh
# ~/bin/my-commit-helper — reads the prompt on stdin, prints the message on stdout
exec /path/to/your-cli --model some-model --print
```

If the CLI is missing, fails, or does not answer within 45 seconds, GitMorrow shows the CLI's own
error message or exit code instead of a generic one.

### API key

Set **Authentication** to **API key** and enter a provider (OpenRouter or any OpenAI-compatible
endpoint), the base URL, and the model ID. The key is stored in the OS credential store — on macOS
the Keychain, on Windows the Credential Manager, on Linux the Secret Service — never in a repository
file. Keys are scoped to the base URL, so changing the URL requires entering the key again. HTTPS is
required; plain HTTP is accepted for `localhost` only.

In both modes the staged diff, including code and file paths, leaves your machine — check it for
secrets before generating, and check your provider's data policy.

## Building from source

**Prerequisites:** Go 1.27+, Node.js 22. Wails v3.0.0 is pinned as a Go tool in `app/go.mod` — use the
`wails3` CLI (`go tool wails3` from `app/`, or `make install-wails3` to put it on PATH).

```bash
# Development (live hot reload, Go + React)
make dev                     # or: cd app && go tool wails3 dev

# Production build → app/bin/GitMorrow
make build-wails             # or: cd app && go tool wails3 build

# Regenerate frontend bindings from the Go service methods
make generate-bindings

# Tests
make test                    # Go backend tests (race detector)
make test-frontend           # Vitest frontend tests
make test-e2e                # Playwright E2E tests
```

Frontend-only workflows run from `app/frontend/`:

```bash
cd app/frontend
npm install
npm run dev      # Vite dev server
npm run build    # Frontend build
npm test         # Vitest unit tests
```

## Repository structure

```
app/          Desktop application (Wails 3 · Go backend · React frontend)
  ├── git/        Go Git backend (go-git reads, CLI-git writes)
  ├── update/     Auto-update integration (Sparkle / WinSparkle / AppImageUpdate)
  ├── build/      Wails v3 build assets (config.yml, per-platform taskfiles)
  └── frontend/   React 19 + TypeScript UI
docs/         Architecture and design documents
scripts/      Build and utility scripts
```

### Git backend split

- **Read operations** (history, diff, status, branches, refs) use [go-git](https://github.com/go-git/go-git/).
- **Write operations** (push, pull, fetch) delegate to the system Git via `exec.Command`, so SSH
  agents, credential helpers, GPG signing, and hooks work exactly as they do on the CLI.
- **Filesystem watching** via `fsnotify` keeps the UI in sync while you edit in your editor.

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution guide (setup, conventions, pull request process)
- [`docs/`](docs/) — architecture and design documents
- [`RELEASE.md`](RELEASE.md) — release build, code signing, and publishing on GitHub
- [`AGENTS.md`](AGENTS.md) — guidance for AI agents and contributors working in this repository

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution guide —
development setup, commit conventions, testing, and the SPDX license header every source file must
carry.

By contributing, you agree that your contributions are licensed under the same terms as the project
(GPL-3.0-or-later). All user-facing text in this repository is written in English.

## License

Copyright © 2026 Achim Hilwers

GitMorrow is free software: you can redistribute it and/or modify it under the terms of the
**GNU General Public License** as published by the Free Software Foundation, either **version 3** of
the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, **but WITHOUT ANY WARRANTY**; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
[GNU General Public License](LICENSE) for details.

You should have received a copy of the GNU General Public License along with this program.
If not, see <https://www.gnu.org/licenses/>.
