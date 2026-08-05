import { access, mkdir, readFile, rm } from "node:fs/promises";
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
const screenshotsDir = path.join(projectRoot, "docs", "screenshots");
const marker = Date.now().toString(36);
const sidebarTitle = `QA empty note ${marker}`;
const theoremTitle = `QA theorem ${marker}`;
const informalBody = `Check whether $x^2$ preserves the sign (${marker}).`;
const capturedWrites = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function absoluteContentPath(relativePath) {
  const resolved = path.resolve(contentRoot, ...relativePath.split("/"));
  const boundary = `${path.resolve(contentRoot)}${path.sep}`.toLocaleLowerCase();
  assert(
    resolved.toLocaleLowerCase().startsWith(boundary),
    "The QA note path escaped the content directory.",
  );
  return resolved;
}

function editableBody(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)*/, "");
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

const atlasBefore = await readFile(atlasPath);
const executablePath = await firstAvailable(edgeCandidates);
await mkdir(screenshotsDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.clear();
  });
  await page.route("**/api/content/file?*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const relativePath = requestUrl.searchParams.get("path");
    if (request.method() === "GET") {
      const latest = [...capturedWrites].reverse().find(({ path: notePath }) =>
        notePath === relativePath
      );
      if (latest) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            path: relativePath,
            markdown: editableBody(latest.markdown),
            revision: `qa-revision-${capturedWrites.length}`,
          }),
        });
        return;
      }
    }
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }
    const body = request.postDataJSON();
    assert(relativePath, "A mocked note write must include a path.");
    capturedWrites.push({ path: relativePath, markdown: body.markdown });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        path: relativePath,
        markdown: body.markdown,
        revision: `qa-revision-${capturedWrites.length}`,
      }),
    });
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.locator(".react-flow__pane").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "New note", exact: true }).click();
  const fileName = page.getByRole("textbox", { name: "New note name", exact: true });
  await fileName.waitFor();
  const fileSelection = await fileName.evaluate((input) => ({
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
  }));
  assert(
    fileSelection.start === 0 && fileSelection.end === fileSelection.value.length,
    "The complete default filename must be selected.",
  );
  await fileName.fill(sidebarTitle);
  await fileName.press("Enter");

  const emptyWrite = capturedWrites.find(({ path: notePath }) =>
    notePath.endsWith(`/${sidebarTitle}.md`) || notePath === `${sidebarTitle}.md`
  );
  assert(emptyWrite, "Sidebar creation did not write the named Markdown file.");
  assert(emptyWrite.markdown === "", "A new ordinary note must have an empty body.");
  const emptyEditor = page.getByRole("textbox", { name: "Edit paragraph", exact: true });
  await emptyEditor.waitFor({ timeout: 15_000 });

  await emptyEditor.press("Alt+l");
  await page.locator(".cm-math-environment-label", { hasText: "Lemma" }).waitFor();
  await page.waitForTimeout(750);
  const shortcutWrite = [...capturedWrites].reverse().find(({ path: notePath }) =>
    notePath === emptyWrite.path
  );
  assert(
    shortcutWrite?.markdown === "> [!lemma]\n> ",
    "Alt+L must insert a minimal lemma environment at the caret.",
  );
  await page.locator("#note-sidebar").screenshot({
    path: path.join(screenshotsDir, "environment-shortcut.png"),
  });

  const informalCountBefore = await page.locator(".landmark-node--informal-note").count();
  let point = await blankCanvasPoint(page);
  assert(point, "A blank canvas point is required for informal Note creation.");
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("button", { name: "Create informal note", exact: true }).click();
  assert(
    await page.getByRole("dialog", { name: "Name Note", exact: true }).count() === 0,
    "An informal Note must never interrupt creation with a title dialog.",
  );
  await page.waitForFunction(
    (previousCount) => document.querySelectorAll(".landmark-node--informal-note").length > previousCount,
    informalCountBefore,
  );

  const informalWrite = [...capturedWrites].reverse().find(({ markdown }) =>
    /^---\nid: landmark-[^\n]+\nkind: concept\nsubject: [^\n]+\n---\n$/.test(markdown)
  );
  assert(informalWrite, "Canvas Note creation did not write an empty canonical Note file.");
  const informalId = informalWrite.markdown.match(/^---\nid: ([^\n]+)/)?.[1];
  assert(informalId, "The informal Note is missing its stable landmark id.");
  const informalNode = page.getByTestId(`landmark-${informalId}`);
  await informalNode.waitFor();
  assert(
    await informalNode.getAttribute("data-content-mode") === "note",
    "A newly created informal Note must show its body, not a title-only canvas tile.",
  );
  assert(
    await informalNode.locator(".landmark-node__document-title").count() === 0,
    "The Note's silent backing filename leaked into the canvas as a document title.",
  );
  const informalInspectorHeading = page.locator("#note-sidebar .inspector-header h2");
  assert(
    await informalInspectorHeading.count() === 0,
    "A titleless Note must not grow a synthetic editor heading.",
  );

  const informalEditor = informalNode.locator('textarea[aria-label="Edit note on canvas"]');
  try {
    await informalEditor.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const inspectorState = await page.locator("body").evaluate((body) => ({
      text: body.querySelector("#note-sidebar")?.textContent,
      html: body.querySelector("#note-sidebar")?.innerHTML,
      textboxes: [...body.querySelectorAll("[role='textbox'], textarea")].map((node) => ({
        label: node.getAttribute("aria-label"),
        visible: Boolean(node.getClientRects().length),
      })),
    }));
    console.error("Informal Note editor state:", JSON.stringify(inspectorState, null, 2));
    await page.screenshot({
      path: path.join(screenshotsDir, "titleless-note-creation-failure.png"),
      fullPage: true,
    });
    throw error;
  }
  await page.waitForFunction(() => {
    const editor = document.querySelector('textarea[aria-label="Edit note on canvas"]');
    return editor !== null && document.activeElement === editor;
  });
  await informalEditor.fill(informalBody);
  await informalEditor.press("Control+s");
  await informalEditor.press("Escape");
  const canvasFormula = informalNode.locator(".landmark-node__preview .katex");
  await canvasFormula.waitFor({ state: "attached", timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Focus selected", exact: true }).click();
  await page.waitForFunction(() => {
    const graph = document.querySelector(".atlas-graph");
    return graph && !graph.classList.contains("is-navigating") &&
      !graph.classList.contains("is-zoom-mid") &&
      !graph.classList.contains("is-zoom-far");
  });
  await canvasFormula.waitFor({ state: "visible", timeout: 10_000 });
  const canvasFormulaVisual = await canvasFormula.evaluate((formula) => {
    const preview = formula.closest(".landmark-node__preview");
    const documentFrame = formula.closest(".landmark-node__document");
    const bounds = formula.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      visibility: getComputedStyle(formula).visibility,
      display: getComputedStyle(formula).display,
      previewBounds: preview?.getBoundingClientRect().toJSON(),
      previewOverflow: preview ? getComputedStyle(preview).overflow : undefined,
      documentBounds: documentFrame?.getBoundingClientRect().toJSON(),
    };
  });
  assert(
    canvasFormulaVisual.width > 0 && canvasFormulaVisual.height > 0 &&
      canvasFormulaVisual.visibility !== "hidden" && canvasFormulaVisual.display !== "none",
    `The compiled Note formula has no visible canvas geometry: ${JSON.stringify(canvasFormulaVisual)}`,
  );
  assert(
    !(await informalNode.innerText()).includes(path.basename(informalWrite.path, ".md")),
    "The generated backing filename is visible inside the informal Note.",
  );
  await page.screenshot({
    path: path.join(screenshotsDir, "titleless-note-creation.png"),
    fullPage: true,
  });

  point = await blankCanvasPoint(page);
  assert(point, "A blank canvas point is required for the creation menu.");
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("button", { name: "Theorem", exact: true }).click();
  const theoremName = page.getByRole("textbox", { name: "Theorem name", exact: true });
  await theoremName.waitFor();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Theorem name"]');
    return input instanceof HTMLInputElement &&
      document.activeElement === input &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length;
  });
  const theoremSelection = await theoremName.evaluate((input) => ({
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
  }));
  assert(
    theoremSelection.value === "Untitled theorem" &&
      theoremSelection.start === 0 &&
      theoremSelection.end === theoremSelection.value.length,
    "The canvas object name must open fully selected.",
  );
  await page.screenshot({
    path: path.join(screenshotsDir, "object-name-selection.png"),
    fullPage: true,
  });
  await theoremName.fill(theoremTitle);
  await theoremName.press("Enter");
  await page.getByRole("dialog", { name: "Name Theorem", exact: true })
    .waitFor({ state: "detached" });

  const theoremWrite = capturedWrites.find(({ path: notePath }) =>
    notePath === `${theoremTitle}.md`
  );
  assert(theoremWrite, "Canvas creation did not place the chosen filename in the content root.");
  assert(
    /^---\nid: landmark-[^\n]+\nkind: theorem\nsubject: [^\n]+\n---\n\n> \[!theorem\]\n> $/.test(theoremWrite.markdown),
    "The theorem file must contain only structural metadata and its theorem environment.",
  );
  assert(!theoremWrite.markdown.includes(`# ${theoremTitle}`), "The filename must not be duplicated as an H1.");
  assert(!/click here|start writing/i.test(theoremWrite.markdown), "Starter prose must remain absent.");
  assert(!(await exists(absoluteContentPath(theoremWrite.path))), "The intercepted QA theorem reached disk.");
  assert(errors.length === 0, `Browser console errors:\n${errors.join("\n")}`);
  console.log("Verified titleless body-first Notes, selected naming, templates, and caret shortcuts in Edge.");
  console.log(`Screenshots: ${path.join(screenshotsDir, "object-name-selection.png")}`);
  console.log(`             ${path.join(screenshotsDir, "environment-shortcut.png")}`);
  console.log(`             ${path.join(screenshotsDir, "titleless-note-creation.png")}`);
} finally {
  await browser.close();
  for (const write of capturedWrites) {
    if (!write.path.includes(marker)) continue;
    const target = absoluteContentPath(write.path);
    if (await exists(target)) await rm(target, { force: true });
  }
  assert((await readFile(atlasPath)).equals(atlasBefore), "Canonical atlas metadata changed during QA.");
}
