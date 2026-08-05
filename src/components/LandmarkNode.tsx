import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Handle,
  Position,
  type Node,
  type NodeProps,
  type ResizeParams,
  useReactFlow,
} from "@xyflow/react";
import { objectShapeGlyph, type ObjectShape } from "../domain/mapAppearance";
import { mathNoteLabel, mathNoteType } from "../domain/landmarkDisplay";
import type { Landmark } from "../domain/types";
import type { LandmarkContentMode } from "../state/mapCustomizationStore";
import { framePortStyle } from "./framePortStyle";
import {
  frameResizeCursor,
  frameResizeDirection,
  pointWithinFrame,
  resizedFrameDimensions,
  snappedFrameDimensions,
  type FrameResizeGesture,
} from "./frameResize";

const LazyLandmarkPreview = lazy(() => import("./LandmarkPreviewContent").then((module) => ({
  default: module.LandmarkPreviewContent,
})));

export interface LandmarkNodeData extends Record<string, unknown> {
  landmark: Landmark;
  color: string;
  shape: ObjectShape;
  contentMode: LandmarkContentMode;
  /** Zero-based selection from the note's available formulae. */
  formulaIndex: number;
  /** Authored size; React Flow's measured NodeProps can trail a fast re-grab. */
  frameWidth?: number;
  frameHeight?: number;
  previewMarkdown?: string;
  autoEditNote?: boolean;
  onBeginNoteEdit?: (landmark: Landmark) => void;
  onSaveNote?: (landmark: Landmark, markdown: string) => Promise<void>;
  /** Monotonic signal used to release any resize capture after Escape. */
  cancelToken: number;
  onRequestSelection: (
    landmarkId: string,
    mode: "replace" | "add" | "remove",
  ) => void;
  onDirectGestureStart: (nodeId: string) => void;
  onDirectGestureEnd: (nodeId: string) => void;
  onMovePointerDown: (
    nodeId: string,
    pointerId: number,
    clientX: number,
    clientY: number,
  ) => void;
  onResizeEnd: (landmarkId: string, dimensions: ResizeParams) => void;
  /** Visual emphasis owned by Files/inspector, not canvas drag selection. */
  selectionEmphasis?: boolean;
  searchEmphasis?: "match" | "muted";
}

export type LandmarkGraphNode = Node<LandmarkNodeData, "landmark">;

interface ResizeGesture extends FrameResizeGesture {
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

const DEFAULT_WIDTH = 196;
const DEFAULT_HEIGHT = 84;
const MIN_WIDTH = 112;
const MIN_HEIGHT = 56;
const BORDER_HIT_WIDTH = 10;
const GRID = 28;

const ports = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

function contourDetails(shape: ObjectShape, width: number, height: number) {
  const inset = Math.min(9, width * .045, height * .11);
  const centerX = width / 2;
  const centerY = height / 2;
  const right = width - inset;
  const bottom = height - inset;
  switch (shape) {
    case "rectangle":
      return `M${inset} 0V${inset}H0 M${right} 0V${inset}H${width} M${inset} ${height}V${bottom}H0 M${right} ${height}V${bottom}H${width}`;
    case "oval":
      return `M${centerX - 7} ${inset}H${centerX + 7} M${centerX - 7} ${bottom}H${centerX + 7}`;
    case "hexagon":
      return `M${width * .2} ${inset}H${width * .8} M${width * .2} ${bottom}H${width * .8}`;
    case "octagon":
      return `M${inset * 1.8} ${inset}H${width - inset * 1.8} M${inset * 1.8} ${bottom}H${width - inset * 1.8}`;
    case "rhombus":
      return `M${centerX} ${inset}L${centerX + 7} ${centerY}L${centerX} ${bottom} M${centerX} ${inset}L${centerX - 7} ${centerY}L${centerX} ${bottom}`;
    case "triangle":
      return `M${width * .18} ${bottom}H${width * .82} M${centerX - 5} ${inset * 1.35}L${centerX} ${inset * .55}L${centerX + 5} ${inset * 1.35}`;
    case "parallelogram":
      return `M${inset * 2.7} ${inset}H${right} M${inset} ${bottom}H${width - inset * 2.7}`;
  }
}

function semanticKind(kind: Landmark["kind"]) {
  return kind === "result" ? "theorem" : kind;
}

/** Restrained mathematical ornaments distinguish roles without visible tags. */
function semanticDetails(kind: Landmark["kind"], width: number, height: number) {
  const role = semanticKind(kind);
  const cx = width / 2;
  const top = Math.max(7, Math.min(12, height * .14));
  const bottom = height - top;
  switch (role) {
    case "definition":
      return `M${width * .12} ${height * .31}V${height * .69} M${width * .88} ${height * .31}V${height * .69}`;
    case "theorem":
      return `M${width * .29} ${top}H${width * .71} M${width * .34} ${top + 4}H${width * .66}`;
    case "proposition":
      return `M${width * .27} ${bottom - 4}H${width * .73} M${width * .34} ${bottom}H${width * .66}`;
    case "lemma":
      return `M${cx - 9} ${top + 1}H${cx + 9} M${cx} ${top - 4}V${top + 6}`;
    case "corollary":
    case "insight":
      return `M${cx} ${top - 3}L${cx + 5} ${top + 2}L${cx} ${top + 7}L${cx - 5} ${top + 2}Z`;
    case "method":
      return `M${width * .3} ${bottom}H${width * .4} M${width * .45} ${bottom}H${width * .55} M${width * .6} ${bottom}H${width * .7}`;
    case "example":
    case "source":
      return `M${cx - 6} ${bottom - 3}L${cx} ${bottom}L${cx + 6} ${bottom - 3}`;
    case "problem":
      return `M${cx - 5} ${top + 1}L${cx} ${top - 4}L${cx + 5} ${top + 1}`;
    default:
      return `M${cx - 5} ${top}H${cx + 5}`;
  }
}

function titleScale(width: number, height: number, title: string) {
  const sizeRatio = Math.min(width / DEFAULT_WIDTH, height / DEFAULT_HEIGHT);
  const lengthPenalty = Math.max(0, title.length - 30) * .045;
  return Math.max(13.5, Math.min(21, 12.5 + sizeRatio * 4 - lengthPenalty));
}

function LandmarkNodeComponent({
  id,
  data,
  selected,
  isConnectable,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<LandmarkGraphNode>) {
  const {
    landmark,
    color,
    shape,
    contentMode,
    formulaIndex,
    previewMarkdown,
    autoEditNote,
    onBeginNoteEdit,
    onSaveNote,
    selectionEmphasis,
    searchEmphasis,
  } = data;
  const glyph = objectShapeGlyph(shape, width, height);
  const resizeRef = useRef<ResizeGesture | undefined>(undefined);
  const inlineSelectionRef = useRef<{
    pointerId: number;
    removeOnRelease: boolean;
  } | undefined>(undefined);
  const cancelTokenRef = useRef(data.cancelToken);
  const { getZoom, updateNode } = useReactFlow<LandmarkGraphNode>();
  const role = semanticKind(landmark.kind);
  const visuallySelected = selected || selectionEmphasis;
  const isInformalNote = mathNoteType(landmark.kind) === "note";
  const framePath = isInformalNote && shape === "rectangle"
    ? `M0 0H${width - 16}L${width} 16V${height}H0Z`
    : glyph.framePath;
  const style = {
    "--topic-color": color,
    "--landmark-title-size": `${titleScale(width, height, landmark.title)}px`,
    "--landmark-heading-size": `${Math.max(12, Math.min(17, titleScale(width, height, landmark.title) - 2))}px`,
  } as CSSProperties;
  const showsDocumentFrame = contentMode !== "title" && !isInformalNote;

  const startResize = (event: ReactPointerEvent<SVGPathElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const removeFromSelectionOnClick = additive && selected;
    if (!removeFromSelectionOnClick) {
      data.onRequestSelection(landmark.id, additive ? "add" : "replace");
    }
    const point = pointWithinFrame(event);
    const direction = frameResizeDirection(point.x, point.y);
    // `width`/`height` in NodeProps prefer React Flow's asynchronous measured
    // dimensions. The authored values describe the border the user can
    // actually see and prevent a quick second grab from jumping backwards.
    const start = {
      x: positionAbsoluteX,
      y: positionAbsoluteY,
      width: data.frameWidth ?? width,
      height: data.frameHeight ?? height,
    };
    resizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start,
      latest: start,
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

  const moveResize = (event: ReactPointerEvent<SVGPathElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      const point = pointWithinFrame(event);
      event.currentTarget.style.cursor = frameResizeCursor(frameResizeDirection(point.x, point.y));
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY) < 2) return;
    gesture.moved = true;
    // Follow every pointer sample continuously. Grid quantization here used to
    // hold the frame still for half a cell and then jump a full 28 units.
    const dimensions = resizedFrameDimensions(
      gesture,
      event.clientX,
      event.clientY,
      gesture.zoom,
      MIN_WIDTH,
      MIN_HEIGHT,
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

  const finishResize = (event: ReactPointerEvent<SVGPathElement>) => {
    const gesture = resizeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (gesture.moved) {
      // Fit only the released edge to the dot grid, keeping its opposite edge
      // fixed. Commit that exact geometry to the runtime node and persistence
      // together so there is no release-frame flash back to the old size.
      const dimensions = snappedFrameDimensions(
        gesture.latest,
        gesture.start,
        gesture.direction,
        GRID,
        MIN_WIDTH,
        MIN_HEIGHT,
      );
      updateNode(id, (node) => ({
        position: { x: dimensions.x, y: dimensions.y },
        width: dimensions.width,
        height: dimensions.height,
        resizing: false,
        style: { ...node.style, width: undefined, height: undefined },
      }));
      data.onResizeEnd(landmark.id, dimensions);
    } else {
      updateNode(id, (node) => ({
        resizing: false,
        style: { ...node.style, width: undefined, height: undefined },
      }));
    }
    data.onDirectGestureEnd(id);
    if (!gesture.moved && gesture.removeFromSelectionOnClick) {
      data.onRequestSelection(landmark.id, "remove");
    }
  };

  const cancelResize = (event: ReactPointerEvent<SVGPathElement>) => {
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
    const gesture = resizeRef.current;
    resizeRef.current = undefined;
    if (!gesture) return;
    if (gesture.element.hasPointerCapture?.(gesture.pointerId)) {
      gesture.element.releasePointerCapture?.(gesture.pointerId);
    }
    updateNode(id, (node) => ({
      position: { x: gesture.start.x, y: gesture.start.y },
      width: gesture.start.width,
      height: gesture.start.height,
      resizing: false,
      style: { ...node.style, width: undefined, height: undefined },
    }));
    data.onDirectGestureEnd(id);
  }, [data.cancelToken, id, updateNode]);

  return (
    <article
      className={`landmark-node landmark-node--${shape} landmark-node--kind-${role} landmark-node--content-${contentMode}${isInformalNote ? " landmark-node--informal-note" : ""}${selected ? " is-selected" : ""}${selectionEmphasis && !selected ? " is-file-emphasized" : ""}${searchEmphasis ? ` is-search-${searchEmphasis}` : ""}`}
      style={style}
      data-testid={`landmark-${landmark.id}`}
      data-landmark-shape={shape}
      data-math-kind={role}
      data-content-mode={contentMode}
      data-canvas-gesture="landmark-move"
      title={isInformalNote ? undefined : landmark.title}
      aria-label={isInformalNote
        ? "Note"
        : `${mathNoteLabel(landmark.kind)}: ${landmark.title}`}
      onPointerDownCapture={(event) => {
        if (event.button !== 0 || !(event.target instanceof Element)) return;
        // The on-paper Note editor intentionally stops bubbling so a caret
        // never turns into a node drag. Select its canvas object here, before
        // that boundary, so Delete and focus always address what looks active.
        if (!event.target.closest(".landmark-node__inline-note")) return;
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        inlineSelectionRef.current = {
          pointerId: event.pointerId,
          removeOnRelease: additive && selected,
        };
        if (!(additive && selected)) {
          data.onRequestSelection(id, additive ? "add" : "replace");
        }
      }}
      onPointerUpCapture={(event) => {
        const selection = inlineSelectionRef.current;
        if (!selection || selection.pointerId !== event.pointerId) return;
        inlineSelectionRef.current = undefined;
        if (selection.removeOnRelease) data.onRequestSelection(id, "remove");
      }}
      onPointerCancelCapture={(event) => {
        if (inlineSelectionRef.current?.pointerId === event.pointerId) {
          inlineSelectionRef.current = undefined;
        }
      }}
    >
      <svg
        className="landmark-node__frame"
        viewBox={glyph.viewBox}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {visuallySelected && (
          <>
            <path className="landmark-node__selection-halo" d={framePath} vectorEffect="non-scaling-stroke" />
            <path className="landmark-node__selection-outer landmark-node__selection-ring" d={framePath} vectorEffect="non-scaling-stroke" />
          </>
        )}
        <path className="landmark-node__shape" d={framePath} vectorEffect="non-scaling-stroke" />
        {showsDocumentFrame ? (
          <>
            <path className="landmark-node__document-border landmark-node__document-border--outer" d={framePath} vectorEffect="non-scaling-stroke" />
            <path className="landmark-node__document-border landmark-node__document-border--gap" d={framePath} vectorEffect="non-scaling-stroke" />
            <path className="landmark-node__semantic-detail landmark-node__document-border landmark-node__document-border--inner" d={framePath} vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <>
            <path className="landmark-node__detail" d={contourDetails(shape, width, height)} vectorEffect="non-scaling-stroke" />
            <path className="landmark-node__semantic-detail" d={semanticDetails(landmark.kind, width, height)} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {isInformalNote && shape === "rectangle" && (
          <path className="landmark-node__paper-fold" d={`M${width - 16} 0v16h16Z`} vectorEffect="non-scaling-stroke" />
        )}
        <path
          className="landmark-node__move-target"
          data-canvas-gesture="landmark-move"
          d={framePath}
          fill="rgba(0,0,0,0.001)"
          stroke="none"
          pointerEvents="fill"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            data.onMovePointerDown(
              id,
              event.pointerId,
              event.clientX,
              event.clientY,
            );
          }}
        />
        <path
          className="landmark-node__resize-target nodrag nopan"
          data-canvas-gesture="landmark-resize"
          d={framePath}
          fill="none"
          stroke="rgba(0,0,0,0.001)"
          strokeWidth={BORDER_HIT_WIDTH}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          aria-label={isInformalNote ? "Resize note" : `Resize ${landmark.title}`}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={cancelResize}
          onLostPointerCapture={cancelResize}
        />
      </svg>

      {contentMode === "title" ? (
        <div className="landmark-node__content"><span>{landmark.title}</span></div>
      ) : (
        <div className="landmark-node__document">
          {!isInformalNote && (
            <div className="landmark-node__document-title">{landmark.title}</div>
          )}
          <Suspense fallback={<div className="landmark-node__preview-skeleton" aria-hidden="true" />}>
            <LazyLandmarkPreview
              landmark={landmark}
              mode={contentMode}
              formulaIndex={formulaIndex}
              previewMarkdown={previewMarkdown}
              autoEdit={isInformalNote && autoEditNote}
              onBeginNoteEdit={isInformalNote ? onBeginNoteEdit : undefined}
              onSaveNote={isInformalNote ? onSaveNote : undefined}
            />
          </Suspense>
        </div>
      )}

      {ports.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          className={`atlas-port atlas-port--${port.id} nodrag nopan`}
          type="source"
          isConnectable={isConnectable}
          position={port.position}
          style={framePortStyle(shape, port.id, width, height)}
          data-port-side={port.id}
          data-canvas-gesture="connect"
          title={`Draw connection from ${port.id} side`}
        >
          <span className="atlas-port__hit" aria-hidden="true" />
        </Handle>
      ))}
    </article>
  );
}

function propsEqual(previous: NodeProps<LandmarkGraphNode>, next: NodeProps<LandmarkGraphNode>) {
  return (
    previous.selected === next.selected &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.positionAbsoluteX === next.positionAbsoluteX &&
    previous.positionAbsoluteY === next.positionAbsoluteY &&
    previous.data.landmark === next.data.landmark &&
    previous.data.color === next.data.color &&
    previous.data.shape === next.data.shape &&
    previous.data.contentMode === next.data.contentMode &&
    previous.data.formulaIndex === next.data.formulaIndex &&
    previous.data.previewMarkdown === next.data.previewMarkdown &&
    previous.data.autoEditNote === next.data.autoEditNote &&
    previous.data.cancelToken === next.data.cancelToken &&
    previous.data.onRequestSelection === next.data.onRequestSelection &&
    previous.data.onDirectGestureStart === next.data.onDirectGestureStart &&
    previous.data.onDirectGestureEnd === next.data.onDirectGestureEnd &&
    previous.data.onMovePointerDown === next.data.onMovePointerDown &&
    previous.data.onBeginNoteEdit === next.data.onBeginNoteEdit &&
    previous.data.onSaveNote === next.data.onSaveNote &&
    previous.data.onResizeEnd === next.data.onResizeEnd &&
    previous.data.selectionEmphasis === next.data.selectionEmphasis &&
    previous.data.searchEmphasis === next.data.searchEmphasis &&
    previous.isConnectable === next.isConnectable
  );
}

export const LandmarkNode = memo(LandmarkNodeComponent, propsEqual);
