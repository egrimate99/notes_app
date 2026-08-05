# Math Atlas — Decision Log

Last updated: 4 August 2026

Publication note: private subject names, source paths, inventories, and content
details have been generalized. Local notes and runtime state below `content/`
are excluded from version control.

This is an append-oriented record of product and architecture decisions. Do not silently rewrite an accepted decision after implementation depends on it. Add a new decision that supersedes the old one, including the reason and migration consequences.

Status vocabulary: **proposed**, **accepted**, **superseded**, **rejected**.

## D-001 — Build a curated mathematical atlas

**Status:** accepted  
**Decision:** The foundational product personality is a curated atlas with stable geography. Prerequisite navigation, proof paths, research frontiers, and memory-palace-like cues are lenses or overlays on the same model.  
**Reason:** A consistent spatial world supports orientation without forcing every workflow into one giant graph or a literal 3D environment.  
**Consequence:** Manual placement is valuable data and must not be overwritten by automatic layout.

## D-002 — Keep subject regions editable

**Status:** accepted  
**Decision:** Initialize subject regions from editable local project data rather than hard-coded product categories.  
**Reason:** Areas of study change and are not permanent universal navigation.  
**Consequence:** Avoid hard-coded assumptions about subject names or counts.

## D-003 — Use “landmark,” not “bubble”

**Status:** accepted  
**Decision:** A typed mathematical knowledge object is a **landmark**. The larger vocabulary is Atlas, Region, Landmark, Connection, Trail, Lens, and Frontier.  
**Reason:** The vocabulary reinforces stable spatial memory while remaining precise enough for a data model.

## D-004 — Start with eight landmark families

**Status:** accepted  
**Decision:** Use Definition, Result, Method, Example, Problem, Insight, Source, and Concept. Theorem, lemma, proposition, corollary, and identity are Result subtypes.  
**Reason:** The taxonomy distinguishes genuinely different learning roles without creating an unwieldy shape for every mathematical label.  
**Consequence:** New families require concrete examples that do not fit the existing set.

## D-005 — Embed proofs by default

**Status:** accepted  
**Decision:** A proof normally lives with its Result. Promote it to an Argument landmark only when independently useful: alternative proofs, reusable technique, meaningful internal dependency path, or separate recall practice.  
**Reason:** Automatically splitting every proof would fragment notes and overcrowd the atlas.

## D-006 — Give visual channels one job each

**Status:** accepted  
**Decision:** Shape/icon conveys landmark family, colour conveys region, line style and arrowhead convey connection type, and badges convey subtype or workflow state. Mastery may use border treatment, but must remain legible and accessible.  
**Reason:** Consistent visual grammar makes distant silhouettes meaningful and prevents colour from carrying several incompatible meanings.  
**Consequence:** Essential distinctions cannot depend on colour alone.

## D-007 — Make connections semantic and directed

**Status:** accepted  
**Decision:** Begin with `requires`, `implies`, `generalises`, `equivalent-to`, `uses`, `applies-to`, `example-of`, `counterexample-to`, `contrasts-with`, `analogous-to`, and provisional `related-to`.  
**Reason:** A connection should explain why two landmarks belong together.  
**Consequence:** Imported wikilinks and unlabelled Canvas edges are not silently promoted to prerequisite relationships.

## D-008 — Make trails first-class objects

**Status:** accepted  
**Decision:** Support ordered Learning, Proof, Application, Contrast, Research, Review, and Cross-subject trails over canonical landmarks.  
**Reason:** Sequence carries pedagogical meaning that an unordered neighbourhood does not.  
**Consequence:** A landmark may participate in many trails without content duplication.

## D-009 — Use Markdown-first hybrid storage

**Status:** accepted  
**Decision:** Keep mathematical content in Markdown with YAML metadata; store maps and trails in versioned JSON; use stable IDs; treat SQLite as a rebuildable index or projection.  
**Reason:** The user should own readable files that survive application changes and work well with Git.  
**Consequence:** Database-only content is prohibited. Coordinates belong to placements rather than landmark content.

## D-010 — Use React Flow, React/TypeScript, Vite, KaTeX, and Tauri 2

**Status:** accepted  
**Decision:** Use React Flow for semantic node/edge interaction, React and TypeScript for UI, Vite for tooling, KaTeX for mathematics, and Tauri 2 for the local desktop shell.  
**Reason:** This stack directly supports custom typed nodes and local desktop access while keeping the frontend web-native and portable.  
**Consequence:** Rust and the Windows Tauri prerequisites are required for desktop development; browser development remains available without Rust.

## D-011 — Pilot on a representative subject

**Status:** accepted  
**Decision:** Validate the product with a curated local or synthetic subject slice and one end-to-end trail before wider migration.  
**Reason:** A focused slice is small enough to learn from without being trivial or publishing private material.  
**Consequence:** Features should be judged against the pilot rather than against hypothetical full-vault scale alone.

## D-012 — Make recall the first learning mechanic

**Status:** accepted  
**Decision:** The first learning loop is hide, attempt, reveal, and record, with special emphasis on reconstructing connections, trails, and local spatial maps.  
**Reason:** The differentiator is learning the mathematical landscape, not passively viewing a prettier graph.  
**Consequence:** Track distinct mastery facets eventually; defer a sophisticated scheduler until the core interaction is validated.

## D-013 — Keep AI suggestions approval-only

**Status:** accepted  
**Decision:** AI may propose landmarks, types, connections, prompts, and placements only with visible source provenance and explicit user acceptance.  
**Reason:** Mathematical correctness and the personal mental map require human curation.  
**Consequence:** No autonomous bulk mutation of canonical content.

## D-014 — Keep the source vault read-only during the pilot

**Status:** accepted  
**Decision:** Read from an explicitly supplied `<external-vault-path>`, but write new application data only below the repository-local `content/` directory.  
**Reason:** The external vault may remain in active use. An incremental copy/import path is safer and reversible.  
**Consequence:** Preserve source paths and page provenance; do not rewrite, move, or bulk-normalize vault content.

## D-015 — Preserve Obsidian interoperability

**Status:** accepted  
**Decision:** Import and export standard JSON Canvas where practical, while keeping richer Math Atlas semantics in project metadata.  
**Reason:** Obsidian remains useful during development, and an open interchange path reduces lock-in.  
**Consequence:** Exported canvases may degrade gracefully when a Math Atlas concept has no JSON Canvas equivalent.

## D-016 — Defer expansive features

**Status:** accepted  
**Decision:** Defer mobile, cloud sync, collaboration, plugins, 3D worlds, full-vault migration, proprietary rich-text storage, autonomous AI map construction, and advanced scheduling.  
**Reason:** The vertical slice must first prove that typed landmarks, stable geography, semantic trails, and recall improve the study workflow.

## D-017 — Use a complete representative slice as the pilot fixture

**Status:** accepted  
**Decision:** Initialize the pilot from a coherent local or synthetic Markdown slice and its Canvas placements. Preserve imported Canvas edges as provisional `related-to` connections, add a small reviewed set of semantic connections, and use one end-to-end trail as the first learning route.  
**Reason:** A coherent, fully placed, deterministic fixture exercises the vertical slice without exposing private note inventory or contents.  
**Consequence:** Treat the generated snapshot as a pilot fixture, not the final canonical storage format. Future imports must remain read-only and preserve provenance.

## D-018 — Keep drag frames local and persist only completed moves

**Status:** accepted  
**Decision:** React Flow owns high-frequency node movement inside the Atlas component. Persist a compact, versioned placement override only on drag stop; do not rerender the application shell or write storage on pointer-move frames. Custom positions override imported Canvas coordinates, survive reloads, and can be reset to the imported layout.  
**Reason:** Stable geography needs durable manual movement, while smooth interaction requires the drag hot path to remain isolated from Markdown rendering, navigation, and storage.  
**Consequence:** Browser and desktop-webview overrides currently use local storage. Versioned map files remain the later canonical persistence target.

## D-019 — Treat responsiveness as a regression-tested feature

**Status:** accepted  
**Decision:** Lazy-load the graph and mathematical Markdown pipelines, memoize stable graph/card subtrees, avoid continuous edge animation and costly drag-time filters, and enforce explicit production bundle budgets. The browser verification must perform a real drag and check persistence, reset, console errors, and long tasks.  
**Reason:** The atlas is a spatial instrument; latency or jank directly undermines the memory-building interaction.  
**Consequence:** `npm run build` fails if the shell, graph, deferred math renderer, or initial interactive JavaScript exceeds its recorded budget.

## D-020 — Make one map and one reader/editor the product core

**Status:** accepted  
**Supersedes:** D-008 and D-012 for the current product scope; narrows the mode and trail portions of D-001, D-016, and D-017.  
**Decision:** Use one primary workspace: a file explorer, one stable mathematical map, and one large reading/editing pane. Remove the Atlas, Trail, Recall, Inbox, Frontier, and alternative-view switcher from the interface. Search remains a lightweight filter of the same map. Trails, recall, and other lenses may be reconsidered only after the core spatial reading and writing workflow is proven.  
**Reason:** The earlier vertical slice accumulated too many parallel workflows before the basic act of finding, reading, arranging, and editing mathematics felt simple. The extra modes added navigation and explanatory clutter without strengthening the mental map.  
**Consequence:** Current status, tests, screenshots, and documentation must not claim that recall or trail modes are available. Dormant fixture data may remain temporarily for compatibility, but it is not a current product feature.

## D-021 — Make `study/content` the canonical note system

**Status:** accepted  
**Supersedes:** D-017's generated snapshot as the effective content source; makes D-009 concrete.  
**Decision:** Store every owned mathematical note as a real Markdown file below the repository-local `content/` directory, with lightweight YAML metadata and a stable ID. The left sidebar exposes the actual folder/file hierarchy. The reader loads those files and the CodeMirror editor writes their Markdown bodies directly through a revision-checked repository boundary. The generated atlas snapshot is a projection for map metadata, not the canonical copy of the mathematics. The complete `content/` tree remains private and excluded from version control.  
**Reason:** Files remain understandable in Obsidian, a text editor, Git, or a future application. A visible file tree also makes organization concrete and prevents the application from hiding notes behind an abstract internal model.  
**Consequence:** Content must never exist only in local storage, React state, or a database. File and folder operations must preserve stable IDs. Coordinates and other map-specific state remain separate from note prose. Browser development may use a narrowly scoped local content service; desktop access must enforce the same content-root and conflict checks.

## D-022 — Treat the Obsidian importer as non-destructive bootstrap, not sync

**Status:** accepted  
**Clarifies:** D-014, D-015, and D-017.  
**Decision:** The legacy one-subject bootstrap was local-only and is excluded from the public repository. Import tooling must never overwrite an existing file below `content`, write to the source vault, or present generated snapshots as synchronization.  
**Reason:** The source vault is actively edited and the canonical Math Atlas files become independently editable immediately after bootstrap. Blindly copying in either direction could destroy newer mathematics.  
**Consequence:** The command is suitable for deliberate initial or missing-file bootstrap but does not pull later source edits into existing canonical notes. Source renames or moves may propose a second destination and therefore require review. Any future refresh or two-way exchange requires explicit comparison, provenance, and conflict handling. Documentation must not describe the current importer as live sync.

## D-023 — Use a general mathematical display language and bottom-to-top geography

**Status:** accepted  
**Supersedes:** D-004 and D-006 at the presentation layer; legacy imported kinds may remain internally until migrated.  
**Decision:** Present only five general note roles: Definition, Result, Method, Example, and Note. Render landmarks like restrained theorem or definition environments with conventional frames, not a separate flowchart silhouette and icon for every imported subtype. Show topic groups explicitly, and arrange learning so foundational material is lower while later material develops upward.  
**Reason:** Familiar mathematical typography is faster to read and a small vocabulary is easier to apply consistently. A stable bottom-to-top direction gives paths a memorable spatial meaning without adding another view.  
**Consequence:** Imported subtype detail must not clutter map cards. Selection may use a strong border or halo, but the ordinary cards remain calm. Group frames and edge direction must not intercept reliable landmark selection or dragging.

## D-024 — Use one persistent, dark spatial atlas

**Status:** accepted  
**Supersedes:** D-023's five-role presentation vocabulary and calm light-surface treatment; extends D-020 from one current-subject map to one all-subject canvas.  
**Decision:** Keep all locally configured subjects visible together as stable territories on one large pan-and-zoom canvas, including empty territories. Use a dark, hard-edged neon interface with fully filled topic groups. Apply a strict visual stack: group fields behind connections, and connections behind landmarks, regardless of selection. Let the file and note sidebars be resized directly, with their widths persisted locally. Use standard result classes—Theorem, Proposition, Lemma, and Corollary—instead of a generic Result role.  
**Reason:** A single durable geography is more useful for a mental map than subject switching. High-contrast angular surfaces make the working layers easier to distinguish, while adjustable panels let reading, navigation, and spatial work take priority at different moments.  
**Consequence:** Selecting or dragging a group must never cover its arrows or landmarks. New subjects receive a location before they receive content. Responsive and browser checks must exercise both panel dividers and confirm the stacking order.

## D-025 — Use translucent territories and movable academic labels

**Status:** accepted  
**Supersedes:** D-024's neon palette and fully filled group treatment.  
**Decision:** Retain the dark, angular atlas but use a restrained academic palette, true-alpha group fields, and Times New Roman for user-facing prose and controls. Render every visible group name in the counter-scaled control layer so it remains reachable above landmarks and arrows. The name itself moves the complete group, and its anchor can be customized to eight positions around the perimeter.  
**Reason:** Subject colour should orient rather than dominate. Translucency preserves the mathematical path through overlapping territories, while a stable-size name plate remains legible and grabbable at every zoom. Perimeter placement lets the label avoid dense mathematics without turning it into another free-floating object.  
**Consequence:** Group labels need an explicit zoom-correct drag proxy and persisted title-position field. Browser verification must begin drags on the text itself, confirm member synchronization, and require partially transparent computed fills.

## D-026 — Use a white paper canvas and contextual direct manipulation

**Status:** accepted  
**Supersedes:** D-024 and D-025's dark visual treatment; D-018 and D-019's reset workflow; D-021's separate source-editor presentation.  
**Decision:** Use an unbranded white canvas with Times New Roman typography, a 28-pixel black-dot grid, compact text, ordinary rainbow topic colours, and thin complete frames rather than neon fills or left accent bars. Keep every subject on the same canvas. Groups are truly translucent and remain behind edges and landmarks. Landmarks and groups share a clean geometric shape vocabulary, snap to grid, and expose small ports with generous hit targets. Hide role labels from landmark faces while using the role to choose a default shape. Open creation and object tools only from right-click contextual palettes positioned at the pointer; use icons for shapes and line styles, and include exact RGB plus one-click colour copy/paste. Let both sidebars resize, hide, and restore from minimal edge controls. Replace reset actions with `Ctrl+Z`/`Ctrl+Shift+Z`. Edit prose and mathematics directly in the rendered note so the compiled result remains visible and updates live, without opening a raw-source pane or dialog.  
**Reason:** The map should feel like a precise mathematical page rather than application chrome. Direct manipulation, predictable grid geometry, and tools that appear only at the point of intent keep the canvas readable while preserving advanced customization.  
**Consequence:** Browser verification must cover white/Times presentation, black-dot snapping, transparent group layering, contextual creation and editing, port connection gestures, inline compiled editing, undo/redo, and the canvas expansion obtained by hiding both sidebars. Persistent dropdowns, visible reset controls, and product headings do not belong in the workspace.

## D-027 — Separate spatial hierarchy from file organization

**Status:** accepted  
**Clarifies:** D-021 and D-026.  
**Decision:** Give the canvas three explicit composition levels: Subject,
Group, and Subgroup. Subjects hold broad mathematical fields, Groups hold major
classes within them, and Subgroups collect local concentrations of landmarks.
Store parent relationships only in atlas presentation metadata. Do not infer
them from, or write them back into, the Markdown folder tree. Use explicit
parent links for nested movement and shape-aware containment for placement.
Render all levels below connections and landmarks, with distinct transparent
contours and screen-stable labels attached to their actual shape perimeter.
**Reason:** Mathematical geography and document filing answer different
questions. A durable visual hierarchy helps spatial memory, while independent
files remain portable and can appear more than once on the map. Explicit
parentage also makes empty nested frames and non-rectangular groups behave
predictably.  
**Consequence:** Creating, nesting, restyling, moving, or deleting a canvas
frame never creates or moves a folder. Legacy groups without a level continue
as ordinary Groups. Deleting a custom parent reparents its children rather than
deleting notes. Desktop monitor surfaces must transfer an active group or
landmark drag in world coordinates so crossing a display seam cannot lose or
revert the gesture.

## D-028 — Make labels part of the mathematical geography

**Status:** accepted  
**Supersedes:** D-025 and D-027's screen-stable group-label rule.  
**Decision:** Keep group names attached to their exact shape perimeter, but
scale them in canvas coordinates with the frame instead of counter-scaling them
to a fixed screen size. Preserve the same label-to-frame ratio across wheel
zoom and mixed-DPI desktop surfaces. Increase compact landmark names from 13px
to 15px in ordinary shapes, with fitted 14px and 13px variants for the narrower
rhombus and triangle; increase document-card headings proportionally.  
**Reason:** A screen-fixed label appears to grow as its territory recedes and
stops reading as part of the map. World-scaled labels preserve the visual
composition, while larger landmark names improve the primary reading target
without overflowing constrained shapes.  
**Consequence:** Browser regression measures title-to-frame ratios rather than
constant screen pixels. Group-title pointer targets scale with the visible
label, and authored landmark typography remains in node coordinates.

## D-029 — Make group-title scale an authored map property

**Status:** accepted  
**Extends:** D-028.  
**Decision:** Use 28px as the default group-title size in canvas coordinates. Let each Subject, Group, or Subgroup override that size from 12–56px through one combined contextual Title panel containing shape-aware anchor controls, visual presets, and a precise slider. Preview slider movement directly on the live node, but persist only committed values. Store the optional override in both local and canonical atlas presentation metadata without changing schema version 1.  
**Reason:** Group names are primary geographic landmarks and should be substantially easier to scan than the former 12px labels. A world-space authored value remains visually honest under zoom and mixed-DPI desktop projection, while per-group control handles different hierarchy and naming needs without adding permanent canvas chrome.  
**Consequence:** Legacy canvases inherit 28px automatically. Browser and unit regressions must cover the default, exact authored values, persistence, live reconciliation, and invariant title-to-frame scaling through zoom.

## D-030 — Replace the pilot with one audited, recoverable vault import

**Status:** accepted  
**Supersedes:** D-022 for an explicitly requested full-vault replacement; the
old subject-specific bootstrap remains non-overwriting historical tooling.  
**Decision:** Import every Markdown file outside source dot-directories while
keeping the Obsidian vault strictly read-only. Preserve the real folder tree,
frontmatter, and note bodies; add deterministic stable IDs; migrate referenced
images into the hidden content-addressed asset store; and validate all Obsidian
wikilinks with path-aware duplicate handling. Do not import Canvas placement.
Make dry-run the default, require an explicit apply mode, stage and verify the
whole replacement before promotion, journal filesystem moves, retain the old
canonical tree in a hidden backup, and provide verification and rollback modes.
Reset canonical atlas metadata to an empty map so files have an independent
life until the user places them.  
**Reason:** The pilot's Canvas-filtered, create-only importer cannot faithfully
represent a larger or reorganized vault or safely replace stale canonical
notes. A manifest-backed transaction gives a deliberate clean start
without turning the external vault into writable application storage.  
**Consequence:** Imported files become canonical only below `content/`, which
remains private and excluded from version control.
The manifest records hashes and provenance but never replaces the files as the
source of truth. Later source refresh or two-way synchronization remains a
separate, explicitly designed workflow.

## Open implementation questions

These are not blockers for initialization and should be resolved with prototypes or fixtures:

- What exact YAML and map JSON schema should become version 1 beyond the current pilot header?
- How should create, rename, move, and delete operations update the file tree while preserving stable landmark IDs?
- When should placement overrides move from local storage into a canonical versioned map file?
- What explicit comparison and conflict workflow would be required before source-vault refresh is offered?
- What is the smallest reversible JSON Canvas round-trip that preserves useful positions, groups, and provenance?
