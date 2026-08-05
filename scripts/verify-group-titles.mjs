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
const screenshotPath = path.join(screenshotsDir, "regression-contour-group-titles.png");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
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

const fixture = {
  schemaVersion: 1,
  snapshotKey: "math-atlas-v1",
  landmarkKinds: {},
  landmarks: {},
  groups: {},
  customLandmarks: [],
  customGroups: [
    {
      id: "qa-subject",
      title: "Synthetic Territory",
      subjectId: "synthetic-territory",
      level: "subject",
      x: 5600,
      y: 2800,
      width: 1120,
      height: 700,
      color: "#238636",
      shape: "rectangle",
      borderStyle: "double",
      titlePosition: "top-left",
      titleFontSize: 34,
    },
    {
      id: "qa-group",
      title: "Wide Fixture Group Designed to Wrap Across Multiple Lines",
      subjectId: "synthetic-territory",
      level: "group",
      parentId: "qa-subject",
      x: 5740,
      y: 2912,
      width: 700,
      height: 448,
      color: "#238636",
      shape: "hexagon",
      borderStyle: "solid",
      titlePosition: "top-left",
      titleFontSize: 28,
    },
    {
      id: "qa-subgroup",
      title: "Nested Fixture",
      subjectId: "synthetic-territory",
      level: "subgroup",
      parentId: "qa-group",
      x: 5880,
      y: 3024,
      width: 420,
      height: 252,
      color: "#238636",
      shape: "oval",
      borderStyle: "solid",
      titlePosition: "top-left",
      titleFontSize: 24,
    },
  ],
  connectionOverrides: {},
  customConnections: [],
};

const rootResponse = await fetch(`${appUrl}/`);
assert(rootResponse.ok, `Application root returned HTTP ${rootResponse.status}.`);

await mkdir(screenshotsDir, { recursive: true });
const executablePath = await firstAvailable(edgeCandidates);
const browser = await chromium.launch({ executablePath, headless: true });
const browserErrors = [];
const unexpectedContentRequests = [];
const unexpectedAtlasRequests = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(({ customizations }) => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.clear();
    localStorage.setItem(
      "math-atlas:map-customizations:v1:math-atlas-v1",
      JSON.stringify(customizations),
    );
    localStorage.setItem(
      "math-atlas:viewport:math-atlas-v1",
      JSON.stringify({ x: -4580, y: -2260, zoom: .85 }),
    );
  }, { customizations: fixture });

  // The title verifier is deliberately hermetic: its browser can neither
  // enumerate canonical notes nor read/write canonical atlas metadata.
  await context.route("**/api/content/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === "/api/content/tree" && (method === "GET" || method === "HEAD")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: method === "HEAD" ? "" : "[]",
      });
      return;
    }
    unexpectedContentRequests.push({ method, pathname: requestUrl.pathname });
    await route.fulfill({
      status: method === "GET" || method === "HEAD" ? 404 : 409,
      contentType: "application/json",
      body: method === "HEAD" ? "" : JSON.stringify({
        error: {
          code: method === "GET" ? "not_found" : "conflict",
          message: "The synthetic title verifier does not expose canonical content.",
        },
      }),
    });
  });
  await context.route("**/api/atlas*", async (route) => {
    unexpectedAtlasRequests.push({
      method: route.request().method(),
      pathname: new URL(route.request().url()).pathname,
    });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unavailable",
          message: "The synthetic title verifier blocks canonical atlas access.",
        },
      }),
    });
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(appUrl, { waitUntil: "networkidle" });
  for (const id of ["qa-subject", "qa-group", "qa-subgroup"]) {
    await page.getByTestId(`group-${id}`).waitFor({ timeout: 15_000 });
    await page.locator(`[data-region-title="${id}"]`).waitFor({ timeout: 15_000 });
  }
  assert(
    await page.evaluate(() => sessionStorage.getItem("math-atlas:ephemeral-session") === "true"),
    "The focused hierarchy fixture lost its ephemeral-session guard.",
  );

  const hideFile = page.getByRole("button", { name: "Hide file sidebar" });
  const hideNote = page.getByRole("button", { name: "Hide note sidebar" });
  if (await hideFile.count()) await hideFile.click();
  if (await hideNote.count()) await hideNote.click();
  await page.getByRole("button", { name: "Show file sidebar" }).waitFor();
  await page.getByRole("button", { name: "Show note sidebar" }).waitFor();
  await page.waitForTimeout(180);

  const titleMetrics = await page.evaluate(() => {
    const ids = ["qa-subject", "qa-group", "qa-subgroup"];
    return ids.map((id) => {
      const node = document.querySelector(`[data-testid="group-${id}"]`);
      const title = document.querySelector(`[data-region-title="${id}"]`);
      const text = title?.querySelector(".region-frame__title-text");
      const titleFrame = title?.querySelector(".region-frame__title-frame");
      const frameField = title?.querySelector(".region-frame__title-frame-field");
      const frameOutline = title?.querySelector(".region-frame__title-frame-outline");
      const frameDetail = title?.querySelector(".region-frame__title-frame-detail");
      const toolbar = title?.closest(".region-title-toolbar");
      const titleStyle = title ? getComputedStyle(title) : undefined;
      const textStyle = text ? getComputedStyle(text) : undefined;
      const fieldStyle = frameField ? getComputedStyle(frameField) : undefined;
      const outlineStyle = frameOutline ? getComputedStyle(frameOutline) : undefined;
      const detailStyle = frameDetail ? getComputedStyle(frameDetail) : undefined;
      const titleBounds = title?.getBoundingClientRect();
      const nodeBounds = node?.getBoundingClientRect();
      const titleCenterTarget = titleBounds
        ? document.elementFromPoint(
            titleBounds.left + titleBounds.width / 2,
            titleBounds.top + titleBounds.height / 2,
          )
        : undefined;
      return {
        id,
        level: node?.getAttribute("data-group-level"),
        attachment: title?.getAttribute("data-title-attachment"),
        titleLevel: title?.getAttribute("data-title-level"),
        treatment: title?.getAttribute("data-title-treatment"),
        anchor: title?.getAttribute("data-title-anchor"),
        contourAngle: Number(title?.getAttribute("data-title-contour-angle")),
        shape: title?.getAttribute("data-title-shape"),
        transform: titleStyle?.transform,
        titleBackground: titleStyle?.backgroundColor,
        titleBorderStyle: titleStyle?.borderStyle,
        titleBorderWidth: titleStyle?.borderWidth,
        titleBoxShadow: titleStyle?.boxShadow,
        framePath: frameOutline?.getAttribute("d"),
        frameFill: fieldStyle?.fill,
        frameStroke: outlineStyle?.stroke,
        frameStrokeWidth: outlineStyle?.strokeWidth,
        frameDetailStroke: detailStyle?.stroke,
        frameDisplay: titleFrame ? getComputedStyle(titleFrame).display : undefined,
        frameFilter: titleFrame ? getComputedStyle(titleFrame).filter : undefined,
        textBackground: textStyle?.backgroundColor,
        textBoxShadow: textStyle?.boxShadow,
        textStrokeWidth: textStyle?.webkitTextStrokeWidth,
        textOverflow: textStyle?.textOverflow,
        whiteSpace: textStyle?.whiteSpace,
        overflowWrap: textStyle?.overflowWrap,
        fontFamily: textStyle?.fontFamily,
        fontSize: textStyle?.fontSize,
        fontWeight: textStyle?.fontWeight,
        fontVariantCaps: textStyle?.fontVariantCaps,
        letterSpacing: textStyle?.letterSpacing,
        textTransform: textStyle?.textTransform,
        pointerEvents: titleStyle?.pointerEvents,
        minHeight: titleStyle?.minHeight,
        zIndex: Number.parseFloat(getComputedStyle(toolbar).zIndex),
        ownsCenter: titleCenterTarget?.closest?.(`[data-region-title="${id}"]`) === title,
        titleWidth: titleBounds?.width,
        titleHeight: titleBounds?.height,
        nodeWidth: nodeBounds?.width,
        nodeHeight: nodeBounds?.height,
        markWidth: title?.querySelector(".region-frame__title-mark")
          ? Number.parseFloat(getComputedStyle(title.querySelector(".region-frame__title-mark")).width)
          : undefined,
        hasMarkCore: Boolean(title?.querySelector(".region-frame__title-mark-core")),
      };
    });
  });

  const [subject, group, subgroup] = titleMetrics;
  assert(titleMetrics.every(({ attachment, level, titleLevel }) => attachment === "contour" && level === titleLevel), "Every hierarchy title must declare its exact contour attachment and level.");
  assert(titleMetrics.every(({ level, treatment }) => level === treatment), "Every hierarchy level must expose its own deliberate nameplate treatment.");
  assert([group, subgroup].every(({ titleBackground, titleBorderStyle, titleBorderWidth, titleBoxShadow, frameDisplay, frameFill, frameStroke, frameStrokeWidth, frameFilter }) => (
    titleBackground === "rgba(0, 0, 0, 0)" &&
    titleBorderStyle === "none" &&
    Number.parseFloat(titleBorderWidth) === 0 &&
    titleBoxShadow === "none" &&
    frameDisplay !== "none" &&
    frameFill !== "none" &&
    frameFill !== "rgba(0, 0, 0, 0)" &&
    frameStroke !== "none" &&
    Number.parseFloat(frameStrokeWidth) >= 1 &&
    frameFilter !== "none"
  )), "Group and Subgroup titles must use crisp shape-aware SVG frames with enough contrast over the canvas.");
  assert(
    subject.frameDisplay === "none" &&
      subject.titleBackground !== "rgba(0, 0, 0, 0)" &&
      subject.titleBorderStyle === "solid none" &&
      subject.titleBorderWidth === "1px 0px" &&
      subject.titleBoxShadow === "none",
    "The Subject title must use its quiet full-width editorial band instead of a coloured plaque.",
  );
  assert(titleMetrics.every(({ textBackground, textBoxShadow, textStrokeWidth }) => (
    textBackground === "rgba(0, 0, 0, 0)" &&
    textBoxShadow === "none" &&
    Number.parseFloat(textStrokeWidth || "0") === 0
  )), "The frame must carry title contrast without fuzzy glyph halos.");
  assert(titleMetrics.every(({ fontFamily }) => !/Times New Roman/i.test(fontFamily) && /Segoe UI|system-ui|ui-sans-serif/i.test(fontFamily)), "Every group title must use the professional UI sans-serif, not the mathematical serif.");
  assert(titleMetrics.every(({ pointerEvents, minHeight, ownsCenter }) => pointerEvents === "auto" && Number.parseFloat(minHeight) >= 30 && ownsCenter), "Visible labels must retain a generous, exact drag hit target.");
  assert(titleMetrics.every(({ textOverflow, whiteSpace, overflowWrap }) => textOverflow === "clip" && whiteSpace === "normal" && overflowWrap === "anywhere"), "Long titles must wrap and must never be replaced by an ellipsis.");
  assert(subject.markWidth === undefined && !subject.hasMarkCore, "The subject title must remain free of a small emblem.");
  assert([group, subgroup].every(({ markWidth, hasMarkCore }) => markWidth >= 10 && hasMarkCore), "Group and Subgroup nameplates need their geometric level marks.");
  assert(
    subject.shape === "rectangle" && group.shape === "hexagon" && subgroup.shape === "oval" &&
      subject.framePath === "M1 1H99V39H1Z" &&
      group.framePath === "M8 1H92L99 20L92 39H8L1 20Z" &&
      subgroup.framePath === "M14 1H86C94 1 99 8 99 20S94 39 86 39H14C6 39 1 32 1 20S6 1 14 1Z",
    "Rectangle, polygon, and oval groups must receive genuinely different fitted title silhouettes.",
  );
  assert(titleMetrics.every(({ transform }) => {
    if (transform === "none") return true;
    const values = transform?.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
    return values && Math.abs(values[1]) < .0001 && Math.abs(values[2]) < .0001;
  }), "Group typography must remain horizontal even when its contour tangent slopes.");
  assert(subject.fontSize === "34px" && group.fontSize === "28px" && subgroup.fontSize === "24px", "Authored large title sizes must remain intact across hierarchy levels.");
  assert(Number(group.fontWeight) > Number(subgroup.fontWeight) && Number(subgroup.fontWeight) > Number(subject.fontWeight), "Hierarchy should read through restrained weight changes.");
  assert(subject.textTransform === "uppercase" && Number.parseFloat(subject.letterSpacing) > 2, "The Subject title must read as a broad editorial heading.");
  assert(group.titleHeight > 52, "The deliberately long Group title must wrap into its frame instead of truncating.");
  assert(Number.parseFloat(group.frameStrokeWidth) > Number.parseFloat(subgroup.frameStrokeWidth), "Group and Subgroup frames must read with a clear hierarchy.");
  assert([group, subgroup].every(({ frameDetailStroke }) => frameDetailStroke !== "none"), "Child hierarchy plaques must carry a restrained colour detail from their territory.");
  assert(subject.zIndex === 1 && group.zIndex === 1 && subgroup.zIndex === 1, "Nested title layers must share the ordered group-title layer below landmarks.");
  assert(subject.anchor === "0,0" && group.anchor !== "0,0" && subgroup.anchor !== "0,0" && subgroup.contourAngle < 0, "Non-rectangular titles must use their own contour point while keeping language readable.");

  await page.screenshot({ path: screenshotPath, fullPage: true });

  const beforeZoom = titleMetrics.map(({ id, titleWidth, titleHeight, nodeWidth, nodeHeight, fontSize }) => ({
    id,
    titleWidth,
    titleHeight,
    nodeWidth,
    nodeHeight,
    fontSize,
  }));
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(220);
  const afterZoom = await page.evaluate((ids) => ids.map((id) => {
    const node = document.querySelector(`[data-testid="group-${id}"]`);
    const title = document.querySelector(`[data-region-title="${id}"]`);
    const text = title?.querySelector(".region-frame__title-text");
    const titleBounds = title?.getBoundingClientRect();
    const nodeBounds = node?.getBoundingClientRect();
    return {
      id,
      titleWidth: titleBounds?.width,
      titleHeight: titleBounds?.height,
      nodeWidth: nodeBounds?.width,
      nodeHeight: nodeBounds?.height,
      fontSize: text ? getComputedStyle(text).fontSize : undefined,
    };
  }), beforeZoom.map(({ id }) => id));
  for (let index = 0; index < beforeZoom.length; index += 1) {
    const before = beforeZoom[index];
    const after = afterZoom[index];
    const scale = after.nodeWidth / before.nodeWidth;
    assert(scale < .95, `${before.id} did not respond to canvas zoom.`);
    assert(after.fontSize === before.fontSize, `${before.id} rewrote its authored font size during zoom.`);
    assert(
      nearlyEqual(after.titleWidth / before.titleWidth, scale, .025) &&
        nearlyEqual(after.titleHeight / before.titleHeight, scale, .025) &&
        nearlyEqual(after.titleWidth / after.nodeWidth, before.titleWidth / before.nodeWidth, .003) &&
        nearlyEqual(after.titleHeight / after.nodeHeight, before.titleHeight / before.nodeHeight, .003),
      `${before.id} title did not scale consistently with its contour.`,
    );
  }

  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  assert(unexpectedContentRequests.length === 0, `Unexpected content requests: ${JSON.stringify(unexpectedContentRequests)}.`);
  assert(unexpectedAtlasRequests.length === 0, `Unexpected atlas requests: ${JSON.stringify(unexpectedAtlasRequests)}.`);
  console.log("Focused contour title regression verified in Edge.");
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  await browser.close();
}
