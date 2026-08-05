# File workflow

Math Atlas treats `content/` as its only writable note root. The external
Obsidian vault is never addressed by the file API.

## Explorer interactions

- The header icons create a note or folder inside the active folder. The same
  actions are available by right-clicking a folder or empty explorer space.
- Names are edited in place. Enter commits, Escape cancels, and `.md` stays
  hidden even when it is typed. A new item's suggested name is fully selected,
  so typing replaces it immediately.
- A note's filename is its displayed title. Creating or renaming a note does
  not add a second Markdown heading, and a plain Note starts completely empty.
- F2 renames the focused item. Delete opens an explicit confirmation. Ctrl+N
  and Ctrl+Shift+N create a note and folder in the active location.
- Ctrl/Cmd-click toggles individual items, Shift-click selects a continuous
  visible range, and Ctrl/Cmd+Shift-click adds a range. Ctrl/Cmd+A selects the
  visible tree; Space toggles the focused item and Escape clears the selection.
- Arrow keys, Home, End, and the context-menu arrow keys provide a complete
  keyboard path through the explorer.
- Drag any selected file or folder to another folder or to empty explorer space
  to move the entire compacted selection. Descendants of an already-selected
  folder are moved only once, closed target folders expand on hover, and invalid
  self, descendant, collision, and no-op drops are rejected before mutation.
- Create, rename, multi-move, and multi-item Trash are reversible file-history
  transactions. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y operate on that
  history while focus is in the explorer; focus follows the result of each
  mutation so immediate undo remains reliable. Canvas undo remains independent.
- Drag a Markdown file onto the canvas to place it at that exact grid position.
  The drag is copy-only: the source file is never moved, and dropping the same
  file again creates another independent canvas instance.

## Files and canvas instances

The file tree is the note library; the canvas is one spatial view of it. A file
may have no canvas instance, one primary instance, or several copies. Every copy
opens and edits the same Markdown file while keeping its own position, size,
shape, colour, and incident connections.

Right-click a landmark and use the remove icon to remove only that canvas
instance. It never trashes the Markdown file. `Ctrl+Z` restores the instance.
Selecting a file in the explorer opens the canonical note and emphasizes all of
its visible canvas copies instead of choosing one arbitrarily.

## Spatial groups are not folders

Subjects, Groups, and Subgroups are three levels of canvas composition, not
filesystem containers. A Subject is a broad mathematical territory, a Group is
a major class inside it, and a Subgroup is a local concentration of related
landmarks. Creating, nesting, renaming, moving, changing, or deleting one of
these frames updates only `content/.math-atlas/atlas.json`; it never creates,
moves, renames, or deletes a Markdown folder.

The same file can consequently appear in different spatial groups through
different canvas instances while retaining one canonical path. Deleting a
custom parent frame preserves its landmarks and reparents child frames rather
than cascading into the note library.

## Mathematical creation and shortcuts

Right-click the canvas, choose a mathematical role, and type over the selected
`Untitled …` name. Math Atlas creates that exact filename and uses the same text
as the landmark title; no generated suffix or duplicate heading is involved.
Definition, Theorem, Proposition, Lemma, Corollary, and Example notes start with
only their matching callout environment. Note and Method start empty.

Inside the live editor, `Alt+D`, `Alt+E`, `Alt+T`, `Alt+P`, and `Alt+L` insert a
Definition, Example, Theorem, Proposition, or Lemma environment at the current
selection. Existing selected text is placed inside the environment, and the
insertion is one undoable edit.

## Rename and map identity

Renaming moves the existing filesystem entry; it does not read and rewrite the
Markdown. YAML frontmatter and its stable `id` therefore remain byte-for-byte
unchanged. After a rename, the app remaps its open-document and revision caches,
keeps an open descendant selected when a folder moves, refreshes the real tree,
and uses the stable YAML id to keep the corresponding landmark connected.

For user-created landmarks, stored `contentPath` values are moved with the file
or folder. A directly renamed custom landmark also adopts the new filename as
its map title. Imported landmarks keep their snapshot title while their stable
YAML id continues to resolve the renamed file.

## Recoverable deletion

Deletion is a soft delete. After confirmation, the note or entire folder is
atomically moved below `content/.trash/<token>/`; hidden folders never appear in
the explorer. A durable receipt beside the deleted entry makes Undo work even
if the repository service object is recreated. If the original path has since
been reused, restore refuses to overwrite it and leaves the deleted item safe.

Deleting a mapped note deliberately does not delete its landmark. If the open
note is moved to Trash, the inspector shows a restrained unavailable state and
the map object remains intact. Undo restores the file and reconnects it through
the unchanged YAML id.

## Managed images

Paste or drop PNG, JPEG, GIF, or WebP images into the live note editor. Math
Atlas stores verified bytes in the hidden, content-addressed directory
`content/.assets/` and inserts a normal relative Markdown image reference. This
keeps notes portable to other Markdown tools while the browser and desktop app
resolve the same asset consistently.

Identical image bytes are deduplicated. Images are never removed automatically
when a reference is edited or a canvas instance disappears; avoiding accidental
data loss is more important than eager cleanup. The `.assets` directory stays
out of the file tree and is created only after the first valid image is stored.

## Safety boundary

Every create, move, delete, and restore operation validates portable relative
paths, rejects traversal, drive/UNC paths, hidden segments, reserved Windows
names, non-Markdown file targets, collisions, and folders moved inside
themselves. Every existing path component is checked with `lstat`; symbolic
links and junctions are refused. The configured `content/` root must itself be
a real directory.

Managed images have a separate, narrow boundary: a 16 MiB limit, byte-level
format validation, bounded dimensions, SVG rejection, hash verification,
canonical asset paths, symlink rejection, and atomic content-addressed writes.
