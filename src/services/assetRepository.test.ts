import { describe, expect, it, vi } from "vitest";
import {
  AssetRepositoryError,
  TauriAssetRepository,
  ViteAssetRepository,
  base64ToBytes,
  bytesToBase64,
  type StoredImageAsset,
} from "./assetRepository";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_BYTES = base64ToBytes(PNG_BASE64);
const HASH = "a".repeat(64);
const STORED: StoredImageAsset = {
  path: `.assets/${HASH}.png`,
  mediaType: "image/png",
  byteLength: PNG_BYTES.length,
  sha256: `sha256-${HASH}`,
  deduplicated: false,
};

describe("image base64 transport", () => {
  it("round-trips binary bytes without argument-size spreading", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it.each(["", "not base64", "Zg=", "Zh=="])("rejects non-canonical data %s", (value) => {
    expect(() => base64ToBytes(value)).toThrow(AssetRepositoryError);
  });
});

describe("ViteAssetRepository", () => {
  it("uploads an image as canonical base64 and accepts deduplication metadata", async () => {
    const fetcher = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify(STORED), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    const repository = new ViteAssetRepository("/api/assets", fetcher as typeof fetch);

    await expect(repository.storeImage({
      name: "diagram.png",
      mediaType: "image/png",
      bytes: PNG_BYTES,
    })).resolves.toEqual(STORED);
    expect(fetcher).toHaveBeenCalledWith("/api/assets", expect.objectContaining({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      name: "diagram.png",
      mediaType: "image/png",
      dataBase64: PNG_BASE64,
    });
  });

  it("reads immutable binary image data with verified transport metadata", async () => {
    const fetcher = vi.fn(async () => new Response(PNG_BYTES, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(PNG_BYTES.length),
        "ETag": `"sha256-${HASH}"`,
      },
    }));
    const repository = new ViteAssetRepository("/api/assets", fetcher as typeof fetch);

    await expect(repository.readImage(STORED.path)).resolves.toEqual({
      ...STORED,
      deduplicated: undefined,
      bytes: PNG_BYTES,
    });
    const result = await repository.readImage(STORED.path);
    expect(result).not.toHaveProperty("deduplicated");
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/assets/file?path=.assets%2F${HASH}.png`,
      expect.objectContaining({ method: "GET", cache: "force-cache" }),
    );
  });

  it("surfaces structured validation errors", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "invalid_image", message: "Not an image." },
    }), { status: 422, headers: { "Content-Type": "application/json" } }));
    const repository = new ViteAssetRepository("/api/assets", fetcher as typeof fetch);
    await expect(repository.storeImage({ name: "fake.png", bytes: PNG_BYTES }))
      .rejects.toMatchObject({ code: "invalid_image", status: 422 });
  });
});

describe("TauriAssetRepository", () => {
  it("uses the same base64 contract for desktop writes and reads", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === "write_content_asset") return STORED as T;
      return {
        path: STORED.path,
        mediaType: STORED.mediaType,
        byteLength: STORED.byteLength,
        sha256: STORED.sha256,
        dataBase64: PNG_BASE64,
      } as T;
    };
    const repository = new TauriAssetRepository(invoke);

    await repository.storeImage({ name: "diagram.png", mediaType: "image/png", bytes: PNG_BYTES });
    await expect(repository.readImage(STORED.path)).resolves.toMatchObject({
      path: STORED.path,
      bytes: PNG_BYTES,
    });
    expect(calls).toEqual([
      {
        command: "write_content_asset",
        args: { name: "diagram.png", mediaType: "image/png", dataBase64: PNG_BASE64 },
      },
      { command: "read_content_asset", args: { path: STORED.path } },
    ]);
  });
});
