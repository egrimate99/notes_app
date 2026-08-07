import { access, mkdir } from "node:fs/promises";
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
const overviewScreenshot = path.join(screenshotsDir, "usability-stress-nested-canvas.png");
const menuScreenshot = path.join(screenshotsDir, "usability-stress-context-menu.png");
const selectionEscapeScreenshot = path.join(
  screenshotsDir,
  "usability-stress-selection-first-escape.png",
);
const geometryOwnershipScreenshot = path.join(
  screenshotsDir,
  "usability-stress-geometry-ownership.png",
);
const resizeCancelScreenshot = path.join(
  screenshotsDir,
  "usability-stress-group-resize-cancel.png",
);
const contentZoomScreenshot = path.join(
  screenshotsDir,
  "usability-stress-landmark-content-far-zoom.png",
);
const contentFrameScreenshot = path.join(
  screenshotsDir,
  "usability-stress-landmark-content-frame.png",
);
const formulaPickerScreenshot = path.join(
  screenshotsDir,
  "usability-stress-landmark-formula-picker.png",
);
const groupBoundaryZoomScreenshot = path.join(
  screenshotsDir,
  "usability-stress-group-boundary-zoom.png",
);
const mixedSelectionDragScreenshot = path.join(
  screenshotsDir,
  "usability-stress-mixed-selection-drag.png",
);
const movementGuidesScreenshot = path.join(
  screenshotsDir,
  "usability-stress-movement-guides.png",
);
const alignmentConnectionId = "stress-alignment-arrow";

const ids = {
  subject: "stress-subject",
  group: "stress-group",
  subgroup: "stress-subgroup",
  a: "stress-landmark-a",
  b: "stress-landmark-b",
  c: "stress-landmark-c",
  d: "stress-landmark-d",
  corner: "stress-landmark-corner",
  overlap: "stress-landmark-overlap",
  content: "stress-landmark-content",
  overlapGroup: "stress-overlap-group",
};

const fixtureSubjectId = "canvas-stress-field";
const fixtureNotePaths = {
  a: "Canvas Stress/Interaction Notes/Nested Alpha.md",
  b: "Canvas Stress/Interaction Notes/Nested Beta.md",
  c: "Canvas Stress/Interaction Notes/Group Gamma.md",
  d: "Canvas Stress/Interaction Notes/Subject Delta.md",
  corner: "Canvas Stress/Interaction Notes/Transparent Corner.md",
  overlap: "Canvas Stress/Interaction Notes/Overlap Ownership.md",
  content: "Canvas Stress/Interaction Notes/Synthetic Boundary.md",
};
const fixtureNoteMarkdownByPath = new Map([
  [fixtureNotePaths.a, "# Nested alpha\n\nSynthetic canvas stress fixture content.\n"],
  [fixtureNotePaths.b, "# Nested beta\n\nSynthetic canvas stress fixture content.\n"],
  [fixtureNotePaths.c, "# Group gamma\n\nSynthetic canvas stress fixture content.\n"],
  [fixtureNotePaths.d, "# Subject delta\n\nSynthetic canvas stress fixture content.\n"],
  [fixtureNotePaths.corner, "# Transparent corner\n\nSynthetic canvas stress fixture content.\n"],
  [fixtureNotePaths.overlap, "# Overlap ownership\n\nSynthetic canvas stress fixture content.\n"],
  [fixtureNotePaths.content, String.raw`# Synthetic boundary

Synthetic boundary is fixture text for the rendered-content and formula-picker paths.

$$
\gamma = \frac{y(w^\top x + b)}{\lVert w \rVert}
$$

$$
\min_{w,b} \frac{1}{2}\lVert w \rVert^2
$$
`],
]);
const fixtureContentTree = [
  {
    type: "directory",
    name: "Canvas Stress",
    path: "Canvas Stress",
    children: [
      {
        type: "directory",
        name: "Interaction Notes",
        path: "Canvas Stress/Interaction Notes",
        children: [...fixtureNoteMarkdownByPath.keys()].map((notePath) => ({
          type: "file",
          name: notePath.slice(notePath.lastIndexOf("/") + 1),
          path: notePath,
        })),
      },
    ],
  },
];

const fixture = {
  schemaVersion: 1,
  snapshotKey: "math-atlas-v1",
  landmarkKinds: {},
  landmarks: {},
  // Keep the automatically derived Canvas Stress territory out of the
  // isolated fixture. The authored nested subject below is the interaction
  // target; testing two coincident subject frames would conflate z-order with
  // border hit-testing.
  groups: {
    [`subject-zone:${fixtureSubjectId}`]: {
      x: -5_600,
      y: -5_600,
      width: 840,
      height: 560,
      title: "Derived fixture territory",
    },
  },
  customLandmarks: [
    {
      id: ids.a,
      title: "Nested alpha",
      subjectId: fixtureSubjectId,
      regionId: ids.subgroup,
      contentPath: `content/${fixtureNotePaths.a}`,
      x: 420,
      y: 336,
      width: 196,
      height: 84,
      color: "#287348",
      shape: "hexagon",
      kind: "definition",
      contentMode: "title",
    },
    {
      id: ids.b,
      title: "Nested beta",
      subjectId: fixtureSubjectId,
      regionId: ids.subgroup,
      contentPath: `content/${fixtureNotePaths.b}`,
      x: 672,
      y: 420,
      width: 196,
      height: 84,
      color: "#287348",
      shape: "rectangle",
      kind: "theorem",
      contentMode: "title",
    },
    {
      id: ids.c,
      title: "Group gamma",
      subjectId: fixtureSubjectId,
      regionId: ids.group,
      contentPath: `content/${fixtureNotePaths.c}`,
      x: 280,
      y: 560,
      width: 196,
      height: 84,
      color: "#287348",
      shape: "oval",
      kind: "proposition",
      contentMode: "title",
    },
    {
      id: ids.d,
      title: "Subject delta",
      subjectId: fixtureSubjectId,
      regionId: ids.subject,
      contentPath: `content/${fixtureNotePaths.d}`,
      x: 980,
      y: 700,
      width: 196,
      height: 84,
      color: "#287348",
      shape: "octagon",
      kind: "lemma",
      contentMode: "title",
    },
    {
      id: ids.corner,
      title: "Transparent corner",
      subjectId: fixtureSubjectId,
      regionId: ids.subject,
      contentPath: `content/${fixtureNotePaths.corner}`,
      x: 700,
      y: 700,
      width: 196,
      height: 84,
      color: "#b24c1a",
      shape: "triangle",
      kind: "note",
      contentMode: "title",
    },
    {
      id: ids.overlap,
      title: "Landmark owns overlap",
      subjectId: fixtureSubjectId,
      regionId: ids.overlapGroup,
      contentPath: `content/${fixtureNotePaths.overlap}`,
      x: 560,
      y: 112,
      width: 196,
      height: 84,
      color: "#245f9e",
      shape: "rectangle",
      kind: "proposition",
      contentMode: "title",
    },
    {
      id: ids.content,
      title: "Synthetic boundary",
      subjectId: fixtureSubjectId,
      regionId: ids.subject,
      contentPath: `content/${fixtureNotePaths.content}`,
      x: 868,
      y: 280,
      width: 336,
      height: 252,
      color: "#245f9e",
      shape: "rectangle",
      kind: "definition",
      contentMode: "note",
    },
  ],
  customGroups: [
    {
      id: ids.subject,
      title: "Stress subject",
      subjectId: fixtureSubjectId,
      level: "subject",
      x: 56,
      y: 56,
      width: 1_176,
      height: 756,
      color: "#287348",
      shape: "rectangle",
      borderStyle: "solid",
      borderWeight: "regular",
      titlePosition: "top-left",
      titleFontSize: 30,
    },
    {
      id: ids.group,
      title: "Stress group",
      subjectId: fixtureSubjectId,
      level: "group",
      parentId: ids.subject,
      x: 196,
      y: 168,
      width: 840,
      height: 504,
      color: "#287348",
      shape: "oval",
      borderStyle: "solid",
      titlePosition: "top-left",
      titleFontSize: 25,
    },
    {
      id: ids.subgroup,
      title: "Stress subgroup",
      subjectId: fixtureSubjectId,
      level: "subgroup",
      parentId: ids.group,
      x: 336,
      y: 280,
      width: 560,
      height: 252,
      color: "#287348",
      shape: "hexagon",
      borderStyle: "dashed",
      titlePosition: "top-left",
      titleFontSize: 20,
    },
    {
      id: ids.overlapGroup,
      title: "Covered group title",
      subjectId: fixtureSubjectId,
      level: "group",
      parentId: ids.subject,
      x: 560,
      y: 112,
      width: 252,
      height: 196,
      color: "#245f9e",
      shape: "rectangle",
      borderStyle: "solid",
      titlePosition: "top-left",
      titleFontSize: 22,
    },
  ],
  connectionOverrides: {},
  customConnections: [{
    id: alignmentConnectionId,
    source: ids.a,
    target: ids.c,
    sourceHandle: "bottom",
    targetHandle: "top",
    direction: "forward",
    lineStyle: "solid",
    pathStyle: "smooth",
    color: "#245cba",
  }],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function firstAvailable(candidates) {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("Microsoft Edge was not found.");
}

async function assertHealthyServer() {
  const root = await fetch(`${appUrl}/`);
  assert(root.ok, `Application root returned HTTP ${root.status}.`);
}

async function canvasState(page) {
  return page.evaluate(() => {
    const mapKey = Object.keys(localStorage).find((key) =>
      key.startsWith("math-atlas:map-customizations:"),
    );
    const placementKey = Object.keys(localStorage).find((key) =>
      key.startsWith("math-atlas:placement-overrides:"),
    );
    const map = mapKey ? JSON.parse(localStorage.getItem(mapKey)) : undefined;
    const placementPayload = placementKey ? JSON.parse(localStorage.getItem(placementKey)) : [];
    const placements = Array.isArray(placementPayload)
      ? placementPayload
      : Array.isArray(placementPayload?.placements) ? placementPayload.placements : [];
    const placementById = new Map(placements.map((item) => [item.landmarkId, item]));
    return {
      landmarks: Object.fromEntries((map?.customLandmarks ?? [])
        .filter(({ id }) => id.startsWith("stress-landmark-"))
        .map((item) => {
          const position = placementById.get(item.id) ?? item;
          return [item.id, {
            x: position.x,
            y: position.y,
            width: item.width,
            height: item.height,
          }];
        })),
      groups: Object.fromEntries((map?.customGroups ?? [])
        .filter(({ id }) => id.startsWith("stress-"))
        .map((item) => [item.id, {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        }])),
      landmarkIds: (map?.customLandmarks ?? []).map(({ id }) => id),
      customConnections: map?.customConnections ?? [],
    };
  });
}

async function viewportState(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".react-flow__viewport");
    if (!viewport) return undefined;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return {
      x: matrix.e,
      y: matrix.f,
      zoomX: matrix.a,
      zoomY: matrix.d,
      stored: localStorage.getItem("math-atlas:viewport:math-atlas-v1"),
    };
  });
}

function assertViewportStable(expected, actual, phase) {
  assert(expected, `The canvas viewport was missing before ${phase}.`);
  assert(actual, `The canvas viewport disappeared during ${phase}.`);
  const delta = {
    x: actual.x - expected.x,
    y: actual.y - expected.y,
    zoomX: actual.zoomX - expected.zoomX,
    zoomY: actual.zoomY - expected.zoomY,
  };
  const stable = Object.values(delta).every((value) => Math.abs(value) <= .05);
  assert(
    stable,
    `The viewport moved during ${phase}: before=${JSON.stringify(expected)}, after=${JSON.stringify(actual)}, delta=${JSON.stringify(delta)}.`,
  );
  assert(
    actual.stored === expected.stored,
    `The stored viewport changed during ${phase}: before=${expected.stored}, after=${actual.stored}.`,
  );
}

async function objectScreenGeometry(page, testId) {
  return page.evaluate((ownerTestId) => {
    const owner = document.querySelector(`[data-testid="${ownerTestId}"]`);
    const wrapper = owner?.closest(".react-flow__node");
    const viewport = document.querySelector(".react-flow__viewport");
    if (!owner || !wrapper || !viewport) return undefined;
    const bounds = owner.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height,
      zoom: matrix.a,
      resizing: wrapper.classList.contains("resizing"),
    };
  }, testId);
}

async function edgeScreenEndpoints(page, edgeId) {
  return page.getByTestId(`rf__edge-${edgeId}`).locator(".react-flow__edge-path").evaluate((path) => {
    const matrix = path.getScreenCTM();
    if (!matrix) return undefined;
    const screenPoint = (point) => {
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    };
    return {
      source: screenPoint(path.getPointAtLength(0)),
      target: screenPoint(path.getPointAtLength(path.getTotalLength())),
    };
  });
}

function expectedSnappedRightResize(original, pointerDelta, grid = 28) {
  const right = Math.round((original.x + original.width + pointerDelta) / grid) * grid;
  return {
    x: original.x,
    y: original.y,
    width: right - original.x,
    height: original.height,
  };
}

function expectedLiveRightResize(original, pointerDelta) {
  return {
    x: original.x,
    y: original.y,
    width: original.width + pointerDelta,
    height: original.height,
  };
}

function assertRightResizeSample(sample, initialScreen, expected, label) {
  assert(sample.geometry, `${label} lost its live screen geometry.`);
  const geometry = sample.geometry;
  const screenTolerance = Math.max(.85, geometry.zoom * .85);
  assert(
    Math.abs(geometry.left - initialScreen.left) <= screenTolerance,
    `${label} moved its fixed left edge by ${(geometry.left - initialScreen.left).toFixed(2)}px at pointer delta ${sample.pointerDelta}.`,
  );
  assert(
    Math.abs(geometry.top - initialScreen.top) <= screenTolerance,
    `${label} moved vertically by ${(geometry.top - initialScreen.top).toFixed(2)}px during a right-edge resize.`,
  );
  assert(
    Math.abs(geometry.width / geometry.zoom - expected.width) <= .85,
    `${label} width lost pointer synchronization at delta ${sample.pointerDelta}: live=${(geometry.width / geometry.zoom).toFixed(2)}, expected=${expected.width}.`,
  );
  assert(
    Math.abs((geometry.right - initialScreen.right) - sample.pointerDelta) <= .85,
    `${label} moving edge detached from the pointer at delta ${sample.pointerDelta}: edge delta=${(geometry.right - initialScreen.right).toFixed(2)}px.`,
  );
}

async function traceRightBorderResize(page, options) {
  const {
    testId,
    resizePoint,
    original,
    label,
    pointerDeltas = [4, 10, 16, 22, 28, 34, 40, 46, 52, 58],
  } = options;
  const initialScreen = await objectScreenGeometry(page, testId);
  assert(initialScreen, `${label} has no initial screen geometry.`);
  await page.mouse.move(resizePoint.x, resizePoint.y);
  await page.mouse.down();

  const samples = [];
  for (const pointerDelta of pointerDeltas) {
    await page.mouse.move(resizePoint.x + pointerDelta, resizePoint.y);
    const expected = expectedLiveRightResize(
      original,
      pointerDelta / initialScreen.zoom,
    );
    const geometry = await waitFor(page, async () => {
      const current = await objectScreenGeometry(page, testId);
      if (!current) return false;
      return Math.abs(current.width / current.zoom - expected.width) <= .85
        ? current
        : false;
    }, `${label} did not track pointer delta ${pointerDelta}.`);
    const sample = { pointerDelta, geometry };
    assertRightResizeSample(sample, initialScreen, expected, label);
    const previous = samples.at(-1);
    if (previous) {
      const canvasRight = geometry.right / geometry.zoom;
      const previousCanvasRight = previous.geometry.right / previous.geometry.zoom;
      assert(
        canvasRight + .85 >= previousCanvasRight,
        `${label} jumped backwards while the pointer moved right: ${JSON.stringify({ previous, sample })}.`,
      );
      assert(
        Math.abs(
          (canvasRight - previousCanvasRight) -
          (sample.pointerDelta - previous.pointerDelta) / geometry.zoom,
        ) <= .85,
        `${label} jumped between adjacent pointer samples: ${JSON.stringify({ previous, sample })}.`,
      );
    }
    samples.push(sample);
  }

  await page.mouse.up();
  const finalExpected = expectedSnappedRightResize(
    original,
    pointerDeltas.at(-1) / initialScreen.zoom,
  );
  await waitFor(page, async () => {
    const current = await canvasState(page);
    const collection = testId.startsWith("landmark-") ? current.landmarks : current.groups;
    const id = testId.replace(/^landmark-|^group-/, "");
    const item = collection[id];
    return item?.x === finalExpected.x && item?.y === finalExpected.y &&
      item?.width === finalExpected.width && item?.height === finalExpected.height
      ? item
      : false;
  }, `${label} did not persist its final snapped dimensions.`);
  assert(
    finalExpected.x % 28 === 0 && finalExpected.y % 28 === 0 &&
      finalExpected.width % 28 === 0 && finalExpected.height % 28 === 0,
    `${label} ended off the 28px canvas grid: ${JSON.stringify(finalExpected)}.`,
  );
  const settled = await objectScreenGeometry(page, testId);
  assert(settled && !settled.resizing, `${label} remained in resizing state after pointer-up.`);
  return { initialScreen, samples, finalExpected, settled };
}

async function zoomOutCanvas(page, steps) {
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  let previous = await viewportState(page);
  assert(previous, "The canvas viewport was unavailable before zooming.");
  for (let index = 0; index < steps; index += 1) {
    previous = await settledZoomOutStep(
      page,
      zoomOut,
      previous,
      `Canvas zoom-out step ${index + 1}`,
    );
  }
  return previous;
}

async function settledZoomOutStep(page, zoomOut, previous, label) {
  await zoomOut.click();
  await waitFor(page, async () => {
    const current = await viewportState(page);
    return current && current.zoomX < previous.zoomX - .005 ? current : false;
  }, `${label} did not begin.`);
  // Toolbar zoom is deliberately animated. Wait beyond its 120ms duration,
  // then require two equal camera samples so resize assertions never confuse
  // residual camera motion with object motion.
  await page.waitForTimeout(150);
  return waitFor(page, async () => {
    const first = await viewportState(page);
    await page.waitForTimeout(45);
    const second = await viewportState(page);
    const graphClass = await page.getByTestId("atlas-graph").getAttribute("class");
    if (!first || !second || !graphClass || graphClass.includes("is-navigating")) return false;
    return Math.abs(first.x - second.x) <= .05 &&
      Math.abs(first.y - second.y) <= .05 &&
      Math.abs(first.zoomX - second.zoomX) <= .0005
      ? second
      : false;
  }, `${label} did not settle.`);
}

async function landmarkDecorationGeometry(page, id) {
  return page.evaluate((landmarkId) => {
    const owner = document.querySelector(`[data-testid="landmark-${landmarkId}"]`);
    const frame = owner?.querySelector(".landmark-node__frame");
    const documentBody = owner?.querySelector(".landmark-node__document");
    if (!owner || !frame || !documentBody) return undefined;
    const viewBox = frame.viewBox.baseVal;
    const paths = [...owner.querySelectorAll(
      ".landmark-node__detail, .landmark-node__semantic-detail, .landmark-node__document-border",
    )];
    const samples = paths.flatMap((path) => {
      const length = path.getTotalLength?.() ?? 0;
      if (!Number.isFinite(length) || length <= 0) return [];
      const count = Math.max(8, Math.ceil(length / 3));
      return Array.from({ length: count + 1 }, (_, index) => {
        const point = path.getPointAtLength(length * index / count);
        return {
          className: path.getAttribute("class"),
          x: point.x,
          y: point.y,
          edgeDepth: Math.min(
            point.x - viewBox.x,
            viewBox.x + viewBox.width - point.x,
            point.y - viewBox.y,
            viewBox.y + viewBox.height - point.y,
          ),
        };
      });
    });
    const ownerBounds = owner.getBoundingClientRect();
    const documentBounds = documentBody.getBoundingClientRect();
    return {
      viewBox: {
        x: viewBox.x,
        y: viewBox.y,
        width: viewBox.width,
        height: viewBox.height,
      },
      ownerBounds: {
        left: ownerBounds.left,
        top: ownerBounds.top,
        right: ownerBounds.right,
        bottom: ownerBounds.bottom,
      },
      documentBounds: {
        left: documentBounds.left,
        top: documentBounds.top,
        right: documentBounds.right,
        bottom: documentBounds.bottom,
      },
      pathCount: paths.length,
      samples,
    };
  }, id);
}

async function renderedLandmarkContent(page, id) {
  return page.evaluate((landmarkId) => {
    const owner = document.querySelector(`[data-testid="landmark-${landmarkId}"]`);
    const documentBody = owner?.querySelector(".landmark-node__document");
    const preview = owner?.querySelector(".landmark-node__preview");
    const markdown = owner?.querySelector(".landmark-node__preview .markdown-view");
    if (!owner || !documentBody || !preview || !markdown) return undefined;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        width: bounds.width,
        height: bounds.height,
        rects: element.getClientRects().length,
      };
    };
    return {
      ownerConnected: owner.isConnected,
      probe: documentBody.getAttribute("data-stress-content-probe"),
      text: markdown.textContent?.replace(/\s+/g, " ").trim() ?? "",
      document: visible(documentBody),
      preview: visible(preview),
      markdown: visible(markdown),
      zoomTier: [...document.querySelector(".atlas-graph")?.classList ?? []]
        .find((name) => name.startsWith("is-zoom-")) ?? null,
      domNodes: owner.querySelectorAll("*").length,
    };
  }, id);
}

async function renderedLandmarkFormula(page, id) {
  return page.evaluate((landmarkId) => {
    const preview = document.querySelector(
      `[data-testid="landmark-${landmarkId}"] .landmark-node__preview--formula`,
    );
    const katex = preview?.querySelector(".katex");
    const visibleText = katex
      ?.querySelector(".katex-html")
      ?.textContent
      ?.replace(/\s+/g, " ")
      .trim();
    const source = preview
      ?.querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent
      ?.trim();
    return preview && katex && visibleText
      ? { source: source ?? visibleText, visibleText, compiled: true }
      : undefined;
  }, id);
}

async function storedLandmarkFormulaIndex(page, id) {
  return page.evaluate((landmarkId) => {
    const mapKey = Object.keys(localStorage).find((key) =>
      key.startsWith("math-atlas:map-customizations:"),
    );
    const map = mapKey ? JSON.parse(localStorage.getItem(mapKey)) : undefined;
    return map?.landmarks?.[landmarkId]?.formulaIndex ??
      map?.customLandmarks?.find(({ id: candidateId }) => candidateId === landmarkId)
        ?.formulaIndex;
  }, id);
}

async function waitFor(page, predicate, message, timeout = 7_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await page.waitForTimeout(40);
  }
  throw new Error(`${message}${last === undefined ? "" : ` (last: ${JSON.stringify(last)})`}`);
}

function landmark(page, id) {
  return page.getByTestId(`landmark-${id}`);
}

function group(page, id) {
  return page.getByTestId(`group-${id}`);
}

function groupTitle(page, id) {
  return page.locator(`[data-region-title="${id}"]`);
}

async function hideSidebars(page) {
  for (const name of ["Close note sidebar", "Hide file sidebar"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count() && await button.isVisible()) await button.click();
  }
  await page.waitForTimeout(120);
}

async function resetFixture(page) {
  await page.evaluate(({ fixture: nextFixture }) => {
    localStorage.clear();
    localStorage.setItem(
      "math-atlas:map-customizations:v1:math-atlas-v1",
      JSON.stringify(nextFixture),
    );
    localStorage.setItem(
      "math-atlas:viewport:math-atlas-v1",
      JSON.stringify({ x: 100, y: 30, zoom: 1 }),
    );
  }, { fixture });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await landmark(page, ids.a).waitFor({ timeout: 15_000 });
  await group(page, ids.subject).waitFor({ timeout: 15_000 });
  await hideSidebars(page);
  await page.waitForFunction(() => {
    const graph = document.querySelector(".atlas-graph");
    const viewport = document.querySelector(".react-flow__viewport");
    if (!graph || !viewport || graph.classList.contains("is-navigating")) return false;
    return Math.abs(new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a - 1) < .005;
  }, undefined, { timeout: 10_000 });
}

async function dragFrom(page, start, end, steps = 8) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

async function dragLocator(page, locator, deltaX, deltaY, steps = 8) {
  const bounds = await locator.boundingBox();
  assert(bounds, "The drag target has no screen geometry.");
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await dragFrom(page, start, { x: start.x + deltaX, y: start.y + deltaY }, steps);
}

async function dragLocatorGridOnly(page, locator, deltaX, deltaY, steps = 8) {
  await page.keyboard.down("Alt");
  try {
    await dragLocator(page, locator, deltaX, deltaY, steps);
  } finally {
    await page.keyboard.up("Alt");
  }
}

async function beginLocatorDrag(page, locator) {
  const bounds = await locator.boundingBox();
  assert(bounds, "The drag target has no screen geometry.");
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  return start;
}

async function moveOpenDrag(page, start, deltaX, deltaY, steps = 8) {
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps });
}

async function selectedStressObjects(page) {
  return page.evaluate(() => {
    const selected = { landmarks: [], groups: [] };
    document.querySelectorAll("[data-testid^='landmark-stress-landmark-']").forEach((node) => {
      if (node.classList.contains("is-selected") || node.closest(".react-flow__node")?.classList.contains("selected")) {
        selected.landmarks.push(node.getAttribute("data-testid").replace(/^landmark-/, ""));
      }
    });
    document.querySelectorAll("[data-testid^='group-stress-']").forEach((node) => {
      if (node.classList.contains("is-selected") || node.closest(".react-flow__node")?.classList.contains("selected")) {
        selected.groups.push(node.getAttribute("data-testid").replace(/^group-/, ""));
      }
    });
    selected.landmarks.sort();
    selected.groups.sort();
    return selected;
  });
}

async function waitForSelection(page, expectedLandmarks, expectedGroups = []) {
  const expected = {
    landmarks: [...expectedLandmarks].sort(),
    groups: [...expectedGroups].sort(),
  };
  let actual;
  try {
    await waitFor(page, async () => {
      actual = await selectedStressObjects(page);
      return JSON.stringify(actual) === JSON.stringify(expected) ? actual : false;
    }, `Selection did not settle at ${JSON.stringify(expected)}.`);
  } catch (cause) {
    throw new Error(
      `Selection was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
      { cause },
    );
  }
}

async function gestureDiagnostics(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const graph = document.querySelector("[data-testid='atlas-graph']");
    const describe = (element) => element ? {
      tag: element.tagName.toLocaleLowerCase(),
      testId: element.getAttribute("data-testid"),
      role: element.getAttribute("role"),
      className: typeof element.className === "string" ? element.className : null,
      text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || null,
    } : null;
    return {
      activeElement: describe(active),
      graph: describe(graph),
      graphDataset: graph ? { ...graph.dataset } : null,
      selection: (() => {
        const selected = { landmarks: [], groups: [] };
        document.querySelectorAll("[data-testid^='landmark-stress-landmark-']").forEach((node) => {
          if (node.classList.contains("is-selected") || node.closest(".react-flow__node")?.classList.contains("selected")) {
            selected.landmarks.push(node.getAttribute("data-testid").replace(/^landmark-/, ""));
          }
        });
        document.querySelectorAll("[data-testid^='group-stress-']").forEach((node) => {
          if (node.classList.contains("is-selected") || node.closest(".react-flow__node")?.classList.contains("selected")) {
            selected.groups.push(node.getAttribute("data-testid").replace(/^group-/, ""));
          }
        });
        selected.landmarks.sort();
        selected.groups.sort();
        return selected;
      })(),
      openDialogs: [...document.querySelectorAll("[role='dialog']")].map(describe),
      connectionLines: document.querySelectorAll(".react-flow__connectionline").length,
      selectionRects: document.querySelectorAll(".react-flow__selection, .react-flow__nodesselection").length,
      draggingNodes: document.querySelectorAll(".react-flow__node.dragging").length,
      connectingHandles: document.querySelectorAll(".react-flow__handle.connecting, .react-flow__handle.valid").length,
    };
  });
}

function assertPosition(item, expected, label) {
  assert(item, `${label} disappeared from disposable canvas state.`);
  assert(
    item.x === expected.x && item.y === expected.y,
    `${label} moved to (${item.x}, ${item.y}); expected (${expected.x}, ${expected.y}).`,
  );
}

function assertMoved(before, after, collection, objectIds, deltaX, deltaY) {
  for (const id of objectIds) {
    const previous = before[collection][id];
    assertPosition(
      after[collection][id],
      { x: previous.x + deltaX, y: previous.y + deltaY },
      id,
    );
  }
}

function assertUnmoved(before, after, collection, objectIds) {
  for (const id of objectIds) {
    const previous = before[collection][id];
    assertPosition(after[collection][id], previous, id);
  }
}

async function waitForPosition(page, collection, id, x, y) {
  return waitFor(page, async () => {
    const state = await canvasState(page);
    const item = state[collection][id];
    return item?.x === x && item?.y === y ? state : false;
  }, `${id} did not reach (${x}, ${y}).`);
}

async function exposedFramePoint(page, testId, targetClass, side = "any") {
  return page.evaluate(({ ownerTestId, className, preferredSide }) => {
    const owner = document.querySelector(`[data-testid="${ownerTestId}"]`);
    const target = owner?.querySelector(`.${className}`);
    const matrix = target?.getScreenCTM?.();
    const length = target?.getTotalLength?.();
    const bounds = target?.getBoundingClientRect?.();
    if (!owner || !target || !matrix || !bounds || !Number.isFinite(length)) return undefined;
    let candidates = Array.from({ length: 128 }, (_, index) => {
      const local = target.getPointAtLength(length * index / 128);
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    }).filter(({ x, y }) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    const xBand = Math.max(8, bounds.width * .08);
    const yBand = Math.max(8, bounds.height * .08);
    if (preferredSide === "right") {
      candidates = candidates.filter(({ x }) => x >= bounds.right - xBand);
      candidates.sort((left, right) => right.x - left.x);
    } else if (preferredSide === "left") {
      candidates = candidates.filter(({ x }) => x <= bounds.left + xBand);
      candidates.sort((left, right) => left.x - right.x);
    } else if (preferredSide === "top") {
      candidates = candidates.filter(({ y }) => y <= bounds.top + yBand);
      candidates.sort((left, right) => left.y - right.y);
    } else if (preferredSide === "bottom") {
      candidates = candidates.filter(({ y }) => y >= bounds.bottom - yBand);
      candidates.sort((left, right) => right.y - left.y);
    }
    for (const point of candidates) {
      const target = document.elementFromPoint(point.x, point.y);
      if (target?.classList.contains(className) && owner.contains(target)) return point;
    }
    return undefined;
  }, { ownerTestId: testId, className: targetClass, preferredSide: side });
}

async function expandedFrameBandPoint(page, testId, targetClass, offsetPixels = 10) {
  return page.evaluate(({ ownerTestId, className, offset }) => {
    const owner = document.querySelector(`[data-testid="${ownerTestId}"]`);
    const path = owner?.querySelector(`.${className}`);
    const matrix = path?.getScreenCTM?.();
    const length = path?.getTotalLength?.();
    if (!owner || !path || !matrix || !Number.isFinite(length)) return undefined;
    const tangentSample = Math.max(1, length / 1024);
    for (let index = 0; index < 128; index += 1) {
      const pathDistance = length * (index + .5) / 128;
      const centerLocal = path.getPointAtLength(pathDistance);
      const center = new DOMPoint(centerLocal.x, centerLocal.y).matrixTransform(matrix);
      const beforeLocal = path.getPointAtLength(Math.max(0, pathDistance - tangentSample));
      const afterLocal = path.getPointAtLength(Math.min(length, pathDistance + tangentSample));
      const before = new DOMPoint(beforeLocal.x, beforeLocal.y).matrixTransform(matrix);
      const after = new DOMPoint(afterLocal.x, afterLocal.y).matrixTransform(matrix);
      const tangentX = after.x - before.x;
      const tangentY = after.y - before.y;
      const tangentLength = Math.hypot(tangentX, tangentY);
      if (tangentLength < .01) continue;
      const normal = { x: -tangentY / tangentLength, y: tangentX / tangentLength };
      for (const direction of [-1, 1]) {
        const point = {
          x: center.x + normal.x * offset * direction,
          y: center.y + normal.y * offset * direction,
        };
        if (point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight) continue;
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit?.classList.contains(className) && owner.contains(hit)) return point;
      }
    }
    return undefined;
  }, { ownerTestId: testId, className: targetClass, offset: offsetPixels });
}

async function frameHitDiagnostics(page, testId) {
  return page.evaluate((ownerTestId) => {
    const owner = document.querySelector(`[data-testid="${ownerTestId}"]`);
    const bounds = owner?.getBoundingClientRect();
    if (!owner || !bounds) return { missing: true };
    const points = [
      [bounds.left + bounds.width / 2, bounds.top + .6, "top"],
      [bounds.right - .6, bounds.top + bounds.height / 2, "right"],
      [bounds.left + bounds.width / 2, bounds.bottom - .6, "bottom"],
      [bounds.left + .6, bounds.top + bounds.height / 2, "left"],
    ];
    return {
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      samples: points.map(([x, y, side]) => ({
        side,
        x,
        y,
        stack: document.elementsFromPoint(x, y).slice(0, 5).map((node) => ({
          tag: node.tagName,
          class: typeof node.className === "string" ? node.className : node.getAttribute("class"),
          testId: node.getAttribute("data-testid"),
        })),
      })),
    };
  }, testId);
}

async function transparentShapePoint(page, testId) {
  return page.evaluate((ownerTestId) => {
    const owner = document.querySelector(`[data-testid="${ownerTestId}"]`);
    const bounds = owner?.getBoundingClientRect();
    if (!owner || !bounds) return undefined;
    const candidates = [
      [.03, .04],
      [.06, .06],
      [.1, .08],
      [.14, .1],
    ];
    for (const [xRatio, yRatio] of candidates) {
      const point = {
        x: bounds.left + bounds.width * xRatio,
        y: bounds.top + bounds.height * yRatio,
      };
      const target = document.elementFromPoint(point.x, point.y);
      if (!target || owner.contains(target)) continue;
      return {
        ...point,
        target: {
          tag: target.tagName.toLocaleLowerCase(),
          className: typeof target.className === "string"
            ? target.className
            : target.getAttribute("class"),
          landmarkTestId: target.closest("[data-testid^='landmark-']")?.getAttribute("data-testid") ?? null,
          groupTestId: target.closest("[data-testid^='group-']")?.getAttribute("data-testid") ?? null,
        },
      };
    }
    return undefined;
  }, testId);
}

async function overlapOwnershipPoint(page, landmarkTestId, titleRegionId) {
  return page.evaluate(({ landmarkOwnerTestId, regionId }) => {
    const landmarkOwner = document.querySelector(`[data-testid="${landmarkOwnerTestId}"]`);
    const title = document.querySelector(`[data-region-title="${regionId}"]`);
    const landmarkBounds = landmarkOwner?.getBoundingClientRect();
    const titleBounds = title?.getBoundingClientRect();
    if (!landmarkOwner || !title || !landmarkBounds || !titleBounds) return undefined;
    const intersection = {
      left: Math.max(landmarkBounds.left, titleBounds.left),
      top: Math.max(landmarkBounds.top, titleBounds.top),
      right: Math.min(landmarkBounds.right, titleBounds.right),
      bottom: Math.min(landmarkBounds.bottom, titleBounds.bottom),
    };
    if (intersection.right - intersection.left < 8 || intersection.bottom - intersection.top < 8) {
      return { intersection, missingOverlap: true };
    }
    const point = {
      x: (intersection.left + intersection.right) / 2,
      y: (intersection.top + intersection.bottom) / 2,
    };
    const target = document.elementFromPoint(point.x, point.y);
    const targetLandmark = target?.closest("[data-testid^='landmark-']");
    const describe = (element) => {
      if (!(element instanceof Element)) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLocaleLowerCase(),
        className: typeof element.className === "string"
          ? element.className
          : element.getAttribute("class"),
        testId: element.getAttribute("data-testid"),
        position: style.position,
        zIndex: style.zIndex,
        transform: style.transform,
        isolation: style.isolation,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
      };
    };
    const ancestry = (element) => {
      const result = [];
      let current = element;
      while (current && result.length < 10) {
        result.push(describe(current));
        current = current.parentElement;
      }
      return result;
    };
    return {
      ...point,
      intersection,
      targetTag: target?.tagName.toLocaleLowerCase() ?? null,
      targetClassName: target
        ? (typeof target.className === "string" ? target.className : target.getAttribute("class"))
        : null,
      targetLandmarkTestId: targetLandmark?.getAttribute("data-testid") ?? null,
      titleContainsTarget: target ? title.contains(target) : false,
      hitStack: document.elementsFromPoint(point.x, point.y).slice(0, 12).map(describe),
      titleAncestry: ancestry(title),
      landmarkAncestry: ancestry(landmarkOwner),
    };
  }, { landmarkOwnerTestId: landmarkTestId, regionId: titleRegionId });
}

async function assertMenuPlacement(page, menu, pointer) {
  const bounds = await menu.boundingBox();
  assert(bounds, "The context menu has no screen geometry.");
  const viewport = page.viewportSize();
  assert(
    bounds.x >= 7 && bounds.y >= 7 && bounds.x + bounds.width <= viewport.width - 7 && bounds.y + bounds.height <= viewport.height - 7,
    `Context menu escaped the viewport: ${JSON.stringify(bounds)}.`,
  );
  const nearHorizontalEdge = Math.min(
    Math.abs(bounds.x - (pointer.x + 6)),
    Math.abs(bounds.x + bounds.width - (pointer.x - 6)),
  );
  const nearVerticalEdge = Math.min(
    Math.abs(bounds.y - (pointer.y + 6)),
    Math.abs(bounds.y + bounds.height - (pointer.y - 6)),
  );
  assert(
    nearHorizontalEdge <= 3 && nearVerticalEdge <= 3,
    `Context menu was detached from the pointer: pointer=${JSON.stringify(pointer)}, menu=${JSON.stringify(bounds)}.`,
  );
}

function slug(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

await assertHealthyServer();
const executablePath = await firstAvailable(edgeCandidates);
await mkdir(screenshotsDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
const interceptedMutations = [];
const unexpectedContentReads = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
  });
  await context.route("**/api/atlas*", async (route) => {
    if (route.request().method() === "GET") {
      await route.continue();
      return;
    }
    interceptedMutations.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "unavailable", message: "Ephemeral stress harness blocked persistence." } }),
    });
  });
  await context.route("**/api/content/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = new URL(request.url());
    if (method === "GET" || method === "HEAD") {
      if (requestUrl.pathname === "/api/content/tree") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: method === "HEAD" ? "" : JSON.stringify(fixtureContentTree),
        });
        return;
      }
      if (requestUrl.pathname === "/api/content/file") {
        const notePath = requestUrl.searchParams.get("path") ?? "";
        const markdown = fixtureNoteMarkdownByPath.get(notePath);
        if (markdown !== undefined) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: method === "HEAD" ? "" : JSON.stringify({
              path: notePath,
              markdown,
              revision: `canvas-stress-${notePath}`,
            }),
          });
          return;
        }
      }
      unexpectedContentReads.push({ method, url: request.url() });
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: method === "HEAD" ? "" : JSON.stringify({
          error: {
            code: "not_found",
            message: "The disposable canvas stress fixture has no matching content entry.",
          },
        }),
      });
      return;
    }
    interceptedMutations.push({ method, url: request.url() });
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "conflict", message: "Ephemeral stress harness blocked content mutation." } }),
    });
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(appUrl, { waitUntil: "networkidle" });

  const scenario = async (name, operation) => {
    const requestedScenario = process.env.MATH_ATLAS_STRESS_SCENARIO?.trim().toLocaleLowerCase();
    if (requestedScenario && !name.toLocaleLowerCase().includes(requestedScenario)) return;
    console.log(`[verify:canvas-stress] ${name}`);
    try {
      await resetFixture(page);
      await operation();
      results.push({ name, status: "pass" });
      console.log(`[verify:canvas-stress] PASS ${name}`);
    } catch (error) {
      const evidence = path.join(screenshotsDir, `usability-stress-failure-${slug(name)}.png`);
      await page.screenshot({ path: evidence, fullPage: true }).catch(() => undefined);
      results.push({
        name,
        status: "fail",
        error: error instanceof Error ? error.message : String(error),
        evidence,
      });
      console.error(`[verify:canvas-stress] FAIL ${name}: ${error instanceof Error ? error.message : error}`);
    } finally {
      await page.keyboard.up("Shift").catch(() => undefined);
      await page.keyboard.up("Control").catch(() => undefined);
      await page.keyboard.up("Alt").catch(() => undefined);
      await page.mouse.up().catch(() => undefined);
    }
  };

  await scenario("nested landmark drag isolation", async () => {
    const before = await canvasState(page);
    const frameDiagnostics = await group(page, ids.subject).evaluate((node) => {
      const shape = node.querySelector(".region-frame__shape");
      const regionId = node.getAttribute("data-testid")?.replace(/^group-/, "");
      const title = regionId ? document.querySelector(`[data-region-title="${regionId}"]`) : undefined;
      const icon = title?.querySelector(".region-frame__subject-icon");
      return {
        style: node.getAttribute("data-subject-frame-style"),
        decorationCount: node.querySelectorAll(".region-frame__subject-frame, .region-frame__subject-texture, linearGradient, pattern").length,
        fill: shape ? getComputedStyle(shape).fill : undefined,
        fillOpacity: shape ? Number.parseFloat(getComputedStyle(shape).fillOpacity) : 1,
        strokeOpacity: shape ? Number.parseFloat(getComputedStyle(shape).strokeOpacity) : 0,
        strokeWidth: shape ? Number.parseFloat(getComputedStyle(shape).strokeWidth) : 0,
        stroke: shape ? getComputedStyle(shape).stroke : undefined,
        titleTreatment: title?.getAttribute("data-title-treatment"),
        titleMinHeight: title ? Number.parseFloat(getComputedStyle(title).minHeight) : 0,
        icon: icon?.getAttribute("data-subject-icon"),
        iconWidth: icon ? Number.parseFloat(getComputedStyle(icon).width) : 0,
        iconHeight: icon ? Number.parseFloat(getComputedStyle(icon).height) : 0,
        iconSvg: Boolean(icon?.querySelector("svg")),
      };
    });
    assert(
        frameDiagnostics.style === "double-rule" &&
        frameDiagnostics.decorationCount === 0 &&
        frameDiagnostics.fill === "none" &&
        frameDiagnostics.fillOpacity === 0 &&
        frameDiagnostics.stroke === "rgb(77, 85, 94)" &&
        frameDiagnostics.strokeOpacity >= .5 &&
        frameDiagnostics.strokeWidth >= 1.5 &&
        frameDiagnostics.titleTreatment === "subject" &&
        frameDiagnostics.titleMinHeight >= 78 &&
        frameDiagnostics.icon === frameDiagnostics.style &&
        frameDiagnostics.iconWidth === 54 &&
        frameDiagnostics.iconHeight === 54 &&
        frameDiagnostics.iconSvg,
      `Subject cloud and icon title card do not match the neutral treatment: ${JSON.stringify(frameDiagnostics)}.`,
    );
    const subjectLandmarkBounds = await landmark(page, ids.d).boundingBox();
    assert(subjectLandmarkBounds, "The direct Subject landmark has no screen geometry.");
    const subjectLandmarkOwner = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        targetClass: typeof target?.className === "string" ? target.className : target?.getAttribute("class"),
        landmarkTestId: target?.closest("[data-testid^='landmark-']")?.getAttribute("data-testid"),
      };
    }, {
      x: subjectLandmarkBounds.x + subjectLandmarkBounds.width / 2,
      y: subjectLandmarkBounds.y + subjectLandmarkBounds.height / 2,
    });
    assert(
      subjectLandmarkOwner.landmarkTestId === `landmark-${ids.d}` &&
        !subjectLandmarkOwner.targetClass?.includes("region-frame__shape"),
      `Subject boundary displaced its landmark from pointer ownership: ${JSON.stringify(subjectLandmarkOwner)}.`,
    );
    await page.screenshot({ path: overviewScreenshot, fullPage: true });
    await dragLocatorGridOnly(page, landmark(page, ids.a), 112, 56, 12);
    const after = await waitForPosition(
      page,
      "landmarks",
      ids.a,
      before.landmarks[ids.a].x + 112,
      before.landmarks[ids.a].y + 56,
    );
    assertMoved(before, after, "landmarks", [ids.a], 112, 56);
    assertUnmoved(before, after, "landmarks", [ids.b, ids.c, ids.d]);
    assertUnmoved(before, after, "groups", [ids.subgroup, ids.group, ids.subject]);
  });

  await scenario("landmark and group drag release preserves viewport", async () => {
    const landmarkBefore = await canvasState(page);
    const landmarkViewport = await viewportState(page);
    const landmarkBounds = await landmark(page, ids.c).boundingBox();
    assert(landmarkBounds, "The viewport-invariant landmark has no screen geometry.");
    const landmarkStart = {
      x: landmarkBounds.x + landmarkBounds.width / 2,
      y: landmarkBounds.y + landmarkBounds.height / 2,
    };
    await page.mouse.move(landmarkStart.x, landmarkStart.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(landmarkStart.x + 84, landmarkStart.y - 28, { steps: 12 });
    assertViewportStable(
      landmarkViewport,
      await viewportState(page),
      "landmark pointer movement before release",
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    assertViewportStable(
      landmarkViewport,
      await viewportState(page),
      "landmark pointer-up",
    );
    await page.waitForTimeout(220);
    assertViewportStable(
      landmarkViewport,
      await viewportState(page),
      "landmark release settling",
    );
    await waitForPosition(
      page,
      "landmarks",
      ids.c,
      landmarkBefore.landmarks[ids.c].x + 84,
      landmarkBefore.landmarks[ids.c].y - 28,
    );

    const groupBefore = await canvasState(page);
    const groupViewport = await viewportState(page);
    const titleBounds = await groupTitle(page, ids.subgroup).boundingBox();
    assert(titleBounds, "The viewport-invariant group title has no screen geometry.");
    const titleStart = {
      x: titleBounds.x + titleBounds.width / 2,
      y: titleBounds.y + titleBounds.height / 2,
    };
    await page.mouse.move(titleStart.x, titleStart.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(titleStart.x + 56, titleStart.y + 28, { steps: 12 });
    assertViewportStable(
      groupViewport,
      await viewportState(page),
      "group pointer movement before release",
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    assertViewportStable(
      groupViewport,
      await viewportState(page),
      "group pointer-up",
    );
    await page.waitForTimeout(220);
    assertViewportStable(
      groupViewport,
      await viewportState(page),
      "group release settling",
    );
    await waitForPosition(
      page,
      "groups",
      ids.subgroup,
      groupBefore.groups[ids.subgroup].x + 56,
      groupBefore.groups[ids.subgroup].y + 28,
    );
  });

  await scenario("title-only nested group drags", async () => {
    let before = await canvasState(page);
    await dragLocatorGridOnly(page, groupTitle(page, ids.subgroup), 56, 28);
    let after = await waitForPosition(
      page,
      "groups",
      ids.subgroup,
      before.groups[ids.subgroup].x + 56,
      before.groups[ids.subgroup].y + 28,
    );
    assertMoved(before, after, "groups", [ids.subgroup], 56, 28);
    assertMoved(before, after, "landmarks", [ids.a, ids.b], 56, 28);
    assertUnmoved(before, after, "groups", [ids.group, ids.subject]);
    assertUnmoved(before, after, "landmarks", [ids.c, ids.d]);

    before = clone(after);
    await dragLocatorGridOnly(page, groupTitle(page, ids.group), -28, 56);
    after = await waitForPosition(
      page,
      "groups",
      ids.group,
      before.groups[ids.group].x - 28,
      before.groups[ids.group].y + 56,
    );
    assertMoved(before, after, "groups", [ids.group, ids.subgroup], -28, 56);
    assertMoved(before, after, "landmarks", [ids.a, ids.b, ids.c], -28, 56);
    assertUnmoved(before, after, "groups", [ids.subject]);
    assertUnmoved(before, after, "landmarks", [ids.d]);

    before = clone(after);
    await dragLocatorGridOnly(page, groupTitle(page, ids.subject), 28, -28);
    after = await waitForPosition(
      page,
      "groups",
      ids.subject,
      before.groups[ids.subject].x + 28,
      before.groups[ids.subject].y - 28,
    );
    assertMoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup], 28, -28);
    assertMoved(before, after, "landmarks", [ids.a, ids.b, ids.c, ids.d], 28, -28);
  });

  await scenario("group border hit and selection across zoom levels", async () => {
    const before = await canvasState(page);
    const zoomSamples = [];
    const verifyCurrentZoom = async (label) => {
      const viewport = await viewportState(page);
      assert(viewport, `The canvas viewport disappeared before the ${label} boundary probe.`);
      zoomSamples.push({ label, zoom: viewport.zoomX });
      for (const id of [ids.subject, ids.group, ids.subgroup]) {
        // Ten screen pixels off the painted centerline deliberately falls
        // outside the old 14px-total corridor. Keeping this offset in screen
        // space proves the practical boundary target survives every zoom tier,
        // including overview mode where the path used to be disabled entirely.
        const point = await expandedFrameBandPoint(
          page,
          `group-${id}`,
          "region-frame__hit-target",
          10,
        );
        assert(
          point,
          `${id} exposed no clickable boundary point during ${label} at zoom ${viewport.zoomX}: ${JSON.stringify(await frameHitDiagnostics(page, `group-${id}`))}.`,
        );
        await page.mouse.click(point.x, point.y);
        await waitForSelection(page, [], [id]);
      }
    };

    await verifyCurrentZoom("native zoom");
    const midZoom = await zoomOutCanvas(page, 3);
    assert(
      midZoom.zoomX > .45 && midZoom.zoomX < .7,
      `The mid-zoom boundary probe missed its useful range: ${JSON.stringify(midZoom)}.`,
    );
    await verifyCurrentZoom("mid zoom");
    const farZoom = await zoomOutCanvas(page, 4);
    assert(
      farZoom.zoomX > .2 && farZoom.zoomX <= .32,
      `The far-zoom boundary probe missed its useful range: ${JSON.stringify(farZoom)}.`,
    );
    await verifyCurrentZoom("far zoom");
    assert(
      zoomSamples[0].zoom > zoomSamples[1].zoom && zoomSamples[1].zoom > zoomSamples[2].zoom,
      `The group boundary probes did not cover descending zoom levels: ${JSON.stringify(zoomSamples)}.`,
    );
    await page.screenshot({ path: groupBoundaryZoomScreenshot, fullPage: true });
    const after = await canvasState(page);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup]);
    assertUnmoved(before, after, "landmarks", [ids.a, ids.b, ids.c, ids.d]);
  });

  await scenario("non-rectangular transparent corners do not own gestures", async () => {
    const before = await canvasState(page);
    await landmark(page, ids.b).click();
    await waitForSelection(page, [ids.b]);
    const corner = await transparentShapePoint(page, `landmark-${ids.corner}`);
    assert(
      corner,
      "The triangular landmark exposed no transparent point inside its layout bounds.",
    );
    assert(
      corner.target.landmarkTestId !== `landmark-${ids.corner}`,
      `The transparent corner resolved back to its landmark: ${JSON.stringify(corner)}.`,
    );

    await page.mouse.click(corner.x, corner.y);
    await page.waitForTimeout(100);
    let selection = await selectedStressObjects(page);
    assert(
      !selection.landmarks.includes(ids.corner),
      `Clicking the transparent corner selected the landmark: ${JSON.stringify(selection)}.`,
    );

    await dragFrom(
      page,
      { x: corner.x, y: corner.y },
      { x: corner.x + 56, y: corner.y - 28 },
      10,
    );
    await page.waitForTimeout(120);
    const after = await canvasState(page);
    selection = await selectedStressObjects(page);
    assert(
      !selection.landmarks.includes(ids.corner),
      `Dragging from the transparent corner selected the landmark: ${JSON.stringify(selection)}.`,
    );
    assertPosition(after.landmarks[ids.corner], before.landmarks[ids.corner], ids.corner);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup, ids.overlapGroup]);

    for (const id of [ids.group, ids.subgroup]) {
      const groupCorner = await transparentShapePoint(page, `group-${id}`);
      assert(groupCorner, `${id} exposed no transparent point inside its layout bounds.`);
      assert(
        groupCorner.target.groupTestId !== `group-${id}`,
        `${id} claimed its transparent corner after the boundary band was enlarged: ${JSON.stringify(groupCorner)}.`,
      );
    }
  });

  await scenario("landmarks own overlaps with group titles", async () => {
    const ownership = await overlapOwnershipPoint(
      page,
      `landmark-${ids.overlap}`,
      ids.overlapGroup,
    );
    assert(
      ownership && !ownership.missingOverlap,
      `The overlap fixture did not cover its group title: ${JSON.stringify(ownership)}.`,
    );
    assert(
      ownership.targetLandmarkTestId === `landmark-${ids.overlap}` && !ownership.titleContainsTarget,
      `The group title stole the overlap point: ${JSON.stringify(ownership)}.`,
    );

    await page.mouse.click(ownership.x, ownership.y);
    await waitForSelection(page, [ids.overlap]);
    const before = await canvasState(page);
    await dragFrom(
      page,
      { x: ownership.x, y: ownership.y },
      { x: ownership.x + 56, y: ownership.y + 28 },
      10,
    );
    const after = await waitForPosition(
      page,
      "landmarks",
      ids.overlap,
      before.landmarks[ids.overlap].x + 56,
      before.landmarks[ids.overlap].y + 28,
    );
    assertMoved(before, after, "landmarks", [ids.overlap], 56, 28);
    assertPosition(after.groups[ids.overlapGroup], before.groups[ids.overlapGroup], ids.overlapGroup);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup]);
    await page.screenshot({ path: geometryOwnershipScreenshot, fullPage: true });
  });

  await scenario("selection replace toggle and marquee", async () => {
    await landmark(page, ids.a).click();
    await waitForSelection(page, [ids.a]);
    await landmark(page, ids.b).click({ modifiers: ["Control"] });
    await waitForSelection(page, [ids.a, ids.b]);
    await landmark(page, ids.a).click({ modifiers: ["Control"] });
    await waitForSelection(page, [ids.b]);
    await landmark(page, ids.c).click();
    await waitForSelection(page, [ids.c]);

    const beforeEscape = await gestureDiagnostics(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(180);
    const afterFirstEscape = await gestureDiagnostics(page);
    if (afterFirstEscape.selection.landmarks.length || afterFirstEscape.selection.groups.length) {
      await page.screenshot({ path: selectionEscapeScreenshot, fullPage: true });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);
      const afterSecondEscape = await gestureDiagnostics(page);
      throw new Error(
        `Escape did not clear selection. Diagnostics: ${JSON.stringify({ beforeEscape, afterFirstEscape, afterSecondEscape })}. ` +
        `First-Escape evidence: ${selectionEscapeScreenshot}`,
      );
    }
    const [aBounds, bBounds] = await Promise.all([
      landmark(page, ids.a).boundingBox(),
      landmark(page, ids.b).boundingBox(),
    ]);
    assert(aBounds && bBounds, "Marquee fixtures are not visible.");
    const start = {
      x: Math.min(aBounds.x, bBounds.x) - 14,
      y: Math.min(aBounds.y, bBounds.y) - 14,
    };
    const end = {
      x: Math.max(aBounds.x + aBounds.width, bBounds.x + bBounds.width) + 14,
      y: Math.max(aBounds.y + aBounds.height, bBounds.y + bBounds.height) + 14,
    };
    const startTarget = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.className;
    }, start);
    assert(String(startTarget).includes("react-flow__pane"), `Marquee could not start on blank canvas (${String(startTarget)}).`);
    await dragFrom(page, start, end, 14);
    await waitForSelection(page, [ids.a, ids.b]);

    await page.mouse.click(start.x, start.y);
    await waitForSelection(page, []);

    const viewportBeforePan = await viewportState(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(start.x + 84, start.y + 56, { steps: 12 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(180);
    const viewportAfterPan = await viewportState(page);
    assert(viewportBeforePan && viewportAfterPan, "Right-button pan did not expose viewport state.");
    assert(
      Math.abs(viewportAfterPan.x - viewportBeforePan.x) > 20 ||
        Math.abs(viewportAfterPan.y - viewportBeforePan.y) > 20,
      `Right-button drag did not pan the canvas: before=${JSON.stringify(viewportBeforePan)}, after=${JSON.stringify(viewportAfterPan)}.`,
    );
    assert(
      await page.getByRole("dialog", { name: "Create map object", exact: true }).count() === 0,
      "Right-button panning opened the creation menu.",
    );

    const creationPoint = await page.evaluate(() => {
      const pane = document.querySelector(".react-flow__pane");
      const bounds = pane?.getBoundingClientRect();
      if (!pane || !bounds) return undefined;
      for (let row = 1; row <= 11; row += 1) {
        for (let column = 1; column <= 11; column += 1) {
          const x = bounds.left + bounds.width * column / 12;
          const y = bounds.top + bounds.height * row / 12;
          const target = document.elementFromPoint(x, y);
          if (target === pane || target?.classList.contains("react-flow__pane")) return { x, y };
        }
      }
      return undefined;
    });
    assert(creationPoint, "No blank canvas point remained for the stationary right-click probe.");
    await page.mouse.click(creationPoint.x, creationPoint.y, { button: "right" });
    const creationMenu = page.getByRole("dialog", { name: "Create map object", exact: true });
    await creationMenu.waitFor();
    await page.keyboard.press("Escape");
    await creationMenu.waitFor({ state: "detached" });
  });

  await scenario("magnetic alignment guides, group centring, and precision bypass", async () => {
    const before = await canvasState(page);

    // Approach A's bottom port from just outside its acquisition radius. The
    // two landmarks deliberately live in different nested groups: their authored
    // arrow, not an unrelated frame, must own this alignment decision.
    let start = await beginLocatorDrag(page, landmark(page, ids.c));
    await moveOpenDrag(page, start, 146, 0, 14);
    await waitFor(page, async () => {
      const x = page.getByTestId("alignment-guide-x");
      return await x.count() === 1;
    }, "Peer alignment did not expose its live drafting guide.");
    const [aGeometry, alignedGeometry] = await Promise.all([
      objectScreenGeometry(page, `landmark-${ids.a}`),
      objectScreenGeometry(page, `landmark-${ids.c}`),
    ]);
    assert(aGeometry && alignedGeometry, "Aligned landmarks lost their screen geometry.");
    assert(
      Math.abs(alignedGeometry.left - aGeometry.left) <= .8 &&
        alignedGeometry.top > aGeometry.bottom + 80,
      `Peer magnets did not align exactly: target=${JSON.stringify(aGeometry)}, moving=${JSON.stringify(alignedGeometry)}.`,
    );
    const peerGuide = page.getByTestId("alignment-guide-x");
    assert(
      await peerGuide.getAttribute("data-guide-targets") === ids.a,
      "The vertical guide did not identify the aligned peer.",
    );
    assert(
      await peerGuide.getAttribute("data-guide-kind") === "connection" &&
        await peerGuide.getAttribute("data-moving-anchor") === "connection-port",
      "The existing arrow did not own the exact port-alignment magnet.",
    );
    assert(
      await page.locator("[data-guide-kind='containment']").count() === 0,
      "An unrelated parent-frame guide appeared beside the active arrow alignment.",
    );
    const arrow = await edgeScreenEndpoints(page, alignmentConnectionId);
    assert(
      arrow && Math.abs(arrow.source.x - arrow.target.x) <= .65,
      `The boxes aligned but their arrow remained bent: ${JSON.stringify(arrow)}.`,
    );
    const [sourcePortBounds, targetPortBounds] = await Promise.all([
      landmark(page, ids.a).locator(".atlas-port--bottom").boundingBox(),
      landmark(page, ids.c).locator(".atlas-port--top").boundingBox(),
    ]);
    assert(sourcePortBounds && targetPortBounds, "Aligned arrow ports disappeared during movement.");
    const sourcePort = {
      x: sourcePortBounds.x + sourcePortBounds.width / 2,
      y: sourcePortBounds.y + sourcePortBounds.height / 2,
    };
    const targetPort = {
      x: targetPortBounds.x + targetPortBounds.width / 2,
      y: targetPortBounds.y + targetPortBounds.height / 2,
    };
    assert(
      Math.abs(arrow.source.x - sourcePort.x) <= 1.5 &&
        Math.abs(arrow.source.y - sourcePort.y) <= 1.5 &&
        Math.abs(arrow.target.x - targetPort.x) <= 1.5 &&
        Math.abs(arrow.target.y - targetPort.y) <= 1.5,
      `The straight arrow did not terminate on its visible side dots: ${JSON.stringify({ arrow, sourcePort, targetPort })}.`,
    );
    const guidePointerEvents = await page.getByTestId("canvas-alignment-guides").evaluate((node) => (
      getComputedStyle(node).pointerEvents
    ));
    assert(guidePointerEvents === "none", "Drafting guides can intercept canvas pointers.");
    await page.screenshot({ path: movementGuidesScreenshot, fullPage: true });
    await page.mouse.up();
    await waitForPosition(page, "landmarks", ids.c, 420, 560);
    const settledArrow = await edgeScreenEndpoints(page, alignmentConnectionId);
    assert(
      settledArrow && Math.abs(settledArrow.source.x - settledArrow.target.x) <= .65,
      `The arrow lost exact alignment after release: ${JSON.stringify(settledArrow)}.`,
    );
    await waitFor(page, async () => (
      await page.getByTestId("canvas-alignment-guides").count() === 0
    ), "Drafting guides remained after pointer release.");

    await page.keyboard.press("Control+z");
    await waitForPosition(
      page,
      "landmarks",
      ids.c,
      before.landmarks[ids.c].x,
      before.landmarks[ids.c].y,
    );

    // The subgroup's exact centre is half a dot column for this landmark.
    // Smart centring is allowed to override the grid so the margins are truly
    // equal rather than merely close.
    start = await beginLocatorDrag(page, landmark(page, ids.c));
    await moveOpenDrag(page, start, 243, -190, 14);
    await waitFor(page, async () => {
      const guides = page.locator("[data-guide-kind='containment']");
      return await guides.count() === 2;
    }, "Group centring did not expose two containment guides.");
    const [subgroupGeometry, centredGeometry] = await Promise.all([
      objectScreenGeometry(page, `group-${ids.subgroup}`),
      objectScreenGeometry(page, `landmark-${ids.c}`),
    ]);
    assert(subgroupGeometry && centredGeometry, "Centred group geometry disappeared.");
    const expectedCentre = {
      left: subgroupGeometry.left + (subgroupGeometry.width - centredGeometry.width) / 2,
      top: subgroupGeometry.top + (subgroupGeometry.height - centredGeometry.height) / 2,
    };
    assert(
      Math.abs(centredGeometry.left - expectedCentre.left) <= .8 &&
        Math.abs(centredGeometry.top - expectedCentre.top) <= .8,
      `Group centre was approximate rather than exact: expected=${JSON.stringify(expectedCentre)}, actual=${JSON.stringify(centredGeometry)}.`,
    );
    await page.mouse.up();
    await waitForPosition(page, "landmarks", ids.c, 518, 364);

    await page.keyboard.press("Control+z");
    await waitForPosition(
      page,
      "landmarks",
      ids.c,
      before.landmarks[ids.c].x,
      before.landmarks[ids.c].y,
    );

    // Alt keeps ordinary dot-grid settling but suppresses every smart guide.
    start = await beginLocatorDrag(page, landmark(page, ids.c));
    await page.keyboard.down("Alt");
    await moveOpenDrag(page, start, 243, -190, 14);
    assert(
      await page.getByTestId("canvas-alignment-guides").count() === 0,
      "Alt precision bypass still displayed a smart guide.",
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await waitForPosition(page, "landmarks", ids.c, 532, 364);
  });

  await scenario("Shift locks movement to the dominant axis", async () => {
    const before = await canvasState(page);
    const start = await beginLocatorDrag(page, landmark(page, ids.c));
    await page.keyboard.down("Shift");
    await moveOpenDrag(page, start, 112, 84, 12);
    await waitFor(page, async () => {
      const guide = page.getByTestId("alignment-guide-y");
      return await guide.count() === 1 &&
        await guide.getAttribute("data-guide-targets") === "axis-lock";
    }, "Shift did not expose the dominant-axis constraint.");
    const live = await objectScreenGeometry(page, `landmark-${ids.c}`);
    const original = before.landmarks[ids.c];
    assert(live, "The axis-locked landmark disappeared during movement.");
    const viewport = await viewportState(page);
    assert(viewport, "The viewport disappeared during axis locking.");
    const expectedTop = original.y * viewport.zoomY + viewport.y;
    assert(
      Math.abs(live.top - expectedTop) <= .8,
      `Shift allowed perpendicular movement: expected top ${expectedTop}, actual ${live.top}.`,
    );
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return state.landmarks[ids.c]?.y === original.y ? state : false;
    }, "The axis-locked drop changed its perpendicular coordinate.");
  });

  await scenario("mixed landmark and group selection drags as one unit", async () => {
    await landmark(page, ids.a).click();
    await landmark(page, ids.overlap).click({ modifiers: ["Control"] });
    await hideSidebars(page);
    const groupBoundary = await exposedFramePoint(
      page,
      `group-${ids.overlapGroup}`,
      "region-frame__hit-target",
    );
    assert(groupBoundary, "The mixed-selection group exposes no clickable boundary point.");
    await page.keyboard.down("Control");
    await page.mouse.click(groupBoundary.x, groupBoundary.y);
    await page.keyboard.up("Control");
    await waitForSelection(page, [ids.a, ids.overlap], [ids.overlapGroup]);

    const before = await canvasState(page);
    const selectedBefore = [
      before.landmarks[ids.a],
      before.landmarks[ids.overlap],
      before.groups[ids.overlapGroup],
    ];
    const relativeBefore = selectedBefore.slice(1).map((position) => ({
      x: position.x - selectedBefore[0].x,
      y: position.y - selectedBefore[0].y,
    }));
    const delta = { x: 84, y: -56 };

    await dragLocatorGridOnly(page, landmark(page, ids.a), delta.x, delta.y, 12);
    await waitForPosition(
      page,
      "landmarks",
      ids.a,
      before.landmarks[ids.a].x + delta.x,
      before.landmarks[ids.a].y + delta.y,
    );
    let latestLandmarkPrimary;
    try {
      await waitFor(page, async () => {
        const state = await canvasState(page);
        latestLandmarkPrimary = state;
        return state.landmarks[ids.overlap]?.x === before.landmarks[ids.overlap].x + delta.x &&
          state.landmarks[ids.overlap]?.y === before.landmarks[ids.overlap].y + delta.y &&
          state.groups[ids.overlapGroup]?.x === before.groups[ids.overlapGroup].x + delta.x &&
          state.groups[ids.overlapGroup]?.y === before.groups[ids.overlapGroup].y + delta.y
          ? state
          : false;
      }, "The mixed selection did not settle at one shared snapped drag delta.");
    } catch (cause) {
      throw new Error(
        `The landmark-primary mixed drag diverged: before=${JSON.stringify(before)}, latest=${JSON.stringify(latestLandmarkPrimary)}.`,
        { cause },
      );
    }
    const after = await canvasState(page);

    assertMoved(before, after, "landmarks", [ids.a, ids.overlap], delta.x, delta.y);
    assertMoved(before, after, "groups", [ids.overlapGroup], delta.x, delta.y);
    assertUnmoved(before, after, "landmarks", [
      ids.b,
      ids.c,
      ids.d,
      ids.corner,
      ids.content,
    ]);
    assertUnmoved(before, after, "groups", [
      ids.subject,
      ids.group,
      ids.subgroup,
    ]);
    const selectedAfter = [
      after.landmarks[ids.a],
      after.landmarks[ids.overlap],
      after.groups[ids.overlapGroup],
    ];
    const relativeAfter = selectedAfter.slice(1).map((position) => ({
      x: position.x - selectedAfter[0].x,
      y: position.y - selectedAfter[0].y,
    }));
    assert(
      JSON.stringify(relativeAfter) === JSON.stringify(relativeBefore),
      `The mixed selection changed its internal layout: before=${JSON.stringify(relativeBefore)}, after=${JSON.stringify(relativeAfter)}.`,
    );
    await waitForSelection(page, [ids.a, ids.overlap], [ids.overlapGroup]);
    await page.screenshot({ path: mixedSelectionDragScreenshot, fullPage: true });

    await page.keyboard.press("Control+z");
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return state.landmarks[ids.a]?.x === before.landmarks[ids.a].x &&
        state.landmarks[ids.a]?.y === before.landmarks[ids.a].y &&
        state.landmarks[ids.overlap]?.x === before.landmarks[ids.overlap].x &&
        state.landmarks[ids.overlap]?.y === before.landmarks[ids.overlap].y &&
        state.groups[ids.overlapGroup]?.x === before.groups[ids.overlapGroup].x &&
        state.groups[ids.overlapGroup]?.y === before.groups[ids.overlapGroup].y
        ? state
        : false;
    }, "One Ctrl+Z did not restore the complete mixed-selection move.");
    const undone = await canvasState(page);
    assertUnmoved(before, undone, "landmarks", [
      ids.a,
      ids.b,
      ids.c,
      ids.d,
      ids.corner,
      ids.overlap,
      ids.content,
    ]);
    assertUnmoved(before, undone, "groups", [
      ids.subject,
      ids.group,
      ids.subgroup,
      ids.overlapGroup,
    ]);

    // Exercise the custom group-title gesture as the primary owner too. It
    // must use the same mixed-selection closure as a native landmark drag,
    // including a selected landmark that is outside the group's hierarchy.
    await page.keyboard.press("Escape");
    await waitForSelection(page, []);
    await landmark(page, ids.a).click();
    await landmark(page, ids.b).click({ modifiers: ["Control"] });
    await landmark(page, ids.c).click({ modifiers: ["Control"] });
    await hideSidebars(page);
    await groupTitle(page, ids.subgroup).click({ modifiers: ["Control"] });
    await waitForSelection(page, [ids.a, ids.b, ids.c], [ids.subgroup]);

    const beforeGroupPrimary = await canvasState(page);
    const groupDelta = { x: -56, y: 56 };
    await dragLocatorGridOnly(
      page,
      groupTitle(page, ids.subgroup),
      groupDelta.x,
      groupDelta.y,
      12,
    );
    await waitForPosition(
      page,
      "groups",
      ids.subgroup,
      beforeGroupPrimary.groups[ids.subgroup].x + groupDelta.x,
      beforeGroupPrimary.groups[ids.subgroup].y + groupDelta.y,
    );
    let latestGroupPrimary;
    try {
      await waitFor(page, async () => {
        const state = await canvasState(page);
        latestGroupPrimary = state;
        return [ids.a, ids.b, ids.c].every((id) => (
          state.landmarks[id]?.x === beforeGroupPrimary.landmarks[id].x + groupDelta.x &&
          state.landmarks[id]?.y === beforeGroupPrimary.landmarks[id].y + groupDelta.y
        )) ? state : false;
      }, "Dragging a selected group title did not move every selected landmark by the same delta.");
    } catch (cause) {
      throw new Error(
        `The group-primary mixed drag diverged: before=${JSON.stringify(beforeGroupPrimary)}, latest=${JSON.stringify(latestGroupPrimary)}.`,
        { cause },
      );
    }
    const afterGroupPrimary = await canvasState(page);
    assertMoved(
      beforeGroupPrimary,
      afterGroupPrimary,
      "landmarks",
      [ids.a, ids.b, ids.c],
      groupDelta.x,
      groupDelta.y,
    );
    assertMoved(
      beforeGroupPrimary,
      afterGroupPrimary,
      "groups",
      [ids.subgroup],
      groupDelta.x,
      groupDelta.y,
    );
    assertUnmoved(beforeGroupPrimary, afterGroupPrimary, "landmarks", [
      ids.d,
      ids.corner,
      ids.overlap,
      ids.content,
    ]);
    assertUnmoved(beforeGroupPrimary, afterGroupPrimary, "groups", [
      ids.subject,
      ids.group,
      ids.overlapGroup,
    ]);
    await waitForSelection(page, [ids.a, ids.b, ids.c], [ids.subgroup]);
    await page.screenshot({ path: mixedSelectionDragScreenshot, fullPage: true });

    await page.keyboard.press("Control+z");
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return [ids.a, ids.b, ids.c].every((id) => (
        state.landmarks[id]?.x === beforeGroupPrimary.landmarks[id].x &&
        state.landmarks[id]?.y === beforeGroupPrimary.landmarks[id].y
      )) &&
        state.groups[ids.subgroup]?.x === beforeGroupPrimary.groups[ids.subgroup].x &&
        state.groups[ids.subgroup]?.y === beforeGroupPrimary.groups[ids.subgroup].y
        ? state
        : false;
    }, "One Ctrl+Z did not restore the complete group-primary mixed move.");
    const groupPrimaryUndone = await canvasState(page);
    assertUnmoved(beforeGroupPrimary, groupPrimaryUndone, "landmarks", [
      ids.a,
      ids.b,
      ids.c,
      ids.d,
      ids.corner,
      ids.overlap,
      ids.content,
    ]);
    assertUnmoved(beforeGroupPrimary, groupPrimaryUndone, "groups", [
      ids.subject,
      ids.group,
      ids.subgroup,
      ids.overlapGroup,
    ]);
  });

  await scenario("right-click selection menu placement and Escape", async () => {
    const bounds = await landmark(page, ids.b).boundingBox();
    assert(bounds, "The right-click landmark is not visible.");
    const pointer = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.click(pointer.x, pointer.y, { button: "right" });
    await waitForSelection(page, [ids.b]);
    let menu = page.getByRole("dialog", { name: "Edit Nested beta", exact: true });
    await menu.waitFor();
    await assertMenuPlacement(page, menu, pointer);
    await page.screenshot({ path: menuScreenshot, fullPage: true });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    const groupPointer = await exposedFramePoint(
      page,
      `group-${ids.subgroup}`,
      "region-frame__hit-target",
    );
    assert(groupPointer, "The subgroup exposes no right-click border point.");
    await page.mouse.click(groupPointer.x, groupPointer.y, { button: "right" });
    await waitForSelection(page, [], [ids.subgroup]);
    menu = page.getByRole("dialog", { name: "Edit Stress subgroup", exact: true });
    await menu.waitFor();
    await assertMenuPlacement(page, menu, groupPointer);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  });

  await scenario("Escape cancels group and connection gestures", async () => {
    const before = await canvasState(page);
    const titleBounds = await groupTitle(page, ids.subgroup).boundingBox();
    assert(titleBounds, "The subgroup title is not draggable.");
    const titleStart = {
      x: titleBounds.x + titleBounds.width / 2,
      y: titleBounds.y + titleBounds.height / 2,
    };
    await page.mouse.move(titleStart.x, titleStart.y);
    await page.mouse.down();
    await page.mouse.move(titleStart.x + 112, titleStart.y + 56, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(120);
    let after = await canvasState(page);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup]);
    assertUnmoved(before, after, "landmarks", [ids.a, ids.b, ids.c, ids.d]);

    const source = landmark(page, ids.a).locator(".atlas-port--right");
    const target = landmark(page, ids.b).locator(".atlas-port--left");
    const [sourceBounds, targetBounds] = await Promise.all([source.boundingBox(), target.boundingBox()]);
    assert(sourceBounds && targetBounds, "Connection ports are not visible.");
    const sourcePoint = { x: sourceBounds.x + sourceBounds.width / 2, y: sourceBounds.y + sourceBounds.height / 2 };
    const targetPoint = { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height / 2 };
    await page.mouse.move(sourcePoint.x, sourcePoint.y);
    await page.mouse.down();
    await page.mouse.move((sourcePoint.x + targetPoint.x) / 2, (sourcePoint.y + targetPoint.y) / 2, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    after = await canvasState(page);
    assert(
      after.customConnections.length === fixture.customConnections.length,
      "Escape cancellation committed a stray connection.",
    );
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup]);
    assertUnmoved(before, after, "landmarks", [ids.a, ids.b, ids.c, ids.d]);
  });

  await scenario("multi-delete and one-step undo", async () => {
    await landmark(page, ids.a).click();
    await landmark(page, ids.b).click({ modifiers: ["Control"] });
    await waitForSelection(page, [ids.a, ids.b]);
    await page.keyboard.press("Delete");
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return !state.landmarkIds.includes(ids.a) && !state.landmarkIds.includes(ids.b) ? state : false;
    }, "Delete did not remove both selected landmarks.");
    assert(await landmark(page, ids.c).count() === 1, "Delete removed an unselected landmark.");
    await page.keyboard.press("Control+z");
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return [ids.a, ids.b, ids.c, ids.d].every((id) => state.landmarkIds.includes(id)) ? state : false;
    }, "One Ctrl+Z did not restore the complete deletion batch.");
    await landmark(page, ids.a).waitFor();
    await landmark(page, ids.b).waitFor();
  });

  await scenario("ports and resizers isolate drag ownership", async () => {
    let before = await canvasState(page);
    const port = landmark(page, ids.a).locator(".atlas-port--right");
    const portBounds = await port.boundingBox();
    assert(portBounds, "The landmark port is not visible.");
    const portPoint = { x: portBounds.x + portBounds.width / 2, y: portBounds.y + portBounds.height / 2 };
    await dragFrom(page, portPoint, { x: portPoint.x + 70, y: portPoint.y + 45 });
    await page.waitForTimeout(100);
    let after = await canvasState(page);
    assert(
      after.customConnections.length === fixture.customConnections.length,
      "A blank-space port drag created a connection.",
    );
    assertUnmoved(before, after, "landmarks", [ids.a, ids.b, ids.c, ids.d]);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup]);
    // Move off the enlarged port acquisition disc before probing the same
    // contour. Hover expansion must not make the adjacent resize border look
    // absent to the hit-test sampler.
    await page.mouse.move(18, 18);
    await page.waitForTimeout(80);

    before = clone(after);
    const landmarkResize = await exposedFramePoint(
      page,
      `landmark-${ids.a}`,
      "landmark-node__resize-target",
      "right",
    );
    assert(landmarkResize, "The landmark frame exposes no resize hit point.");
    await dragFrom(page, landmarkResize, { x: landmarkResize.x + 56, y: landmarkResize.y });
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return state.landmarks[ids.a]?.width !== before.landmarks[ids.a].width ? state : false;
    }, "The landmark resize handle did not resize.");
    after = await canvasState(page);
    assertPosition(after.landmarks[ids.a], before.landmarks[ids.a], ids.a);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup]);

    // Selecting/resizing a landmark intentionally opens its note. Recover the
    // full canvas before probing the requested right contour of the group.
    await hideSidebars(page);
    await group(page, ids.group).waitFor({ state: "visible", timeout: 7_000 });
    before = clone(after);
    const groupResize = await exposedFramePoint(
      page,
      `group-${ids.group}`,
      "region-frame__hit-target",
      "right",
    );
    assert(
      groupResize,
      `The group frame exposes no resize hit point: ${JSON.stringify(await frameHitDiagnostics(page, `group-${ids.group}`))}.`,
    );
    await dragFrom(page, groupResize, { x: groupResize.x + 56, y: groupResize.y });
    await waitFor(page, async () => {
      const state = await canvasState(page);
      return state.groups[ids.group]?.width !== before.groups[ids.group].width ? state : false;
    }, "The group border did not resize.");
    after = await canvasState(page);
    assertPosition(after.groups[ids.group], before.groups[ids.group], ids.group);
    assertUnmoved(before, after, "landmarks", [ids.a, ids.b, ids.c, ids.d]);
    assertUnmoved(before, after, "groups", [ids.subject, ids.subgroup]);
    assert(
      !(await page.getByTestId("atlas-graph").getAttribute("class")).includes("is-node-dragging"),
      "A port or resizer left the canvas in node-dragging state.",
    );
  });

  await scenario("landmark border resize tracks every pointer sample", async () => {
    const before = await canvasState(page);
    const targetId = ids.a;
    const resizeZoom = await zoomOutCanvas(page, 3);
    assert(
      resizeZoom.zoomX > .45 && resizeZoom.zoomX < .7,
      `The landmark resize probe did not reach a useful fractional zoom: ${JSON.stringify(resizeZoom)}.`,
    );
    const resizePoint = await exposedFramePoint(
      page,
      `landmark-${targetId}`,
      "landmark-node__resize-target",
      "right",
    );
    assert(
      resizePoint,
      `The landmark exposes no right resize contour: ${JSON.stringify(await frameHitDiagnostics(page, `landmark-${targetId}`))}.`,
    );
    const trace = await traceRightBorderResize(page, {
      testId: `landmark-${targetId}`,
      resizePoint,
      original: before.landmarks[targetId],
      label: "Landmark border resize",
    });
    const after = await canvasState(page);
    assertPosition(after.landmarks[targetId], trace.finalExpected, targetId);
    assertUnmoved(before, after, "landmarks", [ids.b, ids.c, ids.d, ids.corner, ids.overlap, ids.content]);
    assertUnmoved(before, after, "groups", [ids.subject, ids.group, ids.subgroup, ids.overlapGroup]);
  });

  await scenario("group border resize tracks every pointer sample", async () => {
    const before = await canvasState(page);
    const targetId = ids.group;
    const resizeZoom = await zoomOutCanvas(page, 3);
    assert(
      resizeZoom.zoomX > .45 && resizeZoom.zoomX < .7,
      `The group resize probe did not reach a useful fractional zoom: ${JSON.stringify(resizeZoom)}.`,
    );
    const resizePoint = await exposedFramePoint(
      page,
      `group-${targetId}`,
      "region-frame__hit-target",
      "right",
    );
    assert(
      resizePoint,
      `The group exposes no right resize contour: ${JSON.stringify(await frameHitDiagnostics(page, `group-${targetId}`))}.`,
    );
    const trace = await traceRightBorderResize(page, {
      testId: `group-${targetId}`,
      resizePoint,
      original: before.groups[targetId],
      label: "Group border resize",
    });
    const after = await canvasState(page);
    assertPosition(after.groups[targetId], trace.finalExpected, targetId);
    assertUnmoved(before, after, "groups", [ids.subject, ids.subgroup, ids.overlapGroup]);
    assertUnmoved(before, after, "landmarks", [
      ids.a,
      ids.b,
      ids.c,
      ids.d,
      ids.corner,
      ids.overlap,
      ids.content,
    ]);
  });

  await scenario("content landmark ornaments stay in the frame band", async () => {
    await waitFor(page, async () => {
      const state = await renderedLandmarkContent(page, ids.content);
      return state?.text.includes("Synthetic boundary") ? state : false;
    }, "The content-mode landmark did not render its Markdown preview.", 12_000);
    const decoration = await landmarkDecorationGeometry(page, ids.content);
    assert(decoration, "The content-mode landmark exposes no decoration geometry.");
    assert(
      decoration.samples.length >= 16,
      `The content-mode landmark lost its framed ornament: ${JSON.stringify(decoration)}.`,
    );
    const interiorSamples = decoration.samples.filter(({ edgeDepth }) => edgeDepth > 16.5);
    assert(
      interiorSamples.length === 0,
      `Landmark ornaments entered the text interior instead of following the frame: ${JSON.stringify(interiorSamples.slice(0, 12))}.`,
    );
    assert(
      decoration.documentBounds.left > decoration.ownerBounds.left + 8 &&
        decoration.documentBounds.right < decoration.ownerBounds.right - 8,
      `The Markdown content box is not inset from the decorated frame: ${JSON.stringify(decoration)}.`,
    );
    await landmark(page, ids.content).screenshot({ path: contentFrameScreenshot });
  });

  await scenario("compiled formula choice persists across content modes", async () => {
    const target = landmark(page, ids.content);
    const bounds = await target.boundingBox();
    assert(bounds, "The formula-choice landmark is not visible.");
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      { button: "right" },
    );

    const menu = page.getByRole("dialog", { name: "Edit Synthetic boundary", exact: true });
    await menu.waitFor();
    await menu.getByRole("tab", { name: "Content", exact: true }).click();
    await menu.getByRole("button", { name: "Formula", exact: true }).click();

    let picker = menu.getByRole("group", {
      name: "Formula shown on landmark",
      exact: true,
    });
    await picker.waitFor({ timeout: 12_000 });
    let choices = picker.locator(".map-landmark-formula-picker__option");
    assert(
      await choices.count() === 2,
      `Synthetic boundary exposed ${await choices.count()} formula choices instead of two substantive display equations.`,
    );
    const first = picker.getByRole("button", { name: "Formula 1", exact: true });
    const second = picker.getByRole("button", { name: "Formula 2", exact: true });
    assert(
      await first.getAttribute("aria-pressed") === "true" &&
        await second.getAttribute("aria-pressed") === "false",
      "The first compiled formula was not the initial picker selection.",
    );
    assert(
      await first.locator(".katex").count() === 1 &&
        await second.locator(".katex").count() === 1,
      "The equation picker exposed raw or uncompiled formula choices.",
    );
    // Opening a note can materialize the inspector and temporarily virtualize
    // a landmark that was near the former right edge. Hide it without a
    // synthetic pointer-down so the contextual picker stays open, then verify
    // the actual canvas preview rather than only the palette state.
    const hideInspector = page.getByRole("button", { name: "Close note sidebar", exact: true });
    if (await hideInspector.count()) {
      await hideInspector.evaluate((button) => button.click());
      await landmark(page, ids.content).waitFor({ timeout: 12_000 });
    }
    const firstRendered = await waitFor(page, async () => {
      const rendered = await renderedLandmarkFormula(page, ids.content);
      return rendered?.visibleText ? rendered : false;
    }, "The landmark did not render its initially selected compiled formula.", 12_000);

    await second.click();
    const secondRendered = await waitFor(page, async () => {
      const rendered = await renderedLandmarkFormula(page, ids.content);
      const selected = await second.getAttribute("aria-pressed");
      const stored = await storedLandmarkFormulaIndex(page, ids.content);
      return rendered && selected === "true" && stored === 1 &&
        rendered.visibleText !== firstRendered.visibleText && rendered.visibleText.includes("min")
        ? rendered
        : false;
    }, "Choosing Formula 2 did not update and persist the landmark preview.", 12_000);

    await menu.getByRole("button", { name: "Statement", exact: true }).click();
    await picker.waitFor({ state: "detached" });
    assert(
      await storedLandmarkFormulaIndex(page, ids.content) === 1,
      "Switching away from formula mode discarded the chosen equation.",
    );

    await menu.getByRole("button", { name: "Formula", exact: true }).click();
    picker = menu.getByRole("group", {
      name: "Formula shown on landmark",
      exact: true,
    });
    await picker.waitFor({ timeout: 12_000 });
    choices = picker.locator(".map-landmark-formula-picker__option");
    assert(await choices.count() === 2, "The restored formula picker changed its candidate set.");
    const restoredSecond = picker.getByRole("button", { name: "Formula 2", exact: true });
    await waitFor(page, async () => {
      const rendered = await renderedLandmarkFormula(page, ids.content);
      return await restoredSecond.getAttribute("aria-pressed") === "true" &&
        rendered?.visibleText === secondRendered.visibleText
        ? rendered
        : false;
    }, "Formula 2 was not restored after switching back to formula mode.", 12_000);
    await page.screenshot({ path: formulaPickerScreenshot, fullPage: true });
  });

  await scenario("embedded Markdown stays rendered through far zoom", async () => {
    const initial = await waitFor(page, async () => {
      const state = await renderedLandmarkContent(page, ids.content);
      return state?.text.includes("Synthetic boundary") ? state : false;
    }, "The embedded Markdown was not ready before zooming.", 12_000);
    await landmark(page, ids.content).evaluate((owner) => {
      owner.querySelector(".landmark-node__document")
        ?.setAttribute("data-stress-content-probe", "same-document-node");
    });

    const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
    const zoomSamples = [];
    const startedAt = performance.now();
    let previousViewport = await viewportState(page);
    assert(previousViewport, "The canvas viewport was unavailable before the content zoom probe.");
    for (let index = 0; index < 24; index += 1) {
      const viewport = await settledZoomOutStep(
        page,
        zoomOut,
        previousViewport,
        `Content zoom-out step ${index + 1}`,
      );
      const content = await renderedLandmarkContent(page, ids.content);
      assert(content, `The embedded Markdown left the DOM at zoom ${viewport.zoomX}.`);
      assert(
        content.probe === "same-document-node",
        `Zoom ${viewport.zoomX} replaced the embedded Markdown document node instead of retaining it.`,
      );
      for (const [part, geometry] of Object.entries({
        document: content.document,
        preview: content.preview,
        markdown: content.markdown,
      })) {
        assert(
          geometry.display !== "none" && geometry.visibility === "visible" &&
            geometry.opacity > 0 && geometry.rects > 0 && geometry.width > 0 && geometry.height > 0,
          `Embedded Markdown ${part} disappeared at zoom ${viewport.zoomX}: ${JSON.stringify(content)}.`,
        );
      }
      assert(
        content.text === initial.text,
        `Embedded Markdown text changed while zooming: before=${JSON.stringify(initial.text)}, after=${JSON.stringify(content.text)}.`,
      );
      assert(
        content.domNodes >= initial.domNodes,
        `Semantic zoom discarded rendered Markdown nodes: before=${initial.domNodes}, after=${content.domNodes}.`,
      );
      zoomSamples.push({ viewport, content });
      previousViewport = viewport;
      if (content.zoomTier === "is-zoom-far") break;
    }
    const elapsedMs = performance.now() - startedAt;
    const final = zoomSamples.at(-1);
    assert(
      final?.content.zoomTier === "is-zoom-far" && final.viewport.zoomX <= .32,
      `The far-zoom regression never reached the far tier: ${JSON.stringify(zoomSamples.map(({ viewport, content }) => ({ zoom: viewport.zoomX, tier: content.zoomTier })))}.`,
    );
    assert(
      elapsedMs < 8_000,
      `Keeping embedded Markdown rendered made ${zoomSamples.length} zoom steps take ${elapsedMs.toFixed(0)}ms.`,
    );
    await page.screenshot({ path: contentZoomScreenshot, fullPage: true });
  });

  await scenario("group resize is continuous and Escape-safe", async () => {
    const before = await canvasState(page);
    const targetId = ids.group;
    const initialBounds = await group(page, targetId).boundingBox();
    assert(initialBounds, "The resize fixture has no screen geometry.");
    const resizePoint = await exposedFramePoint(
      page,
      `group-${targetId}`,
      "region-frame__hit-target",
      "right",
    );
    assert(
      resizePoint,
      `The group exposes no right resize contour: ${JSON.stringify(await frameHitDiagnostics(page, `group-${targetId}`))}.`,
    );

    const pointerDelta = 43;
    const original = before.groups[targetId];
    const expectedWidth = original.width + pointerDelta;
    await page.mouse.move(resizePoint.x, resizePoint.y);
    await page.mouse.down();
    await page.mouse.move(resizePoint.x + pointerDelta, resizePoint.y, { steps: 8 });

    const liveBounds = await waitFor(page, async () => {
      const bounds = await group(page, targetId).boundingBox();
      if (!bounds || Math.abs(bounds.width - expectedWidth) > .75) return false;
      return bounds;
    }, `The live group width did not continuously track ${expectedWidth}.`);
    assert(
      Math.abs(liveBounds.x - initialBounds.x) <= .75,
      `Right-edge resize moved the fixed left edge: before=${initialBounds.x}, live=${liveBounds.x}.`,
    );
    assert(
      Math.abs((liveBounds.x + liveBounds.width) - (initialBounds.x + initialBounds.width + pointerDelta)) <= .75,
      `The live group edge detached from the pointer: before=${JSON.stringify(initialBounds)}, live=${JSON.stringify(liveBounds)}, pointerDelta=${pointerDelta}.`,
    );
    const during = await canvasState(page);
    assertPosition(during.groups[targetId], original, `${targetId} persisted before pointer-up`);

    await page.keyboard.press("Escape");
    await waitFor(page, async () => {
      const bounds = await group(page, targetId).boundingBox();
      return bounds &&
        Math.abs(bounds.x - initialBounds.x) <= .75 &&
        Math.abs(bounds.width - initialBounds.width) <= .75
        ? bounds
        : false;
    }, "Escape did not restore the live group geometry.");
    await page.mouse.up();
    await page.waitForTimeout(140);

    const after = await canvasState(page);
    assertPosition(after.groups[targetId], original, targetId);
    assertUnmoved(before, after, "groups", [ids.subject, ids.subgroup, ids.overlapGroup]);
    assertUnmoved(before, after, "landmarks", [
      ids.a,
      ids.b,
      ids.c,
      ids.d,
      ids.corner,
      ids.overlap,
    ]);
    const diagnostics = await gestureDiagnostics(page);
    assert(
      diagnostics.draggingNodes === 0 && diagnostics.connectionLines === 0,
      `Escape left a live gesture behind: ${JSON.stringify(diagnostics)}.`,
    );
    const groupWrapperClass = await group(page, targetId).evaluate((node) => node.closest(".react-flow__node")?.className ?? "");
    assert(
      !String(groupWrapperClass).includes("resizing"),
      `Escape left the group in a resizing state: ${String(groupWrapperClass)}.`,
    );
    await page.screenshot({ path: resizeCancelScreenshot, fullPage: true });
  });

  await scenario("rapid repeated landmark and title drags", async () => {
    const start = await canvasState(page);
    const viewportBefore = await viewportState(page);
    const startedAt = performance.now();
    for (let index = 0; index < 12; index += 1) {
      const delta = index % 2 === 0 ? 28 : -28;
      await dragLocator(page, landmark(page, ids.c), delta, 0, 3);
    }
    for (let index = 0; index < 8; index += 1) {
      const delta = index % 2 === 0 ? 28 : -28;
      await dragLocator(page, groupTitle(page, ids.subgroup), 0, delta, 3);
    }
    const elapsedMs = performance.now() - startedAt;
    await page.waitForTimeout(150);
    const after = await canvasState(page);
    assertViewportStable(
      viewportBefore,
      await viewportState(page),
      "rapid repeated drag releases",
    );
    assertUnmoved(start, after, "landmarks", [ids.a, ids.b, ids.c, ids.d]);
    assertUnmoved(start, after, "groups", [ids.subject, ids.group, ids.subgroup]);
    assert(
      !(await page.getByTestId("atlas-graph").getAttribute("class")).match(/is-(?:node-dragging|navigating)/),
      "Rapid drags left a stuck canvas gesture class.",
    );
    console.log(`[verify:canvas-stress] rapid gesture wall time ${elapsedMs.toFixed(0)} ms`);
  });

  assert(interceptedMutations.length === 0, `The stress harness attempted external mutations: ${JSON.stringify(interceptedMutations)}`);
  assert(
    unexpectedContentReads.length === 0,
    `The stress harness requested content outside its synthetic fixture: ${JSON.stringify(unexpectedContentReads)}`,
  );
  assert(browserErrors.length === 0, `Browser console errors:\n${browserErrors.join("\n")}`);
  await context.close();
} finally {
  // Every content request in this browser context is fulfilled above. The
  // stress run can neither read from nor mutate the canonical content tree.
  await browser.close();
}

const failures = results.filter(({ status }) => status === "fail");
console.log(`[verify:canvas-stress] ${results.length - failures.length}/${results.length} scenarios passed.`);
console.log(`[verify:canvas-stress] Overview: ${overviewScreenshot}`);
console.log(`[verify:canvas-stress] Context menu: ${menuScreenshot}`);
console.log(`[verify:canvas-stress] Geometry ownership: ${geometryOwnershipScreenshot}`);
console.log(`[verify:canvas-stress] Resize cancellation: ${resizeCancelScreenshot}`);
console.log(`[verify:canvas-stress] Content frame: ${contentFrameScreenshot}`);
console.log(`[verify:canvas-stress] Formula picker: ${formulaPickerScreenshot}`);
console.log(`[verify:canvas-stress] Far-zoom content: ${contentZoomScreenshot}`);
console.log(`[verify:canvas-stress] Group boundaries at far zoom: ${groupBoundaryZoomScreenshot}`);
console.log(`[verify:canvas-stress] Mixed-selection drag: ${mixedSelectionDragScreenshot}`);
if (failures.length) {
  throw new Error(`Canvas usability stress failures:\n${failures.map(({ name, error, evidence }) =>
    `- ${name}: ${error}\n  ${evidence}`
  ).join("\n")}`);
}
