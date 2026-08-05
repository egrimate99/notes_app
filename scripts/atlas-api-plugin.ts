import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { Plugin } from "vite";
import {
  DEFAULT_ATLAS_SNAPSHOT_KEY,
  emptyAtlasMetadata,
  validateAtlasMetadata,
  type AtlasMetadata,
  type AtlasMetadataDocument,
} from "../src/domain/atlasMetadata";

export const ATLAS_METADATA_DIRECTORY = ".math-atlas";
export const ATLAS_METADATA_FILENAME = "atlas.json";
const MAX_ATLAS_BYTES = 16 * 1024 * 1024;

export type AtlasRepositoryErrorCode =
  | "conflict"
  | "invalid_metadata"
  | "invalid_request"
  | "io_error";

export class AtlasRepositoryError extends Error {
  constructor(
    public readonly code: AtlasRepositoryErrorCode,
    message: string,
    public readonly status: number,
    public readonly currentRevision?: string,
    public readonly issues?: string[],
  ) {
    super(message);
    this.name = "AtlasRepositoryError";
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toRepositoryError(error: unknown): AtlasRepositoryError {
  if (error instanceof AtlasRepositoryError) return error;
  return new AtlasRepositoryError(
    "io_error",
    error instanceof Error ? error.message : "The atlas metadata operation failed.",
    500,
  );
}

function revisionFor(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

async function revisionForFile(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  return `sha256-${hash.digest("hex")}`;
}

function normalizedSnapshotKey(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 256 ||
    normalized.includes("\0") ||
    emptyAtlasMetadata(normalized).snapshotKey !== normalized
  ) {
    throw new AtlasRepositoryError(
      "invalid_request",
      "The atlas snapshot key is invalid.",
      400,
    );
  }
  return normalized;
}

/** Filesystem repository for the one canonical content/.math-atlas/atlas.json. */
export class DiskAtlasRepository {
  private resolvedRoot?: Promise<string>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly configuredContentRoot: string) {}

  private root(): Promise<string> {
    this.resolvedRoot ??= (async () => {
      await mkdir(this.configuredContentRoot, { recursive: true });
      const metadata = await lstat(this.configuredContentRoot);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new AtlasRepositoryError(
          "io_error",
          "The configured content root must be a real directory.",
          500,
        );
      }
      return realpath(this.configuredContentRoot);
    })();
    return this.resolvedRoot;
  }

  private async metadataDirectory(create: boolean): Promise<string> {
    const root = await this.root();
    const directory = path.join(root, ATLAS_METADATA_DIRECTORY);
    try {
      const metadata = await lstat(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new AtlasRepositoryError(
          "io_error",
          "The atlas metadata directory must not be a link or file.",
          500,
        );
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (!create) return directory;
      await mkdir(directory, { recursive: false });
      const metadata = await lstat(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new AtlasRepositoryError(
          "io_error",
          "The atlas metadata directory could not be created safely.",
          500,
        );
      }
    }
    return directory;
  }

  private async metadataPath(createDirectory: boolean): Promise<string> {
    return path.join(
      await this.metadataDirectory(createDirectory),
      ATLAS_METADATA_FILENAME,
    );
  }

  async readAtlas(
    fallbackSnapshotKey = DEFAULT_ATLAS_SNAPSHOT_KEY,
  ): Promise<AtlasMetadataDocument> {
    const snapshotKey = normalizedSnapshotKey(fallbackSnapshotKey);
    try {
      const absolutePath = await this.metadataPath(false);
      let metadata;
      try {
        metadata = await lstat(absolutePath);
      } catch (error) {
        if (isMissing(error)) {
          return {
            atlas: emptyAtlasMetadata(snapshotKey),
            revision: null,
            recovery: {
              reason: "missing",
              message: "No atlas metadata file exists yet; an empty atlas was loaded.",
            },
          };
        }
        throw error;
      }
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new AtlasRepositoryError(
          "io_error",
          "The atlas metadata path must be a regular file.",
          500,
        );
      }

      if (metadata.size > MAX_ATLAS_BYTES) {
        return {
          atlas: emptyAtlasMetadata(snapshotKey),
          revision: await revisionForFile(absolutePath),
          recovery: {
            reason: "too-large",
            message: "The atlas metadata file is too large to load safely.",
          },
        };
      }

      const bytes = await readFile(absolutePath);
      const revision = revisionFor(bytes);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return {
          atlas: emptyAtlasMetadata(snapshotKey),
          revision,
          recovery: {
            reason: "invalid-utf8",
            message: "The atlas metadata file is not valid UTF-8.",
          },
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          atlas: emptyAtlasMetadata(snapshotKey),
          revision,
          recovery: {
            reason: "invalid-json",
            message: "The atlas metadata file is not valid JSON.",
          },
        };
      }

      const validation = validateAtlasMetadata(parsed, snapshotKey);
      if (!validation.valid) {
        return {
          atlas: emptyAtlasMetadata(snapshotKey),
          revision,
          recovery: {
            reason: "invalid-schema",
            message: "The atlas metadata schema is invalid; an empty atlas was loaded.",
            issues: validation.issues,
          },
        };
      }
      return { atlas: validation.value, revision };
    } catch (error) {
      throw toRepositoryError(error);
    }
  }

  writeAtlas(
    atlas: AtlasMetadata,
    expectedRevision: string | null,
  ): Promise<AtlasMetadataDocument> {
    const operation = this.writeQueue.then(() =>
      this.performWrite(atlas, expectedRevision),
    );
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performWrite(
    atlas: AtlasMetadata,
    expectedRevision: string | null,
  ): Promise<AtlasMetadataDocument> {
    const validation = validateAtlasMetadata(atlas, atlas?.snapshotKey);
    if (!validation.valid) {
      throw new AtlasRepositoryError(
        "invalid_metadata",
        "The atlas metadata did not pass schema validation.",
        422,
        undefined,
        validation.issues,
      );
    }
    const normalized = validation.value;
    const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    if (bytes.byteLength > MAX_ATLAS_BYTES) {
      throw new AtlasRepositoryError(
        "invalid_metadata",
        "The atlas metadata cannot be larger than 16 MiB.",
        422,
      );
    }

    const current = await this.readAtlas(normalized.snapshotKey);
    this.assertExpectedRevision(current.revision, expectedRevision);
    const directory = await this.metadataDirectory(true);
    const absolutePath = path.join(directory, ATLAS_METADATA_FILENAME);
    const temporaryPath = path.join(
      directory,
      `.${ATLAS_METADATA_FILENAME}.${randomUUID()}.tmp`,
    );

    try {
      const temporaryFile = await open(temporaryPath, "wx", 0o600);
      try {
        await temporaryFile.writeFile(bytes);
        await temporaryFile.sync();
      } finally {
        await temporaryFile.close();
      }

      // Recheck after the temporary file is durable. Together with the queue,
      // this catches concurrent app saves and almost all external-editor races.
      const latest = await this.readAtlas(normalized.snapshotKey);
      this.assertExpectedRevision(latest.revision, expectedRevision);
      await rename(temporaryPath, absolutePath);

      // Best-effort directory sync makes the rename durable where the platform
      // supports opening directories as file handles.
      try {
        const directoryHandle = await open(directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      } catch {
        // Windows does not consistently permit directory handles; file fsync +
        // same-directory atomic rename remains the strongest portable path.
      }
    } catch (error) {
      throw toRepositoryError(error);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    return { atlas: normalized, revision: revisionFor(bytes) };
  }

  private assertExpectedRevision(
    currentRevision: string | null,
    expectedRevision: string | null,
  ): void {
    if (currentRevision === expectedRevision) return;
    throw new AtlasRepositoryError(
      "conflict",
      currentRevision
        ? "The atlas changed on disk. Reload it before saving map edits."
        : "The atlas metadata file was removed before the save completed.",
      409,
      currentRevision ?? undefined,
    );
  }
}

interface ErrorPayload {
  error: {
    code: AtlasRepositoryErrorCode;
    message: string;
    currentRevision?: string;
    issues?: string[];
  };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLocaleLowerCase("en").startsWith("application/json")) {
    throw new AtlasRepositoryError(
      "invalid_request",
      "Atlas writes require an application/json body.",
      415,
    );
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_ATLAS_BYTES + 16_384) {
      throw new AtlasRepositoryError("invalid_request", "The atlas request is too large.", 413);
    }
    chunks.push(bytes);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new AtlasRepositoryError("invalid_request", "The request body is not valid JSON.", 400);
  }
}

type NextFunction = (error?: unknown) => void;

export function createAtlasApiMiddleware(repository: DiskAtlasRepository) {
  return async function atlasApiMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: NextFunction,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://math-atlas.local");
    if (!url.pathname.startsWith("/api/atlas")) {
      next();
      return;
    }
    try {
      if (url.pathname !== "/api/atlas") {
        throw new AtlasRepositoryError("invalid_request", "Atlas endpoint not found.", 404);
      }
      if (request.method === "GET") {
        sendJson(
          response,
          200,
          await repository.readAtlas(
            url.searchParams.get("snapshotKey") ?? DEFAULT_ATLAS_SNAPSHOT_KEY,
          ),
        );
        return;
      }
      if (request.method === "PUT") {
        const body = await readJsonBody(request);
        if (!("atlas" in body) || !("expectedRevision" in body)) {
          throw new AtlasRepositoryError(
            "invalid_request",
            "Atlas metadata and an expected revision are required.",
            400,
          );
        }
        if (body.expectedRevision !== null && typeof body.expectedRevision !== "string") {
          throw new AtlasRepositoryError(
            "invalid_request",
            "The expected revision must be a string or null.",
            400,
          );
        }
        sendJson(
          response,
          200,
          await repository.writeAtlas(
            body.atlas as AtlasMetadata,
            body.expectedRevision as string | null,
          ),
        );
        return;
      }
      throw new AtlasRepositoryError("invalid_request", "Method not allowed.", 405);
    } catch (error) {
      const repositoryError = toRepositoryError(error);
      const payload: ErrorPayload = {
        error: {
          code: repositoryError.code,
          message: repositoryError.message,
          ...(repositoryError.currentRevision
            ? { currentRevision: repositoryError.currentRevision }
            : {}),
          ...(repositoryError.issues ? { issues: repositoryError.issues } : {}),
        },
      };
      sendJson(response, repositoryError.status, payload);
    }
  };
}

export function atlasApiPlugin(contentRoot: string): Plugin {
  const repository = new DiskAtlasRepository(contentRoot);
  const middleware = createAtlasApiMiddleware(repository);
  return {
    name: "math-atlas-metadata-api",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
