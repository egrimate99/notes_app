import { describe, expect, it, vi } from "vitest";
import { emptyAtlasMetadata } from "../domain/atlasMetadata";
import {
  AtlasRepositoryError,
  ViteAtlasRepository,
} from "./atlasRepository";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ViteAtlasRepository", () => {
  it("reads a typed document with an encoded snapshot key", async () => {
    const atlas = emptyAtlasMetadata("pilot one");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ atlas, revision: null, recovery: { reason: "missing", message: "Empty" } }),
    );
    const repository = new ViteAtlasRepository("/api/atlas", fetcher);

    await expect(repository.readAtlas("pilot one")).resolves.toMatchObject({
      atlas,
      revision: null,
      recovery: { reason: "missing" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/atlas?snapshotKey=pilot+one",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("sends the complete atlas and optimistic revision", async () => {
    const atlas = emptyAtlasMetadata("pilot");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ atlas, revision: "sha256-new" }),
    );
    const repository = new ViteAtlasRepository("/api/atlas", fetcher);

    await repository.writeAtlas(atlas, "sha256-old");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/atlas",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ atlas, expectedRevision: "sha256-old" }),
      }),
    );
  });

  it("surfaces conflict details without losing the current revision", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "conflict",
            message: "Reload first",
            currentRevision: "sha256-current",
          },
        },
        409,
      ),
    );
    const repository = new ViteAtlasRepository("/api/atlas", fetcher);
    const failure = await repository
      .writeAtlas(emptyAtlasMetadata("pilot"), "sha256-stale")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AtlasRepositoryError);
    expect(failure).toMatchObject({
      code: "conflict",
      status: 409,
      currentRevision: "sha256-current",
    });
  });

  it("rejects successful but malformed service payloads", async () => {
    const repository = new ViteAtlasRepository(
      "/api/atlas",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ atlas: {}, revision: 4 })),
    );
    await expect(repository.readAtlas("pilot")).rejects.toMatchObject({ code: "io_error" });
  });
});
