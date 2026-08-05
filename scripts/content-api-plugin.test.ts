import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aliasesFromPrefix,
  ContentRepositoryError,
  DiskContentRepository,
  splitMarkdownFile,
  stableIdFromPrefix,
  validateContentPath,
  validateEntryPath,
} from "./content-api-plugin";

describe("DiskContentRepository", () => {
  let sandbox = "";
  let contentRoot = "";
  let repository: DiskContentRepository;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "math-atlas-content-"));
    contentRoot = path.join(sandbox, "content");
    await mkdir(path.join(contentRoot, "Fixture Subject"), { recursive: true });
    repository = new DiskContentRepository(contentRoot);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("lists the real folder tree, stable YAML ids, and Markdown files only", async () => {
    await Promise.all([
      writeFile(
        path.join(contentRoot, "Fixture Subject", "Sample Note.md"),
        "---\nid: fixture.sample\naliases: [Sample Note, \"sample alias\"]\ntags: [fixture]\n---\n\nA sample body.",
      ),
      writeFile(path.join(contentRoot, "Fixture Subject", "scratch.txt"), "ignored"),
      writeFile(path.join(contentRoot, ".hidden.md"), "ignored"),
    ]);

    await expect(repository.listTree()).resolves.toEqual([
      {
        type: "directory",
        name: "Fixture Subject",
        path: "Fixture Subject",
        children: [
          {
            type: "file",
            name: "Sample Note.md",
            path: "Fixture Subject/Sample Note.md",
            id: "fixture.sample",
            aliases: ["Sample Note", "sample alias"],
          },
        ],
      },
    ]);
  });

  it("returns only the editable body and preserves exact frontmatter and CRLF", async () => {
    const relativePath = "Fixture Subject/Sample Note.md";
    const absolutePath = path.join(contentRoot, ...relativePath.split("/"));
    const prefix = "\uFEFF---\r\nid: fixture.sample\r\naliases:\r\n  - sample\r\n  - 'sample alias'\r\ntags:\r\n  - fixture\r\n---\r\n\r\n";
    await writeFile(absolutePath, `${prefix}Original $\\gamma$.\r\n`, "utf8");

    const opened = await repository.readNote(relativePath);
    expect(opened).toMatchObject({
      path: relativePath,
      id: "fixture.sample",
      aliases: ["sample", "sample alias"],
      markdown: "Original $\\gamma$.\r\n",
    });

    const saved = await repository.writeNote(
      relativePath,
      "Changed $\\gamma$.\n\nA second line.\n",
      opened.revision,
    );
    expect(saved.markdown).toBe("Changed $\\gamma$.\r\n\r\nA second line.\r\n");
    expect(saved.aliases).toEqual(["sample", "sample alias"]);
    expect(await readFile(absolutePath, "utf8")).toBe(
      `${prefix}Changed $\\gamma$.\r\n\r\nA second line.\r\n`,
    );
    expect((await readdir(path.dirname(absolutePath))).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("rejects stale saves without changing the on-disk note", async () => {
    const relativePath = "Fixture Subject/Sample Note.md";
    const absolutePath = path.join(contentRoot, ...relativePath.split("/"));
    await writeFile(absolutePath, "First", "utf8");
    const opened = await repository.readNote(relativePath);
    const saved = await repository.writeNote(relativePath, "Second", opened.revision);

    const failure = await repository
      .writeNote(relativePath, "Stale overwrite", opened.revision)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ContentRepositoryError);
    expect(failure).toMatchObject({
      code: "conflict",
      status: 409,
      currentRevision: saved.revision,
    });
    expect(await readFile(absolutePath, "utf8")).toBe("Second");
  });

  it("uses null revision as create-only and requires an existing parent", async () => {
    const created = await repository.writeNote(
      "Fixture Subject/New Note.md",
      "> [!theorem]\n> Statement.",
      null,
    );
    expect(created.markdown).toContain("Statement");

    await expect(
      repository.writeNote("Fixture Subject/New Note.md", "overwrite", null),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      repository.writeNote("Missing/New Note.md", "new", null),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it.each([
    "../outside.md",
    "Fixture Subject/../outside.md",
    "C:/outside.md",
    "Fixture Subject\\Sample Note.md",
    ".hidden/Note.md",
    "NUL.md",
    "note.txt",
  ])("rejects unsafe or non-Markdown path %s", (unsafePath) => {
    expect(() => validateContentPath(unsafePath)).toThrow(ContentRepositoryError);
  });

  it("creates real folders and rejects collisions or missing parents", async () => {
    await expect(repository.createFolder("Fixture Subject/Fixture Folder")).resolves.toEqual({
      path: "Fixture Subject/Fixture Folder",
      type: "directory",
    });
    await expect(repository.listTree()).resolves.toContainEqual({
      type: "directory",
      name: "Fixture Subject",
      path: "Fixture Subject",
      children: [
        {
          type: "directory",
          name: "Fixture Folder",
          path: "Fixture Subject/Fixture Folder",
          children: [],
        },
      ],
    });
    await expect(
      repository.createFolder("Fixture Subject/Fixture Folder"),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expect(
      repository.createFolder("Missing/Fixture Folder"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("renames notes and folders without rewriting note bytes or stable ids", async () => {
    const source = "---\nid: fixture.sample\n---\n\nA sample with $x^2$.\n";
    await writeFile(
      path.join(contentRoot, "Fixture Subject", "Sample Note.md"),
      source,
      "utf8",
    );

    await expect(
      repository.moveEntry(
        "Fixture Subject/Sample Note.md",
        "Fixture Subject/Renamed Note.md",
      ),
    ).resolves.toEqual({
      path: "Fixture Subject/Renamed Note.md",
      type: "file",
    });
    expect(
      await readFile(
        path.join(contentRoot, "Fixture Subject", "Renamed Note.md"),
        "utf8",
      ),
    ).toBe(source);
    await expect(repository.listTree()).resolves.toEqual([
      {
        type: "directory",
        name: "Fixture Subject",
        path: "Fixture Subject",
        children: [
          {
            type: "file",
            name: "Renamed Note.md",
            path: "Fixture Subject/Renamed Note.md",
            id: "fixture.sample",
          },
        ],
      },
    ]);

    await repository.moveEntry("Fixture Subject", "Renamed Subject");
    expect(
      await readFile(
        path.join(contentRoot, "Renamed Subject", "Renamed Note.md"),
        "utf8",
      ),
    ).toBe(source);
  });

  it("rejects unsafe moves, collisions, and moving a folder into itself", async () => {
    await Promise.all([
      writeFile(path.join(contentRoot, "Fixture Subject", "One.md"), "one"),
      writeFile(path.join(contentRoot, "Fixture Subject", "Two.md"), "two"),
      mkdir(path.join(contentRoot, "Fixture Subject", "Nested")),
    ]);
    await expect(
      repository.moveEntry(
        "Fixture Subject/One.md",
        "Fixture Subject/Two.md",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      repository.moveEntry("Fixture Subject", "Fixture Subject/Nested/Again"),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(
      repository.moveEntry("Fixture Subject/One.md", "../Outside.md"),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("soft-deletes notes and restores exact bytes after repository restart", async () => {
    const relativePath = "Fixture Subject/Sample Note.md";
    const source = "---\nid: fixture.sample\n---\n\nExact bytes.\n";
    await writeFile(path.join(contentRoot, ...relativePath.split("/")), source, "utf8");

    const receipt = await repository.trashEntry(relativePath);
    expect(receipt).toMatchObject({
      originalPath: relativePath,
      path: relativePath,
      type: "file",
    });
    expect(receipt.token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(await repository.listTree())).not.toContain("Sample Note.md");

    // Recovery does not depend on an in-memory undo stack.
    repository = new DiskContentRepository(contentRoot);
    await expect(repository.restoreEntry(receipt.token)).resolves.toEqual({
      path: relativePath,
      type: "file",
    });
    expect(await readFile(path.join(contentRoot, ...relativePath.split("/")), "utf8")).toBe(source);
    expect((await repository.readNote(relativePath)).id).toBe("fixture.sample");
  });

  it("keeps a deleted item recoverable when its original path becomes occupied", async () => {
    const relativePath = "Fixture Subject/Sample Note.md";
    await writeFile(path.join(contentRoot, ...relativePath.split("/")), "original", "utf8");
    const receipt = await repository.trashEntry(relativePath);
    await writeFile(path.join(contentRoot, ...relativePath.split("/")), "replacement", "utf8");

    await expect(repository.restoreEntry(receipt.token)).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
    expect(await readFile(path.join(contentRoot, ...relativePath.split("/")), "utf8")).toBe("replacement");
    await rm(path.join(contentRoot, ...relativePath.split("/")));
    await expect(repository.restoreEntry(receipt.token)).resolves.toMatchObject({
      path: relativePath,
    });
  });

  it("uses the same portable path rules for files and folders", () => {
    expect(validateEntryPath("Fixture Subject/Fixture Folder", "directory")).toEqual([
      "Fixture Subject",
      "Fixture Folder",
    ]);
    expect(() => validateEntryPath("Fixture Subject/Folder.md", "directory")).toThrow(
      ContentRepositoryError,
    );
    expect(() => validateEntryPath(".trash/recovered", "directory")).toThrow(
      ContentRepositoryError,
    );
  });
});

describe("frontmatter splitting", () => {
  it("leaves an unclosed delimiter visible and extracts only a safe stable id", () => {
    expect(splitMarkdownFile("---\nid: fixture.sample\nbody")).toMatchObject({
      prefix: "",
      body: "---\nid: fixture.sample\nbody",
    });
    const parts = splitMarkdownFile("---\nid: 'fixture.sample'\n---\n\nBody");
    expect(stableIdFromPrefix(parts.prefix)).toBe("fixture.sample");
    expect(stableIdFromPrefix("---\nid: ../../outside\n---\n")).toBeUndefined();
  });

  it("reads scalar, inline, and block Obsidian aliases without nested keys", () => {
    const prefix = [
      "---",
      "alias: Scalar name # comment",
      "aliases: [First, \"Second, form\", 'O''Brien', first] # duplicate",
      "metadata:",
      "  aliases:",
      "    - nested alias",
      "aliases: # block-form aliases",
      "  # a comment inside the block list",
      "  - continuous",
      "  - \"hash # alias\" # trailing comment",
      "  - null",
      "---",
      "",
    ].join("\n");

    expect(aliasesFromPrefix(prefix)).toEqual([
      "Scalar name",
      "First",
      "Second, form",
      "O'Brien",
      "continuous",
      "hash # alias",
    ]);
  });

  it("ignores aliases outside complete frontmatter and malformed collections", () => {
    expect(aliasesFromPrefix("aliases: visible body text\n")).toEqual([]);
    expect(aliasesFromPrefix("---\naliases: [unfinished\n---\n")).toEqual([]);
    expect(aliasesFromPrefix("---\naliases:\n  - one\nbody")).toEqual([]);
  });
});
