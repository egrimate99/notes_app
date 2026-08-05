import { describe, expect, it, vi } from "vitest";
import {
  NoteRepositoryError,
  TauriNoteRepository,
  ViteNoteRepository,
  type NoteDocument,
} from "./noteRepository";

const document: NoteDocument = {
  path: "Synthetic Field/Margins.md",
  markdown: "$\\gamma$",
  revision: "sha256-current",
  aliases: ["geometric margin", "margin"],
};

describe("ViteNoteRepository", () => {
  it("preserves frontmatter aliases returned with the content tree", async () => {
    const tree = [{
      type: "directory",
      name: "Synthetic Field 02",
      path: "Synthetic Field 02",
      children: [{
        type: "file",
        name: "Public Fixture Note 002.md",
        path: "Primary Field/Public Fixture Note 002.md",
        aliases: ["continuous map"],
      }],
    }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(tree), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const repository = new ViteNoteRepository("/api/content", fetcher as typeof fetch);

    await expect(repository.listTree()).resolves.toEqual(tree);
  });

  it("reads a content-relative path without losing spaces", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(document), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const repository = new ViteNoteRepository(
      "/api/content",
      fetcher as typeof fetch,
    );

    await expect(repository.readNote(document.path)).resolves.toEqual(document);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/content/file?path=Synthetic+Field%2FMargins.md",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("sends the exact Markdown and expected revision when saving", async () => {
    const saved = { ...document, revision: "sha256-next" };
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(saved), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const repository = new ViteNoteRepository(
      "/api/content",
      fetcher as typeof fetch,
    );

    await expect(
      repository.writeNote(document.path, document.markdown, document.revision),
    ).resolves.toEqual(saved);
    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      markdown: document.markdown,
      expectedRevision: document.revision,
    });
  });

  it("surfaces a revision conflict with the on-disk revision", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: {
              code: "conflict",
              message: "The note changed on disk.",
              currentRevision: "sha256-external",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    const repository = new ViteNoteRepository(
      "/api/content",
      fetcher as typeof fetch,
    );

    const failure = await repository
      .writeNote(document.path, "edited", document.revision)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NoteRepositoryError);
    expect(failure).toMatchObject({
      code: "conflict",
      currentRevision: "sha256-external",
      status: 409,
    });
  });

  it("uses focused endpoints for folder, move, trash, and restore operations", async () => {
    const responses = [
      { path: "Primary Field/Linear models", type: "directory" },
      { path: "Primary Field/Margins.md", type: "file" },
      {
        token: "4e38c477-b3c8-4dd8-a488-b049ad6b2952",
        deletedAt: "2026-08-04T00:00:00.000Z",
        originalPath: "Primary Field/Margins.md",
        path: "Primary Field/Margins.md",
        type: "file",
      },
      { path: "Primary Field/Margins.md", type: "file" },
    ];
    const fetcher = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const repository = new ViteNoteRepository("/api/content", fetcher as typeof fetch);

    await repository.createFolder("Primary Field/Linear models");
    await repository.moveEntry("Primary Field/Margin.md", "Primary Field/Margins.md");
    const receipt = await repository.trashEntry("Primary Field/Margins.md");
    await repository.restoreEntry(receipt.token);

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/content/folder", "POST"],
      ["/api/content/move", "POST"],
      ["/api/content/entry?path=Primary+Field%2FMargins.md", "DELETE"],
      ["/api/content/restore", "POST"],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      path: "Primary Field/Margin.md",
      destinationPath: "Primary Field/Margins.md",
    });
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({
      token: "4e38c477-b3c8-4dd8-a488-b049ad6b2952",
    });
  });
});

describe("TauriNoteRepository", () => {
  it("uses dedicated content commands and translates structured errors", async () => {
    let lastCall: { command: string; args?: Record<string, unknown> } | undefined;
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      lastCall = { command, args };
      if (command === "read_content_file") return document as T;
      throw { code: "invalid_path", message: "Outside content." };
    };
    const repository = new TauriNoteRepository(invoke);

    await expect(repository.readNote(document.path)).resolves.toEqual(document);
    expect(lastCall).toEqual({ command: "read_content_file", args: {
      path: document.path,
    } });
    await expect(repository.listTree()).rejects.toMatchObject({
      code: "invalid_path",
      message: "Outside content.",
    });
  });

  it("routes file mutations through dedicated Tauri commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === "trash_content_entry") {
        return {
          path: "Primary Field/Margin.md",
          originalPath: "Primary Field/Margin.md",
          type: "file",
          token: "4e38c477-b3c8-4dd8-a488-b049ad6b2952",
          deletedAt: "2026-08-04T00:00:00.000Z",
        } as T;
      }
      return { path: "Primary Field/Margin.md", type: "file" } as T;
    };
    const repository = new TauriNoteRepository(invoke);

    await repository.createFolder("Primary Field/Linear models");
    await repository.moveEntry("Primary Field/Margin.md", "Primary Field/Margins.md");
    const receipt = await repository.trashEntry("Primary Field/Margin.md");
    await repository.restoreEntry(receipt.token);

    expect(calls).toEqual([
      { command: "create_content_folder", args: { path: "Primary Field/Linear models" } },
      {
        command: "move_content_entry",
        args: { path: "Primary Field/Margin.md", destinationPath: "Primary Field/Margins.md" },
      },
      { command: "trash_content_entry", args: { path: "Primary Field/Margin.md" } },
      {
        command: "restore_content_entry",
        args: { token: "4e38c477-b3c8-4dd8-a488-b049ad6b2952" },
      },
    ]);
  });
});
