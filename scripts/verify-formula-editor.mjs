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
const qaSubjectName = `QA Disposable Formula ${qaRunId}`;
const qaNoteName = "QA Formula Workspace.md";
const relativeNotePath = `${qaSubjectName}/${qaNoteName}`;
const qaSubjectDir = path.join(contentRoot, qaSubjectName);
const notePath = path.join(qaSubjectDir, qaNoteName);
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
    notes: ["Disposable formula-editor verification atlas."],
  },
};
const qaMarkdown = [
  "# QA Formula Workspace",
  "",
  "This note contains only disposable synthetic verification material.",
  "",
  "$$",
  "a^2 + b^2 = c^2",
  "$$",
  "",
  "$$",
  "q(t) = t^2 + 1",
  "$$",
  "",
  "$$",
  "\\begin{aligned}",
  "h_{\\theta}(x) &= \\theta^T x \\\\",
  "\\bar{h}_{\\theta} &= \\frac{1}{n} \\sum_{i=1}^{n} h_{\\theta}(x_i)",
  "\\end{aligned}",
  "$$",
  "",
].join("\n");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function firstAvailable(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional Edge location.
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

async function waitForOpenNote(page, relativePath) {
  const note = page.locator(`.live-note-editor[data-note-id=${JSON.stringify(relativePath)}]`);
  await note.waitFor({ state: "visible" });
  await page.waitForFunction((noteId) => {
    const host = Array.from(document.querySelectorAll(".live-note-editor"))
      .find((element) => element.getAttribute("data-note-id") === noteId);
    return Boolean(host?.querySelector(".editable-math"));
  }, relativePath);
  return note;
}

function malformedFormulaFixture(markdown) {
  const alignedDisplay = /\$\$(\r?\n)\\begin\{aligned\}\1([\s\S]*?)\1\\end\{aligned\}\1\$\$/g;
  const matches = [...markdown.matchAll(alignedDisplay)];
  assert(matches.length > 0, "The disposable QA note has no canonical aligned display to mock.");
  const match = matches[matches.length - 1];
  const [formula, lineBreak, rows] = match;
  const malformed = `$$\\begin{aligned}${lineBreak}${rows}${lineBreak}\\end{aligned}$$${lineBreak}$$`;
  return `${markdown.slice(0, match.index)}${malformed}${markdown.slice(match.index + formula.length)}`;
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
          revision: "qa-disposable-formula-atlas",
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
        message: "Disposable formula verification blocks atlas persistence.",
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
        message: "Disposable formula verification permits only its QA note.",
      } }),
    });
  });
}

async function createPage(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.setItem("math-atlas:panel-visible:file-sidebar", "true");
    localStorage.setItem("math-atlas:panel-visible:inspector", "true");
  });
  return page;
}

let browser;
let qaSubjectCreated = false;
let failure;
const unexpectedContentRequests = [];
const atlasMutations = [];

try {
  const rootResponse = await fetch(`${appUrl}/`);
  assert(rootResponse.ok, `Application root returned HTTP ${rootResponse.status}.`);
  await mkdir(contentRoot, { recursive: true });
  assertDisposableSubjectPath();
  await mkdir(qaSubjectDir);
  qaSubjectCreated = true;
  await writeFile(notePath, qaMarkdown, { encoding: "utf8", flag: "wx" });

  const noteUrl = new URL("/api/content/file", appUrl);
  noteUrl.searchParams.set("path", relativeNotePath);
  const noteResponse = await fetch(noteUrl);
  assert(noteResponse.ok, `Disposable formula API returned HTTP ${noteResponse.status}.`);
  const currentDocument = await noteResponse.json();
  assert(currentDocument.path === relativeNotePath, "Formula API returned a different QA note path.");
  assert(typeof currentDocument.markdown === "string", "Formula API returned no Markdown body.");

  const originalNote = await readFile(notePath, "utf8");
  const malformedMarkdown = malformedFormulaFixture(currentDocument.markdown);
  await mkdir(screenshotsDir, { recursive: true });
  browser = await chromium.launch({
    executablePath: await firstAvailable(edgeCandidates),
    headless: true,
  });

  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  await installSyntheticRoutes(context, unexpectedContentRequests, atlasMutations);
  const page = await createPage(context);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });

  await openTreeFile(page, relativeNotePath);
  const note = await waitForOpenNote(page, relativeNotePath);

  assert(
    await note.locator(".katex-error").count() === 0,
    "The disposable QA note contains a rendered KaTeX error.",
  );
  const compilation = await note.locator(".editable-math").evaluateAll((formulae) => (
    formulae.map((formula, index) => ({
      index,
      compiled: Boolean(formula.querySelector(".katex")),
      error: formula.querySelector(".katex-error")?.textContent ?? "",
    }))
  ));
  assert(compilation.length > 0, "The disposable QA note exposed no editable formulae.");
  const failedFormulae = compilation.filter(({ compiled, error }) => !compiled || error);
  assert(
    failedFormulae.length === 0,
    `The disposable QA note contains uncompiled formulae: ${JSON.stringify(failedFormulae)}`,
  );
  await page.screenshot({
    path: path.join(screenshotsDir, "qa-formula-rendered.png"),
    fullPage: true,
  });

  const formulae = note.locator(".editable-math--display");
  const formulaCount = await formulae.count();
  assert(formulaCount >= 3, "Expected the three disposable display formulae.");
  const finalFormula = formulae.nth(formulaCount - 1);
  const ink = finalFormula.locator(".katex-html");
  assert(await ink.count() === 1, "The final formula must expose one visual KaTeX surface.");
  const inkBounds = await ink.boundingBox();
  assert(inkBounds, "The final formula has no clickable visual bounds.");
  await page.mouse.click(
    inkBounds.x + inkBounds.width * 0.5,
    inkBounds.y + inkBounds.height * 0.5,
  );

  const editor = page.getByRole("textbox", { name: "Edit math", exact: true });
  await editor.waitFor({ state: "visible" });
  const delimiters = note.locator(".cm-live-math-delimiter");
  assert(await delimiters.count() === 2, "Both display-math delimiter tokens must remain visible.");
  assert(
    (await delimiters.allTextContents()).every((value) => value === "$$"),
    "The visible display-math delimiters must preserve their exact source text.",
  );
  const source = (await note.locator(".cm-live-latex-source").allTextContents()).join("\n");
  assert(source.includes("\\begin{aligned}"), "The exact aligned-environment source is not visible.");
  assert(source.includes("\\bar{h}_{\\theta}"), "The second aligned row is not visible.");

  const preview = page.getByRole("button", { name: "Live formula preview", exact: true });
  await preview.waitFor({ state: "visible" });
  await editor.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await page.screenshot({
    path: path.join(screenshotsDir, "qa-formula-editing.png"),
    fullPage: true,
  });

  const previewInk = preview.locator(".katex-html");
  assert(await previewInk.count() === 1, "The live preview must expose a visual formula surface.");
  const previewBounds = await previewInk.boundingBox();
  assert(previewBounds, "The live preview has no clickable visual bounds.");
  await page.mouse.click(
    previewBounds.x + previewBounds.width * 0.3,
    previewBounds.y + previewBounds.height * 0.68,
  );
  assert(await editor.isVisible(), "Clicking the preview unexpectedly closed formula editing.");
  assert(await delimiters.count() === 2, "Preview navigation hid the source delimiters.");

  await editor.press("Escape");
  await editor.waitFor({ state: "hidden" });
  await context.close();

  const malformedContext = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  await installSyntheticRoutes(malformedContext, unexpectedContentRequests, atlasMutations);
  const malformedPage = await createPage(malformedContext);
  let mockedWriteCount = 0;
  await malformedPage.route("**/api/content/file?*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.searchParams.get("path") !== relativeNotePath) {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...currentDocument,
          markdown: malformedMarkdown,
          revision: "qa-malformed-formula",
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      mockedWriteCount += 1;
      const body = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...currentDocument,
          markdown: body.markdown,
          revision: `qa-malformed-formula-write-${mockedWriteCount}`,
        }),
      });
      return;
    }
    await route.continue();
  });
  await malformedPage.goto(appUrl, { waitUntil: "domcontentloaded" });
  await openTreeFile(malformedPage, relativeNotePath);
  const malformedNote = await waitForOpenNote(malformedPage, relativeNotePath);
  const brokenFormula = malformedNote.locator(".editable-math:has(.katex-error)");
  assert(
    await brokenFormula.count() === 1,
    "The mocked malformed QA tail must expose one broken rendered formula.",
  );
  const brokenBounds = await brokenFormula.boundingBox();
  assert(brokenBounds, "The mocked historical formula has no clickable error surface.");
  const brokenLines = await brokenFormula.evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) ||
      (Number.parseFloat(style.fontSize) || 16) * 1.5;
    return Math.max(1, Math.round(element.getBoundingClientRect().height / lineHeight));
  });
  const malformedFormulaOffset = malformedMarkdown.lastIndexOf("$$\\begin{aligned}");
  assert(malformedFormulaOffset >= 0, "The mocked historical formula could not be located.");
  const targetRatio = (malformedFormulaOffset + 2) / malformedMarkdown.length;
  const targetLinePosition = Math.min(brokenLines - Number.EPSILON, targetRatio * brokenLines);
  const targetLine = Math.floor(targetLinePosition);
  const targetXRatio = targetLinePosition - targetLine;
  const targetYRatio = (targetLine + 0.5) / brokenLines;
  await malformedPage.mouse.click(
    brokenBounds.x + brokenBounds.width * targetXRatio,
    brokenBounds.y + brokenBounds.height * targetYRatio,
  );

  const activeBlock = malformedNote.locator(".live-markdown-block.is-editing");
  await activeBlock.waitFor({ state: "visible" });
  const diagnostic = activeBlock.locator(
    ".cm-live-latex-diagnostic-note--display-fence-layout",
  );
  await activeBlock.locator(".cm-content").waitFor({ state: "visible" });
  await malformedPage.waitForTimeout(250);
  assert(
    await diagnostic.count() === 1,
    `The historical formula exposed no display-fence diagnostic. Active source: ${JSON.stringify(
      await activeBlock.locator(".cm-content").innerText(),
    )}`,
  );
  const diagnosticText = await diagnostic.textContent();
  assert(
    diagnosticText?.includes("Markdown display fence") &&
      diagnosticText.includes(
        "Markdown treats LaTeX beside an opening $$ as fence metadata.",
      ) &&
      diagnosticText.includes("Put each $$ on its own line, with all LaTeX between them."),
    "The historical formula did not expose the display-fence repair diagnostic.",
  );
  const diagnosticSource = await activeBlock.locator(".cm-content").innerText();
  assert(
    diagnosticSource.includes("$$\\begin{aligned}"),
    "Malformed editing did not preserve the exact opening delimiter and LaTeX source.",
  );
  assert(
    diagnosticSource.includes("\\bar{h}_{\\theta}"),
    "Malformed editing hid the second aligned row.",
  );
  await diagnostic.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await malformedPage.screenshot({
    path: path.join(screenshotsDir, "qa-formula-diagnostic.png"),
    fullPage: true,
  });
  await malformedContext.close();
  assert(mockedWriteCount === 0, "Diagnostic verification unexpectedly attempted to save the mock note.");
  assert(atlasMutations.length === 0, `Formula verification attempted atlas mutations: ${atlasMutations.join(", ")}`);
  assert(
    unexpectedContentRequests.length === 0,
    `Formula verification attempted non-QA content requests: ${JSON.stringify(unexpectedContentRequests)}`,
  );
  assert(
    await readFile(notePath, "utf8") === originalNote,
    "Browser verification unexpectedly changed the disposable QA note.",
  );
  console.log(
    "Verified the disposable QA note: every rendered formula compiles, delimiters remain visible, " +
    "preview caret navigation stays active, and the malformed tail exposes a source diagnostic.",
  );
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
      "Formula verification or disposable-content cleanup failed.",
    );
  }
}

if (failure) throw failure;
