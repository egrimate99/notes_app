import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const assetsDirectory = path.resolve("dist/assets");
const assetNames = await readdir(assetsDirectory);

async function sizeFor(pattern, label) {
  const candidates = assetNames.filter((candidate) => pattern.test(candidate));
  if (!candidates.length) throw new Error(`Missing ${label} chunk in dist/assets.`);
  const measured = await Promise.all(candidates.map(async (name) => ({
    name,
    metadata: await stat(path.join(assetsDirectory, name)),
  })));
  const { name, metadata } = measured.reduce((largest, candidate) =>
    candidate.metadata.size > largest.metadata.size ? candidate : largest,
  );
  const filePath = path.join(assetsDirectory, name);
  const contents = await readFile(filePath);
  return {
    label,
    name,
    rawBytes: metadata.size,
    gzipBytes: gzipSync(contents).byteLength,
  };
}

const entry = await sizeFor(/^index-.*\.js$/, "application shell");
const graph = await sizeFor(/^AtlasGraph-.*\.js$/, "atlas graph");
const markdown = await sizeFor(/^MarkdownView-.*\.js$/, "deferred math renderer");
const liveEditor = await sizeFor(
  /^LiveNoteEditor-.*\.js$/,
  "deferred live-editor orchestration",
);
const livePreviewEditor = await sizeFor(
  /^LivePreviewBlockEditor-.*\.js$/,
  "deferred caret editor",
);
const landmarkPreview = await sizeFor(
  /^LandmarkPreviewContent-.*\.js$/,
  "deferred landmark content preview",
);
const desktopControls = await sizeFor(
  /^DesktopSurfaceControls-.*\.js$/,
  "deferred desktop controls",
);
const landmarkCreation = await sizeFor(
  /^DeferredLandmarkCreationForm-.*\.js$/,
  "deferred landmark creation",
);
const contextMenus = await sizeFor(
  /^MapContextMenu-.*\.js$/,
  "deferred contextual menus",
);
const atlasMenuContent = await sizeFor(
  /^DeferredAtlasMenuContent-.*\.js$/,
  "deferred atlas menu content",
);
const budgets = [
  { chunk: entry, maxRaw: 330_000, maxGzip: 100_000 },
  // Includes the three-level spatial hierarchy, cross-monitor drag runtime,
  // semantic-zoom state machine, cancellation safety, containment cache,
  // pointer-synchronous frame resizing, and atomic desktop resize routing.
  // Palette, renderer, and editor implementation stay deferred. Keep the
  // aggregate initial-load guard unchanged: that remains the meaningful
  // transport constraint. The narrow chunk allowance also covers the saved
  // formula-choice routing and the tiny async batch-drop dispatch; the
  // compiled picker, parser, packing, and collision work remain deferred. The
  // subject title icons and the shared mixed-selection drag runtime fit inside
  // this narrow local allowance. Magnetic calculations, guide rendering, and
  // right-click menu orchestration remain deferred; only their small gesture
  // facade is resident here. The unchanged aggregate guard below remains the
  // tighter constraint and caps initial interaction at 570 kB raw / 175 kB
  // gzip.
  { chunk: graph, maxRaw: 266_000, maxGzip: 86_000 },
  // Full Obsidian-note parity includes GFM tables/tasks, chunk-safe footnotes,
  // and glyph/row-aware formula hit mapping. The renderer remains deferred;
  // the narrow headroom prevents this correctness helper becoming a broad
  // budget increase while the initial-interaction ceiling below stays fixed.
  { chunk: markdown, maxRaw: 451_000, maxGzip: 136_500 },
  { chunk: liveEditor, maxRaw: 25_000, maxGzip: 10_000 },
  { chunk: livePreviewEditor, maxRaw: 340_000, maxGzip: 110_000 },
  { chunk: landmarkPreview, maxRaw: 15_000, maxGzip: 6_000 },
  { chunk: desktopControls, maxRaw: 15_000, maxGzip: 6_000 },
  { chunk: landmarkCreation, maxRaw: 15_000, maxGzip: 6_000 },
  { chunk: contextMenus, maxRaw: 12_000, maxGzip: 5_000 },
  // Palette contents are deliberately absent from the steady-state graph,
  // but the deferred boundary still needs its own ceiling so future menu work
  // cannot hide an unbounded payload behind the successful graph split.
  { chunk: atlasMenuContent, maxRaw: 16_000, maxGzip: 5_000 },
];
const initialRaw = entry.rawBytes + graph.rawBytes;
const initialGzip = entry.gzipBytes + graph.gzipBytes;

const failures = budgets.flatMap(({ chunk, maxRaw, maxGzip }) => {
  const messages = [];
  if (chunk.rawBytes > maxRaw) {
    messages.push(`${chunk.label} is ${chunk.rawBytes} B raw; budget is ${maxRaw} B.`);
  }
  if (chunk.gzipBytes > maxGzip) {
    messages.push(`${chunk.label} is ${chunk.gzipBytes} B gzip; budget is ${maxGzip} B.`);
  }
  return messages;
});

if (initialRaw > 570_000 || initialGzip > 175_000) {
  failures.push(
    `Initial shell + graph is ${initialRaw} B raw / ${initialGzip} B gzip; ` +
      "budget is 570000 B raw / 175000 B gzip.",
  );
}

for (const chunk of [
  entry,
  graph,
  markdown,
  liveEditor,
  livePreviewEditor,
  landmarkPreview,
  desktopControls,
  landmarkCreation,
  contextMenus,
  atlasMenuContent,
]) {
  console.log(
    `${chunk.label}: ${chunk.rawBytes} B raw / ${chunk.gzipBytes} B gzip (${chunk.name})`,
  );
}
console.log(`Initial interactive JS: ${initialRaw} B raw / ${initialGzip} B gzip.`);

if (failures.length) {
  throw new Error(`Bundle budget exceeded:\n- ${failures.join("\n- ")}`);
}
