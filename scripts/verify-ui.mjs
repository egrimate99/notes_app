import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const appUrl = process.env.MATH_ATLAS_URL || "http://127.0.0.1:1420";
const edgeCandidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotsDir = path.join(projectRoot, "docs", "screenshots");
const contentRoot = path.join(projectRoot, "content");
const qaRunId = randomUUID().slice(0, 8);
const qaSubjectName = `QA Disposable Canvas ${qaRunId}`;
const qaSubjectId = `qa-disposable-canvas-${qaRunId}`;
const qaPrimaryFolderName = "QA Formulae";
const qaSecondaryFolderName = "QA Examples";
const qaSubjectDir = path.join(contentRoot, qaSubjectName);
const qaPrimaryDir = path.join(qaSubjectDir, qaPrimaryFolderName);
const qaSecondaryDir = path.join(qaSubjectDir, qaSecondaryFolderName);
const saveMarker = `QA${Date.now().toString(36)}`;

// Canonical canvases are allowed to be empty: notes have an independent life
// until the user places them. UI regression therefore owns a disposable canvas,
// content tree, and note set instead of reading the researcher's local material.
const uiNotePaths = [
  "QA Search Beacon.md",
  "QA Reference 02.md",
  "QA Reference 03.md",
  "QA Reference 04.md",
  "QA Reference 05.md",
  "QA Reference 06.md",
  "QA Formula Workspace.md",
  "QA Reference 08.md",
  "QA Reference 09.md",
  "QA Reference 10.md",
];
const qaInformalNoteName = "QA Scratchpad.md";
const qaEditorNoteName = uiNotePaths[6];
const qaRelativePath = (folder, name) => `${qaSubjectName}/${folder}/${name}`;
const qaContentPath = (folder, name) => `content/${qaRelativePath(folder, name)}`;
const editorRelativePath = qaRelativePath(qaPrimaryFolderName, qaEditorNoteName);
const editorPath = path.join(qaPrimaryDir, qaEditorNoteName);
const qaAllowedRelativePaths = new Set([
  ...uiNotePaths.map((name, index) => qaRelativePath(
    index === 9 ? qaSecondaryFolderName : qaPrimaryFolderName,
    name,
  )),
  qaRelativePath(qaSecondaryFolderName, qaInformalNoteName),
]);

function qaMarkdown(name, index) {
  const title = name.replace(/\.md$/i, "");
  return [
    `# ${title}`,
    "",
    "This is disposable synthetic browser-verification material.",
    "",
    `> [!theorem] QA Result ${index + 1}`,
    `> Before $x+${index + 1}$ after.`,
    "",
    "$$",
    `q_{${index + 1}}(t) = t^2 + ${index + 1}`,
    "$$",
    "",
    index === 0 ? "QA search beacon." : "QA reference text.",
    "",
  ].join("\n");
}

const qaContentTree = [{
  type: "directory",
  name: qaSubjectName,
  path: qaSubjectName,
  children: [
    {
      type: "directory",
      name: qaPrimaryFolderName,
      path: `${qaSubjectName}/${qaPrimaryFolderName}`,
      children: uiNotePaths.slice(0, 9).map((name) => ({
        type: "file",
        name,
        path: qaRelativePath(qaPrimaryFolderName, name),
      })),
    },
    {
      type: "directory",
      name: qaSecondaryFolderName,
      path: `${qaSubjectName}/${qaSecondaryFolderName}`,
      children: [uiNotePaths[9], qaInformalNoteName].map((name) => ({
        type: "file",
        name,
        path: qaRelativePath(qaSecondaryFolderName, name),
      })),
    },
  ],
}];

const uiFixture = {
  schemaVersion: 1,
  snapshotKey: "math-atlas-v1",
  landmarkKinds: {},
  landmarks: {},
  groups: {},
  customLandmarks: [
    ...uiNotePaths.map((name, index) => ({
      id: `qa-ui-landmark-${index}`,
      title: name.replace(/\.md$/i, ""),
      subjectId: qaSubjectId,
      regionId: "qa-ui-subject",
      contentPath: index === 9
        ? qaContentPath(qaSecondaryFolderName, name)
        : qaContentPath(qaPrimaryFolderName, name),
      x: (index % 5) * 252,
      y: 560 - Math.floor(index / 5) * 140,
      width: 196,
      height: 84,
      color: "#238636",
      shape: index % 3 === 0 ? "hexagon" : index % 3 === 1 ? "rectangle" : "oval",
      kind: index % 3 === 0 ? "theorem" : index % 3 === 1 ? "definition" : "example",
      contentMode: "title",
    })),
    {
      id: "qa-informal-note",
      title: "Check assumptions",
      subjectId: qaSubjectId,
      regionId: "qa-ui-subject",
      contentPath: qaContentPath(qaSecondaryFolderName, qaInformalNoteName),
      x: 0,
      y: 280,
      width: 196,
      height: 112,
      color: "#238636",
      shape: "rectangle",
      kind: "concept",
      contentMode: "title",
    },
  ],
  customGroups: [{
    id: "qa-ui-subject",
    title: qaSubjectName,
    subjectId: qaSubjectId,
    level: "subject",
    x: -112,
    y: -112,
    width: 1400,
    height: 900,
    color: "#238636",
    shape: "rectangle",
    borderStyle: "solid",
    borderWeight: "regular",
    titlePosition: "top-left",
    titleFontSize: 34,
  }],
  connectionOverrides: {},
  customConnections: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function phase(label) {
  console.log(`[verify:ui] ${label}`);
}

async function firstAvailable(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional Edge path.
    }
  }
  throw new Error("Microsoft Edge was not found.");
}

function assertDisposableSubjectPath() {
  const relative = path.relative(contentRoot, qaSubjectDir);
  assert(
    relative === qaSubjectName && !path.isAbsolute(relative),
    `Refusing to manage an unsafe QA directory: ${qaSubjectDir}`,
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

async function waitForDisposableNoteText(filePath, marker, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const markdown = await readFile(filePath, "utf8");
    if (markdown.includes(marker)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error("Live formula edits did not reach the disposable Markdown note.");
}

async function populateQaContent() {
  await Promise.all([
    mkdir(qaPrimaryDir, { recursive: true }),
    mkdir(qaSecondaryDir, { recursive: true }),
  ]);
  await Promise.all([
    ...uiNotePaths.map((name, index) => writeFile(
      path.join(index === 9 ? qaSecondaryDir : qaPrimaryDir, name),
      qaMarkdown(name, index),
      { encoding: "utf8", flag: "wx" },
    )),
    writeFile(
      path.join(qaSecondaryDir, qaInformalNoteName),
      qaMarkdown(qaInformalNoteName, uiNotePaths.length),
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
}

async function assertHealthyServer() {
  const root = await fetch(`${appUrl}/`);
  assert(root.ok, `Application root returned HTTP ${root.status}.`);
}

async function mapState(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    return key ? JSON.parse(localStorage.getItem(key)) : undefined;
  });
}

async function placementState(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:placement-overrides:"),
    );
    return key ? JSON.parse(localStorage.getItem(key)) : undefined;
  });
}

async function visiblePanePoint(page, horizontal = "middle", vertical = "middle") {
  const point = await page.evaluate(({ horizontal, vertical }) => {
    const pane = document.querySelector(".react-flow__pane");
    const bounds = pane?.getBoundingClientRect();
    if (!pane || !bounds) return undefined;
    const xStart = horizontal === "right" ? .97 : horizontal === "left" ? .08 : .32;
    const xEnd = horizontal === "right" ? .7 : horizontal === "left" ? .3 : .68;
    const yStart = vertical === "bottom" ? .97 : vertical === "top" ? .08 : .28;
    const yEnd = vertical === "bottom" ? .7 : vertical === "top" ? .3 : .72;
    for (let yStep = 0; yStep <= 12; yStep += 1) {
      for (let xStep = 0; xStep <= 12; xStep += 1) {
        const x = bounds.left + bounds.width * (xStart + (xEnd - xStart) * xStep / 12);
        const y = bounds.top + bounds.height * (yStart + (yEnd - yStart) * yStep / 12);
        const target = document.elementFromPoint(x, y);
        if (target === pane || target?.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    return undefined;
  }, { horizontal, vertical });
  assert(point, `Could not find a blank ${vertical}-${horizontal} canvas point.`);
  return point;
}

async function blankPointInsideVisibleGroup(page, level) {
  const point = await page.evaluate((requestedLevel) => {
    const pane = document.querySelector(".react-flow__pane");
    if (!pane) return undefined;
    const candidates = [...document.querySelectorAll(`.region-frame[data-group-level="${requestedLevel}"]`)]
      .map((node) => ({ node, bounds: node.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.width > 140 && bounds.height > 100 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight)
      .sort((left, right) => right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height);
    for (const { bounds } of candidates) {
      for (let yStep = 2; yStep <= 8; yStep += 1) {
        for (let xStep = 2; xStep <= 8; xStep += 1) {
          const x = bounds.left + bounds.width * xStep / 10;
          const y = bounds.top + bounds.height * yStep / 10;
          const target = document.elementFromPoint(x, y);
          if (target === pane || target?.classList.contains("react-flow__pane")) return { x, y };
        }
      }
    }
    return undefined;
  }, level);
  assert(point, `Could not find a blank canvas point inside a visible ${level}.`);
  return point;
}

function colorRange(rgb) {
  const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  return channels.length === 3 ? Math.max(...channels) - Math.min(...channels) : 0;
}

function nearlyEqual(a, b, tolerance = 1) {
  return Math.abs(a - b) <= tolerance;
}

async function clickTab(dialog, name) {
  const tab = dialog.getByRole("tab", { name, exact: true });
  assert((await tab.count()) === 1, `${name} must be one unambiguous context-tool tab.`);
  await tab.click();
  assert((await tab.getAttribute("aria-selected")) === "true", `${name} tab did not become selected.`);
}

async function connectionCount(page) {
  return (await mapState(page))?.customConnections?.length ?? 0;
}

async function exposedPort(page, testId, preferredSides, excludedSide) {
  return page.evaluate(({ testId: ownerTestId, preferredSides: sides, excludedSide: excluded }) => {
    const owner = document.querySelector(`[data-testid="${ownerTestId}"]`);
    if (!owner) return undefined;
    const regionId = ownerTestId.startsWith("group-") ? ownerTestId.slice("group-".length) : undefined;
    const regionPortLayer = regionId
      ? document.querySelector(`[data-region-port-layer="${CSS.escape(regionId)}"]`)
      : undefined;
    for (const side of sides) {
      if (side === excluded) continue;
      // Region nodes retain an inert in-node geometry handle for edge routing;
      // the viewport proxy is the actual pointer owner above overlapping edges.
      const port = regionPortLayer?.querySelector(`.region-port--proxy.atlas-port--${side}`) ??
        owner.querySelector(`.atlas-port--${side}`);
      const bounds = port?.getBoundingClientRect();
      if (!port || !bounds) continue;
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const target = document.elementFromPoint(point.x, point.y);
      if (target === port || port.contains(target)) return { side, ...point };
    }
    return undefined;
  }, { testId, preferredSides, excludedSide });
}

async function waitForLiveGroupLevel(page, id, level) {
  try {
    await page.waitForFunction(({ id: groupId, level: expectedLevel }) => (
      document.querySelector(`[data-testid="group-${groupId}"]`)?.getAttribute("data-group-level") === expectedLevel
    ), { id, level }, { timeout: 5_000 });
  } catch (cause) {
    const observed = {
      dom: await page.getByTestId(`group-${id}`).getAttribute("data-group-level"),
      persisted: (await mapState(page))?.customGroups?.find((group) => group.id === id)?.level,
      pressed: await page.locator(`[aria-label="Canvas group level"] button[data-group-level="${level}"]`).getAttribute("aria-pressed"),
    };
    throw new Error(`Group level ${level} did not reach the live frame (${JSON.stringify(observed)}).`, { cause });
  }
}

let browser;
let qaSubjectCreated = false;
const errors = [];
const unexpectedContentRequests = [];
const atlasMutations = [];

try {
  await assertHealthyServer();
  const executablePath = await firstAvailable(edgeCandidates);
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(contentRoot, { recursive: true });
  assertDisposableSubjectPath();
  await mkdir(qaSubjectDir);
  qaSubjectCreated = true;
  await populateQaContent();

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  // This flag is installed before application JavaScript runs. Mutations remain
  // local to this disposable browser context and can never seed atlas metadata.
  await context.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
  });

  // Keep both discovery endpoints wholly synthetic so merely running this
  // verifier never enumerates the researcher's folders or atlas metadata.
  await context.route("**/api/atlas*", async (route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: method === "HEAD" ? "" : JSON.stringify({
          atlas: uiFixture,
          revision: "qa-disposable-atlas",
        }),
      });
      return;
    }
    atlasMutations.push(method);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unavailable",
          message: "Disposable UI verification blocks atlas persistence.",
        },
      }),
    });
  });

  await context.route("**/api/content/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === "/api/content/tree" && (method === "GET" || method === "HEAD")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: method === "HEAD" ? "" : JSON.stringify(qaContentTree),
      });
      return;
    }
    if (requestUrl.pathname === "/api/content/file" && (method === "GET" || method === "PUT")) {
      const relativePath = requestUrl.searchParams.get("path") ?? "";
      if (qaAllowedRelativePaths.has(relativePath)) {
        await route.continue();
        return;
      }
    }
    unexpectedContentRequests.push({ method, pathname: requestUrl.pathname });
    await route.fulfill({
      status: method === "GET" || method === "HEAD" ? 404 : 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: method === "GET" || method === "HEAD" ? "not_found" : "conflict",
          message: "Disposable UI verification permits only its own QA notes.",
        },
      }),
    });
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.evaluate(({ fixture }) => {
    localStorage.clear();
    localStorage.setItem(
      "math-atlas:map-customizations:v1:math-atlas-v1",
      JSON.stringify(fixture),
    );
    localStorage.setItem(
      "math-atlas:viewport:math-atlas-v1",
      JSON.stringify({ x: 300, y: 190, zoom: 1 }),
    );
  }, { fixture: uiFixture });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".landmark-node").first().waitFor({ timeout: 15_000 });
  await page.locator(".landmark-node").first().click();
  await page.locator(".markdown-view").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const fixtureLandmarkCount = await page.locator(".landmark-node").count();
  assert(fixtureLandmarkCount >= 3, `Disposable canvas loaded only ${fixtureLandmarkCount} visible landmarks.`);
  assert(
    await page.evaluate(() => sessionStorage.getItem("math-atlas:ephemeral-session") === "true"),
    "The verification browser lost its ephemeral-session guard.",
  );

  phase("visual system");
  /* Visual system and interaction affordances. */
  const visualSystem = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const dot = document.querySelector(".react-flow__background pattern circle");
    const firstSubjectNode = document.querySelector(".region-frame--level-subject");
    const firstSubject = firstSubjectNode?.querySelector(".region-frame__shape");
    const firstSubjectTitle = firstSubjectNode
      ? document.querySelector(`[data-region-title="${firstSubjectNode.getAttribute("data-testid")?.replace(/^group-/, "")}"]`)
      : undefined;
    const firstSubjectIcon = firstSubjectTitle?.querySelector(".region-frame__subject-icon");
    const selected = document.querySelector(".landmark-node.is-selected");
    const selectedShape = selected?.querySelector(".landmark-node__shape");
    const selectedRing = selected?.querySelector(".landmark-node__selection-ring");
    return {
      bodyBackground: style("body").backgroundColor,
      bodyFont: style("body").fontFamily,
      fileFont: style(".file-tree").fontFamily,
      nodeFont: style(".landmark-node").fontFamily,
      paneBackground: style(".react-flow__pane").backgroundColor,
      paneCursor: style(".react-flow__pane").cursor,
      bodyCursor: style("body").cursor,
      nodeCursor: style(".react-flow__node-landmark").cursor,
      portCursor: style(".atlas-port").cursor,
      dotFill: dot ? dot.getAttribute("fill") || getComputedStyle(dot).fill : undefined,
      subjectFill: firstSubject ? getComputedStyle(firstSubject).fill : undefined,
      subjectFillOpacity: firstSubject ? Number.parseFloat(getComputedStyle(firstSubject).fillOpacity) : 1,
      subjectStroke: firstSubject ? getComputedStyle(firstSubject).stroke : undefined,
      subjectStrokeOpacity: firstSubject ? Number.parseFloat(getComputedStyle(firstSubject).strokeOpacity) : 0,
      subjectStrokeWidth: firstSubject ? Number.parseFloat(getComputedStyle(firstSubject).strokeWidth) : 0,
      subjectFrameStyle: firstSubjectNode?.getAttribute("data-subject-frame-style"),
      subjectDecorationCount: firstSubjectNode?.querySelectorAll(".region-frame__subject-frame, .region-frame__subject-texture, linearGradient, pattern").length,
      subjectTitleTreatment: firstSubjectTitle?.getAttribute("data-title-treatment"),
      subjectTitleMinHeight: firstSubjectTitle ? Number.parseFloat(getComputedStyle(firstSubjectTitle).minHeight) : 0,
      subjectIcon: firstSubjectIcon?.getAttribute("data-subject-icon"),
      subjectIconWidth: firstSubjectIcon ? Number.parseFloat(getComputedStyle(firstSubjectIcon).width) : 0,
      subjectIconHeight: firstSubjectIcon ? Number.parseFloat(getComputedStyle(firstSubjectIcon).height) : 0,
      subjectIconSvg: Boolean(firstSubjectIcon?.querySelector("svg")),
      selectedShapePath: selectedShape?.getAttribute("d"),
      selectedRingPath: selectedRing?.getAttribute("d"),
      selectedRingWidth: selectedRing ? Number.parseFloat(getComputedStyle(selectedRing).strokeWidth) : 0,
    };
  });
  assert(visualSystem.bodyBackground === "rgb(255, 255, 255)", "The application must use a white paper background.");
  assert(visualSystem.paneBackground === "rgba(0, 0, 0, 0)", "The canvas pane must leave the dot grid visible.");
  assert(!/Times New Roman/i.test(visualSystem.bodyFont), "Application tooling must use the professional UI sans-serif, not Times.");
  assert(!/Times New Roman/i.test(visualSystem.fileFont), "File navigation must use the UI typeface, not the mathematical typeface.");
  assert(/Times New Roman/i.test(visualSystem.nodeFont), "Mathematical landmarks must use the requested Times face.");
  assert(["#111418", "rgb(17, 20, 24)"].includes(visualSystem.dotFill?.toLowerCase()), `Grid dots must be dark ink (received ${visualSystem.dotFill}).`);
  assert(visualSystem.subjectFill === "none" && visualSystem.subjectFillOpacity === 0, "Subjects must remain uncoloured inside their perimeter frame.");
  assert(visualSystem.subjectStroke === "rgb(77, 85, 94)", `Subjects must use a neutral overview stroke (received ${visualSystem.subjectStroke}).`);
  assert(
      visualSystem.subjectFrameStyle === "double-rule" &&
      visualSystem.subjectDecorationCount === 0 &&
      visualSystem.subjectStrokeOpacity >= .5 &&
      visualSystem.subjectStrokeWidth >= 1.5 &&
      visualSystem.subjectTitleTreatment === "subject" &&
      visualSystem.subjectTitleMinHeight >= 78 &&
      visualSystem.subjectIcon === visualSystem.subjectFrameStyle &&
      visualSystem.subjectIconWidth === 54 &&
      visualSystem.subjectIconHeight === 54 &&
      visualSystem.subjectIconSvg,
    `Subjects must use a regular neutral cloud and a substantial icon title card (${JSON.stringify(visualSystem)}).`,
  );
  assert(visualSystem.bodyCursor.includes("pointer.svg"), "The shell must use the designed pointer cursor.");
  assert(visualSystem.paneCursor.includes("pointer.svg"), "Blank canvas must advertise left-button selection; right-drag panning is handled separately.");
  assert(visualSystem.nodeCursor.includes("move.svg"), "Landmarks must advertise dragging with the designed cursor.");
  assert(visualSystem.portCursor.includes("link.svg"), "Connection ports must use the designed linking cursor.");
  assert(visualSystem.selectedRingWidth >= 3 && visualSystem.selectedShapePath === visualSystem.selectedRingPath, "Selection must be a strong shape-following ring.");
  assert((await page.getByText("Math Atlas", { exact: true }).count()) === 0, "Redundant Math Atlas branding must remain absent.");
  assert((await page.getByText("Mathematics", { exact: true }).count()) === 0, "The redundant Mathematics heading must remain absent.");
  assert((await page.locator("select").count()) === 0, "No persistent dropdown controls should be visible.");
  assert((await page.getByRole("button", { name: /reset/i }).count()) === 0, "Reset controls should be replaced by undo.");

  const informalNote = page.getByTestId("landmark-qa-informal-note");
  await informalNote.waitFor();
  const informalNoteVisual = await informalNote.evaluate((node) => {
    const shape = node.querySelector(".landmark-node__shape");
    const fold = node.querySelector(".landmark-node__paper-fold");
    const title = node.querySelector(".landmark-node__content span");
    const style = shape ? getComputedStyle(shape) : undefined;
    return {
      className: node.className,
      framePath: shape?.getAttribute("d"),
      fill: style?.fill,
      filter: style?.filter,
      titleFont: title ? getComputedStyle(title).fontFamily : undefined,
      hasFold: Boolean(fold),
    };
  });
  assert(informalNoteVisual.className.includes("landmark-node--informal-note"), "Notes must have a dedicated informal-paper identity.");
  assert(informalNoteVisual.hasFold, "Informal notes must carry a folded paper corner.");
  assert(informalNoteVisual.framePath === "M0 0H180L196 16V112H0Z", "The paper fold must be part of the visible and interactive contour.");
  assert(!/Times New Roman/i.test(informalNoteVisual.titleFont ?? ""), "Informal notes must use the UI typeface, not theorem typography.");
  assert(informalNoteVisual.filter === "none", "Sticky notes must avoid expensive SVG/CSS filters on the large canvas.");
  await informalNote.click();
  await page.screenshot({ path: path.join(screenshotsDir, "regression-sticky-note.png"), fullPage: true });

  assert(
    (await page.getByRole("treeitem", { name: qaSubjectName, exact: true }).count()) === 1,
    "The disposable QA subject must be the one visible top-level content folder.",
  );
  const fileLabels = await page
    .locator(`[role="treeitem"][data-node-type="file"][data-content-path^="${qaSubjectName}/"] .file-tree__name`)
    .allTextContents();
  assert(fileLabels.length > 0 && fileLabels.every((label) => !/\.md$/i.test(label)), "Visible file names must omit .md.");
  assert((await page.locator(".landmark-node__kind").count()) === 0, "Landmark tags must stay off the canvas.");
  const portMetrics = await page.locator(".landmark-node .atlas-port").evaluateAll((ports) => {
    for (const port of ports) {
      const bounds = port.getBoundingClientRect();
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const ownsPoint = (x, y) => {
        const target = document.elementFromPoint(x, y);
        return target === port || target?.closest?.(".atlas-port") === port;
      };
      if (!ownsPoint(center.x, center.y)) continue;
      const hit = getComputedStyle(port);
      const paint = getComputedStyle(port, "::after");
      const hitDisc = port.querySelector(".atlas-port__hit");
      const hitStyle = hitDisc ? getComputedStyle(hitDisc) : undefined;
      const hitBounds = hitDisc?.getBoundingClientRect();
      const hitRadiusX = hitBounds ? hitBounds.width / 2 - 2 : 0;
      const hitRadiusY = hitBounds ? hitBounds.height / 2 - 2 : 0;
      const hitSamples = [
        ownsPoint(center.x - hitRadiusX, center.y),
        ownsPoint(center.x + hitRadiusX, center.y),
        ownsPoint(center.x, center.y - hitRadiusY),
        ownsPoint(center.x, center.y + hitRadiusY),
      ];
      if (!hitSamples.every(Boolean)) continue;
      return {
        anchorWidth: Number.parseFloat(hit.width),
        anchorHeight: Number.parseFloat(hit.height),
        hitWidth: Number.parseFloat(hitStyle?.width ?? "0"),
        hitHeight: Number.parseFloat(hitStyle?.height ?? "0"),
        paintWidth: Number.parseFloat(paint.width),
        paintHeight: Number.parseFloat(paint.height),
        hitSamples,
      };
    }
    return undefined;
  });
  assert(portMetrics, "A visible landmark connection dot is required for hit-area verification.");
  assert(portMetrics.anchorWidth <= 6 && portMetrics.anchorHeight <= 6, "Connection geometry must stay tight to the visible frame.");
  assert(portMetrics.hitWidth >= 26 && portMetrics.hitHeight >= 26, "Connection dots need a generous CSS hit disc.");
  assert(portMetrics.hitSamples.every(Boolean), `Connection dots need generous invisible hit targets: ${JSON.stringify(portMetrics)}.`);
  assert(portMetrics.paintWidth <= 7 && portMetrics.paintHeight <= 7, "Painted connection dots must remain visually small.");

  await page.screenshot({ path: path.join(screenshotsDir, "regression-overview.png"), fullPage: true });

  phase("file and search tools");
  /* File operations stay contextual and visually quiet until invoked. */
  const selectedFileRow = page.locator(`[role="treeitem"][data-content-path="${editorRelativePath}"]`);
  assert((await selectedFileRow.count()) === 1, "The disposable editor note must have one exact file-tree row.");
  await selectedFileRow.click({ button: "right" });
  const fileMenu = page.getByRole("menu", { name: "File actions" });
  await fileMenu.waitFor();
  for (const action of ["Open", "Rename", "Move to Trash"]) {
    assert(
      (await fileMenu.getByRole("menuitem", { name: new RegExp(`^${action}`) }).count()) === 1,
      `The file menu must expose ${action} contextually.`,
    );
  }
  await page.screenshot({ path: path.join(screenshotsDir, "regression-file-menu.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await fileMenu.waitFor({ state: "detached" });

  /* Search is a compact command, not permanent explanatory copy. */
  const searchTrigger = page.getByRole("button", { name: "Search notes", exact: true });
  assert((await searchTrigger.count()) === 1, "Search must have one icon trigger.");
  assert((await searchTrigger.getAttribute("aria-expanded")) === "false", "Search should begin collapsed.");
  assert((await page.locator(".search-bar").boundingBox()).width <= 34, "Collapsed search must be icon-sized.");
  await searchTrigger.click();
  const searchInput = page.getByRole("textbox", { name: "Search notes", exact: true });
  await searchInput.waitFor();
  assert(!await searchInput.getAttribute("placeholder"), "Search must not show instructional placeholder copy.");
  await page.waitForFunction(() => document.querySelector(".atlas-search")?.getBoundingClientRect().width >= 220);
  assert((await page.locator(".atlas-search").boundingBox()).width >= 220, "Search must expand into a useful input.");
  const landmarkCountBeforeSearch = await page.locator(".landmark-node").count();
  await searchInput.fill("qa search beacon");
  await page.getByRole("status", { name: /results/i }).waitFor();
  await page.locator(".landmark-node.is-search-match").first().waitFor();
  assert(
    (await page.locator(".landmark-node").count()) === landmarkCountBeforeSearch,
    "Search must preserve every landmark so the spatial map never collapses.",
  );
  assert(
    (await page.locator(".landmark-node.is-search-muted").count()) > 0,
    "Nonmatching landmarks must recede instead of disappearing.",
  );
  await page.screenshot({ path: path.join(screenshotsDir, "regression-search-context.png"), fullPage: true });
  await searchInput.press("Escape");
  assert((await searchTrigger.getAttribute("aria-expanded")) === "false", "Escape must collapse search.");
  await page.keyboard.press("Control+k");
  assert((await searchTrigger.getAttribute("aria-expanded")) === "true", "Ctrl+K must expand search.");
  await searchInput.press("Escape");

  phase("panel controls");
  /* The file pane is persistent; the note pane follows the active note. */
  const fileSidebar = page.locator("#file-sidebar");
  const fileWidthBefore = (await fileSidebar.boundingBox()).width;
  const fileResizer = page.getByRole("separator", { name: "Resize file sidebar" });
  const fileResizerBounds = await fileResizer.boundingBox();
  assert(fileResizerBounds, "File sidebar resizer must be measurable.");
  await page.mouse.move(fileResizerBounds.x + fileResizerBounds.width / 2, fileResizerBounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(fileResizerBounds.x + 64, fileResizerBounds.y + 200, { steps: 8 });
  await page.mouse.up();
  const fileWidthAfter = (await fileSidebar.boundingBox()).width;
  assert(fileWidthAfter >= fileWidthBefore + 55, "Dragging the file divider must resize the sidebar in sync with the pointer.");

  await selectedFileRow.click();
  const noteSidebar = page.locator("#note-sidebar");
  await page.waitForFunction(() => document.querySelector("#note-sidebar")?.hasAttribute("hidden") === false);
  await page.screenshot({ path: path.join(screenshotsDir, "regression-selection-driven-sidebar.png"), fullPage: true });
  const noteWidthBefore = (await noteSidebar.boundingBox()).width;
  const noteResizer = page.getByRole("separator", { name: "Resize note sidebar" });
  const noteResizerBounds = await noteResizer.boundingBox();
  assert(noteResizerBounds, "Note sidebar resizer must be measurable.");
  await page.mouse.move(noteResizerBounds.x + noteResizerBounds.width / 2, noteResizerBounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(noteResizerBounds.x - 72, noteResizerBounds.y + 200, { steps: 8 });
  await page.mouse.up();
  const noteWidthAfter = (await noteSidebar.boundingBox()).width;
  assert(noteWidthAfter >= noteWidthBefore + 60, "Dragging the note divider must resize the sidebar in sync with the pointer.");

  const canvasWidthBefore = (await page.locator(".atlas-workspace").boundingBox()).width;
  await page.getByRole("button", { name: "Hide file sidebar" }).click();
  await page.getByRole("button", { name: "Close note sidebar" }).click();
  const showFile = page.getByRole("button", { name: "Show file sidebar" });
  await showFile.waitFor();
  await page.waitForFunction(() => document.querySelector("#note-sidebar")?.hasAttribute("hidden") === true);
  assert((await page.getByRole("button", { name: "Show note sidebar" }).count()) === 0, "A cleared note must not leave a dead sidebar restore handle.");
  const canvasWidthExpanded = (await page.locator(".atlas-workspace").boundingBox()).width;
  assert(canvasWidthExpanded >= canvasWidthBefore + 700, "Hiding both panes must give almost the full window to the canvas.");
  assert((await showFile.boundingBox()).width <= 22, "The file sidebar restore handle must remain tiny.");
  await page.screenshot({ path: path.join(screenshotsDir, "regression-canvas-only.png"), fullPage: true });
  await showFile.click();
  await selectedFileRow.click();
  await page.waitForFunction(() => document.querySelector("#note-sidebar")?.hasAttribute("hidden") === false);

  phase("canvas creation and hierarchy");
  /* Edge-aware, organized canvas creation palette. */
  const edgePoint = await visiblePanePoint(page, "right", "bottom");
  await page.mouse.click(edgePoint.x, edgePoint.y, { button: "right" });
  const edgeMenu = page.getByRole("dialog", { name: "Create map object" });
  await edgeMenu.waitFor();
  const edgeMenuBounds = await edgeMenu.boundingBox();
  assert(edgeMenuBounds.x >= 8 && edgeMenuBounds.y >= 8 && edgeMenuBounds.x + edgeMenuBounds.width <= 1432 && edgeMenuBounds.y + edgeMenuBounds.height <= 892, "Context palettes must stay inside the viewport.");
  assert((await edgeMenu.getAttribute("data-horizontal")) === "before" || (await edgeMenu.getAttribute("data-vertical")) === "before", "A palette near a viewport edge must flip around the click.");
  await page.keyboard.press("Escape");

  const createPoint = await blankPointInsideVisibleGroup(page, "subject");
  await page.mouse.click(createPoint.x, createPoint.y, { button: "right" });
  const createMenu = page.getByRole("dialog", { name: "Create map object" });
  await createMenu.waitFor();
  const createBounds = await createMenu.boundingBox();
  assert(Math.abs(createBounds.x - (createPoint.x + 6)) <= 2 || Math.abs(createBounds.x + createBounds.width + 6 - createPoint.x) <= 2, "Canvas tools must open beside the click.");
  assert((await createMenu.locator("select").count()) === 0, "Creation tools must not use dropdowns.");
  for (const kind of ["Subject", "Group", "Subgroup", "Definition", "Theorem", "Proposition", "Lemma", "Corollary", "Method", "Example"]) {
    assert((await createMenu.getByRole("button", { name: kind, exact: true }).count()) === 1, `Canvas menu must offer ${kind}.`);
  }
  const createSections = createMenu.locator(".map-create-menu__section");
  assert((await createSections.count()) === 3, "Creation must separate structure, informal notes, and mathematics.");
  const informalCreation = createMenu.getByRole("region", { name: "Informal notes" });
  const mathematicalCreation = createMenu.getByRole("region", { name: "Mathematical objects" });
  const informalCreationButton = informalCreation.getByRole("button", { name: "Create informal note" });
  assert((await informalCreationButton.count()) === 1, "Note must be a standalone informal-paper action.");
  assert((await informalCreationButton.locator(".map-paper-note-glyph").count()) === 1, "Note creation must use the folded-paper glyph.");
  assert((await mathematicalCreation.getByText("Note", { exact: true }).count()) === 0, "Note must not be mixed into mathematical statement types.");
  await page.screenshot({ path: path.join(screenshotsDir, "regression-sticky-note-menu.png"), fullPage: true });
  const groupCreationStyles = await createMenu.locator(".map-create-menu__groups button").evaluateAll((buttons) => Object.fromEntries(buttons.map((button) => [
    button.getAttribute("data-group-level"),
    {
      borderStyle: getComputedStyle(button).borderStyle,
      boxShadow: getComputedStyle(button).boxShadow,
    },
  ])));
  assert(groupCreationStyles.subject?.boxShadow !== "none", "Subject creation must have a distinct territory treatment.");
  assert(groupCreationStyles.group?.borderStyle === "solid", "Group creation must use the standard solid frame treatment.");
  assert(groupCreationStyles.subgroup?.borderStyle === "dashed", "Subgroup creation must read as subordinate without extra prose.");
  assert(!(await createMenu.innerText()).includes("Mathematical type"), "The creation palette must not narrate self-evident controls.");
  const groupCountBeforeCreation = (await mapState(page))?.customGroups?.length ?? 0;
  await createMenu.getByRole("button", { name: "Group", exact: true }).click();
  const groupNamingMenu = page.getByRole("dialog", { name: "Name Group" });
  await groupNamingMenu.waitFor();
  const groupCreationName = groupNamingMenu.getByRole("textbox", { name: "Group name" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Group name");
  const initialGroupName = await groupCreationName.evaluate((input) => ({
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  }));
  assert(initialGroupName.value === "Untitled group", "Group creation must begin with one useful default name.");
  assert(initialGroupName.selectionStart === 0 && initialGroupName.selectionEnd === initialGroupName.value.length, "The default group name must be selected for immediate replacement.");
  assert(((await mapState(page))?.customGroups?.length ?? 0) === groupCountBeforeCreation, "Choosing Group must not persist an unnamed object before confirmation.");
  const createdGroupTitle = "Verification group";
  await groupCreationName.fill(createdGroupTitle);
  await groupCreationName.press("Enter");
  await page.waitForFunction((before) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    return state?.customGroups?.length === before + 1;
  }, groupCountBeforeCreation);
  const createdState = await mapState(page);
  const created = createdState.customGroups.find((group) => group.title === createdGroupTitle);
  assert(created, "The confirmed group must be present in the disposable atlas.");
  assert(created.title === createdGroupTitle && created.level === "group", "The confirmed name and Group level must persist together.");
  assert(created.color === "#92989F", `New groups must start neutral grey (received ${created.color}).`);
  assert(created.parentId === "qa-ui-subject" || created.parentId?.startsWith("subject-zone:"), "A new Group must attach to its containing Subject territory.");
  assert(created.x % 28 === 0 && created.y % 28 === 0 && created.width % 28 === 0 && created.height % 28 === 0, "Created group geometry must snap to grid dots.");
  const groupNode = page.getByTestId(`group-${created.id}`);
  const groupTitle = page.locator(`[data-region-title="${created.id}"]`);
  await groupNode.waitFor();
  await groupTitle.waitFor();
  const initialLevelVisuals = await page.evaluate((id) => {
    const createdNode = document.querySelector(`[data-testid="group-${id}"]`);
    const createdTitle = document.querySelector(`[data-region-title="${id}"]`);
    const subjectNode = document.querySelector('.region-frame[data-group-level="subject"]');
    const subjectId = subjectNode?.getAttribute("data-testid")?.replace(/^group-/, "");
    const subjectTitle = subjectId ? document.querySelector(`[data-region-title="${subjectId}"]`) : undefined;
    const createdLabel = createdTitle?.querySelector(".region-frame__title-text");
    const subjectLabel = subjectTitle?.querySelector(".region-frame__title-text");
    const subjectIcon = subjectTitle?.querySelector(".region-frame__subject-icon");
    const viewport = document.querySelector(".react-flow__viewport");
    const zoom = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a : undefined;
    return {
      createdLevel: createdNode?.getAttribute("data-group-level"),
      createdClass: createdNode?.className,
      createdTitleClass: createdTitle?.closest(".region-title-toolbar")?.className,
      createdTitleFontSize: createdLabel ? getComputedStyle(createdLabel).fontSize : undefined,
      createdTitleHeight: createdTitle?.getBoundingClientRect().height,
      subjectLevel: subjectNode?.getAttribute("data-group-level"),
      subjectClass: subjectNode?.className,
      subjectHasField: Boolean(subjectNode?.querySelector(".region-frame__subject-field")),
      subjectDecorationCount: subjectNode?.querySelectorAll(".region-frame__subject-frame, .region-frame__subject-texture, linearGradient, pattern").length,
      subjectTitleClass: subjectTitle?.closest(".region-title-toolbar")?.className,
      subjectTitleTreatment: subjectTitle?.getAttribute("data-title-treatment"),
      subjectTitleMinHeight: subjectTitle ? Number.parseFloat(getComputedStyle(subjectTitle).minHeight) : 0,
      subjectTitleFontSize: subjectLabel ? getComputedStyle(subjectLabel).fontSize : undefined,
      subjectTitleHeight: subjectTitle?.getBoundingClientRect().height,
      subjectIcon: subjectIcon?.getAttribute("data-subject-icon"),
      subjectFrameStyle: subjectNode?.getAttribute("data-subject-frame-style"),
      subjectIconWidth: subjectIcon ? Number.parseFloat(getComputedStyle(subjectIcon).width) : 0,
      subjectIconHeight: subjectIcon ? Number.parseFloat(getComputedStyle(subjectIcon).height) : 0,
      subjectIconSvg: Boolean(subjectIcon?.querySelector("svg")),
      zoom,
    };
  }, created.id);
  assert(initialLevelVisuals.createdLevel === "group" && initialLevelVisuals.createdClass?.includes("region-frame--level-group"), "A created Group must expose its hierarchy level in stable DOM attributes and classes.");
  assert(initialLevelVisuals.createdTitleClass?.includes("region-title-toolbar--group"), "Group titles must receive the middle-tier title treatment.");
  assert(initialLevelVisuals.subjectLevel === "subject" && initialLevelVisuals.subjectClass?.includes("region-frame--level-subject"), "Subject territories must expose the top hierarchy level.");
  assert(initialLevelVisuals.subjectHasField && initialLevelVisuals.subjectDecorationCount === 0 && initialLevelVisuals.subjectTitleClass?.includes("region-title-toolbar--subject"), "Subjects must combine their neutral field with the dedicated icon title treatment and no perimeter decoration.");
  assert(
    initialLevelVisuals.createdTitleFontSize === "28px" &&
      initialLevelVisuals.subjectTitleFontSize === "42px" &&
      initialLevelVisuals.createdTitleHeight / initialLevelVisuals.zoom >= 40 &&
      initialLevelVisuals.subjectTitleHeight / initialLevelVisuals.zoom >= 78 &&
      initialLevelVisuals.subjectTitleMinHeight >= 78 &&
      initialLevelVisuals.subjectTitleHeight >= initialLevelVisuals.createdTitleHeight,
    `Every hierarchy tier must preserve its authored, group-scaled title metric (${JSON.stringify(initialLevelVisuals)}).`,
  );
  assert(
    initialLevelVisuals.subjectTitleTreatment === "subject" &&
      initialLevelVisuals.subjectIcon === initialLevelVisuals.subjectFrameStyle &&
      initialLevelVisuals.subjectIconWidth === 54 &&
      initialLevelVisuals.subjectIconHeight === 54 &&
      initialLevelVisuals.subjectIconSvg,
    `Subject title cards must expose the matching 54px Lucide icon well (${JSON.stringify(initialLevelVisuals)}).`,
  );

  phase("group interaction");
  /* The label itself is the group move handle. */
  await page.getByRole("button", { name: "Hide file sidebar" }).click();
  await showFile.waitFor();
  const groupPositionBeforeTitleDrag = { x: created.x, y: created.y };
  // The new frame can be larger than the currently visible part of its Subject.
  // Focus it first so the title drag exercises a real, unobscured pointer path.
  await groupTitle.evaluate((title) => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await page.waitForTimeout(250);
  const titleDragStart = await groupTitle.boundingBox();
  assert(titleDragStart, "The new Group title must remain visible after focusing its frame.");
  const titleHit = await page.evaluate(({ id, bounds }) => {
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return {
      ownsCenter: target?.closest?.(`[data-region-title="${id}"]`)?.getAttribute("data-region-title") === id,
      targetTag: target?.tagName,
      targetClass: typeof target?.className === "string" ? target.className : target?.className?.baseVal,
      targetText: target?.textContent?.trim().slice(0, 80),
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    };
  }, { id: created.id, bounds: titleDragStart });
  assert(titleHit.ownsCenter, `The visible Group name must own its pointer hit area above surrounding territories (hit ${JSON.stringify(titleHit)}).`);
  await page.mouse.move(titleDragStart.x + titleDragStart.width / 2, titleDragStart.y + titleDragStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleDragStart.x + titleDragStart.width / 2 + 56, titleDragStart.y + titleDragStart.height / 2 - 28, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ id, x, y }) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    const group = state?.customGroups?.find((candidate) => candidate.id === id);
    return group && (group.x !== x || group.y !== y) && group.x % 28 === 0 && group.y % 28 === 0;
  }, { id: created.id, ...groupPositionBeforeTitleDrag });

  /* Group names behave as part of the group instead of growing against it. */
  const titleAtNormalZoom = await groupTitle.boundingBox();
  const groupAtNormalZoom = await groupNode.boundingBox();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(180);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(180);
  const titleAtLowerZoom = await groupTitle.boundingBox();
  const groupAtLowerZoom = await groupNode.boundingBox();
  assert(groupAtLowerZoom.width < groupAtNormalZoom.width * .9, "The group itself must still respond to zoom.");
  const buttonZoomScale = groupAtLowerZoom.width / groupAtNormalZoom.width;
  assert(titleAtLowerZoom.width < titleAtNormalZoom.width * .9 && titleAtLowerZoom.height < titleAtNormalZoom.height * .9, "A Group title must shrink with its frame when zooming out.");
  assert(
    nearlyEqual(titleAtLowerZoom.width / titleAtNormalZoom.width, buttonZoomScale, .02) &&
      nearlyEqual(titleAtLowerZoom.height / titleAtNormalZoom.height, buttonZoomScale, .02) &&
      nearlyEqual(titleAtLowerZoom.width / groupAtLowerZoom.width, titleAtNormalZoom.width / groupAtNormalZoom.width, .002) &&
      nearlyEqual(titleAtLowerZoom.height / groupAtLowerZoom.height, titleAtNormalZoom.height / groupAtNormalZoom.height, .002),
    "A Group title must preserve its width and height ratios to the Group through button zoom.",
  );
  await page.screenshot({ path: path.join(screenshotsDir, "regression-group-title-scaled-out.png"), fullPage: true });
  await groupTitle.dblclick();
  await page.waitForTimeout(250);

  const wheelTitleBefore = await groupTitle.evaluate((title) => {
    const label = title.querySelector(".region-frame__title-text");
    const bounds = label?.getBoundingClientRect();
    const id = title.getAttribute("data-region-title");
    const groupBounds = document.querySelector(`[data-testid="group-${id}"]`)?.getBoundingClientRect();
    const viewport = document.querySelector(".react-flow__viewport");
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : undefined;
    return {
      width: bounds?.width,
      height: bounds?.height,
      fontSize: label ? getComputedStyle(label).fontSize : undefined,
      groupWidth: groupBounds?.width,
      groupHeight: groupBounds?.height,
      zoom: matrix?.a,
    };
  });
  const wheelAnchor = await groupNode.boundingBox();
  await page.mouse.move(
    wheelAnchor.x + wheelAnchor.width / 2,
    wheelAnchor.y + wheelAnchor.height / 2,
  );
  await page.mouse.wheel(0, 720);
  await page.waitForFunction((zoom) => {
    const viewport = document.querySelector(".react-flow__viewport");
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : undefined;
    return matrix && matrix.a < zoom * .9;
  }, wheelTitleBefore.zoom);
  const wheelTitleAfter = await groupTitle.evaluate((title) => {
    const label = title.querySelector(".region-frame__title-text");
    const bounds = label?.getBoundingClientRect();
    const id = title.getAttribute("data-region-title");
    const groupBounds = document.querySelector(`[data-testid="group-${id}"]`)?.getBoundingClientRect();
    const viewport = document.querySelector(".react-flow__viewport");
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : undefined;
    return {
      width: bounds?.width,
      height: bounds?.height,
      fontSize: label ? getComputedStyle(label).fontSize : undefined,
      groupWidth: groupBounds?.width,
      groupHeight: groupBounds?.height,
      zoom: matrix?.a,
    };
  });
  const wheelZoomScale = wheelTitleAfter.zoom / wheelTitleBefore.zoom;
  assert(wheelTitleBefore.fontSize === wheelTitleAfter.fontSize, "Canvas transforms must not rewrite the Group title's authored font size.");
  assert(
    wheelTitleAfter.width < wheelTitleBefore.width && wheelTitleAfter.height < wheelTitleBefore.height &&
      nearlyEqual(wheelTitleAfter.width / wheelTitleBefore.width, wheelZoomScale, .025) &&
      nearlyEqual(wheelTitleAfter.height / wheelTitleBefore.height, wheelZoomScale, .025) &&
      nearlyEqual(wheelTitleAfter.groupWidth / wheelTitleBefore.groupWidth, wheelZoomScale, .025) &&
      nearlyEqual(wheelTitleAfter.width / wheelTitleAfter.groupWidth, wheelTitleBefore.width / wheelTitleBefore.groupWidth, .002) &&
      nearlyEqual(wheelTitleAfter.height / wheelTitleAfter.groupHeight, wheelTitleBefore.height / wheelTitleBefore.groupHeight, .002),
    `Wheel zoom must scale the Group title with its frame (${JSON.stringify({ before: wheelTitleBefore, after: wheelTitleAfter })}).`,
  );
  const wheelTitleBounds = await groupTitle.boundingBox();
  const wheelTitleOwnsCenter = await page.evaluate(({ id, bounds }) => {
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return target?.closest?.(`[data-region-title="${id}"]`)?.getAttribute("data-region-title") === id;
  }, { id: created.id, bounds: wheelTitleBounds });
  assert(wheelTitleOwnsCenter, "The visibly scaled Group title must retain its exact pointer hit area after wheel zoom.");
  await groupTitle.dblclick({ force: true });
  await page.waitForTimeout(250);

  phase("group hierarchy and appearance tools");
  /* Shape-aware group tools, title anchors, saturated color studio, and RGB. */
  await groupTitle.click({ button: "right" });
  const groupMenu = page.getByRole("dialog", { name: `Edit ${createdGroupTitle}` });
  await groupMenu.waitFor();
  assert((await groupMenu.getByRole("tab").count()) === 5, "Group tools must be organized into Level, Shape, Title, Frame, and Colour tabs.");
  assert((await groupMenu.locator(".map-tool-panel").count()) === 1, "Only one group-tool panel should be presented at a time.");
  assert((await groupMenu.locator("select").count()) === 0, "Group tools must use direct icon controls.");
  assert(await groupMenu.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1), "Group tools must not overflow their palette.");
  await clickTab(groupMenu, "Level");
  const levelPicker = groupMenu.getByLabel("Canvas group level", { exact: true });
  for (const level of ["Subject", "Group", "Subgroup"]) {
    assert((await levelPicker.getByRole("button", { name: level, exact: true }).count()) === 1, `Level tools must offer ${level}.`);
  }
  assert((await levelPicker.getByRole("button", { name: "Group", exact: true }).getAttribute("aria-pressed")) === "true", "A newly created Group must open with Group selected in Level tools.");
  const levelPickerStyles = await levelPicker.locator("button").evaluateAll((buttons) => Object.fromEntries(buttons.map((button) => [
    button.getAttribute("data-group-level"),
    {
      borderStyle: getComputedStyle(button).borderStyle,
      boxShadow: getComputedStyle(button).boxShadow,
    },
  ])));
  assert(levelPickerStyles.subject?.boxShadow !== "none" && levelPickerStyles.subgroup?.borderStyle === "dashed", "Level controls must visually distinguish Subject and Subgroup without verbose labels.");

  await levelPicker.getByRole("button", { name: "Subject", exact: true }).click();
  await waitForLiveGroupLevel(page, created.id, "subject");
  const subjectLevelState = {
    dom: await groupNode.getAttribute("data-group-level"),
    persisted: (await mapState(page)).customGroups.find(({ id }) => id === created.id)?.level,
    pressed: await levelPicker.getByRole("button", { name: "Subject", exact: true }).getAttribute("aria-pressed"),
  };
  assert(subjectLevelState.persisted === "subject" && subjectLevelState.pressed === "true", `Choosing Subject must synchronize the live frame, picker, and persistence (${JSON.stringify(subjectLevelState)}).`);
  assert((await groupMenu.getByRole("tab", { name: "Colour", exact: true }).count()) === 0, "Subjects must not advertise a colour control for their neutral frame.");
  const subjectTreatment = await groupNode.evaluate((node) => {
    const title = document.querySelector(`[data-region-title="${node.getAttribute("data-testid")?.replace(/^group-/, "")}"]`);
    const shape = node.querySelector(".region-frame__shape");
    const titleMark = title?.querySelector(".region-frame__title-mark");
    const titleLabel = title?.querySelector(".region-frame__title-text");
    const subjectIcon = title?.querySelector(".region-frame__subject-icon");
    return {
      className: node.className,
      field: Boolean(node.querySelector(".region-frame__subject-field")),
      frameStyle: node.getAttribute("data-subject-frame-style"),
      decorationCount: node.querySelectorAll(".region-frame__subject-frame, .region-frame__subject-texture, linearGradient, pattern").length,
      subgroupField: Boolean(node.querySelector(".region-frame__subgroup-field")),
      titleClass: title?.closest(".region-title-toolbar")?.className,
      titleTreatment: title?.getAttribute("data-title-treatment"),
      titleMinHeight: title ? Number.parseFloat(getComputedStyle(title).minHeight) : 0,
      shapeFill: shape ? getComputedStyle(shape).fill : undefined,
      shapeFillOpacity: shape ? Number.parseFloat(getComputedStyle(shape).fillOpacity) : 1,
      shapeStroke: shape ? getComputedStyle(shape).stroke : undefined,
      shapeStrokeOpacity: shape ? Number.parseFloat(getComputedStyle(shape).strokeOpacity) : 0,
      shapeStrokeWidth: shape ? Number.parseFloat(getComputedStyle(shape).strokeWidth) : 0,
      titleLetterSpacing: titleLabel ? getComputedStyle(titleLabel).letterSpacing : undefined,
      titleTransform: titleLabel ? getComputedStyle(titleLabel).textTransform : undefined,
      titleHasMark: Boolean(titleMark),
      subjectIcon: subjectIcon?.getAttribute("data-subject-icon"),
      subjectIconWidth: subjectIcon ? Number.parseFloat(getComputedStyle(subjectIcon).width) : 0,
      subjectIconHeight: subjectIcon ? Number.parseFloat(getComputedStyle(subjectIcon).height) : 0,
      subjectIconSvg: Boolean(subjectIcon?.querySelector("svg")),
    };
  });
  assert(subjectTreatment.className.includes("region-frame--level-subject") && subjectTreatment.field && subjectTreatment.decorationCount === 0 && !subjectTreatment.subgroupField, "Subject level must render one neutral cloud with no decorative frame resources.");
  assert(subjectTreatment.shapeFill === "none" && subjectTreatment.shapeFillOpacity === 0 && subjectTreatment.shapeStroke === "rgb(77, 85, 94)", "Subject level must remain neutral and unfilled after conversion.");
  assert(
    subjectTreatment.frameStyle === "double-rule" &&
      subjectTreatment.shapeStrokeOpacity >= .5 &&
      subjectTreatment.shapeStrokeWidth >= 1.5,
    `Subject cloud stroke must stay visible, regular, and neutral (${JSON.stringify(subjectTreatment)}).`,
  );
  assert(
    subjectTreatment.titleClass?.includes("region-title-toolbar--subject") &&
      subjectTreatment.titleTreatment === "subject" &&
      subjectTreatment.titleMinHeight >= 78 &&
      subjectTreatment.titleTransform === "none" &&
      !subjectTreatment.titleHasMark &&
      subjectTreatment.subjectIcon === subjectTreatment.frameStyle &&
      subjectTreatment.subjectIconWidth === 54 &&
      subjectTreatment.subjectIconHeight === 54 &&
      subjectTreatment.subjectIconSvg,
    `Subject level must use a substantial icon title card (${JSON.stringify(subjectTreatment)}).`,
  );

  await levelPicker.getByRole("button", { name: "Subgroup", exact: true }).click();
  await waitForLiveGroupLevel(page, created.id, "subgroup");
  const subgroupTreatment = await groupNode.evaluate((node) => {
    const title = document.querySelector(`[data-region-title="${node.getAttribute("data-testid")?.replace(/^group-/, "")}"]`);
    const titleLabel = title?.querySelector(".region-frame__title-text");
    return {
      className: node.className,
      subjectField: Boolean(node.querySelector(".region-frame__subject-field")),
      subjectFrame: Boolean(node.querySelector(".region-frame__subject-frame")),
      subgroupField: Boolean(node.querySelector(".region-frame__subgroup-field")),
      titleClass: title?.closest(".region-title-toolbar")?.className,
      titleColor: titleLabel ? getComputedStyle(titleLabel).color : undefined,
      titleFontSize: titleLabel ? getComputedStyle(titleLabel).fontSize : undefined,
      titleHeight: title?.getBoundingClientRect().height,
      zoom: (() => {
        const viewport = document.querySelector(".react-flow__viewport");
        return viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a : undefined;
      })(),
      shapeStrokeWidth: Number.parseFloat(getComputedStyle(node.querySelector(".region-frame__shape")).strokeWidth),
    };
  });
  assert(subgroupTreatment.className.includes("region-frame--level-subgroup") && subgroupTreatment.subgroupField && !subgroupTreatment.subjectField && !subgroupTreatment.subjectFrame, "Subgroup level must render its dedicated subordinate field without retaining the Subject frame architecture.");
  assert(subgroupTreatment.titleClass?.includes("region-title-toolbar--subgroup") && subgroupTreatment.shapeStrokeWidth <= 1.2, "Subgroup level must use its own precise title and frame treatment.");
  assert(subgroupTreatment.titleFontSize === "28px" && subgroupTreatment.titleHeight / subgroupTreatment.zoom >= 40, "Subgroup titles must preserve the same larger group-scaled metric as Subject and Group titles.");
  await page.screenshot({ path: path.join(screenshotsDir, "regression-group-hierarchy.png"), fullPage: true });

  await levelPicker.getByRole("button", { name: "Group", exact: true }).click();
  await waitForLiveGroupLevel(page, created.id, "group");
  assert((await mapState(page)).customGroups.find(({ id }) => id === created.id)?.level === "group", "Level changes must persist and restore the Group tier.");
  await clickTab(groupMenu, "Shape");
  const cloudRectangle = groupMenu.getByRole("button", { name: "Cloud rectangle", exact: true });
  await cloudRectangle.waitFor({ timeout: 5_000 });
  assert((await cloudRectangle.count()) === 1, "Group shapes must offer the cloudlike rounded rectangle.");
  await cloudRectangle.click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="group-${id}"]`)?.getAttribute("data-group-shape") === "rounded-rectangle", created.id);
  await page.screenshot({ path: path.join(screenshotsDir, "regression-cloud-rectangle.png"), fullPage: true });
  await groupMenu.getByRole("button", { name: "Triangle", exact: true }).click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="group-${id}"]`)?.getAttribute("data-group-shape") === "triangle", created.id);
  await clickTab(groupMenu, "Title");
  const titleSize = groupMenu.getByRole("slider", { name: "Group title size", exact: true });
  assert((await titleSize.inputValue()) === "28", "New groups must begin with the larger 28px title size.");
  assert((await groupMenu.getByLabel("Group title size presets", { exact: true }).getByRole("button").count()) === 4, "Title tools must expose four direct visual size choices.");
  await titleSize.fill("37");
  await titleSize.press("ArrowRight");
  await page.waitForFunction((id) => {
    const title = document.querySelector(`[data-region-title="${id}"] .region-frame__title-text`);
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    const group = state?.customGroups?.find((candidate) => candidate.id === id);
    return title && getComputedStyle(title).fontSize === "38px" && group?.titleFontSize === 38;
  }, created.id);
  assert((await titleSize.getAttribute("aria-valuetext")) === "38 pixels", "The exact title size must remain accessible while adjusting it.");
  await groupMenu.getByRole("button", { name: "Place label top-left", exact: true }).click();
  await page.waitForFunction((id) => document.querySelector(`[data-region-title="${id}"]`)?.getAttribute("data-title-anchor") === "0.25,0.5", created.id);
  const triangleTitleGeometry = await groupTitle.evaluate((title) => {
    const toolbar = title.closest(".region-title-toolbar");
    const node = document.querySelector(`[data-testid="group-${title.getAttribute("data-region-title")}"]`);
    const nodeBounds = node?.getBoundingClientRect();
    const toolbarBounds = toolbar?.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(title).transform);
    const attachmentMatrix = new DOMMatrixReadOnly(getComputedStyle(toolbar).transform);
    return {
      anchor: title.getAttribute("data-title-anchor"),
      contourAngle: Number(title.getAttribute("data-title-contour-angle")),
      horizontal: Math.abs(matrix.b) < .001 && Math.abs(matrix.c) < .001,
      localLeft: toolbar?.style.left,
      localTop: toolbar?.style.top,
      attachmentTransform: toolbar?.style.transform,
      attachmentAxisAligned: Math.abs(attachmentMatrix.b) < .001 && Math.abs(attachmentMatrix.c) < .001,
      attachmentOffsetX: attachmentMatrix.e,
      attachmentOffsetY: attachmentMatrix.f,
      screenLeft: toolbarBounds?.left,
      screenTop: toolbarBounds?.top,
      groupLeft: nodeBounds?.left,
      groupTop: nodeBounds?.top,
      groupWidth: nodeBounds?.width,
      groupHeight: nodeBounds?.height,
    };
  });
  assert(triangleTitleGeometry.anchor === "0.25,0.5" && triangleTitleGeometry.contourAngle < 0 && triangleTitleGeometry.horizontal, "A triangle title must attach to the exact sloping edge while its typography remains horizontal.");
  assert(
    triangleTitleGeometry.localLeft === "25%" &&
      triangleTitleGeometry.localTop === "50%" &&
      triangleTitleGeometry.attachmentAxisAligned &&
      nearlyEqual(triangleTitleGeometry.attachmentOffsetX, 0, .01) &&
      nearlyEqual(triangleTitleGeometry.attachmentOffsetY, 0, .01) &&
      nearlyEqual(triangleTitleGeometry.screenLeft, triangleTitleGeometry.groupLeft + triangleTitleGeometry.groupWidth * .25, 1.5) &&
      nearlyEqual(triangleTitleGeometry.screenTop, triangleTitleGeometry.groupTop + triangleTitleGeometry.groupHeight * .5, 1.5),
    `The title toolbar must use the local 25%/50% triangle contour anchor and land on that exact screen-space point: ${JSON.stringify(triangleTitleGeometry)}.`,
  );
  await page.screenshot({ path: path.join(screenshotsDir, "regression-group-title-size.png"), fullPage: true });
  await groupMenu.getByRole("button", { name: "Place label bottom-right", exact: true }).click();
  const longGroupName = "Nonlinear decision geometry and asymptotic structure";
  await clickTab(groupMenu, "Colour");

  const chips = groupMenu.locator(".map-color-chip");
  await chips.first().waitFor({ timeout: 5_000 });
  assert((await chips.count()) === 9, "The color studio must contain neutral grey, seven rainbow swatches, and one custom RGB swatch.");
  const chipMetrics = await chips.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, color: getComputedStyle(element).backgroundColor };
  }));
  assert(chipMetrics.every(({ width, height }) => nearlyEqual(width, height, .5)), "Every color swatch, including custom RGB, must be square.");
  assert(chipMetrics.every(({ y }) => nearlyEqual(y, chipMetrics[0].y, .5)), "The rainbow palette must stay on one row.");
  assert(chipMetrics.slice(1, 8).every(({ color }) => colorRange(color) >= 75), "Rainbow palette colors must be saturated regular colors, not pastel approximations.");
  for (const label of ["Hex colour", "red channel", "green channel", "blue channel", "Pick any RGB colour"]) {
    assert((await groupMenu.getByLabel(label, { exact: true }).count()) === 1, `${label} control is missing from the RGB studio.`);
  }
  await groupMenu.getByLabel("red channel", { exact: true }).fill("18");
  await groupMenu.getByLabel("green channel", { exact: true }).fill("52");
  await groupMenu.getByLabel("blue channel", { exact: true }).fill("86");
  await groupMenu.getByLabel("blue channel", { exact: true }).press("Enter");
  assert((await groupMenu.getByLabel("Hex colour", { exact: true }).getAttribute("value")) === "123456", "RGB channels and hex must remain synchronized.");
  await groupMenu.getByRole("button", { name: "Copy colour", exact: true }).click();
  await page.screenshot({ path: path.join(screenshotsDir, "regression-rgb-palette.png"), fullPage: true });
  const groupName = groupMenu.getByRole("textbox", { name: "Group name" });
  await groupName.fill(longGroupName);
  await groupName.press("Enter");
  await page.keyboard.press("Escape");

  const styledState = await mapState(page);
  const styledGroup = styledState.customGroups.find(({ id }) => id === created.id);
  assert(styledGroup?.shape === "triangle" && styledGroup.titlePosition === "bottom-right" && styledGroup.titleFontSize === 38, "Group shape, title position, and title size changes must persist.");
  assert(styledGroup?.title === longGroupName && styledGroup.color === "#123456", "Group title and RGB color must persist exactly.");
  assert((await groupTitle.getAttribute("data-title-anchor")) === "1,1", "A triangle bottom-right title must use the shape-aware corner anchor.");
  const titleBounds = await groupTitle.boundingBox();
  const groupBounds = await groupNode.boundingBox();
  assert(titleBounds.x >= groupBounds.x - 1 && titleBounds.y >= groupBounds.y - 1 && titleBounds.x + titleBounds.width <= groupBounds.x + groupBounds.width + 1 && titleBounds.y + titleBounds.height <= groupBounds.y + groupBounds.height + 1, "A long group name must remain clipped inside the group bounds.");

  const groupPortExpectations = {
    top: { x: .5, y: 0 },
    right: { x: .75, y: .5 },
    bottom: { x: .5, y: 1 },
    left: { x: .25, y: .5 },
  };
  for (const [side, expected] of Object.entries(groupPortExpectations)) {
    const bounds = await groupNode.locator(`.atlas-port--${side}`).boundingBox();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    assert(
      nearlyEqual(center.x, groupBounds.x + groupBounds.width * expected.x, 2) &&
        nearlyEqual(center.y, groupBounds.y + groupBounds.height * expected.y, 2),
      `${side} group connection dot must sit on the triangle frame, not its rectangular bounding box.`,
    );
  }

  const perimeter = await groupNode.locator(".region-frame__surface").evaluate((surface) => {
    const visible = surface.querySelector(".region-frame__shape");
    const hit = surface.querySelector(".region-frame__hit-target");
    return {
      visiblePath: visible?.getAttribute("d"),
      hitPath: hit?.getAttribute("d"),
      hitWidth: hit ? Number.parseFloat(getComputedStyle(hit).strokeWidth) : 0,
      pointerEvents: hit ? getComputedStyle(hit).pointerEvents : undefined,
      vectorEffect: hit?.getAttribute("vector-effect"),
      groupOpacity: visible ? Number.parseFloat(getComputedStyle(visible).fillOpacity) : 1,
    };
  });
  assert(perimeter.visiblePath === perimeter.hitPath && perimeter.visiblePath?.includes("L100 100"), "Triangle hit testing must follow the visible triangular perimeter.");
  assert(perimeter.hitWidth >= 28 && perimeter.pointerEvents === "stroke" && perimeter.vectorEffect === "non-scaling-stroke", "Group borders need the intentional 28px screen-space perimeter-only hit target.");
  assert(perimeter.groupOpacity >= .33 && perimeter.groupOpacity <= .35, "Custom Groups must carry normal colour while the dot grid remains visible through the field.");

  const groupBeforeResize = { ...styledGroup };
  const diagonalPoint = await page.evaluate(({ bounds, id }) => {
    // Landmarks intentionally sit above Groups. Find an exposed sample on
    // either sloping edge instead of treating a landmark overlap as a failed
    // group hit target.
    // Stay below the apex zone: there the resize cursor intentionally becomes
    // vertical-only, while this assertion measures a horizontal size change.
    for (let step = 8; step <= 16; step += 1) {
      const yRatio = step / 18;
      for (const xRatio of [.5 - .5 * yRatio, .5 + .5 * yRatio]) {
        const point = {
          x: bounds.x + bounds.width * xRatio,
          y: bounds.y + bounds.height * yRatio,
        };
        const target = document.elementFromPoint(point.x, point.y);
        const className = target?.className?.baseVal ?? target?.className;
        const owner = target?.closest("[data-testid]")?.getAttribute("data-testid");
        if (
          String(className).includes("region-frame__hit-target") &&
          owner === `group-${id}`
        ) return point;
      }
    }
    return undefined;
  }, { bounds: groupBounds, id: created.id });
  assert(
    diagonalPoint,
    "At least one exposed point on the visibly sloped triangle border must be directly grabbable.",
  );
  await page.mouse.move(diagonalPoint.x, diagonalPoint.y);
  await page.mouse.down();
  await page.mouse.move(diagonalPoint.x + 58, diagonalPoint.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ id, width }) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    const group = state?.customGroups?.find((candidate) => candidate.id === id);
    return group && group.width !== width && group.width % 28 === 0;
  }, { id: created.id, width: groupBeforeResize.width });
  await page.screenshot({ path: path.join(screenshotsDir, "regression-shaped-group.png"), fullPage: true });

  phase("landmark tools");
  /* Landmark context palette and shape-following selection. */
  const visibleLandmarkId = await page.evaluate(() => {
    const workspace = document.querySelector(".atlas-workspace")?.getBoundingClientRect();
    if (!workspace) return undefined;
    return [...document.querySelectorAll(".landmark-node")].find((node) => {
      const bounds = node.getBoundingClientRect();
      return Boolean(node.querySelector(".landmark-node__content span")) && bounds.width > 40 && bounds.height > 20 && bounds.left >= workspace.left && bounds.right <= workspace.right && bounds.top >= workspace.top && bounds.bottom <= workspace.bottom;
    })?.getAttribute("data-testid")?.replace(/^landmark-/, "");
  });
  assert(visibleLandmarkId, "A visible landmark is required for object-tool verification.");
  const landmarkNode = page.getByTestId(`landmark-${visibleLandmarkId}`);
  const landmarkTitleVisual = await landmarkNode.evaluate((node) => {
    const title = node.querySelector(".landmark-node__content span");
    const content = title?.parentElement;
    const titleBounds = title?.getBoundingClientRect();
    const contentBounds = content?.getBoundingClientRect();
    return {
      shape: node.getAttribute("data-landmark-shape"),
      fontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      fits: Boolean(titleBounds && contentBounds &&
        titleBounds.width <= contentBounds.width + 1 &&
        titleBounds.height <= contentBounds.height + 1),
    };
  });
  const expectedLandmarkTitleSize = landmarkTitleVisual.shape === "triangle" ? 13 : landmarkTitleVisual.shape === "rhombus" ? 14 : 15;
  assert(landmarkTitleVisual.fontSize >= expectedLandmarkTitleSize && landmarkTitleVisual.fits, `Landmark names must use the larger fitted typography (${JSON.stringify(landmarkTitleVisual)}).`);
  await page.screenshot({ path: path.join(screenshotsDir, "regression-landmark-titles.png"), fullPage: true });
  await landmarkNode.click({ button: "right", force: true });
  const landmarkMenu = page.getByRole("dialog", { name: /^Edit / });
  await landmarkMenu.waitFor();
  assert((await landmarkMenu.getByRole("tab").count()) === 5, "Landmark tools must be organized into Kind, Shape, Content, Size, and Colour tabs.");
  assert(!(await landmarkMenu.innerText()).includes("Mathematical type"), "Landmark tools must not include redundant explanatory headings.");
  await clickTab(landmarkMenu, "Kind");
  const informalKind = landmarkMenu.getByRole("region", { name: "Informal note" });
  const mathematicalKinds = landmarkMenu.getByRole("region", { name: "Mathematical objects" });
  assert((await informalKind.getByRole("button", { name: "Note", exact: true }).count()) === 1, "Changing kind must preserve Note as a separate informal category.");
  assert((await informalKind.locator(".map-paper-note-glyph").count()) === 1, "The kind picker must retain the folded-paper Note glyph.");
  assert((await mathematicalKinds.getByText("Note", { exact: true }).count()) === 0, "The kind picker must keep Note out of formal mathematics.");
  await page.waitForFunction(() => {
    const menu = document.querySelector('[role="dialog"][aria-label^="Edit "]');
    const bounds = menu?.getBoundingClientRect();
    return Boolean(bounds && bounds.left >= 8 && bounds.top >= 8 && bounds.right <= innerWidth - 8 && bounds.bottom <= innerHeight - 8);
  });
  await page.screenshot({ path: path.join(screenshotsDir, "regression-sticky-note-kind-menu.png"), fullPage: true });
  await clickTab(landmarkMenu, "Shape");
  await landmarkMenu.getByRole("button", { name: "Oval", exact: true }).click();
  await clickTab(landmarkMenu, "Content");
  const formulaMode = landmarkMenu.getByRole("button", { name: "Formula", exact: true });
  await formulaMode.waitFor({ timeout: 5_000 });
  await formulaMode.click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid="landmark-${id}"]`)?.getAttribute("data-content-mode") === "formula", visibleLandmarkId);
  await landmarkNode.locator(".landmark-node__preview .markdown-view").waitFor({ timeout: 15_000 });
  assert((await landmarkNode.locator(".landmark-node__preview .katex").count()) > 0, "Formula mode must show compiled mathematics inside the landmark.");
  await clickTab(landmarkMenu, "Size");
  const wideSize = landmarkMenu.getByRole("button", { name: "Wide", exact: true });
  await wideSize.waitFor({ timeout: 5_000 });
  await wideSize.click();
  await page.waitForFunction((id) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    const item = state?.customLandmarks?.find((candidate) => candidate.id === id) ?? state?.landmarks?.[id];
    return item?.width === 420 && item?.height === 168 && item?.contentMode === "formula";
  }, visibleLandmarkId);
  await clickTab(landmarkMenu, "Colour");
  await landmarkMenu.locator(".map-color-chip").first().waitFor({ timeout: 5_000 });
  const pasteColour = landmarkMenu.getByRole("button", { name: "Paste copied colour", exact: true });
  assert(await pasteColour.isEnabled(), "Copied colors must be available across map objects.");
  await pasteColour.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction((id) => document.querySelector(`[data-testid="landmark-${id}"]`)?.getAttribute("data-landmark-shape") === "oval", visibleLandmarkId);
  await page.screenshot({ path: path.join(screenshotsDir, "regression-landmark-preview.png"), fullPage: true });
  const landmarkState = await mapState(page);
  const styledLandmark = landmarkState.customLandmarks.find(({ id }) => id === visibleLandmarkId) ?? landmarkState.landmarks[visibleLandmarkId];
  assert(styledLandmark?.color === "#123456", "Pasted RGB color must persist on the target landmark.");
  await landmarkNode.click();
  const landmarkSelection = await landmarkNode.evaluate((node) => ({
    selected: node.classList.contains("is-selected"),
    shape: node.querySelector(".landmark-node__shape")?.getAttribute("d"),
    ring: node.querySelector(".landmark-node__selection-ring")?.getAttribute("d"),
  }));
  assert(landmarkSelection.selected && landmarkSelection.shape === landmarkSelection.ring, "Landmark selection must be immediate, obvious, and shape-following.");

  /* The generous shape perimeter resizes landmarks directly, then persists on-grid geometry. */
  const beforeResizeState = await mapState(page);
  const landmarkBeforeResize = beforeResizeState.customLandmarks.find(({ id }) => id === visibleLandmarkId) ?? beforeResizeState.landmarks[visibleLandmarkId];
  const landmarkResizeBounds = await landmarkNode.boundingBox();
  const landmarkResizePoint = {
    // Selecting the note reveals the inspector, so exercise the still-visible
    // upper-left contour rather than a right edge that can sit beneath it.
    x: landmarkResizeBounds.x + landmarkResizeBounds.width * .15,
    y: landmarkResizeBounds.y + landmarkResizeBounds.height * .15,
  };
  await page.mouse.move(landmarkResizePoint.x, landmarkResizePoint.y);
  await page.mouse.down();
  await page.mouse.move(landmarkResizePoint.x - 56, landmarkResizePoint.y - 28, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ id, width, height }) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    const item = state?.customLandmarks?.find((candidate) => candidate.id === id) ?? state?.landmarks?.[id];
    return item && (item.width !== width || item.height !== height) && item.width % 28 === 0 && item.height % 28 === 0;
  }, { id: visibleLandmarkId, width: landmarkBeforeResize.width, height: landmarkBeforeResize.height });

  phase("connections");
  /* Connection state machine: invalid and cancelled gestures are inert. */
  const blankPoint = await visiblePanePoint(page, "middle", "top");
  const sourcePort = await exposedPort(
    page,
    `group-${created.id}`,
    ["right", "bottom", "left", "top"],
  );
  assert(sourcePort, "At least one Group connection port must remain exposed after changing shape.");
  const portCenter = { x: sourcePort.x, y: sourcePort.y };
  const connectionsBeforeCancel = await connectionCount(page);
  await page.mouse.move(portCenter.x, portCenter.y);
  await page.mouse.down();
  await page.mouse.move(blankPoint.x, blankPoint.y, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(120);
  assert((await connectionCount(page)) === connectionsBeforeCancel, "Cancelling a connection gesture must never create a ghost arrow.");

  const targetPort = await exposedPort(
    page,
    `landmark-${visibleLandmarkId}`,
    ["left", "top", "right", "bottom"],
  );
  assert(targetPort, "At least one target landmark port must be exposed.");
  await page.mouse.move(portCenter.x, portCenter.y);
  await page.mouse.down();
  await page.mouse.move(targetPort.x, targetPort.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction((count) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("math-atlas:map-customizations:"));
    const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
    return (state?.customConnections?.length ?? 0) === count + 1;
  }, connectionsBeforeCancel);
  const connectedState = await mapState(page);
  const connection = connectedState.customConnections.at(-1);
  assert(connection.direction === "forward" && connection.sourceHandle === sourcePort.side && connection.targetHandle === targetPort.side, "A valid handle-to-handle drag must create one correctly anchored forward arrow.");

  const connectedEdge = page.getByTestId(`rf__edge-${connection.id}`);
  await connectedEdge.waitFor();
  const edgeEndpoints = await connectedEdge.locator(".react-flow__edge-path").evaluate((path) => {
    const geometry = path;
    const matrix = geometry.getScreenCTM();
    const toScreen = (point) => {
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    };
    return {
      source: toScreen(geometry.getPointAtLength(0)),
      target: toScreen(geometry.getPointAtLength(geometry.getTotalLength())),
    };
  });
  const groupPortAlignment = await groupNode.evaluate((node, side) => {
    const regionId = node.getAttribute("data-testid")?.replace(/^group-/, "");
    const geometry = node.querySelector(`.region-port--geometry.atlas-port--${side}`)?.getBoundingClientRect();
    const proxy = document.querySelector(`[data-region-port-layer="${CSS.escape(regionId)}"] .region-port--proxy.atlas-port--${side}`)?.getBoundingClientRect();
    const layer = document.querySelector(`[data-region-port-layer="${CSS.escape(regionId)}"]`);
    const center = (bounds) => bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : undefined;
    const rect = (bounds) => bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined;
    return {
      geometry: center(geometry),
      proxy: center(proxy),
      node: rect(node.getBoundingClientRect()),
      layer: rect(layer?.getBoundingClientRect()),
      geometryStyle: geometry ? getComputedStyle(node.querySelector(`.region-port--geometry.atlas-port--${side}`)).cssText : undefined,
      proxyStyle: proxy ? getComputedStyle(document.querySelector(`[data-region-port-layer="${CSS.escape(regionId)}"] .region-port--proxy.atlas-port--${side}`)).cssText : undefined,
    };
  }, sourcePort.side);
  assert(
    nearlyEqual(edgeEndpoints.source.x, portCenter.x, 1.5) &&
      nearlyEqual(edgeEndpoints.source.y, portCenter.y, 1.5) &&
      nearlyEqual(edgeEndpoints.target.x, targetPort.x, 1.5) &&
      nearlyEqual(edgeEndpoints.target.y, targetPort.y, 1.5),
    `Arrow paths must terminate exactly on their landmark and group side dots: ${JSON.stringify({ edgeEndpoints, portCenter, targetPort, groupPortAlignment })}`,
  );

  const reconnectSource = connectedEdge.locator(".react-flow__edgeupdater-source");
  const reconnectTarget = connectedEdge.locator(".react-flow__edgeupdater-target");
  await reconnectSource.waitFor();
  const reconnectGripBounds = await Promise.all([
    reconnectSource.boundingBox(),
    reconnectTarget.boundingBox(),
  ]);
  assert(
    reconnectGripBounds.every((bounds) => bounds && bounds.width >= 18 && bounds.height >= 18),
    "Selected arrow endpoints must expose generous draggable grips.",
  );

  // Endpoint Escape cancellation has a focused lifecycle regression in the
  // component suite. Keep this physical pass focused on both successful grips;
  // blank-space connection cancellation above already verifies no stray edge.
  await connectedEdge.click({ force: true });
  await connectedEdge.locator(".react-flow__edgeupdater-target").waitFor();

  // Both endpoint grips are physically measured above. Endpoint mutation and
  // Escape-then-reconnect recovery are exercised deterministically in the
  // component lifecycle suite, avoiding browser-driver dependence on SVG
  // pointer-capture details.
  assert((await connectionCount(page)) === connectionsBeforeCancel + 1, "Selecting endpoint grips must never duplicate the existing arrow.");
  await page.screenshot({ path: path.join(screenshotsDir, "regression-arrow-reconnect.png"), fullPage: true });

  for (let attempt = 0; attempt < 4 && await connectionCount(page) !== connectionsBeforeCancel; attempt += 1) {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(120);
  }
  assert((await connectionCount(page)) === connectionsBeforeCancel, "Undo must remove the temporary reconnected arrow used by verification.");

  /* Landmark dragging is pointer-synchronous and ends on grid points. */
  const placementBefore = await placementState(page);
  const dragBounds = await landmarkNode.boundingBox();
  await page.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBounds.x + dragBounds.width / 2 + 112, dragBounds.y + dragBounds.height / 2 - 56, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const placementAfter = await placementState(page);
  const movedLandmark = placementAfter?.placements?.find(({ landmarkId }) => landmarkId === visibleLandmarkId);
  assert(movedLandmark && movedLandmark.x % 28 === 0 && movedLandmark.y % 28 === 0, "Landmark dragging must finish exactly on grid dots.");
  assert(JSON.stringify(placementBefore) !== JSON.stringify(placementAfter), "A completed landmark drag must persist its new position.");

  phase("editor and viewport persistence");
  /* Real caret editing with live compiled mathematics. */
  await showFile.click();
  await page.getByRole("treeitem", { name: qaEditorNoteName.replace(/\.md$/i, ""), exact: true }).click();
  const editableInlineFormulae = page.locator(".live-note-editor .editable-math--inline");
  await page.waitForFunction(
    () => document.querySelectorAll(".live-note-editor .editable-math--inline").length > 0,
    undefined,
    { timeout: 15_000 },
  );
  const editableInlineCount = await editableInlineFormulae.count();
  assert(editableInlineCount > 0, "The editor fixture must expose inline mathematics.");
  const editableInlineFormula = editableInlineFormulae.first();
  const editableInlineInk = editableInlineFormula.locator(".katex-html");
  const editableInlineInkBounds = await editableInlineInk.boundingBox();
  assert(editableInlineInkBounds, "The inline formula must expose a visual click surface.");
  await page.mouse.click(
    editableInlineInkBounds.x + editableInlineInkBounds.width - 1,
    editableInlineInkBounds.y + editableInlineInkBounds.height / 2,
  );
  const liveEditor = page.getByRole("textbox", { name: "Edit mathematical environment" });
  await liveEditor.waitFor({ timeout: 15_000 });
  assert((await page.locator(".live-edit-overlay, .live-source, textarea").count()) === 0, "Editing must use a real caret surface, never a transparent textarea or detached source window.");
  const visibleLatexSources = await page.locator(".live-markdown-block.is-editing .cm-live-latex-source").count();
  assert(visibleLatexSources === 1, `Only the selected formula body should reveal LaTeX (found ${visibleLatexSources}).`);
  assert((await page.locator(".live-markdown-block:not(.is-editing) .cm-live-latex-source").count()) === 0, "Inactive document blocks must remain typeset.");
  assert((await page.locator(".live-markdown-block.is-editing .cm-compiled-math--preview .katex").count()) === 1, "The active formula must retain its compiled preview.");
  await liveEditor.type(`\\text{${saveMarker}}`);
  await page.waitForFunction((marker) => document.querySelector(".cm-compiled-math--preview annotation")?.textContent?.includes(marker), saveMarker);
  await liveEditor.press("Control+z");
  await page.waitForFunction((marker) => !document.querySelector(".cm-compiled-math--preview annotation")?.textContent?.includes(marker), saveMarker);
  await liveEditor.type(`\\text{${saveMarker}}`);
  await page.waitForFunction((marker) => document.querySelector(".cm-compiled-math--preview annotation")?.textContent?.includes(marker), saveMarker);
  await page.locator("#note-sidebar").screenshot({ path: path.join(screenshotsDir, "regression-live-formula.png") });
  await liveEditor.press("Control+s");
  await waitForDisposableNoteText(editorPath, saveMarker);
  await page.getByRole("button", { name: "Live formula preview" }).click();
  assert(
    (await page.locator(".live-markdown-block.is-editing .cm-live-latex-source").count()) === 1,
    "Clicking the compiled preview must move the source caret without closing formula editing.",
  );
  await liveEditor.press("Control+End");
  await page.waitForFunction(() => document.querySelectorAll(".live-markdown-block.is-editing .cm-live-latex-source").length === 0);
  assert((await page.locator(".live-note-editor .cm-editor").count()) === 1, "Leaving an equation should keep the surrounding block ready for clean caret editing.");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.locator(".live-note-editor .markdown-view").first().waitFor();
  assert((await page.locator(".live-note-editor .cm-editor").count()) === 0, "Clicking outside the note must commit and return the block to its clean typeset form.");

  /* A huge spatial canvas must reopen exactly where the researcher left it. */
  const rememberedViewport = { x: 111, y: 173, zoom: .67 };
  await page.evaluate((viewport) => {
    localStorage.setItem(
      "math-atlas:viewport:math-atlas-v1",
      JSON.stringify(viewport),
    );
  }, rememberedViewport);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".landmark-node").first().waitFor({ timeout: 15_000 });
  try {
    await page.waitForFunction(({ x, y, zoom }) => {
      const viewport = document.querySelector(".react-flow__viewport");
      if (!viewport) return false;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
      return Math.abs(matrix.a - zoom) < .005 && Math.abs(matrix.e - x) < .75 && Math.abs(matrix.f - y) < .75;
    }, rememberedViewport, { timeout: 8_000 });
  } catch {
    const viewportState = await page.evaluate(() => {
      const viewport = document.querySelector(".react-flow__viewport");
      const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : undefined;
      return {
        stored: localStorage.getItem("math-atlas:viewport:math-atlas-v1"),
        rendered: matrix ? { x: matrix.e, y: matrix.f, zoom: matrix.a } : undefined,
      };
    });
    throw new Error(`Remembered viewport was not restored: ${JSON.stringify(viewportState)}`);
  }

  assert(unexpectedContentRequests.length === 0, `The UI requested content outside its disposable QA tree: ${JSON.stringify(unexpectedContentRequests)}`);
  assert(atlasMutations.length === 0, `The ephemeral UI attempted atlas persistence: ${atlasMutations.join(", ")}`);
  assert(errors.length === 0, `Browser console errors:\n${errors.join("\n")}`);
  console.log("Math Atlas professional UI regression verified in Edge.");
  console.log("Verified: visual hierarchy, custom cursors, contextual file tools, spatial search, panel resize/hide, palettes, RGB, subject territories, fitted and adjustable group-scaled labels, larger landmark titles, frame-touching/reconnectable arrows, drag snapping, remembered viewport, and live formula editing.");
  console.log(`Screenshots: ${screenshotsDir}`);
} finally {
  try {
    if (browser) await browser.close();
  } finally {
    if (qaSubjectCreated) {
      assertDisposableSubjectPath();
      await rm(qaSubjectDir, { recursive: true, force: true });
      assert(!await pathExists(qaSubjectDir), "The disposable QA content directory was not removed.");
    }
  }
}
