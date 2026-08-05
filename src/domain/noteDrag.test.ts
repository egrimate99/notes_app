import { describe, expect, it } from "vitest";
import {
  NOTE_FILE_DRAG_MIME,
  collectNoteFileDragItems,
  readNoteFileDragItems,
  readNoteFileDragPayload,
  serializeNoteFileDragBatchPayload,
  serializeNoteFileDragPayload,
  writeNoteFileDragBatchPayload,
  type NoteFileDragTreeEntry,
} from "./noteDrag";

function transfer(raw: string) {
  return {
    getData: (type: string) => type === NOTE_FILE_DRAG_MIME ? raw : "",
  };
}

describe("note drag payload", () => {
  it("round-trips a relative Markdown note identity", () => {
    const raw = serializeNoteFileDragPayload({
      path: "Primary Field/Limits.md",
      title: "Limits",
      noteId: "primary-limits",
    });

    expect(readNoteFileDragPayload(transfer(raw))).toEqual({
      kind: "math-atlas-note",
      version: 1,
      path: "Primary Field/Limits.md",
      title: "Limits",
      noteId: "primary-limits",
    });
  });

  it.each([
    "",
    "not-json",
    JSON.stringify({ kind: "math-atlas-note", version: 2, path: "A.md", title: "A" }),
    JSON.stringify({ kind: "math-atlas-note", version: 1, path: "../A.md", title: "A" }),
    JSON.stringify({ kind: "math-atlas-note", version: 1, path: "C:\\A.md", title: "A" }),
    JSON.stringify({ kind: "math-atlas-note", version: 1, path: "A.txt", title: "A" }),
  ])("rejects invalid or unsafe payloads", (raw) => {
    expect(readNoteFileDragPayload(transfer(raw))).toBeUndefined();
  });

  it("reads legacy single-note payloads through the batch-friendly API", () => {
    const raw = serializeNoteFileDragPayload({
      path: "Secondary Field/Martingales.md",
      title: "Martingales",
    });

    expect(readNoteFileDragItems(transfer(raw))).toEqual([{
      path: "Secondary Field/Martingales.md",
      title: "Martingales",
    }]);
  });

  it("round-trips an ordered batch and removes duplicate note paths", () => {
    const raw = serializeNoteFileDragBatchPayload([
      { path: "Primary Field/Limits.md", title: "Limits", noteId: "limits" },
      { path: "Secondary Field/Bayes.md", title: "Bayes" },
      { path: "primary field/limits.md", title: "Duplicate limits" },
    ]);

    expect(readNoteFileDragItems(transfer(raw))).toEqual([
      { path: "Primary Field/Limits.md", title: "Limits", noteId: "limits" },
      { path: "Secondary Field/Bayes.md", title: "Bayes" },
    ]);
    // The old singular reader remains intentionally strict.
    expect(readNoteFileDragPayload(transfer(raw))).toBeUndefined();
  });

  it.each([
    JSON.stringify({ kind: "math-atlas-note-batch", version: 2, notes: [] }),
    JSON.stringify({ kind: "math-atlas-note-batch", version: 2, notes: "A.md" }),
    JSON.stringify({
      kind: "math-atlas-note-batch",
      version: 2,
      notes: [{ path: "../A.md", title: "A" }],
    }),
    JSON.stringify({
      kind: "math-atlas-note-batch",
      version: 2,
      notes: [{ path: "A.md", title: "" }],
    }),
    JSON.stringify({
      kind: "math-atlas-note-batch",
      version: 2,
      notes: [{ path: "A.md", title: "A", noteId: "" }],
    }),
  ])("rejects invalid batches as a whole", (raw) => {
    expect(readNoteFileDragItems(transfer(raw))).toBeUndefined();
  });

  it("writes v1 for one item and v2 for a real batch", () => {
    const values = new Map<string, string>();
    const dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed"> = {
      effectAllowed: "none",
      setData: (type: string, value: string) => {
        values.set(type, value);
      },
    };

    writeNoteFileDragBatchPayload(dataTransfer, [{
      path: "Secondary Field/Nash.md",
      title: "Nash",
    }]);
    expect(JSON.parse(values.get(NOTE_FILE_DRAG_MIME) ?? "{}")).toMatchObject({
      kind: "math-atlas-note",
      version: 1,
    });
    expect(values.get("text/plain")).toBe("Secondary Field/Nash.md");

    writeNoteFileDragBatchPayload(dataTransfer, [
      { path: "Secondary Field/Nash.md", title: "Nash" },
      { path: "Archive Field/Options.md", title: "Options" },
    ]);
    expect(JSON.parse(values.get(NOTE_FILE_DRAG_MIME) ?? "{}")).toMatchObject({
      kind: "math-atlas-note-batch",
      version: 2,
    });
    expect(values.get("text/plain")).toBe("Secondary Field/Nash.md\nArchive Field/Options.md");
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("refuses to serialize an empty or malformed batch", () => {
    expect(() => serializeNoteFileDragBatchPayload([])).toThrow(TypeError);
    expect(() => serializeNoteFileDragBatchPayload([
      { path: "unsafe.txt", title: "Unsafe" },
    ])).toThrow(TypeError);
  });
});

describe("collectNoteFileDragItems", () => {
  const tree: NoteFileDragTreeEntry[] = [
    {
      type: "directory",
      name: "Synthetic Field 02",
      path: "Synthetic Field 02",
      children: [
        {
          type: "file",
          name: "Limits.md",
          path: "Primary Field/Limits.md",
          id: "limits",
        },
        {
          type: "directory",
          name: "Calculus",
          path: "Primary Field/Calculus",
          children: [
            {
              type: "file",
              name: "Chain rule.md",
              path: "Primary Field/Calculus/Chain rule.md",
            },
            {
              type: "file",
              name: "Not markdown.txt",
              path: "Primary Field/Calculus/Not markdown.txt",
            },
          ],
        },
      ],
    },
    {
      type: "directory",
      name: "Synthetic Field 03",
      path: "Synthetic Field 03",
      children: [{
        type: "file",
        name: "Discounting.md",
        path: "Archive Field/Discounting.md",
        id: "discounting",
      }],
    },
  ];

  it("recursively expands folders in root order and deduplicates overlaps", () => {
    expect(collectNoteFileDragItems(tree, [
      "Archive Field/Discounting.md",
      "Synthetic Field 02",
      "Primary Field/Calculus/Chain rule.md",
      "primary field/limits.md",
    ])).toEqual([
      {
        path: "Archive Field/Discounting.md",
        title: "Discounting",
        noteId: "discounting",
      },
      {
        path: "Primary Field/Limits.md",
        title: "Limits",
        noteId: "limits",
      },
      {
        path: "Primary Field/Calculus/Chain rule.md",
        title: "Chain rule",
      },
    ]);
  });

  it("matches normalized selection paths and ignores missing entries", () => {
    expect(collectNoteFileDragItems(tree, [
      "primary field\\calculus",
      "Missing",
    ])).toEqual([{
      path: "Primary Field/Calculus/Chain rule.md",
      title: "Chain rule",
    }]);
  });
});
