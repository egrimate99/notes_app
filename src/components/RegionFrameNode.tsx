import {
  memo,
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BrainCircuit,
  ChartCandlestick,
  ChartScatter,
  ChartSpline,
  ChessKnight,
  Dices,
  VectorSquare,
  type LucideIcon,
} from "lucide-react";
import {
  Handle,
  Position,
  ViewportPortal,
  type Node,
  type NodeProps,
  type ResizeParams,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import {
  objectShapeGlyph,
  objectShapeTitleGeometry,
  type GroupShape,
} from "../domain/mapAppearance";
import {
  DEFAULT_SUBJECT_FRAME_STYLE,
  isSubjectFrameStyle,
  type SubjectFrameStyle,
} from "../domain/subjectFrameStyle";
import type {
  GroupBorderStyle,
  GroupBorderWeight,
  GroupLevel,
  GroupTitlePosition,
} from "../state/mapCustomizationStore";
import {
  clampGroupFillOpacity,
  defaultGroupBorderWeight,
  defaultGroupFillOpacity,
  resolveGroupShape,
} from "../state/mapCustomizationStore";
import { framePortStyle } from "./framePortStyle";
import {
  frameResizeCursor,
  frameResizeDirection,
  pointWithinFrame,
  resizedFrameDimensions,
  snappedFrameDimensions,
  type FrameResizeGesture,
} from "./frameResize";

export interface RegionFrameNodeData extends Record<string, unknown> {
  regionId: string;
  title: string;
  memberIds: string[];
  /** Visual/spatial hierarchy; independent from the backing note tree. */
  level?: GroupLevel;
  variant: "region" | "subject" | "custom";
  color: string;
  shape: GroupShape;
  /** Authored frame size; React Flow's measured NodeProps can lag a resize. */
  frameWidth?: number;
  frameHeight?: number;
  borderStyle: GroupBorderStyle;
  borderWeight?: GroupBorderWeight;
  fillOpacity?: number;
  titlePosition: GroupTitlePosition;
  titleFontSize: number;
  subjectFrameStyle?: SubjectFrameStyle;
  /** Monotonic signal used to release any pointer capture after Escape. */
  cancelToken: number;
  onRequestSelection: (
    nodeId: string,
    mode: "replace" | "add" | "remove",
  ) => void;
  onTitleDragStart: (
    regionId: string,
    startClientX: number,
    startClientY: number,
    clientX: number,
    clientY: number,
    shiftKey?: boolean,
    altKey?: boolean,
  ) => void;
  onTitleDrag: (
    regionId: string,
    deltaX: number,
    deltaY: number,
    clientX: number,
    clientY: number,
    shiftKey?: boolean,
    altKey?: boolean,
  ) => void;
  onTitleDragEnd: (
    regionId: string,
    deltaX: number,
    deltaY: number,
    clientX: number,
    clientY: number,
    shiftKey?: boolean,
    altKey?: boolean,
  ) => void;
  onTitleDragCancel: (regionId: string) => void;
  onDirectGestureStart: (nodeId: string) => void;
  onDirectGestureEnd: (nodeId: string) => void;
  onResizeEnd: (regionId: string, dimensions: ResizeParams) => void;
  onRequestContextMenu: (regionId: string, x: number, y: number) => void;
}

export type RegionGraphNode = Node<RegionFrameNodeData, "region">;

interface BorderResizeGesture extends FrameResizeGesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  start: ResizeParams;
  latest: ResizeParams;
  zoom: number;
  moved: boolean;
  removeFromSelectionOnClick: boolean;
  element: SVGPathElement;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

const GROUP_MIN_WIDTH = 252;
const GROUP_MIN_HEIGHT = 168;
const BORDER_SCREEN_HIT_WIDTH = 28;
const BORDER_OVERVIEW_SCREEN_HIT_WIDTH = 24;
const BORDER_OVERVIEW_ZOOM = .4;
const RESIZE_DRAG_THRESHOLD = 2;
const GRID = 28;

const groupBorderStrokeWidth: Record<GroupBorderWeight, number> = {
  hairline: .85,
  regular: 1.35,
  strong: 2.1,
};

const titleAttachmentTransform: Record<GroupTitlePosition, string> = {
  "top-left": "translate(0, 0)",
  "top-center": "translate(-50%, 0)",
  "top-right": "translate(-100%, 0)",
  "middle-right": "translate(-100%, -50%)",
  "bottom-right": "translate(-100%, -100%)",
  "bottom-center": "translate(-50%, -100%)",
  "bottom-left": "translate(0, -100%)",
  "middle-left": "translate(0, -50%)",
};

const subjectTitleAttachmentTransform: Record<GroupTitlePosition, string> = {
  "top-left": "translate(0, -50%)",
  "top-center": "translate(-50%, -50%)",
  "top-right": "translate(-100%, -50%)",
  "middle-right": "translate(-50%, -50%)",
  "bottom-right": "translate(-100%, -50%)",
  "bottom-center": "translate(-50%, -50%)",
  "bottom-left": "translate(0, -50%)",
  "middle-left": "translate(-50%, -50%)",
};

const subjectIconByFrameStyle: Record<SubjectFrameStyle, LucideIcon> = {
  "double-rule": ChartSpline,
  "triple-rule": ChartCandlestick,
  "cardinal-ticks": ChessKnight,
  "corner-brackets": VectorSquare,
  "dashed-inset": BrainCircuit,
  beaded: Dices,
  "offset-rails": ChartScatter,
};

const titleMaxWidth: Record<GroupLevel, number> = {
  subject: 620,
  group: 400,
  subgroup: 320,
};

const titleWidthRatio: Record<GroupShape, number> = {
  rectangle: .82,
  "rounded-rectangle": .76,
  oval: .64,
  hexagon: .72,
  octagon: .74,
  rhombus: .62,
  triangle: .58,
  parallelogram: .7,
};

/**
 * Title plaques echo the territory silhouette without sacrificing a useful
 * text box. In particular, triangles remain a readable pointed tab and
 * rhombi become a shallow lozenge instead of forcing text into a diamond.
 */
export function shapeTitleFramePath(shape: GroupShape) {
  switch (shape) {
    case "rectangle":
      return "M1 1H99V39H1Z";
    case "rounded-rectangle":
      return "M13 1H87Q99 1 99 13V27Q99 39 87 39H13Q1 39 1 27V13Q1 1 13 1Z";
    case "oval":
      return "M14 1H86C94 1 99 8 99 20S94 39 86 39H14C6 39 1 32 1 20S6 1 14 1Z";
    case "hexagon":
      return "M8 1H92L99 20L92 39H8L1 20Z";
    case "octagon":
      return "M6 1H94L99 6V34L94 39H6L1 34V6Z";
    case "rhombus":
      return "M11 1H89L99 20L89 39H11L1 20Z";
    case "triangle":
      return "M1 1H89L99 20L89 39H1Z";
    case "parallelogram":
      return "M11 1H99L89 39H1Z";
  }
}

const ports = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

const titleGeometryCache = new Map<
  GroupShape,
  ReturnType<typeof objectShapeTitleGeometry>
>();
const regionGlyphCache = new Map<GroupShape, ReturnType<typeof objectShapeGlyph>>();

export function shapeTitleGeometry(shape: GroupShape) {
  const cached = titleGeometryCache.get(shape);
  if (cached) return cached;
  const geometry = objectShapeTitleGeometry(shape);
  titleGeometryCache.set(shape, geometry);
  return geometry;
}

function regionShapeGlyph(shape: GroupShape) {
  const cached = regionGlyphCache.get(shape);
  if (cached) return cached;
  const glyph = objectShapeGlyph(shape, 100, 100);
  regionGlyphCache.set(shape, glyph);
  return glyph;
}

export function shapeTitleAnchors(shape: GroupShape): Record<GroupTitlePosition, NormalizedPoint> {
  return shapeTitleGeometry(shape);
}

export function shapeTitleAngle(
  shape: GroupShape,
  position: GroupTitlePosition,
  width: number,
  height: number,
) {
  const { dx, dy } = shapeTitleGeometry(shape)[position];
  let angle = Math.atan2(dy * height, dx * width) * 180 / Math.PI;
  while (angle > 90) angle -= 180;
  while (angle <= -90) angle += 180;
  return Math.round(angle * 100) / 100;
}

/**
 * The visible perimeter owns resizing. A cardinal point changes one dimension;
 * a sloping part of a shape changes both dimensions, matching its visual normal.
 */
export const regionResizeDirection = frameResizeDirection;

export const RegionFrameNode = memo(function RegionFrameNode({
  id,
  data,
  selected,
  width = GROUP_MIN_WIDTH,
  height = GROUP_MIN_HEIGHT,
  positionAbsoluteX,
  positionAbsoluteY,
  isConnectable,
}: NodeProps<RegionGraphNode>) {
  const titleDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    started: boolean;
    removeFromSelectionOnClick: boolean;
    element: HTMLElement;
  } | undefined>(undefined);
  const resizeRef = useRef<BorderResizeGesture | undefined>(undefined);
  const cancelTokenRef = useRef(data.cancelToken);
  const { fitView, getZoom, updateNode } = useReactFlow<RegionGraphNode>();
  const viewportZoom = useStore((state) => state.transform[2]);
  // While resizing, title geometry and proxy ports follow the same live frame
  // as the visible contour. At rest the authored dimensions avoid React
  // Flow's occasionally stale ResizeObserver measurement.
  const liveResize = resizeRef.current?.latest;
  const frameWidth = liveResize?.width ?? data.frameWidth ?? width;
  const frameHeight = liveResize?.height ?? data.frameHeight ?? height;
  const frameX = liveResize?.x ?? positionAbsoluteX;
  const frameY = liveResize?.y ?? positionAbsoluteY;
  const level: GroupLevel = data.level ?? (data.variant === "subject" ? "subject" : "group");
  const shape = resolveGroupShape(level, data.shape);
  // Stable style identities now select the subject title icon only.
  const subjectFrameStyle = isSubjectFrameStyle(data.subjectFrameStyle)
    ? data.subjectFrameStyle
    : DEFAULT_SUBJECT_FRAME_STYLE;
  const SubjectIcon = subjectIconByFrameStyle[subjectFrameStyle];
  const borderWeight = data.borderWeight ?? defaultGroupBorderWeight(level);
  const fillOpacity = clampGroupFillOpacity(data.fillOpacity ?? defaultGroupFillOpacity(level));
  const titleAnchor = shapeTitleAnchors(shape)[data.titlePosition];
  const titleAngle = shapeTitleAngle(shape, data.titlePosition, frameWidth, frameHeight);
  const glyph = regionShapeGlyph(shape);
  const titleFramePath = shapeTitleFramePath(shape);
  // XYFlow zooms the node layer with an outer CSS transform. SVG's
  // non-scaling-stroke protects the path from its viewBox transform, but not
  // from that outer transform, so a fixed SVG stroke becomes progressively
  // harder to acquire as the canvas zooms out. Compensate in local units to
  // keep the invisible contour a stable screen-space target. The slightly
  // tighter overview width avoids one tiny group swallowing a neighbour.
  const normalizedViewportZoom = Number.isFinite(viewportZoom) && viewportZoom > 0
    ? Math.max(viewportZoom, .01)
    : 1;
  const borderScreenHitWidth = normalizedViewportZoom <= BORDER_OVERVIEW_ZOOM
    ? BORDER_OVERVIEW_SCREEN_HIT_WIDTH
    : BORDER_SCREEN_HIT_WIDTH;
  const borderHitWidth = borderScreenHitWidth / normalizedViewportZoom;
  const style = {
    "--group-color": data.color,
    "--region-fill-opacity": fillOpacity,
    "--region-stroke-width": groupBorderStrokeWidth[borderWeight],
  } as CSSProperties;

  const titleWrapperStyle = {
    ...style,
    position: "absolute",
    left: `${titleAnchor.x * 100}%`,
    top: `${titleAnchor.y * 100}%`,
    transform: level === "subject"
      ? subjectTitleAttachmentTransform[data.titlePosition]
      : titleAttachmentTransform[data.titlePosition],
    zIndex: 1,
  } as CSSProperties;
  const titleBarStyle = {
    boxSizing: "border-box",
    width: "max-content",
    // A nameplate belongs to its territory: large groups can carry a calm,
    // wider title while compact groups wrap before the label overwhelms them.
    maxWidth: Math.min(
      titleMaxWidth[level],
      Math.max(156, frameWidth * titleWidthRatio[shape]),
    ),
    overflow: "visible",
  } as CSSProperties;

  const titleDelta = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = titleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return undefined;
    const currentZoom = getZoom();
    const scale = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1;
    return {
      x: (event.clientX - drag.startClientX) / scale,
      y: (event.clientY - drag.startClientY) / scale,
    };
  };

  const startTitleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const removeFromSelectionOnClick = additive && selected;
    // Pressing an object that already belongs to a selection begins a batch
    // drag without collapsing its peers. Modifier-click still toggles only on
    // release so a modifier-drag can use the complete selection.
    if (!selected) {
      data.onRequestSelection(id, additive ? "add" : "replace");
    }
    data.onDirectGestureStart(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    titleDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      started: false,
      removeFromSelectionOnClick,
      element: event.currentTarget,
    };
  };

  const moveTitleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = titleDragRef.current;
    const delta = titleDelta(event);
    if (!drag || !delta) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 3) return;
      drag.started = true;
      data.onTitleDragStart(
        data.regionId,
        drag.startClientX,
        drag.startClientY,
        event.clientX,
        event.clientY,
        event.shiftKey,
        event.altKey,
      );
    }
    event.preventDefault();
    event.stopPropagation();
    data.onTitleDrag(
      data.regionId,
      delta.x,
      delta.y,
      event.clientX,
      event.clientY,
      event.shiftKey,
      event.altKey,
    );
  };

  const finishTitleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = titleDragRef.current;
    const delta = titleDelta(event);
    if (!drag || !delta) return;
    event.preventDefault();
    event.stopPropagation();
    titleDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (drag.started) {
      data.onTitleDragEnd(
        data.regionId,
        delta.x,
        delta.y,
        event.clientX,
        event.clientY,
        event.shiftKey,
        event.altKey,
      );
    } else if (drag.removeFromSelectionOnClick) {
      data.onRequestSelection(id, "remove");
    }
    data.onDirectGestureEnd(id);
  };

  const cancelTitleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = titleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    titleDragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (drag.started) data.onTitleDragCancel(data.regionId);
    data.onDirectGestureEnd(id);
  };

  const startBorderResize = (event: ReactPointerEvent<SVGPathElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const removeFromSelectionOnClick = additive && selected;
    if (!selected) {
      data.onRequestSelection(id, additive ? "add" : "replace");
    }
    const point = pointWithinFrame(event);
    const direction = regionResizeDirection(point.x, point.y);
    const dimensions = {
      x: positionAbsoluteX,
      y: positionAbsoluteY,
      width: data.frameWidth ?? width,
      height: data.frameHeight ?? height,
    };
    resizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: dimensions,
      latest: dimensions,
      zoom: getZoom(),
      direction,
      moved: false,
      removeFromSelectionOnClick,
      element: event.currentTarget,
    };
    data.onDirectGestureStart(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.style.cursor = frameResizeCursor(direction);
    updateNode(id, { selected: true, resizing: true });
  };

  const moveBorderResize = (event: ReactPointerEvent<SVGPathElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      const point = pointWithinFrame(event);
      event.currentTarget.style.cursor = frameResizeCursor(regionResizeDirection(point.x, point.y));
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY) < RESIZE_DRAG_THRESHOLD) return;
    gesture.moved = true;
    // Keep the contour attached to the pointer. Snapping every sample caused
    // a full-cell jump after each half-cell of apparently frozen movement.
    const dimensions = resizedFrameDimensions(
      gesture,
      event.clientX,
      event.clientY,
      gesture.zoom,
      GROUP_MIN_WIDTH,
      GROUP_MIN_HEIGHT,
    );
    gesture.latest = dimensions;
    updateNode(id, (node) => ({
      position: { x: dimensions.x, y: dimensions.y },
      width: dimensions.width,
      height: dimensions.height,
      resizing: true,
      style: { ...node.style, width: dimensions.width, height: dimensions.height },
    }));
  };

  const finishBorderResize = (event: ReactPointerEvent<SVGPathElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (gesture.moved) {
      const dimensions = snappedFrameDimensions(
        gesture.latest,
        gesture.start,
        gesture.direction,
        GRID,
        GROUP_MIN_WIDTH,
        GROUP_MIN_HEIGHT,
      );
      updateNode(id, (node) => ({
        position: { x: dimensions.x, y: dimensions.y },
        width: dimensions.width,
        height: dimensions.height,
        resizing: false,
        style: { ...node.style, width: undefined, height: undefined },
      }));
      data.onResizeEnd(data.regionId, dimensions);
    } else {
      updateNode(id, (node) => ({
        resizing: false,
        style: { ...node.style, width: undefined, height: undefined },
      }));
    }
    data.onDirectGestureEnd(id);
    if (!gesture.moved && gesture.removeFromSelectionOnClick) {
      data.onRequestSelection(id, "remove");
    }
  };

  const cancelBorderResize = (event: ReactPointerEvent<SVGPathElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    updateNode(id, (node) => ({
      position: { x: gesture.start.x, y: gesture.start.y },
      width: gesture.start.width,
      height: gesture.start.height,
      resizing: false,
      style: { ...node.style, width: undefined, height: undefined },
    }));
    data.onDirectGestureEnd(id);
  };

  useEffect(() => {
    if (cancelTokenRef.current === data.cancelToken) return;
    cancelTokenRef.current = data.cancelToken;

    const titleDrag = titleDragRef.current;
    titleDragRef.current = undefined;
    if (titleDrag) {
      if (titleDrag.element.hasPointerCapture?.(titleDrag.pointerId)) {
        titleDrag.element.releasePointerCapture?.(titleDrag.pointerId);
      }
      if (titleDrag.started) data.onTitleDragCancel(data.regionId);
      data.onDirectGestureEnd(id);
    }

    const resize = resizeRef.current;
    resizeRef.current = undefined;
    if (!resize) return;
    if (resize.element.hasPointerCapture?.(resize.pointerId)) {
      resize.element.releasePointerCapture?.(resize.pointerId);
    }
    updateNode(id, (node) => ({
      position: { x: resize.start.x, y: resize.start.y },
      width: resize.start.width,
      height: resize.start.height,
      resizing: false,
      style: { ...node.style, width: undefined, height: undefined },
    }));
    data.onDirectGestureEnd(id);
  }, [data, id, updateNode]);

  const openContextMenu = (event: ReactMouseEvent<Element>) => {
    event.preventDefault();
    event.stopPropagation();
    data.onRequestContextMenu(data.regionId, event.clientX, event.clientY);
  };

  return (
    <section
      className={`region-frame region-frame--${data.variant} region-frame--level-${level} region-frame--${shape} region-frame--${data.borderStyle} region-frame--weight-${borderWeight}${level === "subject" ? ` region-frame--subject-${subjectFrameStyle}` : ""}${selected ? " is-selected" : ""}`}
      style={style}
      aria-label={`${data.title} ${level}`}
      data-testid={`group-${data.regionId}`}
      data-group-shape={shape}
      data-group-level={level}
      data-fill-opacity={fillOpacity}
      data-border-weight={borderWeight}
      data-region-variant={data.variant}
      data-subject-frame-style={level === "subject" ? subjectFrameStyle : undefined}
    >
      <svg className="region-frame__surface" viewBox={glyph.viewBox} preserveAspectRatio="none" aria-hidden="true">
        {selected && (
          <>
            <path className="region-frame__selection-halo" d={glyph.framePath} vectorEffect="non-scaling-stroke" />
            <path className="region-frame__selection-outer region-frame__selection-ring" d={glyph.framePath} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {level === "subject" && (
          <path className="region-frame__subject-field" d={glyph.framePath} vectorEffect="non-scaling-stroke" />
        )}
        {level === "subgroup" && (
          <path className="region-frame__subgroup-field" d={glyph.framePath} vectorEffect="non-scaling-stroke" />
        )}
        <path className="region-frame__shape" d={glyph.framePath} vectorEffect="non-scaling-stroke" />
        <path
          className="region-frame__hit-target nodrag nopan"
          data-canvas-gesture="group-resize"
          d={glyph.framePath}
          fill="none"
          stroke="rgba(0,0,0,0.001)"
          strokeWidth={borderHitWidth}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          data-screen-hit-width={borderScreenHitWidth}
          aria-label={`Resize ${data.title} ${level}`}
          onPointerDown={startBorderResize}
          onPointerMove={moveBorderResize}
          onPointerUp={finishBorderResize}
          onPointerCancel={cancelBorderResize}
          onLostPointerCapture={cancelBorderResize}
          onClick={(event) => {
            // Selection is resolved on pointer-down so dragging can begin
            // immediately.  Swallow the synthetic click emitted afterwards;
            // otherwise React Flow toggles the node a second time (most
            // visibly turning Ctrl-click deselection back on).
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={openContextMenu}
        />
      </svg>

      <div
        className={`region-title-toolbar region-title-toolbar--${level} region-title-toolbar--origin-${data.variant} nodrag nopan`}
        style={titleWrapperStyle}
      >
        <header
          className="region-frame__titlebar region-frame__drag-handle"
          style={titleBarStyle}
          aria-label={`Move ${data.title} ${level}`}
          data-region-title={data.regionId}
          data-canvas-gesture="group-move"
          data-title-attachment="contour"
          data-title-level={level}
          data-title-position={data.titlePosition}
          data-title-anchor={`${titleAnchor.x},${titleAnchor.y}`}
          data-title-contour-angle={titleAngle}
          data-title-shape={shape}
          data-title-treatment={level}
          title={`Drag to move ${level} · right-click to edit`}
          onPointerDown={startTitleDrag}
          onPointerMove={moveTitleDrag}
          onPointerUp={finishTitleDrag}
          onPointerCancel={cancelTitleDrag}
          onLostPointerCapture={cancelTitleDrag}
          onClick={(event) => {
            // The title is the group's sole move/selection owner.  Do not let
            // its post-gesture click bubble to the rectangular node wrapper.
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={openContextMenu}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void fitView({ nodes: [{ id }], padding: .08, minZoom: .45, maxZoom: .85, duration: 180 });
          }}
        >
          <svg
            className="region-frame__title-frame"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className="region-frame__title-frame-field"
              d={titleFramePath}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="region-frame__title-frame-outline"
              d={titleFramePath}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="region-frame__title-frame-inner"
              d={titleFramePath}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="region-frame__title-frame-detail"
              d="M12 36H88"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {level === "subject" ? (
            <span
              className="region-frame__subject-icon"
              data-subject-icon={subjectFrameStyle}
              aria-hidden="true"
            >
              <SubjectIcon strokeWidth={2.1} />
            </span>
          ) : (
            <span className="region-frame__title-mark" aria-hidden="true">
              <span className="region-frame__title-mark-core" />
            </span>
          )}
          <span
            className="region-frame__title-text"
            style={{
              minWidth: 0,
              maxWidth: "100%",
              overflow: "visible",
              textOverflow: "clip",
              whiteSpace: "normal",
              fontSize: `${level === "subject" ? Math.max(data.titleFontSize, 42) : data.titleFontSize}px`,
            }}
          >
            {data.title}
          </span>
        </header>
      </div>

      {ports.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          className={`atlas-port region-port region-port--geometry atlas-port--${port.id} nodrag nopan`}
          type="source"
          isConnectable={isConnectable}
          position={port.position}
          style={framePortStyle(shape, port.id, 100, 100)}
          data-port-side={port.id}
          data-canvas-gesture="connect"
          aria-hidden="true"
        />
      ))}

      <ViewportPortal>
        <div
          className="region-port-layer nodrag nopan"
          data-region-port-layer={data.regionId}
          style={{
            ...style,
            position: "absolute",
            width: frameWidth,
            height: frameHeight,
            transform: `translate(${frameX}px, ${frameY}px)`,
          }}
        >
          {ports.map((port) => (
            <Handle
              key={port.id}
              id={port.id}
              className={`atlas-port region-port region-port--proxy atlas-port--${port.id} nodrag nopan`}
              type="source"
              isConnectable={isConnectable}
              position={port.position}
              style={framePortStyle(shape, port.id, 100, 100)}
              data-port-side={port.id}
              data-canvas-gesture="connect"
              title={`Draw connection from ${data.title}`}
            >
              <span className="atlas-port__hit" aria-hidden="true" />
            </Handle>
          ))}
        </div>
      </ViewportPortal>
    </section>
  );
});
