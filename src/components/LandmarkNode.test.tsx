import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OBJECT_SHAPE_OPTIONS,
  objectShapeGlyph,
  type ObjectShape,
} from "../domain/mapAppearance";
import type { Landmark, LandmarkKind } from "../domain/types";

const flow = vi.hoisted(() => ({
  updateNode: vi.fn(),
  zoom: 1,
  getZoom: () => flow.zoom,
}));
const landmarkPreviewCapture = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@xyflow/react", () => ({
  Handle: ({ className, id }: { className?: string; id?: string }) => (
    <span className={className} data-testid={`port-${id}`} />
  ),
  Position: {
    Top: "top",
    Right: "right",
    Bottom: "bottom",
    Left: "left",
  },
  useReactFlow: () => flow,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) => selector({ transform: [0, 0, 1] }),
}));

// The preview is a deliberately deferred chunk. Its editor behavior has a
// dedicated test suite; this file verifies LandmarkNode's prop boundary
// without making the whole suite depend on dynamic-import scheduling.
vi.mock("./LandmarkPreviewContent", () => ({
  LandmarkPreviewContent: (props: Record<string, unknown>) => {
    landmarkPreviewCapture.props = props;
    return <div data-testid="landmark-preview-boundary" />;
  },
}));

import { LandmarkNode } from "./LandmarkNode";

const mastery = { state: 0, explain: 0, derive: 0, apply: 0 };

function landmark(kind: LandmarkKind): Landmark {
  return {
    id: "fundamental-result",
    title: "Fundamental statement",
    kind,
    subjectIds: ["synthetic-field-02"],
    regionId: "foundations",
    summary: "",
    markdown: "",
    tags: [],
    status: "draft",
    mastery,
  };
}

function props(
  kind: LandmarkKind,
  selected = false,
  shape: ObjectShape = "rectangle",
  searchEmphasis?: "match" | "muted",
  contentMode: "title" | "formula" | "statement" | "note" = "title",
): ComponentProps<typeof LandmarkNode> {
  return {
    id: "fundamental-result",
    type: "landmark",
    data: {
      landmark: landmark(kind),
      color: "#336699",
      shape,
      contentMode,
      formulaIndex: 0,
      cancelToken: 0,
      onRequestSelection: vi.fn(),
    onDirectGestureStart: vi.fn(),
    onDirectGestureEnd: vi.fn(),
    onMovePointerDown: vi.fn(),
      onResizeEnd: vi.fn(),
      ...(searchEmphasis ? { searchEmphasis } : {}),
    },
    selected,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  flow.zoom = 1;
});

describe("LandmarkNode", () => {
  it("renders only a centered landmark title without a visible type control", () => {
    render(<LandmarkNode {...props("result")} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    const title = screen.getByText("Fundamental statement");
    expect(node).toHaveClass("landmark-node--rectangle");
    expect(node).toHaveAttribute("data-landmark-shape", "rectangle");
    expect(title.parentElement).toHaveClass("landmark-node__content");
    expect(title.parentElement).toHaveTextContent("Fundamental statement");
    expect(title.parentElement?.children).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Theorem")).not.toBeInTheDocument();
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("exposes one connection handle on each side", () => {
    render(<LandmarkNode {...props("concept")} />);

    expect(screen.getAllByTestId(/^port-/)).toHaveLength(4);
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(screen.getByTestId(`port-${side}`)).toHaveClass(
        "atlas-port",
        `atlas-port--${side}`,
      );
    }
  });

  it("gives an informal rectangular Note a dedicated paper styling hook", () => {
    render(<LandmarkNode {...props("concept", false, "rectangle")} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    const shapePath = node.querySelector(".landmark-node__shape")?.getAttribute("d");
    expect(node).toHaveClass("landmark-node--kind-concept", "landmark-node--rectangle", "landmark-node--informal-note");
    expect(shapePath).toBe("M0 0H180L196 16V84H0Z");
    expect(node.querySelector(".landmark-node__paper-fold")).toHaveAttribute("d", "M180 0v16h16Z");
    expect(node.querySelector(".landmark-node__semantic-detail")).toBeInTheDocument();
    expect(node.querySelector(".landmark-node__detail")).toBeInTheDocument();
  });

  it.each(["concept", "problem", "insight", "source"] as const)(
    "treats legacy %s landmarks as informal Notes",
    (kind) => {
      render(<LandmarkNode {...props(kind)} />);
      expect(screen.getByTestId("landmark-fundamental-result")).toHaveClass("landmark-node--informal-note");
    },
  );

  it("keeps custom Note shapes while retaining the paper treatment", () => {
    render(<LandmarkNode {...props("concept", false, "oval")} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    const shapePath = node.querySelector(".landmark-node__shape")?.getAttribute("d");
    expect(node).toHaveClass("landmark-node--informal-note");
    expect(shapePath).toBe(objectShapeGlyph("oval", 196, 84).framePath);
    expect(node.querySelector(".landmark-node__paper-fold")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^port-/)).toHaveLength(4);
  });

  it("preserves the exact selection and resize geometry for paper Notes", () => {
    render(<LandmarkNode {...props("concept", true, "rectangle")} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    const shapePath = node.querySelector(".landmark-node__shape")?.getAttribute("d");
    expect(shapePath).toBe("M0 0H180L196 16V84H0Z");
    expect(node.querySelector(".landmark-node__selection-halo")).toHaveAttribute("d", shapePath);
    expect(node.querySelector(".landmark-node__selection-ring")).toHaveAttribute("d", shapePath);
    expect(node.querySelector(".landmark-node__resize-target")).toHaveAttribute("d", shapePath);
  });

  it("does not apply paper decoration to formal mathematical landmarks", () => {
    render(<LandmarkNode {...props("definition", false, "rectangle")} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    expect(node).not.toHaveClass("landmark-node--informal-note");
    expect(node.querySelector(".landmark-node__shape")).toHaveAttribute(
      "d",
      objectShapeGlyph("rectangle", 196, 84).framePath,
    );
    expect(node.querySelector(".landmark-node__semantic-detail")).toBeInTheDocument();
  });

  it("renders an informal Note as body-only paper without a hidden filename title", () => {
    render(<LandmarkNode {...props("concept", false, "rectangle", undefined, "note")} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    expect(node).toHaveClass("landmark-node--informal-note");
    expect(node).toHaveAttribute("data-content-mode", "note");
    expect(node).not.toHaveAttribute("title");
    expect(node).toHaveAttribute("aria-label", "Note");
    expect(node.querySelector(".landmark-node__resize-target")).toHaveAttribute("aria-label", "Resize note");
    expect(node.querySelector(".landmark-node__document-title")).not.toBeInTheDocument();
    expect(node.querySelector(".landmark-node__content")).not.toBeInTheDocument();
  });

  it("wires a newly created paper Note straight into its inline body editor", async () => {
    const onBeginNoteEdit = vi.fn();
    const onSaveNote = vi.fn(async () => undefined);
    const noteProps = props("concept", true, "rectangle", undefined, "note");
    noteProps.data = {
      ...noteProps.data,
      previewMarkdown: "",
      autoEditNote: true,
      onBeginNoteEdit,
      onSaveNote,
    };
    render(<LandmarkNode {...noteProps} />);

    await screen.findByTestId("landmark-preview-boundary");
    expect(landmarkPreviewCapture.props).toMatchObject({
      landmark: noteProps.data.landmark,
      mode: "note",
      previewMarkdown: "",
      autoEdit: true,
      onBeginNoteEdit,
      onSaveNote,
    });
  });

  it("does not forward paper editing behavior to a formal landmark", async () => {
    const onBeginNoteEdit = vi.fn();
    const onSaveNote = vi.fn(async () => undefined);
    const theoremProps = props("theorem", false, "rectangle", undefined, "note");
    theoremProps.data = {
      ...theoremProps.data,
      previewMarkdown: "> [!theorem]\n> A formal result.",
      autoEditNote: true,
      onBeginNoteEdit,
      onSaveNote,
    };
    render(<LandmarkNode {...theoremProps} />);

    await screen.findByTestId("landmark-preview-boundary");
    expect(landmarkPreviewCapture.props).toMatchObject({
      landmark: theoremProps.data.landmark,
      mode: "note",
      previewMarkdown: "> [!theorem]\n> A formal result.",
    });
    expect(landmarkPreviewCapture.props?.autoEdit).toBe(false);
    expect(landmarkPreviewCapture.props?.onBeginNoteEdit).toBeUndefined();
    expect(landmarkPreviewCapture.props?.onSaveNote).toBeUndefined();
    expect(onBeginNoteEdit).not.toHaveBeenCalled();
    expect(onSaveNote).not.toHaveBeenCalled();
  });

  it("uses the complete clean shape vocabulary shared by map objects", () => {
    const rendered = render(<LandmarkNode {...props("concept")} />);
    const paths = new Set<string>();

    for (const { id } of OBJECT_SHAPE_OPTIONS) {
      rendered.rerender(<LandmarkNode {...props("concept", false, id)} />);
      const node = screen.getByTestId("landmark-fundamental-result");
      expect(node).toHaveAttribute("data-landmark-shape", id);
      expect(node).toHaveClass(`landmark-node--${id}`);
      const path = rendered.container.querySelector(
        ".landmark-node__frame path",
      );
      paths.add(path?.getAttribute("d") ?? "");
    }

    expect(paths.size).toBe(OBJECT_SHAPE_OPTIONS.length);
    expect(paths).not.toContain("");
  });

  it("reflects selection without exposing editing controls", () => {
    render(<LandmarkNode {...props("theorem", true, "hexagon")} />);

    expect(screen.getByTestId("landmark-fundamental-result")).toHaveClass(
      "is-selected",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("cancels a direct resize cleanly instead of persisting its last preview", () => {
    const resizeProps = props("theorem", true, "hexagon");
    const onDirectGestureStart = vi.fn();
    const onDirectGestureEnd = vi.fn();
    const onResizeEnd = vi.fn();
    resizeProps.data = {
      ...resizeProps.data,
      onDirectGestureStart,
      onDirectGestureEnd,
      onResizeEnd,
    };
    const rendered = render(<LandmarkNode {...resizeProps} />);
    const surface = rendered.container.querySelector(".landmark-node__frame");
    const hitTarget = rendered.container.querySelector<SVGPathElement>(".landmark-node__resize-target");
    if (!hitTarget) throw new Error("Missing landmark perimeter hit target");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 196, height: 84, right: 196, bottom: 84, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 31, clientX: 196, clientY: 42 });
    fireEvent.pointerMove(hitTarget, { pointerId: 31, clientX: 252, clientY: 42 });
    fireEvent.pointerCancel(hitTarget, { pointerId: 31, clientX: 252, clientY: 42 });
    fireEvent.pointerUp(hitTarget, { pointerId: 31, clientX: 252, clientY: 42 });

    expect(onDirectGestureStart).toHaveBeenCalledOnce();
    expect(onDirectGestureEnd).toHaveBeenCalledOnce();
    expect(onResizeEnd).not.toHaveBeenCalled();
    const restoreUpdate = flow.updateNode.mock.calls[flow.updateNode.mock.calls.length - 1]?.[1];
    expect(restoreUpdate).toEqual(expect.any(Function));
    if (typeof restoreUpdate === "function") {
      expect(restoreUpdate({ style: { width: 252, height: 84 } })).toMatchObject({
        position: { x: 0, y: 0 },
        width: 196,
        height: 84,
        resizing: false,
      });
    }
  });

  it("follows fractional-zoom pointer samples continuously and commits the authored frame on-grid", () => {
    const resizeProps = props("theorem", true, "rectangle");
    const onResizeEnd = vi.fn();
    resizeProps.width = 140;
    resizeProps.height = 70;
    resizeProps.positionAbsoluteX = 112;
    resizeProps.positionAbsoluteY = 84;
    resizeProps.data = {
      ...resizeProps.data,
      // These are the visible/authored dimensions. The NodeProps values above
      // deliberately model React Flow's previous ResizeObserver measurement.
      frameWidth: 196,
      frameHeight: 84,
      onResizeEnd,
    };
    flow.zoom = .5;

    const rendered = render(<LandmarkNode {...resizeProps} />);
    const surface = rendered.container.querySelector(".landmark-node__frame");
    const hitTarget = rendered.container.querySelector<SVGPathElement>(".landmark-node__resize-target");
    if (!hitTarget) throw new Error("Missing landmark perimeter hit target");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 196, height: 84, right: 196, bottom: 84, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 41, clientX: 196, clientY: 42 });
    fireEvent.pointerMove(hitTarget, { pointerId: 41, clientX: 199, clientY: 42 });

    const firstLiveUpdate = flow.updateNode.mock.calls[1]?.[1];
    expect(firstLiveUpdate).toEqual(expect.any(Function));
    if (typeof firstLiveUpdate === "function") {
      expect(firstLiveUpdate({ style: {} })).toMatchObject({
        position: { x: 112, y: 84 },
        width: 202,
        height: 84,
        resizing: true,
      });
    }

    // A camera change must not reinterpret the nine client pixels accumulated
    // since pointer-down; the gesture owns the .5 starting zoom.
    flow.zoom = 1.5;
    fireEvent.pointerMove(hitTarget, { pointerId: 41, clientX: 205, clientY: 42 });
    const secondLiveUpdate = flow.updateNode.mock.calls[2]?.[1];
    expect(secondLiveUpdate).toEqual(expect.any(Function));
    if (typeof secondLiveUpdate === "function") {
      expect(secondLiveUpdate({ style: {} })).toMatchObject({
        position: { x: 112, y: 84 },
        width: 214,
        height: 84,
        resizing: true,
      });
    }

    fireEvent.pointerUp(hitTarget, { pointerId: 41, clientX: 205, clientY: 42 });

    // Only release is quantized. The moving right edge reaches x=336 while
    // the opposite x=112 edge remains fixed exactly.
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(onResizeEnd).toHaveBeenCalledWith("fundamental-result", {
      x: 112,
      y: 84,
      width: 224,
      height: 84,
    });
    const committedUpdate = flow.updateNode.mock.calls[3]?.[1];
    expect(committedUpdate).toEqual(expect.any(Function));
    if (typeof committedUpdate === "function") {
      const committed = committedUpdate({ style: { width: 214, height: 84 } });
      expect(committed).toMatchObject({
        position: { x: 112, y: 84 },
        width: 224,
        height: 84,
        resizing: false,
      });
      expect(committed.position.x + committed.width).toBe(336);
    }
  });

  it("encodes mathematical role through restrained contour details, never a tag", () => {
    const rendered = render(<LandmarkNode {...props("definition")} />);
    const node = screen.getByTestId("landmark-fundamental-result");
    const definitionPath = node.querySelector(".landmark-node__semantic-detail")?.getAttribute("d");
    expect(node).toHaveClass("landmark-node--kind-definition");
    expect(node).toHaveAttribute("data-math-kind", "definition");

    rendered.rerender(<LandmarkNode {...props("theorem")} />);
    const theoremPath = node.querySelector(".landmark-node__semantic-detail")?.getAttribute("d");
    expect(node).toHaveClass("landmark-node--kind-theorem");
    expect(theoremPath).not.toBe(definitionPath);
    expect(screen.queryByText("Definition")).not.toBeInTheDocument();
    expect(screen.queryByText("Theorem")).not.toBeInTheDocument();
  });

  it("normalizes legacy result landmarks to the theorem visual grammar", () => {
    render(<LandmarkNode {...props("result")} />);
    expect(screen.getByTestId("landmark-fundamental-result")).toHaveClass(
      "landmark-node--kind-theorem",
    );
  });

  it("switches to a framed compiled-document composition without showing a type tag", () => {
    const formulaProps = props("theorem", false, "hexagon", undefined, "formula");
    render(<LandmarkNode {...formulaProps} data={{ ...formulaProps.data, formulaIndex: 2 }} />);

    const node = screen.getByTestId("landmark-fundamental-result");
    expect(node).toHaveAttribute("data-content-mode", "formula");
    expect(node.querySelector(".landmark-node__document-title")).toHaveTextContent("Fundamental statement");
    expect(node.querySelector(".landmark-node__content")).not.toBeInTheDocument();
    expect(screen.queryByText("Theorem")).not.toBeInTheDocument();
    expect(landmarkPreviewCapture.props).toMatchObject({
      mode: "formula",
      formulaIndex: 2,
    });
  });

  it.each(OBJECT_SHAPE_OPTIONS)(
    "keeps every %s rich-content ornament on the visible frame",
    ({ id: shape }) => {
      const rendered = render(
        <LandmarkNode {...props("definition", false, shape, undefined, "formula")} />,
      );

      for (const mode of ["formula", "statement", "note"] as const) {
        rendered.rerender(
          <LandmarkNode {...props("definition", false, shape, undefined, mode)} />,
        );
        const node = screen.getByTestId("landmark-fundamental-result");
        const visibleFrame = node.querySelector(".landmark-node__shape")?.getAttribute("d");
        const documentBorders = [
          ...node.querySelectorAll<SVGPathElement>(".landmark-node__document-border"),
        ];

        expect(visibleFrame).toBeTruthy();
        expect(documentBorders).toHaveLength(3);
        documentBorders.forEach((border) => {
          expect(border).toHaveAttribute("d", visibleFrame);
          expect(border).toHaveAttribute("vector-effect", "non-scaling-stroke");
        });
        expect(node.querySelector(".landmark-node__detail")).not.toBeInTheDocument();
      }
    },
  );

  it("applies search emphasis only when the graph provides an active state", () => {
    const rendered = render(<LandmarkNode {...props("concept")} />);
    const node = screen.getByTestId("landmark-fundamental-result");
    expect(node).not.toHaveClass("is-search-match", "is-search-muted");

    rendered.rerender(<LandmarkNode {...props("concept", false, "rectangle", "muted")} />);
    expect(node).toHaveClass("is-search-muted");
    expect(node).not.toHaveClass("is-search-match");

    rendered.rerender(<LandmarkNode {...props("concept", false, "rectangle", "match")} />);
    expect(node).toHaveClass("is-search-match");
    expect(node).not.toHaveClass("is-search-muted");
  });
});
