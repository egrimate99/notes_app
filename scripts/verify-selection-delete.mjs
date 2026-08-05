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
const screenshotPath = path.join(screenshotsDir, "multi-selection-delete-regression.png");
const noteScreenshotPath = path.join(screenshotsDir, "inline-note-direct-edit-regression.png");
const creationMenuScreenshotPath = path.join(screenshotsDir, "creation-palette-label-free-regression.png");

const landmarkIds = [
  "qa-delete-selection-alpha",
  "qa-delete-selection-beta",
  "qa-delete-selection-gamma",
  "qa-delete-selection-delta",
];

const fixtureSubjectName = "Selection QA";
const fixtureFolderName = "Interaction Notes";
const fixtureTitles = [
  "Selection Alpha",
  "Selection Beta",
  "Selection Gamma",
  "Selection Delta",
];
const fixtureRelativePaths = fixtureTitles.map(
  (title) => `${fixtureSubjectName}/${fixtureFolderName}/${title}.md`,
);
const fixtureMarkdownByPath = new Map(fixtureRelativePaths.map((notePath, index) => [
  notePath,
  (index === 0
    ? [
        `# ${fixtureTitles[index]}`,
        "",
        "Disposable synthetic material for selection and editor-key verification.",
        "",
        "> [!theorem] Synthetic editor boundary",
        "> Deleting inside $u + v = w$ must remain inside this editor.",
        "",
      ]
    : [
        `# ${fixtureTitles[index]}`,
        "",
        "Disposable synthetic material for selection and editor-key verification.",
        "",
        `Synthetic fixture ${index + 1}.`,
        "",
      ]).join("\n"),
]));

// Canonical notes have an independent life from canvas instances. Both the
// canvas and its note repository are disposable, in-memory browser fixtures.
const canvasFixture = {
  schemaVersion: 1,
  snapshotKey: "math-atlas-v1",
  landmarkKinds: {},
  landmarks: {},
  groups: {},
  customLandmarks: [
    {
      id: landmarkIds[0],
      title: fixtureTitles[0],
      subjectId: "qa-selection-subject",
      regionId: "qa-delete-group",
      contentPath: `content/${fixtureRelativePaths[0]}`,
      x: 120,
      y: 180,
      width: 220,
      height: 92,
      color: "#777777",
      shape: "hexagon",
      kind: "definition",
      contentMode: "title",
    },
    {
      id: landmarkIds[1],
      title: fixtureTitles[1],
      subjectId: "qa-selection-subject",
      regionId: "qa-delete-group",
      contentPath: `content/${fixtureRelativePaths[1]}`,
      x: 430,
      y: 180,
      width: 220,
      height: 92,
      color: "#777777",
      shape: "rectangle",
      kind: "theorem",
      contentMode: "title",
    },
    {
      id: landmarkIds[2],
      title: fixtureTitles[2],
      subjectId: "qa-selection-subject",
      regionId: "qa-delete-group",
      contentPath: `content/${fixtureRelativePaths[2]}`,
      x: 740,
      y: 180,
      width: 220,
      height: 92,
      color: "#777777",
      shape: "oval",
      kind: "proposition",
      contentMode: "title",
    },
    {
      id: landmarkIds[3],
      title: fixtureTitles[3],
      subjectId: "qa-selection-subject",
      regionId: "qa-delete-group",
      contentPath: `content/${fixtureRelativePaths[3]}`,
      x: 430,
      y: 390,
      width: 220,
      height: 92,
      color: "#777777",
      shape: "octagon",
      kind: "lemma",
      contentMode: "title",
    },
  ],
  customGroups: [{
    id: "qa-delete-group",
    title: "Selection laboratory",
    subjectId: "qa-selection-subject",
    level: "group",
    x: 40,
    y: 80,
    width: 1_010,
    height: 520,
    color: "#777777",
    shape: "rectangle",
    borderStyle: "solid",
    titlePosition: "top-left",
    titleFontSize: 26,
  }],
  connectionOverrides: {},
  customConnections: [],
};

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

async function assertHealthyServer() {
  const root = await fetch(`${appUrl}/`);
  assert(root.ok, `Application root returned HTTP ${root.status}.`);
}

function initialSyntheticNoteStore() {
  return new Map([...fixtureMarkdownByPath].map(([notePath, markdown], index) => [
    notePath,
    {
      markdown,
      revision: `qa-selection-seed-${index + 1}`,
      id: landmarkIds[index],
    },
  ]));
}

function syntheticContentTree(noteStore) {
  const root = [];
  const directories = new Map([["", root]]);

  for (const [notePath, document] of [...noteStore].sort(([left], [right]) =>
    left.localeCompare(right, "en", { sensitivity: "base" })
  )) {
    const segments = notePath.split("/");
    let parentPath = "";
    let children = root;
    for (const segment of segments.slice(0, -1)) {
      const directoryPath = parentPath ? `${parentPath}/${segment}` : segment;
      let directoryChildren = directories.get(directoryPath);
      if (!directoryChildren) {
        directoryChildren = [];
        children.push({
          type: "directory",
          name: segment,
          path: directoryPath,
          children: directoryChildren,
        });
        directories.set(directoryPath, directoryChildren);
      }
      parentPath = directoryPath;
      children = directoryChildren;
    }
    children.push({
      type: "file",
      name: segments.at(-1),
      path: notePath,
      ...(document.id ? { id: document.id } : {}),
    });
  }

  const sortEntries = (entries) => {
    entries.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    });
    for (const entry of entries) {
      if (entry.type === "directory") sortEntries(entry.children);
    }
  };
  sortEntries(root);
  return root;
}

function syntheticAtlas(snapshotKey) {
  return {
    schemaVersion: 1,
    snapshotKey,
    placements: [],
    customizations: {
      schemaVersion: 1,
      snapshotKey,
      landmarkKinds: {},
      landmarks: {},
      groups: {},
      customLandmarks: [],
      customGroups: [],
      connectionOverrides: {},
      customConnections: [],
    },
  };
}

async function installCanvasFixture(page) {
  await page.evaluate(({ fixture }) => {
    localStorage.clear();
    localStorage.setItem(
      "math-atlas:map-customizations:v1:math-atlas-v1",
      JSON.stringify(fixture),
    );
    localStorage.setItem(
      "math-atlas:viewport:math-atlas-v1",
      JSON.stringify({ x: 150, y: 95, zoom: .9 }),
    );
  }, { fixture: canvasFixture });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId(`landmark-${landmarkIds[0]}`).waitFor({ timeout: 15_000 });
}

async function mapState(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("math-atlas:map-customizations:"),
    );
    return key ? JSON.parse(localStorage.getItem(key)) : undefined;
  });
}

async function waitForFixtureIds(page, expectedIds) {
  try {
    await page.waitForFunction(({ expected }) => {
      const key = Object.keys(localStorage).find((candidate) =>
        candidate.startsWith("math-atlas:map-customizations:"),
      );
      const state = key ? JSON.parse(localStorage.getItem(key)) : undefined;
      const actual = (state?.customLandmarks ?? [])
        .map(({ id }) => id)
        .filter((id) => id.startsWith("qa-delete-"))
        .sort();
      return JSON.stringify(actual) === JSON.stringify([...expected].sort());
    }, { expected: expectedIds }, { timeout: 10_000 });
  } catch (cause) {
    const state = await mapState(page);
    const actualIds = (state?.customLandmarks ?? [])
      .map(({ id }) => id)
      .filter((id) => id.startsWith("qa-delete-"))
      .sort();
    throw new Error(
      `Canvas fixture ids were ${JSON.stringify(actualIds)}, expected ${JSON.stringify([...expectedIds].sort())}.`,
      { cause },
    );
  }
}

async function waitForSelectedIds(page, expectedIds) {
  await page.waitForFunction(({ expected }) => {
    const selected = [...document.querySelectorAll(".react-flow__node.selected")]
      .map((node) => node.querySelector("[data-testid^='landmark-qa-delete-']")?.getAttribute("data-testid"))
      .filter(Boolean)
      .map((testId) => testId.replace(/^landmark-/, ""))
      .sort();
    return JSON.stringify(selected) === JSON.stringify([...expected].sort());
  }, { expected: expectedIds }, { timeout: 10_000 });
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

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function installSyntheticApis(context, capturedWrites) {
  const noteStore = initialSyntheticNoteStore();
  const unexpectedContentRequests = [];
  const atlasMutations = [];

  await context.route("**/api/atlas*", async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET" || method === "HEAD") {
      const snapshotKey = new URL(request.url()).searchParams.get("snapshotKey") || "math-atlas-v1";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: method === "HEAD" ? "" : JSON.stringify({
          atlas: syntheticAtlas(snapshotKey),
          revision: "qa-selection-atlas",
        }),
      });
      return;
    }
    atlasMutations.push({ method, url: request.url() });
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "conflict",
          message: "The disposable selection harness blocks atlas persistence.",
        },
      }),
    });
  });

  await context.route("**/api/content/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = new URL(request.url());
    const relativePath = requestUrl.searchParams.get("path");

    if (requestUrl.pathname === "/api/content/tree" && (method === "GET" || method === "HEAD")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: method === "HEAD" ? "" : JSON.stringify(syntheticContentTree(noteStore)),
      });
      return;
    }

    if (requestUrl.pathname === "/api/content/file" && relativePath) {
      if (method === "GET" || method === "HEAD") {
        const document = noteStore.get(relativePath);
        if (document) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: method === "HEAD" ? "" : JSON.stringify({
              path: relativePath,
              markdown: document.markdown,
              revision: document.revision,
              ...(document.id ? { id: document.id } : {}),
            }),
          });
          return;
        }
      }

      if (method === "PUT") {
        const body = request.postDataJSON();
        assert(typeof body?.markdown === "string", "An intercepted note write requires Markdown.");
        assert(
          body.expectedRevision === null || typeof body.expectedRevision === "string",
          "An intercepted note write requires a valid expected revision.",
        );
        const current = noteStore.get(relativePath);
        const revisionMatches = body.expectedRevision === null
          ? current === undefined
          : current?.revision === body.expectedRevision;
        if (!revisionMatches) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "conflict",
                message: "The in-memory QA note revision changed.",
                ...(current ? { currentRevision: current.revision } : {}),
              },
            }),
          });
          return;
        }

        capturedWrites.push({ path: relativePath, markdown: body.markdown });
        const revision = `qa-selection-write-${capturedWrites.length}`;
        const id = body.markdown.match(/^---\r?\nid: ([^\r\n]+)/)?.[1] ?? current?.id;
        const document = {
          markdown: editableBody(body.markdown),
          revision,
          ...(id ? { id } : {}),
        };
        noteStore.set(relativePath, document);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            path: relativePath,
            markdown: document.markdown,
            revision,
            ...(id ? { id } : {}),
          }),
        });
        return;
      }
    }

    unexpectedContentRequests.push({ method, url: request.url() });
    await route.fulfill({
      status: method === "GET" || method === "HEAD" ? 404 : 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: method === "GET" || method === "HEAD" ? "not_found" : "conflict",
          message: "The disposable selection harness exposes only synthetic notes.",
        },
      }),
    });
  });

  return { atlasMutations, noteStore, unexpectedContentRequests };
}

function assertSyntheticIsolation(harness, label) {
  assert(
    harness.atlasMutations.length === 0,
    `${label} attempted atlas persistence:\n${JSON.stringify(harness.atlasMutations, null, 2)}`,
  );
  assert(
    harness.unexpectedContentRequests.length === 0,
    `${label} escaped its synthetic content repository:\n${JSON.stringify(harness.unexpectedContentRequests, null, 2)}`,
  );
}

async function createAndTypeDirectNote(page, capturedWrites, {
  body,
  screenshot,
  verifyMenuHeadings = false,
} = {}) {
  const point = await blankCanvasPoint(page);
  assert(point, "A blank canvas point is required for Note creation.");
  await page.mouse.click(point.x, point.y, { button: "right" });
  const creationMenu = page.getByRole("dialog", { name: "Create map object", exact: true });
  await creationMenu.waitFor({ timeout: 15_000 });
  await creationMenu.getByRole("button", { name: "Create informal note", exact: true }).waitFor();

  if (verifyMenuHeadings) {
    const visibleMenuText = await creationMenu.innerText();
    for (const heading of ["Informal", "Mathematics", "Structure"]) {
      assert(
        !new RegExp(`\\b${heading}\\b`, "i").test(visibleMenuText),
        `The creation palette visibly exposed the redundant ${heading} heading.`,
      );
    }
    assert(
      await creationMenu.locator("h1, h2, h3, h4, h5, h6, legend, .map-create-menu__section-label").count() === 0,
      "The creation palette added a visible section heading element.",
    );
    await page.screenshot({ path: creationMenuScreenshotPath, fullPage: true });
  }

  await creationMenu.getByRole("button", { name: "Create informal note", exact: true }).click();
  const editor = page.locator('textarea[aria-label="Edit note on canvas"]');
  await editor.waitFor({ state: "visible", timeout: 15_000 });
  assert(await editor.getAttribute("placeholder") === null, "The direct Note editor exposed placeholder copy.");
  await page.waitForFunction(() => {
    const directEditor = document.querySelector('textarea[aria-label="Edit note on canvas"]');
    return directEditor !== null && document.activeElement === directEditor;
  });

  const createdWrite = capturedWrites.find(({ path: notePath, markdown }) =>
    notePath.startsWith("notes/atlas-note-landmark-") &&
      /^---\r?\nid: landmark-[^\r\n]+\r?\nkind: concept\r?\nsubject: [^\r\n]+\r?\n---\r?\n$/.test(markdown)
  );
  assert(createdWrite, "Informal Note creation did not issue its intercepted canonical write.");
  const createdId = createdWrite.markdown.match(/^---\r?\nid: ([^\r\n]+)/)?.[1];
  assert(createdId, "The created Note is missing its stable landmark id.");
  const note = page.getByTestId(`landmark-${createdId}`);
  await note.waitFor();
  assert(
    await note.getAttribute("data-content-mode") === "note",
    "The created Note did not use its body-first paper mode.",
  );

  const sidebar = page.locator("#note-sidebar");
  assert(await sidebar.evaluate((element) => element.hidden), "Creating a Note opened the right inspector.");
  assert(await editor.inputValue() === "", "A new Note editor did not start empty.");

  let echoed = "";
  for (const character of body) {
    await page.keyboard.insertText(character);
    echoed += character;
    assert(
      await editor.inputValue() === echoed,
      `The on-paper editor failed to echo ${JSON.stringify(character)} immediately.`,
    );
  }
  assert(await sidebar.evaluate((element) => element.hidden), "Typing on the Note opened the right inspector.");
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });

  await page.waitForTimeout(650);
  assert(
    capturedWrites.some(({ path: notePath, markdown }) =>
      notePath === createdWrite.path && markdown === body
    ),
    "Typing directly on the Note did not issue the expected body PUT.",
  );

  await editor.press("Escape");
  const idlePaper = note.locator('div[role="textbox"][aria-label="Edit note on canvas"][aria-readonly="true"]');
  await idlePaper.waitFor({ state: "visible", timeout: 10_000 });
  // Semantic zoom may intentionally hide detail ink at overview scale, but
  // the idle paper must already be compiled and ready when the user zooms in.
  await note.locator(".katex").waitFor({ state: "attached", timeout: 10_000 });
  assert(
    await note.locator('textarea[aria-label="Edit note on canvas"]').count() === 0,
    "Finishing a direct Note edit left the raw editor visible.",
  );

  return { createdId, createdPath: createdWrite.path, note };
}

await assertHealthyServer();
const executablePath = await firstAvailable(edgeCandidates);
await mkdir(screenshotsDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const selectionContext = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
  });
  const selectionWrites = [];
  await selectionContext.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
  });
  const selectionHarness = await installSyntheticApis(selectionContext, selectionWrites);
  const page = await selectionContext.newPage();
  const selectionErrors = captureErrors(page);

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await installCanvasFixture(page);
  assert(
    await page.evaluate(() => sessionStorage.getItem("math-atlas:ephemeral-session") === "true"),
    "The selection page lost its ephemeral-session guard.",
  );

  // A plain selection must be removable with the physical Delete key.
  await page.getByTestId(`landmark-${landmarkIds[0]}`).click();
  await waitForSelectedIds(page, [landmarkIds[0]]);
  await page.keyboard.press("Delete");
  await page.getByTestId(`landmark-${landmarkIds[0]}`).waitFor({ state: "detached" });
  await waitForFixtureIds(page, landmarkIds.slice(1));

  // Reset only the disposable browser map, then exercise additive selection.
  await installCanvasFixture(page);
  await page.getByTestId(`landmark-${landmarkIds[0]}`).click();
  await page.getByTestId(`landmark-${landmarkIds[1]}`).click({ modifiers: ["Control"] });
  await waitForSelectedIds(page, landmarkIds.slice(0, 2));
  await page.getByRole("button", { name: "Hide note sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Hide file sidebar", exact: true }).click();
  await waitForSelectedIds(page, landmarkIds.slice(0, 2));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.keyboard.press("Delete");
  await page.getByTestId(`landmark-${landmarkIds[0]}`).waitFor({ state: "detached" });
  await page.getByTestId(`landmark-${landmarkIds[1]}`).waitFor({ state: "detached" });
  await waitForFixtureIds(page, landmarkIds.slice(2));
  assert(
    (await mapState(page)).customLandmarks.some(({ id }) => id === landmarkIds[2]),
    "Delete removed an unselected landmark from persistent canvas state.",
  );

  // One undo must restore the whole batch, not one item at a time.
  await page.keyboard.press("Control+z");
  await waitForFixtureIds(page, landmarkIds);
  await page.getByTestId(`landmark-${landmarkIds[0]}`).waitFor();
  await page.getByTestId(`landmark-${landmarkIds[1]}`).waitFor();

  // Inputs own destructive-looking keys while they have focus.
  await page.getByTestId(`landmark-${landmarkIds[0]}`).click();
  await page.getByRole("button", { name: "Search notes", exact: true }).click();
  const searchInput = page.getByRole("textbox", { name: "Search notes", exact: true });
  await searchInput.fill(fixtureTitles[0]);
  await searchInput.press("Delete");
  await searchInput.press("Backspace");
  assert(
    await page.getByTestId(`landmark-${landmarkIds[0]}`).count() === 1,
    "Delete or Backspace escaped a focused input and removed its selected canvas item.",
  );
  assert(
    (await mapState(page)).customLandmarks.some(({ id }) => id === landmarkIds[0]),
    "A focused input allowed canvas deletion to mutate map state.",
  );

  // CodeMirror owns the same keys. The in-memory repository keeps this
  // caret-level edit wholly inside the disposable browser context.
  await searchInput.fill("");
  await searchInput.press("Escape");
  await page.getByRole("button", { name: "Show note sidebar", exact: true }).click();
  await page.getByTestId(`landmark-${landmarkIds[0]}`).click();
  const formula = page.locator("#note-sidebar .editable-math--inline[role='button']").first();
  await formula.waitFor({ timeout: 15_000 });
  await formula.locator(".katex").first().click();
  const formulaEditor = page.getByRole("textbox", { name: "Edit mathematical environment" });
  await formulaEditor.waitFor({ timeout: 15_000 });
  await formulaEditor.press("Delete");
  await formulaEditor.press("Backspace");
  assert(
    await page.getByTestId(`landmark-${landmarkIds[0]}`).count() === 1,
    "Delete or Backspace escaped CodeMirror and removed its selected canvas item.",
  );
  assert(
    (await mapState(page)).customLandmarks.some(({ id }) => id === landmarkIds[0]),
    "A focused CodeMirror editor allowed canvas deletion to mutate map state.",
  );
  assert(selectionErrors.length === 0, `Selection page console errors:\n${selectionErrors.join("\n")}`);
  assertSyntheticIsolation(selectionHarness, "Selection page");
  await selectionContext.close();

  // Creating an informal Note is a direct paper interaction. The canvas owns
  // the caret and save loop; the right inspector must stay out of the way.
  const noteContext = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
  });
  const noteWrites = [];
  await noteContext.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.clear();
  });
  const noteHarness = await installSyntheticApis(noteContext, noteWrites);
  const notePage = await noteContext.newPage();
  const noteErrors = captureErrors(notePage);
  await notePage.goto(appUrl, { waitUntil: "networkidle" });
  await notePage.locator(".react-flow__pane").waitFor({ timeout: 15_000 });
  const noteBody = "A direct paper note with $x^2$ and no sidebar.";
  const created = await createAndTypeDirectNote(notePage, noteWrites, {
    body: noteBody,
    screenshot: noteScreenshotPath,
    verifyMenuHeadings: true,
  });

  // Open the inspector deliberately, then delete the active canvas instance.
  // A border click is a genuine explicit canvas selection without reopening
  // the paper editor in its inset body.
  const noteBounds = await created.note.boundingBox();
  assert(noteBounds, "The created Note has no clickable frame geometry.");
  await notePage.mouse.click(noteBounds.x + 4, noteBounds.y + 4);
  const noteSidebar = notePage.locator("#note-sidebar");
  if (await noteSidebar.evaluate((element) => element.hidden)) {
    await notePage.getByRole("button", { name: "Show note sidebar", exact: true }).click();
  }
  await notePage.waitForFunction(() => {
    const sidebar = document.querySelector("#note-sidebar");
    return sidebar !== null && !sidebar.hidden;
  });
  const generatedName = path.basename(created.createdPath, ".md");
  assert(
    !(await notePage.locator("body").innerText()).includes(generatedName),
    "The open inspector exposed the Note's generated storage name.",
  );
  await notePage.keyboard.press("Delete");
  await created.note.waitFor({ state: "detached", timeout: 10_000 });
  await notePage.waitForFunction(() => document.querySelector("#note-sidebar")?.hasAttribute("hidden"));
  assert(
    await noteSidebar.evaluate((element) => element.hidden),
    "Deleting the active Note left the right inspector open.",
  );
  assert(
    await noteSidebar.locator(".inspector-header h2").count() === 0,
    "Deleting the active Note left a stale inspector title mounted.",
  );
  assert(
    !(await notePage.locator("body").innerText()).includes(generatedName),
    "Deleting the active Note left its generated storage name visible.",
  );
  assert(
    !(await mapState(notePage)).customLandmarks.some(({ id }) => id === created.createdId),
    "Deleting the active Note left its canvas metadata behind.",
  );
  assert(noteErrors.length === 0, `Direct Note page console errors:\n${noteErrors.join("\n")}`);
  assertSyntheticIsolation(noteHarness, "Direct Note page");
  await noteContext.close();

  // The same direct-paper contract must hold on the background monitor page,
  // where workspace chrome is intentionally unavailable.
  const desktopContext = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    deviceScaleFactor: 1,
  });
  const desktopWrites = [];
  await desktopContext.addInitScript(() => {
    sessionStorage.setItem("math-atlas:ephemeral-session", "true");
    localStorage.clear();
  });
  const desktopHarness = await installSyntheticApis(desktopContext, desktopWrites);
  const desktopPage = await desktopContext.newPage();
  const desktopErrors = captureErrors(desktopPage);
  const desktopUrl = new URL(appUrl);
  desktopUrl.searchParams.set("desktopSurface", "qa-monitor");
  await desktopPage.goto(desktopUrl.href, { waitUntil: "networkidle" });
  await desktopPage.locator(".react-flow__pane").waitFor({ timeout: 15_000 });
  await createAndTypeDirectNote(desktopPage, desktopWrites, {
    body: "Direct desktop paper with $y^2$.",
  });
  assert(
    await desktopPage.locator("#note-sidebar").evaluate((element) => element.hidden),
    "The background monitor Note opened a right inspector.",
  );
  assert(desktopErrors.length === 0, `Desktop page console errors:\n${desktopErrors.join("\n")}`);
  assertSyntheticIsolation(desktopHarness, "Desktop page");
  await desktopContext.close();

  console.log("Verified selection deletion, grouped undo, editor key ownership, direct on-paper Note creation, clean active-note deletion, and a label-free creation palette in Edge.");
  console.log(`Screenshots: ${screenshotPath}`);
  console.log(`             ${noteScreenshotPath}`);
  console.log(`             ${creationMenuScreenshotPath}`);
} finally {
  await browser.close();
}
