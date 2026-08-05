import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({
  fitView: vi.fn(),
  updateNode: vi.fn(),
  zoom: 1,
  getZoom: () => flow.zoom,
}));

vi.mock("@xyflow/react", () => ({
  Handle: ({ className, id }: { className?: string; id?: string }) => (
    <span className={className} data-testid={`port-${id}`} />
  ),
  ViewportPortal: ({ children }: { children?: ReactNode }) => children,
  Position: {
    Top: "top",
    Right: "right",
    Bottom: "bottom",
    Left: "left",
  },
  useReactFlow: () => flow,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) => selector({ transform: [0, 0, flow.zoom] }),
}));

import {
  RegionFrameNode,
  shapeTitleFramePath,
  type RegionFrameNodeData,
} from "./RegionFrameNode";

const data: RegionFrameNodeData = {
  regionId: "linear-models",
  title: "Linear models",
  memberIds: ["a", "b"],
  variant: "region",
  color: "#336699",
  shape: "rectangle",
  borderStyle: "solid",
  titlePosition: "top-left",
  titleFontSize: 28,
  cancelToken: 0,
  onRequestSelection: vi.fn(),
  onDirectGestureStart: vi.fn(),
  onDirectGestureEnd: vi.fn(),
  onTitleDragStart: vi.fn(),
  onTitleDrag: vi.fn(),
  onTitleDragEnd: vi.fn(),
  onTitleDragCancel: vi.fn(),
  onResizeEnd: vi.fn(),
  onRequestContextMenu: vi.fn(),
};

const nodeProps = {
  id: "region-frame:linear-models",
  data,
  type: "region" as const,
  selected: true,
  dragging: false,
  zIndex: 0,
  selectable: true,
  deletable: false,
  draggable: true,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  width: 420,
  height: 252,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  flow.zoom = 1;
});

describe("RegionFrameNode", () => {
  it("uses the exact visible shape as its generous resize hit target", () => {
    const rendered = render(<RegionFrameNode {...nodeProps} />);
    const group = screen.getByTestId("group-linear-models");
    expect(group).toHaveAttribute("data-group-shape", "rectangle");
    expect(group).toHaveClass("region-frame--rectangle", "region-frame--solid");
    expect(rendered.container.querySelector(".region-frame__surface path")).toHaveAttribute(
      "d",
      expect.stringMatching(/^M.*Z$/),
    );
    const visible = rendered.container.querySelector<SVGPathElement>(".region-frame__shape");
    const hitTarget = rendered.container.querySelector<SVGPathElement>(".region-frame__hit-target");
    expect(hitTarget).not.toBeNull();
    expect(hitTarget).toHaveAttribute("d", visible?.getAttribute("d"));
    expect(hitTarget).toHaveAttribute("fill", "none");
    expect(hitTarget).toHaveAttribute("pointer-events", "stroke");
    expect(hitTarget).toHaveAttribute("stroke-width", "28");
    expect(hitTarget).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(rendered.container.querySelector(".region-frame__subject-texture")).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-resizer")).not.toBeInTheDocument();
    expect(rendered.container.querySelectorAll(".region-port--geometry")).toHaveLength(4);
    expect(rendered.container.querySelectorAll(".region-port--proxy")).toHaveLength(4);
    const portLayer = rendered.container.querySelector<HTMLElement>(".region-port-layer");
    expect(portLayer).toHaveAttribute("data-region-port-layer", "linear-models");
    expect(portLayer).toHaveStyle({
      width: "420px",
      height: "252px",
      transform: "translate(0px, 0px)",
    });
  });

  it("uses one cloudlike rounded contour for display, selection, and interaction", () => {
    const rendered = render(
      <RegionFrameNode {...nodeProps} data={{ ...data, shape: "rounded-rectangle" }} />,
    );
    const visiblePath = rendered.container.querySelector(".region-frame__shape")?.getAttribute("d");

    expect(visiblePath).toContain("A28 28");
    expect(rendered.container.querySelector(".region-frame__selection-ring"))
      .toHaveAttribute("d", visiblePath);
    expect(rendered.container.querySelector(".region-frame__hit-target"))
      .toHaveAttribute("d", visiblePath);
    expect(screen.getByLabelText("Move Linear models group")).toHaveStyle({ maxWidth: "319.2px" });
  });

  it("renders persisted surface opacity and border weight with safe hierarchy defaults", () => {
    const authored = render(
      <RegionFrameNode
        {...nodeProps}
        data={{ ...data, fillOpacity: .18, borderWeight: "strong" }}
      />,
    );
    const authoredGroup = screen.getByTestId("group-linear-models");
    expect(authoredGroup).toHaveAttribute("data-fill-opacity", "0.18");
    expect(authoredGroup).toHaveAttribute("data-border-weight", "strong");
    expect(authoredGroup).toHaveClass("region-frame--weight-strong");
    expect(authoredGroup.style.getPropertyValue("--region-fill-opacity")).toBe("0.18");
    expect(authoredGroup.style.getPropertyValue("--region-stroke-width")).toBe("2.1");
    authored.unmount();

    render(
      <RegionFrameNode
        {...nodeProps}
        data={{ ...data, level: "subgroup", variant: "custom" }}
      />,
    );
    const legacyGroup = screen.getByTestId("group-linear-models");
    expect(legacyGroup).toHaveAttribute("data-fill-opacity", "0.44");
    expect(legacyGroup).toHaveAttribute("data-border-weight", "hairline");
    expect(legacyGroup.style.getPropertyValue("--region-stroke-width")).toBe("0.85");
  });

  it("anchors the canvas-scaled name to the chosen shape instead of its bounding box", () => {
    const rendered = render(
      <RegionFrameNode {...nodeProps} data={{ ...data, shape: "oval" }} />,
    );
    const title = screen.getByLabelText("Move Linear models group");
    const titleSurface = title.parentElement;
    if (!titleSurface) throw new Error("Missing local group title surface");

    const [anchorX, anchorY] = (title.getAttribute("data-title-anchor") ?? "").split(",").map(Number);
    expect(anchorX).toBeCloseTo(.5 - .5 / Math.sqrt(2), 10);
    expect(anchorY).toBeCloseTo(.5 - .5 / Math.sqrt(2), 10);
    expect(Number.parseFloat(titleSurface.style.left)).toBeCloseTo(14.6447, 3);
    expect(Number.parseFloat(titleSurface.style.top)).toBeCloseTo(14.6447, 3);
    expect(titleSurface.style.transform).toBe("translate(0, 0)");
    expect(title).toHaveStyle({ maxWidth: "268.8px" });
    expect(title).toHaveAttribute("data-title-attachment", "contour");
    expect(title).toHaveAttribute("data-title-level", "group");
    expect(title).toHaveAttribute("data-title-treatment", "group");
    expect(title).toHaveAttribute("data-title-shape", "oval");
    expect(Number(title.getAttribute("data-title-contour-angle"))).toBeLessThan(0);
    expect(title).toHaveStyle({ width: "max-content", overflow: "visible" });
    expect(screen.getByText("Linear models")).toHaveClass("region-frame__title-text");
    expect(screen.getByText("Linear models")).toHaveStyle({
      fontSize: "28px",
      overflow: "visible",
      textOverflow: "clip",
      whiteSpace: "normal",
    });
    expect(rendered.container.querySelector(".region-frame__title-mark")).toHaveAttribute("aria-hidden", "true");
    expect(title.style.transform).toBe("");
    expect(rendered.container.querySelector(".region-frame__title-frame-outline"))
      .toHaveAttribute("d", shapeTitleFramePath("oval"));

    rendered.rerender(
      <RegionFrameNode {...nodeProps} data={{ ...data, shape: "rhombus" }} />,
    );
    expect(screen.getByLabelText("Move Linear models group")).toHaveAttribute(
      "data-title-anchor",
      "0.25,0.25",
    );
  });

  it("resizes from the visible perimeter and persists only after a real drag", () => {
    const rendered = render(<RegionFrameNode {...nodeProps} />);
    const surface = rendered.container.querySelector(".region-frame__surface");
    const hitTarget = rendered.container.querySelector<SVGPathElement>(".region-frame__hit-target");
    if (!hitTarget) throw new Error("Missing group perimeter hit target");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 420, height: 252, right: 420, bottom: 252, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 11, clientX: 0, clientY: 126 });
    fireEvent.pointerMove(hitTarget, { pointerId: 11, clientX: -56, clientY: 126 });
    fireEvent.pointerUp(hitTarget, { pointerId: 11, clientX: -56, clientY: 126 });

    expect(flow.updateNode).toHaveBeenCalled();
    expect(data.onResizeEnd).toHaveBeenCalledWith("linear-models", {
      x: -56,
      y: 0,
      width: 476,
      height: 252,
    });
  });

  it("keeps a fractional-zoom resize continuous, anchored to authored bounds, and snaps only on release", () => {
    const onResizeEnd = vi.fn();
    const resizeData: RegionFrameNodeData = {
      ...data,
      frameWidth: 420,
      frameHeight: 252,
      onResizeEnd,
    };
    flow.zoom = .75;
    const rendered = render(
      <RegionFrameNode
        {...nodeProps}
        data={resizeData}
        width={336}
        height={196}
        positionAbsoluteX={112}
        positionAbsoluteY={84}
      />,
    );
    const surface = rendered.container.querySelector(".region-frame__surface");
    const hitTarget = rendered.container.querySelector<SVGPathElement>(".region-frame__hit-target");
    if (!hitTarget) throw new Error("Missing group perimeter hit target");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 420, height: 252, right: 420, bottom: 252, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 43, clientX: 0, clientY: 126 });
    fireEvent.pointerMove(hitTarget, { pointerId: 43, clientX: -3, clientY: 126 });
    const firstLiveUpdate = flow.updateNode.mock.calls[1]?.[1];
    expect(firstLiveUpdate).toEqual(expect.any(Function));
    if (typeof firstLiveUpdate === "function") {
      expect(firstLiveUpdate({ style: {} })).toMatchObject({
        position: { x: 108, y: 84 },
        width: 424,
        height: 252,
        resizing: true,
      });
    }

    // The full client delta remains expressed at the captured .75 zoom even
    // if React Flow reports a different camera before the next sample.
    flow.zoom = 1.5;
    fireEvent.pointerMove(hitTarget, { pointerId: 43, clientX: -17, clientY: 126 });
    const secondLiveUpdate = flow.updateNode.mock.calls[2]?.[1];
    expect(secondLiveUpdate).toEqual(expect.any(Function));
    if (typeof secondLiveUpdate === "function") {
      const live = secondLiveUpdate({ style: {} });
      expect(live.position.x).toBeCloseTo(89.333333, 5);
      expect(live.position.y).toBe(84);
      expect(live.width).toBeCloseTo(442.666667, 5);
      expect(live.height).toBe(252);
      expect(live.resizing).toBe(true);
      // The authored right edge is the invariant, not the stale 336px
      // measurement supplied in NodeProps.
      expect(live.position.x + live.width).toBeCloseTo(532, 8);
    }

    fireEvent.pointerUp(hitTarget, { pointerId: 43, clientX: -17, clientY: 126 });

    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(onResizeEnd).toHaveBeenCalledWith("linear-models", {
      x: 84,
      y: 84,
      width: 448,
      height: 252,
    });
    const committedUpdate = flow.updateNode.mock.calls[3]?.[1];
    expect(committedUpdate).toEqual(expect.any(Function));
    if (typeof committedUpdate === "function") {
      const committed = committedUpdate({ style: { width: 442.666667, height: 252 } });
      expect(committed).toMatchObject({
        position: { x: 84, y: 84 },
        width: 448,
        height: 252,
        resizing: false,
      });
      expect(committed.position.x + committed.width).toBe(532);
    }
  });

  it("focuses a group by double-clicking its visible title", () => {
    render(
      <RegionFrameNode
        {...nodeProps}
        data={{ ...data, title: "Synthetic Field 02", variant: "subject" }}
      />,
    );

    fireEvent.doubleClick(screen.getByLabelText("Move Synthetic Field 02 subject"));
    expect(flow.fitView).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [{ id: nodeProps.id }],
        minZoom: 0.45,
        maxZoom: 0.85,
      }),
    );
  });

  it("gives subject territories their own contour layers and title treatment", () => {
    const rendered = render(
      <RegionFrameNode {...nodeProps} data={{ ...data, title: "Synthetic Field 02", variant: "subject" }} />,
    );

    expect(screen.getByTestId("group-linear-models")).toHaveAttribute("data-region-variant", "subject");
    expect(screen.getByTestId("group-linear-models")).toHaveAttribute("data-fill-opacity", "0");
    expect(rendered.container.querySelector(".region-frame__subject-field")).toBeInTheDocument();
    expect(rendered.container.querySelector(".region-frame__subject-contour")).toBeInTheDocument();
    const visible = rendered.container.querySelector(".region-frame__shape");
    const texture = rendered.container.querySelector<SVGPathElement>(".region-frame__subject-texture");
    const pattern = rendered.container.querySelector<SVGPatternElement>("pattern");
    const textureMark = rendered.container.querySelector(".region-frame__subject-texture-mark");
    expect(texture).toHaveAttribute("d", visible?.getAttribute("d"));
    expect(texture).toHaveAttribute("fill", `url(#${pattern?.id})`);
    expect(texture).toHaveClass("region-frame__subject-texture");
    expect(pattern).toHaveAttribute("patternUnits", "userSpaceOnUse");
    expect(pattern).toHaveAttribute("viewBox", "0 0 44 44");
    expect(Number(pattern?.getAttribute("width"))).toBeCloseTo(44 * 100 / 420, 8);
    expect(Number(pattern?.getAttribute("height"))).toBeCloseTo(44 * 100 / 252, 8);
    expect(textureMark).toHaveClass("region-frame__subject-texture-mark");
    expect(textureMark).not.toHaveAttribute("vector-effect");
    expect(screen.getByLabelText("Move Synthetic Field 02 subject").parentElement).toHaveClass("region-title-toolbar--subject");
    expect(screen.getByLabelText("Move Synthetic Field 02 subject")).toHaveAttribute("data-title-level", "subject");
    expect(rendered.container.querySelector(".region-frame__title-mark")).not.toBeInTheDocument();
  });

  it("uses collision-free texture references for distinct subjects", () => {
    const rendered = render(
      <>
        <RegionFrameNode
          {...nodeProps}
          id="region-frame:synthetic-field-02"
          data={{ ...data, regionId: "subject-zone:synthetic-field-02", title: "Synthetic Field 02", variant: "subject" }}
        />
        <RegionFrameNode
          {...nodeProps}
          id="region-frame:synthetic-field-07"
          data={{ ...data, regionId: "subject-zone:synthetic-field-07", title: "Synthetic Field 07", variant: "subject" }}
        />
      </>,
    );
    const patterns = [...rendered.container.querySelectorAll<SVGPatternElement>("pattern")];

    expect(patterns).toHaveLength(2);
    expect(patterns[0].id).not.toBe(patterns[1].id);
    expect(patterns.every((pattern) => pattern.querySelector(".region-frame__subject-texture-mark")))
      .toBe(true);
  });

  it("renders subgroups as a third, explicitly subordinate canvas level", () => {
    const rendered = render(
      <RegionFrameNode {...nodeProps} data={{ ...data, title: "Linear regression", level: "subgroup", variant: "custom" }} />,
    );

    const subgroup = screen.getByTestId("group-linear-models");
    expect(subgroup).toHaveAttribute("data-group-level", "subgroup");
    expect(subgroup).toHaveClass("region-frame--level-subgroup");
    expect(rendered.container.querySelector(".region-frame__subgroup-field")).toBeInTheDocument();
    expect(rendered.container.querySelector(".region-frame__subject-texture")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Move Linear regression subgroup")).toHaveAttribute("data-title-attachment", "contour");
    expect(screen.getByLabelText("Move Linear regression subgroup")).toHaveAttribute("data-title-level", "subgroup");
    expect(screen.getByLabelText("Move Linear regression subgroup")).toHaveStyle({ maxWidth: "320px" });
  });

  it.each([
    ["subject", "subject"],
    ["group", "region"],
    ["subgroup", "custom"],
  ] as const)("marks the %s nameplate with its distinct framed treatment", (level, variant) => {
    const rendered = render(
      <RegionFrameNode
        {...nodeProps}
        data={{ ...data, level, variant, title: `${level} title` }}
      />,
    );

    const nameplate = screen.getByLabelText(`Move ${level} title ${level}`);
    expect(nameplate).toHaveAttribute("data-title-treatment", level);
    expect(nameplate.parentElement).toHaveClass(`region-title-toolbar--${level}`);
    if (level === "subject") {
      expect(rendered.container.querySelector(".region-frame__title-mark-core")).not.toBeInTheDocument();
    } else {
      expect(rendered.container.querySelector(".region-frame__title-mark-core")).toBeInTheDocument();
    }
    expect(rendered.container.querySelector(".region-frame__title-frame-outline")).toBeInTheDocument();
  });

  it("keeps a long title complete and wraps it instead of ellipsizing it", () => {
    const longTitle = "Foundations of regular conditional synthetic structures";
    render(<RegionFrameNode {...nodeProps} data={{ ...data, title: longTitle }} />);

    const title = screen.getByText(longTitle);
    expect(title).toHaveTextContent(longTitle);
    expect(title).toHaveStyle({
      overflow: "visible",
      textOverflow: "clip",
      whiteSpace: "normal",
    });
  });

  it("inherits canvas zoom without changing its contour attachment geometry", () => {
    flow.zoom = .25;
    const first = render(<RegionFrameNode {...nodeProps} data={{ ...data, shape: "oval" }} />);
    const lowZoomTitle = screen.getByLabelText("Move Linear models group");
    const lowZoomSurface = lowZoomTitle.parentElement;
    if (!lowZoomSurface) throw new Error("Missing local group title surface");
    const lowZoomLeft = Number.parseFloat(lowZoomSurface.style.left);
    expect(lowZoomTitle).toHaveStyle({ maxWidth: "268.8px" });
    expect(lowZoomTitle.style.transform).toBe("");
    expect(screen.getByText("Linear models")).toHaveStyle({ fontSize: "28px" });
    first.unmount();

    flow.zoom = 1.5;
    render(<RegionFrameNode {...nodeProps} data={{ ...data, shape: "oval" }} />);
    const highZoomTitle = screen.getByLabelText("Move Linear models group");
    const highZoomSurface = highZoomTitle.parentElement;
    if (!highZoomSurface) throw new Error("Missing local group title surface");
    expect(highZoomTitle).toHaveStyle({ maxWidth: "268.8px" });
    expect(highZoomTitle.style.transform).toBe("");
    expect(screen.getByText("Linear models")).toHaveStyle({ fontSize: "28px" });
    expect(Number.parseFloat(highZoomSurface.style.left)).toBeCloseTo(lowZoomLeft, 5);
  });

  it("renders an authored group title size in local canvas coordinates", () => {
    flow.zoom = .6;
    render(<RegionFrameNode {...nodeProps} data={{ ...data, titleFontSize: 43 }} />);

    expect(screen.getByText("Linear models")).toHaveStyle({ fontSize: "43px" });
    expect(screen.getByLabelText("Move Linear models group").style.transform).toBe("");
  });

  it("keeps curved and sloping titles horizontal at the exact local anchor", () => {
    flow.zoom = 2 / 3;
    render(
      <RegionFrameNode
        {...nodeProps}
        data={{ ...data, shape: "oval" }}
      />,
    );

    const title = screen.getByLabelText("Move Linear models group");
    expect(Number(title.getAttribute("data-title-contour-angle"))).toBeLessThan(0);
    expect(title.style.transform).toBe("");
    expect(title.parentElement?.style.transform).toBe("translate(0, 0)");
    expect(title).toHaveClass("region-frame__drag-handle");
  });

  it.each([
    ["rectangle", "M1 1H99V39H1Z"],
    ["rounded-rectangle", "M13 1H87Q99 1 99 13V27Q99 39 87 39H13Q1 39 1 27V13Q1 1 13 1Z"],
    ["oval", "M14 1H86C94 1 99 8 99 20S94 39 86 39H14C6 39 1 32 1 20S6 1 14 1Z"],
    ["hexagon", "M8 1H92L99 20L92 39H8L1 20Z"],
    ["octagon", "M6 1H94L99 6V34L94 39H6L1 34V6Z"],
    ["rhombus", "M11 1H89L99 20L89 39H11L1 20Z"],
    ["triangle", "M1 1H89L99 20L89 39H1Z"],
    ["parallelogram", "M11 1H99L89 39H1Z"],
  ] as const)("uses a readable %s-specific title plaque", (shape, path) => {
    const rendered = render(<RegionFrameNode {...nodeProps} data={{ ...data, shape }} />);
    const title = screen.getByLabelText("Move Linear models group");

    expect(title).toHaveAttribute("data-title-shape", shape);
    expect(rendered.container.querySelector(".region-frame__title-frame-outline"))
      .toHaveAttribute("d", path);
    expect(title.style.transform).toBe("");
  });

  it("uses the visible name as a zoom-correct drag handle", () => {
    render(<RegionFrameNode {...nodeProps} />);

    const title = screen.getByText("Linear models");
    const handle = screen.getByLabelText("Move Linear models group");
    expect(handle).toHaveAttribute("data-title-position", "top-left");
    expect(handle).toHaveClass("region-frame__drag-handle");

    fireEvent.pointerDown(title, {
      button: 0,
      pointerId: 7,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 7,
      clientX: 142,
      clientY: 154,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 7,
      clientX: 142,
      clientY: 154,
    });

    expect(data.onTitleDragStart).toHaveBeenCalledWith(
      "linear-models",
      100,
      120,
      142,
      154,
    );
    expect(data.onTitleDrag).toHaveBeenCalledWith(
      "linear-models",
      42,
      34,
      142,
      154,
    );
    expect(data.onTitleDragEnd).toHaveBeenCalledWith(
      "linear-models",
      42,
      34,
      142,
      154,
    );
  });

  it("converts a scaled title drag back into group world coordinates", () => {
    flow.zoom = .5;
    render(<RegionFrameNode {...nodeProps} />);
    const handle = screen.getByLabelText("Move Linear models group");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 19, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(handle, { pointerId: 19, clientX: 128, clientY: 106 });
    fireEvent.pointerUp(handle, { pointerId: 19, clientX: 128, clientY: 106 });

    expect(data.onTitleDrag).toHaveBeenCalledWith("linear-models", 56, -28, 128, 106);
    expect(data.onTitleDragEnd).toHaveBeenCalledWith("linear-models", 56, -28, 128, 106);
  });

  it("cancels a captured title drag without committing its final position", () => {
    const gestureData: RegionFrameNodeData = {
      ...data,
      onDirectGestureStart: vi.fn(),
      onDirectGestureEnd: vi.fn(),
      onTitleDragStart: vi.fn(),
      onTitleDrag: vi.fn(),
      onTitleDragEnd: vi.fn(),
      onTitleDragCancel: vi.fn(),
    };
    render(<RegionFrameNode {...nodeProps} data={gestureData} />);
    const handle = screen.getByLabelText("Move Linear models group");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 23, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(handle, { pointerId: 23, clientX: 156, clientY: 92 });
    fireEvent.pointerCancel(handle, { pointerId: 23, clientX: 156, clientY: 92 });
    fireEvent.pointerUp(handle, { pointerId: 23, clientX: 156, clientY: 92 });

    expect(gestureData.onDirectGestureStart).toHaveBeenCalledOnce();
    expect(gestureData.onTitleDragStart).toHaveBeenCalledOnce();
    expect(gestureData.onTitleDrag).toHaveBeenCalledOnce();
    expect(gestureData.onTitleDragCancel).toHaveBeenCalledWith("linear-models");
    expect(gestureData.onTitleDragEnd).not.toHaveBeenCalled();
    expect(gestureData.onDirectGestureEnd).toHaveBeenCalledOnce();
  });

  it("restores an in-progress border resize when its cancellation token changes", () => {
    const gestureData: RegionFrameNodeData = {
      ...data,
      onDirectGestureStart: vi.fn(),
      onDirectGestureEnd: vi.fn(),
      onResizeEnd: vi.fn(),
    };
    const rendered = render(<RegionFrameNode {...nodeProps} data={gestureData} />);
    const surface = rendered.container.querySelector(".region-frame__surface");
    const hitTarget = rendered.container.querySelector<SVGPathElement>(".region-frame__hit-target");
    if (!hitTarget) throw new Error("Missing group perimeter hit target");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 420, height: 252, right: 420, bottom: 252, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 29, clientX: 420, clientY: 126 });
    fireEvent.pointerMove(hitTarget, { pointerId: 29, clientX: 476, clientY: 126 });
    rendered.rerender(
      <RegionFrameNode
        {...nodeProps}
        data={{ ...gestureData, cancelToken: gestureData.cancelToken + 1 }}
      />,
    );
    fireEvent.pointerUp(hitTarget, { pointerId: 29, clientX: 476, clientY: 126 });

    expect(gestureData.onDirectGestureStart).toHaveBeenCalledOnce();
    expect(gestureData.onDirectGestureEnd).toHaveBeenCalledOnce();
    expect(gestureData.onResizeEnd).not.toHaveBeenCalled();
    const restoreUpdate = flow.updateNode.mock.calls[flow.updateNode.mock.calls.length - 1]?.[1];
    expect(restoreUpdate).toEqual(expect.any(Function));
    if (typeof restoreUpdate === "function") {
      expect(restoreUpdate({ style: { width: 476, height: 252 } })).toMatchObject({
        position: { x: 0, y: 0 },
        width: 420,
        height: 252,
        resizing: false,
      });
    }
  });

  it("routes title right-clicks to the canvas context-menu callback", () => {
    render(<RegionFrameNode {...nodeProps} />);

    fireEvent.contextMenu(screen.getByLabelText("Move Linear models group"), {
      clientX: 320,
      clientY: 240,
    });
    expect(data.onRequestContextMenu).toHaveBeenCalledWith(
      "linear-models",
      320,
      240,
    );
  });

  it("does not leak synthetic post-gesture clicks from its title or border", () => {
    const wrapperClick = vi.fn();
    const rendered = render(
      <div onClick={wrapperClick}>
        <RegionFrameNode {...nodeProps} />
      </div>,
    );

    fireEvent.click(screen.getByLabelText("Move Linear models group"));
    fireEvent.click(rendered.container.querySelector(".region-frame__hit-target")!);

    expect(wrapperClick).not.toHaveBeenCalled();
  });

  it("contains no embedded settings, customizer, or reset controls", () => {
    render(<RegionFrameNode {...nodeProps} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/reset/i)).not.toBeInTheDocument();
  });
});
