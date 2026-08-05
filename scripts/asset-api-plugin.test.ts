import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
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
import { DiskContentRepository } from "./content-api-plugin";
import {
  AssetRepositoryError,
  DiskAssetRepository,
  createAssetApiMiddleware,
  inspectImage,
  validateAssetPath,
} from "./asset-api-plugin";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const GIF_BYTES = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

describe("DiskAssetRepository", () => {
  let sandbox = "";
  let contentRoot = "";
  let repository: DiskAssetRepository;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "math-atlas-assets-"));
    contentRoot = path.join(sandbox, "content");
    await mkdir(contentRoot, { recursive: true });
    repository = new DiskAssetRepository(contentRoot);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("stores immutable content-addressed images and deduplicates identical bytes", async () => {
    const hash = createHash("sha256").update(PNG_BYTES).digest("hex");
    const first = await repository.storeImage("First diagram.png", "image/png", PNG_BYTES);
    const duplicate = await repository.storeImage("Renamed copy.png", undefined, PNG_BYTES);

    expect(first).toEqual({
      path: `.assets/${hash}.png`,
      mediaType: "image/png",
      byteLength: PNG_BYTES.length,
      sha256: `sha256-${hash}`,
      deduplicated: false,
    });
    expect(duplicate).toEqual({ ...first, deduplicated: true });
    expect(await readdir(path.join(contentRoot, ".assets"))).toEqual([`${hash}.png`]);
    expect((await repository.readImage(first.path)).bytes).toEqual(PNG_BYTES);
  });

  it("keeps the managed image directory out of the Markdown content tree", async () => {
    await repository.storeImage("diagram.png", "image/png", PNG_BYTES);
    await writeFile(path.join(contentRoot, "Visible.md"), "Visible note", "utf8");
    await expect(new DiskContentRepository(contentRoot).listTree()).resolves.toEqual([
      { type: "file", name: "Visible.md", path: "Visible.md" },
    ]);
  });

  it("rejects active, malformed, mismatched, and path-like inputs before writing", async () => {
    await expect(repository.storeImage("vector.svg", "image/svg+xml", Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ))).rejects.toMatchObject({ code: "invalid_image", status: 422 });
    await expect(repository.storeImage("photo.jpg", "image/jpeg", PNG_BYTES))
      .rejects.toMatchObject({ code: "invalid_image" });
    await expect(repository.storeImage("../diagram.png", "image/png", PNG_BYTES))
      .rejects.toMatchObject({ code: "invalid_path" });
    await expect(repository.storeImage("diagram.png", "image/png", Buffer.concat([
      PNG_BYTES,
      Buffer.from("<script>"),
    ]))).rejects.toMatchObject({ code: "invalid_image" });
    await expect(readdir(contentRoot)).resolves.toEqual([]);
  });

  it.each([
    "../outside.png",
    ".assets/../outside.png",
    ".assets\\hash.png",
    ".assets/not-a-hash.png",
    `.assets/${"A".repeat(64)}.png`,
    `.assets/${"a".repeat(64)}.svg`,
  ])("rejects non-canonical read path %s", async (unsafePath) => {
    expect(() => validateAssetPath(unsafePath)).toThrow(AssetRepositoryError);
    await expect(repository.readImage(unsafePath)).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("detects a canonical asset that was tampered with on disk", async () => {
    const saved = await repository.storeImage("diagram.png", "image/png", PNG_BYTES);
    const absolute = path.join(contentRoot, ...saved.path.split("/"));
    const tampered = Buffer.from(await readFile(absolute));
    tampered[45] ^= 0x01;
    await writeFile(absolute, tampered);
    await expect(repository.readImage(saved.path)).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("image structure validation", () => {
  it("reads dimensions only from a complete, bounded PNG", () => {
    expect(inspectImage(PNG_BYTES)).toEqual({
      extension: "png",
      mediaType: "image/png",
      width: 1,
      height: 1,
    });
    expect(() => inspectImage(PNG_BYTES.subarray(0, PNG_BYTES.length - 1)))
      .toThrow(AssetRepositoryError);
  });

  it("requires a complete GIF block stream with an actual image", () => {
    expect(inspectImage(GIF_BYTES)).toEqual({
      extension: "gif",
      mediaType: "image/gif",
      width: 1,
      height: 1,
    });
    expect(() => inspectImage(GIF_BYTES.subarray(0, GIF_BYTES.length - 2)))
      .toThrow(AssetRepositoryError);
  });
});

describe("asset HTTP middleware", () => {
  let sandbox = "";
  let server: Server | undefined;
  let origin = "";

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "math-atlas-assets-http-"));
    const middleware = createAssetApiMiddleware(
      new DiskAssetRepository(path.join(sandbox, "content")),
    );
    server = createServer((request, response) => {
      void middleware(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(sandbox, { recursive: true, force: true });
  });

  it("uploads JSON and serves sniffed bytes with immutable safety headers", async () => {
    const write = await fetch(`${origin}/api/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "diagram.png",
        mediaType: "image/png",
        dataBase64: PNG_BASE64,
      }),
    });
    expect(write.status).toBe(201);
    const saved = await write.json() as { path: string; sha256: string };

    const read = await fetch(`${origin}/api/assets/file?${new URLSearchParams({ path: saved.path })}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(read.headers.get("cache-control")).toContain("immutable");
    expect(read.headers.get("content-security-policy")).toContain("sandbox");
    expect(read.headers.get("etag")).toBe(`"${saved.sha256}"`);
    expect(Buffer.from(await read.arrayBuffer())).toEqual(PNG_BYTES);

    const cached = await fetch(`${origin}/api/assets/file?${new URLSearchParams({ path: saved.path })}`, {
      headers: { "If-None-Match": `"${saved.sha256}"` },
    });
    expect(cached.status).toBe(304);
  });

  it("returns structured errors for traversal and fake images", async () => {
    const traversal = await fetch(`${origin}/api/assets/file?path=..%2Foutside.png`);
    expect(traversal.status).toBe(400);
    await expect(traversal.json()).resolves.toMatchObject({ error: { code: "invalid_path" } });

    const fake = await fetch(`${origin}/api/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fake.png", dataBase64: Buffer.from("not image").toString("base64") }),
    });
    expect(fake.status).toBe(422);
    await expect(fake.json()).resolves.toMatchObject({ error: { code: "invalid_image" } });
  });
});
