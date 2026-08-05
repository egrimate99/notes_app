import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const appUrl = process.env.MATH_ATLAS_URL || "http://127.0.0.1:1420";
const edgeCandidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(projectRoot, "content");
const atlasPath = path.join(contentRoot, ".math-atlas", "atlas.json");
const tauriConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
const desktopSurfacePath = path.join(projectRoot, "src-tauri", "src", "desktop_surface.rs");
const screenshotPath = path.join(
  projectRoot,
  "docs",
  "screenshots",
  "file-management-workflow.png",
);
const dragTargetScreenshotPath = path.join(
  projectRoot,
  "docs",
  "screenshots",
  "file-management-drag-targets.png",
);
const kindConversionScreenshotPath = path.join(
  projectRoot,
  "docs",
  "screenshots",
  "file-to-canvas-kind-conversion-no-subject.png",
);
const batchDropScreenshotPath = path.join(
  projectRoot,
  "docs",
  "screenshots",
  "file-batch-canvas-drop.png",
);
const ephemeralMapStorageKey = "math-atlas:map-customizations:v1:math-atlas-v1";
const staleSubjectZoneId = "subject-zone:synthetic-field-04";
const ephemeralMapFixture = Object.freeze({
  schemaVersion: 1,
  snapshotKey: "math-atlas-v1",
  landmarkKinds: {},
  landmarks: {},
  // This reproduces the orphaned x/y record left by the old derived-subject
  // drag path. It must not be sufficient to author a visible canvas object.
  groups: {
    [staleSubjectZoneId]: { x: 1_736, y: -812 },
  },
  customLandmarks: [],
  customGroups: [],
  connectionOverrides: {},
  customConnections: [],
});
const fixtureToken = `${process.pid}-${Date.now()}`;
const fixtureRootPrefix = "Math Atlas QA ";
const sourceName = `${fixtureRootPrefix}${fixtureToken} Source`;
const targetName = `${fixtureRootPrefix}${fixtureToken} Target`;
const sourceRoot = path.join(contentRoot, sourceName);
const targetRoot = path.join(contentRoot, targetName);
const sourceRelative = sourceName;
const targetRelative = targetName;
const nestedName = `${fixtureRootPrefix}${fixtureToken} Nested proofs`;
const fixtureNotes = Object.freeze({
  alpha: {
    name: "Alpha Public Fixture Note 003.md",
    body: "# Alpha definition\n\n\\[\\alpha = 1\\]\n",
  },
  beta: {
    name: "Beta Public Fixture Note 012.md",
    body: "# Beta lemma\n\n\\[\\beta = 2\\]\n",
  },
  gamma: {
    name: "Gamma Public Fixture Note 023.md",
    body: "# Gamma theorem\n\n\\[\\gamma = 3\\]\n",
  },
  nested: {
    name: "Nested result.md",
    body: "# Nested result\n\nA disposable folder-drag fixture.\n",
  },
  targetPin: {
    name: "Drop target.md",
    body: "# Drop target\n\nA disposable file-row destination.\n",
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function contentPath(...parts) {
  return path.join(contentRoot, ...parts);
}

function relativePath(...parts) {
  return parts.join("/");
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function firstAvailable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through conventional Edge locations.
    }
  }
  throw new Error("Microsoft Edge was not found.");
}

async function assertDesktopHtmlDragDropEnabled() {
  const config = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  const windows = config?.app?.windows;
  assert(Array.isArray(windows) && windows.length > 0, "Tauri must configure a main window.");
  assert(
    windows.every((windowConfig) => windowConfig.dragDropEnabled === false),
    "Every configured Tauri window must disable the native file-drop handler for HTML5 drag/drop.",
  );
  const desktopSource = await readFile(desktopSurfacePath, "utf8");
  assert(
    /WebviewWindowBuilder::new[\s\S]*?\.disable_drag_drop_handler\(\)[\s\S]*?\.build\(\)/.test(desktopSource),
    "Desktop monitor windows must disable Tauri's native drag/drop handler before build().",
  );
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(label, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 45));
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
  throw new Error(`Timed out waiting for ${label}${detail}.`);
}

async function atlasSnapshot() {
  const [bytes, metadata] = await Promise.all([readFile(atlasPath), stat(atlasPath)]);
  return {
    bytes,
    mtimeMs: metadata.mtimeMs,
  };
}

async function markdownSnapshot(root) {
  const snapshot = new Map();

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const [bytes, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      snapshot.set(relative, {
        sha256: digest(bytes),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      });
    }
  };

  await visit(root);
  return snapshot;
}

function assertMarkdownSnapshotsEqual(before, after) {
  assert(
    before.size === after.size,
    `Original Markdown file count changed (${before.size} -> ${after.size}).`,
  );
  for (const [relative, expected] of before) {
    const actual = after.get(relative);
    assert(actual, `Original note disappeared: ${relative}`);
    assert(actual.sha256 === expected.sha256, `Original note content changed: ${relative}`);
    assert(actual.size === expected.size, `Original note size changed: ${relative}`);
    assert(actual.mtimeMs === expected.mtimeMs, `Original note was touched: ${relative}`);
  }
}

async function assertAtlasUnchanged(before) {
  const after = await atlasSnapshot();
  assert(after.bytes.equals(before.bytes), "Canonical atlas metadata content changed during QA.");
  assert(after.mtimeMs === before.mtimeMs, "Canonical atlas metadata was touched during QA.");
}

function assertSafeFixtureRoot(candidate) {
  const resolvedContent = path.resolve(contentRoot);
  const resolvedCandidate = path.resolve(candidate);
  assert(path.dirname(resolvedCandidate) === resolvedContent, `Unsafe QA cleanup target: ${candidate}`);
  assert(
    path.basename(resolvedCandidate).startsWith(fixtureRootPrefix),
    `Refusing to clean a non-QA path: ${candidate}`,
  );
}

async function removeFixtureRoot(candidate) {
  assertSafeFixtureRoot(candidate);
  if (!(await pathExists(candidate))) return;
  const metadata = await lstat(candidate);
  assert(!metadata.isSymbolicLink(), `Refusing to remove a symbolic-link fixture: ${candidate}`);
  assert(metadata.isDirectory(), `QA cleanup target is not a directory: ${candidate}`);
  await rm(candidate, { recursive: true, force: true });
}

async function cleanFixtures() {
  await removeFixtureRoot(sourceRoot);
  await removeFixtureRoot(targetRoot);
  await removeFixtureRoot(path.join(contentRoot, nestedName));
}

async function cleanStaleFixtures() {
  const entries = await readdir(contentRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(fixtureRootPrefix)) {
      await removeFixtureRoot(path.join(contentRoot, entry.name));
    }
  }
}

async function createFixtures() {
  assert(!(await pathExists(sourceRoot)), `QA source already exists: ${sourceRoot}`);
  assert(!(await pathExists(targetRoot)), `QA target already exists: ${targetRoot}`);
  await mkdir(path.join(sourceRoot, nestedName), { recursive: true });
  await mkdir(targetRoot, { recursive: false });
  await Promise.all([
    writeFile(path.join(sourceRoot, fixtureNotes.alpha.name), fixtureNotes.alpha.body, "utf8"),
    writeFile(path.join(sourceRoot, fixtureNotes.beta.name), fixtureNotes.beta.body, "utf8"),
    writeFile(path.join(sourceRoot, fixtureNotes.gamma.name), fixtureNotes.gamma.body, "utf8"),
    writeFile(
      path.join(sourceRoot, nestedName, fixtureNotes.nested.name),
      fixtureNotes.nested.body,
      "utf8",
    ),
    writeFile(path.join(targetRoot, fixtureNotes.targetPin.name), fixtureNotes.targetPin.body, "utf8"),
  ]);
}

function explorerRow(page, contentPathValue) {
  return page.locator(
    `.file-tree__row[data-content-path=${JSON.stringify(contentPathValue)}]`,
  );
}

async function assertRowSelection(page, expectations) {
  await page.waitForFunction((expected) => expected.every(({ contentPath: itemPath, selected }) => {
    const row = [...document.querySelectorAll(".file-tree__row")]
      .find((candidate) => candidate.getAttribute("data-content-path") === itemPath);
    return row?.getAttribute("aria-selected") === String(selected);
  }), expectations);
}

async function waitForExplorerIdle(page) {
  await page.waitForFunction(() =>
    document.querySelector('.file-tree[aria-label="Files"]')?.getAttribute("aria-busy") === "false"
  );
}

async function mapState(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    return key ? JSON.parse(localStorage.getItem(key)) : undefined;
  });
}

async function blankCanvasPoint(page) {
  return page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane");
    const bounds = pane?.getBoundingClientRect();
    if (!pane || !bounds) return undefined;
    for (let row = 2; row <= 8; row += 1) {
      for (let column = 2; column <= 8; column += 1) {
        const x = bounds.left + bounds.width * column / 10;
        const y = bounds.top + bounds.height * row / 10;
        const target = document.elementFromPoint(x, y);
        if (target === pane || target?.classList.contains("react-flow__pane")) {
          return { x, y };
        }
      }
    }
    return undefined;
  });
}

async function verifyFixturePosition({ present = [], absent = [] }, label) {
  await waitFor(label, async () => {
    const presentResults = await Promise.all(present.map(pathExists));
    const absentResults = await Promise.all(absent.map(pathExists));
    return presentResults.every(Boolean) && absentResults.every((value) => !value);
  });
}

await cleanStaleFixtures();
const atlasBefore = await atlasSnapshot();
const originalNotesBefore = await markdownSnapshot(contentRoot);
const executablePath = await firstAvailable(edgeCandidates);
await assertDesktopHtmlDragDropEnabled();
await mkdir(path.dirname(screenshotPath), { recursive: true });
await createFixtures();

let browser;
let primaryError;
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-features=msEdgeFirstRunExperience"],
  });
  const context = await browser.newContext({ viewport: { width: 1540, height: 940 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ mapStorageKey, mapFixture }) => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.clear();
    localStorage.setItem(mapStorageKey, JSON.stringify(mapFixture));
  }, {
    mapStorageKey: ephemeralMapStorageKey,
    mapFixture: ephemeralMapFixture,
  });
  await page.goto(appUrl, { waitUntil: "networkidle" });
  try {
    await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const visibleFailure = (await page.locator("body").innerText()).trim().slice(0, 1_500);
    throw new AggregateError([
      error,
      ...(errors.length ? [new Error(`Browser errors:\n${errors.join("\n")}`)] : []),
      ...(visibleFailure ? [new Error(`Visible page failure:\n${visibleFailure}`)] : []),
    ], "Math Atlas did not reach the file explorer.");
  }

  const sourceRootRow = explorerRow(page, sourceRelative);
  const targetRootRow = explorerRow(page, targetRelative);
  await sourceRootRow.waitFor({ state: "visible", timeout: 15_000 });
  await targetRootRow.waitFor({ state: "visible", timeout: 15_000 });
  assert(await sourceRootRow.getAttribute("draggable") === "true", "Folders must be draggable.");
  await sourceRootRow.click();

  const sourceAlphaRelative = relativePath(sourceRelative, fixtureNotes.alpha.name);
  const sourceBetaRelative = relativePath(sourceRelative, fixtureNotes.beta.name);
  const sourceGammaRelative = relativePath(sourceRelative, fixtureNotes.gamma.name);
  const targetAlphaRelative = relativePath(targetRelative, fixtureNotes.alpha.name);
  const targetBetaRelative = relativePath(targetRelative, fixtureNotes.beta.name);
  const targetGammaRelative = relativePath(targetRelative, fixtureNotes.gamma.name);
  const targetPinRelative = relativePath(targetRelative, fixtureNotes.targetPin.name);
  const sourceNestedRelative = relativePath(sourceRelative, nestedName);
  const sourceNestedNoteRelative = relativePath(
    sourceRelative,
    nestedName,
    fixtureNotes.nested.name,
  );
  const targetNestedRelative = relativePath(targetRelative, nestedName);
  const rootNestedRelative = nestedName;
  const sourceAlphaPath = contentPath(sourceRelative, fixtureNotes.alpha.name);
  const sourceBetaPath = contentPath(sourceRelative, fixtureNotes.beta.name);
  const sourceGammaPath = contentPath(sourceRelative, fixtureNotes.gamma.name);
  const targetAlphaPath = contentPath(targetRelative, fixtureNotes.alpha.name);
  const targetBetaPath = contentPath(targetRelative, fixtureNotes.beta.name);
  const targetGammaPath = contentPath(targetRelative, fixtureNotes.gamma.name);
  const sourceNestedPath = contentPath(sourceRelative, nestedName);
  const targetNestedPath = contentPath(targetRelative, nestedName);
  const rootNestedPath = contentPath(nestedName);

  const sourceAlpha = explorerRow(page, sourceAlphaRelative);
  const sourceBeta = explorerRow(page, sourceBetaRelative);
  const sourceGamma = explorerRow(page, sourceGammaRelative);
  await Promise.all([
    sourceAlpha.waitFor({ state: "visible" }),
    sourceBeta.waitFor({ state: "visible" }),
    sourceGamma.waitFor({ state: "visible" }),
  ]);

  // Hovering a real pointer over a collapsed folder expands it, while Escape
  // cancels the native drag without producing a filesystem operation.
  assert(
    await targetRootRow.getAttribute("aria-expanded") === "false",
    "The hover-expand fixture must begin collapsed.",
  );
  const sourceBetaBounds = await sourceBeta.boundingBox();
  const targetRootBounds = await targetRootRow.boundingBox();
  assert(sourceBetaBounds && targetRootBounds, "Drag fixtures must have visible bounds.");
  await page.mouse.move(
    sourceBetaBounds.x + sourceBetaBounds.width / 2,
    sourceBetaBounds.y + sourceBetaBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetRootBounds.x + targetRootBounds.width / 2,
    targetRootBounds.y + targetRootBounds.height / 2,
    { steps: 12 },
  );
  await explorerRow(page, targetPinRelative).waitFor({ state: "visible", timeout: 2_500 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector(".file-tree__row.is-dragging"));
  assert(await pathExists(sourceBetaPath), "Cancelling a folder hover must not move the note.");

  // Explorer semantics: click replaces, Shift extends a range, and Ctrl toggles.
  await sourceAlpha.click();
  await sourceBeta.click({ modifiers: ["Shift"] });
  await assertRowSelection(page, [
    { contentPath: sourceAlphaRelative, selected: true },
    { contentPath: sourceBetaRelative, selected: true },
    { contentPath: sourceGammaRelative, selected: false },
  ]);
  await sourceGamma.click({ modifiers: ["Control"] });
  await sourceBeta.click({ modifiers: ["Control"] });
  await assertRowSelection(page, [
    { contentPath: sourceAlphaRelative, selected: true },
    { contentPath: sourceBetaRelative, selected: false },
    { contentPath: sourceGammaRelative, selected: true },
  ]);

  // Dragging any selected row moves the entire selected file set as one transaction.
  await sourceAlpha.dragTo(targetRootRow);
  await verifyFixturePosition({
    present: [targetAlphaPath, targetGammaPath],
    absent: [sourceAlphaPath, sourceGammaPath],
  }, "the selected files to move together");
  await waitForExplorerIdle(page);
  const targetAlpha = explorerRow(page, targetAlphaRelative);
  const targetGamma = explorerRow(page, targetGammaRelative);
  await Promise.all([
    targetAlpha.waitFor({ state: "visible" }),
    targetGamma.waitFor({ state: "visible" }),
  ]);
  await assertRowSelection(page, [
    { contentPath: targetAlphaRelative, selected: true },
    { contentPath: targetGammaRelative, selected: true },
  ]);

  // File history is scoped to the explorer and reverses the whole batch at once.
  await targetAlpha.press("Control+z");
  await verifyFixturePosition({
    present: [sourceAlphaPath, sourceGammaPath],
    absent: [targetAlphaPath, targetGammaPath],
  }, "Ctrl+Z to restore both files");
  await waitForExplorerIdle(page);
  await explorerRow(page, sourceAlphaRelative).waitFor({ state: "visible" });

  await explorerRow(page, sourceAlphaRelative).press("Control+Shift+z");
  await verifyFixturePosition({
    present: [targetAlphaPath, targetGammaPath],
    absent: [sourceAlphaPath, sourceGammaPath],
  }, "Ctrl+Shift+Z to redo both file moves");
  await waitForExplorerIdle(page);
  await explorerRow(page, targetAlphaRelative).waitFor({ state: "visible" });

  await explorerRow(page, targetAlphaRelative).press("Control+z");
  await verifyFixturePosition({
    present: [sourceAlphaPath, sourceGammaPath],
    absent: [targetAlphaPath, targetGammaPath],
  }, "the final file-move undo");
  await waitForExplorerIdle(page);

  // A file row is an intentional proxy for its containing folder. This is the
  // most natural target when the folder is already open.
  const targetPin = explorerRow(page, targetPinRelative);
  await targetPin.waitFor({ state: "visible" });
  const sourceBetaDropBounds = await explorerRow(page, sourceBetaRelative).boundingBox();
  const targetPinBounds = await targetPin.boundingBox();
  assert(sourceBetaDropBounds && targetPinBounds, "File-row drop fixtures must have visible bounds.");
  await page.mouse.move(
    sourceBetaDropBounds.x + sourceBetaDropBounds.width / 2,
    sourceBetaDropBounds.y + sourceBetaDropBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetPinBounds.x + targetPinBounds.width / 2,
    targetPinBounds.y + targetPinBounds.height / 2,
    { steps: 12 },
  );
  await targetPin.locator("xpath=self::*[contains(@class, 'is-parent-drop-target')]").waitFor({
    state: "visible",
  });
  await page.screenshot({ path: dragTargetScreenshotPath, fullPage: true });
  await page.mouse.up();
  await verifyFixturePosition({
    present: [targetBetaPath],
    absent: [sourceBetaPath],
  }, "a file-row drop to move into its parent folder");
  await waitForExplorerIdle(page);
  await explorerRow(page, targetBetaRelative).press("Control+z");
  await verifyFixturePosition({
    present: [sourceBetaPath],
    absent: [targetBetaPath],
  }, "file-row drop undo");
  await waitForExplorerIdle(page);
  await explorerRow(page, sourceBetaRelative).press("Control+Shift+z");
  await verifyFixturePosition({
    present: [targetBetaPath],
    absent: [sourceBetaPath],
  }, "file-row drop redo");
  await waitForExplorerIdle(page);
  await explorerRow(page, targetBetaRelative).press("Control+z");
  await verifyFixturePosition({
    present: [sourceBetaPath],
    absent: [targetBetaPath],
  }, "final file-row drop undo");
  await waitForExplorerIdle(page);

  // Directories use the same path-safe move transaction and history.
  const sourceNested = explorerRow(page, sourceNestedRelative);
  await sourceNested.waitFor({ state: "visible" });
  await sourceNested.dragTo(targetRootRow);
  await verifyFixturePosition({
    present: [targetNestedPath],
    absent: [sourceNestedPath],
  }, "a folder move");
  await waitForExplorerIdle(page);
  const targetNested = explorerRow(page, targetNestedRelative);
  await targetNested.waitFor({ state: "visible" });
  const targetNestedBounds = await targetNested.boundingBox();
  assert(targetNestedBounds, "The moved folder must have visible bounds.");
  await page.mouse.move(
    targetNestedBounds.x + targetNestedBounds.width / 2,
    targetNestedBounds.y + targetNestedBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetNestedBounds.x + Math.min(targetNestedBounds.width - 4, 42),
    targetNestedBounds.y + targetNestedBounds.height / 2,
    { steps: 6 },
  );
  const rootDropTarget = page.locator(".file-tree__root-target");
  await rootDropTarget.waitFor({ state: "visible" });
  const rootTargetBounds = await rootDropTarget.boundingBox();
  assert(rootTargetBounds, "The transient Files-root target must be visible during a drag.");
  await page.mouse.move(
    rootTargetBounds.x + rootTargetBounds.width / 2,
    rootTargetBounds.y + rootTargetBounds.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await verifyFixturePosition({
    present: [rootNestedPath],
    absent: [targetNestedPath, sourceNestedPath],
  }, "a folder drop to the Files root");
  await waitForExplorerIdle(page);
  const rootNested = explorerRow(page, rootNestedRelative);
  await rootNested.waitFor({ state: "visible" });
  await rootNested.press("Control+z");
  await verifyFixturePosition({
    present: [targetNestedPath],
    absent: [rootNestedPath, sourceNestedPath],
  }, "Files-root move undo");
  await waitForExplorerIdle(page);
  await explorerRow(page, targetNestedRelative).press("Control+z");
  await verifyFixturePosition({
    present: [sourceNestedPath],
    absent: [targetNestedPath, rootNestedPath],
  }, "folder-move undo");
  await waitForExplorerIdle(page);

  // A Markdown file remains a repeatable canvas source without being moved on disk.
  const restoredAlpha = explorerRow(page, sourceAlphaRelative);
  await restoredAlpha.waitFor({ state: "visible" });
  await restoredAlpha.click();
  const graph = page.locator(".atlas-graph");
  const graphBounds = await graph.boundingBox();
  const point = await blankCanvasPoint(page);
  assert(graphBounds && point, "A blank canvas drop point is required.");
  assert(
    await page.locator(".region-frame").count() === 0,
    "A stale subject-zone appearance record materialized a frame before the file was placed.",
  );
  await restoredAlpha.dragTo(graph, {
    targetPosition: {
      x: point.x - graphBounds.x,
      y: point.y - graphBounds.y,
    },
  });
  await page.waitForFunction((notePath) => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    return state?.customLandmarks?.some((item) =>
      item.contentPath.toLocaleLowerCase() === `content/${notePath}`.toLocaleLowerCase()
    );
  }, sourceAlphaRelative);
  const customCopies = (await mapState(page)).customLandmarks.filter((item) =>
    item.contentPath.toLocaleLowerCase() === `content/${sourceAlphaRelative}`.toLocaleLowerCase()
  );
  assert(customCopies.length === 1, "The note-to-canvas smoke test must create one independent landmark.");
  const [customCopy] = customCopies;
  assert(customCopy.kind === "concept", "A dropped file must begin as an informal Note.");
  const canvasCopy = page.getByTestId(`landmark-${customCopy.id}`);
  await canvasCopy.waitFor({ state: "visible" });
  assert(
    await canvasCopy.getAttribute("data-math-kind") === "concept" &&
      await canvasCopy.getAttribute("class").then((value) => value?.includes("landmark-node--informal-note")),
    "The dropped copy did not render with the Note treatment before conversion.",
  );

  // Change kind through the same right-click tool the user operates. A canvas
  // instance may become mathematical without implicitly authoring a Subject or
  // legacy Region around itself, even when stale subject-zone geometry exists.
  await canvasCopy.click({ button: "right" });
  const editDialog = page.getByRole("dialog", { name: `Edit ${customCopy.title}`, exact: true });
  await editDialog.waitFor({ state: "visible" });
  const definitionOption = editDialog.getByRole("button", { name: "Definition", exact: true });
  assert(await definitionOption.count() === 1, "The landmark kind menu must expose one Definition option.");
  await definitionOption.click();
  await page.waitForFunction(({ copyId }) => {
    const node = document.querySelector(`[data-testid="landmark-${copyId}"]`);
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    const copy = state?.customLandmarks?.find((item) => item.id === copyId);
    return node?.getAttribute("data-math-kind") === "definition" && copy?.kind === "definition";
  }, { copyId: customCopy.id });
  await page.waitForTimeout(160);
  assert(
    await page.locator(".region-frame").count() === 0,
    "Converting a dropped Note to Definition synthesized a Subject or Region frame.",
  );
  assert(
    await page.locator(`[data-testid="group-${staleSubjectZoneId}"]`).count() === 0,
    "The stale Secondary Field subject zone became visible after landmark conversion.",
  );
  await page.keyboard.press("Escape");
  await editDialog.waitFor({ state: "detached" });
  await page.screenshot({ path: kindConversionScreenshotPath, fullPage: true });
  assert(
    (await readFile(sourceAlphaPath, "utf8")) === fixtureNotes.alpha.body,
    "Placing a note on the canvas must not rewrite it.",
  );

  // Dragging any member of a multi-selection copies the complete selection as
  // one compact, snapped row without moving or rewriting its source files.
  const restoredBeta = explorerRow(page, sourceBetaRelative);
  await restoredBeta.waitFor({ state: "visible" });
  await restoredAlpha.click();
  await restoredBeta.click({ modifiers: ["Control"] });
  await assertRowSelection(page, [
    { contentPath: sourceAlphaRelative, selected: true },
    { contentPath: sourceBetaRelative, selected: true },
  ]);
  const multiBefore = (await mapState(page)).customLandmarks.length;
  const multiPoint = await blankCanvasPoint(page);
  assert(multiPoint, "A blank point is required for the selected-note canvas drop.");
  await restoredAlpha.dragTo(graph, {
    targetPosition: {
      x: multiPoint.x - graphBounds.x,
      y: multiPoint.y - graphBounds.y,
    },
  });
  await page.waitForFunction(({ count }) => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    return state?.customLandmarks?.length === count + 2;
  }, { count: multiBefore });
  const multiCopies = (await mapState(page)).customLandmarks.slice(multiBefore);
  assert(
    multiCopies.map(({ contentPath }) => contentPath.toLocaleLowerCase()).sort().join("|") ===
      [sourceAlphaRelative, sourceBetaRelative]
        .map((notePath) => `content/${notePath}`.toLocaleLowerCase())
        .sort()
        .join("|"),
    "Dragging one selected note did not place the complete selected-note set.",
  );
  assert(
    multiCopies[0].y === multiCopies[1].y && multiCopies[0].x !== multiCopies[1].x,
    "Two selected notes were not arranged next to each other in one row.",
  );
  assert(
    multiCopies.every(({ x, y }) => x % 28 === 0 && y % 28 === 0),
    "Selected-note placement did not stay snapped to the canvas grid.",
  );

  // A folder is a recursive canvas source even while collapsed. Every
  // descendant Markdown file appears exactly once in a compact two-dimensional
  // block; the folder itself remains a filesystem-only object.
  await sourceRootRow.click();
  const folderBefore = (await mapState(page)).customLandmarks.length;
  const folderPoint = await blankCanvasPoint(page);
  assert(folderPoint, "A blank point is required for the folder canvas drop.");
  await sourceRootRow.dragTo(graph, {
    targetPosition: {
      x: folderPoint.x - graphBounds.x,
      y: folderPoint.y - graphBounds.y,
    },
  });
  await page.waitForFunction(({ count }) => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    return state?.customLandmarks?.length === count + 4;
  }, { count: folderBefore });
  const folderCopies = (await mapState(page)).customLandmarks.slice(folderBefore);
  const expectedFolderPaths = [
    sourceAlphaRelative,
    sourceBetaRelative,
    sourceGammaRelative,
    sourceNestedNoteRelative,
  ].map((notePath) => `content/${notePath}`.toLocaleLowerCase()).sort();
  assert(
    folderCopies.map(({ contentPath }) => contentPath.toLocaleLowerCase()).sort().join("|") ===
      expectedFolderPaths.join("|"),
    "The folder drop did not recursively place every descendant note exactly once.",
  );
  assert(
    new Set(folderCopies.map(({ x }) => x)).size === 2 &&
      new Set(folderCopies.map(({ y }) => y)).size === 2,
    "Four folder notes were not arranged as a compact two-by-two block.",
  );
  await page.screenshot({ path: batchDropScreenshotPath, fullPage: true });

  await assertAtlasUnchanged(atlasBefore);
  assert(errors.length === 0, `Browser console errors:\n${errors.join("\n")}`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Verified Shift/Ctrl multi-selection and a transactional two-file drag.");
  console.log("Verified HTML5 drag/drop is enabled in configured and dynamic Tauri windows.");
  console.log("Verified collapsed-folder hover, Escape cancellation, and file-row parent drops.");
  console.log("Verified explorer Ctrl+Z, Ctrl+Shift+Z redo, folder moves, and Files-root drops.");
  console.log("Verified a file-to-canvas Note can become a Definition without synthesizing a Subject or Region.");
  console.log("Verified selected notes and recursive folders place compact snapped canvas batches.");
  console.log(`Drag-target screenshot: ${dragTargetScreenshotPath}`);
  console.log(`Kind-conversion screenshot: ${kindConversionScreenshotPath}`);
  console.log(`Batch-drop screenshot: ${batchDropScreenshotPath}`);
  console.log(`Screenshot: ${screenshotPath}`);
  await context.close();
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await cleanFixtures();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await assertAtlasUnchanged(atlasBefore);
    assertMarkdownSnapshotsEqual(originalNotesBefore, await markdownSnapshot(contentRoot));
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    primaryError = primaryError
      ? new AggregateError([primaryError, ...cleanupErrors], "File workflow QA and cleanup failed.")
      : new AggregateError(cleanupErrors, "File workflow cleanup failed.");
  }
}

if (primaryError) throw primaryError;
