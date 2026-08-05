import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GROUP_SHAPE_OPTIONS,
  objectShapeGlyph,
  OBJECT_SHAPE_OPTIONS,
} from "../domain/mapAppearance";
import {
  NOTE_FILE_DRAG_MIME,
  serializeNoteFileDragBatchPayload,
  serializeNoteFileDragPayload,
} from "../domain/noteDrag";
import type { AtlasSnapshot, Landmark } from "../domain/types";
import {
  DEFAULT_GROUP_COLOR,
  emptyMapCustomizations,
  type EditableLandmarkKind,
  type MapCustomizations,
  type MapCustomizationsUpdater,
} from "../state/mapCustomizationStore";
import type { DesktopCanvasDragEvent } from "../services/desktopCanvasDrag";

const flowCapture = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
  backgroundProps: undefined as Record<string, unknown> | undefined,
  screenToFlowPosition: vi.fn((point: { x: number; y: number }) => point),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  setCenter: vi.fn(() => Promise.resolve(true)),
  setViewport: vi.fn((
    _viewport: { x: number; y: number; zoom: number },
    _options?: { duration?: number },
  ) => Promise.resolve(true)),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Background: (props: Record<string, unknown>) => {
      flowCapture.backgroundProps = props;
      return React.createElement("div", { "data-testid": "flow-background" });
    },
    BackgroundVariant: { Dots: "dots" },
    ConnectionMode: { Loose: "loose" },
    Handle: ({
      className,
      id,
      position,
      title,
      type,
    }: {
      className?: string;
      id?: string;
      position?: string;
      title?: string;
      type?: string;
    }) =>
      React.createElement("span", {
        className,
        title,
        "data-testid": "flow-handle",
        "data-handle-id": id,
        "data-handle-position": position,
        "data-handle-type": type,
      }),
    MarkerType: { ArrowClosed: "arrow-closed" },
    NodeResizer: () => null,
    NodeToolbar: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    ViewportPortal: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    Position: {
      Top: "top",
      Right: "right",
      Bottom: "bottom",
      Left: "left",
    },
    ReactFlow: ({ children, ...props }: Record<string, unknown>) => {
      flowCapture.props = props;
      const onInit = props.onInit as
        | ((instance: {
            screenToFlowPosition: typeof flowCapture.screenToFlowPosition;
            getViewport: typeof flowCapture.getViewport;
            setCenter: typeof flowCapture.setCenter;
            setViewport: typeof flowCapture.setViewport;
          }) => void)
        | undefined;
      onInit?.({
        screenToFlowPosition: flowCapture.screenToFlowPosition,
        getViewport: flowCapture.getViewport,
        setCenter: flowCapture.setCenter,
        setViewport: flowCapture.setViewport,
      });

      const nodeTypes = props.nodeTypes as
        | Record<string, React.ComponentType<Record<string, unknown>>>
        | undefined;
      const nodes = (props.nodes ?? []) as CapturedNode[];
      const renderedNodes = nodes.flatMap((node) => {
        const NodeComponent = nodeTypes?.[node.type];
        return NodeComponent
          ? [
              React.createElement(NodeComponent, {
                key: node.id,
                id: node.id,
                type: node.type,
                data: node.data,
                 selected: Boolean(node.selected),
                 width: node.width,
                 height: node.height,
                 positionAbsoluteX: node.position?.x,
                 positionAbsoluteY: node.position?.y,
               }),
            ]
          : [];
      });
      return React.createElement(
        "div",
        { "data-testid": "react-flow" },
        children as ReactNode,
        ...renderedNodes,
      );
    },
    useNodesState: (initialNodes: unknown[]) => {
      const [nodes, setNodes] = React.useState(initialNodes as CapturedNode[]);
      const onNodesChange = React.useCallback((changes: Array<{
        id: string;
        type: string;
        selected?: boolean;
      }>) => {
        setNodes((current: CapturedNode[]) => current.map((node) => {
          const selection = changes.find((change) => (
            change.type === "select" && change.id === node.id
          ));
          return selection
            ? { ...node, selected: Boolean(selection.selected) }
            : node;
        }));
      }, []);
      return [nodes, setNodes, onNodesChange] as const;
    },
    useReactFlow: () => ({
      fitView: vi.fn(),
      updateNode: vi.fn(),
    }),
    useStore: (selector: (state: { transform: [number, number, number] }) => unknown) => selector({ transform: [0, 0, 1] }),
  };
});

import { AtlasGraph } from "./AtlasGraph";

interface CapturedNode {
  id: string;
  type: "landmark" | "region";
  position: { x: number; y: number };
  width?: number;
  height?: number;
  selected?: boolean;
  zIndex?: number;
  draggable?: boolean;
  dragHandle?: string;
  data: Record<string, unknown>;
}

interface CapturedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  selected?: boolean;
  zIndex?: number;
  interactionWidth?: number;
  markerEnd?: Record<string, unknown>;
  className?: string;
  style?: Record<string, unknown>;
}

const mastery = { state: 0, explain: 0, derive: 0, apply: 0 };

function landmark(id: string, regionId: string): Landmark {
  return {
    id,
    title: id.toUpperCase(),
    kind: "concept",
    subjectIds: ["synthetic-field-05"],
    regionId,
    summary: "",
    markdown: "",
    tags: [],
    status: "draft",
    mastery,
  };
}

const landmarks = [
  landmark("a", "linear-models"),
  landmark("b", "linear-models"),
  landmark("c", "other-models"),
];

const snapshot: AtlasSnapshot = {
  subjects: [
    {
      id: "synthetic-field-02",
      title: "Synthetic Field 02",
      shortTitle: "Synthetic Field 02",
      description: "",
      accent: "#D32F2F",
      tint: "#FFFFFF",
      landmarkCount: 0,
    },
    {
      id: "synthetic-field-04",
      title: "Synthetic Field 04",
      shortTitle: "Field 04",
      description: "",
      accent: "#F57C00",
      tint: "#FFFFFF",
      landmarkCount: 0,
    },
    {
      id: "synthetic-field-05",
      title: "Synthetic Field 05",
      shortTitle: "Field 05",
      description: "",
      accent: "#2E7D32",
      tint: "#FFFFFF",
      landmarkCount: landmarks.length,
    },
    {
      id: "synthetic-field-07",
      title: "Synthetic Field 07",
      shortTitle: "Synthetic Field 07",
      description: "",
      accent: "#1976D2",
      tint: "#FFFFFF",
      landmarkCount: 0,
    },
    {
      id: "synthetic-field-03",
      title: "Synthetic Field 03",
      shortTitle: "Synthetic Field 03",
      description: "",
      accent: "#7B1FA2",
      tint: "#FFFFFF",
      landmarkCount: 0,
    },
  ],
  regions: [
    {
      id: "linear-models",
      title: "Linear models",
      subjectId: "synthetic-field-05",
    },
    {
      id: "other-models",
      title: "Other models",
      subjectId: "synthetic-field-05",
    },
  ],
  landmarks,
  placements: [
    { landmarkId: "a", x: 0, y: 300 },
    { landmarkId: "b", x: 260, y: 120 },
    { landmarkId: "c", x: 600, y: 0 },
  ],
  connections: [
    {
      id: "edge-1",
      source: "a",
      target: "b",
      kind: "related-to",
      label: "links",
    },
  ],
  trails: [],
  importReport: {
    generatedAt: "2026-08-03",
    sourceVault: "",
    canvasPath: "",
    scannedMarkdown: 0,
    importedLandmarks: 0,
    importedConnections: 0,
    unplacedNotes: 0,
    encodingWarnings: 0,
    notes: [],
  },
};

const emptyPublicSnapshot: AtlasSnapshot = {
  ...snapshot,
  subjects: [],
  regions: [],
  landmarks: [],
  placements: [],
  connections: [],
  trails: [],
};

const customizations = emptyMapCustomizations("test-snapshot");
const placementOverrides: [] = [];
const callbacks = {
  onSelectLandmark: vi.fn(),
  onPlacementChange: vi.fn(),
  onPlacementChanges: vi.fn(),
  onKindChange: vi.fn(),
  onCustomizationsChange: vi.fn<(updater: MapCustomizationsUpdater) => void>(),
};

function graph(overrides: Partial<ComponentProps<typeof AtlasGraph>> = {}) {
  return (
    <AtlasGraph
      snapshot={snapshot}
      landmarks={landmarks}
      groupLandmarks={landmarks}
      placementOverrides={placementOverrides}
      customizations={customizations}
      {...callbacks}
      {...overrides}
    />
  );
}

function nodes() {
  return flowCapture.props?.nodes as CapturedNode[];
}

function edges() {
  return flowCapture.props?.edges as CapturedEdge[];
}

function node(id: string) {
  const found = nodes().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing graph node ${id}`);
  return found;
}

function pointerAt(x: number, y: number) {
  return { clientX: x, clientY: y, preventDefault: vi.fn() };
}

function openNodeMenu(id: string, x = 160, y = 100) {
  const event = pointerAt(x, y);
  act(() => {
    const handler = flowCapture.props?.onNodeContextMenu as (
      event: ReturnType<typeof pointerAt>,
      node: CapturedNode,
    ) => void;
    handler(event, node(id));
  });
  return event;
}

function openEdgeMenu(x = 220, y = 130) {
  const event = pointerAt(x, y);
  act(() => {
    const handler = flowCapture.props?.onEdgeContextMenu as (
      event: ReturnType<typeof pointerAt>,
      edge: CapturedEdge,
    ) => void;
    handler(event, edges()[0]);
  });
  return event;
}

function openCanvasMenu(x = 113, y = 85) {
  const event = pointerAt(x, y);
  act(() => {
    const handler = flowCapture.props?.onPaneContextMenu as (
      event: ReturnType<typeof pointerAt>,
    ) => void;
    handler(event);
  });
  return event;
}

function latestCustomizations(base: MapCustomizations = customizations) {
  const calls = callbacks.onCustomizationsChange.mock.calls;
  const updater = calls[calls.length - 1]?.[0];
  if (!updater) throw new Error("Expected a map customization update");
  return updater(base);
}

function applyCustomizationUpdates(
  base: MapCustomizations,
  fromCall = 0,
) {
  return callbacks.onCustomizationsChange.mock.calls
    .slice(fromCall)
    .reduce((current, [updater]) => updater(current), base);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  flowCapture.props = undefined;
  flowCapture.backgroundProps = undefined;
  vi.clearAllMocks();
  flowCapture.screenToFlowPosition.mockImplementation((point) => point);
});

describe("AtlasGraph interaction state", () => {
  it("lets a newly identified controller establish the first shared camera", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onViewportChange = vi.fn();
    const { rerender } = render(graph({
      deferInitialViewport: true,
      onViewportChange,
    }));

    expect(flowCapture.setCenter).not.toHaveBeenCalled();
    expect(onViewportChange).not.toHaveBeenCalled();

    rerender(graph({
      deferInitialViewport: false,
      onViewportChange,
    }));

    await waitFor(() => expect(flowCapture.setCenter).toHaveBeenCalledOnce());
    expect(onViewportChange).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 });
  });

  it("streams local movement without echoing an applied companion camera", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onViewportChange = vi.fn();
    flowCapture.setViewport.mockImplementationOnce((viewport) => {
      const onMove = flowCapture.props?.onMove as
        | ((event: null, next: typeof viewport) => void)
        | undefined;
      onMove?.(null, viewport);
      return Promise.resolve(true);
    });

    render(graph({
      externalViewport: { x: -240, y: 80, zoom: .7 },
      onViewportChange,
    }));

    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalled());
    expect(onViewportChange).not.toHaveBeenCalled();

    await act(async () => Promise.resolve());
    act(() => {
      const onMoveStart = flowCapture.props?.onMoveStart as (
        event: { type: string },
      ) => void;
      const onMove = flowCapture.props?.onMove as (
        event: { type: string },
        viewport: { x: number; y: number; zoom: number },
      ) => void;
      onMoveStart({ type: "pointerdown" });
      onMove({ type: "pointermove" }, { x: 30, y: -45, zoom: .9 });
    });
    expect(onViewportChange).toHaveBeenCalledWith({ x: 30, y: -45, zoom: .9 });
  });

  it("does not publish a delayed move-end from a programmatic external viewport", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onViewportChange = vi.fn();

    render(graph({
      externalViewport: { x: -420, y: 115, zoom: .62 },
      onViewportChange,
    }));

    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    act(() => {
      const onMoveStart = flowCapture.props?.onMoveStart as (
        event: null,
      ) => void;
      const onMoveEnd = flowCapture.props?.onMoveEnd as (
        event: null,
        viewport: { x: number; y: number; zoom: number },
      ) => void;
      onMoveStart(null);
      onMoveEnd(null, { x: -420, y: 115, zoom: .62 });
    });

    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it("does not replay an unchanged external camera after landmark or group drag release", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const externalViewport = { x: -360, y: 140, zoom: .68 };

    render(graph({ externalViewport }));
    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    flowCapture.setViewport.mockClear();

    const landmarkNode = node("a");
    act(() => {
      const start = flowCapture.props?.onNodeDragStart as (
        event: Record<string, never>,
        node: CapturedNode,
      ) => void;
      start({}, landmarkNode);
    });
    act(() => {
      const stop = flowCapture.props?.onNodeDragStop as (
        event: Record<string, never>,
        node: CapturedNode,
      ) => void;
      stop({}, {
        ...landmarkNode,
        position: {
          x: landmarkNode.position.x + 28,
          y: landmarkNode.position.y,
        },
      });
    });
    await act(async () => Promise.resolve());

    expect(flowCapture.setViewport).not.toHaveBeenCalled();

    const groupNode = node("region-frame:linear-models");
    const startGroupDrag = groupNode.data.onTitleDragStart as (
      regionId: string,
      startClientX: number,
      startClientY: number,
      clientX: number,
      clientY: number,
    ) => void;
    const stopGroupDrag = groupNode.data.onTitleDragEnd as (
      regionId: string,
      deltaX: number,
      deltaY: number,
      clientX: number,
      clientY: number,
    ) => void;
    act(() => startGroupDrag("linear-models", 100, 100, 128, 100));
    act(() => stopGroupDrag("linear-models", 28, 0, 128, 100));
    await act(async () => Promise.resolve());

    expect(flowCapture.setViewport).not.toHaveBeenCalled();
  });

  it("defers a genuinely new external camera until a landmark drag ends", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const originalViewport = { x: -360, y: 140, zoom: .68 };
    const remoteViewport = { x: 240, y: -175, zoom: .82 };
    const rendered = render(graph({ externalViewport: originalViewport }));

    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    flowCapture.setViewport.mockClear();

    const landmarkNode = node("a");
    act(() => {
      const start = flowCapture.props?.onNodeDragStart as (
        event: Record<string, never>,
        node: CapturedNode,
      ) => void;
      start({}, landmarkNode);
    });

    rendered.rerender(graph({ externalViewport: remoteViewport }));
    expect(flowCapture.setViewport).not.toHaveBeenCalled();

    act(() => {
      const stop = flowCapture.props?.onNodeDragStop as (
        event: Record<string, never>,
        node: CapturedNode,
      ) => void;
      stop({}, {
        ...landmarkNode,
        position: {
          x: landmarkNode.position.x + 28,
          y: landmarkNode.position.y,
        },
      });
    });

    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalledTimes(1));
    expect(flowCapture.setViewport).toHaveBeenCalledWith(remoteViewport, { duration: 0 });
  });

  it("uses a snapped 28-unit black-dot canvas and generous connection targets", () => {
    render(graph());

    expect(flowCapture.props?.snapToGrid).toBe(true);
    expect(flowCapture.props?.onlyRenderVisibleElements).toBe(true);
    expect(flowCapture.props?.snapGrid).toEqual([28, 28]);
    expect(flowCapture.backgroundProps).toMatchObject({
      color: "#111418",
      gap: 28,
      size: 1.45,
      variant: "dots",
    });
    expect(nodes().every(({ position }) => position.x % 28 === 0 && position.y % 28 === 0)).toBe(true);

    expect(flowCapture.props?.connectionRadius).toBe(16);
    expect(flowCapture.props?.reconnectRadius).toBe(12);
    expect(flowCapture.props?.connectionDragThreshold).toBe(4);
    expect(flowCapture.props?.connectOnClick).toBe(false);
    expect(flowCapture.props?.connectionMode).toBe("loose");
    expect(flowCapture.props?.connectionLineStyle).toEqual({
      stroke: "#333333",
      strokeWidth: 1.5,
    });
    expect(flowCapture.props?.nodesConnectable).toBe(true);
    expect(flowCapture.props?.edgesReconnectable).toBe(true);
    expect(edges()[0]).toMatchObject({
      className: "atlas-edge",
      sourceHandle: "right",
      targetHandle: "left",
      interactionWidth: 22,
      markerEnd: {
        type: "arrow-closed",
        width: 16,
        height: 16,
        markerUnits: "userSpaceOnUse",
      },
    });
    const sourcePorts = within(screen.getByTestId("landmark-a")).getAllByTestId("flow-handle");
    const targetPorts = within(screen.getByTestId("landmark-b")).getAllByTestId("flow-handle");
    expect(sourcePorts.some((port) => port.dataset.handleId === edges()[0].sourceHandle)).toBe(true);
    expect(targetPorts.some((port) => port.dataset.handleId === edges()[0].targetHandle)).toBe(true);

    const handles = screen.getAllByTestId("flow-handle");
    const regionCount = nodes().filter(({ type }) => type === "region").length;
    const landmarkCount = nodes().filter(({ type }) => type === "landmark").length;
    expect(handles).toHaveLength(landmarkCount * 4 + regionCount * 8);
    expect(handles.every((handle) => handle.classList.contains("atlas-port"))).toBe(true);
    expect(handles.every((handle) => handle.dataset.handleType === "source")).toBe(true);
    expect(handles.filter((handle) => handle.classList.contains("region-port--geometry"))).toHaveLength(regionCount * 4);
    expect(handles.filter((handle) => handle.classList.contains("region-port--proxy"))).toHaveLength(regionCount * 4);
  });

  it("keeps desktop zoom limits physical without injecting screen-fixed region titles", () => {
    render(graph({ viewportScaleFactor: 1.5 }));

    const regionNodes = nodes().filter(({ type }) => type === "region");
    expect(regionNodes.length).toBeGreaterThan(0);
    expect(regionNodes.every(({ data }) => !("titleScreenScale" in data))).toBe(true);
    expect(flowCapture.props?.minZoom).toBeCloseTo(.04 / 1.5, 10);
    expect(flowCapture.props?.maxZoom).toBeCloseTo(1.8 / 1.5, 10);
  });

  it("hands a committed landmark frame to the shell as one transaction", () => {
    const onLandmarkResize = vi.fn();
    render(graph({ onLandmarkResize }));
    const resize = node("a").data.onResizeEnd as (
      landmarkId: string,
      dimensions: { x: number; y: number; width: number; height: number },
    ) => void;

    act(() => resize("a", { x: 0, y: 56, width: 196, height: 112 }));

    expect(onLandmarkResize).toHaveBeenCalledWith({
      landmarkId: "a",
      x: 0,
      y: 56,
      width: 196,
      height: 112,
    });
    expect(callbacks.onPlacementChange).not.toHaveBeenCalled();
    expect(callbacks.onCustomizationsChange).not.toHaveBeenCalled();
  });

  it("supports compiled landmark content and persisted reading sizes", async () => {
    render(graph({
      previewMarkdownByLandmarkId: new Map([["a", "$$x^2$$"]]),
    }));

    expect(node("a").data.previewMarkdown).toBe("$$x^2$$");
    openNodeMenu("a");
    const dialog = await screen.findByRole("dialog", { name: "Edit A" });
    fireEvent.click(await within(dialog).findByRole(
      "tab",
      { name: "Content" },
      { timeout: 4_000 },
    ));
    const formula = await within(dialog).findByRole("button", { name: "Formula" });
    fireEvent.click(formula);
    expect(latestCustomizations().landmarks.a).toMatchObject({
      contentMode: "formula",
      width: 336,
      height: 196,
    });
  });

  it("offers and persists each compiled formula only while formula mode is active", async () => {
    const previewMarkdownByLandmarkId = new Map([["a", [
      "Inline notation $x$ is not a substantive picker entry.",
      "",
      "$$",
      "x_0 = b",
      "$$",
      "",
      "$$",
      "x_1 = A x_0",
      "$$",
      "",
      "$$x_2=A^2x_0$$",
    ].join("\n")]]);
    const rendered = render(graph({ previewMarkdownByLandmarkId }));

    openNodeMenu("a");
    const dialog = await screen.findByRole("dialog", { name: "Edit A" });
    fireEvent.click(await within(dialog).findByRole(
      "tab",
      { name: "Content" },
      { timeout: 4_000 },
    ));
    expect(within(dialog).queryByRole("group", { name: "Formula shown on landmark" }))
      .not.toBeInTheDocument();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Formula" }));
    rendered.rerender(graph({
      customizations: applyCustomizationUpdates(customizations),
      previewMarkdownByLandmarkId,
    }));
    const chooser = await within(dialog).findByRole("group", {
      name: "Formula shown on landmark",
    }, { timeout: 4_000 });
    const formulaButtons = within(chooser).getAllByRole("button", { name: /^Formula \d+$/ });
    expect(formulaButtons).toHaveLength(3);
    expect(formulaButtons.every((button) => button.querySelector(".katex"))).toBe(true);
    expect(formulaButtons[0]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(chooser).getByRole("button", { name: "Formula 3" }));
    const saved = applyCustomizationUpdates(customizations);
    expect(saved.landmarks.a).toMatchObject({
      contentMode: "formula",
      formulaIndex: 2,
      width: 336,
      height: 196,
    });

    rendered.rerender(graph({
      customizations: saved,
      previewMarkdownByLandmarkId,
    }));
    await waitFor(() => {
      expect(within(screen.getByRole("dialog", { name: "Edit A" }))
        .getByRole("button", { name: "Formula 3" }))
        .toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit A" }))
      .getByRole("button", { name: "Statement" }));
    rendered.rerender(graph({
      customizations: applyCustomizationUpdates(customizations),
      previewMarkdownByLandmarkId,
    }));
    expect(within(screen.getByRole("dialog", { name: "Edit A" }))
      .queryByRole("group", { name: "Formula shown on landmark" }))
      .not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit A" }))
      .getByRole("button", { name: "Formula" }));
    rendered.rerender(graph({
      customizations: applyCustomizationUpdates(customizations),
      previewMarkdownByLandmarkId,
    }));
    await waitFor(() => {
      expect(within(screen.getByRole("dialog", { name: "Edit A" }))
        .getByRole("button", { name: "Formula 3" }))
        .toHaveAttribute("aria-pressed", "true");
    });
  });

  it("keeps translucent groups free of inline fills and uses one clean shape vocabulary", () => {
    const { container } = render(graph());
    const landmarkShapes = OBJECT_SHAPE_OPTIONS.map(({ id }) => id);
    const groupShapes = GROUP_SHAPE_OPTIONS.map(({ id }) => id);
    const regionNodes = nodes().filter(({ type }) => type === "region");
    const landmarkNodes = nodes().filter(({ type }) => type === "landmark");

    expect(regionNodes.length).toBeGreaterThan(0);
    expect(regionNodes.every(({ data }) => groupShapes.includes(data.shape as never))).toBe(true);
    expect(landmarkNodes.every(({ data }) => landmarkShapes.includes(data.shape as never))).toBe(true);
    expect(node("region-frame:linear-models").data).not.toHaveProperty("onAppearanceChange");
    expect(node("region-frame:linear-models").data).not.toHaveProperty("onReset");
    expect(Object.keys(node("a").data).sort()).toEqual([
      "autoEditNote",
      "cancelToken",
      "color",
      "contentMode",
      "formulaIndex",
      "frameHeight",
      "frameWidth",
      "landmark",
      "onBeginNoteEdit",
      "onDirectGestureEnd",
      "onDirectGestureStart",
      "onMovePointerDown",
      "onRequestSelection",
      "onResizeEnd",
      "onSaveNote",
      "shape",
    ]);
    expect(node("a").data).not.toHaveProperty("topicTint");
    expect(node("a").data.shape).toBe("rectangle");
    expect(node("a").data.formulaIndex).toBe(0);

    const groupPaths = container.querySelectorAll(".region-frame__shape");
    expect(groupPaths.length).toBe(regionNodes.length);
    for (const path of groupPaths) {
      expect(path).not.toHaveAttribute("fill");
      expect(path).not.toHaveAttribute("style");
    }
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("does not create a connection when a drag is cancelled on blank space", () => {
    render(graph());
    const onConnectStart = flowCapture.props?.onConnectStart as () => void;
    const onConnect = flowCapture.props?.onConnect as (connection: Record<string, unknown>) => void;
    const onConnectEnd = flowCapture.props?.onConnectEnd as (event: unknown, state: Record<string, unknown>) => void;

    act(() => {
      onConnectStart();
      onConnect({ source: "a", sourceHandle: "right", target: "b", targetHandle: "left" });
      onConnectEnd({}, { isValid: false, toNode: null, toHandle: null });
    });

    expect(callbacks.onCustomizationsChange).not.toHaveBeenCalled();
  });

  it("commits a connection only after release on a real valid handle", () => {
    render(graph());
    const onConnectStart = flowCapture.props?.onConnectStart as () => void;
    const onConnect = flowCapture.props?.onConnect as (connection: Record<string, unknown>) => void;
    const onConnectEnd = flowCapture.props?.onConnectEnd as (event: unknown, state: Record<string, unknown>) => void;

    act(() => {
      onConnectStart();
      onConnect({ source: "a", sourceHandle: "right", target: "c", targetHandle: "left" });
      onConnectEnd({}, { isValid: true, toNode: { id: "c" }, toHandle: { id: "left" } });
    });

    expect(latestCustomizations().customConnections).toEqual([
      expect.objectContaining({
        source: "a",
        sourceHandle: "right",
        target: "c",
        targetHandle: "left",
      }),
    ]);
  });

  it("leaves the original edge untouched when endpoint reconnection is cancelled", () => {
    render(graph());
    const original = edges()[0];
    const onReconnectStart = flowCapture.props?.onReconnectStart as (
      event: unknown,
      edge: CapturedEdge,
      handleType: "source" | "target",
    ) => void;
    const onConnectStart = flowCapture.props?.onConnectStart as () => void;
    const onConnect = flowCapture.props?.onConnect as (connection: Record<string, unknown>) => void;
    const onReconnect = flowCapture.props?.onReconnect as (
      edge: CapturedEdge,
      connection: Record<string, unknown>,
    ) => void;
    const onConnectEnd = flowCapture.props?.onConnectEnd as (event: unknown, state: Record<string, unknown>) => void;
    const onReconnectEnd = flowCapture.props?.onReconnectEnd as (
      event: unknown,
      edge: CapturedEdge,
      handleType: "source" | "target",
      state: Record<string, unknown>,
    ) => void;

    act(() => {
      onReconnect(original, {
        source: original.source,
        sourceHandle: original.sourceHandle,
        target: original.target,
        targetHandle: original.targetHandle,
      });
      onReconnectStart({}, original, "target");
      onConnectStart();
      // Defensive simulation: even if a library version emits onConnect while
      // reconnecting, the candidate must never become a second relationship.
      onConnect({ source: "a", sourceHandle: "right", target: "c", targetHandle: "left" });
      onConnectEnd({}, { isValid: false, toNode: null, toHandle: null });
      onReconnectEnd({}, original, "target", { isValid: false, toNode: null, toHandle: null });
    });

    expect(callbacks.onCustomizationsChange).not.toHaveBeenCalled();
    expect(edges()[0]).toMatchObject({
      id: original.id,
      source: original.source,
      sourceHandle: original.sourceHandle,
      target: original.target,
      targetHandle: original.targetHandle,
    });
  });

  it("finishes an Escape-cancelled endpoint lifecycle before accepting the next reconnect", () => {
    render(graph());
    const original = edges()[0];
    const alternate = {
      source: original.source,
      sourceHandle: original.sourceHandle,
      target: "c",
      targetHandle: "left",
    };
    const onReconnectStart = flowCapture.props?.onReconnectStart as (
      event: unknown,
      edge: CapturedEdge,
      handleType: "source" | "target",
    ) => void;
    const onReconnect = flowCapture.props?.onReconnect as (
      edge: CapturedEdge,
      connection: Record<string, unknown>,
    ) => void;
    const onReconnectEnd = flowCapture.props?.onReconnectEnd as (
      event: unknown,
      edge: CapturedEdge,
      handleType: "source" | "target",
      state: Record<string, unknown>,
    ) => void;

    act(() => onReconnectStart({}, original, "target"));
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => {
      // A library may still report the valid handle underneath pointer-up;
      // the explicit cancellation must win.
      onReconnect(original, alternate);
      onReconnectEnd({}, original, "target", { isValid: true });
    });
    expect(callbacks.onCustomizationsChange).not.toHaveBeenCalled();

    act(() => {
      onReconnectStart({}, original, "target");
      onReconnect(original, alternate);
      onReconnectEnd({}, original, "target", { isValid: true });
    });
    expect(callbacks.onCustomizationsChange).toHaveBeenCalledOnce();
    expect(latestCustomizations().connectionOverrides[original.id]).toMatchObject(alternate);
  });

  it.each([
    ["target", { source: "a", sourceHandle: "right", target: "c", targetHandle: "left" }],
    ["source", { source: "c", sourceHandle: "left", target: "b", targetHandle: "right" }],
  ] as const)("reconnects the %s endpoint as one metadata-preserving persisted edit", (handleType, connection) => {
    const customized: MapCustomizations = {
      ...customizations,
      connectionOverrides: {
        "edge-1": {
          label: "because",
          color: "#1976D2",
          lineStyle: "dashed",
          pathStyle: "straight",
          direction: "both",
        },
      },
    };
    render(graph({ customizations: customized }));
    const original = edges()[0];
    const onReconnectStart = flowCapture.props?.onReconnectStart as (
      event: unknown,
      edge: CapturedEdge,
      handleType: "source" | "target",
    ) => void;
    const onReconnect = flowCapture.props?.onReconnect as (
      edge: CapturedEdge,
      connection: Record<string, unknown>,
    ) => void;
    const onConnectStart = flowCapture.props?.onConnectStart as () => void;
    const onConnectEnd = flowCapture.props?.onConnectEnd as (event: unknown, state: Record<string, unknown>) => void;
    const onReconnectEnd = flowCapture.props?.onReconnectEnd as (
      event: unknown,
      edge: CapturedEdge,
      handleType: "source" | "target",
      state: Record<string, unknown>,
    ) => void;

    act(() => {
      onReconnectStart({}, original, handleType);
      onConnectStart();
      onReconnect(original, connection);
      const toNode = handleType === "source" ? connection.source : connection.target;
      const toHandle = handleType === "source" ? connection.sourceHandle : connection.targetHandle;
      onConnectEnd({}, { isValid: true, toNode: { id: toNode }, toHandle: { id: toHandle } });
      onReconnectEnd({}, original, handleType, { isValid: true, toNode: { id: toNode }, toHandle: { id: toHandle } });
    });

    expect(callbacks.onCustomizationsChange).toHaveBeenCalledTimes(1);
    expect(latestCustomizations(customized).connectionOverrides["edge-1"]).toEqual({
      label: "because",
      color: "#1976D2",
      lineStyle: "dashed",
      pathStyle: "straight",
      direction: "both",
      ...connection,
    });
  });

  it("keeps drag start layout-only while preserving deliberate click selection", () => {
    render(graph());
    expect(flowCapture.props?.nodeDragThreshold).toBe(4);
    expect(flowCapture.props?.nodeClickDistance).toBe(4);

    const landmarkNode = node("a");
    expect(landmarkNode.data).not.toHaveProperty("onSelectLandmark");
    act(() => {
      const onNodeDragStart = flowCapture.props?.onNodeDragStart as (
        event: unknown,
        node: CapturedNode,
      ) => void;
      onNodeDragStart({}, landmarkNode);
    });
    expect(callbacks.onSelectLandmark).not.toHaveBeenCalled();

    act(() => {
      const onNodeClick = flowCapture.props?.onNodeClick as (
        event: unknown,
        node: CapturedNode,
      ) => void;
      onNodeClick({}, landmarkNode);
    });
    expect(callbacks.onSelectLandmark).toHaveBeenCalledOnce();
    expect(callbacks.onSelectLandmark).toHaveBeenCalledWith(landmarks[0]);
  });

  it("switches overview detail while preserving the manual group-edge-landmark stack", () => {
    render(graph());
    act(() => {
      const onMove = flowCapture.props?.onMove as (
        event: unknown,
        viewport: { x: number; y: number; zoom: number },
      ) => void;
      onMove(null, { x: 0, y: 0, zoom: 0.2 });
    });
    expect(screen.getByTestId("atlas-graph")).toHaveClass("is-overview");
    act(() => {
      const onMove = flowCapture.props?.onMove as (
        event: unknown,
        viewport: { x: number; y: number; zoom: number },
      ) => void;
      onMove(null, { x: 0, y: 0, zoom: 0.95 });
    });
    expect(screen.getByTestId("atlas-graph")).not.toHaveClass("is-overview");

    expect(nodes().find(({ type }) => type === "region")?.zIndex).toBe(0);
    expect(edges()[0].zIndex).toBe(1);
    expect(nodes().find(({ type }) => type === "landmark")?.zIndex).toBe(2);
    expect(flowCapture.props?.elevateNodesOnSelect).toBe(false);
    expect(flowCapture.props?.elevateEdgesOnSelect).toBe(false);
    expect(flowCapture.props?.zIndexMode).toBe("manual");
  });

  it("shows only authored or populated subject zones and keeps persisted group geometry", () => {
    render(
      graph({
        customizations: {
          ...customizations,
          groups: {
            "linear-models": { titlePosition: "bottom-right", titleFontSize: 41 },
          },
        },
      }),
    );

    const group = node("region-frame:linear-models");
    expect(group.width).toEqual(expect.any(Number));
    expect(group.height).toEqual(expect.any(Number));
    expect(group.dragHandle).toBeUndefined();
    expect(group.draggable).toBe(false);
    expect(group.data.titlePosition).toBe("bottom-right");
    expect(group.data.titleFontSize).toBe(41);

    const subjectZones = nodes().filter(
      ({ data }) => data.variant === "subject",
    );
    expect(subjectZones.map(({ id }) => id)).toEqual([
      "subject-zone:synthetic-field-05",
    ]);
    expect(subjectZones[0].data.memberIds).toEqual(["a", "b", "c"]);
    expect(subjectZones.every(({ data }) => data.level === "subject")).toBe(true);
    expect(group.data.level).toBe("group");
    expect(group.zIndex).toBe(.1);
    expect(subjectZones[0].data.titlePosition).toBe("top-left");
    expect(subjectZones[0].data.titleFontSize).toBe(28);
    expect(flowCapture.props?.minZoom).toBe(0.04);
  });

  it("keeps a new vault visually blank until canvas content is authored", () => {
    render(graph({
      snapshot: {
        ...snapshot,
        regions: [],
        landmarks: [],
        placements: [],
        connections: [],
      },
      landmarks: [],
      groupLandmarks: [],
    }));

    expect(nodes()).toEqual([]);
  });

  it("uses the root fallback for a free object on a completely empty public canvas", async () => {
    const onCreateLandmark = vi.fn();
    render(graph({
      snapshot: emptyPublicSnapshot,
      landmarks: [],
      groupLandmarks: [],
      onCreateLandmark,
    }));

    expect(() => openCanvasMenu()).not.toThrow();
    const dialog = await screen.findByRole("dialog", { name: "Create map object" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Definition" }));
    const name = await screen.findByRole("textbox", { name: "Definition name" });
    fireEvent.change(name, { target: { value: "Fixture object" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await waitFor(() => expect(onCreateLandmark).toHaveBeenCalledWith({
      title: "Fixture object",
      kind: "definition",
      subjectId: "root",
      regionId: "subject-zone:root",
      x: 28,
      y: 56,
      color: "#333333",
      shape: "rectangle",
    }));
  });

  it("assigns distinct safe subject identities to the first two empty-canvas subjects", async () => {
    render(graph({
      snapshot: emptyPublicSnapshot,
      landmarks: [],
      groupLandmarks: [],
    }));

    openCanvasMenu(420, 280);
    fireEvent.click(await screen.findByRole("button", { name: "Subject" }));
    let name = await screen.findByRole("textbox", { name: "Subject name" });
    fireEvent.change(name, { target: { value: "Fixture Subject Alpha" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    openCanvasMenu(1_680, 280);
    fireEvent.click(await screen.findByRole("button", { name: "Subject" }));
    name = await screen.findByRole("textbox", { name: "Subject name" });
    fireEvent.change(name, { target: { value: "Fixture Subject Beta" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const created = applyCustomizationUpdates(customizations).customGroups;
    expect(created.map(({ title }) => title)).toEqual([
      "Fixture Subject Alpha",
      "Fixture Subject Beta",
    ]);
    const subjectIds = created.map(({ subjectId }) => subjectId);
    expect(new Set(subjectIds).size).toBe(2);
    subjectIds.forEach((subjectId) => {
      expect(subjectId).not.toBe("root");
      expect(subjectId).toMatch(/^[a-z0-9][a-z0-9._:-]{0,159}$/i);
    });
  });

  it("keeps an informal note independent instead of deriving a subject frame around it", () => {
    const informalNote: Landmark = {
      ...landmark("scratch-note", "subject-zone:synthetic-field-04"),
      title: "Check this later",
      kind: "concept",
      subjectIds: ["synthetic-field-04"],
    };
    const noteCustomizations: MapCustomizations = {
      ...customizations,
      customLandmarks: [{
        id: informalNote.id,
        title: informalNote.title,
        kind: "concept",
        subjectId: "synthetic-field-04",
        regionId: "subject-zone:synthetic-field-04",
        contentPath: "content/Synthetic Field/Check this later.md",
        x: -1450,
        y: 420,
        width: 196,
        height: 112,
        color: "#f57c00",
        shape: "rectangle",
      }],
    };

    render(graph({
      snapshot: {
        ...snapshot,
        regions: [],
        landmarks: [informalNote],
        placements: [],
        connections: [],
      },
      landmarks: [informalNote],
      groupLandmarks: [informalNote],
      customizations: noteCustomizations,
    }));

    expect(node("scratch-note").position).toEqual({ x: -1456, y: 420 });
    expect(nodes().filter(({ type }) => type === "region")).toEqual([]);
    expect(nodes().some(({ id }) => id === "subject-zone:synthetic-field-04")).toBe(false);

    const noteNode = node("scratch-note");
    const movedNote = {
      ...noteNode,
      position: { x: noteNode.position.x + 56, y: noteNode.position.y - 28 },
    };
    act(() => {
      const start = flowCapture.props?.onNodeDragStart as (
        event: unknown,
        node: CapturedNode,
      ) => void;
      const stop = flowCapture.props?.onNodeDragStop as (
        event: unknown,
        node: CapturedNode,
      ) => void;
      start({}, noteNode);
      stop({}, movedNote);
    });

    expect(callbacks.onPlacementChange).toHaveBeenLastCalledWith({
      landmarkId: "scratch-note",
      x: -1400,
      y: 392,
    });
    expect(callbacks.onCustomizationsChange).not.toHaveBeenCalled();
  });

  it("keeps a file-backed canvas instance independent through every mathematical kind", () => {
    const emptySnapshot: AtlasSnapshot = {
      ...snapshot,
      regions: [],
      landmarks: [],
      placements: [],
      connections: [],
    };
    const canvasInstance = {
      id: "dropped-file-instance",
      title: "Linear regression",
      subjectId: "synthetic-field-04" as const,
      regionId: "subject-zone:synthetic-field-04",
      contentPath: "content/Synthetic Field/Public Fixture Note Gamma.md",
      x: -1456,
      y: 420,
      width: 196,
      height: 112,
      color: "#238636",
      shape: "rectangle" as const,
      kind: "concept" as const,
    };
    const landmarkModel: Landmark = {
      ...landmark(canvasInstance.id, canvasInstance.regionId),
      title: canvasInstance.title,
      kind: "concept",
      subjectIds: [canvasInstance.subjectId],
      contentPath: canvasInstance.contentPath,
    };
    const renderKind = (kind: EditableLandmarkKind) => graph({
      snapshot: emptySnapshot,
      landmarks: [{ ...landmarkModel, kind }],
      groupLandmarks: [{ ...landmarkModel, kind }],
      customizations: {
        ...customizations,
        customLandmarks: [{ ...canvasInstance, kind }],
      },
    });

    const { rerender } = render(renderKind("concept"));
    expect(nodes().filter(({ type }) => type === "region")).toEqual([]);

    const mathematicalKinds = [
      "definition",
      "theorem",
      "proposition",
      "lemma",
      "corollary",
      "method",
      "example",
    ] as const;
    mathematicalKinds.forEach((kind) => {
      rerender(renderKind(kind));
      expect(
        nodes().filter(({ type }) => type === "region"),
        `changing a dropped file to ${kind} must not invent a subject frame`,
      ).toEqual([]);
      expect(node(canvasInstance.id).data.landmark).toMatchObject({ kind });
    });
  });

  it("ignores stale derived subject styles while keeping an authored subject deletable", async () => {
    const emptySnapshot: AtlasSnapshot = {
      ...snapshot,
      regions: [],
      landmarks: [],
      placements: [],
      connections: [],
    };
    const authoredSubject = {
      id: "authored-subject",
      title: "Synthetic Field 05",
      subjectId: "synthetic-field-05" as const,
      level: "subject" as const,
      x: -700,
      y: -448,
      width: 1120,
      height: 700,
      color: "#238636",
      shape: "rectangle" as const,
      borderStyle: "double" as const,
      titlePosition: "top-left" as const,
    };
    const withLegacySubjectStyles: MapCustomizations = {
      ...customizations,
      groups: {
        "subject-zone:synthetic-field-04": { x: 1736, y: -812 },
        "subject-zone:synthetic-field-05": { x: 0, y: -532 },
      },
      customGroups: [authoredSubject],
    };

    render(graph({
      snapshot: emptySnapshot,
      landmarks: [],
      groupLandmarks: [],
      customizations: withLegacySubjectStyles,
    }));

    expect(nodes().filter(({ type }) => type === "region").map(({ id }) => id)).toEqual([
      "custom-group:authored-subject",
    ]);
    expect(node("custom-group:authored-subject").data).toMatchObject({
      variant: "custom",
      level: "subject",
    });

    openNodeMenu("custom-group:authored-subject");
    await screen.findByRole("dialog", { name: "Edit Synthetic Field 05" });
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));

    const next = latestCustomizations(withLegacySubjectStyles);
    expect(next.customGroups).toEqual([]);
  });

  it("reconciles a live frame when its hierarchy level changes", () => {
    const rendered = render(graph());
    expect(node("region-frame:linear-models").data.level).toBe("group");

    rendered.rerender(graph({
      customizations: {
        ...customizations,
        groups: {
          ...customizations.groups,
          "linear-models": { level: "subgroup", titleFontSize: 37 },
        },
      },
    }));

    expect(node("region-frame:linear-models").data.level).toBe("subgroup");
    expect(node("region-frame:linear-models").data.titleFontSize).toBe(37);
    expect(screen.getByText("Linear models")).toHaveStyle({ fontSize: "37px" });
    expect(screen.getByTestId("group-linear-models")).toHaveAttribute(
      "data-group-level",
      "subgroup",
    );
  });

  it("opens canvas, landmark, group, title, and edge menus at their pointer", async () => {
    render(graph({ onCreateLandmark: vi.fn() }));

    const canvasEvent = openCanvasMenu(113, 85);
    expect(canvasEvent.preventDefault).toHaveBeenCalledOnce();
    expect(flowCapture.screenToFlowPosition).toHaveBeenCalledWith({ x: 113, y: 85 });
    expect(await screen.findByRole("dialog", { name: "Create map object" })).toHaveStyle({
      left: "119px",
      top: "91px",
    });

    const landmarkEvent = openNodeMenu("a", 180, 110);
    expect(landmarkEvent.preventDefault).toHaveBeenCalledOnce();
    expect(callbacks.onSelectLandmark).toHaveBeenLastCalledWith(landmarks[0]);
    expect(await screen.findByRole("dialog", { name: "Edit A" })).toHaveStyle({
      left: "186px",
      top: "116px",
    });

    const groupEvent = openNodeMenu("region-frame:linear-models", 250, 140);
    expect(groupEvent.preventDefault).toHaveBeenCalledOnce();
    expect(await screen.findByRole("dialog", { name: "Edit Linear models" })).toHaveStyle({
      left: "256px",
      top: "146px",
    });

    act(() => {
      const request = node("region-frame:linear-models").data
        .onRequestContextMenu as (regionId: string, x: number, y: number) => void;
      request("linear-models", 310, 170);
    });
    expect(await screen.findByRole("dialog", { name: "Edit Linear models" })).toHaveStyle({
      left: "316px",
      top: "176px",
    });

    const edgeEvent = openEdgeMenu(370, 200);
    expect(edgeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(await screen.findByRole("dialog", { name: "Edit connection" })).toHaveStyle({
      left: "376px",
      top: "206px",
    });
    expect(screen.getByLabelText("Connection label")).toHaveAttribute(
      "maxlength",
      "160",
    );
  });

  it("separates an informal paper note from structure and mathematical objects", async () => {
    const onCreateLandmark = vi.fn();
    render(graph({ onCreateLandmark }));

    openCanvasMenu(113, 85);
    const dialog = await screen.findByRole("dialog", { name: "Create map object" });
    const structure = await within(dialog).findByRole("region", { name: "Structure" });
    const informal = await within(dialog).findByRole("region", { name: "Informal notes" });
    const mathematics = await within(dialog).findByRole("region", { name: "Mathematical objects" });
    const sections = Array.from(dialog.querySelectorAll(".map-create-menu__section"));

    expect(sections).toEqual([structure, informal, mathematics]);
    expect(structure).toHaveClass("map-create-menu__section--structure");
    expect(informal).toHaveClass("map-create-menu__section--informal");
    expect(mathematics).toHaveClass("map-create-menu__section--mathematics");
    expect(dialog.querySelector(".map-create-menu__section-label")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/structure|informal|mathematics/i);
    expect(within(structure).getAllByRole("button").map(({ textContent }) => textContent)).toEqual([
      "Subject",
      "Group",
      "Subgroup",
    ]);

    const note = within(informal).getByRole("button", { name: "Create informal note" });
    expect(note).toHaveClass("map-create-menu__note");
    expect(note).toHaveAttribute("data-landmark-kind", "concept");
    expect(note).toHaveTextContent("Note");
    expect(note.querySelector(".map-paper-note-glyph")).toBeInTheDocument();
    expect(within(mathematics).queryByText("Note")).not.toBeInTheDocument();
    expect(within(mathematics).getAllByRole("button").map(({ textContent }) => textContent)).toEqual([
      "Definition",
      "Theorem",
      "Proposition",
      "Lemma",
      "Corollary",
      "Method",
      "Example",
    ]);

    fireEvent.click(note);
    await waitFor(() => expect(onCreateLandmark).toHaveBeenCalledOnce());
    expect(screen.queryByRole("textbox", { name: "Note name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Name Note" })).not.toBeInTheDocument();
    expect(onCreateLandmark).toHaveBeenCalledWith({
      title: "",
      kind: "concept",
      subjectId: "synthetic-field-02",
      regionId: "subject-zone:synthetic-field-02",
      x: 28,
      y: 28,
      color: "#D32F2F",
      shape: "rectangle",
    });
  });

  it("keeps controls transient and names snapped objects from a canvas right-click", async () => {
    const onCreateLandmark = vi.fn();
    render(graph({ onCreateLandmark }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Connection label")).not.toBeInTheDocument();
    expect(document.querySelectorAll("select")).toHaveLength(0);
    act(() => {
      const onEdgeClick = flowCapture.props?.onEdgeClick as (
        event: unknown,
        edge: CapturedEdge,
      ) => void;
      onEdgeClick({}, edges()[0]);
    });
    expect(screen.queryByLabelText("Connection label")).not.toBeInTheDocument();

    openCanvasMenu(113, 85);
    fireEvent.click(await screen.findByRole("button", { name: "Definition" }));
    const name = await screen.findByRole("textbox", { name: "Definition name" });
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveValue("Untitled definition");
    expect(name).toHaveProperty("selectionStart", 0);
    expect(name).toHaveProperty("selectionEnd", "Untitled definition".length);
    fireEvent.change(name, { target: { value: "Metric space" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onCreateLandmark).toHaveBeenCalledWith({
      title: "Metric space",
      kind: "definition",
      subjectId: "synthetic-field-02",
      regionId: "subject-zone:synthetic-field-02",
      x: 28,
      y: 56,
      color: "#D32F2F",
      shape: "rectangle",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openCanvasMenu(197, 141);
    fireEvent.click(await screen.findByRole("button", { name: "Group" }));
    const groupName = await screen.findByRole("textbox", { name: "Group name" });
    await waitFor(() => expect(groupName).toHaveFocus());
    expect(groupName).toHaveValue("Untitled group");
    expect(groupName).toHaveProperty("selectionStart", 0);
    expect(groupName).toHaveProperty("selectionEnd", "Untitled group".length);
    fireEvent.change(groupName, { target: { value: "Models / estimators" } });
    fireEvent.keyDown(groupName, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const next = latestCustomizations();
    expect(next.customGroups).toHaveLength(1);
    expect(next.customGroups[0]).toMatchObject({
      title: "Models / estimators",
      subjectId: "synthetic-field-02",
      level: "group",
      x: -140,
      y: -84,
      width: 700,
      height: 448,
      color: DEFAULT_GROUP_COLOR,
      shape: "rectangle",
    });
    expect(next.customGroups[0].parentId).toBeUndefined();
  });

  it("creates subject frames and shape-distinct nested subgroups as canvas-only objects", async () => {
    const first = render(graph());
    openCanvasMenu(420, 280);
    fireEvent.click(await screen.findByRole("button", { name: "Subject" }));
    const subjectName = await screen.findByRole("textbox", { name: "Subject name" });
    await waitFor(() => expect(subjectName).toHaveFocus());
    fireEvent.change(subjectName, { target: { value: "Synthetic Subject" } });
    fireEvent.keyDown(subjectName, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const subject = latestCustomizations().customGroups[0];
    expect(subject).toMatchObject({
      title: "Synthetic Subject",
      level: "subject",
      width: 1120,
      height: 700,
      shape: "rectangle",
      borderStyle: "double",
    });
    expect(subject.parentId).toBeUndefined();
    first.unmount();
    vi.clearAllMocks();

    render(graph());
    const parent = node("region-frame:linear-models");
    const x = parent.position.x + Number(parent.width) / 2;
    const y = parent.position.y + Number(parent.height) / 2;
    openCanvasMenu(x, y);
    fireEvent.click(await screen.findByRole("button", { name: "Subgroup" }));
    const subgroupName = await screen.findByRole("textbox", { name: "Subgroup name" });
    await waitFor(() => expect(subgroupName).toHaveFocus());
    fireEvent.change(subgroupName, { target: { value: "Linear regression" } });
    fireEvent.keyDown(subgroupName, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const subgroup = latestCustomizations().customGroups[0];
    expect(subgroup).toMatchObject({
      title: "Linear regression",
      level: "subgroup",
      parentId: "linear-models",
      width: 420,
      height: 252,
      shape: "oval",
      color: DEFAULT_GROUP_COLOR,
    });
  });

  it("keeps the naming palette open for validation and creation failures", async () => {
    let rejectCreation: ((reason: Error) => void) | undefined;
    const onCreateLandmark = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectCreation = reject;
    }));
    render(graph({ onCreateLandmark }));

    openCanvasMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Theorem" }));
    const name = await screen.findByRole("textbox", { name: "Theorem name" });
    await waitFor(() => expect(name).toHaveFocus());

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onCreateLandmark).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(screen.getByRole("dialog", { name: "Name Theorem" })).toBeInTheDocument();

    fireEvent.change(name, { target: { value: "Fixture theorem.md" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onCreateLandmark).toHaveBeenCalledWith(expect.objectContaining({
      title: "Fixture theorem",
      kind: "theorem",
    }));
    expect(name).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Name Theorem" })).toBeInTheDocument();

    await act(async () => {
      rejectCreation?.(new Error("A note with that name already exists."));
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A note with that name already exists.",
    );
    expect(name).not.toBeDisabled();
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("cancels naming with Escape and returns to object types from the back control", async () => {
    const onCreateLandmark = vi.fn();
    render(graph({ onCreateLandmark }));

    openCanvasMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Lemma" }));
    const lemmaName = await screen.findByRole("textbox", { name: "Lemma name" });
    await waitFor(() => expect(lemmaName).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Back to object types" }));
    expect(await screen.findByRole("button", { name: "Definition" })).toBeInTheDocument();
    expect(onCreateLandmark).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Example" }));
    const exampleName = await screen.findByRole("textbox", { name: "Example name" });
    await waitFor(() => expect(exampleName).toHaveFocus());
    fireEvent.keyDown(exampleName, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onCreateLandmark).not.toHaveBeenCalled();
  });

  it("accepts note-file drops as snapped copy placements", async () => {
    const onPlaceNote = vi.fn();
    flowCapture.screenToFlowPosition.mockReturnValue({ x: 197, y: 141 });
    render(graph({ onPlaceNote }));
    const dataTransfer = {
      types: [NOTE_FILE_DRAG_MIME],
      dropEffect: "none",
      getData: vi.fn((type: string) => type === NOTE_FILE_DRAG_MIME
        ? serializeNoteFileDragPayload({
            path: "Synthetic Field/New note.md",
            title: "New note",
            noteId: "note-source-id",
          })
        : ""),
    };
    const atlas = screen.getByTestId("atlas-graph");

    fireEvent.dragEnter(atlas, { dataTransfer });
    expect(screen.getByTestId("canvas-note-drop-cue")).toHaveTextContent("Place a copy");
    expect(dataTransfer.dropEffect).toBe("copy");

    fireEvent.drop(atlas, {
      clientX: 197,
      clientY: 141,
      dataTransfer,
    });

    await waitFor(() => expect(onPlaceNote).toHaveBeenCalledWith({
        kind: "math-atlas-note",
        version: 1,
        path: "Synthetic Field/New note.md",
        title: "New note",
        noteId: "note-source-id",
        subjectId: "synthetic-field-02",
        regionId: "subject-zone:synthetic-field-02",
        x: 112,
        y: 84,
      }));
    expect(screen.queryByTestId("canvas-note-drop-cue")).not.toBeInTheDocument();
  });

  it("places a note batch in one compact snapped canvas transaction", async () => {
    const onPlaceNotes = vi.fn();
    flowCapture.screenToFlowPosition.mockReturnValue({ x: 1100, y: 700 });
    render(graph({ onPlaceNotes }));
    const dataTransfer = {
      types: [NOTE_FILE_DRAG_MIME],
      dropEffect: "none",
      getData: vi.fn((type: string) => type === NOTE_FILE_DRAG_MIME
        ? serializeNoteFileDragBatchPayload([
            { path: "Synthetic Field/A.md", title: "A", noteId: "a" },
            { path: "Synthetic Field/B.md", title: "B" },
            { path: "Synthetic Field/C.md", title: "C", noteId: "b" },
          ])
        : ""),
    };

    fireEvent.drop(screen.getByTestId("atlas-graph"), {
      clientX: 1100,
      clientY: 700,
      dataTransfer,
    });

    await waitFor(() => {
      expect(onPlaceNotes).toHaveBeenCalledTimes(1);
      expect(onPlaceNotes).toHaveBeenCalledWith([
        expect.objectContaining({ path: "Synthetic Field/A.md", x: 1008, y: 672 }),
        expect.objectContaining({ path: "Synthetic Field/B.md", x: 1232, y: 672 }),
        expect.objectContaining({ path: "Synthetic Field/C.md", x: 1008, y: 812 }),
      ]);
    });
  });

  it("hides primary canvas instances without removing their note model", () => {
    render(graph({
      customizations: {
        ...customizations,
        landmarks: { a: { hidden: true } },
      },
    }));

    expect(nodes().some(({ id }) => id === "a")).toBe(false);
    expect(edges()).toHaveLength(0);
    expect(landmarks.some(({ id }) => id === "a")).toBe(true);
  });

  it("offers file-safe removal from a landmark menu", async () => {
    const onRemoveCanvasObjects = vi.fn();
    render(graph({ onRemoveCanvasObjects }));

    openNodeMenu("a");
    await screen.findByRole("dialog", { name: "Edit A" });
    fireEvent.click(screen.getByRole("button", { name: "Remove from canvas" }));

    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a"],
      customGroupIds: [],
      connectionIds: [],
    });
    expect(screen.queryByRole("dialog", { name: "Edit A" })).not.toBeInTheDocument();
  });

  it("uses icon-only shape, frame, arrow, line, and path controls without selects", async () => {
    render(graph());

    openNodeMenu("a");
    let dialog = await screen.findByRole("dialog", { name: "Edit A" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Shape" }));
    await waitFor(() => expect(dialog.querySelectorAll(".map-tool-shape")).toHaveLength(
      OBJECT_SHAPE_OPTIONS.length,
    ));
    expect(within(dialog).queryByRole("button", { name: "Cloud rectangle" })).not.toBeInTheDocument();
    const hexagon = within(dialog).getByRole("button", { name: "Hexagon" });
    expect(hexagon.querySelector(".map-tool-shape")).toBeInTheDocument();
    fireEvent.click(hexagon);
    expect(latestCustomizations().landmarks.a.shape).toBe("hexagon");

    openNodeMenu("region-frame:linear-models");
    dialog = await screen.findByRole("dialog", { name: "Edit Linear models" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Shape" }));
    await waitFor(() => expect(dialog.querySelectorAll(".map-tool-shape")).toHaveLength(
      GROUP_SHAPE_OPTIONS.length,
    ));
    const cloudRectangle = within(dialog).getByRole("button", { name: "Cloud rectangle" });
    expect(cloudRectangle.querySelector(".map-tool-shape")).toBeInTheDocument();
    fireEvent.click(cloudRectangle);
    expect(latestCustomizations().groups["linear-models"].shape).toBe("rounded-rectangle");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Frame" }));
    const dashedFrame = await within(dialog).findByRole("button", { name: "Dashed frame" });
    expect(dashedFrame).toContainElement(
      dashedFrame.querySelector(".map-tool-stroke"),
    );
    fireEvent.click(dashedFrame);
    expect(latestCustomizations().groups["linear-models"].borderStyle).toBe(
      "dashed",
    );

    openEdgeMenu();
    dialog = await screen.findByRole("dialog", { name: "Edit connection" });
    expect((await within(dialog).findByRole("button", { name: "Forward" })).querySelector("svg")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Line" }));
    const dashed = await within(dialog).findByRole("button", { name: "Dashed line" });
    const dotted = within(dialog).getByRole("button", { name: "Dotted line" });
    expect(dashed.querySelector(".map-tool-stroke path")).toHaveAttribute(
      "stroke-dasharray",
      "5 3",
    );
    expect(dotted.querySelector(".map-tool-stroke path")).toHaveAttribute(
      "stroke-dasharray",
      "1 4",
    );
    fireEvent.click(dotted);
    expect(latestCustomizations().connectionOverrides["edge-1"].lineStyle).toBe(
      "dotted",
    );
    fireEvent.click(within(dialog).getByRole("tab", { name: "Path" }));
    expect((await within(dialog).findByRole("button", { name: "Curved path" })).querySelector(".map-tool-stroke")).toBeInTheDocument();
    expect(dialog.querySelectorAll("select")).toHaveLength(0);
  });

  it("previews title anchors and changes title size from one compact title panel", async () => {
    render(graph({
      customizations: {
        ...customizations,
        groups: { "linear-models": { shape: "rhombus" } },
      },
    }));

    openNodeMenu("region-frame:linear-models");
    const dialog = await screen.findByRole("dialog", { name: "Edit Linear models" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Title" }));
    await waitFor(() => expect(dialog.querySelector(".map-anchor-picker path")).toHaveAttribute(
      "d",
      objectShapeGlyph("rhombus", 150, 82).framePath,
    ));
    expect(within(dialog).getByRole("button", { name: "Place label top-left" })).toHaveStyle({
      left: "25%",
      top: "25%",
    });
    const slider = within(dialog).getByRole("slider", { name: "Group title size" });
    expect(slider).toHaveValue("28");
    fireEvent.input(slider, { target: { value: "37" } });
    expect(within(dialog).getByLabelText("Current group title size")).toHaveTextContent("37");
    fireEvent.pointerUp(slider);
    expect(latestCustomizations().groups["linear-models"].titleFontSize).toBe(37);
    expect(within(dialog).getByRole("button", { name: "Set group title size to 48" })).toBeInTheDocument();
    expect(dialog.querySelectorAll("select")).toHaveLength(0);
  });

  it("keeps subject controls neutral and outline-only", async () => {
    render(graph());

    openNodeMenu("subject-zone:synthetic-field-05");
    const dialog = await screen.findByRole("dialog", { name: "Edit Synthetic Field 05" });
    expect(within(dialog).queryByRole("tab", { name: "Colour" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Frame" }));
    await within(dialog).findByRole("button", { name: "Solid frame" });
    expect(within(dialog).queryByRole("slider", { name: "Fine tune group fill opacity" }))
      .not.toBeInTheDocument();
  });

  it("copies one object's colour and pastes it onto another object", async () => {
    render(graph());
    const sourceColor = node("a").data.color;

    openNodeMenu("a");
    await screen.findByRole("dialog", { name: "Edit A" });
    fireEvent.click(screen.getByRole("tab", { name: "Colour" }));
    expect(await screen.findByRole("button", { name: "Paste copied colour" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy colour" }));

    openNodeMenu("c");
    await screen.findByRole("dialog", { name: "Edit C" });
    fireEvent.click(screen.getByRole("tab", { name: "Colour" }));
    const paste = await screen.findByRole("button", { name: "Paste copied colour" });
    expect(paste).toBeEnabled();
    fireEvent.click(paste);
    expect(latestCustomizations().landmarks.c.color).toBe(sourceColor);
  });

  it("accepts controlled edge selection without opening a permanent editor", () => {
    render(graph());
    act(() => {
      const onEdgesChange = flowCapture.props?.onEdgesChange as (
        changes: unknown[],
      ) => void;
      onEdgesChange([{ id: "edge-1", type: "select", selected: true }]);
    });

    expect(edges()[0].selected).toBe(true);
    expect(screen.queryByLabelText("Connection label")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit connection" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("deletes an explicit mixed multi-selection as one shell transaction", () => {
    const onRemoveCanvasObjects = vi.fn();
    const duplicate = {
      ...landmark("instance-copy", "linear-models"),
      title: "A second copy",
      contentPath: "content/Synthetic Field/Shared.md",
    };
    const mixedSnapshot: AtlasSnapshot = {
      ...snapshot,
      landmarks: [
        { ...landmarks[0], contentPath: duplicate.contentPath },
        landmarks[1],
        landmarks[2],
      ],
      connections: [
        ...snapshot.connections,
        { id: "edge-2", source: "b", target: "c", kind: "related-to" },
      ],
    };
    const mixedCustomizations: MapCustomizations = {
      ...customizations,
      customLandmarks: [{
        id: duplicate.id,
        title: duplicate.title,
        subjectId: "synthetic-field-05",
        regionId: "linear-models",
        contentPath: duplicate.contentPath!,
        x: 840,
        y: 280,
        width: 196,
        height: 112,
        color: "#238636",
        shape: "rectangle",
        kind: "concept",
      }],
      customGroups: [{
        id: "selected-group",
        title: "Selected group",
        subjectId: "synthetic-field-05",
        level: "group",
        x: 700,
        y: 420,
        width: 700,
        height: 448,
        color: "#238636",
        shape: "rectangle",
      }],
      customConnections: [{
        id: "custom-edge",
        source: "a",
        target: "custom-group:selected-group",
      }],
    };
    render(graph({
      snapshot: mixedSnapshot,
      landmarks: [...mixedSnapshot.landmarks, duplicate],
      groupLandmarks: [...mixedSnapshot.landmarks, duplicate],
      customizations: mixedCustomizations,
      selectedContentPath: "Synthetic Field/Shared.md",
      onRemoveCanvasObjects,
    }));

    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([
        { id: "a", type: "select", selected: true },
        { id: "custom-group:selected-group", type: "select", selected: true },
        // Derived frames may be selected, but are deliberately protected.
        { id: "region-frame:linear-models", type: "select", selected: true },
      ]);
      const onEdgesChange = flowCapture.props?.onEdgesChange as (changes: unknown[]) => void;
      onEdgesChange([
        { id: "edge-1", type: "select", selected: true },
        { id: "custom-edge", type: "select", selected: true },
      ]);
    });

    expect(node("instance-copy").selected).toBe(false);
    expect(node("instance-copy").data.selectionEmphasis).toBeUndefined();
    const event = new KeyboardEvent("keydown", {
      key: "Delete",
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onRemoveCanvasObjects).toHaveBeenCalledOnce();
    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a"],
      customGroupIds: ["selected-group"],
      connectionIds: ["edge-1", "custom-edge"],
    });
  });

  it("deletes only the clicked copy when Files semantically highlights duplicates", () => {
    const onRemoveCanvasObjects = vi.fn();
    const copies = landmarks.map((item, index) => index < 2
      ? { ...item, contentPath: "content/Synthetic Field/Shared.md" }
      : item);
    render(graph({
      landmarks: copies,
      groupLandmarks: copies,
      selectedContentPath: "Synthetic Field/Shared.md",
      onRemoveCanvasObjects,
    }));
    expect(node("a").selected).toBe(false);
    expect(node("b").selected).toBe(false);
    expect(node("a").data.selectionEmphasis).toBe(true);
    expect(node("b").data.selectionEmphasis).toBe(true);

    act(() => {
      const onNodeClick = flowCapture.props?.onNodeClick as (
        event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
        node: CapturedNode,
      ) => void;
      onNodeClick({ ctrlKey: false, metaKey: false, shiftKey: false }, node("a"));
    });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a"],
      customGroupIds: [],
      connectionIds: [],
    });
  });

  it("keeps an operational batch intact when right-clicking one selected member", async () => {
    const onRemoveCanvasObjects = vi.fn();
    render(graph({ onRemoveCanvasObjects }));

    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([
        { id: "a", type: "select", selected: true },
        { id: "b", type: "select", selected: true },
      ]);
      const onEdgesChange = flowCapture.props?.onEdgesChange as (changes: unknown[]) => void;
      onEdgesChange([{ id: "edge-1", type: "select", selected: true }]);
    });

    const event = openNodeMenu("a", 410, 260);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(node("a").selected).toBe(true);
    expect(node("b").selected).toBe(true);
    expect(edges()[0].selected).toBe(true);

    const dialog = await screen.findByRole("dialog", { name: "Edit A" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from canvas" }));

    expect(onRemoveCanvasObjects).toHaveBeenCalledOnce();
    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a", "b"],
      customGroupIds: [],
      connectionIds: ["edge-1"],
    });
    expect(node("a").selected).toBe(false);
    expect(node("b").selected).toBe(false);
    expect(edges()[0].selected).toBe(false);
  });

  it("replaces the operational batch when right-clicking an unselected object", async () => {
    const onRemoveCanvasObjects = vi.fn();
    render(graph({ onRemoveCanvasObjects }));

    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([
        { id: "a", type: "select", selected: true },
        { id: "b", type: "select", selected: true },
      ]);
      const onEdgesChange = flowCapture.props?.onEdgesChange as (changes: unknown[]) => void;
      onEdgesChange([{ id: "edge-1", type: "select", selected: true }]);
    });

    openNodeMenu("c");
    expect(node("a").selected).toBe(false);
    expect(node("b").selected).toBe(false);
    expect(node("c").selected).toBe(true);
    expect(edges()[0].selected).toBe(false);

    const dialog = await screen.findByRole("dialog", { name: "Edit C" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from canvas" }));
    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["c"],
      customGroupIds: [],
      connectionIds: [],
    });
  });

  it("maps left drag to marquee selection and right drag to canvas panning", () => {
    const rendered = render(graph());
    expect(flowCapture.props?.panOnDrag).toEqual([2]);
    expect(flowCapture.props?.selectionOnDrag).toBe(true);
    expect(flowCapture.props?.multiSelectionKeyCode).toEqual(["Meta", "Control", "Shift"]);
    expect(flowCapture.props?.selectionKeyCode).toBe("Shift");

    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([
        { id: "a", type: "select", selected: true },
        { id: "b", type: "select", selected: true },
      ]);
    });
    expect(node("a").selected).toBe(true);
    expect(node("b").selected).toBe(true);

    rendered.rerender(graph({
      customizations: {
        ...customizations,
        landmarks: { c: { color: "#123456" } },
      },
    }));
    expect(node("a").selected).toBe(true);
    expect(node("b").selected).toBe(true);
  });

  it("clears node and connection selections when left-clicking blank canvas", () => {
    render(graph());
    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([
        { id: "a", type: "select", selected: true },
        { id: "b", type: "select", selected: true },
      ]);
      const onEdgesChange = flowCapture.props?.onEdgesChange as (changes: unknown[]) => void;
      onEdgesChange([{ id: "edge-1", type: "select", selected: true }]);
    });
    expect(node("a").selected).toBe(true);
    expect(node("b").selected).toBe(true);
    expect(edges()[0].selected).toBe(true);

    act(() => {
      const onPaneClick = flowCapture.props?.onPaneClick as () => void;
      onPaneClick();
    });

    expect(node("a").selected).toBe(false);
    expect(node("b").selected).toBe(false);
    expect(edges()[0].selected).toBe(false);
  });

  it("keeps Delete and Backspace out of every text-editing surface", () => {
    const onRemoveCanvasObjects = vi.fn();
    render(graph({ onRemoveCanvasObjects }));
    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([{ id: "a", type: "select", selected: true }]);
    });

    const targets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      Object.assign(document.createElement("div"), { contentEditable: "true" }),
      Object.assign(document.createElement("div"), { className: "cm-editor" }),
      Object.assign(document.createElement("div"), { className: "file-explorer" }),
    ];
    targets.forEach((target, index) => {
      document.body.append(target);
      fireEvent.keyDown(target, { key: index % 2 ? "Backspace" : "Delete" });
      target.remove();
    });

    expect(onRemoveCanvasObjects).not.toHaveBeenCalled();
  });

  it("supports Backspace and ignores deletion during an active connection gesture", () => {
    const onRemoveCanvasObjects = vi.fn();
    render(graph({ onRemoveCanvasObjects }));
    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([{ id: "a", type: "select", selected: true }]);
      const onConnectStart = flowCapture.props?.onConnectStart as (
        event: unknown,
        params: { nodeId: string },
      ) => void;
      onConnectStart({}, { nodeId: "a" });
    });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onRemoveCanvasObjects).not.toHaveBeenCalled();

    act(() => {
      const onConnectEnd = flowCapture.props?.onConnectEnd as (
        event: unknown,
        state: Record<string, unknown>,
      ) => void;
      onConnectEnd({}, { isValid: false });
    });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a"],
      customGroupIds: [],
      connectionIds: [],
    });
  });

  it("does not rebuild node blueprints for connection-only edits", () => {
    const rendered = render(graph());
    const originalNodes = flowCapture.props?.nodes;
    rendered.rerender(
      graph({
        customizations: {
          ...customizations,
          connectionOverrides: { "edge-1": { label: "edited" } },
        },
      }),
    );
    expect(flowCapture.props?.nodes).toBe(originalNodes);
  });

  it("keeps the full map mounted while search matches and relationships are emphasized", () => {
    const searchSnapshot: AtlasSnapshot = {
      ...snapshot,
      connections: [
        ...snapshot.connections,
        { id: "edge-2", source: "b", target: "c", kind: "related-to" },
      ],
    };
    const rendered = render(graph({ snapshot: searchSnapshot, searchMatchIds: new Set(["a"]) }));

    expect(nodes().filter(({ type }) => type === "landmark")).toHaveLength(landmarks.length);
    expect(node("a").data.searchEmphasis).toBe("match");
    expect(node("b").data.searchEmphasis).toBe("muted");
    expect(node("c").data.searchEmphasis).toBe("muted");
    expect(edges()[0]).toMatchObject({
      className: "atlas-edge is-search-context",
      style: { opacity: .28 },
    });
    expect(edges()[1]).toMatchObject({
      className: "atlas-edge is-search-muted",
      style: { opacity: .08 },
    });

    const stableMutedNode = node("c");
    rendered.rerender(graph({ snapshot: searchSnapshot, searchMatchIds: new Set(["a", "b"]) }));
    expect(node("a").data.searchEmphasis).toBe("match");
    expect(node("b").data.searchEmphasis).toBe("match");
    expect(node("c")).toBe(stableMutedNode);
    expect(edges()[0]).toMatchObject({
      className: "atlas-edge is-search-match",
      style: { opacity: 1, strokeWidth: 1.8 },
    });

    const stableNodes = flowCapture.props?.nodes;
    const stableEdges = flowCapture.props?.edges;
    rendered.rerender(graph({ snapshot: searchSnapshot, searchMatchIds: new Set(["a", "b"]) }));
    expect(flowCapture.props?.nodes).toBe(stableNodes);
    expect(flowCapture.props?.edges).toBe(stableEdges);

    rendered.rerender(graph({ snapshot: searchSnapshot }));
    expect(node("a").data).not.toHaveProperty("searchEmphasis");
    expect(node("b").data).not.toHaveProperty("searchEmphasis");
    expect(edges()[0]).toMatchObject({
      className: "atlas-edge",
      style: { opacity: .88 },
    });
  });

  it("bounds identity churn on a canvas with hundreds of landmarks and connections", () => {
    const largeLandmarks = Array.from({ length: 420 }, (_, index) => ({
      ...landmark(`bulk-${index}`, "linear-models"),
      title: `Landmark ${index}`,
    }));
    const largeSnapshot: AtlasSnapshot = {
      ...snapshot,
      landmarks: largeLandmarks,
      placements: largeLandmarks.map(({ id }, index) => ({
        landmarkId: id,
        x: (index % 30) * 224,
        y: 1400 - Math.floor(index / 30) * 112,
      })),
      connections: Array.from({ length: 800 }, (_, index) => ({
        id: `bulk-edge-${index}`,
        source: `bulk-${index % largeLandmarks.length}`,
        target: `bulk-${(index * 7 + 13) % largeLandmarks.length}`,
        kind: "related-to" as const,
      })).filter(({ source, target }) => source !== target),
    };
    const rendered = render(graph({
      snapshot: largeSnapshot,
      landmarks: largeLandmarks,
      groupLandmarks: largeLandmarks,
    }));
    const beforeNodes = new Map(nodes().map((candidate) => [candidate.id, candidate]));
    const beforeEdges = edges();

    rendered.rerender(graph({
      snapshot: largeSnapshot,
      landmarks: largeLandmarks,
      groupLandmarks: largeLandmarks,
      selectedLandmarkId: "bulk-217",
    }));

    const changedNodeIds = nodes()
      .filter((candidate) => beforeNodes.get(candidate.id) !== candidate)
      .map(({ id }) => id);
    expect(changedNodeIds).toEqual(["bulk-217"]);
    expect(edges()).toBe(beforeEdges);

    const nodesBeforeEdgeSelection = flowCapture.props?.nodes;
    const edgesBeforeSelection = edges();
    act(() => {
      const onEdgeClick = flowCapture.props?.onEdgeClick as (
        event: unknown,
        edge: CapturedEdge,
      ) => void;
      onEdgeClick({}, edgesBeforeSelection[317]);
    });
    const changedEdgeIds = edges()
      .filter((candidate, index) => candidate !== edgesBeforeSelection[index])
      .map(({ id }) => id);
    expect(changedEdgeIds).toEqual([edgesBeforeSelection[317].id]);
    expect(flowCapture.props?.nodes).not.toBe(nodesBeforeEdgeSelection);
    expect(nodes()
      .filter((candidate, index) => candidate !== (nodesBeforeEdgeSelection as CapturedNode[])[index])
      .map(({ id }) => id)).toEqual(["bulk-217"]);
    expect(node("bulk-217").data.selectionEmphasis).toBeUndefined();
  });

  it("coalesces repeated group-drag previews into one animation-frame update", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(graph());
    requestFrame.mockClear();
    queuedFrames.length = 0;
    const group = node("subject-zone:synthetic-field-05");
    const start = group.data.onTitleDragStart as (
      regionId: string,
      startClientX: number,
      startClientY: number,
      clientX: number,
      clientY: number,
    ) => void;
    const move = group.data.onTitleDrag as (
      regionId: string,
      x: number,
      y: number,
      clientX: number,
      clientY: number,
    ) => void;

    act(() => {
      start("subject-zone:synthetic-field-05", 0, 0, 0, 0);
      for (let index = 1; index <= 40; index += 1) {
        move("subject-zone:synthetic-field-05", index * 3, index * 2, index * 3, index * 2);
      }
    });

    expect(requestFrame).toHaveBeenCalledOnce();
    act(() => queuedFrames[0](16));
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it("moves an explicitly nested empty subgroup with its custom parent in preview and persistence", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const hierarchy: MapCustomizations = {
      ...customizations,
      customGroups: [
        {
          id: "custom-parent",
          title: "Parent models",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: 2800,
          y: 2800,
          width: 700,
          height: 448,
          color: "#238636",
          shape: "rectangle",
          borderStyle: "solid",
          titlePosition: "top-left",
        },
        {
          id: "empty-child",
          title: "Empty child",
          subjectId: "synthetic-field-05",
          level: "subgroup",
          parentId: "custom-parent",
          x: 2940,
          y: 2912,
          width: 420,
          height: 252,
          color: "#238636",
          shape: "oval",
          borderStyle: "solid",
          titlePosition: "top-left",
        },
      ],
    };
    render(graph({ customizations: hierarchy }));
    queuedFrames.length = 0;

    const parent = node("custom-group:custom-parent");
    const childBefore = node("custom-group:empty-child");
    expect(childBefore.data.memberIds).toEqual([]);
    const start = parent.data.onTitleDragStart as (...args: [string, number, number, number, number]) => void;
    const move = parent.data.onTitleDrag as (...args: [string, number, number, number, number]) => void;
    const end = parent.data.onTitleDragEnd as (...args: [string, number, number, number, number]) => void;

    act(() => {
      start("custom-parent", 0, 0, 0, 0);
      move("custom-parent", 56, -28, 56, -28);
    });
    expect(queuedFrames).toHaveLength(1);
    act(() => queuedFrames[0](16));
    expect(node("custom-group:empty-child").position).toEqual({
      x: childBefore.position.x + 56,
      y: childBefore.position.y - 28,
    });

    const firstPersistenceCall = callbacks.onCustomizationsChange.mock.calls.length;
    act(() => end("custom-parent", 56, -28, 56, -28));
    const persisted = applyCustomizationUpdates(hierarchy, firstPersistenceCall);
    expect(persisted.customGroups).toEqual([
      expect.objectContaining({
        id: "custom-parent",
        x: parent.position.x + 56,
        y: parent.position.y - 28,
      }),
      expect.objectContaining({
        id: "empty-child",
        parentId: "custom-parent",
        x: childBefore.position.x + 56,
        y: childBefore.position.y - 28,
      }),
    ]);
    expect(callbacks.onPlacementChanges).toHaveBeenCalledWith([]);
  });

  it("moves a descendant subgroup's landmarks even when they lie outside the parent contour", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const descendant = {
      ...landmark("descendant-member", "linear-models"),
      title: "Outside parent, inside child",
      contentPath: "content/Synthetic Field/Outside parent.md",
    };
    const descendantInstance = {
      id: descendant.id,
      title: descendant.title,
      subjectId: "synthetic-field-05" as const,
      regionId: "linear-models",
      contentPath: descendant.contentPath,
      x: 3640,
      y: 2940,
      width: 196,
      height: 84,
      color: "#238636",
      shape: "rectangle" as const,
      kind: "concept" as const,
    };
    const hierarchy: MapCustomizations = {
      ...customizations,
      customLandmarks: [descendantInstance],
      customGroups: [
        {
          id: "custom-parent",
          title: "Parent models",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: 2800,
          y: 2800,
          width: 700,
          height: 448,
          color: "#238636",
          shape: "rectangle",
        },
        {
          id: "outside-child",
          title: "Outside child",
          subjectId: "synthetic-field-05",
          level: "subgroup",
          parentId: "custom-parent",
          x: 3500,
          y: 2884,
          width: 560,
          height: 252,
          color: "#238636",
          shape: "rectangle",
        },
      ],
    };
    const allLandmarks = [...landmarks, descendant];
    render(graph({
      customizations: hierarchy,
      landmarks: allLandmarks,
      groupLandmarks: allLandmarks,
    }));
    queuedFrames.length = 0;

    const parent = node("custom-group:custom-parent");
    const child = node("custom-group:outside-child");
    const memberBefore = { ...node(descendant.id).position };
    expect(parent.data.memberIds).not.toContain(descendant.id);
    expect(child.data.memberIds).toContain(descendant.id);
    const start = parent.data.onTitleDragStart as (...args: [string, number, number, number, number]) => void;
    const move = parent.data.onTitleDrag as (...args: [string, number, number, number, number]) => void;
    const end = parent.data.onTitleDragEnd as (...args: [string, number, number, number, number]) => void;

    act(() => {
      start("custom-parent", 0, 0, 0, 0);
      move("custom-parent", 56, -28, 56, -28);
    });
    expect(queuedFrames).toHaveLength(1);
    act(() => queuedFrames[0](16));
    expect(node(descendant.id).position).toEqual({
      x: memberBefore.x + 56,
      y: memberBefore.y - 28,
    });

    act(() => end("custom-parent", 56, -28, 56, -28));
    expect(callbacks.onPlacementChanges).toHaveBeenCalledWith(expect.arrayContaining([{
      landmarkId: descendant.id,
      x: memberBefore.x + 56,
      y: memberBefore.y - 28,
    }]));
  });

  it("deletes only a custom parent and reparents its child without touching note data", async () => {
    const noteInstance = {
      id: "note-instance",
      title: "Persistent note",
      subjectId: "synthetic-field-05" as const,
      regionId: "linear-models",
      contentPath: "content/Synthetic Field/Persistent note.md",
      x: 4200,
      y: 4200,
      width: 196,
      height: 84,
      color: "#238636",
      shape: "rectangle" as const,
      kind: "concept" as const,
    };
    const hierarchy: MapCustomizations = {
      ...customizations,
      landmarks: { a: { color: "#123456" } },
      customLandmarks: [noteInstance],
      customGroups: [
        {
          id: "custom-parent",
          title: "Parent models",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: 2800,
          y: 2800,
          width: 700,
          height: 448,
          color: "#238636",
          shape: "rectangle",
        },
        {
          id: "empty-child",
          title: "Empty child",
          subjectId: "synthetic-field-05",
          level: "subgroup",
          parentId: "custom-parent",
          x: 2940,
          y: 2912,
          width: 420,
          height: 252,
          color: "#238636",
          shape: "oval",
        },
      ],
      customConnections: [
        {
          id: "parent-edge",
          source: "custom-group:custom-parent",
          target: "a",
        },
        {
          id: "unrelated-edge",
          source: "a",
          target: "b",
        },
      ],
    };
    render(graph({
      customizations: hierarchy,
      landmarks: [...landmarks, { ...landmark("note-instance", "linear-models"), title: noteInstance.title, contentPath: noteInstance.contentPath }],
      groupLandmarks: [...landmarks, { ...landmark("note-instance", "linear-models"), title: noteInstance.title, contentPath: noteInstance.contentPath }],
    }));

    openNodeMenu("custom-group:custom-parent");
    await screen.findByRole("dialog", { name: "Edit Parent models" });
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    const next = latestCustomizations(hierarchy);

    expect(next.customGroups).toEqual([
      expect.objectContaining({
        id: "empty-child",
        level: "subgroup",
        parentId: "subject-zone:synthetic-field-05",
      }),
    ]);
    expect(next.customLandmarks).toEqual([noteInstance]);
    expect(next.landmarks).toEqual(hierarchy.landmarks);
    expect(next.customConnections).toEqual([
      expect.objectContaining({ id: "unrelated-edge", source: "a", target: "b" }),
    ]);
    expect(callbacks.onPlacementChange).not.toHaveBeenCalled();
    expect(callbacks.onPlacementChanges).not.toHaveBeenCalled();
  });

  it("hands a landmark drag to another monitor and lets only its finalizer persist", () => {
    const publishFromLeft = vi.fn<(event: DesktopCanvasDragEvent) => void>();
    const left = render(graph({
      desktopSurfaceId: "monitor-left",
      onDesktopCanvasDrag: publishFromLeft,
    }));
    const original = node("a");
    const originalPosition = { ...original.position };
    act(() => {
      const onNodeDragStart = flowCapture.props?.onNodeDragStart as (
        event: { clientX: number; clientY: number },
        node: CapturedNode,
      ) => void;
      onNodeDragStart({ clientX: 20, clientY: 40 }, original);
    });
    const start = publishFromLeft.mock.calls[0]?.[0];
    if (!start) throw new Error("The source surface did not publish a drag start.");
    expect(start).toMatchObject({
      ownerSurfaceId: "monitor-left",
      nodeId: "a",
      nodeKind: "landmark",
      phase: "start",
      startPointer: { x: 20, y: 40 },
    });
    left.unmount();

    const publishFromRight = vi.fn<(event: DesktopCanvasDragEvent) => void>();
    const right = render(graph({
      desktopSurfaceId: "monitor-right",
      desktopCanvasDrag: start,
      onDesktopCanvasDrag: publishFromRight,
    }));
    const move: DesktopCanvasDragEvent = {
      ...start,
      phase: "move",
      pointer: { x: 300, y: -72 },
    };
    right.rerender(graph({
      desktopSurfaceId: "monitor-right",
      desktopCanvasDrag: move,
      onDesktopCanvasDrag: publishFromRight,
    }));

    expect(node("a").position).toEqual({
      x: original.position.x + 280,
      y: original.position.y - 112,
    });
    act(() => {
      fireEvent.pointerUp(window, {
        button: 0,
        buttons: 0,
        clientX: 328,
        clientY: -44,
      });
    });
    const end = publishFromRight.mock.calls[publishFromRight.mock.calls.length - 1]?.[0];
    if (!end) throw new Error("The receiving surface did not publish a drag end.");
    expect(end).toMatchObject({
      gestureId: start.gestureId,
      ownerSurfaceId: "monitor-left",
      finalizerSurfaceId: "monitor-right",
      phase: "end",
      pointer: { x: 328, y: -44 },
    });
    expect(callbacks.onPlacementChange).toHaveBeenCalledOnce();
    expect(callbacks.onPlacementChange).toHaveBeenCalledWith({
      landmarkId: "a",
      x: Math.round((originalPosition.x + 328 - 20) / 28) * 28,
      y: Math.round((originalPosition.y - 44 - 40) / 28) * 28,
    });
    right.unmount();

    const owner = render(graph({
      desktopSurfaceId: "monitor-left",
      desktopCanvasDrag: end,
      onDesktopCanvasDrag: vi.fn(),
    }));
    expect(callbacks.onPlacementChange).toHaveBeenCalledOnce();

    owner.rerender(graph({
      desktopSurfaceId: "monitor-left",
      desktopCanvasDrag: move,
      onDesktopCanvasDrag: vi.fn(),
    }));
    expect(callbacks.onPlacementChange).toHaveBeenCalledOnce();
  });

  it("previews and commits a whole group from a cross-monitor world-space packet", () => {
    const start: DesktopCanvasDragEvent = {
      gestureId: "monitor-left:group-1",
      ownerSurfaceId: "monitor-left",
      nodeId: "subject-zone:synthetic-field-05",
      nodeKind: "group",
      phase: "start",
      startPointer: { x: -140, y: 80 },
      pointer: { x: -140, y: 80 },
    };
    const { rerender } = render(graph({
      desktopSurfaceId: "monitor-left",
      desktopCanvasDrag: start,
      onDesktopCanvasDrag: vi.fn(),
    }));
    const groupBefore = { ...node(start.nodeId).position };
    const memberBefore = { ...node("a").position };
    const move: DesktopCanvasDragEvent = {
      ...start,
      phase: "move",
      pointer: { x: 420, y: -200 },
    };

    rerender(graph({
      desktopSurfaceId: "monitor-left",
      desktopCanvasDrag: move,
      onDesktopCanvasDrag: vi.fn(),
    }));
    expect(node(start.nodeId).position).toEqual({
      x: groupBefore.x + 560,
      y: groupBefore.y - 280,
    });
    expect(node("a").position).toEqual({
      x: memberBefore.x + 560,
      y: memberBefore.y - 280,
    });

    rerender(graph({
      desktopSurfaceId: "monitor-left",
      desktopCanvasDrag: { ...move, phase: "end" },
      onDesktopCanvasDrag: vi.fn(),
    }));
    expect(callbacks.onPlacementChanges).toHaveBeenCalledOnce();
    expect(callbacks.onPlacementChanges).toHaveBeenCalledWith(expect.arrayContaining([
      { landmarkId: "a", x: memberBefore.x + 560, y: memberBefore.y - 280 },
    ]));
  });

  it("keeps a receiving surface drag-active until a matching remote cancel settles it", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onRemoveCanvasObjects = vi.fn();
    const initialViewport = { x: -336, y: 112, zoom: .7 };
    const deferredViewport = { x: 252, y: -196, zoom: .84 };
    const rendered = render(graph({
      desktopSurfaceId: "monitor-receiver-cancel",
      externalViewport: initialViewport,
      onDesktopCanvasDrag: vi.fn(),
      onRemoveCanvasObjects,
    }));

    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    flowCapture.setViewport.mockClear();
    act(() => {
      const onNodesChange = flowCapture.props?.onNodesChange as (changes: unknown[]) => void;
      onNodesChange([{ id: "a", type: "select", selected: true }]);
    });

    const start: DesktopCanvasDragEvent = {
      gestureId: "monitor-sender:receiver-cancel-regression",
      ownerSurfaceId: "monitor-sender",
      nodeId: "a",
      nodeKind: "landmark",
      phase: "start",
      startPointer: { x: 20, y: 40 },
      pointer: { x: 20, y: 40 },
    };
    rendered.rerender(graph({
      desktopSurfaceId: "monitor-receiver-cancel",
      desktopCanvasDrag: start,
      externalViewport: initialViewport,
      onDesktopCanvasDrag: vi.fn(),
      onRemoveCanvasObjects,
    }));
    await waitFor(() => expect(screen.getByTestId("atlas-graph")).toHaveClass("is-node-dragging"));

    fireEvent.keyDown(window, { key: "Delete" });
    expect(onRemoveCanvasObjects).not.toHaveBeenCalled();

    rendered.rerender(graph({
      desktopSurfaceId: "monitor-receiver-cancel",
      desktopCanvasDrag: start,
      externalViewport: deferredViewport,
      onDesktopCanvasDrag: vi.fn(),
      onRemoveCanvasObjects,
    }));
    expect(flowCapture.setViewport).not.toHaveBeenCalled();

    rendered.rerender(graph({
      desktopSurfaceId: "monitor-receiver-cancel",
      desktopCanvasDrag: { ...start, phase: "cancel" },
      externalViewport: deferredViewport,
      onDesktopCanvasDrag: vi.fn(),
      onRemoveCanvasObjects,
    }));

    await waitFor(() => expect(screen.getByTestId("atlas-graph")).not.toHaveClass("is-node-dragging"));
    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalledTimes(1));
    expect(flowCapture.setViewport).toHaveBeenCalledWith(deferredViewport, { duration: 0 });

    fireEvent.keyDown(window, { key: "Delete" });
    expect(onRemoveCanvasObjects).toHaveBeenCalledOnce();
    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a"],
      customGroupIds: [],
      connectionIds: [],
    });
  });

  it("settles source drag refs from a remote end when native drag-stop never arrives", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const publish = vi.fn<(event: DesktopCanvasDragEvent) => void>();
    const onRemoveCanvasObjects = vi.fn();
    const initialViewport = { x: -280, y: 84, zoom: .76 };
    const deferredViewport = { x: 196, y: -224, zoom: .88 };
    const rendered = render(graph({
      desktopSurfaceId: "monitor-source-end",
      externalViewport: initialViewport,
      onDesktopCanvasDrag: publish,
      onRemoveCanvasObjects,
    }));

    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalled());
    await act(async () => Promise.resolve());
    flowCapture.setViewport.mockClear();

    const original = node("a");
    act(() => {
      const startDrag = flowCapture.props?.onNodeDragStart as (
        event: { clientX: number; clientY: number },
        primary: CapturedNode,
      ) => void;
      startDrag({ clientX: 20, clientY: 40 }, original);
    });
    const start = publish.mock.calls.map(([event]) => event)
      .find(({ phase }) => phase === "start");
    if (!start) throw new Error("Expected a desktop drag start packet.");
    expect(screen.getByTestId("atlas-graph")).toHaveClass("is-node-dragging");

    rendered.rerender(graph({
      desktopSurfaceId: "monitor-source-end",
      externalViewport: deferredViewport,
      onDesktopCanvasDrag: publish,
      onRemoveCanvasObjects,
    }));
    expect(flowCapture.setViewport).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onRemoveCanvasObjects).not.toHaveBeenCalled();

    const end: DesktopCanvasDragEvent = {
      ...start,
      phase: "end",
      finalizerSurfaceId: "monitor-other-finalizer",
      pointer: { x: 132, y: -16 },
    };
    rendered.rerender(graph({
      desktopSurfaceId: "monitor-source-end",
      desktopCanvasDrag: end,
      externalViewport: deferredViewport,
      onDesktopCanvasDrag: publish,
      onRemoveCanvasObjects,
    }));

    await waitFor(() => expect(screen.getByTestId("atlas-graph")).not.toHaveClass("is-node-dragging"));
    await waitFor(() => expect(flowCapture.setViewport).toHaveBeenCalledTimes(1));
    expect(flowCapture.setViewport).toHaveBeenCalledWith(deferredViewport, { duration: 0 });
    expect(callbacks.onPlacementChange).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Delete" });
    expect(onRemoveCanvasObjects).toHaveBeenCalledOnce();
    expect(onRemoveCanvasObjects).toHaveBeenCalledWith({
      landmarkIds: ["a"],
      customGroupIds: [],
      connectionIds: [],
    });
  });

  it("persists only idle keyboard landmark positions as one snapped batch", () => {
    render(graph());
    const handleChanges = flowCapture.props?.onNodesChange as (
      changes: Array<Record<string, unknown>>,
    ) => void;

    act(() => handleChanges([
      { id: "a", type: "position", position: { x: 13, y: 43 }, dragging: false },
      { id: "region-frame:linear-models", type: "position", position: { x: 999, y: 999 }, dragging: false },
      { id: "b", type: "position", position: { x: 281, y: 151 }, dragging: false },
    ]));

    expect(callbacks.onPlacementChanges).toHaveBeenCalledOnce();
    expect(callbacks.onPlacementChanges).toHaveBeenCalledWith([
      { landmarkId: "a", x: 0, y: 56 },
      { landmarkId: "b", x: 280, y: 140 },
    ]);

    callbacks.onPlacementChanges.mockClear();
    const original = node("a");
    act(() => {
      const start = flowCapture.props?.onNodeDragStart as (
        event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
        primary: CapturedNode,
        dragged: CapturedNode[],
      ) => void;
      start({}, original, [original]);
      handleChanges([
        { id: "a", type: "position", position: { x: 112, y: 364 }, dragging: false },
        { id: "b", type: "position", position: { x: 336, y: 196 }, dragging: false },
      ]);
    });

    expect(callbacks.onPlacementChanges).not.toHaveBeenCalled();
    expect(callbacks.onPlacementChange).not.toHaveBeenCalled();
  });

  it("assigns an overlapping landmark to one deterministic direct group owner", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const overlapping: MapCustomizations = {
      ...customizations,
      customGroups: [
        {
          id: "alpha-owner",
          title: "Alpha",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: -56,
          y: 252,
          width: 336,
          height: 224,
          color: "#238636",
          shape: "rectangle",
        },
        {
          id: "zeta-overlap",
          title: "Zeta",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: -56,
          y: 252,
          width: 336,
          height: 224,
          color: "#1976D2",
          shape: "rectangle",
        },
      ],
    };
    render(graph({
      snapshot: {
        ...snapshot,
        subjects: snapshot.subjects.filter(({ id }) => id === "synthetic-field-05"),
      },
      customizations: overlapping,
    }));
    queuedFrames.length = 0;

    const owner = node("custom-group:alpha-owner");
    const sibling = node("custom-group:zeta-overlap");
    expect(owner.data.memberIds).toContain("a");
    expect(sibling.data.memberIds).not.toContain("a");
    const landmarkBefore = { ...node("a").position };
    const start = sibling.data.onTitleDragStart as (
      ...args: [string, number, number, number, number]
    ) => void;
    const move = sibling.data.onTitleDrag as (
      ...args: [string, number, number, number, number]
    ) => void;
    const end = sibling.data.onTitleDragEnd as (
      ...args: [string, number, number, number, number]
    ) => void;

    act(() => {
      start("zeta-overlap", 0, 0, 0, 0);
      move("zeta-overlap", 56, 28, 56, 28);
    });
    expect(queuedFrames).toHaveLength(1);
    act(() => queuedFrames[0](16));
    expect(node("a").position).toEqual(landmarkBefore);

    act(() => end("zeta-overlap", 56, 28, 56, 28));
    const persistedLandmarkIds = callbacks.onPlacementChanges.mock.calls
      .flatMap(([placements]) => placements)
      .map(({ landmarkId }) => landmarkId);
    expect(persistedLandmarkIds).not.toContain("a");
  });

  it("reparents and detaches an authored subgroup from its visible title drop", () => {
    const hierarchy: MapCustomizations = {
      ...customizations,
      customGroups: [
        {
          id: "left-parent",
          title: "Left",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: 2016,
          y: 2016,
          width: 700,
          height: 448,
          color: "#238636",
          shape: "rectangle",
        },
        {
          id: "right-parent",
          title: "Right",
          subjectId: "synthetic-field-05",
          level: "group",
          parentId: "subject-zone:synthetic-field-05",
          x: 3024,
          y: 2016,
          width: 700,
          height: 448,
          color: "#1976D2",
          shape: "rectangle",
        },
        {
          id: "moving-child",
          title: "Moving child",
          subjectId: "synthetic-field-05",
          level: "subgroup",
          parentId: "left-parent",
          x: 2184,
          y: 2156,
          width: 280,
          height: 168,
          color: "#F57C00",
          shape: "rectangle",
        },
      ],
    };
    const firstCall = callbacks.onCustomizationsChange.mock.calls.length;
    const rendered = render(graph({ customizations: hierarchy }));
    const child = node("custom-group:moving-child");
    const start = child.data.onTitleDragStart as (
      ...args: [string, number, number, number, number]
    ) => void;
    const end = child.data.onTitleDragEnd as (
      ...args: [string, number, number, number, number]
    ) => void;

    act(() => {
      start("moving-child", 0, 0, 0, 0);
      end("moving-child", 840, 0, 840, 0);
    });
    const reparented = applyCustomizationUpdates(hierarchy, firstCall);
    expect(reparented.customGroups.find(({ id }) => id === "moving-child")).toMatchObject({
      x: 3024,
      y: 2156,
      parentId: "right-parent",
    });

    rendered.rerender(graph({ customizations: reparented }));
    const detachCall = callbacks.onCustomizationsChange.mock.calls.length;
    const movedChild = node("custom-group:moving-child");
    const detachStart = movedChild.data.onTitleDragStart as (
      ...args: [string, number, number, number, number]
    ) => void;
    const detachEnd = movedChild.data.onTitleDragEnd as (
      ...args: [string, number, number, number, number]
    ) => void;
    act(() => {
      detachStart("moving-child", 0, 0, 0, 0);
      detachEnd("moving-child", 1512, 0, 1512, 0);
    });
    const detached = applyCustomizationUpdates(reparented, detachCall);
    const detachedChild = detached.customGroups.find(({ id }) => id === "moving-child");
    expect(detachedChild).toMatchObject({ x: 4536, y: 2156 });
    expect(detachedChild).not.toHaveProperty("parentId");
  });

  it("keeps a desktop Escape cancelled through trailing packets and native drag callbacks", () => {
    const publish = vi.fn<(event: DesktopCanvasDragEvent) => void>();
    const rendered = render(graph({
      desktopSurfaceId: "monitor-cancel",
      onDesktopCanvasDrag: publish,
    }));
    const original = node("a");
    const moved = {
      ...original,
      position: { x: original.position.x + 112, y: original.position.y - 56 },
    };

    act(() => {
      const start = flowCapture.props?.onNodeDragStart as (
        event: { clientX: number; clientY: number },
        primary: CapturedNode,
      ) => void;
      start({ clientX: 20, clientY: 40 }, original);
    });
    const startPacket = publish.mock.calls.map(([event]) => event)
      .find(({ phase }) => phase === "start");
    if (!startPacket) throw new Error("Expected a desktop drag start packet.");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(publish.mock.calls[publish.mock.calls.length - 1]?.[0].phase).toBe("cancel");
    rendered.rerender(graph({
      desktopSurfaceId: "monitor-cancel",
      onDesktopCanvasDrag: publish,
      desktopCanvasDrag: {
        ...startPacket,
        phase: "move",
        pointer: { x: 720, y: -480 },
      },
    }));

    act(() => {
      const drag = flowCapture.props?.onNodeDrag as (
        event: { clientX: number; clientY: number },
        primary: CapturedNode,
      ) => void;
      const stop = flowCapture.props?.onNodeDragStop as (
        event: { clientX: number; clientY: number },
        primary: CapturedNode,
      ) => void;
      drag({ clientX: 720, clientY: -480 }, moved);
      stop({ clientX: 720, clientY: -480 }, moved);
    });

    expect(node("a").position).toEqual(original.position);
    expect(callbacks.onPlacementChange).not.toHaveBeenCalled();
    expect(callbacks.onPlacementChanges).not.toHaveBeenCalled();
    expect(publish.mock.calls.map(([event]) => event.phase)).not.toContain("end");
  });

  it("does not recommit a retained desktop end packet after remount", () => {
    const start: DesktopCanvasDragEvent = {
      gestureId: "monitor-retained:landmark-remount-regression",
      ownerSurfaceId: "monitor-retained",
      nodeId: "a",
      nodeKind: "landmark",
      phase: "start",
      startPointer: { x: 20, y: 40 },
      pointer: { x: 20, y: 40 },
    };
    const end: DesktopCanvasDragEvent = {
      ...start,
      phase: "end",
      finalizerSurfaceId: "monitor-retained",
      pointer: { x: 132, y: -16 },
    };
    const first = render(graph({
      desktopSurfaceId: "monitor-retained",
      desktopCanvasDrag: start,
      onDesktopCanvasDrag: vi.fn(),
    }));
    first.rerender(graph({
      desktopSurfaceId: "monitor-retained",
      desktopCanvasDrag: end,
      onDesktopCanvasDrag: vi.fn(),
    }));
    expect(callbacks.onPlacementChange).toHaveBeenCalledOnce();
    first.unmount();

    render(graph({
      desktopSurfaceId: "monitor-retained",
      desktopCanvasDrag: end,
      onDesktopCanvasDrag: vi.fn(),
    }));
    expect(callbacks.onPlacementChange).toHaveBeenCalledOnce();
  });
});
