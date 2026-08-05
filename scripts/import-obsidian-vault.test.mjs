import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyImportPlan,
  buildImportPlan,
  deterministicNoteId,
  frontmatterAliases,
  injectStableId,
  ObsidianImportError,
  parseArguments,
  rollbackImport,
  splitFrontmatter,
  verifyImportPayload,
  verifyCurrentImport,
  writeImportPayload,
} from "./import-obsidian-vault.mjs";

const temporaryRoots = [];

async function temporaryWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "math-atlas-vault-import-"));
  temporaryRoots.push(root);
  const vaultRoot = path.join(root, "vault");
  const contentRoot = path.join(root, "content");
  await mkdir(vaultRoot, { recursive: true });
  return { root, vaultRoot, contentRoot };
}

async function put(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sourceDigest(root, paths) {
  const values = [];
  for (const relativePath of paths) {
    values.push(`${relativePath}:${digest(await readFile(path.join(root, ...relativePath.split("/"))))}`);
  }
  return values.join("\n");
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC7sAAAAASUVORK5CYII=",
  "base64",
);
const gif = Buffer.from("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b", "hex");

async function populatedVault() {
  const workspace = await temporaryWorkspace();
  await put(
    workspace.vaultRoot,
    "Subject Alpha/Metric/Same.md",
    [
      "---",
      "tags:",
      "  - definition",
      "aliases:",
      "  - Alpha",
      "created: 2026-01-01",
      "---",
      "The metric version.",
      "![](pic.png)",
      "",
    ].join("\n"),
  );
  await put(workspace.vaultRoot, "Subject Alpha/Metric/pic.png", png);
  await put(
    workspace.vaultRoot,
    "Subject Beta/Topology/Same.md",
    "---\r\ntags: [definition]\r\ncreated: 2026-01-02\r\n---\r\nThe other version.\r\n",
  );
  await put(workspace.vaultRoot, "Unique.md", "A unique note.\n");
  await put(
    workspace.vaultRoot,
    "Root.md",
    [
      "[[Subject Alpha/Metric/Same|Same]] [[Alpha]] [[Unique]]",
      "![](fallback.gif)",
      "![[diagram.png]]",
      "",
    ].join("\n"),
  );
  await put(workspace.vaultRoot, "Media/fallback.gif", gif);
  await put(workspace.vaultRoot, "_tools/_pictures/diagram.png", png);
  await put(workspace.vaultRoot, ".obsidian/ignored.md", "Never import me.\n");
  await put(workspace.vaultRoot, "board.canvas", "{}\n");
  await put(workspace.vaultRoot, "source.pdf", Buffer.from("pdf"));
  return workspace;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Obsidian vault importer", () => {
  it("injects stable ids without normalising existing frontmatter or bodies", () => {
    const source = "---\r\ntags:\r\n  - theorem\r\n---\r\n\r\nBody $x$.\r\n";
    const expectedId = deterministicNoteId("Subject Alpha/Public Fixture Note Case 003.md");
    const injected = injectStableId(source, expectedId);
    expect(injected.id).toBe(expectedId);
    expect(injected.markdown).toBe(
      `---\r\nid: "${expectedId}"\r\ntags:\r\n  - theorem\r\n---\r\n\r\nBody $x$.\r\n`,
    );
    expect(splitFrontmatter(injected.markdown).body).toBe("\r\nBody $x$.\r\n");

    const plain = "Just the body.\n";
    expect(injectStableId(plain, "obsidian-plain-123").markdown).toBe(
      "---\nid: \"obsidian-plain-123\"\n---\n\nJust the body.\n",
    );
  });

  it("reads aliases without consuming later frontmatter fields", () => {
    expect(frontmatterAliases([
      "---",
      "aliases:",
      "  - Nash-equilibria",
      "  - 'Nash equilibrium'",
      "created: 2026-01-01",
      "tags:",
      "  - definition",
      "---",
      "body",
    ].join("\n"))).toEqual(["Nash-equilibria", "Nash equilibrium"]);
  });

  it("builds a complete plan without changing the source and verifies its staged payload", async () => {
    const { vaultRoot, contentRoot, root } = await populatedVault();
    const sourcePaths = [
      "Subject Alpha/Metric/Same.md",
      "Subject Alpha/Metric/pic.png",
      "Subject Beta/Topology/Same.md",
      "Unique.md",
      "Root.md",
      "Media/fallback.gif",
      "_tools/_pictures/diagram.png",
    ];
    const before = await sourceDigest(vaultRoot, sourcePaths);
    const plan = await buildImportPlan({
      vaultRoot,
      contentRoot,
      expectations: { markdown: 4, assets: 2, noteLinks: 3 },
    });
    expect(plan.manifest.counts).toMatchObject({
      markdown: 4,
      assets: 2,
      assetReferences: 3,
      noteLinks: 3,
      wikiImageEmbeds: 1,
      skippedFiles: 2,
    });
    expect(plan.notes.map(({ path: notePath }) => notePath)).not.toContain(".obsidian/ignored.md");
    expect(new Set(plan.notes.map(({ id }) => id)).size).toBe(4);
    const rootNote = plan.notes.find(({ path: notePath }) => notePath === "Root.md");
    expect(rootNote.markdown).toContain("[[Subject Alpha/Metric/Same|Same]] [[Alpha]] [[Unique]]");
    expect(rootNote.markdown).not.toContain("![[diagram.png]]");
    expect(rootNote.markdown.match(/!\[[^\]]*\]\(\.assets\/[a-f0-9]{64}\.(?:png|gif)\)/g)).toHaveLength(2);
    const metric = plan.notes.find(({ path: notePath }) => notePath === "Subject Alpha/Metric/Same.md");
    expect(metric.markdown).toMatch(/!\[\]\(\.\.\/\.\.\/\.assets\/[a-f0-9]{64}\.png\)/);
    expect(await sourceDigest(vaultRoot, sourcePaths)).toBe(before);

    const payloadRoot = path.join(root, "payload");
    await writeImportPayload(plan, payloadRoot);
    await expect(verifyImportPayload(payloadRoot, plan.manifest)).resolves.toMatchObject({
      markdown: 4,
      assets: 2,
      noteLinks: 3,
      assetReferences: 3,
    });
  });

  it("promotes transactionally, preserves the previous tree, and rolls back recoverably", async () => {
    const { vaultRoot, contentRoot } = await populatedVault();
    await put(contentRoot, "Old/Only.md", "old canonical note\n");
    await put(contentRoot, ".math-atlas/atlas.json", "{\"old\":true}\n");
    await put(contentRoot, ".trash/recoverable/receipt.json", "{\"path\":\"Old/Deleted.md\"}\n");
    await put(contentRoot, ".obsidian-import-staging-abandoned/payload/incomplete", "stale\n");
    await put(
      contentRoot,
      ".obsidian-import-backups/abandoned/transaction.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "abandoned",
        status: "rolled-back",
        previousEntries: [],
        promotedEntries: [],
      }),
    );
    const plan = await buildImportPlan({
      vaultRoot,
      contentRoot,
      expectations: { markdown: 4, assets: 2, noteLinks: 3 },
    });
    const applied = await applyImportPlan(plan);
    expect(await readFile(path.join(contentRoot, "Root.md"), "utf8")).toContain("obsidian-root-");
    await expect(readFile(path.join(contentRoot, "Old", "Only.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(applied.backupRoot, "previous", "Old", "Only.md"), "utf8"))
      .toBe("old canonical note\n");
    expect(await readFile(path.join(contentRoot, ".trash", "recoverable", "receipt.json"), "utf8"))
      .toContain("Old/Deleted.md");
    await expect(
      access(path.join(contentRoot, ".obsidian-import-staging-abandoned")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(verifyCurrentImport(contentRoot)).resolves.toMatchObject({ markdown: 4, assets: 2 });
    const atlas = JSON.parse(await readFile(path.join(contentRoot, ".math-atlas", "atlas.json"), "utf8"));
    expect(atlas.placements).toEqual([]);
    expect(atlas.customizations.customLandmarks).toEqual([]);

    const rolledBack = await rollbackImport(contentRoot, applied.transactionId);
    expect(await readFile(path.join(contentRoot, "Old", "Only.md"), "utf8")).toBe("old canonical note\n");
    expect(JSON.parse(await readFile(path.join(contentRoot, ".math-atlas", "atlas.json"), "utf8")))
      .toEqual({ old: true });
    expect(await readFile(path.join(rolledBack.displacedRoot, "Root.md"), "utf8"))
      .toContain("obsidian-root-");
  });

  it("rejects a genuinely ambiguous bare duplicate link before staging", async () => {
    const { vaultRoot, contentRoot } = await temporaryWorkspace();
    await put(vaultRoot, "A/Same.md", "A\n");
    await put(vaultRoot, "B/Same.md", "B\n");
    await put(vaultRoot, "Root.md", "[[Same]]\n");
    await expect(buildImportPlan({
      vaultRoot,
      contentRoot,
      expectations: { markdown: 3, assets: 0, noteLinks: 1 },
    })).rejects.toBeInstanceOf(ObsidianImportError);
  });

  it("defaults to a non-writing dry-run and requires an explicit apply flag", () => {
    expect(parseArguments([]).mode).toBe("dry-run");
    expect(parseArguments(["--apply"]).mode).toBe("apply");
    expect(() => parseArguments(["--apply", "--verify"])).toThrow("Choose exactly one");
  });
});
