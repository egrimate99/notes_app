import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 16_384;
const ASSET_DIRECTORY_NAME = ".assets";
const ASSET_PATH = /^\.assets\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/;
const PORTABLE_FILENAME = /^[^<>:"/\\|?*\u0000-\u001f]+$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export type ImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export interface StoredImageAsset {
  /** Canonical Markdown path, always below content/.assets. */
  path: string;
  mediaType: ImageMediaType;
  byteLength: number;
  sha256: string;
  deduplicated: boolean;
}

export interface ImageAssetData extends Omit<StoredImageAsset, "deduplicated"> {
  bytes: Buffer;
}

export type AssetErrorCode =
  | "conflict"
  | "invalid_image"
  | "invalid_path"
  | "invalid_request"
  | "io_error"
  | "not_found";

export class AssetRepositoryError extends Error {
  constructor(
    public readonly code: AssetErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AssetRepositoryError";
  }
}

interface ImageFormat {
  extension: "png" | "jpg" | "gif" | "webp";
  mediaType: ImageMediaType;
  width: number;
  height: number;
}

function invalidImage(message: string): never {
  throw new AssetRepositoryError("invalid_image", message, 422);
}

function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toRepositoryError(error: unknown): AssetRepositoryError {
  if (error instanceof AssetRepositoryError) return error;
  return new AssetRepositoryError(
    "io_error",
    error instanceof Error ? error.message : "The image operation failed.",
    500,
  );
}

function assertDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return invalidImage("The image dimensions are invalid or unreasonably large.");
  }
}

function isPng(bytes: Buffer): ImageFormat | undefined {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]))) return undefined;

  let offset = 8;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return invalidImage("The PNG contains a truncated chunk.");
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (!dimensions) {
      if (chunkType !== "IHDR" || length !== 13) {
        return invalidImage("The PNG does not begin with a valid IHDR chunk.");
      }
      dimensions = {
        width: bytes.readUInt32BE(offset + 8),
        height: bytes.readUInt32BE(offset + 12),
      };
      assertDimensions(dimensions.width, dimensions.height);
    }
    if (chunkType === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) {
        return invalidImage("The PNG must end exactly at its IEND chunk.");
      }
      return { extension: "png", mediaType: "image/png", ...dimensions };
    }
    offset = chunkEnd;
  }
  return invalidImage("The PNG is missing its final IEND chunk.");
}

const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function isJpeg(bytes: Buffer): ImageFormat | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    return invalidImage("The JPEG must end exactly at its EOI marker.");
  }

  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return invalidImage("The JPEG marker stream is malformed.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00) {
      return invalidImage("The JPEG marker stream is malformed.");
    }
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return invalidImage("The JPEG contains a truncated segment.");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      return invalidImage("The JPEG contains an invalid segment length.");
    }
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 7) return invalidImage("The JPEG frame header is truncated.");
      dimensions = {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
      assertDimensions(dimensions.width, dimensions.height);
    }
    offset += length;
  }
  if (!dimensions) return invalidImage("The JPEG does not contain a supported frame header.");
  return { extension: "jpg", mediaType: "image/jpeg", ...dimensions };
}

function isGif(bytes: Buffer): ImageFormat | undefined {
  if (bytes.length < 14) return undefined;
  const signature = bytes.toString("ascii", 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return undefined;
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  assertDimensions(width, height);
  const globalTableBytes = bytes[10] & 0x80
    ? 3 * (1 << ((bytes[10] & 0x07) + 1))
    : 0;
  let offset = 13 + globalTableBytes;
  let sawImage = false;
  const consumeSubBlocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset++];
      if (length === 0) return;
      offset += length;
      if (offset > bytes.length) return invalidImage("The GIF contains a truncated data block.");
    }
    return invalidImage("The GIF contains an unterminated data block.");
  };
  while (offset < bytes.length) {
    const block = bytes[offset++];
    if (block === 0x3b) {
      if (!sawImage || offset !== bytes.length) {
        return invalidImage("The GIF must contain an image and end exactly at its trailer.");
      }
      return { extension: "gif", mediaType: "image/gif", width, height };
    }
    if (block === 0x21) {
      if (offset >= bytes.length) return invalidImage("The GIF extension is truncated.");
      offset += 1;
      consumeSubBlocks();
      continue;
    }
    if (block !== 0x2c || offset + 9 > bytes.length) {
      return invalidImage("The GIF block stream is malformed.");
    }
    assertDimensions(bytes.readUInt16LE(offset + 4), bytes.readUInt16LE(offset + 6));
    const descriptorPacked = bytes[offset + 8];
    offset += 9;
    if (descriptorPacked & 0x80) offset += 3 * (1 << ((descriptorPacked & 0x07) + 1));
    if (offset >= bytes.length) return invalidImage("The GIF image descriptor is truncated.");
    offset += 1; // LZW minimum code size.
    consumeSubBlocks();
    sawImage = true;
  }
  return invalidImage("The GIF is missing its final trailer.");
}

function isWebp(bytes: Buffer): ImageFormat | undefined {
  if (
    bytes.length < 26 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) return undefined;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
    return invalidImage("The WebP RIFF length does not match the file.");
  }
  const chunk = bytes.toString("ascii", 12, 16);
  const chunkLength = bytes.readUInt32LE(16);
  if (20 + chunkLength + (chunkLength & 1) > bytes.length) {
    return invalidImage("The WebP image chunk is truncated.");
  }

  let width: number;
  let height: number;
  if (chunk === "VP8X") {
    if (chunkLength < 10) return invalidImage("The WebP VP8X header is truncated.");
    width = 1 + bytes.readUIntLE(24, 3);
    height = 1 + bytes.readUIntLE(27, 3);
  } else if (chunk === "VP8L") {
    if (chunkLength < 5 || bytes[20] !== 0x2f) {
      return invalidImage("The WebP lossless header is invalid.");
    }
    width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
  } else if (chunk === "VP8 ") {
    if (
      chunkLength < 10 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) return invalidImage("The WebP lossy frame header is invalid.");
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else {
    return invalidImage("The WebP uses an unsupported primary image chunk.");
  }
  assertDimensions(width, height);
  return { extension: "webp", mediaType: "image/webp", width, height };
}

/** Sniffs trusted formats and rejects active or merely extension-labelled content. */
export function inspectImage(bytesLike: Uint8Array): ImageFormat {
  const bytes = Buffer.from(bytesLike);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return invalidImage("Images must contain data and be no larger than 16 MiB.");
  }
  const format = isPng(bytes) ?? isJpeg(bytes) ?? isGif(bytes) ?? isWebp(bytes);
  if (!format) {
    return invalidImage("Only structurally valid PNG, JPEG, GIF, and WebP images are supported.");
  }
  return format;
}

function validateOriginalName(name: string) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    name.endsWith(" ") ||
    !PORTABLE_FILENAME.test(name) ||
    WINDOWS_RESERVED_NAME.test(name)
  ) {
    throw new AssetRepositoryError("invalid_path", "The original image filename is invalid.", 400);
  }
}

export function validateAssetPath(relativePath: string) {
  if (typeof relativePath !== "string" || relativePath.length > 80 || relativePath.includes("\\")) {
    throw new AssetRepositoryError("invalid_path", "The image path is invalid.", 400);
  }
  const match = ASSET_PATH.exec(relativePath);
  if (!match) throw new AssetRepositoryError("invalid_path", "The image path is invalid.", 400);
  return { hash: match[1], extension: match[2] as ImageFormat["extension"] };
}

export function decodeImageBase64(value: string): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) return invalidImage("The image data is not valid base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return invalidImage("The image data is not canonical base64.");
  return bytes;
}

export class DiskAssetRepository {
  private resolvedRoot?: Promise<string>;
  private resolvedAssetsRoot?: Promise<string>;

  constructor(private readonly configuredRoot: string) {}

  private root(): Promise<string> {
    this.resolvedRoot ??= (async () => {
      await mkdir(this.configuredRoot, { recursive: true });
      const metadata = await lstat(this.configuredRoot);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new AssetRepositoryError("invalid_path", "The content root must be a real directory.", 500);
      }
      return realpath(this.configuredRoot);
    })();
    return this.resolvedRoot;
  }

  private assetsRoot(): Promise<string> {
    this.resolvedAssetsRoot ??= (async () => {
      const root = await this.root();
      const configuredAssets = path.join(root, ASSET_DIRECTORY_NAME);
      try {
        await mkdir(configuredAssets);
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
      }
      const metadata = await lstat(configuredAssets);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new AssetRepositoryError("invalid_path", "The image library must be a real directory.", 500);
      }
      const resolved = await realpath(configuredAssets);
      if (path.dirname(resolved) !== root) {
        throw new AssetRepositoryError("invalid_path", "The image library leaves the content directory.", 500);
      }
      return resolved;
    })().catch((error) => {
      this.resolvedAssetsRoot = undefined;
      throw toRepositoryError(error);
    });
    return this.resolvedAssetsRoot;
  }

  async storeImage(
    originalName: string,
    declaredMediaType: string | undefined,
    bytesLike: Uint8Array,
  ): Promise<StoredImageAsset> {
    validateOriginalName(originalName);
    const bytes = Buffer.from(bytesLike);
    const format = inspectImage(bytes);
    if (declaredMediaType && declaredMediaType.toLocaleLowerCase("en") !== format.mediaType) {
      return invalidImage("The declared media type does not match the image bytes.");
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const relativePath = `${ASSET_DIRECTORY_NAME}/${hash}.${format.extension}`;
    const target = path.join(await this.assetsRoot(), `${hash}.${format.extension}`);
    const existing = await this.readExisting(target, relativePath, hash, format.extension, true);
    if (existing) {
      const { bytes: _bytes, ...metadata } = existing;
      return { ...metadata, deduplicated: true };
    }

    const temporary = path.join(path.dirname(target), `.${hash}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        // A hard link publishes only the already-durable bytes and never replaces
        // a concurrently-created canonical asset.
        await link(temporary, target);
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
        const raced = await this.readExisting(target, relativePath, hash, format.extension, false);
        if (!raced || !raced.bytes.equals(bytes)) {
          throw new AssetRepositoryError("conflict", "The canonical image path is already occupied.", 409);
        }
        const { bytes: _bytes, ...metadata } = raced;
        return { ...metadata, deduplicated: true };
      }
    } catch (error) {
      throw toRepositoryError(error);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return {
      path: relativePath,
      mediaType: format.mediaType,
      byteLength: bytes.length,
      sha256: `sha256-${hash}`,
      deduplicated: false,
    };
  }

  async readImage(relativePath: string): Promise<ImageAssetData> {
    const { hash, extension } = validateAssetPath(relativePath);
    const target = path.join(await this.assetsRoot(), path.posix.basename(relativePath));
    const asset = await this.readExisting(target, relativePath, hash, extension, false);
    if (!asset) throw new AssetRepositoryError("not_found", "The image does not exist.", 404);
    return asset;
  }

  private async readExisting(
    absolutePath: string,
    relativePath: string,
    expectedHash: string,
    expectedExtension: ImageFormat["extension"],
    missingAllowed: boolean,
  ): Promise<ImageAssetData | undefined> {
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new AssetRepositoryError("invalid_path", "Image assets must be ordinary files.", 400);
      }
      if (metadata.size > MAX_IMAGE_BYTES) return invalidImage("The stored image is larger than 16 MiB.");
      const bytes = await readFile(absolutePath);
      const format = inspectImage(bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== expectedHash || format.extension !== expectedExtension) {
        throw new AssetRepositoryError("conflict", "The stored image does not match its canonical path.", 409);
      }
      return {
        path: relativePath,
        mediaType: format.mediaType,
        byteLength: bytes.length,
        sha256: `sha256-${hash}`,
        bytes,
      };
    } catch (error) {
      if (missingAllowed && isMissing(error)) return undefined;
      if (isMissing(error)) throw new AssetRepositoryError("not_found", "The image does not exist.", 404);
      throw toRepositoryError(error);
    }
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLocaleLowerCase("en").startsWith("application/json")) {
    throw new AssetRepositoryError("invalid_request", "Image writes require an application/json body.", 415);
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_UPLOAD_BODY_BYTES) {
      throw new AssetRepositoryError("invalid_request", "The image request is too large.", 413);
    }
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as Record<string, unknown>;
  } catch {
    throw new AssetRepositoryError("invalid_request", "The request body is not valid JSON.", 400);
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

type NextFunction = (error?: unknown) => void;

export function createAssetApiMiddleware(repository: DiskAssetRepository) {
  return async function assetApiMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: NextFunction,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://math-atlas.local");
    if (!url.pathname.startsWith("/api/assets")) {
      next();
      return;
    }
    try {
      if (request.method === "POST" && url.pathname === "/api/assets") {
        const body = await readJsonBody(request);
        const mediaType = body.mediaType;
        if (
          typeof body.name !== "string" ||
          typeof body.dataBase64 !== "string" ||
          (mediaType !== undefined && typeof mediaType !== "string")
        ) {
          throw new AssetRepositoryError(
            "invalid_request",
            "An image name, optional media type, and base64 data are required.",
            400,
          );
        }
        const saved = await repository.storeImage(
          body.name,
          typeof mediaType === "string" ? mediaType : undefined,
          decodeImageBase64(body.dataBase64),
        );
        sendJson(response, saved.deduplicated ? 200 : 201, saved);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/assets/file") {
        const relativePath = url.searchParams.get("path");
        if (relativePath === null) {
          throw new AssetRepositoryError("invalid_request", "A canonical image path is required.", 400);
        }
        const asset = await repository.readImage(relativePath);
        const etag = `"${asset.sha256}"`;
        response.setHeader("Content-Type", asset.mediaType);
        response.setHeader("Content-Length", asset.byteLength);
        response.setHeader("Content-Disposition", `inline; filename="${path.posix.basename(asset.path)}"`);
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("ETag", etag);
        if (request.headers["if-none-match"] === etag) {
          response.statusCode = 304;
          response.removeHeader("Content-Length");
          response.end();
          return;
        }
        response.statusCode = 200;
        response.end(asset.bytes);
        return;
      }

      throw new AssetRepositoryError("not_found", "Image endpoint not found.", 404);
    } catch (error) {
      const repositoryError = toRepositoryError(error);
      sendJson(response, repositoryError.status, {
        error: { code: repositoryError.code, message: repositoryError.message },
      });
    }
  };
}

export function assetApiPlugin(contentRoot: string): Plugin {
  const middleware = createAssetApiMiddleware(new DiskAssetRepository(contentRoot));
  return {
    name: "math-atlas-asset-api",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
