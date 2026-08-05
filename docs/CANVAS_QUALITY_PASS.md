# Canvas quality pass

This pass is intentionally measured by distinct user-visible or architectural
improvements, not by a list of files changed. The atlas and canonical notes are
not test fixtures; browser workflows restore every temporary state they create.

## File and folder movement

1. Disable Tauri's native file-drop interception in the main workspace WebView.
2. Disable the same interception in every dynamically-created monitor WebView.
3. Keep an in-memory drag session so protected `DataTransfer` payloads do not break same-window moves.
4. Retain a validated serialized payload fallback for cross-component note drops.
5. Reduce a mixed selection to move roots, so selected descendants never move twice.
6. Move multi-selected files and folders as one history transaction.
7. Treat a file row as a deliberate proxy for its containing folder.
8. Expand a collapsed folder after a guarded hover delay.
9. Cancel pending hover expansion and the complete drag cleanly with Escape.
10. Reveal a dedicated Files-root target only while a valid move is active.
11. Reject self-nesting, descendant nesting, no-op, collision, and protected-root moves before drop.
12. Distinguish direct, parent-proxy, root, and invalid targets with precise frames.
13. Cache the current drop plan instead of rebuilding drag payload state on every dragover frame.
14. Preserve immediate Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for folder moves.

## Shape-aware group titles

15. Keep mathematical group typography horizontal at every contour anchor.
16. Fit oval titles into contour-attached capsules instead of rotated rectangles.
17. Fit hexagon titles into chamfered plaques.
18. Fit octagon titles into cut-corner plaques.
19. Fit rhombus titles into shallow lozenges.
20. Fit triangle titles into readable pointed tabs.
21. Fit parallelogram titles into slanted plaques.
22. Give rectangle titles crisp corner-attached plates.
23. Give Subjects a double-frame cartouche and circular index seal.
24. Give Groups a geometric plate, colour rail, and diamond key.
25. Give Subgroups a compact technical tag and bracket motif.
26. Wrap full titles with balanced lines and no ellipsis.
27. Align text and attachment details to the selected contour side.
28. Strengthen hover and selection without turning a monitor-sized group into a halo.
29. Cache shape/title geometry and glyphs across zoom rerenders.

## Canvas interaction and performance

30. Ignore identical group appearance, level, landmark appearance, and connection writes.
31. Persist a dragged group and every nested group in one atlas transaction.
32. Snap title-handle movement live to the 28-unit grid.
33. Use far, mid, and near semantic-zoom tiers.
34. Apply two-way zoom hysteresis so details do not flicker around thresholds.
35. Track viewport navigation explicitly as a canvas performance mode.
36. Track landmark/group/title dragging explicitly as a second performance mode.
37. Suspend previews, fine ornaments, edge labels, transitions, shadows, and filters during motion.
38. Keep titles while suppressing heavy document detail and ports at medium zoom.
39. Emphasize edges incident to the hovered object and quiet unrelated edges.
40. Track the active connection source and strengthen candidate contour feedback.
41. Make Escape cancel connections, reconnects, menus, edge selection, and local/desktop drag previews.
42. Tombstone a cancelled React Flow drag through drag-stop so it cannot persist afterward.
43. Add `+`, `=`, `-`, `_`, Home, and Ctrl/Cmd+0 canvas navigation.
44. Let Focus/F center groups and frame both endpoints of a selected edge as well as landmarks.
45. Cache custom-group containment by exact geometry and placement identities.
46. Respect reduced-motion preferences for canvas elements and pseudo-elements.

## Landmark and customization quality

47. Snap landmark resizing during the gesture, eliminating the pointer-up jump.
48. Hold the opposite landmark edge fixed while a moving edge snaps.
49. Scale landmark title typography with the authored box dimensions.
50. Wrap long landmark and document-card headings instead of ellipsizing them.
51. Encode mathematical roles with restrained definition, theorem, proposition, lemma, corollary, method, example, and problem frame details—without visible tags.
52. Use the topic colour for the precise selected-landmark keyline.
53. Add independent, persisted group fill opacity from outline-only to 50%.
54. Add independent hairline, regular, and strong group border weights.
55. Preview opacity live but persist pointer-up plus blur as one undo intent.
56. Keep incomplete RGB channel edits local until a valid blur/Enter commit.
57. Restore RGB drafts with Escape and avoid manufacturing a black history state when a field is cleared.

## Verification gates

- Unit/component suites cover explorer planning, group persistence, group title geometry, semantic zoom, interaction cancellation, frame snapping, colour drafts, and surface controls.
- Real Edge workflows exercise folder moves and canvas copies with physical mouse events.
- A contour-title regression covers nested Subject/Group/Subgroup shapes and zoom invariance.
- Production TypeScript, Vite, bundle ceilings, Rust tests, and Tauri compilation must pass before handoff.
- `http://127.0.0.1:1420/` and `/api/content/tree` must both respond at handoff.
