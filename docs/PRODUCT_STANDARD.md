# Math Atlas product standard

This document is the quality bar for the single-canvas mathematics workspace. It treats reported defects as symptoms of product systems, not as an exhaustive checklist.

## Product character

Math Atlas is an academic working surface: a spatial map, a file navigator, and a mathematical note editor. It should feel precise, calm, fast, and intentional. The canvas is true white; map geometry is crisp; ordinary saturated subject colours carry meaning; interface chrome stays neutral. Mathematical material uses a book serif while tooling uses a compact sans serif.

The app has one canvas. Semantic zoom may simplify detail, but it must never switch the user into a separate view or mode.

## Problems found

### Geometry and interaction

- Visible group shapes, selection, hit testing, resizing, and title anchoring currently use different geometry. A shaped SVG cannot sit on top of a rectangular interaction model.
- Group interiors and landmarks compete for pointer events. A group must be easy to acquire on its contour without blocking anything inside it.
- Group title placement is based on rectangular toolbar anchors, so names spill from triangles, diamonds, ovals, and sloped shapes.
- Connection creation is not an explicit gesture. A broad snap radius allows a cancelled gesture to mutate the map.
- Ports are visually small, but their hover and valid-target feedback do not communicate their larger hit area.
- Selection is a heavy black stroke which obscures the coloured contour instead of separating and emphasizing it.
- Undo checkpoints are time-based rather than intention-based, so a drag or repeated colour input can become several incoherent history entries.
- Cursor semantics are missing. Canvas pan, object move, perimeter resize, linking, text editing, and colour sampling should never look identical.

### Editor

- The old live editor uses an invisible textarea over independently laid-out compiled HTML. Source characters and rendered glyphs cannot share caret coordinates or wrapping. This architecture causes misplaced carets, broken selection, and source-range corruption.
- A real editor must own the document model, selection, clipboard, IME, undo, composition, and source offsets.
- Formula preview must be derived from the active source range and updated immediately, without a modal, floating raw-text window, or duplicated full document.
- Save behavior should be quiet and dependable: idle autosave, blur save, explicit Ctrl/Cmd+S, and one restrained error state.

### Visual system

- Global Times New Roman makes menus, filenames, buttons, and panel chrome look unstyled. Serif belongs to mathematics, not application tooling.
- Pure white on every layer creates no hierarchy between canvas, file tree, inspector, menus, and controls.
- Group colour appears pale when large fills are reduced to near-zero opacity. The solution is stronger ordinary pigments, substantial true-alpha fields, and full-strength contours—not neon or opaque pastel cards.
- `mix-blend-mode` dirties overlapping colours and adds compositing work.
- The grid dots are large enough to compete with frames; they should remain black but optically smaller and crisp.
- Current context tools look like a form dumped into a popup: every option is visible, headings repeat the obvious, and control grids wrap unpredictably.
- Native colour input is visually unrelated to the palette and there is no explicit RGB workflow.
- Search is presented as a permanent sentence instead of an invoked command.
- File navigation lacks a distinct neutral chrome surface and professional type/row rhythm.

### Architecture and scale

- Notes are canonical files, while map metadata lives only in browser local storage. That makes the atlas hard to back up, version, or move with the notes.
- Search removes nodes from the graph instead of preserving spatial context and de-emphasizing nonmatches.
- Selection and group dragging rebuild broad node arrays. Large transparent blend-mode SVGs add avoidable compositing cost.
- Pointer previews and persistence are coupled; map state should preview at frame rate and persist once at the end of an intention.
- The intended huge canvas needs minimal navigation: zoom, fit all, focus selected, smooth pan, and a remembered viewport.

## Interaction invariants

1. One shared shape utility defines the visible contour, selection contour, title anchor, ports, perimeter hit target, and resize directions.
2. Group interior is pointer-through. Its title moves the group; its contour selects/resizes; its ports link.
3. A link commits only after a real drag ends on a valid, explicit target. Blank release, same-node release, Escape, right click, pointer cancellation, or loss of capture creates nothing.
4. Every long gesture previews locally and creates one undo transaction when committed.
5. All stored position and size values use the same grid interval.
6. Menus open at the pointer and flip around viewport edges. Escape backs out of a subtool before closing the menu.
7. Icon-only controls carry an accessible name and tooltip. Mathematical semantic choices retain short words because their icons are not self-explanatory.
8. The visible port stays 4–5 px; its hit target stays at least 26 px; eligible targets receive a clear halo while linking.
9. Group names are clamped to a contour-safe span and scale with their frames; zooming out must never make a label grow relative to its Group. Their world-space font defaults to 28px and is directly adjustable from 12–56px.
10. Map selection, file selection, and the open editor document remain synchronized.
11. Subject, Group, and Subgroup parentage is spatial metadata only; no canvas operation reorganizes the file tree.
12. An active landmark or group drag crosses desktop-monitor seams in world coordinates and has one persistence owner.

## Visual tokens

```css
--font-ui: ui-sans-serif, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
--font-math: "STIX Two Text", "Cambria Math", Georgia, "Times New Roman", serif;

--canvas: #ffffff;
--chrome: #f5f6f7;
--surface: #ffffff;
--hover: #eceff2;
--active: #e2e7ec;
--ink: #15171a;
--ink-secondary: #505761;
--line: #cdd2d8;
--line-strong: #858d97;
--focus: #111418;
--danger: #b42318;
```

Subject palette:

- red `#D62828`
- orange `#E86F00`
- yellow/gold `#C79500`
- green `#238636`
- blue `#1F6FEB`
- indigo `#4F46B5`
- violet `#8A2AA5`

Subject fields use 28% colour, Groups 42%, and Subgroups 56%. These are deliberately substantial, ordinary pigments rather than near-white pastel washes; full-strength thin contours keep their identity precise while the black grid remains visible through every level. Landmark interiors stay white. A selected contour gets a white separation halo and a thinner ink ring behind the original colour frame.

## Tool architecture

- Right-clicking the canvas opens a disciplined creation palette. Subject, Group, and Subgroup form one compact spatial row separated from mathematical note kinds.
- Right-clicking a landmark opens a small object palette with tabs for semantic kind, shape, and colour. There is no “Mathematical type” heading.
- Right-clicking any spatial frame opens rename plus focused level, shape, combined title-anchor/size, frame, and colour subtools.
- Right-clicking a connection opens an inline relation label plus direction, path/line, colour, and delete subtools.
- Colour shows exactly seven rainbow squares and one spectrum square in a single row. Its focused panel provides synchronized hex and R/G/B inputs plus icon-only transfer tools.
- Search is a 30–32 px icon. Click or Ctrl/Cmd+K opens the field; Escape clears and closes it.

## Acceptance criteria

Before a redesign is handed back:

- Test at 100%, approximately 60%, and overview zoom.
- Titles stay screen-size stable, fit their real contour, and never spill.
- The same contour is visible, selectable, resizable, and connectable.
- Black grid dots remain visible through every group fill.
- UI chrome is sans serif; landmark titles and rendered notes are serif.
- Palette rows never wrap and all colour wells remain square.
- Exact RGB entry works in both directions with validation and clamping.
- Cancelling every connection path creates no edge.
- Formula edits keep a real caret, preserve neighboring source, and save only to `study/content`.
- Hiding both sidebars leaves essentially the full viewport to the canvas.
- Pan, drag, resize, typing, menus, undo, and file selection are exercised in a real browser with no console errors.
- The root and content-tree API both respond on `http://127.0.0.1:1420`.
