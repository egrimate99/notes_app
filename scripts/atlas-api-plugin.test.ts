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
import { emptyAtlasMetadata } from "../src/domain/atlasMetadata";
import {
  AtlasRepositoryError,
  DiskAtlasRepository,
  createAtlasApiMiddleware,
} from "./atlas-api-plugin";

describe("DiskAtlasRepository", () => {
  let sandbox = "";
  let contentRoot = "";
  let repository: DiskAtlasRepository;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "math-atlas-metadata-"));
    contentRoot = path.join(sandbox, "content");
    await mkdir(contentRoot, { recursive: true });
    repository = new DiskAtlasRepository(contentRoot);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("recovers a missing file to a versioned empty atlas without writing on read", async () => {
    const opened = await repository.readAtlas("pilot");
    expect(opened).toMatchObject({
      atlas: { schemaVersion: 1, snapshotKey: "pilot", placements: [] },
      revision: null,
      recovery: { reason: "missing" },
    });
    await expect(readdir(contentRoot)).resolves.toEqual([]);
  });

  it("writes only content/.math-atlas/atlas.json using stable pretty JSON", async () => {
    const atlas = emptyAtlasMetadata("pilot");
    atlas.placements.push({ landmarkId: "ridge", x: 100, y: 200 });
    const saved = await repository.writeAtlas(atlas, null);
    expect(saved.revision).toMatch(/^sha256-[a-f0-9]{64}$/);

    const metadataDirectory = path.join(contentRoot, ".math-atlas");
    expect(await readdir(metadataDirectory)).toEqual(["atlas.json"]);
    const disk = await readFile(path.join(metadataDirectory, "atlas.json"), "utf8");
    expect(disk.endsWith("\n")).toBe(true);
    expect(JSON.parse(disk)).toEqual(saved.atlas);
  });

  it("rejects stale and concurrent saves without changing the winning document", async () => {
    const initial = await repository.writeAtlas(emptyAtlasMetadata("pilot"), null);
    const left = structuredClone(initial.atlas);
    const right = structuredClone(initial.atlas);
    left.placements.push({ landmarkId: "left", x: 1, y: 2 });
    right.placements.push({ landmarkId: "right", x: 3, y: 4 });

    const results = await Promise.allSettled([
      repository.writeAtlas(left, initial.revision),
      repository.writeAtlas(right, initial.revision),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const failure = results.find(({ status }) => status === "rejected");
    expect(failure).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "conflict", status: 409 }),
    });
    const reopened = await repository.readAtlas("pilot");
    expect(reopened.atlas.placements).toHaveLength(1);
  });

  it("returns a safe default for corrupt JSON and allows revision-checked recovery", async () => {
    const metadataDirectory = path.join(contentRoot, ".math-atlas");
    await mkdir(metadataDirectory);
    await writeFile(path.join(metadataDirectory, "atlas.json"), "{broken json", "utf8");

    const recovered = await repository.readAtlas("pilot");
    expect(recovered).toMatchObject({
      atlas: { snapshotKey: "pilot", placements: [] },
      revision: expect.stringMatching(/^sha256-/),
      recovery: { reason: "invalid-json" },
    });
    await repository.writeAtlas(recovered.atlas, recovered.revision);
    await expect(repository.readAtlas("pilot")).resolves.not.toHaveProperty("recovery");
  });

  it("rejects invalid outgoing metadata without creating or changing a file", async () => {
    const invalid = emptyAtlasMetadata("pilot") as unknown as Record<string, unknown>;
    invalid.schemaVersion = 99;
    const failure = await repository
      .writeAtlas(invalid as never, null)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AtlasRepositoryError);
    expect(failure).toMatchObject({ code: "invalid_metadata", status: 422 });
    await expect(readdir(contentRoot)).resolves.toEqual([]);
  });
});

describe("atlas HTTP middleware", () => {
  let sandbox = "";
  let server: Server | undefined;
  let origin = "";

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "math-atlas-http-"));
    const contentRoot = path.join(sandbox, "content");
    const middleware = createAtlasApiMiddleware(new DiskAtlasRepository(contentRoot));
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

  it("serves GET and revision-checked PUT at /api/atlas", async () => {
    const openedResponse = await fetch(`${origin}/api/atlas?snapshotKey=pilot`);
    expect(openedResponse.status).toBe(200);
    const opened = await openedResponse.json();
    expect(opened).toMatchObject({ atlas: { snapshotKey: "pilot" }, revision: null });

    const atlas = emptyAtlasMetadata("pilot");
    atlas.placements.push({ landmarkId: "node", x: 0, y: 0 });
    const savedResponse = await fetch(`${origin}/api/atlas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atlas, expectedRevision: null }),
    });
    expect(savedResponse.status).toBe(200);
    await expect(savedResponse.json()).resolves.toMatchObject({
      atlas: { placements: [{ landmarkId: "node", x: 0, y: 0 }] },
      revision: expect.stringMatching(/^sha256-/),
    });
  });

  it("returns structured validation errors", async () => {
    const response = await fetch(`${origin}/api/atlas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atlas: { schemaVersion: 999 }, expectedRevision: null }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_metadata", issues: expect.any(Array) },
    });
  });
});
