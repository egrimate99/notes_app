import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const repository = vi.hoisted(() => ({
  listTree: vi.fn(async () => [
    { type: "directory", name: "Synthetic Archive", path: "Synthetic Archive", children: [] },
    {
      type: "directory",
      name: "Synthetic Field 02",
      path: "Synthetic Field 02",
      children: [
        {
          type: "file",
          name: "Discounting.md",
          path: "Synthetic Field 02/Discounting.md",
          id: "fixture-discounting",
        },
      ],
    },
    {
      type: "directory",
      name: "Synthetic Field",
      path: "Synthetic Field",
      children: [
        {
          type: "directory",
          name: "Public Examples",
          path: "Synthetic Field/Public Examples",
          children: [
            {
              type: "directory",
              name: "Fixture Collection",
              path: "Synthetic Field/Public Examples/Fixture Collection",
              children: [
                {
                  type: "file",
                  name: "Public Fixture Note Alpha.md",
                  path: "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Alpha.md",
                  id: "fixture-orchid-lemma",
                },
                {
                  type: "file",
                  name: "Public Fixture Note Beta.md",
                  path: "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Beta.md",
                  id: "fixture-azure-corollary",
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "directory", name: "Fixture Archive", path: "Fixture Archive", children: [] },
  ]),
  readNote: vi.fn(async (path: string) => ({
    path,
    markdown: `A real Markdown file for **${path}** with $x^2$.`,
    revision: `revision:${path}`,
  })),
  writeNote: vi.fn(async (path: string, markdown: string) => ({
    path,
    markdown,
    revision: `saved:${path}`,
  })),
  createFolder: vi.fn(async (path: string) => ({
    path,
    type: "directory" as const,
  })),
  moveEntry: vi.fn(async (_path: string, destinationPath: string) => ({
    path: destinationPath,
    type: destinationPath.toLocaleLowerCase().endsWith(".md")
      ? "file" as const
      : "directory" as const,
  })),
  trashEntry: vi.fn(async (path: string) => ({
    token: "4e38c477-b3c8-4dd8-a488-b049ad6b2952",
    deletedAt: "2026-08-04T00:00:00.000Z",
    originalPath: path,
    path,
    type: path.toLocaleLowerCase().endsWith(".md")
      ? "file" as const
      : "directory" as const,
  })),
  restoreEntry: vi.fn(async (_token: string) => ({
    path: "Reading list.md",
    type: "file" as const,
  })),
}));
const defaultListTreeImplementation = repository.listTree.getMockImplementation()!;
const defaultWriteNoteImplementation = repository.writeNote.getMockImplementation()!;

const atlasRepositoryMock = vi.hoisted(() => ({
  readAtlas: vi.fn(async () => ({
    atlas: {},
    revision: null,
    recovery: { reason: "missing", message: "Not created yet." },
  })),
  writeAtlas: vi.fn(async (atlas: unknown, _expectedRevision?: string | null) => ({
    atlas,
    revision: "atlas-revision",
  })),
}));

const desktopSurfaceMock = vi.hoisted(() => {
  let listener: ((status: unknown) => void) | undefined;
  return {
    isAvailable: vi.fn(() => false),
    getStatus: vi.fn(),
    enter: vi.fn(),
    exit: vi.fn(),
    refresh: vi.fn(),
    onChange: vi.fn(async (next: (status: unknown) => void) => {
      listener = next;
      return () => {
        if (listener === next) listener = undefined;
      };
    }),
    emit(status: unknown) {
      listener?.(status);
    },
    resetListener() {
      listener = undefined;
    },
  };
});
const tauriRuntimeMock = vi.hoisted(() => vi.fn(() => false));
const atlasGraphCapture = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./services/noteRepository", () => ({
  NoteRepositoryError: class NoteRepositoryError extends Error {
    code = "io_error";
  },
  noteRepository: repository,
}));
vi.mock("./services/atlasRepository", () => ({
  AtlasRepositoryError: class AtlasRepositoryError extends Error {
    code = "io_error";
  },
  atlasRepository: atlasRepositoryMock,
}));
vi.mock("./services/desktopSurface", async (importOriginal) => ({
  ...await importOriginal<typeof import("./services/desktopSurface")>(),
  desktopSurface: desktopSurfaceMock,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: tauriRuntimeMock,
}));

// Production starts with an intentionally empty canvas after the full-vault
// replacement. Keep the former pilot graph as a dense interaction fixture so
// movement, copy, selection, rename, and search regressions remain covered.
vi.mock("./data/public-atlas.snapshot.json", async () => ({
  default: (await import("./data/public-atlas.test-fixture.json")).default,
}));

vi.mock("./components/AtlasGraph", () => ({
  AtlasGraph: (props: {
    landmarks: Array<{
      id: string;
      title: string;
      kind?: string;
      contentPath?: string;
    }>;
    placementOverrides: Array<{ landmarkId: string; x: number; y: number }>;
    searchMatchIds?: ReadonlySet<string>;
    previewMarkdownByLandmarkId?: ReadonlyMap<string, string>;
    autoEditNoteId?: string;
    onSelectLandmark: (landmark: { id: string; title: string }) => void;
    onBeginNoteEdit?: (landmark: { id: string; title: string }) => void;
    onSaveNote?: (landmark: { id: string; title: string }, markdown: string) => Promise<void>;
    onPlacementChange: (placement: { landmarkId: string; x: number; y: number }) => void;
    onLandmarkResize?: (bounds: {
      landmarkId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }) => void;
    onCreateLandmark?: (request: {
      kind: "definition" | "concept";
      title: string;
      subjectId: "synthetic-field";
      regionId: string;
      x: number;
      y: number;
      color: string;
      shape: "rectangle";
    }) => void | Promise<void>;
    onPlaceNote?: (request: {
      kind: "math-atlas-note";
      version: 1;
      path: string;
      title: string;
      noteId?: string;
      subjectId: "synthetic-field" | "synthetic-field-02" | "synthetic-decoy";
      regionId: string;
      x: number;
      y: number;
    }) => void;
    onRemoveCanvasObjects?: (request: {
      landmarkIds: readonly string[];
      customGroupIds: readonly string[];
      connectionIds: readonly string[];
    }) => void;
    onCustomizationsChange?: (updater: (current: Record<string, unknown>) => Record<string, unknown>) => void;
    customizations?: {
      customLandmarks?: Array<{
        id: string;
        title?: string;
        kind?: string;
        subjectId?: string;
        regionId?: string;
        contentPath?: string;
      }>;
      customGroups?: Array<{ id: string }>;
      customConnections?: Array<{ id: string }>;
      connectionOverrides?: Record<string, { hidden?: boolean }>;
    };
    viewportStorageKey: string;
  }) => {
    atlasGraphCapture.props = props as unknown as Record<string, unknown>;
    const {
    landmarks,
    placementOverrides,
    searchMatchIds,
    previewMarkdownByLandmarkId,
    autoEditNoteId,
    onSelectLandmark,
    onBeginNoteEdit,
    onSaveNote,
    onPlacementChange,
    onCreateLandmark,
    onPlaceNote,
    onRemoveCanvasObjects,
    customizations,
    viewportStorageKey,
    } = props;
    return (
    <div
      data-testid="atlas-graph"
      data-search-active={searchMatchIds ? "true" : "false"}
      data-search-match-count={searchMatchIds?.size ?? landmarks.length}
      data-viewport-storage-key={viewportStorageKey}
    >
      <output data-testid="placement-state">
        {placementOverrides.length
          ? placementOverrides
              .map(({ landmarkId, x, y }) => `${landmarkId}:${x},${y}`)
              .join("|")
          : "imported-layout"}
      </output>
      <output data-testid="canvas-custom-state">{JSON.stringify({
        landmarkIds: customizations?.customLandmarks?.map(({ id }) => id) ?? [],
        landmarkModels: customizations?.customLandmarks?.map(({
          id,
          title,
          kind,
          subjectId,
          regionId,
        }) => ({ id, title, kind, subjectId, regionId })) ?? [],
        groupIds: customizations?.customGroups?.map(({ id }) => id) ?? [],
        connectionIds: customizations?.customConnections?.map(({ id }) => id) ?? [],
        hiddenConnections: Object.entries(customizations?.connectionOverrides ?? {})
          .filter(([, value]) => value.hidden)
          .map(([id]) => id),
      })}</output>
      <output data-testid="canvas-note-state">{JSON.stringify({
        autoEditNoteId,
        previews: Object.fromEntries(previewMarkdownByLandmarkId ?? []),
      })}</output>
      {landmarks.map((landmark) => (
        <button key={landmark.id} onClick={() => onSelectLandmark(landmark)}>
          {landmark.title}
        </button>
      ))}
      {landmarks[0] && (
        <button
          data-testid="simulate-drag-stop"
          onClick={() =>
            onPlacementChange({ landmarkId: landmarks[0].id, x: 321, y: 654 })
          }
        >
          Simulate drag
        </button>
      )}
      {onPlaceNote && (
        <>
          <button
            data-testid="simulate-note-drop"
            onClick={() => onPlaceNote({
              kind: "math-atlas-note",
              version: 1,
              path: "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Alpha.md",
              title: "Public Fixture Note Alpha",
              noteId: "fixture-orchid-lemma",
              subjectId: "synthetic-field",
              regionId: "fixture-region-details",
              x: 140,
              y: 280,
            })}
          >
            Simulate note drop
          </button>
          <button
            data-testid="simulate-unplaced-note-drop"
            onClick={() => onPlaceNote({
              kind: "math-atlas-note",
              version: 1,
              path: "Synthetic Field 02/Discounting.md",
              title: "Discounting",
              noteId: "fixture-discounting",
              // Model a drop over a spatially unrelated canvas subject. The
              // repository path must remain the canonical classification.
              subjectId: "synthetic-decoy",
              regionId: "subject-zone:synthetic-decoy",
              x: -2408,
              y: 280,
            })}
          >
            Simulate unplaced note drop
          </button>
        </>
      )}
      {onCreateLandmark && (
        <>
          <button
            data-testid="simulate-definition-create"
            onClick={() => void onCreateLandmark({
              kind: "definition",
              title: "Compactness",
              subjectId: "synthetic-field",
              regionId: "fixture-region-examples",
              x: 112,
              y: 224,
              color: "#d62828",
              shape: "rectangle",
            })}
          >
            Simulate definition create
          </button>
          <button
            data-testid="simulate-informal-note-create"
            onClick={() => void onCreateLandmark({
              kind: "concept",
              title: "",
              subjectId: "synthetic-field",
              regionId: "fixture-region-examples",
              x: 112,
              y: 224,
              color: "#d62828",
              shape: "rectangle",
            })}
          >
            Simulate informal note create
          </button>
        </>
      )}
      {onSaveNote && landmarks.filter(({ title }) => title === "Note").map((landmark) => (
        <div key={`inline-controls:${landmark.id}`} data-testid={`inline-note:${landmark.id}`}>
          <button
            type="button"
            data-testid={`begin-inline-note:${landmark.id}`}
            onClick={() => onBeginNoteEdit?.(landmark)}
          >
            Begin inline note
          </button>
          <button
            type="button"
            data-testid={`save-inline-note:${landmark.id}`}
            onClick={() => void onSaveNote(landmark, "Inline note text $x^2$.")}
          >
            Save inline note
          </button>
        </div>
      ))}
      {onRemoveCanvasObjects && landmarks.some(({ id }) => id.startsWith("instance-")) && (
        <button
          data-testid="remove-latest-copy"
          onClick={() => onRemoveCanvasObjects({
            landmarkIds: [[...landmarks].reverse().find(({ id }) => id.startsWith("instance-"))!.id],
            customGroupIds: [],
            connectionIds: [],
          })}
        >
          Remove latest copy
        </button>
      )}
      {onRemoveCanvasObjects && landmarks.filter(({ id }) => id.startsWith("instance-")).length >= 2 && (
        <button
          data-testid="remove-two-latest-copies"
          onClick={() => onRemoveCanvasObjects({
            landmarkIds: landmarks.filter(({ id }) => id.startsWith("instance-")).slice(-2).map(({ id }) => id),
            customGroupIds: [],
            connectionIds: [],
          })}
        >
          Remove two latest copies
        </button>
      )}
    </div>
    );
  },
}));

import App, { wikiNotesFromContentTree } from "./App";

function desktopStatus(active: boolean, layoutRevision = 1, isController = true) {
  const monitor = {
    id: "monitor-1",
    name: "Primary",
    isPrimary: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
  };
  return {
    available: true,
    active,
    role: active ? "monitor" as const : "workspace" as const,
    virtualBounds: { x: -1920, y: 0, width: 5760, height: 2160 },
    monitors: [monitor],
    ...(active ? {
      surface: {
        id: "monitor-1",
        windowLabel: "desktop-monitor-1",
        monitorId: monitor.id,
        isPrimary: true,
        isController,
        bounds: monitor.workArea,
        monitorBounds: monitor.bounds,
        scaleFactor: monitor.scaleFactor,
      },
    } : {}),
    windowScaleFactor: 1,
    layoutRevision,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
beforeEach(() => {
  localStorage.clear();
  atlasGraphCapture.props = undefined;
  repository.listTree.mockReset().mockImplementation(defaultListTreeImplementation);
  repository.readNote.mockReset().mockImplementation(async (path: string) => ({
    path,
    markdown: `A real Markdown file for **${path}** with $x^2$.`,
    revision: `revision:${path}`,
  }));
  repository.writeNote.mockReset().mockImplementation(defaultWriteNoteImplementation);
  repository.createFolder.mockClear();
  repository.moveEntry.mockClear();
  repository.trashEntry.mockClear();
  repository.restoreEntry.mockClear();
  atlasRepositoryMock.readAtlas.mockClear();
  atlasRepositoryMock.writeAtlas.mockClear();
  desktopSurfaceMock.resetListener();
  tauriRuntimeMock.mockReset().mockReturnValue(false);
  desktopSurfaceMock.isAvailable.mockReset().mockReturnValue(false);
  desktopSurfaceMock.getStatus.mockReset().mockResolvedValue(desktopStatus(false));
  desktopSurfaceMock.enter.mockReset().mockResolvedValue(desktopStatus(true, 2));
  desktopSurfaceMock.exit.mockReset().mockResolvedValue(desktopStatus(false, 3));
  desktopSurfaceMock.refresh.mockReset().mockResolvedValue(desktopStatus(true, 4));
  desktopSurfaceMock.onChange.mockClear();
});

describe("App", () => {
  it("keeps generated paper-note storage out of wikilinks without hiding real notes", () => {
    expect(wikiNotesFromContentTree([{
      type: "directory",
      name: "notes",
      path: "notes",
      children: [
        { type: "file", name: "atlas-note-landmark-private.md", path: "notes/atlas-note-landmark-private.md" },
        { type: "file", name: "sample-note.md", path: "notes/sample-note.md" },
      ],
    }])).toEqual([{ path: "notes/sample-note.md", aliases: undefined }]);
  });

  it("hides utility and loose-note roots from navigation without filtering the repository tree", async () => {
    repository.listTree.mockResolvedValue([
      { type: "directory", name: "_tools", path: "_tools", children: [] },
      { type: "directory", name: "Synthetic Field", path: "Synthetic Field", children: [] },
      { type: "directory", name: "notes", path: "notes", children: [] },
    ]);

    const { container } = render(<App />);

    expect(await screen.findByRole("treeitem", { name: "Synthetic Field" }, { timeout: 5_000 })).toBeInTheDocument();
    expect(container.querySelector('[data-content-path="_tools"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-content-path="notes"]')).not.toBeInTheDocument();
    expect(repository.listTree).toHaveBeenCalled();
  });

  it("starts without product branding and exposes accessible sidebar dividers", () => {
    render(<App />);

    expect(screen.queryByText(/^Math Atlas$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Mathematics" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter desktop canvas" }))
      .not.toBeInTheDocument();

    const fileDivider = screen.getByRole("separator", {
      name: "Resize file sidebar",
    });
    const noteDivider = screen.getByRole("separator", {
      name: "Resize note sidebar",
    });
    expect(fileDivider).toHaveAttribute("data-panel-resizer", "file-sidebar");
    expect(fileDivider).toHaveAttribute("aria-valuenow", "246");
    expect(noteDivider).toHaveAttribute("data-panel-resizer", "inspector");
    expect(noteDivider).toHaveAttribute("aria-valuenow", "548");
  });

  it("enters a chrome-free desktop surface without changing workspace preferences", async () => {
    tauriRuntimeMock.mockReturnValue(true);
    desktopSurfaceMock.isAvailable.mockReturnValue(true);
    localStorage.setItem("math-atlas:panel-visible:file-sidebar", "false");
    localStorage.setItem("math-atlas:panel-visible:inspector", "true");
    const { container } = render(<App />);

    const enter = await screen.findByRole(
      "button",
      { name: "Enter desktop canvas" },
      { timeout: 3_000 },
    );
    expect(desktopSurfaceMock.onChange).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#file-sidebar")).toHaveAttribute("hidden");
    expect(container.querySelector("#note-sidebar")).not.toHaveAttribute("hidden");

    fireEvent.click(enter);

    await waitFor(() =>
      expect(container.querySelector(".app-shell")).toHaveAttribute(
        "data-desktop-surface",
        "active",
      ),
    );
    expect(container.querySelector("#file-sidebar")).toHaveAttribute("hidden");
    expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden");
    expect(screen.queryByRole("button", { name: "Search notes" })).not.toBeInTheDocument();
    expect(screen.getByTestId("atlas-graph"))
      .not.toHaveAttribute("data-viewport-storage-key");
    expect(localStorage.getItem("math-atlas:panel-visible:file-sidebar")).toBe("false");
    expect(localStorage.getItem("math-atlas:panel-visible:inspector")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Show workspace chrome" }));
    expect(container.querySelector("#file-sidebar")).not.toHaveAttribute("hidden");
    expect(container.querySelector("#note-sidebar")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Search notes" })).toBeInTheDocument();
    expect(localStorage.getItem("math-atlas:panel-visible:file-sidebar")).toBe("false");
    expect(localStorage.getItem("math-atlas:panel-visible:inspector")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(desktopSurfaceMock.exit).not.toHaveBeenCalled();
    expect(container.querySelector(".app-shell")).toHaveAttribute(
      "data-desktop-surface",
      "active",
    );

    fireEvent.click(screen.getByRole("button", { name: "Return to workspace window" }));
    await waitFor(() =>
      expect(container.querySelector(".app-shell")).toHaveAttribute(
        "data-desktop-surface",
        "workspace",
      ),
    );
    expect(screen.getByTestId("atlas-graph")).toHaveAttribute(
      "data-viewport-storage-key",
      "math-atlas-v1",
    );
    expect(container.querySelector("#file-sidebar")).toHaveAttribute("hidden");
    expect(container.querySelector("#note-sidebar")).not.toHaveAttribute("hidden");
  });

  it("targets and saves an informal Note directly on a companion desktop canvas", async () => {
    tauriRuntimeMock.mockReturnValue(true);
    desktopSurfaceMock.isAvailable.mockReturnValue(true);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState({}, "", "/?desktopSurface=monitor-1");
    desktopSurfaceMock.getStatus.mockResolvedValue(desktopStatus(true, 2, false));
    repository.readNote.mockImplementation(async (path: string) => ({
      path,
      markdown: /^notes\/atlas-note-landmark-[^/]+\.md$/i.test(path)
        ? ""
        : `A real Markdown file for **${path}** with $x^2$.`,
      revision: `revision:${path}`,
    }));
    const { container } = render(<App />);

    await waitFor(() => expect(container.querySelector(".app-shell")).toHaveAttribute(
      "data-desktop-surface",
      "active",
    ));
    await waitFor(() => expect(desktopSurfaceMock.getStatus).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden");
    fireEvent.click(await screen.findByTestId("simulate-informal-note-create"));

    await waitFor(() => expect(repository.writeNote).toHaveBeenCalled());
    expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden");
    expect(container.querySelector("#file-sidebar")).toHaveAttribute("hidden");

    const desktopNoteIds = (JSON.parse(
      screen.getByTestId("canvas-custom-state").textContent ?? "{}",
    ) as { landmarkIds: string[] }).landmarkIds;
    const noteId = desktopNoteIds[desktopNoteIds.length - 1];
    await waitFor(() => expect(
      JSON.parse(screen.getByTestId("canvas-note-state").textContent ?? "{}"),
    ).toMatchObject({ autoEditNoteId: noteId }));
    fireEvent.click(screen.getByTestId(`save-inline-note:${noteId}`));
    await waitFor(() => expect(repository.writeNote).toHaveBeenLastCalledWith(
      expect.stringMatching(/^notes\/atlas-note-landmark-[^/]+\.md$/i),
      "Inline note text $x^2$.",
      expect.stringMatching(/^(?:saved|revision):notes\/atlas-note-landmark-[^/]+\.md$/i),
    ));
    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!noteId || !remove) throw new Error("Desktop Note removal was not available");
    act(() => remove({ landmarkIds: [noteId], customGroupIds: [], connectionIds: [] }));
    await waitFor(() => expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden"));
    expect(atlasGraphCapture.props?.selectedLandmarkId).toBeUndefined();
    expect(atlasGraphCapture.props?.selectedContentPath).toBeUndefined();
    const publishedEmptySelection = storageWrite.mock.calls.some(([key, value]) => {
      if (key !== "math-atlas:desktop-workspace-message:v1") return false;
      try {
        const message = JSON.parse(String(value)) as { kind?: string; payload?: unknown };
        return message.kind === "selection" &&
          message.payload !== null &&
          typeof message.payload === "object" &&
          Object.keys(message.payload).length === 0;
      } catch {
        return false;
      }
    });
    expect(publishedEmptySelection).toBe(true);
    storageWrite.mockRestore();
    window.history.replaceState({}, "", "/");
  }, 15_000);

  it("dismisses only the inspector when deleting from desktop controller chrome", async () => {
    tauriRuntimeMock.mockReturnValue(true);
    desktopSurfaceMock.isAvailable.mockReturnValue(true);
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole(
      "button",
      { name: "Enter desktop canvas" },
      { timeout: 3_000 },
    ));
    await waitFor(() => expect(container.querySelector(".app-shell")).toHaveAttribute(
      "data-desktop-surface",
      "active",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Show workspace chrome" }));
    fireEvent.click(await screen.findByRole("button", { name: "Public Fixture Note Beta" }));

    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!remove) throw new Error("Bulk canvas removal callback was not captured");
    act(() => remove({
      landmarkIds: ["fixture-azure-corollary"],
      customGroupIds: [],
      connectionIds: [],
    }));

    await waitFor(() => expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden"));
    expect(container.querySelector("#file-sidebar")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Search notes" })).toBeInTheDocument();
    expect(atlasGraphCapture.props?.selectedLandmarkId).toBeUndefined();
    expect(atlasGraphCapture.props?.selectedContentPath).toBeUndefined();
  });

  it("follows tray events and refreshes display geometry only while desktop mode is active", async () => {
    tauriRuntimeMock.mockReturnValue(true);
    desktopSurfaceMock.isAvailable.mockReturnValue(true);
    window.history.replaceState({}, "", "/?desktopSurface=monitor-1");
    const { container } = render(<App />);
    await waitFor(() => expect(desktopSurfaceMock.onChange).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => desktopSurfaceMock.emit(desktopStatus(true, 8)));
    expect(container.querySelector(".app-shell")).toHaveAttribute(
      "data-desktop-surface",
      "active",
    );

    await act(async () => {
      vi.advanceTimersByTime(2_500);
      await Promise.resolve();
    });
    expect(desktopSurfaceMock.refresh).toHaveBeenCalledTimes(1);

    act(() => desktopSurfaceMock.emit({
      ...desktopStatus(false, 9),
      role: "monitor",
    }));
    vi.advanceTimersByTime(5_000);
    expect(desktopSurfaceMock.refresh).toHaveBeenCalledTimes(1);
    window.history.replaceState({}, "", "/");
  });

  it("reports native desktop failures in the existing retry alert", async () => {
    tauriRuntimeMock.mockReturnValue(true);
    desktopSurfaceMock.isAvailable.mockReturnValue(true);
    desktopSurfaceMock.enter.mockRejectedValueOnce(new Error("Display layout is unavailable."));
    render(<App />);

    fireEvent.click(await screen.findByRole(
      "button",
      { name: "Enter desktop canvas" },
      { timeout: 3_000 },
    ));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Display layout is unavailable.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry desktop canvas" }));
    await waitFor(() => expect(desktopSurfaceMock.enter).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Desktop canvas" })).toBeInTheDocument(),
    );
  });

  it("hides and restores both sidebars while expanding the map grid", async () => {
    const { container } = render(<App />);
    const appShell = container.querySelector<HTMLElement>(".app-shell")!;
    const workspace = container.querySelector<HTMLElement>(".workspace-content")!;
    const fileSidebar = container.querySelector<HTMLElement>("#file-sidebar")!;
    const noteSidebar = container.querySelector<HTMLElement>("#note-sidebar")!;

    fireEvent.click(screen.getByRole("button", { name: "Hide file sidebar" }));

    expect(fileSidebar).toHaveAttribute("hidden");
    expect(
      screen.queryByRole("separator", { name: "Resize file sidebar" }),
    ).not.toBeInTheDocument();
    const showFiles = screen.getByRole("button", {
      name: "Show file sidebar",
    });
    expect(showFiles).toHaveClass("sidebar-restore", "sidebar-restore--left");
    expect(showFiles).toHaveAttribute("aria-controls", "file-sidebar");
    expect(appShell.style.gridTemplateColumns).toBe(
      "0 0 minmax(0, 1fr)",
    );

    fireEvent.click(showFiles);
    expect(fileSidebar).not.toHaveAttribute("hidden");
    expect(
      screen.getByRole("separator", { name: "Resize file sidebar" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show file sidebar" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide note sidebar" }));

    expect(noteSidebar).toHaveAttribute("hidden");
    expect(
      screen.queryByRole("separator", { name: "Resize note sidebar" }),
    ).not.toBeInTheDocument();
    const showNote = screen.getByRole("button", {
      name: "Show note sidebar",
    });
    expect(showNote).toHaveClass("sidebar-restore", "sidebar-restore--right");
    expect(showNote).toHaveAttribute("aria-controls", "note-sidebar");
    expect(workspace.style.gridTemplateColumns).toBe("minmax(0, 1fr) 0 0");

    fireEvent.click(showNote);
    expect(noteSidebar).not.toHaveAttribute("hidden");
    expect(
      screen.getByRole("separator", { name: "Resize note sidebar" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show note sidebar" }))
      .not.toBeInTheDocument();

    await screen.findByRole("treeitem", { name: "Synthetic Field" });
  });

  it("selects a mapped note and its real file on the first click", async () => {
    render(<App />);

    expect(screen.queryByTestId("mode-recall")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mode-trail")).not.toBeInTheDocument();
    expect(screen.queryByText(/models, optimisation, generalisation/i)).not.toBeInTheDocument();

    const geometricFile = await screen.findByRole("treeitem", {
      name: "Public Fixture Note Beta",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Public Fixture Note Beta" }),
    );
    expect(geometricFile).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { level: 2, name: "Public Fixture Note Beta" }),
    ).toBeInTheDocument();
  });

  it("searches the unified map with Ctrl K and opens files from empty topics", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const searchInput = await screen.findByRole("textbox", {
      name: "Search notes",
    });
    await waitFor(() => expect(document.activeElement).toBe(searchInput));
    fireEvent.change(searchInput, { target: { value: "kernel" } });
    await waitFor(() =>
      expect(screen.getByTestId("atlas-graph")).toHaveAttribute(
        "data-search-active",
        "true",
      ),
    );
    expect(screen.getByTestId("atlas-graph").textContent).toMatch(/kernel/i);
    expect(screen.getByTestId("atlas-graph").textContent).toMatch(/public fixture note alpha/i);

    fireEvent.click(await screen.findByRole("treeitem", { name: "Synthetic Field 02" }));
    fireEvent.click(
      await screen.findByRole("treeitem", { name: "Discounting" }),
    );
    expect(screen.getByTestId("atlas-graph")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-region")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Discounting" }),
    ).toBeInTheDocument();
    expect(repository.readNote).toHaveBeenCalledWith("Synthetic Field 02/Discounting.md");
  });

  it("reveals an externally replaced content tree when the workspace regains focus", async () => {
    let externalTree = [
        {
          type: "directory" as const,
          name: "Synthetic Field",
          path: "Synthetic Field",
          children: [
            {
              type: "file" as const,
              name: "Old fixture note.md",
              path: "Synthetic Field/Old fixture note.md",
              id: "old-fixture-note",
            },
          ],
        },
      ];
    repository.listTree.mockImplementation(async () => externalTree);

    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("treeitem", { name: "Synthetic Field" }));
    await waitFor(() => expect(
      container.querySelector('[data-content-path="Synthetic Field/Old fixture note.md"]'),
    ).toBeInTheDocument());
    expect(container.querySelector(
      '[data-content-path="Synthetic Field/Imported fixture note.md"]',
    )).not.toBeInTheDocument();

    externalTree = [
        {
          type: "directory" as const,
          name: "Synthetic Field",
          path: "Synthetic Field",
          children: [
            {
              type: "file" as const,
              name: "Imported fixture note.md",
              path: "Synthetic Field/Imported fixture note.md",
              id: "imported-fixture-note",
            },
          ],
        },
        {
          type: "directory" as const,
          name: "Fixture Archive",
          path: "Fixture Archive",
          children: [],
        },
      ];

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(
      container.querySelector('[data-content-path="Synthetic Field/Imported fixture note.md"]'),
    ).toBeInTheDocument());
    expect(container.querySelector('[data-content-path="Fixture Archive"]')).toBeInTheDocument();
    expect(container.querySelector(
      '[data-content-path="Synthetic Field/Old fixture note.md"]',
    )).not.toBeInTheDocument();
    expect(repository.listTree.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("revision-refreshes a clean selected note on focus and same-file selection", async () => {
    const path = "Synthetic Field 02/Discounting.md";
    let diskVersion = 1;
    repository.readNote.mockImplementation(async (requestedPath: string) => ({
      path: requestedPath,
      markdown: requestedPath === path
        ? `Disk version ${diskVersion}`
        : `A real Markdown file for **${requestedPath}** with $x^2$.`,
      revision: requestedPath === path
        ? `disk-revision-${diskVersion}`
        : `revision:${requestedPath}`,
    }));
    const savedEvent = vi.fn();
    window.addEventListener("math-atlas:note-saved", savedEvent);

    render(<App />);
    fireEvent.click(await screen.findByRole("treeitem", { name: "Synthetic Field 02" }));
    const note = await screen.findByRole("treeitem", { name: "Discounting" });
    fireEvent.click(note);
    expect(await screen.findByText("Disk version 1")).toBeInTheDocument();
    await waitFor(() => expect(repository.readNote).toHaveBeenCalledWith(path));

    diskVersion = 2;
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("Disk version 2")).toBeInTheDocument();
    await waitFor(() => expect(savedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { path, markdown: "Disk version 2" },
      }),
    ));

    diskVersion = 3;
    fireEvent.click(note);
    expect(await screen.findByText("Disk version 3")).toBeInTheDocument();
    window.removeEventListener("math-atlas:note-saved", savedEvent);
  });

  it("discards an in-flight external refresh when editing begins", async () => {
    const path = "Synthetic Field 02/Discounting.md";
    let deferSelectedRead = false;
    let resolveSelectedRead: ((document: {
      path: string;
      markdown: string;
      revision: string;
    }) => void) | undefined;
    repository.readNote.mockImplementation(async (requestedPath: string) => {
      if (requestedPath === path && deferSelectedRead) {
        return new Promise((resolve) => {
          resolveSelectedRead = resolve;
        });
      }
      return {
        path: requestedPath,
        markdown: requestedPath === path ? "Original disk text" : `Note ${requestedPath}`,
        revision: requestedPath === path ? "disk-revision-1" : `revision:${requestedPath}`,
      };
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("treeitem", { name: "Synthetic Field 02" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "Discounting" }));
    const original = await screen.findByText("Original disk text");
    await waitFor(() => expect(repository.readNote).toHaveBeenCalledWith(path));

    deferSelectedRead = true;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(resolveSelectedRead).toBeTypeOf("function"));

    fireEvent.click(original);
    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror editor was not mounted");
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Local draft" },
        selection: { anchor: "Local draft".length },
      });
    });

    await act(async () => {
      resolveSelectedRead?.({
        path,
        markdown: "External disk replacement",
        revision: "disk-revision-2",
      });
      await Promise.resolve();
    });
    expect(view.state.doc.toString()).toBe("Local draft");

    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    await waitFor(() => expect(repository.writeNote).toHaveBeenLastCalledWith(
      path,
      "Local draft",
      "disk-revision-1",
    ));
  });

  it("keeps the last healthy tree when a passive external refresh fails", async () => {
    let failRefresh = false;
    repository.listTree.mockImplementation(async () => {
      if (failRefresh) throw new Error("Transient scan failure");
      return [
        {
          type: "directory" as const,
          name: "Synthetic Field",
          path: "Synthetic Field",
          children: [],
        },
      ];
    });
    render(<App />);

    expect(await screen.findByRole("treeitem", { name: "Synthetic Field" }))
      .toBeInTheDocument();
    const callsBeforeRefresh = repository.listTree.mock.calls.length;
    failRefresh = true;
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(repository.listTree.mock.calls.length).toBeGreaterThan(callsBeforeRefresh));
    expect(screen.getByRole("treeitem", { name: "Synthetic Field" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Transient scan failure")).not.toBeInTheDocument();
  });

  it("keeps reset controls absent and undoes map movement with Ctrl Z", async () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("placement-state")).toHaveTextContent(
      "imported-layout",
    );

    fireEvent.click(await screen.findByTestId("simulate-drag-stop"));
    await waitFor(() =>
      expect(screen.getByTestId("placement-state")).toHaveTextContent(
        ":321,654",
      ),
    );
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("placement-state")).toHaveTextContent(
        "imported-layout",
      ),
    );
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
  });

  it("creates file-backed atlas state only after the first real map edit", async () => {
    render(<App />);

    await waitFor(() => expect(atlasRepositoryMock.readAtlas).toHaveBeenCalledTimes(1));
    expect(atlasRepositoryMock.writeAtlas).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId("simulate-drag-stop"));

    await waitFor(() => expect(atlasRepositoryMock.writeAtlas).toHaveBeenCalledTimes(1));
    const [atlas, expectedRevision] = atlasRepositoryMock.writeAtlas.mock.calls[0];
    expect(expectedRevision).toBeNull();
    expect(atlas).toMatchObject({
      snapshotKey: "math-atlas-v1",
      placements: expect.arrayContaining([
        expect.objectContaining({ x: 321, y: 654 }),
      ]),
    });
  });

  it("persists a landmark resize as one position-and-size transaction", async () => {
    render(<App />);

    await waitFor(() => expect(atlasRepositoryMock.readAtlas).toHaveBeenCalledTimes(1));
    const resize = atlasGraphCapture.props?.onLandmarkResize as
      | ((bounds: {
          landmarkId: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }) => void)
      | undefined;
    if (!resize) throw new Error("Atomic landmark resize callback was not captured");

    act(() => resize({
      landmarkId: "fixture-azure-corollary",
      x: 336,
      y: 672,
      width: 280,
      height: 168,
    }));

    await waitFor(() => expect(atlasRepositoryMock.writeAtlas).toHaveBeenCalledTimes(1));
    const [atlas] = atlasRepositoryMock.writeAtlas.mock.calls[0] as [{
      placements: Array<{ landmarkId: string; x: number; y: number }>;
      customizations: {
        landmarks: Record<string, { width?: number; height?: number }>;
      };
    }];
    expect(atlas.placements).toContainEqual({
      landmarkId: "fixture-azure-corollary",
      x: 336,
      y: 672,
    });
    expect(atlas.customizations.landmarks["fixture-azure-corollary"]).toMatchObject({
      width: 280,
      height: 168,
    });
  });

  it("places independent canvas copies without creating or deleting note files", async () => {
    render(<App />);

    const drop = await screen.findByTestId("simulate-note-drop");
    fireEvent.click(drop);
    fireEvent.click(drop);

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: "Public Fixture Note Alpha" }),
    ).toHaveLength(3));
    expect(repository.writeNote).not.toHaveBeenCalled();

    const copyIds = (JSON.parse(
      screen.getByTestId("canvas-custom-state").textContent ?? "{}",
    ) as { landmarkIds: string[] }).landmarkIds;
    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!copyIds.length || !remove) throw new Error("Canvas copy removal was not available");
    act(() => remove({
      landmarkIds: [copyIds[copyIds.length - 1]],
      customGroupIds: [],
      connectionIds: [],
    }));
    await waitFor(() => expect(
      screen.getAllByRole("button", { name: "Public Fixture Note Alpha" }),
    ).toHaveLength(2));
    expect(repository.writeNote).not.toHaveBeenCalled();
  });

  it("places a dragged note batch together and undoes the whole drop at once", async () => {
    render(<App />);
    await screen.findByTestId("atlas-graph");
    const placeNotes = atlasGraphCapture.props?.onPlaceNotes as
      | ((requests: Array<{
          kind: "math-atlas-note";
          version: 1;
          path: string;
          title: string;
          noteId?: string;
          subjectId: "synthetic-field";
          regionId: string;
          x: number;
          y: number;
        }>) => void)
      | undefined;
    if (!placeNotes) throw new Error("Batch note placement callback was not captured");

    act(() => placeNotes([
      {
        kind: "math-atlas-note",
        version: 1,
        path: "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Alpha.md",
        title: "Public Fixture Note Alpha",
        noteId: "fixture-orchid-lemma",
        subjectId: "synthetic-field",
        regionId: "fixture-region-details",
        x: 1008,
        y: 672,
      },
      {
        kind: "math-atlas-note",
        version: 1,
        path: "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Beta.md",
        title: "Public Fixture Note Beta",
        noteId: "fixture-azure-corollary",
        subjectId: "synthetic-field",
        regionId: "fixture-region-details",
        x: 1232,
        y: 672,
      },
    ]));

    await waitFor(() => {
      const state = atlasGraphCapture.props?.customizations as {
        customLandmarks: Array<{
          title: string;
          x: number;
          y: number;
          contentPath: string;
        }>;
      };
      expect(state.customLandmarks).toEqual([
        expect.objectContaining({
          title: "Public Fixture Note Alpha",
          x: 1008,
          y: 672,
          contentPath: "content/Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Alpha.md",
        }),
        expect.objectContaining({
          title: "Public Fixture Note Beta",
          x: 1232,
          y: 672,
          contentPath: "content/Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Beta.md",
        }),
      ]);
      expect(atlasGraphCapture.props?.selectedContentPath).toBe(
        "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Beta.md",
      );
    });
    expect(repository.writeNote).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(
      (atlasGraphCapture.props?.customizations as { customLandmarks: unknown[] })
        .customLandmarks,
    ).toHaveLength(0));
  });

  it("classifies a newly placed file by its folder instead of the canvas subject beneath the drop", async () => {
    render(<App />);

    fireEvent.click(await screen.findByTestId("simulate-unplaced-note-drop"));

    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId("canvas-custom-state").textContent ?? "{}",
      ) as {
        landmarkModels: Array<{
          title: string;
          kind?: string;
          subjectId: string;
          regionId: string;
        }>;
      };
      expect(state.landmarkModels).toContainEqual(expect.objectContaining({
        title: "Discounting",
        kind: "concept",
        subjectId: "synthetic-field-02",
        regionId: "subject-zone:synthetic-field-02",
      }));
    });

    expect(repository.writeNote).not.toHaveBeenCalled();
  });

  it("undoes a mixed multi-object canvas deletion in one Ctrl Z", async () => {
    render(<App />);
    const drop = await screen.findByTestId("simulate-note-drop");
    fireEvent.click(drop);
    fireEvent.click(drop);
    await waitFor(() => expect(
      screen.getAllByRole("button", { name: "Public Fixture Note Alpha" }),
    ).toHaveLength(3));

    const customize = atlasGraphCapture.props?.onCustomizationsChange as
      | ((updater: (current: Record<string, unknown>) => Record<string, unknown>) => void)
      | undefined;
    if (!customize) throw new Error("Atlas customization callback was not captured");
    act(() => customize((current) => ({
      ...current,
      customGroups: [{
        id: "batch-group",
        title: "Batch group",
        subjectId: "synthetic-field",
        level: "group",
        x: 0,
        y: 0,
        width: 700,
        height: 448,
        color: "#238636",
        shape: "rectangle",
      }],
      customConnections: [{
        id: "batch-edge",
        source: "custom-group:batch-group",
        target: "fixture-orchid-lemma",
      }],
    })));
    await waitFor(() => expect(screen.getByTestId("canvas-custom-state")).toHaveTextContent(
      '"groupIds":["batch-group"]',
    ));
    const baseline = screen.getByTestId("canvas-custom-state").textContent;
    const copyIds = JSON.parse(baseline ?? "{}").landmarkIds as string[];
    expect(copyIds).toHaveLength(2);

    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!remove) throw new Error("Bulk canvas removal callback was not captured");
    const baseConnectionId = (
      atlasGraphCapture.props?.snapshot as { connections: Array<{ id: string }> }
    ).connections[0].id;
    act(() => remove({
      landmarkIds: copyIds,
      customGroupIds: ["batch-group"],
      connectionIds: [baseConnectionId, "batch-edge"],
    }));

    await waitFor(() => expect(screen.getByTestId("canvas-custom-state")).toHaveTextContent(
      `"hiddenConnections":["${baseConnectionId}"]`,
    ));
    expect(screen.getByTestId("canvas-custom-state")).toHaveTextContent('"landmarkIds":[]');
    expect(screen.getByTestId("canvas-custom-state")).toHaveTextContent('"groupIds":[]');
    expect(screen.getByTestId("canvas-custom-state")).toHaveTextContent('"connectionIds":[]');

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("canvas-custom-state").textContent).toBe(baseline));
    expect(screen.getAllByRole("button", { name: "Public Fixture Note Alpha" })).toHaveLength(3);
    expect(repository.writeNote).not.toHaveBeenCalled();
    expect(repository.trashEntry).not.toHaveBeenCalled();
  });

  it("dismisses the active document when its formal canvas landmark is removed", async () => {
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Public Fixture Note Beta" }));
    const file = await screen.findByRole("treeitem", { name: "Public Fixture Note Beta" });
    expect(file).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector("#note-sidebar")).not.toHaveAttribute("hidden");

    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!remove) throw new Error("Bulk canvas removal callback was not captured");
    act(() => remove({
      landmarkIds: ["fixture-azure-corollary"],
      customGroupIds: [],
      connectionIds: [],
    }));

    await waitFor(() => expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden"));
    expect(atlasGraphCapture.props?.selectedLandmarkId).toBeUndefined();
    expect(atlasGraphCapture.props?.selectedContentPath).toBeUndefined();
    expect(screen.queryByRole("heading", { level: 2, name: "Public Fixture Note Beta" }))
      .not.toBeInTheDocument();
    // Canvas deletion never touches the canonical Markdown file.
    expect(repository.trashEntry).not.toHaveBeenCalled();
    expect(repository.writeNote).not.toHaveBeenCalled();
    expect(screen.getByRole("treeitem", { name: "Public Fixture Note Beta" })).toBeInTheDocument();
  });

  it("dismisses a deleted titleless Note without exposing its storage filename", async () => {
    localStorage.setItem("math-atlas:panel-visible:inspector", "false");
    const { container } = render(<App />);

    fireEvent.click(await screen.findByTestId("simulate-informal-note-create"));
    await waitFor(() => expect(repository.writeNote).toHaveBeenCalled());
    const customState = JSON.parse(
      screen.getByTestId("canvas-custom-state").textContent ?? "{}",
    ) as { landmarkIds: string[] };
    const noteId = customState.landmarkIds[customState.landmarkIds.length - 1];
    if (!noteId) throw new Error("Created Note was not placed on the canvas");
    expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden");
    await waitFor(() => expect(
      JSON.parse(screen.getByTestId("canvas-note-state").textContent ?? "{}"),
    ).toMatchObject({ autoEditNoteId: noteId }));

    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!remove) throw new Error("Bulk canvas removal callback was not captured");
    act(() => remove({ landmarkIds: [noteId], customGroupIds: [], connectionIds: [] }));

    await waitFor(() => expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden"));
    expect(atlasGraphCapture.props?.selectedLandmarkId).toBeUndefined();
    expect(atlasGraphCapture.props?.selectedContentPath).toBeUndefined();
    expect(document.body).not.toHaveTextContent(/atlas-note-landmark-/i);
    expect(repository.trashEntry).not.toHaveBeenCalled();
  });

  it("keeps a file-tree document open when duplicate canvas instances are removed", async () => {
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Public Fixture Note Alpha" }));
    expect(await screen.findByRole("treeitem", { name: "Public Fixture Note Alpha" }))
      .toBeInTheDocument();
    const drop = await screen.findByTestId("simulate-note-drop");
    fireEvent.click(drop);
    fireEvent.click(drop);
    await waitFor(() => expect(
      screen.getAllByRole("button", { name: "Public Fixture Note Alpha" }),
    ).toHaveLength(3));
    let copyIds = (JSON.parse(
      screen.getByTestId("canvas-custom-state").textContent ?? "{}",
    ) as { landmarkIds: string[] }).landmarkIds;
    expect(copyIds).toHaveLength(2);

    // Removing the selected instance clears its document even though another
    // instance points at the same backing file.
    const fixtureNoteButtons = screen.getAllByRole("button", { name: "Public Fixture Note Alpha" });
    fireEvent.click(fixtureNoteButtons[fixtureNoteButtons.length - 1]);
    const remove = atlasGraphCapture.props?.onRemoveCanvasObjects as
      | ((request: {
          landmarkIds: readonly string[];
          customGroupIds: readonly string[];
          connectionIds: readonly string[];
        }) => void)
      | undefined;
    if (!remove) throw new Error("Bulk canvas removal callback was not captured");
    act(() => remove({
      landmarkIds: [copyIds[copyIds.length - 1]],
      customGroupIds: [],
      connectionIds: [],
    }));
    await waitFor(() => expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden"));
    expect(atlasGraphCapture.props?.selectedContentPath).toBeUndefined();

    // A selection made explicitly in Files has no active canvas landmark. It
    // must survive deletion of the remaining duplicate instance.
    const file = await screen.findByRole("treeitem", { name: "Public Fixture Note Alpha" });
    fireEvent.click(file);
    await waitFor(() => expect(container.querySelector("#note-sidebar")).not.toHaveAttribute("hidden"));
    expect(screen.getByRole("treeitem", { name: "Public Fixture Note Alpha" }))
      .toHaveAttribute("aria-selected", "true");
    expect(atlasGraphCapture.props?.selectedLandmarkId).toBeUndefined();
    copyIds = (JSON.parse(
      screen.getByTestId("canvas-custom-state").textContent ?? "{}",
    ) as { landmarkIds: string[] }).landmarkIds;
    expect(copyIds).toHaveLength(1);
    act(() => remove({ landmarkIds: copyIds, customGroupIds: [], connectionIds: [] }));

    await waitFor(() => expect(screen.getByTestId("canvas-custom-state")).toHaveTextContent(
      '"landmarkIds":[]',
    ));
    expect(container.querySelector("#note-sidebar")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("treeitem", { name: "Public Fixture Note Alpha" }))
      .toHaveAttribute("aria-selected", "true");
    expect(atlasGraphCapture.props?.selectedContentPath).toBe(
      "Synthetic Field/Public Examples/Fixture Collection/Public Fixture Note Alpha.md",
    );
    expect(repository.trashEntry).not.toHaveBeenCalled();
    expect(repository.writeNote).not.toHaveBeenCalled();
  });

  it("serializes rapid on-paper Note saves against the latest file revision", async () => {
    let finishFirstSave: ((document: {
      path: string;
      markdown: string;
      revision: string;
    }) => void) | undefined;
    repository.readNote.mockImplementation(async (path: string) => ({
      path,
      markdown: /^notes\/atlas-note-landmark-[^/]+\.md$/i.test(path) ? "" : `Note ${path}`,
      revision: /^notes\/atlas-note-landmark-[^/]+\.md$/i.test(path) ? "note-r0" : `revision:${path}`,
    }));
    repository.writeNote.mockImplementation(async (
      path: string,
      markdown: string,
      expectedRevision?: string | null,
    ) => {
      if (expectedRevision === null) return { path, markdown, revision: "note-r0" };
      if (markdown === "First draft") {
        return new Promise((resolve) => {
          finishFirstSave = resolve;
        });
      }
      return { path, markdown, revision: "note-r2" };
    });
    render(<App />);
    fireEvent.click(await screen.findByTestId("simulate-informal-note-create"));
    await waitFor(() => expect(repository.writeNote).toHaveBeenCalledWith(
      expect.stringMatching(/^notes\/atlas-note-landmark-[^/]+\.md$/i),
      expect.any(String),
      null,
    ));

    const noteIds = (JSON.parse(
      screen.getByTestId("canvas-custom-state").textContent ?? "{}",
    ) as { landmarkIds: string[] }).landmarkIds;
    const noteId = noteIds[noteIds.length - 1];
    const note = (atlasGraphCapture.props?.landmarks as Array<{ id: string }> | undefined)
      ?.find(({ id }) => id === noteId);
    const save = atlasGraphCapture.props?.onSaveNote as
      | ((landmark: { id: string }, markdown: string) => Promise<void>)
      | undefined;
    if (!note || !save) throw new Error("On-paper Note save callback was not captured");

    let firstSave!: Promise<void>;
    let secondSave!: Promise<void>;
    act(() => {
      firstSave = save(note, "First draft");
      secondSave = save(note, "Second draft");
    });
    await waitFor(() => expect(repository.writeNote).toHaveBeenCalledWith(
      expect.stringMatching(/^notes\/atlas-note-landmark-[^/]+\.md$/i),
      "First draft",
      "note-r0",
    ));
    expect(repository.writeNote.mock.calls.some(([, markdown]) => markdown === "Second draft"))
      .toBe(false);

    await act(async () => {
      finishFirstSave?.({
        path: String(repository.writeNote.mock.calls[0]?.[0]),
        markdown: "First draft",
        revision: "note-r1",
      });
      await Promise.all([firstSave, secondSave]);
    });
    expect(repository.writeNote).toHaveBeenCalledWith(
      expect.stringMatching(/^notes\/atlas-note-landmark-[^/]+\.md$/i),
      "Second draft",
      "note-r1",
    );
  });

  it("creates a named mathematical object whose filename is its only title", async () => {
    render(<App />);

    fireEvent.click(await screen.findByTestId("simulate-definition-create"));

    await waitFor(() => expect(repository.writeNote).toHaveBeenCalledWith(
      "Compactness.md",
      expect.stringMatching(/^---\nid: landmark-[^\n]+\nkind: definition\nsubject: synthetic-field\n---\n\n> \[!definition\]\n> $/),
      null,
    ));
    const calls = repository.writeNote.mock.calls;
    const markdown = calls[calls.length - 1]?.[1] as string;
    expect(markdown).not.toContain("# Compactness");
    expect(markdown).not.toMatch(/click here|start writing/i);
    await waitFor(() => expect(repository.listTree.mock.calls.length).toBeGreaterThan(1));
  });

  it("creates a titleless paper Note in hidden storage and targets its on-paper editor", async () => {
    localStorage.setItem("math-atlas:panel-visible:inspector", "false");
    repository.readNote.mockImplementation(async (path: string) => ({
      path,
      markdown: /^notes\/atlas-note-landmark-[^/]+\.md$/i.test(path)
        ? ""
        : `A real Markdown file for **${path}** with $x^2$.`,
      revision: `revision:${path}`,
    }));
    const { container } = render(<App />);

    expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden");
    fireEvent.click(await screen.findByTestId("simulate-informal-note-create"));

    await waitFor(() => expect(repository.writeNote).toHaveBeenCalled());
    const [path, initialMarkdown] = repository.writeNote.mock.calls.find(([candidate]) => (
      /^notes\/atlas-note-landmark-[^/]+\.md$/i.test(candidate)
    )) ?? [];
    expect(path).toMatch(/^notes\/atlas-note-landmark-[^/]+\.md$/i);
    expect(initialMarkdown).toMatch(/^---\nid: landmark-[^\n]+\nkind: concept\nsubject: synthetic-field\n---\n$/);
    expect(container.querySelector("#note-sidebar")).toHaveAttribute("hidden");
    await waitFor(() => {
      const state = JSON.parse(screen.getByTestId("canvas-note-state").textContent ?? "{}") as {
        autoEditNoteId?: string;
      };
      expect(state.autoEditNoteId).toMatch(/^landmark-/);
    });
    const noteState = JSON.parse(screen.getByTestId("canvas-note-state").textContent ?? "{}") as {
      autoEditNoteId?: string;
    };
    expect(noteState.autoEditNoteId).toMatch(/^landmark-/);
    expect(screen.getByTestId(`inline-note:${noteState.autoEditNoteId}`)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/atlas-note-landmark-/i);

  });

  it("creates a sidebar note with an empty body and selects the draft name", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "New note" }));
    const input = screen.getByRole("textbox", { name: "New note name" }) as HTMLInputElement;
    await waitFor(() => {
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    fireEvent.change(input, { target: { value: "Scratch work" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(repository.writeNote).toHaveBeenCalledWith(
      "Scratch work.md",
      "",
      null,
    ));
  });

  it("routes explorer Ctrl Z to durable file history instead of canvas history", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("treeitem", { name: "Synthetic Field 02" }));
    const note = await screen.findByRole("treeitem", { name: "Discounting" });
    note.focus();
    fireEvent.keyDown(note, { key: "F2" });
    const rename = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(rename, { target: { value: "Present value" } });
    fireEvent.submit(rename.closest("form")!);

    await waitFor(() => expect(repository.moveEntry).toHaveBeenCalledWith(
      "Synthetic Field 02/Discounting.md",
      "Synthetic Field 02/Present value.md",
    ));

    const explorer = screen.getByRole("tree", { name: "Files" });
    fireEvent.keyDown(explorer, { key: "z", ctrlKey: true });

    await waitFor(() => expect(repository.moveEntry).toHaveBeenCalledWith(
      "Synthetic Field 02/Present value.md",
      "Synthetic Field 02/Discounting.md",
    ));
    expect(repository.moveEntry).toHaveBeenCalledTimes(2);
  });

  it("follows a real file after it is renamed by its stable YAML id", async () => {
    repository.listTree.mockResolvedValueOnce([
      {
        type: "directory",
        name: "Synthetic Field",
        path: "Synthetic Field",
        children: [
          {
            type: "file",
            name: "Renamed fixture note.md",
            path: "Synthetic Field/Renamed fixture note.md",
            id: "fixture-azure-corollary",
          },
        ],
      },
    ]);
    render(<App />);

    fireEvent.click(
      await screen.findByRole("treeitem", { name: "Synthetic Field" }),
    );
    const renamedFile = await screen.findByRole("treeitem", {
      name: "Renamed fixture note",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Renamed fixture note" }),
    );
    expect(renamedFile).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Renamed fixture note",
      }),
    ).toBeInTheDocument();
  });
});
