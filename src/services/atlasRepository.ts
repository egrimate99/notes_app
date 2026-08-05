import {
  validateAtlasMetadata,
  type AtlasMetadata,
  type AtlasMetadataDocument,
  type AtlasRecoveryReason,
} from "../domain/atlasMetadata";

export type AtlasRepositoryErrorCode =
  | "conflict"
  | "invalid_metadata"
  | "invalid_request"
  | "io_error"
  | "unavailable";

export class AtlasRepositoryError extends Error {
  constructor(
    public readonly code: AtlasRepositoryErrorCode,
    message: string,
    public readonly currentRevision?: string,
    public readonly status?: number,
    public readonly issues?: string[],
  ) {
    super(message);
    this.name = "AtlasRepositoryError";
  }
}

export interface AtlasRepository {
  readAtlas(snapshotKey: string): Promise<AtlasMetadataDocument>;
  /** Null means create-only; otherwise pass the latest opaque revision token. */
  writeAtlas(
    atlas: AtlasMetadata,
    expectedRevision: string | null,
  ): Promise<AtlasMetadataDocument>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFromPayload(payload: unknown, status: number): AtlasRepositoryError {
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  return new AtlasRepositoryError(
    typeof envelope?.code === "string"
      ? (envelope.code as AtlasRepositoryErrorCode)
      : "io_error",
    typeof envelope?.message === "string"
      ? envelope.message
      : `The atlas service returned an error (${status}).`,
    typeof envelope?.currentRevision === "string" ? envelope.currentRevision : undefined,
    status,
    Array.isArray(envelope?.issues)
      ? envelope.issues.filter((issue): issue is string => typeof issue === "string")
      : undefined,
  );
}

const recoveryReasons = new Set<AtlasRecoveryReason>([
  "missing",
  "too-large",
  "invalid-utf8",
  "invalid-json",
  "invalid-schema",
]);

function parseDocument(payload: unknown): AtlasMetadataDocument {
  if (!isRecord(payload)) {
    throw new AtlasRepositoryError("io_error", "The atlas service returned an invalid document.");
  }
  const validation = validateAtlasMetadata(payload.atlas);
  const revision = payload.revision;
  if (!validation.valid || (revision !== null && typeof revision !== "string")) {
    throw new AtlasRepositoryError(
      "io_error",
      "The atlas service returned metadata that failed schema validation.",
      undefined,
      undefined,
      validation.issues,
    );
  }
  const recovery = isRecord(payload.recovery) ? payload.recovery : undefined;
  const reason = recovery?.reason;
  const message = recovery?.message;
  return {
    atlas: validation.value,
    revision: revision as string | null,
    ...(recoveryReasons.has(reason as AtlasRecoveryReason) && typeof message === "string"
      ? {
          recovery: {
            reason: reason as AtlasRecoveryReason,
            message,
            ...(Array.isArray(recovery?.issues)
              ? {
                  issues: recovery.issues.filter(
                    (issue): issue is string => typeof issue === "string",
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}

type Fetcher = typeof fetch;

export class ViteAtlasRepository implements AtlasRepository {
  constructor(
    private readonly apiUrl = "/api/atlas",
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  async readAtlas(snapshotKey: string): Promise<AtlasMetadataDocument> {
    const query = new URLSearchParams({ snapshotKey });
    return this.request(`${this.apiUrl}?${query.toString()}`, { method: "GET" });
  }

  async writeAtlas(
    atlas: AtlasMetadata,
    expectedRevision: string | null,
  ): Promise<AtlasMetadataDocument> {
    return this.request(this.apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atlas, expectedRevision }),
    });
  }

  private async request(url: string, init: RequestInit): Promise<AtlasMetadataDocument> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (error) {
      throw new AtlasRepositoryError(
        "unavailable",
        error instanceof Error ? error.message : "The local atlas service is unavailable.",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AtlasRepositoryError(
        "io_error",
        `The atlas service returned invalid JSON (${response.status}).`,
        undefined,
        response.status,
      );
    }
    if (!response.ok) throw errorFromPayload(payload, response.status);
    return parseDocument(payload);
  }
}

export const atlasRepository: AtlasRepository = new ViteAtlasRepository();
