import {
  isGroupShape,
  objectShapeContainsPoint,
  objectShapePortAnchors,
  type GroupShape,
  type ObjectPortSide,
} from "./mapAppearance";

/** A point or movement vector in canvas (not screen) coordinates. */
export interface CanvasSnapPoint {
  x: number;
  y: number;
}

/** Axis-aligned bounds in canvas coordinates. */
export interface CanvasSnapRect extends CanvasSnapPoint {
  width: number;
  height: number;
}

export type CanvasSnapAxis = "x" | "y";
export type CanvasSnapKind = "alignment" | "connection" | "containment" | "distribution" | "grid";
export type CanvasSnapObjectRole = "item" | "container";
export type CanvasSnapShape = GroupShape;

/**
 * One stationary object that may offer alignment magnets. `parentId` is also
 * used to remove descendants of a selected group from the stationary set.
 */
export interface CanvasSnapTarget {
  id: string;
  rect: CanvasSnapRect;
  kind?: string;
  role?: CanvasSnapObjectRole;
  parentId?: string | null;
  /** Visible container contour used by focused containment assistance. */
  shape?: CanvasSnapShape;
}

/** Aggregate bounds and optional identity metadata for the moving selection. */
export interface CanvasMovingSelection {
  rect: CanvasSnapRect;
  ids?: readonly string[];
  kind?: string;
  role?: CanvasSnapObjectRole;
  /** The common parent, when every moving root shares one. */
  parentId?: string | null;
}

/**
 * One exact port-to-port relationship involving an object in the moving
 * selection. Points are absolute canvas coordinates at gesture start. The
 * selected `axis` is the component which must become equal for the connection
 * to run straight: `y` for opposing side ports and `x` for opposing top/bottom
 * ports.
 */
export interface CanvasConnectionSnapHint {
  id: string;
  movingId: string;
  targetId: string;
  axis: CanvasSnapAxis;
  movingPoint: CanvasSnapPoint;
  targetPoint: CanvasSnapPoint;
}

/** Minimal rendered-edge geometry needed to derive exact port magnets. */
export interface CanvasSnapConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface BuildCanvasConnectionSnapHintsInput {
  connections: readonly CanvasSnapConnection[];
  targets: readonly CanvasSnapTarget[];
  movingIds: ReadonlySet<string> | readonly string[];
}

export interface CanvasSnapLiveNode {
  id: string;
  position?: CanvasSnapPoint;
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
}

export interface BuildCanvasMovementGestureInput {
  targets: readonly CanvasSnapTarget[];
  liveNodes?: readonly CanvasSnapLiveNode[];
  positions: ReadonlyMap<string, CanvasSnapPoint>;
  snapNodeIds: ReadonlySet<string> | readonly string[];
  connections: readonly CanvasSnapConnection[];
}

export interface CanvasMovementGestureSnapshot {
  moving: CanvasMovingSelection;
  stationary: readonly CanvasSnapTarget[];
  connections: readonly CanvasConnectionSnapHint[];
}

export interface CanvasSnapModifiers {
  /** Alt bypasses object magnets but deliberately retains the configured grid. */
  altKey?: boolean;
  /** Locks the gesture to this canvas axis; the perpendicular delta becomes zero. */
  axisLock?: CanvasSnapAxis;
}

export type CanvasGridSnapMode = "always" | "magnetic" | "off";

export interface CanvasMovementSnapOptions {
  /** Distance at which a new smart guide is acquired, measured on screen. */
  thresholdPx: number;
  /** Wider screen-space distance used to release an existing smart guide. */
  releaseThresholdPx: number;
  /** Maximum perpendicular distance across which object alignment is offered. */
  alignmentReachPx: number;
  /** Maximum equal gap which is considered useful, measured on screen. */
  maxDistributionGapPx: number;
  /** Inner group-frame inset, expressed in grid units. */
  containerInsetGridUnits: number;
  /** Small screen-space window in which semantic priority breaks distance ties. */
  priorityWindowPx: number;
  /** Bounds distribution work on very large canvases. */
  maxDistributionTargets: number;
  /** `always` matches Math Atlas' exact black-dot grid settling. */
  gridMode: CanvasGridSnapMode;
  /** Grid guides are normally redundant because the dot grid is already visible. */
  showGridGuides: boolean;
}

export const DEFAULT_CANVAS_MOVEMENT_SNAP_OPTIONS: Readonly<CanvasMovementSnapOptions> = {
  thresholdPx: 7,
  releaseThresholdPx: 11,
  alignmentReachPx: 420,
  maxDistributionGapPx: 420,
  containerInsetGridUnits: 1,
  priorityWindowPx: 2,
  maxDistributionTargets: 64,
  gridMode: "always",
  showGridGuides: false,
};

/** Renderer-neutral line primitive. All coordinates remain in canvas space. */
export interface CanvasSnapGuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CanvasSnapGuideLabel extends CanvasSnapPoint {
  text: string;
}

/**
 * A selected guide with enough geometry for SVG, canvas, or DOM rendering.
 * Distribution guides contain dimension spans and end ticks in `lines`.
 */
export interface CanvasSnapGuide {
  id: string;
  kind: CanvasSnapKind;
  axis: CanvasSnapAxis;
  lines: readonly CanvasSnapGuideLine[];
  targetIds: readonly string[];
  /** Semantic anchors let renderers distinguish centres, edges, and ports. */
  movingAnchor?: string;
  targetAnchor?: string;
  label?: CanvasSnapGuideLabel;
}

export interface CanvasAxisSnap {
  axis: CanvasSnapAxis;
  kind: CanvasSnapKind;
  key: string;
  /** The resolved component of the total drag delta. */
  delta: number;
  /** Difference between the resolved and raw pointer delta. */
  correction: number;
  /** Raw screen-space distance to the selected magnet. */
  distancePx: number;
  targetIds: readonly string[];
  movingAnchor: string;
  targetAnchor: string;
  sticky: boolean;
}

export interface CanvasSnapLock {
  key: string;
  kind: Exclude<CanvasSnapKind, "grid">;
}

/** Pass the returned state into the next pointer move to obtain hysteresis. */
export interface CanvasMovementSnapState {
  contextKey: string;
  x?: CanvasSnapLock;
  y?: CanvasSnapLock;
}

export interface ResolveCanvasMovementSnapInput {
  moving: CanvasMovingSelection;
  stationary: readonly CanvasSnapTarget[];
  /** Exact incident port relationships, normally captured once per gesture. */
  connections?: readonly CanvasConnectionSnapHint[];
  zoom: number;
  rawDelta: CanvasSnapPoint;
  gridSize: number;
  modifiers?: CanvasSnapModifiers;
  previous?: CanvasMovementSnapState;
  /** Stable per gesture. Supplying this is useful when the same selection is re-dragged. */
  contextKey?: string;
  options?: Partial<CanvasMovementSnapOptions>;
}

export interface CanvasMovementSnapResult {
  delta: CanvasSnapPoint;
  rect: CanvasSnapRect;
  guides: readonly CanvasSnapGuide[];
  snapped: Readonly<Partial<Record<CanvasSnapAxis, CanvasAxisSnap>>>;
  state: CanvasMovementSnapState;
}

type HorizontalAnchor = "left" | "center" | "right";
type VerticalAnchor = "top" | "middle" | "bottom";
type AnchorName = HorizontalAnchor | VerticalAnchor;

interface SnapCandidate {
  axis: CanvasSnapAxis;
  kind: Exclude<CanvasSnapKind, "grid">;
  key: string;
  delta: number;
  distancePx: number;
  priority: number;
  targetIds: readonly string[];
  movingAnchor: string;
  targetAnchor: string;
  guide: (delta: CanvasSnapPoint) => CanvasSnapGuide;
}

interface ChosenCandidate {
  candidate: SnapCandidate;
  sticky: boolean;
}

const EPSILON = 1e-7;

function finite(value: number, name: string) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
}

function validRect(rect: CanvasSnapRect, name: string) {
  finite(rect.x, `${name}.x`);
  finite(rect.y, `${name}.y`);
  finite(rect.width, `${name}.width`);
  finite(rect.height, `${name}.height`);
  if (rect.width < 0 || rect.height < 0) {
    throw new RangeError(`${name} dimensions cannot be negative.`);
  }
}

function clean(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

function compareText(first: string, second: string) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function translated(rect: CanvasSnapRect, delta: CanvasSnapPoint): CanvasSnapRect {
  return {
    x: clean(rect.x + delta.x),
    y: clean(rect.y + delta.y),
    width: rect.width,
    height: rect.height,
  };
}

function start(rect: CanvasSnapRect, axis: CanvasSnapAxis) {
  return axis === "x" ? rect.x : rect.y;
}

function size(rect: CanvasSnapRect, axis: CanvasSnapAxis) {
  return axis === "x" ? rect.width : rect.height;
}

function end(rect: CanvasSnapRect, axis: CanvasSnapAxis) {
  return start(rect, axis) + size(rect, axis);
}

function center(rect: CanvasSnapRect, axis: CanvasSnapAxis) {
  return start(rect, axis) + size(rect, axis) / 2;
}

function crossAxis(axis: CanvasSnapAxis): CanvasSnapAxis {
  return axis === "x" ? "y" : "x";
}

function intervalSeparation(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  if (firstEnd < secondStart) return secondStart - firstEnd;
  if (secondEnd < firstStart) return firstStart - secondEnd;
  return 0;
}

function perpendicularSeparation(
  first: CanvasSnapRect,
  second: CanvasSnapRect,
  axis: CanvasSnapAxis,
) {
  const cross = crossAxis(axis);
  return intervalSeparation(start(first, cross), end(first, cross), start(second, cross), end(second, cross));
}

function anchorValue(rect: CanvasSnapRect, anchor: AnchorName) {
  switch (anchor) {
    case "left": return rect.x;
    case "center": return rect.x + rect.width / 2;
    case "right": return rect.x + rect.width;
    case "top": return rect.y;
    case "middle": return rect.y + rect.height / 2;
    case "bottom": return rect.y + rect.height;
  }
}

function line(x1: number, y1: number, x2: number, y2: number): CanvasSnapGuideLine {
  return { x1: clean(x1), y1: clean(y1), x2: clean(x2), y2: clean(y2) };
}

function formatGap(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function defaultContextKey(moving: CanvasMovingSelection) {
  const ids = [...new Set(moving.ids ?? [])].sort(compareText);
  return JSON.stringify([ids, moving.rect.x, moving.rect.y, moving.rect.width, moving.rect.height]);
}

function relationPriority(moving: CanvasMovingSelection, target: CanvasSnapTarget) {
  let priority = 0;
  if (moving.parentId != null && moving.parentId === target.parentId) priority += 4;
  if (moving.kind && moving.kind === target.kind) priority += 2;
  if (moving.role && moving.role === target.role) priority += 1;
  return priority;
}

function targetIsContainer(target: CanvasSnapTarget) {
  if (target.role !== undefined) return target.role === "container";
  const kind = target.kind?.trim().toLowerCase();
  return kind === "container" || kind === "group" || kind === "group/container" ||
    kind === "subgroup" || kind === "subject";
}

function movingIsContainer(moving: CanvasMovingSelection) {
  if (moving.role !== undefined) return moving.role === "container";
  const kind = moving.kind?.trim().toLowerCase();
  return kind === "container" || kind === "group" || kind === "group/container" ||
    kind === "subgroup" || kind === "subject";
}

/**
 * Ordinary drafting guides compare like with like. Missing parent metadata is
 * treated as unknown for the renderer-neutral API, while an explicit `null`
 * remains a real root parent and therefore does not match a nested object.
 */
function ordinaryPeer(moving: CanvasMovingSelection, target: CanvasSnapTarget) {
  if (movingIsContainer(moving) !== targetIsContainer(target)) return false;
  if (moving.parentId !== undefined && target.parentId !== undefined) {
    return moving.parentId === target.parentId;
  }
  return true;
}

function portSide(value: string | null | undefined): ObjectPortSide | undefined {
  return value === "top" || value === "right" || value === "bottom" || value === "left"
    ? value
    : undefined;
}

function opposingPortAxis(
  source: ObjectPortSide | undefined,
  target: ObjectPortSide | undefined,
): CanvasSnapAxis | undefined {
  if (
    (source === "left" && target === "right") ||
    (source === "right" && target === "left")
  ) return "y";
  if (
    (source === "top" && target === "bottom") ||
    (source === "bottom" && target === "top")
  ) return "x";
  return undefined;
}

function targetPortPoint(
  target: CanvasSnapTarget,
  side: ObjectPortSide,
): CanvasSnapPoint {
  const shape = isGroupShape(target.shape) ? target.shape : "rectangle";
  // Region SVGs use a normalized glyph stretched to their bounds; landmark
  // SVGs are authored in their actual dimensions. Matching that distinction
  // keeps wide parallelogram ports exactly on the visible dots.
  const anchor = targetIsContainer(target)
    ? objectShapePortAnchors(shape, 100, 100)[side]
    : objectShapePortAnchors(shape, target.rect.width, target.rect.height)[side];
  return {
    x: target.rect.x + target.rect.width * anchor.x / 100,
    y: target.rect.y + target.rect.height * anchor.y / 100,
  };
}

/**
 * Captures the same resolved handles currently used by the edge renderer.
 * Internal selection edges are ignored; fixed non-opposing handles remain
 * fixed user intent rather than being silently rewritten during movement.
 */
export function buildCanvasConnectionSnapHints({
  connections,
  targets,
  movingIds: movingIdInput,
}: BuildCanvasConnectionSnapHintsInput): CanvasConnectionSnapHint[] {
  const movingIds = new Set<string>();
  movingIdInput.forEach((id) => movingIds.add(id));
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  return connections.flatMap((connection) => {
    const sourceMoves = movingIds.has(connection.source);
    const targetMoves = movingIds.has(connection.target);
    if (sourceMoves === targetMoves) return [];
    const source = targetsById.get(connection.source);
    const target = targetsById.get(connection.target);
    const sourceHandle = portSide(connection.sourceHandle);
    const targetHandle = portSide(connection.targetHandle);
    const axis = opposingPortAxis(sourceHandle, targetHandle);
    if (!source || !target || !sourceHandle || !targetHandle || !axis) return [];
    const sourcePoint = targetPortPoint(source, sourceHandle);
    const targetPoint = targetPortPoint(target, targetHandle);
    return [{
      id: connection.id,
      movingId: sourceMoves ? connection.source : connection.target,
      targetId: sourceMoves ? connection.target : connection.source,
      axis,
      movingPoint: sourceMoves ? sourcePoint : targetPoint,
      targetPoint: sourceMoves ? targetPoint : sourcePoint,
    }];
  });
}

/** Freezes all geometry used by one pointer gesture from the live canvas. */
export function buildCanvasMovementGesture({
  targets,
  liveNodes = [],
  positions,
  snapNodeIds,
  connections,
}: BuildCanvasMovementGestureInput): CanvasMovementGestureSnapshot | undefined {
  const liveById = new Map(liveNodes.map((node) => [node.id, node]));
  const stationary = targets.map((target) => {
    const live = liveById.get(target.id);
    const position = positions.get(target.id) ?? live?.position;
    if (!position && !live?.measured) return target;
    return {
      ...target,
      rect: {
        x: position?.x ?? target.rect.x,
        y: position?.y ?? target.rect.y,
        width: live?.measured?.width ?? live?.width ?? target.rect.width,
        height: live?.measured?.height ?? live?.height ?? target.rect.height,
      },
    };
  });
  const byId = new Map(stationary.map((target) => [target.id, target]));
  const roots: CanvasSnapTarget[] = [];
  snapNodeIds.forEach((id) => {
    const target = byId.get(id);
    if (target) roots.push(target);
  });
  const first = roots[0]?.rect;
  if (!first) return undefined;
  const union = roots.slice(1).reduce((rect, target) => ({
    x: Math.min(rect.x, target.rect.x),
    y: Math.min(rect.y, target.rect.y),
    width: Math.max(rect.x + rect.width, target.rect.x + target.rect.width) -
      Math.min(rect.x, target.rect.x),
    height: Math.max(rect.y + rect.height, target.rect.y + target.rect.height) -
      Math.min(rect.y, target.rect.y),
  }), { ...first });
  const parents = new Set(roots.map(({ parentId }) => parentId ?? null));
  const kinds = new Set(roots.map(({ kind }) => kind).filter(Boolean));
  const roles = new Set(roots.map(({ role }) => role).filter(Boolean));
  const movingIds = new Set<string>();
  positions.forEach((_position, id) => movingIds.add(id));
  return {
    moving: {
      rect: union,
      ids: [...movingIds],
      ...(parents.size === 1 ? { parentId: [...parents][0] } : {}),
      ...(kinds.size === 1 ? { kind: [...kinds][0] } : {}),
      ...(roles.size === 1 ? { role: [...roles][0] } : {}),
    },
    stationary,
    connections: buildCanvasConnectionSnapHints({ connections, targets: stationary, movingIds }),
  };
}

function alignmentGuide(
  key: string,
  axis: CanvasSnapAxis,
  coordinate: number,
  movingRect: CanvasSnapRect,
  target: CanvasSnapTarget,
  finalDelta: CanvasSnapPoint,
  padding: number,
): CanvasSnapGuide {
  const resolvedMoving = translated(movingRect, finalDelta);
  if (axis === "x") {
    return {
      id: key,
      kind: "alignment",
      axis,
      lines: [line(
        coordinate,
        Math.min(resolvedMoving.y, target.rect.y) - padding,
        coordinate,
        Math.max(resolvedMoving.y + resolvedMoving.height, target.rect.y + target.rect.height) + padding,
      )],
      targetIds: [target.id],
    };
  }
  return {
    id: key,
    kind: "alignment",
    axis,
    lines: [line(
      Math.min(resolvedMoving.x, target.rect.x) - padding,
      coordinate,
      Math.max(resolvedMoving.x + resolvedMoving.width, target.rect.x + target.rect.width) + padding,
      coordinate,
    )],
    targetIds: [target.id],
  };
}

function containmentGuide(
  key: string,
  axis: CanvasSnapAxis,
  target: CanvasSnapTarget,
  coordinate = center(target.rect, axis),
  inset = 0,
): CanvasSnapGuide {
  return axis === "x"
    ? {
        id: key,
        kind: "containment",
        axis,
        lines: [line(
          coordinate,
          target.rect.y + inset,
          coordinate,
          target.rect.y + target.rect.height - inset,
        )],
        targetIds: [target.id],
      }
    : {
        id: key,
        kind: "containment",
        axis,
        lines: [line(
          target.rect.x + inset,
          coordinate,
          target.rect.x + target.rect.width - inset,
          coordinate,
        )],
        targetIds: [target.id],
      };
}

function containmentCenterGuide(
  key: string,
  axis: CanvasSnapAxis,
  target: CanvasSnapTarget,
  movingRect: CanvasSnapRect,
  finalDelta: CanvasSnapPoint,
  zoom: number,
): CanvasSnapGuide {
  const moved = translated(movingRect, finalDelta);
  const cross = crossAxis(axis);
  const movingCross = center(moved, cross);
  const targetCross = center(target.rect, cross);
  const padding = 12 / zoom;
  const maximumSpan = 220 / zoom;
  let from: number;
  let to: number;
  if (Math.abs(targetCross - movingCross) <= EPSILON) {
    from = movingCross - 18 / zoom;
    to = movingCross + 18 / zoom;
  } else {
    const low = Math.min(movingCross, targetCross) - padding;
    const high = Math.max(movingCross, targetCross) + padding;
    if (high - low <= maximumSpan) {
      from = low;
      to = high;
    } else if (targetCross > movingCross) {
      from = movingCross - padding;
      to = from + maximumSpan;
    } else {
      to = movingCross + padding;
      from = to - maximumSpan;
    }
  }
  const coordinate = center(target.rect, axis);
  return axis === "x"
    ? {
        id: key,
        kind: "containment",
        axis,
        lines: [line(coordinate, from, coordinate, to)],
        targetIds: [target.id],
      }
    : {
        id: key,
        kind: "containment",
        axis,
        lines: [line(from, coordinate, to, coordinate)],
        targetIds: [target.id],
      };
}

function connectionGuide(
  key: string,
  hint: CanvasConnectionSnapHint,
  finalDelta: CanvasSnapPoint,
): CanvasSnapGuide {
  const movedPoint = {
    x: hint.movingPoint.x + finalDelta.x,
    y: hint.movingPoint.y + finalDelta.y,
  };
  return {
    id: key,
    kind: "connection",
    axis: hint.axis,
    lines: [line(
      movedPoint.x,
      movedPoint.y,
      hint.targetPoint.x,
      hint.targetPoint.y,
    )],
    targetIds: [hint.targetId],
  };
}

function distributionGuide(
  key: string,
  axis: CanvasSnapAxis,
  intervals: readonly (readonly [number, number])[],
  movingRect: CanvasSnapRect,
  finalDelta: CanvasSnapPoint,
  targetIds: readonly string[],
  gap: number,
  tickSize: number,
): CanvasSnapGuide {
  const moved = translated(movingRect, finalDelta);
  const cross = center(moved, crossAxis(axis));
  const lines: CanvasSnapGuideLine[] = [];
  for (const [from, to] of intervals) {
    if (axis === "x") {
      lines.push(line(from, cross, to, cross));
      lines.push(line(from, cross - tickSize, from, cross + tickSize));
      lines.push(line(to, cross - tickSize, to, cross + tickSize));
    } else {
      lines.push(line(cross, from, cross, to));
      lines.push(line(cross - tickSize, from, cross + tickSize, from));
      lines.push(line(cross - tickSize, to, cross + tickSize, to));
    }
  }
  const first = intervals[0] ?? [start(moved, axis), end(moved, axis)];
  const labelCoordinate = (first[0] + first[1]) / 2;
  return {
    id: key,
    kind: "distribution",
    axis,
    lines,
    targetIds,
    label: axis === "x"
      ? { x: labelCoordinate, y: cross - tickSize * 1.8, text: formatGap(gap) }
      : { x: cross + tickSize * 1.8, y: labelCoordinate, text: formatGap(gap) },
  };
}

function gridGuide(
  key: string,
  axis: CanvasSnapAxis,
  moved: CanvasSnapRect,
): CanvasSnapGuide {
  return axis === "x"
    ? {
        id: key,
        kind: "grid",
        axis,
        lines: [line(moved.x, moved.y, moved.x, moved.y + moved.height)],
        targetIds: [],
      }
    : {
        id: key,
        kind: "grid",
        axis,
        lines: [line(moved.x, moved.y, moved.x + moved.width, moved.y)],
        targetIds: [],
      };
}

function resolvedOptions(partial: Partial<CanvasMovementSnapOptions> | undefined) {
  const options = { ...DEFAULT_CANVAS_MOVEMENT_SNAP_OPTIONS, ...partial };
  const nonNegative: (keyof Pick<
    CanvasMovementSnapOptions,
    "thresholdPx" | "releaseThresholdPx" | "alignmentReachPx" |
    "maxDistributionGapPx" | "containerInsetGridUnits" | "priorityWindowPx"
  >)[] = [
    "thresholdPx",
    "releaseThresholdPx",
    "alignmentReachPx",
    "maxDistributionGapPx",
    "containerInsetGridUnits",
    "priorityWindowPx",
  ];
  for (const key of nonNegative) {
    finite(options[key], `options.${key}`);
    if (options[key] < 0) throw new RangeError(`options.${key} cannot be negative.`);
  }
  if (options.releaseThresholdPx < options.thresholdPx) {
    throw new RangeError("options.releaseThresholdPx cannot be smaller than thresholdPx.");
  }
  if (!Number.isInteger(options.maxDistributionTargets) || options.maxDistributionTargets < 2) {
    throw new RangeError("options.maxDistributionTargets must be an integer of at least two.");
  }
  if (!(["always", "magnetic", "off"] as const).includes(options.gridMode)) {
    throw new TypeError("options.gridMode is invalid.");
  }
  return options;
}

function eligibleTargets(
  moving: CanvasMovingSelection,
  stationary: readonly CanvasSnapTarget[],
) {
  const byId = new Map<string, CanvasSnapTarget>();
  for (const target of stationary) {
    if (!target.id.trim()) throw new TypeError("A snap target id cannot be blank.");
    validRect(target.rect, `stationary[${target.id}]`);
    if (byId.has(target.id)) throw new TypeError(`Duplicate snap target id: ${target.id}`);
    byId.set(target.id, target);
  }

  const movingIds = new Set(moving.ids ?? []);
  const hasMovingAncestor = (target: CanvasSnapTarget) => {
    let parentId = target.parentId ?? undefined;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (movingIds.has(parentId)) return true;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? undefined;
    }
    return false;
  };

  return [...stationary]
    .filter((target) => !movingIds.has(target.id) && !hasMovingAncestor(target))
    .sort((first, second) => (
      compareText(first.id, second.id) ||
      first.rect.x - second.rect.x ||
      first.rect.y - second.rect.y
    ));
}

function connectionCandidates(
  moving: CanvasMovingSelection,
  targets: readonly CanvasSnapTarget[],
  hints: readonly CanvasConnectionSnapHint[],
  rawDelta: CanvasSnapPoint,
  zoom: number,
  releaseThresholdPx: number,
) {
  const result: SnapCandidate[] = [];
  const targetIds = new Set(targets.map(({ id }) => id));
  const movingIds = new Set(moving.ids ?? []);
  const seen = new Set<string>();
  const validated = hints.map((hint, index) => {
    if (!hint.id.trim()) throw new TypeError(`connections[${index}].id cannot be blank.`);
    if (!hint.movingId.trim()) {
      throw new TypeError(`connections[${index}].movingId cannot be blank.`);
    }
    if (!hint.targetId.trim()) {
      throw new TypeError(`connections[${index}].targetId cannot be blank.`);
    }
    if (hint.axis !== "x" && hint.axis !== "y") {
      throw new TypeError(`connections[${index}].axis is invalid.`);
    }
    finite(hint.movingPoint.x, `connections[${index}].movingPoint.x`);
    finite(hint.movingPoint.y, `connections[${index}].movingPoint.y`);
    finite(hint.targetPoint.x, `connections[${index}].targetPoint.x`);
    finite(hint.targetPoint.y, `connections[${index}].targetPoint.y`);
    const identity = `${hint.id}\u001f${hint.axis}\u001f${hint.movingId}\u001f${hint.targetId}`;
    if (seen.has(identity)) {
      throw new TypeError(`Duplicate connection snap hint: ${hint.id}`);
    }
    seen.add(identity);
    return { hint, identity };
  }).sort((first, second) => compareText(first.identity, second.identity));

  for (const { hint } of validated) {
    if (movingIds.size && !movingIds.has(hint.movingId)) continue;
    if (!targetIds.has(hint.targetId) || movingIds.has(hint.targetId)) continue;
    const desiredDelta = hint.targetPoint[hint.axis] - hint.movingPoint[hint.axis];
    const distancePx = Math.abs(desiredDelta - rawDelta[hint.axis]) * zoom;
    if (distancePx > releaseThresholdPx + EPSILON) continue;
    const key = `connection:${hint.axis}:${hint.id}:${hint.movingId}:${hint.targetId}`;
    result.push({
      axis: hint.axis,
      kind: "connection",
      key,
      delta: clean(desiredDelta),
      distancePx,
      priority: 200,
      targetIds: [hint.targetId],
      movingAnchor: "connection-port",
      targetAnchor: "connection-port",
      guide: (finalDelta) => connectionGuide(key, hint, finalDelta),
    });
  }
  return result;
}

function alignmentCandidates(
  moving: CanvasMovingSelection,
  targets: readonly CanvasSnapTarget[],
  rawDelta: CanvasSnapPoint,
  zoom: number,
  releaseThresholdPx: number,
  alignmentReachPx: number,
) {
  const result: SnapCandidate[] = [];
  const rawRect = translated(moving.rect, rawDelta);
  const padding = 4 / zoom;
  const axes: readonly {
    axis: CanvasSnapAxis;
    anchors: readonly AnchorName[];
  }[] = [
    { axis: "x", anchors: ["left", "center", "right"] },
    { axis: "y", anchors: ["top", "middle", "bottom"] },
  ];

  for (const target of targets) {
    if (!ordinaryPeer(moving, target)) continue;
    for (const { axis, anchors } of axes) {
      if (perpendicularSeparation(rawRect, target.rect, axis) * zoom > alignmentReachPx) continue;
      for (const anchor of anchors) {
        const desiredDelta = anchorValue(target.rect, anchor) - anchorValue(moving.rect, anchor);
        const distancePx = Math.abs(desiredDelta - rawDelta[axis]) * zoom;
        if (distancePx > releaseThresholdPx + EPSILON) continue;
        const key = `alignment:${axis}:${anchor}:${target.id}`;
        const coordinate = anchorValue(target.rect, anchor);
        result.push({
          axis,
          kind: "alignment",
          key,
          delta: clean(desiredDelta),
          distancePx,
          priority: (anchor === "center" || anchor === "middle" ? 30 : 20) +
            relationPriority(moving, target),
          targetIds: [target.id],
          movingAnchor: anchor,
          targetAnchor: anchor,
          guide: (finalDelta) => alignmentGuide(
            key,
            axis,
            coordinate,
            moving.rect,
            target,
            finalDelta,
            padding,
          ),
        });
      }
    }
  }
  return result;
}

function targetContainsMovingCenter(target: CanvasSnapTarget, movingRect: CanvasSnapRect) {
  if (target.rect.width <= EPSILON || target.rect.height <= EPSILON) return false;
  const normalizedX = (center(movingRect, "x") - target.rect.x) / target.rect.width;
  const normalizedY = (center(movingRect, "y") - target.rect.y) / target.rect.height;
  const shape = isGroupShape(target.shape) ? target.shape : "rectangle";
  return objectShapeContainsPoint(shape, normalizedX, normalizedY);
}

function containmentCandidates(
  moving: CanvasMovingSelection,
  targets: readonly CanvasSnapTarget[],
  rawDelta: CanvasSnapPoint,
  zoom: number,
  gridSize: number,
  releaseThresholdPx: number,
  containerInsetGridUnits: number,
) {
  const result: SnapCandidate[] = [];
  const rawRect = translated(moving.rect, rawDelta);
  const candidates = targets.filter((target) => {
    if (!targetIsContainer(target)) return false;
    if (
      moving.rect.width > target.rect.width + EPSILON ||
      moving.rect.height > target.rect.height + EPSILON
    ) return false;
    const rectangularlyInside = (
      center(rawRect, "x") >= target.rect.x - EPSILON &&
      center(rawRect, "x") <= target.rect.x + target.rect.width + EPSILON &&
      center(rawRect, "y") >= target.rect.y - EPSILON &&
      center(rawRect, "y") <= target.rect.y + target.rect.height + EPSILON
    );
    return rectangularlyInside && targetContainsMovingCenter(target, rawRect);
  });
  // The smallest contour under the moving centre is the visible destination
  // the user is working inside. Always preferring the historical parent here
  // made a nested subgroup impossible to centre until the item had somehow
  // already been reparented into it. The current parent remains the tie-break
  // for coincident frames, while true nested destinations win by area.
  const target = [...candidates].sort((first, second) => (
    first.rect.width * first.rect.height - second.rect.width * second.rect.height ||
    (first.id === moving.parentId ? -1 : second.id === moving.parentId ? 1 : 0) ||
    compareText(first.id, second.id)
  ))[0];
  if (!target) return result;
  const isParent = moving.parentId != null && moving.parentId === target.id;

  for (const axis of ["x", "y"] as const) {
    const desiredDelta = center(target.rect, axis) - center(moving.rect, axis);
    const distancePx = Math.abs(desiredDelta - rawDelta[axis]) * zoom;
    if (distancePx > releaseThresholdPx + EPSILON) continue;
    const movingAnchor: AnchorName = axis === "x" ? "center" : "middle";
    const key = `containment:${axis}:${target.id}`;
    result.push({
      axis,
      kind: "containment",
      key,
      delta: clean(desiredDelta),
      distancePx,
      priority: 80 + (isParent ? 8 : 0),
      targetIds: [target.id],
      movingAnchor,
      targetAnchor: `container-${movingAnchor}`,
      guide: (finalDelta) => containmentCenterGuide(
        key,
        axis,
        target,
        moving.rect,
        finalDelta,
        zoom,
      ),
    });
  }

  const inset = gridSize * containerInsetGridUnits;
  const innerWidth = target.rect.width - inset * 2;
  const innerHeight = target.rect.height - inset * 2;
  const supportsRectangularInsets = target.shape === undefined ||
    target.shape === "rectangle" || target.shape === "rounded-rectangle";
  if (
    !supportsRectangularInsets ||
    inset <= EPSILON ||
    moving.rect.width > innerWidth + EPSILON ||
    moving.rect.height > innerHeight + EPSILON
  ) return result;

  const insetAnchors: readonly {
    axis: CanvasSnapAxis;
    movingAnchor: AnchorName;
    coordinate: number;
  }[] = [
    { axis: "x", movingAnchor: "left", coordinate: target.rect.x + inset },
    { axis: "x", movingAnchor: "right", coordinate: target.rect.x + target.rect.width - inset },
    { axis: "y", movingAnchor: "top", coordinate: target.rect.y + inset },
    { axis: "y", movingAnchor: "bottom", coordinate: target.rect.y + target.rect.height - inset },
  ];
  for (const { axis, movingAnchor, coordinate } of insetAnchors) {
    const desiredDelta = coordinate - anchorValue(moving.rect, movingAnchor);
    const distancePx = Math.abs(desiredDelta - rawDelta[axis]) * zoom;
    if (distancePx > releaseThresholdPx + EPSILON) continue;
    const key = `containment:${axis}:inner-${movingAnchor}:${target.id}`;
    result.push({
      axis,
      kind: "containment",
      key,
      delta: clean(desiredDelta),
      distancePx,
      priority: 70 + (isParent ? 8 : 0),
      targetIds: [target.id],
      movingAnchor,
      targetAnchor: `container-inner-${movingAnchor}`,
      guide: () => containmentGuide(key, axis, target, coordinate, inset),
    });
  }
  return result;
}

function laneTargets(
  axis: CanvasSnapAxis,
  rawRect: CanvasSnapRect,
  targets: readonly CanvasSnapTarget[],
  zoom: number,
  gridSize: number,
  maximum: number,
) {
  const crossTolerance = Math.max(gridSize * 1.5, 72 / zoom);
  const related = targets.filter((target) => (
    perpendicularSeparation(rawRect, target.rect, axis) <= crossTolerance
  ));
  if (related.length <= maximum) {
    return related.sort((first, second) => (
      start(first.rect, axis) - start(second.rect, axis) || compareText(first.id, second.id)
    ));
  }
  return related
    .sort((first, second) => (
      Math.abs(center(first.rect, axis) - center(rawRect, axis)) -
        Math.abs(center(second.rect, axis) - center(rawRect, axis)) ||
      compareText(first.id, second.id)
    ))
    .slice(0, maximum)
    .sort((first, second) => (
      start(first.rect, axis) - start(second.rect, axis) || compareText(first.id, second.id)
    ));
}

function distributionCandidates(
  moving: CanvasMovingSelection,
  targets: readonly CanvasSnapTarget[],
  rawDelta: CanvasSnapPoint,
  zoom: number,
  gridSize: number,
  releaseThresholdPx: number,
  maxDistributionGapPx: number,
  maxDistributionTargets: number,
) {
  const result: SnapCandidate[] = [];
  const rawRect = translated(moving.rect, rawDelta);
  const peerTargets = targets.filter((target) => ordinaryPeer(moving, target));
  const releaseWorld = releaseThresholdPx / zoom;
  const maximumGap = Math.max(gridSize * 8, maxDistributionGapPx / zoom);
  const tickSize = 4 / zoom;

  for (const axis of ["x", "y"] as const) {
    const lane = laneTargets(axis, rawRect, peerTargets, zoom, gridSize, maxDistributionTargets);
    const leftOrAbove = lane
      .filter((target) => end(target.rect, axis) <= start(rawRect, axis) + releaseWorld)
      .sort((first, second) => end(second.rect, axis) - end(first.rect, axis))
      .slice(0, 4);
    const rightOrBelow = lane
      .filter((target) => start(target.rect, axis) >= end(rawRect, axis) - releaseWorld)
      .sort((first, second) => start(first.rect, axis) - start(second.rect, axis))
      .slice(0, 4);

    // Equal spacing while inserting the moving selection between two objects.
    for (const before of leftOrAbove) {
      for (const after of rightOrBelow) {
        const available = start(after.rect, axis) - end(before.rect, axis) - size(moving.rect, axis);
        if (available < -EPSILON) continue;
        const gap = Math.max(0, available / 2);
        if (gap > maximumGap) continue;
        const desiredStart = end(before.rect, axis) + gap;
        const desiredDelta = desiredStart - start(moving.rect, axis);
        const distancePx = Math.abs(desiredDelta - rawDelta[axis]) * zoom;
        if (distancePx > releaseThresholdPx + EPSILON) continue;
        const key = `distribution:${axis}:between:${before.id}:${after.id}`;
        const movingAnchor: AnchorName = axis === "x" ? "left" : "top";
        result.push({
          axis,
          kind: "distribution",
          key,
          delta: clean(desiredDelta),
          distancePx,
          priority: 50 + relationPriority(moving, before) + relationPriority(moving, after),
          targetIds: [before.id, after.id],
          movingAnchor,
          targetAnchor: "equal-gap-between",
          guide: (finalDelta) => {
            const moved = translated(moving.rect, finalDelta);
            return distributionGuide(
              key,
              axis,
              [
                [end(before.rect, axis), start(moved, axis)],
                [end(moved, axis), start(after.rect, axis)],
              ],
              moving.rect,
              finalDelta,
              [before.id, after.id],
              gap,
              tickSize,
            );
          },
        });
      }
    }

    // Extend an existing equally-spaced sequence immediately before or after it.
    for (let index = 0; index < lane.length - 1; index += 1) {
      const before = lane[index];
      const after = lane[index + 1];
      if (perpendicularSeparation(before.rect, after.rect, axis) * zoom > 96) continue;
      const gap = start(after.rect, axis) - end(before.rect, axis);
      if (gap < -EPSILON || gap > maximumGap) continue;

      const possibilities: readonly {
        placement: "before" | "after";
        desiredStart: number;
        intervals: (moved: CanvasSnapRect) => readonly (readonly [number, number])[];
      }[] = [
        {
          placement: "before",
          desiredStart: start(before.rect, axis) - gap - size(moving.rect, axis),
          intervals: (moved) => [
            [end(moved, axis), start(before.rect, axis)],
            [end(before.rect, axis), start(after.rect, axis)],
          ],
        },
        {
          placement: "after",
          desiredStart: end(after.rect, axis) + gap,
          intervals: (moved) => [
            [end(before.rect, axis), start(after.rect, axis)],
            [end(after.rect, axis), start(moved, axis)],
          ],
        },
      ];
      for (const possibility of possibilities) {
        const desiredDelta = possibility.desiredStart - start(moving.rect, axis);
        const distancePx = Math.abs(desiredDelta - rawDelta[axis]) * zoom;
        if (distancePx > releaseThresholdPx + EPSILON) continue;
        const key = `distribution:${axis}:${possibility.placement}:${before.id}:${after.id}`;
        const movingAnchor: AnchorName = axis === "x" ? "left" : "top";
        result.push({
          axis,
          kind: "distribution",
          key,
          delta: clean(desiredDelta),
          distancePx,
          priority: 45 + relationPriority(moving, before) + relationPriority(moving, after),
          targetIds: [before.id, after.id],
          movingAnchor,
          targetAnchor: `repeat-gap-${possibility.placement}`,
          guide: (finalDelta) => {
            const moved = translated(moving.rect, finalDelta);
            return distributionGuide(
              key,
              axis,
              possibility.intervals(moved),
              moving.rect,
              finalDelta,
              [before.id, after.id],
              Math.max(0, gap),
              tickSize,
            );
          },
        });
      }
    }
  }
  return result;
}

function chooseCandidate(
  axis: CanvasSnapAxis,
  candidates: readonly SnapCandidate[],
  previous: CanvasMovementSnapState | undefined,
  contextKey: string,
  options: CanvasMovementSnapOptions,
): ChosenCandidate | undefined {
  const axisCandidates = candidates.filter((candidate) => candidate.axis === axis);
  const eligible = axisCandidates.filter((candidate) => (
    candidate.distancePx <= options.thresholdPx + EPSILON
  ));
  const compareCandidates = (first: SnapCandidate, second: SnapCandidate) => {
    // A port guide is an explicit relationship rather than an incidental
    // frame coincidence. Within its acquisition radius it is the clearest
    // expression of intent and should make the rendered connection exact.
    if (first.kind === "connection" && second.kind !== "connection") return -1;
    if (second.kind === "connection" && first.kind !== "connection") return 1;
    const distanceDifference = first.distancePx - second.distancePx;
    if (Math.abs(distanceDifference) > options.priorityWindowPx) return distanceDifference;
    return second.priority - first.priority || distanceDifference || compareText(first.key, second.key);
  };
  eligible.sort(compareCandidates);
  const challenger = eligible[0];
  const previousLock = previous?.contextKey === contextKey ? previous[axis] : undefined;
  if (previousLock) {
    const retained = axisCandidates.find((candidate) => (
      candidate.key === previousLock.key &&
      candidate.kind === previousLock.kind &&
      candidate.distancePx <= options.releaseThresholdPx + EPSILON
    ));
    if (retained) {
      if (!challenger || challenger.key === retained.key) {
        return { candidate: retained, sticky: true };
      }
      const materiallyCloser = retained.distancePx - challenger.distancePx >= 3 - EPSILON;
      const explicitConnection = challenger.kind === "connection" && retained.kind !== "connection";
      const higherPriorityNearby = challenger.priority > retained.priority &&
        challenger.distancePx <= retained.distancePx + options.priorityWindowPx + EPSILON;
      if (!materiallyCloser && !explicitConnection && !higherPriorityNearby) {
        return { candidate: retained, sticky: true };
      }
    }
  }

  return challenger ? { candidate: challenger, sticky: false } : undefined;
}

function nearestGridDelta(origin: number, rawDelta: number, gridSize: number) {
  return clean(Math.round((origin + rawDelta) / gridSize) * gridSize - origin);
}

function gridAxisSnap(
  axis: CanvasSnapAxis,
  moving: CanvasMovingSelection,
  rawDelta: CanvasSnapPoint,
  zoom: number,
  gridSize: number,
  options: CanvasMovementSnapOptions,
): CanvasAxisSnap | undefined {
  if (options.gridMode === "off") return undefined;
  const delta = nearestGridDelta(start(moving.rect, axis), rawDelta[axis], gridSize);
  const distancePx = Math.abs(delta - rawDelta[axis]) * zoom;
  if (options.gridMode === "magnetic" && distancePx > options.thresholdPx + EPSILON) {
    return undefined;
  }
  const coordinate = start(moving.rect, axis) + delta;
  return {
    axis,
    kind: "grid",
    key: `grid:${axis}:${coordinate}`,
    delta,
    correction: clean(delta - rawDelta[axis]),
    distancePx,
    targetIds: [],
    movingAnchor: axis === "x" ? "left" : "top",
    targetAnchor: "grid-line",
    sticky: false,
  };
}

/**
 * Resolves one drag sample without mutating its inputs.
 *
 * Smart magnets use a screen-constant acquisition radius (`thresholdPx / zoom`)
 * and a wider release radius when the caller threads `state` into `previous`.
 * Object magnets win over the grid; otherwise grid settling is exact. Holding
 * Alt suppresses alignment, centering, and distribution while leaving grid
 * behaviour unchanged, making precision bypass predictable. A retained lock
 * wins until its release radius is crossed, which prevents adjacent guides
 * from flickering as the pointer moves by a pixel.
 */
export function resolveCanvasMovementSnap(
  input: ResolveCanvasMovementSnapInput,
): CanvasMovementSnapResult {
  validRect(input.moving.rect, "moving.rect");
  finite(input.rawDelta.x, "rawDelta.x");
  finite(input.rawDelta.y, "rawDelta.y");
  finite(input.zoom, "zoom");
  finite(input.gridSize, "gridSize");
  if (input.zoom <= 0) throw new RangeError("zoom must be greater than zero.");
  if (input.gridSize <= 0) throw new RangeError("gridSize must be greater than zero.");

  const options = resolvedOptions(input.options);
  const targets = eligibleTargets(input.moving, input.stationary);
  const contextKey = input.contextKey ?? defaultContextKey(input.moving);
  const axisLock = input.modifiers?.axisLock;
  const rawDelta = {
    x: axisLock === "y" ? 0 : input.rawDelta.x,
    y: axisLock === "x" ? 0 : input.rawDelta.y,
  };
  const incidentConnectionCandidates = connectionCandidates(
    input.moving,
    targets,
    input.connections ?? [],
    rawDelta,
    input.zoom,
    options.releaseThresholdPx,
  );
  const smartCandidates = input.modifiers?.altKey
    ? []
    : [
        ...incidentConnectionCandidates,
        ...alignmentCandidates(
          input.moving,
          targets,
          rawDelta,
          input.zoom,
          options.releaseThresholdPx,
          options.alignmentReachPx,
        ),
        ...containmentCandidates(
          input.moving,
          targets,
          rawDelta,
          input.zoom,
          input.gridSize,
          options.releaseThresholdPx,
          options.containerInsetGridUnits,
        ),
        ...distributionCandidates(
          input.moving,
          targets,
          rawDelta,
          input.zoom,
          input.gridSize,
          options.releaseThresholdPx,
          options.maxDistributionGapPx,
          options.maxDistributionTargets,
        ),
      ];

  const chosenX = axisLock === "y"
    ? undefined
    : chooseCandidate("x", smartCandidates, input.previous, contextKey, options);
  const chosenY = axisLock === "x"
    ? undefined
    : chooseCandidate("y", smartCandidates, input.previous, contextKey, options);
  const smartByAxis: Readonly<Partial<Record<CanvasSnapAxis, ChosenCandidate>>> = {
    ...(chosenX ? { x: chosenX } : {}),
    ...(chosenY ? { y: chosenY } : {}),
  };

  const snapped: Partial<Record<CanvasSnapAxis, CanvasAxisSnap>> = {};
  for (const axis of ["x", "y"] as const) {
    if (axisLock && axisLock !== axis) continue;
    const chosen = smartByAxis[axis];
    if (chosen) {
      const candidate = chosen.candidate;
      snapped[axis] = {
        axis,
        kind: candidate.kind,
        key: candidate.key,
        delta: candidate.delta,
        correction: clean(candidate.delta - input.rawDelta[axis]),
        distancePx: candidate.distancePx,
        targetIds: candidate.targetIds,
        movingAnchor: candidate.movingAnchor,
        targetAnchor: candidate.targetAnchor,
        sticky: chosen.sticky,
      };
      continue;
    }
    const gridSnap = gridAxisSnap(
      axis,
      input.moving,
      rawDelta,
      input.zoom,
      input.gridSize,
      options,
    );
    if (gridSnap) snapped[axis] = gridSnap;
  }

  const delta = {
    x: clean(snapped.x?.delta ?? rawDelta.x),
    y: clean(snapped.y?.delta ?? rawDelta.y),
  };
  const rect = translated(input.moving.rect, delta);
  const guides: CanvasSnapGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    const chosen = smartByAxis[axis];
    if (chosen) {
      const correction = chosen.candidate.delta - input.rawDelta[axis];
      // Do not paint a full unrelated-axis line merely because the object was
      // already aligned before this gesture. Deliberate motion that lands
      // exactly on a guide still remains visible.
      if (Math.abs(correction) > EPSILON || Math.abs(rawDelta[axis]) > EPSILON) {
        guides.push({
          ...chosen.candidate.guide(delta),
          movingAnchor: chosen.candidate.movingAnchor,
          targetAnchor: chosen.candidate.targetAnchor,
        });
      }
    } else if (options.showGridGuides && snapped[axis]?.kind === "grid") {
      guides.push(gridGuide(snapped[axis].key, axis, rect));
    }
  }

  return {
    delta,
    rect,
    guides,
    snapped,
    state: {
      contextKey,
      ...(chosenX ? { x: { key: chosenX.candidate.key, kind: chosenX.candidate.kind } } : {}),
      ...(chosenY ? { y: { key: chosenY.candidate.key, kind: chosenY.candidate.kind } } : {}),
    },
  };
}
