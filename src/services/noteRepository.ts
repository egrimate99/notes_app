import { invoke, isTauri } from "@tauri-apps/api/core";

export type NoteTreeEntry =
  | {
      type: "directory";
      name: string;
      path: string;
      children: NoteTreeEntry[];
    }
  | {
      type: "file";
      name: string;
      path: string;
      /** Stable landmark identity read from canonical YAML frontmatter. */
      id?: string;
      /** Obsidian-compatible aliases read from canonical YAML frontmatter. */
      aliases?: string[];
    };

export interface NoteDocument {
  /** A forward-slash path relative to the project's content directory. */
  path: string;
  /** The editable Markdown body. Structural YAML frontmatter stays on disk. */
  markdown: string;
  /** An opaque revision token used to prevent overwriting external edits. */
  revision: string;
  /** Stable landmark identity read from canonical YAML frontmatter. */
  id?: string;
  /** Obsidian-compatible aliases read from canonical YAML frontmatter. */
  aliases?: string[];
}

export type ContentEntryKind = "directory" | "file";

export interface ContentMutationResult {
  path: string;
  type: ContentEntryKind;
}

export interface DeletedContentReceipt extends ContentMutationResult {
  token: string;
  deletedAt: string;
  originalPath: string;
}

export type NoteRepositoryErrorCode =
  | "conflict"
  | "invalid_markdown"
  | "invalid_path"
  | "invalid_request"
  | "io_error"
  | "not_found"
  | "unavailable";

export class NoteRepositoryError extends Error {
  constructor(
    public readonly code: NoteRepositoryErrorCode,
    message: string,
    public readonly currentRevision?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NoteRepositoryError";
  }
}

export interface NoteRepository {
  listTree(): Promise<NoteTreeEntry[]>;
  readNote(path: string): Promise<NoteDocument>;
  /**
   * Pass the revision returned by readNote. A null revision means "create only"
   * and will conflict if the path already exists.
   */
  writeNote(
    path: string,
    markdown: string,
    expectedRevision: string | null,
  ): Promise<NoteDocument>;
  createFolder(path: string): Promise<ContentMutationResult>;
  moveEntry(path: string, destinationPath: string): Promise<ContentMutationResult>;
  trashEntry(path: string): Promise<DeletedContentReceipt>;
  restoreEntry(token: string): Promise<ContentMutationResult>;
}

interface ErrorShape {
  code?: unknown;
  message?: unknown;
  currentRevision?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorShape(value: unknown): ErrorShape | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.error) ? value.error : value;
  return nested;
}

function repositoryError(error: unknown, status?: number): NoteRepositoryError {
  if (error instanceof NoteRepositoryError) return error;
  const shape = errorShape(error);
  const code =
    typeof shape?.code === "string"
      ? (shape.code as NoteRepositoryErrorCode)
      : "io_error";
  const message =
    typeof shape?.message === "string"
      ? shape.message
      : typeof error === "string"
        ? error
        : "The note operation failed.";
  const currentRevision =
    typeof shape?.currentRevision === "string"
      ? shape.currentRevision
      : undefined;
  return new NoteRepositoryError(code, message, currentRevision, status);
}

type Fetcher = typeof fetch;

export class ViteNoteRepository implements NoteRepository {
  constructor(
    private readonly apiRoot = "/api/content",
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  async listTree(): Promise<NoteTreeEntry[]> {
    return this.request<NoteTreeEntry[]>(`${this.apiRoot}/tree`, {
      method: "GET",
    });
  }

  async readNote(path: string): Promise<NoteDocument> {
    return this.request<NoteDocument>(this.fileUrl(path), { method: "GET" });
  }

  async writeNote(
    path: string,
    markdown: string,
    expectedRevision: string | null,
  ): Promise<NoteDocument> {
    return this.request<NoteDocument>(this.fileUrl(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown, expectedRevision }),
    });
  }

  async createFolder(path: string): Promise<ContentMutationResult> {
    return this.request<ContentMutationResult>(`${this.apiRoot}/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  }

  async moveEntry(
    path: string,
    destinationPath: string,
  ): Promise<ContentMutationResult> {
    return this.request<ContentMutationResult>(`${this.apiRoot}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, destinationPath }),
    });
  }

  async trashEntry(path: string): Promise<DeletedContentReceipt> {
    const query = new URLSearchParams({ path });
    return this.request<DeletedContentReceipt>(`${this.apiRoot}/entry?${query}`, {
      method: "DELETE",
    });
  }

  async restoreEntry(token: string): Promise<ContentMutationResult> {
    return this.request<ContentMutationResult>(`${this.apiRoot}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }

  private fileUrl(path: string): string {
    const query = new URLSearchParams({ path });
    return `${this.apiRoot}/file?${query.toString()}`;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (error) {
      throw new NoteRepositoryError(
        "unavailable",
        error instanceof Error
          ? error.message
          : "The local content service is unavailable.",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NoteRepositoryError(
        "io_error",
        `The local content service returned an invalid response (${response.status}).`,
        undefined,
        response.status,
      );
    }

    if (!response.ok) throw repositoryError(payload, response.status);
    return payload as T;
  }
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class TauriNoteRepository implements NoteRepository {
  constructor(private readonly invokeCommand: Invoke = invoke) {}

  async listTree(): Promise<NoteTreeEntry[]> {
    return this.call<NoteTreeEntry[]>("list_content_tree");
  }

  async readNote(path: string): Promise<NoteDocument> {
    return this.call<NoteDocument>("read_content_file", { path });
  }

  async writeNote(
    path: string,
    markdown: string,
    expectedRevision: string | null,
  ): Promise<NoteDocument> {
    return this.call<NoteDocument>("write_content_file", {
      path,
      markdown,
      expectedRevision,
    });
  }

  async createFolder(path: string): Promise<ContentMutationResult> {
    return this.call<ContentMutationResult>("create_content_folder", { path });
  }

  async moveEntry(
    path: string,
    destinationPath: string,
  ): Promise<ContentMutationResult> {
    return this.call<ContentMutationResult>("move_content_entry", {
      path,
      destinationPath,
    });
  }

  async trashEntry(path: string): Promise<DeletedContentReceipt> {
    return this.call<DeletedContentReceipt>("trash_content_entry", { path });
  }

  async restoreEntry(token: string): Promise<ContentMutationResult> {
    return this.call<ContentMutationResult>("restore_content_entry", { token });
  }

  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await this.invokeCommand<T>(command, args);
    } catch (error) {
      throw repositoryError(error);
    }
  }
}

export function createNoteRepository(): NoteRepository {
  try {
    return isTauri() ? new TauriNoteRepository() : new ViteNoteRepository();
  } catch {
    return new ViteNoteRepository();
  }
}

export const noteRepository = createNoteRepository();
