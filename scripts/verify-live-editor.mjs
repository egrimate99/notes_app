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
const contentRoot = path.join(projectRoot, "content");
const screenshotsDir = path.join(projectRoot, "docs", "screenshots");
const qaRunId = randomUUID().slice(0, 8);
const qaSubjectName = `QA Disposable Live Editor ${qaRunId}`;
const qaNoteName = "QA Inline Formula.md";
const relativeNotePath = `${qaSubjectName}/${qaNoteName}`;
const qaSubjectDir = path.join(contentRoot, qaSubjectName);
const notePath = path.join(qaSubjectDir, qaNoteName);
const marker = `CaretPreview${Date.now()}`;
const qaMarkdown = [
  "# QA Inline Formula",
  "",
  "This note contains only disposable synthetic verification material.",
  "",
  "Before $x + 1$ after.",
  "",
].join("\n");
const qaContentTree = [{
  type: "directory",
  name: qaSubjectName,
  path: qaSubjectName,
  children: [{
    type: "file",
    name: qaNoteName,
    path: relativeNotePath,
  }],
}];
const qaAtlas = {
  subjects: [],
  regions: [],
  landmarks: [],
  placements: [],
  connections: [],
  trails: [],
  importReport: {
    generatedAt: "1970-01-01T00:00:00.000Z",
    sourceVault: "",
    canvasPath: "",
    scannedMarkdown: 0,
    importedLandmarks: 0,
    importedConnections: 0,
    unplacedNotes: 0,
    encodingWarnings: 0,
    notes: ["Disposable live-editor verification atlas."],
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function firstAvailable(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional Edge installation.
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

function contentPathSelector(relativePath) {
  return `[role="treeitem"][data-content-path=${JSON.stringify(relativePath)}]`;
}

async function openTreeFile(page, relativePath) {
  const segments = relativePath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const parentPath = segments.slice(0, index).join("/");
    const directory = page.locator(contentPathSelector(parentPath));
    await directory.waitFor({ state: "visible" });
    if (await directory.getAttribute("aria-expanded") !== "true") {
      await directory.click();
    }
  }

  const file = page.locator(contentPathSelector(relativePath));
  await file.waitFor({ state: "visible" });
  await file.click();
}

async function waitForFileMarker(filePath, expectedMarker, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const markdown = await readFile(filePath, "utf8");
    if (markdown.includes(expectedMarker)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error("The live formula edit did not reach the disposable QA note.");
}

async function installSyntheticRoutes(context, unexpectedRequests, atlasMutations) {
  await context.route("**/api/atlas*", async (route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: method === "HEAD" ? "" : JSON.stringify({
          atlas: qaAtlas,
          revision: "qa-disposable-live-editor-atlas",
        }),
      });
      return;
    }
    atlasMutations.push(method);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: {
        code: "unavailable",
        message: "Disposable live-editor verification blocks atlas persistence.",
      } }),
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
    if (
      requestUrl.pathname === "/api/content/file" &&
      requestUrl.searchParams.get("path") === relativeNotePath &&
      (method === "GET" || method === "PUT")
    ) {
      await route.continue();
      return;
    }
    unexpectedRequests.push({ method, pathname: requestUrl.pathname });
    await route.fulfill({
      status: method === "GET" || method === "HEAD" ? 404 : 409,
      contentType: "application/json",
      body: JSON.stringify({ error: {
        code: method === "GET" || method === "HEAD" ? "not_found" : "conflict",
        message: "Disposable live-editor verification permits only its QA note.",
      } }),
    });
  });
}

let browser;
let qaSubjectCreated = false;
let failure;

try {
  const rootResponse = await fetch(`${appUrl}/`);
  assert(rootResponse.ok, `Application root returned HTTP ${rootResponse.status}.`);
  await mkdir(contentRoot, { recursive: true });
  assertDisposableSubjectPath();
  await mkdir(qaSubjectDir);
  qaSubjectCreated = true;
  await writeFile(notePath, qaMarkdown, { encoding: "utf8", flag: "wx" });
  await mkdir(screenshotsDir, { recursive: true });

  browser = await chromium.launch({
    executablePath: await firstAvailable(edgeCandidates),
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const unexpectedContentRequests = [];
  const atlasMutations = [];
  await context.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.setItem("math-atlas:panel-visible:file-sidebar", "true");
    localStorage.setItem("math-atlas:panel-visible:inspector", "true");
  });
  await installSyntheticRoutes(context, unexpectedContentRequests, atlasMutations);

  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await openTreeFile(page, relativeNotePath);
  const openNote = page.locator(
    `.live-note-editor[data-note-id=${JSON.stringify(relativeNotePath)}]`,
  );
  await openNote.waitFor({ state: "visible", timeout: 15_000 });
  const inlineFormula = openNote.locator(".editable-math--inline").first();
  await inlineFormula.waitFor({ timeout: 15_000 });
  const inlineInkBounds = await inlineFormula.locator(".katex-html").boundingBox();
  assert(inlineInkBounds, "The disposable inline formula has no clickable visual bounds.");
  await page.mouse.click(
    inlineInkBounds.x + inlineInkBounds.width - 1,
    inlineInkBounds.y + inlineInkBounds.height / 2,
  );

  const editor = page.getByRole("textbox", { name: "Edit paragraph", exact: true });
  await editor.waitFor({ timeout: 15_000 });
  assert(
    (await openNote.locator(".live-edit-overlay, .live-source, textarea").count()) === 0,
    "The editor must not contain a transparent textarea or detached source pane.",
  );
  assert(
    (await openNote.locator(".cm-live-latex-source").count()) === 1,
    "The selected formula must expose exactly one LaTeX body.",
  );
  assert(
    (await openNote.locator(".cm-compiled-math--preview .katex").count()) === 1,
    "The selected formula must retain one compiled preview.",
  );

  await editor.type(`\\text{${marker}}`);
  await page.waitForFunction(
    (value) => document.querySelector(".cm-compiled-math--preview annotation")?.textContent?.includes(value),
    marker,
  );

  await editor.press("Control+z");
  await page.waitForFunction(
    (value) => !document.querySelector(".cm-compiled-math--preview annotation")?.textContent?.includes(value),
    marker,
  );
  await editor.type(`\\text{${marker}}`);
  await page.waitForFunction(
    (value) => document.querySelector(".cm-compiled-math--preview annotation")?.textContent?.includes(value),
    marker,
  );

  await page.locator("#note-sidebar").screenshot({
    path: path.join(screenshotsDir, "live-note-editor.png"),
  });
  await waitForFileMarker(notePath, marker);

  await editor.press("Escape");
  await openNote.locator(".markdown-view").first().waitFor();
  assert(
    (await openNote.locator(".cm-editor").count()) === 0,
    "Escape must return the focused block to the typeset document.",
  );
  assert(atlasMutations.length === 0, `Live-editor verification attempted atlas mutations: ${atlasMutations.join(", ")}`);
  assert(
    unexpectedContentRequests.length === 0,
    `Live-editor verification attempted non-QA content requests: ${JSON.stringify(unexpectedContentRequests)}`,
  );
  assert(errors.length === 0, `Browser console errors:\n${errors.join("\n")}`);
  await context.close();
  console.log("Live note editor verified in Edge with disposable synthetic content.");
  console.log(`Screenshot: ${path.join(screenshotsDir, "live-note-editor.png")}`);
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (qaSubjectCreated) {
    try {
      assertDisposableSubjectPath();
      await rm(qaSubjectDir, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      "Live-editor verification or disposable-content cleanup failed.",
    );
  }
}

if (failure) throw failure;
