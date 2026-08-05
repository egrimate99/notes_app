import { invoke, isTauri } from "@tauri-apps/api/core";

export type ImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export interface ImageAssetInput {
  /** Original leaf filename, retained only for validation and diagnostics. */
  name: string;
  /** Optional browser-provided hint; the backend still sniffs the bytes. */
  mediaType?: string;
  bytes: Uint8Array;
}

export interface StoredImageAsset {
  /** Content-addressed Markdown path below content/.assets. */
  path: string;
  mediaType: ImageMediaType;
  byteLength: number;
  sha256: string;
  deduplicated: boolean;
}

export interface ImageAssetData extends Omit<StoredImageAsset, "deduplicated"> {
  bytes: Uint8Array;
}

export type AssetRepositoryErrorCode =
  | "conflict"
  | "invalid_image"
  | "invalid_path"
  | "invalid_request"
  | "io_error"
  | "not_found"
  | "unavailable";

export class AssetRepositoryError extends Error {
  constructor(
    public readonly code: AssetRepositoryErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AssetRepositoryError";
  }
}

export interface AssetRepository {
  storeImage(input: ImageAssetInput): Promise<StoredImageAsset>;
  readImage(path: string): Promise<ImageAssetData>;
}

interface AssetReadTransfer {
  path: string;
  mediaType: ImageMediaType;
  byteLength: number;
  sha256: string;
  dataBase64: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function repositoryError(error: unknown, status?: number): AssetRepositoryError {
  if (error instanceof AssetRepositoryError) return error;
  const envelope = isRecord(error) && isRecord(error.error) ? error.error : error;
  const shape = isRecord(envelope) ? envelope : undefined;
  const code = typeof shape?.code === "string"
    ? shape.code as AssetRepositoryErrorCode
    : "io_error";
  const message = typeof shape?.message === "string"
    ? shape.message
    : typeof error === "string"
      ? error
      : "The image operation failed.";
  return new AssetRepositoryError(code, message, status);
}

function supportedMediaType(value: string | null): value is ImageMediaType {
  return value === "image/png" || value === "image/jpeg" ||
    value === "image/gif" || value === "image/webp";
}

function validMetadata(value: unknown): value is StoredImageAsset {
  if (!isRecord(value)) return false;
  return typeof value.path === "string" && /^\.assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value.path) &&
    supportedMediaType(typeof value.mediaType === "string" ? value.mediaType : null) &&
    Number.isSafeInteger(value.byteLength) && Number(value.byteLength) > 0 &&
    typeof value.sha256 === "string" && /^sha256-[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.deduplicated === "boolean";
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  try {
    if (
      value.length === 0 ||
      value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    ) throw new Error("invalid base64");
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytesToBase64(bytes) !== value) throw new Error("non-canonical base64");
    return bytes;
  } catch {
    throw new AssetRepositoryError("io_error", "The image service returned invalid image data.");
  }
}

async function responseError(response: Response): Promise<AssetRepositoryError> {
  try {
    return repositoryError(await response.json(), response.status);
  } catch {
    return new AssetRepositoryError(
      "io_error",
      `The image service returned an invalid response (${response.status}).`,
      response.status,
    );
  }
}

type Fetcher = typeof fetch;

export class ViteAssetRepository implements AssetRepository {
  constructor(
    private readonly apiRoot = "/api/assets",
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  async storeImage(input: ImageAssetInput): Promise<StoredImageAsset> {
    let response: Response;
    try {
      response = await this.fetcher(this.apiRoot, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          ...(input.mediaType ? { mediaType: input.mediaType } : {}),
          dataBase64: bytesToBase64(input.bytes),
        }),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (error) {
      throw new AssetRepositoryError(
        "unavailable",
        error instanceof Error ? error.message : "The local image service is unavailable.",
      );
    }
    if (!response.ok) throw await responseError(response);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AssetRepositoryError("io_error", "The image service returned invalid metadata.");
    }
    if (!validMetadata(payload)) {
      throw new AssetRepositoryError("io_error", "The image service returned invalid metadata.");
    }
    return payload;
  }

  async readImage(path: string): Promise<ImageAssetData> {
    const query = new URLSearchParams({ path });
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiRoot}/file?${query}`, {
        method: "GET",
        cache: "force-cache",
        credentials: "same-origin",
      });
    } catch (error) {
      throw new AssetRepositoryError(
        "unavailable",
        error instanceof Error ? error.message : "The local image service is unavailable.",
      );
    }
    if (!response.ok) throw await responseError(response);
    const mediaType = response.headers.get("Content-Type")?.split(";", 1)[0] ?? null;
    const sha256 = response.headers.get("ETag")?.replace(/^"|"$/g, "");
    if (!supportedMediaType(mediaType) || !sha256 || !/^sha256-[a-f0-9]{64}$/.test(sha256)) {
      throw new AssetRepositoryError("io_error", "The image service returned invalid headers.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (!bytes.length || !Number.isSafeInteger(declaredLength) || declaredLength !== bytes.length) {
      throw new AssetRepositoryError("io_error", "The image service returned incomplete image data.");
    }
    return { path, mediaType, byteLength: bytes.length, sha256, bytes };
  }
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class TauriAssetRepository implements AssetRepository {
  constructor(private readonly invokeCommand: Invoke = invoke) {}

  async storeImage(input: ImageAssetInput): Promise<StoredImageAsset> {
    try {
      const value = await this.invokeCommand<unknown>("write_content_asset", {
        name: input.name,
        ...(input.mediaType ? { mediaType: input.mediaType } : {}),
        dataBase64: bytesToBase64(input.bytes),
      });
      if (!validMetadata(value)) {
        throw new AssetRepositoryError("io_error", "The desktop host returned invalid image metadata.");
      }
      return value;
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async readImage(path: string): Promise<ImageAssetData> {
    try {
      const value = await this.invokeCommand<unknown>("read_content_asset", { path });
      if (!isRecord(value) || typeof value.dataBase64 !== "string") {
        throw new AssetRepositoryError("io_error", "The desktop host returned invalid image data.");
      }
      const metadata = { ...value, deduplicated: false };
      if (!validMetadata(metadata)) {
        throw new AssetRepositoryError("io_error", "The desktop host returned invalid image metadata.");
      }
      const transfer = value as unknown as AssetReadTransfer;
      const bytes = base64ToBytes(transfer.dataBase64);
      if (bytes.length !== transfer.byteLength) {
        throw new AssetRepositoryError("io_error", "The desktop host returned incomplete image data.");
      }
      return {
        path: transfer.path,
        mediaType: transfer.mediaType,
        byteLength: transfer.byteLength,
        sha256: transfer.sha256,
        bytes,
      };
    } catch (error) {
      throw repositoryError(error);
    }
  }
}

export function createAssetRepository(): AssetRepository {
  try {
    return isTauri() ? new TauriAssetRepository() : new ViteAssetRepository();
  } catch {
    return new ViteAssetRepository();
  }
}

export const assetRepository = createAssetRepository();
