# Math Atlas

Math Atlas is a local-first workspace for learning advanced mathematics as a stable, navigable landscape. Its core is deliberately small: an Obsidian-like file tree, one spatial map, and a large reader/editor for ordinary Markdown and LaTeX files.

Subject regions are project data rather than hard-coded product categories, so each local atlas can evolve independently.

## Current build

This repository contains the public Math Atlas application and its development documentation. The React, TypeScript, Vite, React Flow, KaTeX, and Tauri 2 foundations are installed. A local external Obsidian vault can remain a read-only import source, while the writable canonical library lives below `content/`.

Notes, referenced assets, import manifests, atlas state, backups, and Trash data below `content/` are private local data and are excluded from version control. The public repository therefore starts without a note library. The importer validates Markdown, images, wikilinks, paths, aliases, and duplicate filenames, and imported notes begin off-canvas. The interface has one workspace rather than a collection of modes:

- The left sidebar is a folder/file explorer backed by the real Markdown hierarchy. New names are selected for immediate replacement, filenames are the canonical note titles, and an ordinary note starts empty. Ctrl/Cmd-click toggles items, Shift-click selects ranges, and Ctrl/Cmd+Shift-click adds ranges; selected files and folders move together by drag-and-drop, including onto the root. F2 rename, Ctrl/Cmd+A, keyboard navigation, contextual actions, multi-item Trash, and a dedicated Ctrl/Cmd+Z history behave as ordinary file-manager operations while the visual `.md` suffix stays hidden.
- The note library and the canvas are independent. Drag a file from the explorer onto the grid to create a canvas instance; repeat the drop for independent copies of the same Markdown note, or remove a copy without deleting its file.
- The centre is one large, initially blank canvas shared by the locally configured subjects. Subjects, groups, subgroups, notes, and relations appear only when authored or placed; learning within a territory runs from bottom to top, and the last pan/zoom position is remembered.
- The right side is a large compiled note. Click rendered prose or mathematics to edit it in place: the typeset result stays visible and updates on every keystroke, without a raw-source panel or editing dialog.
- Obsidian `[[links]]` render as ordinary note names. Typing `[[` opens a keyboard-navigable completion list that shows folders for disambiguation; duplicate names are stored with a hidden path-qualified target while the reading view keeps only the clean title.
- Pasted or dropped images are validated, deduplicated, stored under the hidden `content/.assets/` library, and inserted as portable relative Markdown references in both browser and desktop builds.
- A landmark can stay as a compact title, show its primary formula, show a mathematical statement, or render the note itself. Its frame can be resized directly on the grid or changed with compact size presets.
- The canvas has three independent spatial scales: Subjects for broad fields, Groups for major classes within a field, and Subgroups for local concentrations of ideas. Their hierarchy belongs only to the atlas and never dictates the folder tree. All three can be created from the canvas: Subjects are neutral, unfilled overview frames with a faint clipped contour texture, while Groups and Subgroups use distinct transparent cartographic treatments.
- The Files sidebar can be resized or hidden and retains both choices. The note sidebar follows selection: clicking a note opens it, deselecting the note closes it, and its close button dismisses it without destroying a canvas multi-selection. Selecting any note again restores the panel at its saved width.
- Landmarks and groups snap to the 28-pixel black-dot grid. Completed moves persist locally, and `Ctrl+Z`/`Ctrl+Shift+Z` undo or redo map changes.
- Landmark roles include Definition, Theorem, Proposition, Lemma, Corollary, Method, Example, and Note. A role chooses the default clean geometric shape; the role label stays off the card, while colour encodes topic.
- The interface is an unbranded white paper surface with compact sans-serif tooling, Times New Roman mathematics, ordinary rainbow colours, and thin complete frames. Topic groups use true transparency so the grid and paths remain visible through them.
- A group name sits on the exact perimeter of its chosen shape and drags the group. Subjects use a neutral, widely tracked atlas heading, Groups a precise framed plate, and Subgroups a compact bracketed marker; all wrap complete names without ellipses and remain legible over overlapping territories. An anchor can use eight perimeter positions, follows curved and sloped edges, and scales with the group so it never grows against the frame while zooming out. Group titles default to a prominent 28px world-space size and can be tuned precisely from 12–56px in the contextual Title tools. The label-to-frame ratio also remains continuous across mixed-DPI monitors. Subjects, Groups, and Subgroups can all be resized and use the same base geometry as landmarks; territories also offer a cloudlike, deeply rounded rectangle.
- Left-click canvas objects to select them, left-drag blank space for a selection rectangle, and left-click blank space to clear the selection. Right-drag blank space to pan; a stationary right-click opens creation at the pointer. Named canvas objects default to the content root, their exact filename becomes the landmark title, and mathematical roles receive only their matching callout template. Object and connection palettes remain compact; shape and line choices use icons, while colour tools offer the regular rainbow, exact RGB input, and one-click copy/paste.
- Small side ports on landmarks and groups have generous invisible hit areas. Dragging one starts a relation whose label, arrow direction, line/path style, colour, reconnection, and deletion remain editable from its contextual palette.
- Search preserves the full spatial map: matches stay crisp while nonmatches and unrelated paths recede instead of disappearing.
- Map geometry and appearance are stored beside the notes in `content/.math-atlas/atlas.json`, with revision checks and atomic writes; browser-local state remains a migration and failure-safety layer.
- The native build can turn the same live atlas into an interactive desktop surface spanning the physical arrangement of every monitor. It keeps ordinary windows and the taskbar above the canvas, hands active landmark and group drags between monitor WebViews without snapping back, has a tray escape route, and preserves an independent desktop camera without copying the frontend or note state.

Recall, trails, Inbox, Frontier, and alternative view modes are not part of the current interface. They are deferred until the map, file ownership, reading, and editing workflow is excellent.

The durable product brief and accepted design decisions live in:

- [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md)
- [`docs/DECISIONS.md`](docs/DECISIONS.md)

The brief preserves the original wider direction. Decisions D-020 onward explicitly supersede its mode, recall, trail, storage, and visual-taxonomy assumptions for the current build.

## Prerequisites

For the browser-based development server:

- Node.js 20.19+ or 22.12+ (the requirement inherited from Vite 7)
- npm

For the Tauri desktop application on Windows, also install:

- Rust using [rustup](https://rustup.rs/)
- a Windows linker toolchain (this checkout pins Rust's GNU target in `rust-toolchain.toml`; the MSVC target plus Microsoft C++ Build Tools is also supported)
- Microsoft Edge WebView2 (normally already present on current Windows installations)

See the official [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) for installation details. After installing Rust, open a new PowerShell window and confirm:

```powershell
rustc --version
cargo --version
```

With those prerequisites installed, both the browser build and packaged Windows application can be compiled locally.

## Run locally

From PowerShell:

```powershell
Set-Location 'C:\path\to\notes_app'
npm install
npm run dev
```

Vite prints the local URL. In Codex sessions for this repository, the development server is started automatically and left available at `http://127.0.0.1:1420`. To run the native workspace window:

```powershell
npm run tauri dev
```

To launch the same application directly as the multi-monitor desktop canvas:

```powershell
npm run tauri:desktop
```

The in-app monitor button switches between workspace and desktop modes, and the tray menu remains available while the desktop surface has no taskbar entry. See [`docs/desktop-canvas.md`](docs/desktop-canvas.md) for installed-shortcut and monitor-layout details.

Useful checks:

```powershell
npm run import:vault -- --help
npm test
npm run build
npm run check:bundle
npm run verify:creation
npm run tauri build
```

With an explicit `--vault <path>`, `npm run import:vault` defaults to a non-writing dry-run of the deliberate full-vault replacement. It stable-reads the external Obsidian vault, validates every note, wikilink, duplicate name, and referenced image, and reports the prospective manifest. Promotion requires the explicit `--apply` flag, stages and verifies the complete replacement before committing, and retains the previous canonical tree in a hidden recoverable backup. It is a one-way import, never live or bidirectional sync. See [`docs/OBSIDIAN_IMPORT.md`](docs/OBSIDIAN_IMPORT.md) before applying or rolling back.

`npm run build` checks TypeScript, builds the web frontend, and enforces the JavaScript bundle budgets. `npm run check:bundle` reruns only the budget check against an existing `dist/`. `npm run tauri build` additionally compiles and packages the desktop application.

For a real browser interaction and screenshot check, leave `npm run dev` running and execute this in a second PowerShell window:

```powershell
npm run verify:ui
```

The check uses the locally installed Microsoft Edge and writes local reference screenshots to `docs/screenshots/`. That directory is excluded from version control because screenshots can contain private note text.

## Project shape

```text
study/
  content/          Private local notes and state (excluded from version control)
  src/              React application
  src-tauri/        Tauri desktop host and permissions
  scripts/          Bootstrap import, local content API, and verification tools
  public/           Static frontend assets
  docs/             Product brief, decisions, and handoffs
```

The persistence rule is simple: Markdown files below `content/` are the notes, `content/.assets/` holds content-addressed images, and `content/.math-atlas/atlas.json` holds only spatial presentation metadata. Canvas-instance IDs are separate from note paths, so one file can exist off-canvas or appear more than once without duplicating its contents. The file explorer and editor operate on real files, not on detached browser records or a database-only representation. YAML frontmatter holds stable note identity. Any future index must be rebuildable and can never be the only copy.

In browser development, a narrowly scoped local Vite service provides safe tree, read, revision-checked write, create, move, Trash, and restore operations only for `content/`. The desktop application uses the same repository boundary. Click rendered mathematics or prose to edit it in place while the compiled result remains visible, press `Ctrl+S` to save immediately, or `Esc` to leave the inline edit; ordinary edits also save after a short idle delay and flush on blur. `Alt+D`, `Alt+E`, `Alt+T`, `Alt+P`, and `Alt+L` insert Definition, Example, Theorem, Proposition, and Lemma environments at the current caret or around the current selection.

## Source-vault safety

Supply the source Obsidian vault explicitly when importing, for example:

```text
<external-vault-path>
```

Treat it as read-only. The full-vault importer opens source files only for stable reads, writes canonical copies only below the repository-local `content/` directory, and excludes Obsidian configuration, Git data, PDF, and Canvas files. After import, edits made in Math Atlas belong to those private local canonical files. Never interpret either importer as bidirectional synchronization, and never commit imported content or manifests to this public repository.

## Continue in a new Codex conversation

Open `<path-to-notes_app>` as the working folder, then begin with:

> Read `AGENTS.md`, `docs/PROJECT_BRIEF.md`, and `docs/DECISIONS.md`; inspect the current repository status; and continue improving the full-vault Math Atlas without writing to the source Obsidian vault.

The documents are the handoff contract; chat history is supplementary.
