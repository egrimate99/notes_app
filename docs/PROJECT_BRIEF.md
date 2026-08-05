# Math Atlas — Project Brief

Last updated: 4 August 2026  
Status: historical product foundation; Decisions D-020 through D-026 govern the current prototype interface

Publication note: subject names, source paths, inventories, and note contents are
private local data and have been generalized in this public document. The local
`content/` tree is excluded from version control.

The current build deliberately narrows this wider brief to the file tree, one all-subject spatial canvas, and one rendered note editor. Recall, trails, lenses, and frontier workflows below remain possible future directions rather than current interface features.

## Product in one sentence

Math Atlas is a local-first mathematical learning environment that turns atomic notes into a stable spatial atlas of typed landmarks, meaningful connections, and retrievable paths.

## User and purpose

The product is for people building a long-lived mathematical knowledge map
across their own areas of study. Those areas may change, so they must be editable
regions in local project data rather than fixed application navigation.

The objective is not merely to store notes. It is to build a durable mental map of mathematics, remember where ideas sit, understand how they depend on one another, reconstruct important paths, and identify the frontier between mastered and weak knowledge.

## Problem to solve

The existing Obsidian workflow already provides Markdown notes and subject canvases, but a general-purpose canvas has limitations for this use case:

- every note tends to look structurally alike;
- an edge does not explain why two mathematical objects are connected;
- large canvases become visually noisy;
- browsing can feel productive without requiring recall;
- proof, prerequisite, application, and research paths are not first-class objects;
- learning state is attached to whole notes rather than to distinct abilities.

Math Atlas should preserve the ownership and portability of the existing material while adding a mathematical semantic layer and memory-oriented interactions.

## Product model

Use this vocabulary consistently in the interface, documentation, and data model:

| Term | Meaning |
| --- | --- |
| **Atlas** | The complete mathematical knowledge world. |
| **Region** | A subject, subfield, or manually curated area of the atlas. |
| **Landmark** | A typed unit of mathematical knowledge. This replaces “bubble” as the product term. |
| **Connection** | A labelled semantic relationship between two landmarks. |
| **Trail** | An intentionally ordered learning, proof, application, contrast, research, or review path. |
| **Lens** | A filtered view of the same knowledge, such as prerequisites, mastery, sources, or research. |
| **Frontier** | Weak knowledge, unresolved questions, missing prerequisites, and incomplete notes. |

A landmark is canonical content. A placement is one visual appearance of that landmark in a region or trail. The same landmark can therefore appear in several contexts without duplicating its mathematics.

## Landmark taxonomy

The initial taxonomy has eight families. It should be extendable, but the first prototype should resist adding types until a real example cannot fit cleanly.

| Family | Includes | Visual direction |
| --- | --- | --- |
| **Definition** | Object, property, notation | Capsule or bracketed card |
| **Result** | Theorem, lemma, proposition, corollary, identity | Hexagonal or clipped-corner card, with a subtype badge |
| **Method** | Algorithm, construction, technique, procedure | Chevron or gear-cornered card |
| **Example** | Worked example, application, counterexample | Folded-corner card; counterexamples receive a distinct badge |
| **Problem** | Exercise, question, conjecture, open problem | Diamond marker combined with a readable card |
| **Insight** | Intuition, warning, analogy, comparison | Soft-edged card |
| **Source** | Paper, lecture, book, PDF section | Document silhouette |
| **Concept** | Topic anchor or unclassified mathematical material | Neutral rounded card |

Theorem, lemma, proposition, and corollary share the Result family. Their subtype is meaningful, but their epistemic role does not justify unrelated shapes.

Proofs remain embedded in their Result by default. Promote a proof to an independent **Argument** landmark only when there are alternative proofs, its technique is reusable, its internal dependency path matters, or it should be practised separately.

## Connection vocabulary

The initial connection types are:

- `requires`
- `implies`
- `generalises`
- `equivalent-to`
- `uses`
- `applies-to`
- `example-of`
- `counterexample-to`
- `contrasts-with`
- `analogous-to`
- `related-to` as a temporary fallback

Direction and labels matter. An imported Markdown link initially means “mentions,” not “requires.” Unlabelled Obsidian Canvas edges may enter an import inbox as provisional `related-to` connections and should require confirmation before becoming trusted structure.

## Trails

Trails are ordered overlays on the atlas rather than duplicated content. Initial trail kinds are:

- **Learning:** prerequisites in a deliberate study order.
- **Proof:** assumptions through definitions and lemmas to a target result.
- **Application:** definition through method to a worked problem.
- **Contrast:** neighbouring concepts that are easy to confuse.
- **Research:** source through method and gap to an open question.
- **Review:** currently due recall tasks arranged as an expedition.
- **Cross-subject:** a route that explicitly bridges regions.

The first prototype should implement one dependency-rich learning trail end to
end using local or synthetic sample material.

## Memory model

The atlas is not successful if it only makes passive browsing pleasant. It must make retrieval and spatial reconstruction routine.

Initial recall interactions should include:

- hide a definition and state it before revealing;
- recall a result’s hypotheses and conclusion separately;
- reveal a proof progressively (destination, key idea, first step, full proof);
- remove or alter a hypothesis and ask for a counterexample;
- explain why a selected connection exists;
- choose which result or method applies without being told the topic;
- walk a trail forward, backward, or from a random midpoint;
- reconstruct a small local map from a blank canvas;
- place hidden landmarks back near their stable remembered positions;
- distinguish easily confused neighbours;
- translate among a formal statement, intuition, diagram, and example.

Track mastery by facet rather than assigning a single score to an entire note. Useful facets are:

- state;
- explain;
- derive or prove;
- apply;
- connect or place in the map.

Review history should eventually be append-only. A scheduling model may be introduced later, after the interaction model is validated; the first prototype needs only “attempt, reveal, record.”

## Spatial and visual principles

- Preserve stable, manually chosen anchor positions so the user can form spatial memories.
- Automatically place only new or unplaced material; never silently rearrange curated geography.
- Use semantic zoom: regions at long distance, then landmarks, then details and formulas.
- Default to a local neighbourhood around the current landmark, not the entire graph.
- Fade or hide irrelevant connections and allow connection-type filtering.
- Support saved viewpoints, breadcrumbs, and a clear route back to the parent region.
- Use shape and icon for landmark family, colour for subject region, line style/arrowhead for connection meaning, and badges for state or subtype.
- Do not encode essential meaning in colour alone.
- At distant zoom, silhouettes may dominate. At reading zoom, expand to conventional cards so prose and formulas remain legible.
- Allow personal mnemonic imagery later, but keep the initial cartographic visual language calm and consistent.

## Core modes

The full product direction includes:

- **Atlas:** browse, filter, connect, and arrange the stable map.
- **Focus:** read or edit one landmark with rendered mathematics.
- **Trail:** follow or author an ordered route.
- **Recall:** hide content, attempt, reveal, and record.
- **Workshop:** keep temporary calculations and sketches before promoting them.
- **Inbox:** classify imported, transcribed, or AI-suggested material.
- **Frontier:** expose weak areas, unresolved questions, and missing dependencies.
- **Source extraction:** view a PDF/transcription beside candidate landmarks while retaining provenance.

The first release does not need every mode. Atlas, Focus, one Trail, and a minimal Recall loop are the critical vertical slice.

## Local-first storage

Human-owned files are canonical at runtime. They remain private and are excluded
from this public repository; the following tree describes a local workspace:

```text
study/
  content/          Private Markdown landmark files
  maps/             Versioned spatial placements and region definitions
  trails/           Versioned ordered paths
  assets/           Images, PDFs, and sketches
  reviews/          Append-only review events
  docs/             Briefs, decisions, and handoffs
  .study/           Rebuildable indexes, caches, and local settings
```

Storage rules:

- Landmark prose and mathematics live in Markdown.
- Simple metadata lives in YAML front matter.
- Every landmark receives a stable ID so file renames do not break maps.
- Coordinates belong to a placement, not to the canonical landmark.
- Rich map layouts and trails live in documented, versioned JSON sidecars.
- SQLite may provide full-text search, indexes, and review projections later, but it is rebuildable and never the sole source of mathematical content.
- Keep application source suitable for Git while excluding the private local library.
- Preserve Unicode and flag likely encoding damage during import.

An illustrative landmark header is:

```yaml
---
id: example.result
title: Example result
type: result
subtype: proposition
regions:
  - example-subject
source:
  kind: pdf
  path: source-document.pdf
  pages: [1, 2]
status: draft
---
```

This schema is illustrative rather than frozen. A versioned schema and fixtures should be added before importing at scale.

## Technical direction

- React and TypeScript for the interface.
- Vite for frontend development and builds.
- React Flow for custom typed landmarks, placements, ports, and semantic connections.
- KaTeX through Markdown plugins for mathematical rendering.
- Tauri 2 for a local Windows desktop shell and controlled filesystem access.
- SQLite full-text search later as a rebuildable index.

Prefer repo-native HTML, CSS, SVG, and React components for the visual language. Do not introduce bitmap assets where a crisp, semantic UI component is more appropriate.

## Representative-subject pilot

Start with a carefully chosen local or synthetic subject slice rather than importing an entire private vault. The pilot should demonstrate:

1. Import or manual creation of representative landmark types.
2. Stable spatial placement and region grouping.
3. Mathematical Markdown rendered correctly.
4. Typed, filterable connections.
5. One complete learning trail.
6. A hide–attempt–reveal recall interaction.
7. Source-path and PDF-page provenance.
8. A reversible Obsidian Canvas export or copied import workflow.

A manageable representative subject should exercise definitions, results,
methods, examples, and cross-links without publishing private note content.

## Source material and migration safety

The source is outside this repository:

```text
<external-vault-path>
```

An optional source document may likewise be referenced by a private local path:

```text
<source-document-path>
```

During the pilot:

- open the existing vault read-only;
- copy selected content into this project rather than moving it;
- preserve original relative paths and source page numbers;
- treat automatic classifications and connections as proposals;
- put ambiguous material into the Inbox;
- diagnose mojibake and other Unicode damage before accepting imported text;
- do not perform a full-vault migration;
- keep Obsidian usable throughout development.

Support JSON Canvas import/export where practical. Standard Canvas nodes and edges cannot express every Math Atlas semantic, so richer types must live in Math Atlas metadata while exports degrade gracefully.

## MVP acceptance criteria

The first useful prototype is complete when the user can:

- open the local application without granting write access to the Obsidian source vault;
- see a coherent sample region with visibly distinct landmark families;
- pan, zoom, select, and inspect landmarks;
- read Markdown and mathematical notation in a detail panel;
- distinguish at least the principal semantic connection types;
- switch to a local-neighbourhood or prerequisite-focused view;
- follow one ordered trail;
- perform a hide–attempt–reveal recall on a landmark or path;
- see provenance for imported material;
- reload without losing curated sample placements.

## Explicit non-goals for the first version

- replacing or migrating the whole Obsidian vault;
- mobile applications;
- cloud sync or collaboration;
- a public plugin API;
- a 3D memory palace;
- autonomous AI construction of the map;
- a proprietary rich-text storage format;
- a sophisticated spaced-repetition scheduler;
- perfect automatic layout of the full graph.

## AI boundary

AI may later suggest landmark boundaries, types, connections, prompts, summaries, and initial placements. Each suggestion must retain provenance, enter an inbox or review state, and require explicit acceptance. AI should accelerate curation without silently becoming the authority for mathematical structure.

## Handoff rule

New implementation conversations should read this brief and `docs/DECISIONS.md`, then inspect the actual repository before changing code. If implementation and this brief disagree, record the resolution in the decision log rather than silently changing the product model.
