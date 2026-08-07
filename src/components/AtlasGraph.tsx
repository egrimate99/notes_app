import {
  FilePlus2,
  Focus,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnConnect,
  type OnConnectEnd,
  type OnEdgesChange,
  type OnMove,
  type OnNodeDrag,
  type OnNodesChange,
  type OnReconnect,
  type ReactFlowInstance,
  type ReactFlowProps,
  type ResizeParams,
  type Viewport,
  useNodesState,
} from "@xyflow/react";
import type {
  CanvasConnectionSnapHint,
  CanvasMovementSnapState,
  CanvasMovingSelection,
  CanvasSnapGuide,
  CanvasSnapPoint,
  CanvasSnapTarget,
} from "../domain/canvasMovementSnap";
import {
  defaultLandmarkShape,
  objectShapeContainsPoint,
  REGULAR_RAINBOW_PALETTE,
  SUBJECT_RAINBOW_COLORS,
  type GroupShape,
  type ObjectShape,
} from "../domain/mapAppearance";
import { repositoryPath } from "../domain/contentPaths";
import { isTextEditingTarget } from "../domain/keyboardTargets";
import {
  DEFAULT_SUBJECT_FRAME_STYLE,
  type SubjectFrameStyle,
} from "../domain/subjectFrameStyle";
import {
  type NoteFileDragItem,
  type NoteFileDragPayload,
} from "../domain/noteDrag";
import type {
  AtlasSnapshot,
  Connection,
  Landmark,
  Placement,
  Region,
  RelationKind,
  Subject,
  SubjectId,
} from "../domain/types";
import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_GROUP_TITLE_FONT_SIZE,
  defaultGroupBorderWeight,
  defaultGroupFillOpacity,
  resolveGroupShape,
  type ConnectionCustomization,
  type ConnectionDirection,
  type ConnectionLineStyle,
  type ConnectionPathStyle,
  type CustomConnection,
  type EditableLandmarkKind,
  type GroupBorderStyle,
  type GroupBorderWeight,
  type GroupCustomization,
  type GroupLevel,
  type GroupTitlePosition,
  type LandmarkCustomization,
  type MapCustomizations,
  type MapCustomizationsUpdater,
} from "../state/mapCustomizationStore";
import { LandmarkNode, type LandmarkGraphNode } from "./LandmarkNode";
import type { AtlasContextPanel, AtlasMenuState } from "./DeferredAtlasMenus";
import { RegionFrameNode, type RegionGraphNode } from "./RegionFrameNode";
import { useNoteFileDropTarget } from "./noteFileDragInteractions";
import {
  canvasGestureId,
  desktopCanvasDragDelta,
  type DesktopCanvasDragEvent,
  type DesktopCanvasPoint,
} from "../services/desktopCanvasDrag";
import "./CanvasMotionQuality.css";

const LazyDeferredAtlasMenus = lazy(() => import("./DeferredAtlasMenus"));
const LazyCanvasAlignmentGuides = lazy(() => import("./CanvasAlignmentGuides").then((module) => ({
  default: module.CanvasAlignmentGuides,
})));

type MovementSnapResolver = typeof import("../domain/canvasMovementSnap").resolveCanvasMovementSnap;
type MovementGestureBuilder = typeof import("../domain/canvasMovementSnap").buildCanvasMovementGesture;
let movementSnapResolver: MovementSnapResolver | undefined;
let movementGestureBuilder: MovementGestureBuilder | undefined;
let movementSnapResolverPromise: Promise<MovementSnapResolver> | undefined;

// Smart movement is not needed to paint or navigate the atlas. Warm it as the
// pointer approaches the canvas so opening a large map stays lean while the
// first intentional drag still gets the full magnetic resolver.
export function prepareCanvasMovementAssist() {
  if (movementSnapResolver) return Promise.resolve(movementSnapResolver);
  movementSnapResolverPromise ??= import("../domain/canvasMovementSnap").then((module) => {
    movementSnapResolver = module.resolveCanvasMovementSnap;
    movementGestureBuilder = module.buildCanvasMovementGesture;
    return movementSnapResolver;
  });
  return movementSnapResolverPromise;
}
export interface NewLandmarkRequest {
  title: string;
  kind: EditableLandmarkKind;
  subjectId: SubjectId;
  regionId: string;
  x: number;
  y: number;
  color: string;
  shape: ObjectShape;
}

export interface PlaceNoteRequest extends NoteFileDragPayload {
  subjectId: SubjectId;
  regionId: string;
  x: number;
  y: number;
}

export interface RemoveCanvasObjectsRequest {
  landmarkIds: readonly string[];
  customGroupIds: readonly string[];
  connectionIds: readonly string[];
}

export interface LandmarkResizeBounds extends Placement {
  width: number;
  height: number;
}

interface AtlasGraphProps {
  snapshot: AtlasSnapshot;
  landmarks: Landmark[];
  groupLandmarks: Landmark[];
  selectedLandmarkId?: string;
  /** When Files owns selection, emphasize every canvas copy of that note. */
  selectedContentPath?: string;
  /** Canonical note bodies already loaded by the shell, keyed by stable landmark id. */
  previewMarkdownByLandmarkId?: ReadonlyMap<string, string>;
  /** Newly created paper Note whose on-canvas editor should receive the caret. */
  autoEditNoteId?: string;
  /** Undefined means search is inactive; an empty set means an active search with no matches. */
  searchMatchIds?: ReadonlySet<string>;
  /** Browser-local workspace preference; mathematical/map data remains file-backed. */
  viewportStorageKey?: string;
  /** A monitor-local projection of the shared physical desktop camera. */
  externalViewport?: Viewport;
  /** Streams local camera movement to the desktop coordinator. */
  onViewportChange?: (viewport: Viewport) => void;
  /** Companions wait for the controller camera instead of publishing React Flow's default. */
  deferInitialViewport?: boolean;
  /** Native monitor scale used to keep canonical zoom limits identical across displays. */
  viewportScaleFactor?: number;
  /** Stable identity of this native monitor WebView. Undefined in browser mode. */
  desktopSurfaceId?: string;
  /** Latest transferable gesture received from another monitor WebView. */
  desktopCanvasDrag?: DesktopCanvasDragEvent;
  /** Publishes a complete gesture packet to the other monitor WebViews. */
  onDesktopCanvasDrag?: (event: DesktopCanvasDragEvent) => void;
  placementOverrides: readonly Placement[];
  customizations: MapCustomizations;
  onSelectLandmark: (landmark: Landmark) => void;
  /** Clears the shell-owned note/file selection when the canvas no longer owns it. */
  onClearActiveSelection?: () => void;
  onPlacementChange: (placement: Placement) => void;
  onPlacementChanges: (placements: readonly Placement[]) => void;
  /** Persists position and size as one history/desktop transaction. */
  onLandmarkResize?: (bounds: LandmarkResizeBounds) => void;
  onKindChange: (landmarkId: string, kind: EditableLandmarkKind) => void;
  onCustomizationsChange: (updater: MapCustomizationsUpdater) => void;
  onBeginNoteEdit?: (landmark: Landmark) => void;
  onSaveNote?: (landmark: Landmark, markdown: string) => Promise<void>;
  onCreateLandmark?: (request: NewLandmarkRequest) => void | Promise<void>;
  onPlaceNote?: (request: PlaceNoteRequest) => void | Promise<void>;
  /** Places an explorer selection in one canvas/history transaction. */
  onPlaceNotes?: (requests: readonly PlaceNoteRequest[]) => void | Promise<void>;
  /** Removes a mixed canvas selection in one shell history transaction. */
  onRemoveCanvasObjects?: (request: RemoveCanvasObjectsRequest) => void;
}

const VIEWPORT_STORAGE_PREFIX = "math-atlas:viewport:";

function loadStoredViewport(storageKey: string | undefined): Viewport | undefined {
  if (!storageKey) return undefined;
  try {
    const { x, y, zoom } = JSON.parse(
      localStorage.getItem(`${VIEWPORT_STORAGE_PREFIX}${storageKey}`) ?? "null",
    );
    if (
      ![x, y, zoom].every(Number.isFinite) ||
      Math.abs(x) > 10_000_000 ||
      Math.abs(y) > 10_000_000 ||
      zoom < .04 ||
      zoom > 1.8
    ) return undefined;
    return { x, y, zoom };
  } catch {
    return undefined;
  }
}

function saveStoredViewport(storageKey: string | undefined, viewport: Viewport) {
  if (!storageKey) return;
  try {
    localStorage.setItem(
      `${VIEWPORT_STORAGE_PREFIX}${storageKey}`,
      JSON.stringify(viewport),
    );
  } catch {
    // The canvas remains fully usable when browser storage is unavailable.
  }
}

function sameViewport(left: Viewport, right: Viewport) {
  return Math.abs(left.x - right.x) < .01 &&
    Math.abs(left.y - right.y) < .01 &&
    Math.abs(left.zoom - right.zoom) < .0001;
}

type AtlasGraphNode = LandmarkGraphNode | RegionGraphNode;

interface GroupDescriptor {
  region: Region;
  nodeId: string;
  variant: "region" | "subject" | "custom";
  level: GroupLevel;
  /** Logical atlas parent id; unrelated to the file tree. */
  parentId?: string;
  memberIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shape: GroupShape;
  borderStyle: GroupBorderStyle;
  borderWeight: GroupBorderWeight;
  fillOpacity: number;
  titlePosition: GroupTitlePosition;
  titleFontSize: number;
  subjectFrameStyle?: SubjectFrameStyle;
}

interface GroupDragState {
  nodeId: string;
  regionId: string;
  variant: GroupDescriptor["variant"];
  startX: number;
  startY: number;
  members: Placement[];
  memberById: Map<string, Placement>;
  nestedGroups: Array<{
    nodeId: string;
    regionId: string;
    x: number;
    y: number;
    persistPosition: boolean;
  }>;
  nestedByNodeId: Map<string, {
    nodeId: string;
    regionId: string;
    x: number;
    y: number;
    persistPosition: boolean;
  }>;
}

interface GroupDragPreview {
  drag?: GroupDragState;
  selection?: CanvasSelectionMoveState;
  deltaX: number;
  deltaY: number;
  moveRoot: boolean;
}

interface CanvasSelectionMoveGroup {
  regionId: string;
  x: number;
  y: number;
  persistPosition: boolean;
}

interface CanvasSelectionMoveState {
  primaryId: string;
  primaryStartX: number;
  primaryStartY: number;
  positions: Map<string, { x: number; y: number }>;
  /** Visible roots whose union is the drafting/alignment rectangle. */
  snapNodeIds: Set<string>;
  landmarkIds: Set<string>;
  groups: Map<string, CanvasSelectionMoveGroup>;
}

interface LandmarkDragState {
  primaryId: string;
  positions: Map<string, { x: number; y: number }>;
  selection?: CanvasSelectionMoveState;
  pointerStart?: CanvasSnapPoint;
  lastDelta: CanvasSnapPoint;
}

interface DesktopDragRuntime {
  event: DesktopCanvasDragEvent;
  startX: number;
  startY: number;
  group?: GroupDragState;
  selection?: CanvasSelectionMoveState;
  ended: boolean;
}

interface CanvasMovementModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
  /** Desktop receivers use the axis chosen by the gesture owner. */
  axisLock?: "x" | "y";
}

interface CanvasMovementAssistRuntime {
  primaryId: string;
  moving: CanvasMovingSelection;
  stationary: readonly CanvasSnapTarget[];
  connections: readonly CanvasConnectionSnapHint[];
  contextKey: string;
  snapState?: CanvasMovementSnapState;
  axisLock?: "x" | "y";
  lastDelta: CanvasSnapPoint;
}

interface CachedEdge {
  signature: string;
  edge: Edge;
}

interface CachedSearchEdge {
  base: Edge;
  emphasis: "match" | "context" | "muted";
  edge: Edge;
}

interface CachedCustomGroupMembership {
  geometrySignature: string;
  placements: ReadonlyMap<string, Placement>;
  dimensions: ReadonlyMap<string, LandmarkDimensions>;
  landmarks: readonly Landmark[];
  memberIds: string[];
}

interface EditableConnectionState {
  id: string;
  label: string;
  direction: ConnectionDirection;
  lineStyle: ConnectionLineStyle;
  pathStyle: ConnectionPathStyle;
  color: string;
}

const nodeTypes = { landmark: LandmarkNode, region: RegionFrameNode };
const GRID = 28;
const LANDMARK_WIDTH = 196;
const LANDMARK_HEIGHT = 84;
const INFORMAL_NOTE_HEIGHT = 112;
const GROUP_MIN_WIDTH = 252;
const GROUP_MIN_HEIGHT = 168;
const proOptions = { hideAttribution: true };
// This survives AtlasGraph remounts inside a renderer. Desktop bridges retain
// the most recent event, so a remount must not commit the same `end` twice.
const committedDesktopGestures = new Set<string>();
const settledDesktopGestures = new Set<string>();

function rememberSettledDesktopGesture(gestureId: string) {
  settledDesktopGestures.add(gestureId);
  while (settledDesktopGestures.size > 256) {
    const oldest = settledDesktopGestures.values().next().value as string | undefined;
    if (!oldest) break;
    settledDesktopGestures.delete(oldest);
  }
}

function rememberCommittedDesktopGesture(gestureId: string) {
  committedDesktopGestures.add(gestureId);
  while (committedDesktopGestures.size > 256) {
    const oldest = committedDesktopGestures.values().next().value as string | undefined;
    if (!oldest) break;
    committedDesktopGestures.delete(oldest);
  }
}
const farZoomEnterThreshold = .32;
const farZoomExitThreshold = .4;
const nearZoomEnterThreshold = .84;
const nearZoomExitThreshold = .72;
const broadGroupThreshold = .72;
const neutralConnectionColor = "#333333";
const subjectZoneWidth = 2240;
const subjectZoneGap = 224;
const subjectZoneTop = 84;
const compactSubjectWidth = 504;
const compactSubjectHeight = 252;
const subjectZoneKey = (subjectId: SubjectId) => `subject-zone:${subjectId}`;
const groupZIndex: Record<GroupLevel, number> = {
  subject: 0,
  group: .1,
  subgroup: .2,
};
const edgeZIndex = 1;
const landmarkZIndex = 2;
const selectedLandmarkZIndex = 3;
// A selected relation becomes visually stronger, but its 22px interaction
// corridor must never sit above a landmark and steal click/drag/context-menu
// ownership where the line crosses a note.
const selectedConnectionZIndex = edgeZIndex;

export type CanvasZoomTier = "far" | "mid" | "near";

/**
 * Semantic detail changes only after crossing a wider return threshold. This
 * prevents labels and previews flickering when a wheel or trackpad settles on
 * a boundary value.
 */
export function canvasZoomTier(
  current: CanvasZoomTier,
  zoom: number,
): CanvasZoomTier {
  if (!Number.isFinite(zoom)) return current;
  if (current === "far") {
    if (zoom < farZoomExitThreshold) return "far";
    return zoom >= nearZoomEnterThreshold ? "near" : "mid";
  }
  if (current === "near") {
    if (zoom > nearZoomExitThreshold) return "near";
    return zoom <= farZoomEnterThreshold ? "far" : "mid";
  }
  if (zoom <= farZoomEnterThreshold) return "far";
  if (zoom >= nearZoomEnterThreshold) return "near";
  return "mid";
}

function patchChanges<T extends object>(source: T | undefined, patch: Partial<T>) {
  if (!source) return Object.keys(patch).length > 0;
  return Object.entries(patch).some(([key, value]) => (
    (source as Record<string, unknown>)[key] !== value
  ));
}

function customGroupGeometrySignature(group: {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: GroupShape;
}) {
  return `${group.x}\u001f${group.y}\u001f${group.width}\u001f${group.height}\u001f${group.shape}`;
}

const defaultLineByRelation: Record<RelationKind, ConnectionLineStyle> = {
  requires: "solid",
  implies: "solid",
  generalises: "solid",
  "equivalent-to": "dashed",
  uses: "solid",
  "applies-to": "dashed",
  "example-of": "dotted",
  "counterexample-to": "dashed",
  "contrasts-with": "dotted",
  "analogous-to": "dotted",
  "related-to": "solid",
};

const lineDash: Record<ConnectionLineStyle, string | undefined> = {
  solid: undefined,
  dashed: "8 6",
  dotted: "2 6",
};

function connectionKey(connection: Edge | FlowConnection) {
  return [
    connection.source,
    connection.sourceHandle ?? "",
    connection.target,
    connection.targetHandle ?? "",
  ].join("\u001f");
}

function canCreateConnection(
  connection: Edge | FlowConnection,
  connectionKeys: ReadonlySet<string>,
  ignoredKey?: string,
) {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  const key = connectionKey(connection);
  return key === ignoredKey || !connectionKeys.has(key);
}

function snap(value: number) {
  const snapped = Math.round(value / GRID) * GRID;
  return Object.is(snapped, -0) ? 0 : snapped;
}

function snapUp(value: number) {
  return Math.ceil(value / GRID) * GRID;
}

function uniqueId(prefix: string) {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function isLandmarkNode(node: AtlasGraphNode): node is LandmarkGraphNode {
  return node.type === "landmark";
}

function isRegionNode(node: AtlasGraphNode): node is RegionGraphNode {
  return node.type === "region";
}

function primarySubjectId(landmark: Landmark) {
  return landmark.subjectIds[0];
}

function buildSubjectZoneDefaults(subjects: readonly Subject[]) {
  return new Map(subjects.map((subject, index) => [
    subject.id,
    { x: index * (subjectZoneWidth + subjectZoneGap), y: subjectZoneTop },
  ]));
}

function buildLandmarksBySubject(allLandmarks: readonly Landmark[]) {
  const landmarksBySubject = new Map<SubjectId, Landmark[]>();
  allLandmarks.forEach((landmark) => {
    const subjectId = primarySubjectId(landmark);
    if (!subjectId) return;
    const existing = landmarksBySubject.get(subjectId);
    if (existing) existing.push(landmark);
    else landmarksBySubject.set(subjectId, [landmark]);
  });
  return landmarksBySubject;
}

interface LandmarkDimensions {
  width: number;
  height: number;
}

function placementBounds(
  members: readonly Landmark[],
  placements: ReadonlyMap<string, Placement>,
  dimensions: ReadonlyMap<string, LandmarkDimensions>,
) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;
  members.forEach(({ id }) => {
    const placement = placements.get(id);
    if (!placement) return;
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    const size = dimensions.get(id) ?? { width: LANDMARK_WIDTH, height: LANDMARK_HEIGHT };
    maxX = Math.max(maxX, placement.x + size.width);
    maxY = Math.max(maxY, placement.y + size.height);
    count += 1;
  });
  return count ? { minX, minY, maxX, maxY } : undefined;
}

function buildRegionGroups(
  snapshot: AtlasSnapshot,
  landmarksBySubject: ReadonlyMap<SubjectId, readonly Landmark[]>,
  placements: Map<string, Placement>,
  dimensions: ReadonlyMap<string, LandmarkDimensions>,
  groupCustomizations: MapCustomizations["groups"],
): GroupDescriptor[] {
  return snapshot.subjects.flatMap((subject, subjectIndex) => {
    const subjectLandmarks = landmarksBySubject.get(subject.id) ?? [];
    if (subjectLandmarks.length < 2) return [];
    const regions = snapshot.regions.filter((region) => region.subjectId === subject.id);
    const regionsById = new Map(regions.map((region) => [region.id, region]));
    const membersByRegion = new Map(regions.map((region) => [region.id, [] as Landmark[]]));
    subjectLandmarks.forEach((landmark) => {
      const seen = new Set<string>();
      let current = regionsById.get(landmark.regionId);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        membersByRegion.get(current.id)?.push(landmark);
        current = current.parentId ? regionsById.get(current.parentId) : undefined;
      }
    });
    const visible = regions.filter((region) => {
      const size = membersByRegion.get(region.id)?.length ?? 0;
      if (size < 2) return false;
      if (!region.parentId) return size / subjectLandmarks.length <= broadGroupThreshold;
      const parentSize = membersByRegion.get(region.parentId)?.length ?? 0;
      return parentSize / subjectLandmarks.length > broadGroupThreshold;
    });
    const visibleRegionIds = new Set(visible.map(({ id }) => id));
    const nearestVisibleParent = (region: Region) => {
      const seen = new Set<string>();
      let parentId = region.parentId;
      while (parentId && !seen.has(parentId)) {
        if (visibleRegionIds.has(parentId)) return parentId;
        seen.add(parentId);
        parentId = regionsById.get(parentId)?.parentId;
      }
      return subjectZoneKey(region.subjectId);
    };

    return visible.flatMap((region, index) => {
      const members = membersByRegion.get(region.id) ?? [];
      const bounds = placementBounds(members, placements, dimensions);
      if (!bounds) return [];
      const customization = groupCustomizations[region.id] ?? {};
      return [{
        region: { ...region, title: customization.title ?? region.title },
        nodeId: `region-frame:${region.id}`,
        variant: "region" as const,
        level: customization.level ?? "group",
        parentId: nearestVisibleParent(region),
        memberIds: members.map(({ id }) => id),
        x: customization.x ?? snap(bounds.minX - 56),
        y: customization.y ?? snap(bounds.minY - 56),
        width: customization.width ?? snapUp(bounds.maxX - bounds.minX + 112),
        height: customization.height ?? snapUp(bounds.maxY - bounds.minY + 112),
        color: customization.color ?? REGULAR_RAINBOW_PALETTE[(subjectIndex + index) % REGULAR_RAINBOW_PALETTE.length].color,
        shape: customization.shape ?? "rectangle",
        borderStyle: customization.borderStyle ?? "solid",
        borderWeight: customization.borderWeight ?? defaultGroupBorderWeight(customization.level ?? "group"),
        fillOpacity: customization.fillOpacity ?? defaultGroupFillOpacity(customization.level ?? "group"),
        titlePosition: customization.titlePosition ?? "top-left",
        titleFontSize: customization.titleFontSize ?? DEFAULT_GROUP_TITLE_FONT_SIZE,
      }];
    });
  }).sort((left, right) => right.width * right.height - left.width * left.height);
}

function buildSubjectGroups(
  snapshot: AtlasSnapshot,
  landmarksBySubject: ReadonlyMap<SubjectId, readonly Landmark[]>,
  placements: Map<string, Placement>,
  dimensions: ReadonlyMap<string, LandmarkDimensions>,
  groupCustomizations: MapCustomizations["groups"],
  defaults: Map<SubjectId, { x: number; y: number }>,
): GroupDescriptor[] {
  return snapshot.subjects.flatMap((subject) => {
    const id = subjectZoneKey(subject.id);
    const persistedCustomization = groupCustomizations[id];
    const customization = persistedCustomization ?? {};
    const fallback = defaults.get(subject.id) ?? { x: 0, y: subjectZoneTop };
    const members = landmarksBySubject.get(subject.id) ?? [];
    // Appearance records for the old generated subject zones are not authored
    // canvas objects. Never let a stale drag/resize record resurrect an empty,
    // undeletable frame; explicitly authored subjects live in customGroups.
    if (!members.length) return [];
    const bounds = placementBounds(members, placements, dimensions);
    const naturalX = bounds ? snap(bounds.minX - 84) : fallback.x;
    const naturalY = bounds ? snap(bounds.minY - 84) : fallback.y;
    const naturalWidth = bounds
      ? Math.max(compactSubjectWidth, snapUp(bounds.maxX) - naturalX + 84)
      : compactSubjectWidth;
    const naturalHeight = bounds
      ? Math.max(compactSubjectHeight, snapUp(bounds.maxY) - naturalY + 84)
      : compactSubjectHeight;
    return [{
      region: {
        id,
        title: customization.title ?? subject.title,
        subjectId: subject.id,
      },
      nodeId: id,
      variant: "subject" as const,
      level: customization.level ?? "subject",
      memberIds: members.map(({ id: landmarkId }) => landmarkId),
      x: customization.x ?? naturalX,
      y: customization.y ?? naturalY,
      width: customization.width ?? naturalWidth,
      height: customization.height ?? naturalHeight,
      color: customization.color ?? subject.accent,
      shape: customization.shape ?? "rectangle",
      borderStyle: customization.borderStyle ?? "solid",
      borderWeight: customization.borderWeight ?? defaultGroupBorderWeight(customization.level ?? "subject"),
      fillOpacity: customization.fillOpacity ?? defaultGroupFillOpacity(customization.level ?? "subject"),
      titlePosition: customization.titlePosition ?? "top-left",
      titleFontSize: customization.titleFontSize ?? DEFAULT_GROUP_TITLE_FONT_SIZE,
    }];
  });
}

function relationVisualEndpoints(connection: Connection, override: ConnectionCustomization) {
  if (override.source && override.target) return { source: override.source, target: override.target };
  const reverseForLearning = connection.kind === "requires" || connection.kind === "uses";
  return reverseForLearning
    ? { source: connection.target, target: connection.source }
    : { source: connection.source, target: connection.target };
}

function marker(color: string) {
  return {
    type: MarkerType.ArrowClosed,
    color,
    width: 16,
    height: 16,
    markerUnits: "userSpaceOnUse" as const,
  };
}

/**
 * Legacy note relationships do not store handles. Give them a deterministic
 * cardinal pair so React Flow terminates the path on the actual shape frame,
 * rather than falling back to a node-boundary approximation.
 */
function inferredConnectionHandles(
  source: string,
  target: string,
  centersById: ReadonlyMap<string, readonly [number, number]>,
) {
  const sourceCenter = centersById.get(source);
  const targetCenter = centersById.get(target);
  if (!sourceCenter || !targetCenter) return undefined;
  const deltaX = targetCenter[0] - sourceCenter[0];
  const deltaY = targetCenter[1] - sourceCenter[1];

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? ["right", "left"] as const
      : ["left", "right"] as const;
  }
  return deltaY >= 0
    ? ["bottom", "top"] as const
    : ["top", "bottom"] as const;
}

function connectionEdge(
  id: string,
  source: string,
  target: string,
  customization: ConnectionCustomization,
  defaults: {
    label?: string;
    lineStyle: ConnectionLineStyle;
    handles?: readonly [string, string];
  },
  visibleIds: Set<string>,
  selected: boolean,
): CachedEdge | undefined {
  if (customization.hidden || !visibleIds.has(source) || !visibleIds.has(target)) return undefined;
  const color = customization.color ?? neutralConnectionColor;
  const direction = customization.direction ?? "forward";
  const lineStyle = customization.lineStyle ?? defaults.lineStyle;
  const pathStyle = customization.pathStyle ?? "smooth";
  const label = customization.label ?? defaults.label ?? "";
  const sourceHandle = customization.sourceHandle ?? defaults.handles?.[0];
  const targetHandle = customization.targetHandle ?? defaults.handles?.[1];
  const signature = [
    source,
    sourceHandle ?? "",
    target,
    targetHandle ?? "",
    color,
    direction,
    lineStyle,
    pathStyle,
    label,
    selected ? "1" : "0",
  ].join("\u001f");
  return { signature, edge: {
    id,
    className: "atlas-edge",
    zIndex: selected ? selectedConnectionZIndex : edgeZIndex,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: pathStyle === "straight" ? "straight" : pathStyle === "curve" ? "default" : "smoothstep",
    selected,
    focusable: true,
    reconnectable: true,
    interactionWidth: 22,
    ariaLabel: label ? `Connection: ${label}` : "Mathematical connection",
    ...(direction === "reverse" || direction === "both" ? { markerStart: marker(color) } : {}),
    ...(direction === "forward" || direction === "both" ? { markerEnd: marker(color) } : {}),
    ...(label ? {
      label,
      labelShowBg: true,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 0,
      labelBgStyle: { fill: "#FFFFFF", fillOpacity: .96, stroke: selected ? "#111111" : "#888888", strokeWidth: 1 },
      labelStyle: { fill: "#171717", fontSize: 11, fontWeight: 600, fontFamily: '"Times New Roman", Times, serif' },
    } : {}),
    style: {
      stroke: color,
      strokeWidth: selected ? 2.4 : 1.45,
      strokeDasharray: lineDash[lineStyle],
      strokeLinecap: "square",
      strokeLinejoin: "miter",
      opacity: selected ? 1 : .88,
    },
  } };
}

function sameMemberIds(left: readonly string[], right: readonly string[]) {
  return left === right || (
    left.length === right.length && left.every((id, index) => id === right[index])
  );
}

function sameNodeData(left: AtlasGraphNode, right: AtlasGraphNode) {
  if (isLandmarkNode(left) && isLandmarkNode(right)) {
    return left.data.landmark === right.data.landmark &&
      left.data.color === right.data.color &&
      left.data.shape === right.data.shape &&
      left.data.contentMode === right.data.contentMode &&
      left.data.formulaIndex === right.data.formulaIndex &&
      left.data.frameWidth === right.data.frameWidth &&
      left.data.frameHeight === right.data.frameHeight &&
      left.data.previewMarkdown === right.data.previewMarkdown &&
      left.data.autoEditNote === right.data.autoEditNote &&
      left.data.cancelToken === right.data.cancelToken &&
      left.data.selectionEmphasis === right.data.selectionEmphasis &&
      left.data.onRequestSelection === right.data.onRequestSelection &&
      left.data.onDirectGestureStart === right.data.onDirectGestureStart &&
      left.data.onDirectGestureEnd === right.data.onDirectGestureEnd &&
      left.data.onMovePointerDown === right.data.onMovePointerDown &&
      left.data.onBeginNoteEdit === right.data.onBeginNoteEdit &&
      left.data.onSaveNote === right.data.onSaveNote &&
      left.data.onResizeEnd === right.data.onResizeEnd &&
      left.data.searchEmphasis === right.data.searchEmphasis;
  }
  if (isRegionNode(left) && isRegionNode(right)) {
    return left.data.regionId === right.data.regionId &&
      left.data.title === right.data.title &&
      sameMemberIds(left.data.memberIds, right.data.memberIds) &&
      left.data.variant === right.data.variant &&
      left.data.level === right.data.level &&
      left.data.color === right.data.color &&
      left.data.shape === right.data.shape &&
      left.data.borderStyle === right.data.borderStyle &&
      left.data.borderWeight === right.data.borderWeight &&
      left.data.fillOpacity === right.data.fillOpacity &&
      left.data.titlePosition === right.data.titlePosition &&
      left.data.titleFontSize === right.data.titleFontSize &&
      left.data.cancelToken === right.data.cancelToken &&
      left.data.onRequestSelection === right.data.onRequestSelection &&
      left.data.onDirectGestureStart === right.data.onDirectGestureStart &&
      left.data.onDirectGestureEnd === right.data.onDirectGestureEnd &&
      left.data.onTitleDragStart === right.data.onTitleDragStart &&
      left.data.onTitleDrag === right.data.onTitleDrag &&
      left.data.onTitleDragEnd === right.data.onTitleDragEnd &&
      left.data.onTitleDragCancel === right.data.onTitleDragCancel &&
      left.data.onResizeEnd === right.data.onResizeEnd &&
      left.data.onRequestContextMenu === right.data.onRequestContextMenu;
  }
  return false;
}

function reconcileRuntimeNodes(
  currentNodes: AtlasGraphNode[],
  blueprints: readonly AtlasGraphNode[],
  preserveGeometryIds?: ReadonlySet<string>,
) {
  let changed = currentNodes.length !== blueprints.length;
  let currentById: Map<string, AtlasGraphNode> | undefined;
  const nextNodes = blueprints.map((blueprint, index) => {
    let current: AtlasGraphNode | undefined = currentNodes[index];
    if (!current || current.id !== blueprint.id) {
      currentById ??= new Map(currentNodes.map((node) => [node.id, node]));
      current = currentById.get(blueprint.id);
    }
    if (!current || current.type !== blueprint.type) {
      changed = true;
      return blueprint;
    }
    const preserveGeometry = Boolean(
      current.dragging ||
      current.resizing ||
      preserveGeometryIds?.has(current.id)
    );
    const position = preserveGeometry ? current.position : blueprint.position;
    const width = preserveGeometry ? current.width : blueprint.width;
    const height = preserveGeometry ? current.height : blueprint.height;
    const selected = blueprint.selected;
    const dataMatches = sameNodeData(current, blueprint);
    const matches =
      current.position.x === position.x &&
      current.position.y === position.y &&
      current.width === width &&
      current.height === height &&
      current.selected === selected &&
      current.zIndex === blueprint.zIndex &&
      current.dragHandle === blueprint.dragHandle &&
      current.draggable === blueprint.draggable &&
      current.selectable === blueprint.selectable &&
      current.focusable === blueprint.focusable &&
      current.connectable === blueprint.connectable &&
      current.deletable === blueprint.deletable &&
      dataMatches;
    if (matches) return current;
    changed = true;
    return {
      ...current,
      ...blueprint,
      position,
      width,
      height,
      selected,
      data: dataMatches ? current.data : blueprint.data,
    } as AtlasGraphNode;
  });
  return changed ? nextNodes : currentNodes;
}

export function AtlasGraph({
  snapshot,
  landmarks,
  groupLandmarks,
  selectedLandmarkId,
  selectedContentPath,
  previewMarkdownByLandmarkId,
  autoEditNoteId,
  searchMatchIds,
  viewportStorageKey,
  externalViewport,
  onViewportChange,
  deferInitialViewport = false,
  viewportScaleFactor = 1,
  desktopSurfaceId,
  desktopCanvasDrag,
  onDesktopCanvasDrag,
  placementOverrides,
  customizations,
  onSelectLandmark,
  onClearActiveSelection,
  onPlacementChange,
  onPlacementChanges,
  onLandmarkResize,
  onKindChange,
  onCustomizationsChange,
  onBeginNoteEdit,
  onSaveNote,
  onCreateLandmark,
  onPlaceNote,
  onPlaceNotes,
  onRemoveCanvasObjects,
}: AtlasGraphProps) {
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const externalSelectionPath = repositoryPath(selectedContentPath)?.toLocaleLowerCase();
  const externalSelectionKey = `${selectedLandmarkId ?? ""}\u0000${externalSelectionPath ?? ""}`;
  const externalSelectionKeyRef = useRef(externalSelectionKey);
  const preserveMenuForExternalSelectionKeyRef = useRef<string | undefined>(undefined);
  const explicitlyClearedExternalSelectionKeyRef = useRef<string | undefined>(undefined);
  const previousSelectedCanvasNodeIdsRef = useRef<ReadonlySet<string>>(selectedCanvasNodeIds);
  const activeCanvasLandmarkRef = useRef<string | undefined>(undefined);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const selectedConnectionId = [...selectedConnectionIds][selectedConnectionIds.size - 1];
  const [zoomTier, setZoomTier] = useState<CanvasZoomTier>("mid");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [interactionCancelToken, setInteractionCancelToken] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const [connectionSourceNodeId, setConnectionSourceNodeId] = useState<string>();
  const [menu, setMenu] = useState<AtlasMenuState>();
  const [landmarkCreationKind, setLandmarkCreationKind] = useState<EditableLandmarkKind>();
  const [informalNotePending, setInformalNotePending] = useState(false);
  const [informalNoteError, setInformalNoteError] = useState<string>();
  const [groupCreationLevel, setGroupCreationLevel] = useState<GroupLevel>();
  const [menuPanel, setMenuPanel] = useState<AtlasContextPanel>("kind");
  const [copiedColor, setCopiedColor] = useState<string>();
  const [groupSurfacePreview, setGroupSurfacePreview] = useState<{
    regionId: string;
    fillOpacity: number;
  }>();
  const [movementGuides, setMovementGuides] = useState<readonly CanvasSnapGuide[]>([]);
  const landmarkCreationAttemptRef = useRef(0);
  const flowRef = useRef<ReactFlowInstance<AtlasGraphNode, Edge> | undefined>(undefined);
  const initialViewSetRef = useRef(false);
  const viewportReadyRef = useRef(false);
  const initializingViewportRef = useRef(false);
  const viewportGestureRef = useRef(false);
  const applyingExternalViewportRef = useRef<Viewport | undefined>(undefined);
  const pendingExternalViewportRef = useRef<Viewport | undefined>(undefined);
  // The desktop prop is the latest camera received from another surface. It
  // does not echo this surface's own pan/zoom, so it can legitimately be older
  // than the viewport currently on screen. Track actual prop changes instead
  // of treating a drag-state transition as a new remote camera.
  const lastExternalViewportRef = useRef<Viewport | undefined>(externalViewport);
  const groupDragRef = useRef<GroupDragState | undefined>(undefined);
  const selectionMoveRef = useRef<CanvasSelectionMoveState | undefined>(undefined);
  const groupDragPreviewRef = useRef<GroupDragPreview | undefined>(undefined);
  const groupDragFrameRef = useRef<number | undefined>(undefined);
  const activeNodeDragRef = useRef<LandmarkDragState | undefined>(undefined);
  const movementAssistRef = useRef<CanvasMovementAssistRuntime | undefined>(undefined);
  const movementGuideSignatureRef = useRef("");
  const movementGestureSequenceRef = useRef(0);
  const pendingLandmarkPointerRef = useRef<{
    nodeId: string;
    pointerId: number;
    clientX: number;
    clientY: number;
  } | undefined>(undefined);
  const activeDirectGestureRef = useRef<{ nodeId: string } | undefined>(undefined);
  const cancelledNodeDragsRef = useRef(new Set<string>());
  const cancelledNodeDragStatesRef = useRef(new Map<string, LandmarkDragState>());
  const desktopDragRef = useRef<DesktopDragRuntime | undefined>(undefined);
  const finishedDesktopGesturesRef = useRef(new Set<string>());
  const edgeCacheRef = useRef<Map<string, CachedEdge>>(new Map());
  const edgeListRef = useRef<Edge[]>([]);
  const searchEdgeCacheRef = useRef<Map<string, CachedSearchEdge>>(new Map());
  const searchEdgeListRef = useRef<Edge[]>([]);
  const customGroupMembershipCacheRef = useRef<Map<string, CachedCustomGroupMembership>>(new Map());
  // React Flow announces a candidate through onConnect before onConnectEnd. We
  // deliberately commit only after the final state confirms an actual handle.
  // This prevents blank-space releases and click-to-connect cancellation from
  // being interpreted as new mathematical relationships.
  const pendingConnectionRef = useRef<FlowConnection | undefined>(undefined);
  const cancelledConnectionRef = useRef(false);
  // Edge reconnection shares React Flow's connection lifecycle. Keeping the
  // gesture separate ensures its onConnectEnd can never commit a second edge.
  const reconnectGestureRef = useRef<string | undefined>(undefined);
  // Keep a cancelled updater mounted until React Flow has observed pointer-up.
  // Unselecting it while it still owns pointer capture can strand the library's
  // reconnect state and make the next endpoint drag inert.
  const cancelledReconnectRef = useRef(false);
  const titleDragHandlersRef = useRef<{
    start: (
      regionId: string,
      startClientX: number,
      startClientY: number,
      clientX: number,
      clientY: number,
      shiftKey?: boolean,
      altKey?: boolean,
    ) => void;
    move: (
      regionId: string,
      deltaX: number,
      deltaY: number,
      clientX: number,
      clientY: number,
      shiftKey?: boolean,
      altKey?: boolean,
    ) => void;
    end: (
      regionId: string,
      deltaX: number,
      deltaY: number,
      clientX: number,
      clientY: number,
      shiftKey?: boolean,
      altKey?: boolean,
    ) => void;
    cancel: (regionId: string) => void;
  } | undefined>(undefined);

  // Load the pure drafting resolver just after the first paint. Pointer-over
  // remains a second prewarm path, but correctness no longer depends on how
  // quickly the first drag begins after entering the canvas.
  useEffect(() => {
    void prepareCanvasMovementAssist();
  }, []);

  const clearConnectionSelection = useCallback(() => {
    setSelectedConnectionIds((current) => current.size ? new Set() : current);
  }, []);

  const clearCanvasNodeSelection = useCallback(() => {
    setSelectedCanvasNodeIds((current) => current.size ? new Set() : current);
  }, []);

  const clearActiveShellSelection = useCallback((preserveMenu = false) => {
    // Prevent the selection-transition observer below from emitting a second
    // clear after an explicit pane/group/edge action.
    const activeExternalSelectionKey = externalSelectionKeyRef.current;
    if (activeExternalSelectionKey !== "\u0000") {
      explicitlyClearedExternalSelectionKeyRef.current = activeExternalSelectionKey;
    }
    if (preserveMenu) preserveMenuForExternalSelectionKeyRef.current = "\u0000";
    activeCanvasLandmarkRef.current = undefined;
    onClearActiveSelection?.();
  }, [onClearActiveSelection]);

  const requestCanvasNodeSelection = useCallback((
    nodeId: string,
    mode: "replace" | "add" | "remove",
  ) => {
    setMenu(undefined);
    setSelectedCanvasNodeIds((current) => {
      if (mode === "replace") {
        return current.size === 1 && current.has(nodeId)
          ? current
          : new Set([nodeId]);
      }
      const next = new Set(current);
      if (mode === "add") next.add(nodeId);
      else next.delete(nodeId);
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next;
    });
    if (mode === "replace") clearConnectionSelection();
  }, [clearConnectionSelection]);

  const beginDirectGesture = useCallback((nodeId: string) => {
    activeDirectGestureRef.current = { nodeId };
    setMenu(undefined);
    setIsNodeDragging(true);
  }, []);

  const endDirectGesture = useCallback((nodeId: string) => {
    if (activeDirectGestureRef.current?.nodeId !== nodeId) return;
    activeDirectGestureRef.current = undefined;
    setIsNodeDragging(false);
  }, []);

  const rememberLandmarkPointerDown = useCallback((
    nodeId: string,
    pointerId: number,
    clientX: number,
    clientY: number,
  ) => {
    pendingLandmarkPointerRef.current = {
      nodeId,
      pointerId,
      clientX,
      clientY,
    };
  }, []);

  const beginNoteEdit = useCallback((landmark: Landmark) => {
    setMenu(undefined);
    clearConnectionSelection();
    (onBeginNoteEdit ?? onSelectLandmark)(landmark);
  }, [clearConnectionSelection, onBeginNoteEdit, onSelectLandmark]);

  const selectOnlyConnection = useCallback((id: string) => {
    setSelectedConnectionIds(new Set([id]));
  }, []);

  const menuIdentity = menu
    ? `${menu.kind}:${menu.kind === "landmark" ? menu.landmarkId : menu.kind === "group" ? menu.regionId : menu.kind === "connection" ? menu.connectionId : "canvas"}`
    : "closed";

  useEffect(() => {
    setGroupSurfacePreview(undefined);
    if (!menu) return;
    if (menu.kind === "landmark") setMenuPanel("kind");
    else if (menu.kind === "group") setMenuPanel("level");
    else if (menu.kind === "connection") setMenuPanel("direction");
  }, [menuIdentity]);

  const zoneDefaults = useMemo(() => buildSubjectZoneDefaults(snapshot.subjects), [snapshot.subjects]);
  const visibleLandmarks = useMemo(
    () => landmarks.filter((landmark) => customizations.landmarks[landmark.id]?.hidden !== true),
    [customizations.landmarks, landmarks],
  );
  const visibleGroupLandmarks = useMemo(
    () => groupLandmarks.filter((landmark) => customizations.landmarks[landmark.id]?.hidden !== true),
    [customizations.landmarks, groupLandmarks],
  );
  const customLandmarkById = useMemo(() => new Map(customizations.customLandmarks.map((landmark) => [landmark.id, landmark])), [customizations.customLandmarks]);
  // File-backed canvas instances have an independent life from structure.
  // Changing a dropped Note to Definition/Theorem/etc. must change only that
  // instance, never manufacture a legacy subject or region around it. Explicit
  // custom groups still use every visible landmark below, so all kinds continue
  // to participate in deliberately authored spatial groups.
  const legacyDerivedGroupLandmarks = useMemo(
    () => visibleGroupLandmarks.filter((landmark) => !customLandmarkById.has(landmark.id)),
    [customLandmarkById, visibleGroupLandmarks],
  );
  const allLandmarkById = useMemo(() => new Map(visibleGroupLandmarks.map((landmark) => [landmark.id, landmark])), [visibleGroupLandmarks]);
  useEffect(() => {
    if (externalSelectionKeyRef.current === externalSelectionKey) return;
    const previousExternalSelectionKey = externalSelectionKeyRef.current;
    externalSelectionKeyRef.current = externalSelectionKey;
    const preserveMenu = preserveMenuForExternalSelectionKeyRef.current === externalSelectionKey;
    preserveMenuForExternalSelectionKeyRef.current = undefined;
    const preserveCanvasSelection = externalSelectionKey === "\u0000" &&
      explicitlyClearedExternalSelectionKeyRef.current === previousExternalSelectionKey;
    explicitlyClearedExternalSelectionKeyRef.current = undefined;
    if (preserveCanvasSelection) {
      if (!preserveMenu) setMenu(undefined);
      return;
    }
    const selectedPath = externalSelectionPath;
    const externalStillOwnsCanvasNode = [...selectedCanvasNodeIds].some((id) => {
      const landmark = allLandmarkById.get(id);
      if (!landmark) return false;
      if (selectedLandmarkId) return landmark.id === selectedLandmarkId;
      return Boolean(selectedPath) &&
        repositoryPath(landmark.contentPath)?.toLocaleLowerCase() === selectedPath;
    });
    if (externalStillOwnsCanvasNode) return;
    clearCanvasNodeSelection();
    clearConnectionSelection();
    if (!preserveMenu) setMenu(undefined);
  }, [allLandmarkById, clearCanvasNodeSelection, clearConnectionSelection, externalSelectionKey, externalSelectionPath, selectedCanvasNodeIds, selectedLandmarkId]);

  useEffect(() => {
    const previousSelection = previousSelectedCanvasNodeIdsRef.current;
    previousSelectedCanvasNodeIdsRef.current = selectedCanvasNodeIds;
    if (externalSelectionKey === "\u0000") {
      activeCanvasLandmarkRef.current = undefined;
      return;
    }
    const activeStillSelected = [...selectedCanvasNodeIds].some((id) => {
      const landmark = allLandmarkById.get(id);
      if (!landmark) return false;
      if (selectedLandmarkId) return landmark.id === selectedLandmarkId;
      return Boolean(externalSelectionPath) &&
        repositoryPath(landmark.contentPath)?.toLocaleLowerCase() === externalSelectionPath;
    });
    const previouslyOwnedKey = activeCanvasLandmarkRef.current;
    activeCanvasLandmarkRef.current = activeStillSelected ? externalSelectionKey : undefined;
    const replacedExternalEmphasis = previousSelection.size === 0 &&
      selectedCanvasNodeIds.size > 0 &&
      !activeStillSelected;
    const explicitClearPending = explicitlyClearedExternalSelectionKeyRef.current === externalSelectionKey;
    if (!explicitClearPending && (
      (previouslyOwnedKey === externalSelectionKey && !activeStillSelected) ||
      replacedExternalEmphasis
    )) {
      clearActiveShellSelection();
    }
  }, [allLandmarkById, clearActiveShellSelection, externalSelectionKey, externalSelectionPath, selectedCanvasNodeIds, selectedLandmarkId]);
  const landmarksBySubject = useMemo(
    () => buildLandmarksBySubject(legacyDerivedGroupLandmarks),
    [legacyDerivedGroupLandmarks],
  );
  const landmarkDimensions = useMemo(() => new Map(visibleGroupLandmarks.map((landmark) => {
    const persisted = customizations.landmarks[landmark.id];
    const custom = customLandmarkById.get(landmark.id);
    return [landmark.id, {
      width: Math.max(112, persisted?.width ?? custom?.width ?? LANDMARK_WIDTH),
      height: Math.max(56, persisted?.height ?? custom?.height ?? LANDMARK_HEIGHT),
    }] as const;
  })), [customLandmarkById, customizations.landmarks, visibleGroupLandmarks]);

  const resolvedPlacements = useMemo(() => {
    const placements = new Map<string, Placement>();
    snapshot.placements.forEach((placement) => {
      const landmark = allLandmarkById.get(placement.landmarkId);
      const subjectId = landmark ? primarySubjectId(landmark) : undefined;
      placements.set(placement.landmarkId, {
        landmarkId: placement.landmarkId,
        // Smart alignment can intentionally land between grid columns (for
        // example when an odd-grid landmark is centred in an even-grid
        // group). Preserve authored geometry here; ordinary drags still use
        // the dot grid as their fallback in the movement resolver.
        x: placement.x + (subjectId ? zoneDefaults.get(subjectId)?.x ?? 0 : 0),
        y: placement.y,
      });
    });
    customizations.customLandmarks.forEach((landmark) => {
      placements.set(landmark.id, { landmarkId: landmark.id, x: landmark.x, y: landmark.y });
    });
    const unplacedBySubject = new Map<SubjectId, number>();
    visibleGroupLandmarks.forEach((landmark) => {
      if (placements.has(landmark.id)) return;
      const subjectId = primarySubjectId(landmark);
      if (!subjectId) return;
      const index = unplacedBySubject.get(subjectId) ?? 0;
      unplacedBySubject.set(subjectId, index + 1);
      placements.set(landmark.id, {
        landmarkId: landmark.id,
        x: (zoneDefaults.get(subjectId)?.x ?? 0) + 84 + (index % 7) * 252,
        y: 1092 - Math.floor(index / 7) * 140,
      });
    });
    placementOverrides.forEach((placement) => placements.set(placement.landmarkId, {
      landmarkId: placement.landmarkId,
      x: placement.x,
      y: placement.y,
    }));
    return placements;
  }, [allLandmarkById, customizations.customLandmarks, placementOverrides, snapshot.placements, visibleGroupLandmarks, zoneDefaults]);

  // Appearance-only group changes used to repeat every shape containment test
  // across the complete vault. Retain exact member arrays while geometry,
  // placements, landmark dimensions, and the landmark model are unchanged.
  const customGroupMemberships = useMemo(() => {
    const previous = customGroupMembershipCacheRef.current;
    const next = new Map<string, CachedCustomGroupMembership>();
    const rawMemberships = new Map<string, string[]>();
    customizations.customGroups.forEach((group) => {
      const shape = resolveGroupShape(group.level ?? "group", group.shape);
      const geometrySignature = customGroupGeometrySignature({ ...group, shape });
      const cached = previous.get(group.id);
      if (
        cached?.geometrySignature === geometrySignature &&
        cached.placements === resolvedPlacements &&
        cached.dimensions === landmarkDimensions &&
        cached.landmarks === visibleGroupLandmarks
      ) {
        next.set(group.id, cached);
        rawMemberships.set(group.id, cached.memberIds);
        return;
      }
      const memberIds = visibleGroupLandmarks.flatMap((landmark) => {
        const position = resolvedPlacements.get(landmark.id);
        if (!position) return [];
        const dimensions = landmarkDimensions.get(landmark.id) ?? {
          width: LANDMARK_WIDTH,
          height: LANDMARK_HEIGHT,
        };
        const centerX = position.x + dimensions.width / 2;
        const centerY = position.y + dimensions.height / 2;
        return objectShapeContainsPoint(
          shape,
          (centerX - group.x) / group.width,
          (centerY - group.y) / group.height,
        ) ? [landmark.id] : [];
      });
      const entry = {
        geometrySignature,
        placements: resolvedPlacements,
        dimensions: landmarkDimensions,
        landmarks: visibleGroupLandmarks,
        memberIds,
      };
      next.set(group.id, entry);
      rawMemberships.set(group.id, memberIds);
    });
    customGroupMembershipCacheRef.current = next;
    // A landmark has one direct spatial owner. Overlapping siblings previously
    // both captured it, so dragging either group could move the same nearby
    // note. Prefer the deepest level, then the smallest/topmost territory;
    // parent drags still receive descendants through the explicit hierarchy
    // closure in captureGroupDrag.
    const levelRank: Record<GroupLevel, number> = {
      subject: 0,
      group: 1,
      subgroup: 2,
    };
    const customGroupById = new Map(
      customizations.customGroups.map((group) => [group.id, group]),
    );
    const candidatesByLandmark = new Map<string, string[]>();
    rawMemberships.forEach((memberIds, groupId) => {
      memberIds.forEach((landmarkId) => {
        const candidates = candidatesByLandmark.get(landmarkId);
        if (candidates) candidates.push(groupId);
        else candidatesByLandmark.set(landmarkId, [groupId]);
      });
    });
    const memberships = new Map(
      customizations.customGroups.map(({ id }) => [id, [] as string[]]),
    );
    candidatesByLandmark.forEach((candidateIds, landmarkId) => {
      const ownerId = candidateIds.sort((leftId, rightId) => {
        const left = customGroupById.get(leftId);
        const right = customGroupById.get(rightId);
        if (!left || !right) return leftId.localeCompare(rightId);
        const depthDifference = levelRank[right.level ?? "group"] - levelRank[left.level ?? "group"];
        if (depthDifference) return depthDifference;
        const areaDifference = left.width * left.height - right.width * right.height;
        return areaDifference || leftId.localeCompare(rightId);
      })[0];
      if (ownerId) memberships.get(ownerId)?.push(landmarkId);
    });
    return memberships;
  }, [customizations.customGroups, landmarkDimensions, resolvedPlacements, visibleGroupLandmarks]);

  const groups = useMemo(() => {
    const subjectGroups = buildSubjectGroups(snapshot, landmarksBySubject, resolvedPlacements, landmarkDimensions, customizations.groups, zoneDefaults);
    const regionGroups = buildRegionGroups(snapshot, landmarksBySubject, resolvedPlacements, landmarkDimensions, customizations.groups);
    const customGroups: GroupDescriptor[] = customizations.customGroups.map((group) => {
      const level = group.level ?? "group";
      const memberIds = customGroupMemberships.get(group.id) ?? [];
      return {
        region: { id: group.id, title: group.title, subjectId: group.subjectId },
        nodeId: `custom-group:${group.id}`,
        variant: "custom",
        level,
        parentId: group.parentId ?? (
          level === "subject" ? undefined : subjectZoneKey(group.subjectId)
        ),
        memberIds,
        x: group.x,
        y: group.y,
        width: Math.max(GROUP_MIN_WIDTH, snap(group.width)),
        height: Math.max(GROUP_MIN_HEIGHT, snap(group.height)),
        color: group.color,
        shape: group.shape,
        borderStyle: group.borderStyle ?? "solid",
        borderWeight: group.borderWeight ?? defaultGroupBorderWeight(level),
        fillOpacity: group.fillOpacity ?? defaultGroupFillOpacity(level),
        titlePosition: group.titlePosition ?? "top-left",
        titleFontSize: group.titleFontSize ?? DEFAULT_GROUP_TITLE_FONT_SIZE,
        subjectFrameStyle: group.subjectFrameStyle,
      };
    });
    const levelOrder: Record<GroupLevel, number> = { subject: 0, group: 1, subgroup: 2 };
    return [...subjectGroups, ...regionGroups, ...customGroups].map((group) => {
      const shape = resolveGroupShape(group.level, group.shape);
      const resolvedGroup = shape === group.shape ? group : { ...group, shape };
      return groupSurfacePreview?.regionId === group.region.id
        ? { ...resolvedGroup, fillOpacity: groupSurfacePreview.fillOpacity }
        : resolvedGroup;
    }).sort((left, right) => {
      const levelDifference = levelOrder[left.level] - levelOrder[right.level];
      if (levelDifference) return levelDifference;
      if (left.level === "subject") return left.x - right.x || left.y - right.y || left.nodeId.localeCompare(right.nodeId);
      return right.width * right.height - left.width * left.height || left.nodeId.localeCompare(right.nodeId);
    });
  }, [customGroupMemberships, customizations.customGroups, customizations.groups, groupSurfacePreview, landmarkDimensions, landmarksBySubject, resolvedPlacements, snapshot, zoneDefaults]);

  const groupByRegionId = useMemo(() => new Map(groups.map((group) => [group.region.id, group])), [groups]);

  const changeGroupAppearances = useCallback((
    requested: readonly (readonly [string, GroupCustomization])[],
  ) => {
    const patches = requested.filter(([regionId, patch]) => {
      const descriptor = groupByRegionId.get(regionId);
      if (!descriptor) return false;
      return patchChanges({
        level: descriptor.level,
        title: descriptor.region.title,
        x: descriptor.x,
        y: descriptor.y,
        width: descriptor.width,
        height: descriptor.height,
        color: descriptor.color,
        shape: descriptor.shape,
        borderStyle: descriptor.borderStyle,
        borderWeight: descriptor.borderWeight,
        fillOpacity: descriptor.fillOpacity,
        titlePosition: descriptor.titlePosition,
        titleFontSize: descriptor.titleFontSize,
      }, patch);
    });
    if (!patches.length) return;
    onCustomizationsChange((current) => {
      let changed = false;
      let customGroups = current.customGroups;
      let groupsRecord = current.groups;
      patches.forEach(([regionId, patch]) => {
        const index = customGroups.findIndex(({ id }) => id === regionId);
        if (index >= 0) {
          const existing = customGroups[index];
          if (!patchChanges(existing, patch)) return;
          if (customGroups === current.customGroups) customGroups = [...customGroups];
          customGroups[index] = { ...existing, ...patch };
          changed = true;
          return;
        }
        const existing = groupsRecord[regionId];
        if (!patchChanges(existing, patch)) return;
        if (groupsRecord === current.groups) groupsRecord = { ...groupsRecord };
        groupsRecord[regionId] = { ...existing, ...patch };
        changed = true;
      });
      return changed ? { ...current, customGroups, groups: groupsRecord } : current;
    });
  }, [groupByRegionId, onCustomizationsChange]);

  const changeGroupAppearance = useCallback((regionId: string, patch: GroupCustomization) => {
    changeGroupAppearances([[regionId, patch]]);
  }, [changeGroupAppearances]);

  const changeGroupLevel = useCallback((regionId: string, level: GroupLevel) => {
    const descriptor = groupByRegionId.get(regionId);
    if (!descriptor) return;
    if (descriptor.level === level) return;
    if (descriptor.variant !== "custom") {
      changeGroupAppearance(regionId, { level });
      return;
    }

    const center = { x: descriptor.x + descriptor.width / 2, y: descriptor.y + descriptor.height / 2 };
    const requiredParentLevel = level === "group" ? "subject" : level === "subgroup" ? "group" : undefined;
    const createsCycle = (candidate: GroupDescriptor) => {
      const seen = new Set<string>();
      let current: GroupDescriptor | undefined = candidate;
      while (current && !seen.has(current.region.id)) {
        if (current.region.id === regionId) return true;
        seen.add(current.region.id);
        current = current.parentId ? groupByRegionId.get(current.parentId) : undefined;
      }
      return false;
    };
    const parent = requiredParentLevel
      ? groups.filter((candidate) =>
          candidate.region.id !== regionId &&
          candidate.level === requiredParentLevel &&
          !createsCycle(candidate) &&
          objectShapeContainsPoint(
            candidate.shape,
            (center.x - candidate.x) / candidate.width,
            (center.y - candidate.y) / candidate.height,
          )
        ).sort((left, right) => left.width * left.height - right.width * right.height)[0]
      : undefined;

    onCustomizationsChange((current) => {
      const index = current.customGroups.findIndex(({ id }) => id === regionId);
      if (index < 0) return current;
      const existing = current.customGroups[index];
      const nextParentId = parent?.region.id;
      if (existing.level === level && existing.parentId === nextParentId) return current;
      const { parentId: _discarded, ...withoutParent } = existing;
      const customGroups = [...current.customGroups];
      customGroups[index] = {
        ...withoutParent,
        level,
        ...(nextParentId ? { parentId: nextParentId } : {}),
      };
      return { ...current, customGroups };
    });
  }, [changeGroupAppearance, groupByRegionId, groups, onCustomizationsChange]);

  const changeLandmarkAppearance = useCallback((landmarkId: string, patch: LandmarkCustomization) => {
    const existing = customizations.customLandmarks.find(({ id }) => id === landmarkId) ??
      customizations.landmarks[landmarkId];
    if (existing && !patchChanges(existing, patch)) return;
    onCustomizationsChange((current) => {
      const index = current.customLandmarks.findIndex(({ id }) => id === landmarkId);
      if (index >= 0) {
        if (!patchChanges(current.customLandmarks[index], patch)) return current;
        const customLandmarks = [...current.customLandmarks];
        customLandmarks[index] = { ...customLandmarks[index], ...patch };
        return { ...current, customLandmarks };
      }
      if (!patchChanges(current.landmarks[landmarkId], patch)) return current;
      return {
        ...current,
        landmarks: { ...current.landmarks, [landmarkId]: { ...current.landmarks[landmarkId], ...patch } },
      };
    });
  }, [customizations.customLandmarks, customizations.landmarks, onCustomizationsChange]);

  const resizeLandmark = useCallback((landmarkId: string, dimensions: ResizeParams) => {
    const bounds = {
      landmarkId,
      x: dimensions.x,
      y: dimensions.y,
      width: Math.max(112, dimensions.width),
      height: Math.max(56, dimensions.height),
    };
    if (onLandmarkResize) onLandmarkResize(bounds);
    else {
      onPlacementChange(bounds);
      changeLandmarkAppearance(landmarkId, {
        width: bounds.width,
        height: bounds.height,
      });
    }
  }, [changeLandmarkAppearance, onLandmarkResize, onPlacementChange]);

  const resizeGroup = useCallback((regionId: string, dimensions: ResizeParams) => {
    changeGroupAppearance(regionId, {
      x: dimensions.x,
      y: dimensions.y,
      width: Math.max(GROUP_MIN_WIDTH, dimensions.width),
      height: Math.max(GROUP_MIN_HEIGHT, dimensions.height),
    });
  }, [changeGroupAppearance]);

  const requestGroupContextMenu = useCallback((regionId: string, x: number, y: number) => {
    const nodeId = groupByRegionId.get(regionId)?.nodeId;
    if (nodeId && !selectedCanvasNodeIds.has(nodeId)) {
      clearActiveShellSelection(true);
      setSelectedCanvasNodeIds(new Set([nodeId]));
      clearConnectionSelection();
    }
    setMenu({ kind: "group", regionId, x, y });
  }, [clearActiveShellSelection, clearConnectionSelection, groupByRegionId, selectedCanvasNodeIds]);

  const startTitleDrag = useCallback((
    regionId: string,
    startClientX: number,
    startClientY: number,
    clientX: number,
    clientY: number,
    shiftKey?: boolean,
    altKey?: boolean,
  ) => titleDragHandlersRef.current?.start(
    regionId,
    startClientX,
    startClientY,
    clientX,
    clientY,
    shiftKey,
    altKey,
  ), []);
  const moveTitleDrag = useCallback((
    regionId: string,
    x: number,
    y: number,
    clientX: number,
    clientY: number,
    shiftKey?: boolean,
    altKey?: boolean,
  ) => titleDragHandlersRef.current?.move(regionId, x, y, clientX, clientY, shiftKey, altKey), []);
  const endTitleDrag = useCallback((
    regionId: string,
    x: number,
    y: number,
    clientX: number,
    clientY: number,
    shiftKey?: boolean,
    altKey?: boolean,
  ) => titleDragHandlersRef.current?.end(regionId, x, y, clientX, clientY, shiftKey, altKey), []);
  const cancelTitleDrag = useCallback((regionId: string) => {
    titleDragHandlersRef.current?.cancel(regionId);
  }, []);

  const subjectById = useMemo(
    () => new Map(snapshot.subjects.map((subject) => [subject.id, subject])),
    [snapshot.subjects],
  );
  const smallestGroupByLandmark = useMemo(() => {
    const smallestGroupByLandmark = new Map<string, GroupDescriptor>();
    [...groups].sort((a, b) => a.width * a.height - b.width * b.height).forEach((group) => {
      group.memberIds.forEach((id) => { if (!smallestGroupByLandmark.has(id)) smallestGroupByLandmark.set(id, group); });
    });
    return smallestGroupByLandmark;
  }, [groups]);

  const regionNodes = useMemo<RegionGraphNode[]>(() => groups.map((group) => ({
      id: group.nodeId,
      type: "region",
      position: { x: group.x, y: group.y },
      width: group.width,
      height: group.height,
      // Group movement has one owner: the visible nameplate. Letting the
      // native multi-node drag engine also own a region made a selected parent
      // jump when a neighbouring landmark was moved.
      draggable: false,
      selectable: true,
      selected: selectedCanvasNodeIds.has(group.nodeId),
      focusable: true,
      connectable: true,
      deletable: false,
      zIndex: groupZIndex[group.level],
      data: {
        regionId: group.region.id,
        title: group.region.title,
        memberIds: group.memberIds,
        variant: group.variant,
        level: group.level,
        color: group.color,
        shape: group.shape,
        frameWidth: group.width,
        frameHeight: group.height,
        borderStyle: group.borderStyle,
        borderWeight: group.borderWeight,
        fillOpacity: group.fillOpacity,
        titlePosition: group.titlePosition,
        titleFontSize: group.titleFontSize,
        subjectFrameStyle: group.subjectFrameStyle,
        cancelToken: interactionCancelToken,
        onRequestSelection: requestCanvasNodeSelection,
        onDirectGestureStart: beginDirectGesture,
        onDirectGestureEnd: endDirectGesture,
        onTitleDragStart: startTitleDrag,
        onTitleDrag: moveTitleDrag,
        onTitleDragEnd: endTitleDrag,
        onTitleDragCancel: cancelTitleDrag,
        onResizeEnd: resizeGroup,
        onRequestContextMenu: requestGroupContextMenu,
      },
    })), [beginDirectGesture, cancelTitleDrag, endDirectGesture, endTitleDrag, groups, interactionCancelToken, moveTitleDrag, requestCanvasNodeSelection, requestGroupContextMenu, resizeGroup, selectedCanvasNodeIds, startTitleDrag]);

  const baseLandmarkNodes = useMemo<LandmarkGraphNode[]>(() => visibleLandmarks.map((landmark, index) => {
      const placement = resolvedPlacements.get(landmark.id);
      const subject = subjectById.get(primarySubjectId(landmark));
      const containingGroup = smallestGroupByLandmark.get(landmark.id);
      const persisted = customizations.landmarks[landmark.id];
      const custom = customLandmarkById.get(landmark.id);
      const dimensions = landmarkDimensions.get(landmark.id) ?? { width: LANDMARK_WIDTH, height: LANDMARK_HEIGHT };
      return {
        id: landmark.id,
        type: "landmark",
        position: placement
          ? { x: placement.x, y: placement.y }
          : { x: (zoneDefaults.get(primarySubjectId(landmark))?.x ?? 0) + 84 + (index % 7) * 252, y: 1092 - Math.floor(index / 7) * 140 },
        width: dimensions.width,
        height: dimensions.height,
        selected: false,
        zIndex: landmarkZIndex,
        data: {
          landmark,
          color: persisted?.color ?? custom?.color ?? containingGroup?.color ?? subject?.accent ?? SUBJECT_RAINBOW_COLORS[primarySubjectId(landmark)] ?? "#333333",
          shape: persisted?.shape ?? custom?.shape ?? defaultLandmarkShape(landmark.kind),
          contentMode: persisted?.contentMode ?? custom?.contentMode ?? "title",
          formulaIndex: persisted?.formulaIndex ?? custom?.formulaIndex ?? 0,
          frameWidth: dimensions.width,
          frameHeight: dimensions.height,
          ...(previewMarkdownByLandmarkId?.has(landmark.id)
            ? { previewMarkdown: previewMarkdownByLandmarkId.get(landmark.id) }
            : {}),
          autoEditNote: landmark.id === autoEditNoteId,
          onBeginNoteEdit: beginNoteEdit,
          onSaveNote,
          cancelToken: interactionCancelToken,
          onRequestSelection: requestCanvasNodeSelection,
          onDirectGestureStart: beginDirectGesture,
          onDirectGestureEnd: endDirectGesture,
          onMovePointerDown: rememberLandmarkPointerDown,
          onResizeEnd: resizeLandmark,
        },
      };
    }), [autoEditNoteId, beginDirectGesture, beginNoteEdit, customLandmarkById, customizations.landmarks, endDirectGesture, interactionCancelToken, landmarkDimensions, onSaveNote, previewMarkdownByLandmarkId, rememberLandmarkPointerDown, requestCanvasNodeSelection, resizeLandmark, resolvedPlacements, smallestGroupByLandmark, subjectById, visibleLandmarks, zoneDefaults]);

  const searchLandmarkNodes = useMemo<LandmarkGraphNode[]>(() => {
    if (!searchMatchIds) return baseLandmarkNodes;
    return baseLandmarkNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        searchEmphasis: searchMatchIds.has(node.id) ? "match" : "muted",
      },
    }));
  }, [baseLandmarkNodes, searchMatchIds]);

  const normalizedSelectedContentPath = repositoryPath(selectedContentPath)?.toLocaleLowerCase();
  const landmarkNodes = useMemo<LandmarkGraphNode[]>(() => {
    let changed = false;
    const nextNodes = searchLandmarkNodes.map((node) => {
      const nodePath = repositoryPath(node.data.landmark.contentPath)?.toLocaleLowerCase();
      const selected = selectedCanvasNodeIds.has(node.id);
      const selectionEmphasis = selectedCanvasNodeIds.size === 0 && selectedConnectionIds.size === 0 && (
        node.id === selectedLandmarkId ||
        (!selectedLandmarkId && Boolean(normalizedSelectedContentPath) && nodePath === normalizedSelectedContentPath)
      );
      if (!selected && !selectionEmphasis) return node;
      changed = true;
      return {
        ...node,
        selected,
        zIndex: selectedLandmarkZIndex,
        ...(selectionEmphasis ? {
          data: { ...node.data, selectionEmphasis: true },
        } : {}),
      };
    });
    return changed ? nextNodes : searchLandmarkNodes;
  }, [normalizedSelectedContentPath, searchLandmarkNodes, selectedCanvasNodeIds, selectedConnectionIds, selectedLandmarkId]);

  const nodeBlueprints = useMemo<AtlasGraphNode[]>(
    () => [...regionNodes, ...landmarkNodes],
    [landmarkNodes, regionNodes],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<AtlasGraphNode>(nodeBlueprints);
  const handleNodesChange = useCallback<OnNodesChange<AtlasGraphNode>>((changes) => {
    onNodesChange(changes);
    const gestureOwnsPosition = Boolean(
      activeNodeDragRef.current ||
      activeDirectGestureRef.current ||
      groupDragRef.current ||
      (desktopDragRef.current && !desktopDragRef.current.ended)
    );
    if (!gestureOwnsPosition) {
      const keyboardChanges = changes.filter((change) => (
        change.type === "position" &&
        change.dragging === false &&
        Boolean(change.position)
      ));
      if (keyboardChanges.length) {
        const landmarkIds = new Set(
          nodeBlueprints.filter(isLandmarkNode).map(({ id }) => id),
        );
        const keyboardPlacements = keyboardChanges.flatMap((change) => (
          change.type === "position" && change.position && landmarkIds.has(change.id)
            ? [{
              landmarkId: change.id,
              x: snap(change.position.x),
              y: snap(change.position.y),
            }]
            : []
        ));
        if (keyboardPlacements.length) onPlacementChanges(keyboardPlacements);
      }
    }
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (!selectionChanges.length) return;
    setSelectedCanvasNodeIds((current) => {
      const next = new Set(current);
      selectionChanges.forEach((change) => {
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      });
      return next;
    });
  }, [nodeBlueprints, onNodesChange, onPlacementChanges]);

  const movementParentByNodeId = useMemo(() => {
    const groupNodeByRegionId = new Map(groups.map(({ nodeId, region }) => [region.id, nodeId]));
    const parents = new Map<string, string | null>();
    groups.forEach((group) => {
      parents.set(
        group.nodeId,
        group.parentId
          ? groupNodeByRegionId.get(group.parentId) ?? group.parentId
          : null,
      );
    });
    baseLandmarkNodes.forEach((node) => {
      parents.set(node.id, smallestGroupByLandmark.get(node.id)?.nodeId ?? null);
    });
    return parents;
  }, [baseLandmarkNodes, groups, smallestGroupByLandmark]);

  const movementTargets = useMemo<readonly CanvasSnapTarget[]>(() => (
    nodeBlueprints.map((node) => ({
      id: node.id,
      rect: {
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? (isRegionNode(node) ? GROUP_MIN_WIDTH : LANDMARK_WIDTH),
        height: node.height ?? (isRegionNode(node) ? GROUP_MIN_HEIGHT : LANDMARK_HEIGHT),
      },
      kind: isRegionNode(node) ? node.data.level ?? "group" : "landmark",
      role: isRegionNode(node) ? "container" as const : "item" as const,
      parentId: movementParentByNodeId.get(node.id) ?? null,
      shape: node.data.shape as GroupShape,
    }))
  ), [movementParentByNodeId, nodeBlueprints]);

  const publishMovementGuides = useCallback((guides: readonly CanvasSnapGuide[]) => {
    const signature = JSON.stringify(guides);
    if (signature === movementGuideSignatureRef.current) return;
    movementGuideSignatureRef.current = signature;
    setMovementGuides(guides);
  }, []);

  const clearMovementAssist = useCallback(() => {
    movementGestureSequenceRef.current += 1;
    movementAssistRef.current = undefined;
    publishMovementGuides([]);
  }, [publishMovementGuides]);

  const beginMovementAssist = useCallback((
    primaryId: string,
    positions: ReadonlyMap<string, CanvasSnapPoint>,
    snapNodeIds: ReadonlySet<string>,
  ) => {
    const movementReady = prepareCanvasMovementAssist();
    const sequence = ++movementGestureSequenceRef.current;
    const input = {
      targets: movementTargets,
      liveNodes: flowRef.current?.getNodes?.() ?? [],
      positions,
      snapNodeIds,
      // These are the exact resolved handles currently drawn by React Flow.
      connections: [...edgeListRef.current],
    };
    const installGesture = () => {
      const gesture = movementGestureBuilder?.(input);
      if (!gesture || movementGestureSequenceRef.current !== sequence) return false;
      movementAssistRef.current = {
        primaryId,
        ...gesture,
        contextKey: `${primaryId}:${sequence}`,
        lastDelta: { x: 0, y: 0 },
      };
      return true;
    };
    if (!installGesture()) void movementReady.then(installGesture);
    publishMovementGuides([]);
  }, [movementTargets, publishMovementGuides]);

  const resolveMovementAssist = useCallback((
    primaryId: string,
    rawDelta: CanvasSnapPoint,
    modifiers: CanvasMovementModifiers = {},
  ) => {
    const assist = movementAssistRef.current;
    if (!assist || assist.primaryId !== primaryId) return rawDelta;
    const viewportZoom = flowRef.current?.getViewport().zoom ?? 1;
    // At extreme overview zoom a literal eight-screen-pixel radius covers a
    // huge part of the world. Keep it helpful without turning the map sticky.
    const effectiveZoom = Math.max(
      .28,
      viewportZoom * (
        Number.isFinite(viewportScaleFactor) && viewportScaleFactor > 0
          ? viewportScaleFactor
          : 1
      ),
    );

    if (modifiers.axisLock) {
      assist.axisLock = modifiers.axisLock;
    } else if (modifiers.shiftKey) {
      if (
        !assist.axisLock &&
        Math.max(Math.abs(rawDelta.x), Math.abs(rawDelta.y)) * effectiveZoom >= 5
      ) {
        assist.axisLock = Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? "x" : "y";
      }
    } else assist.axisLock = undefined;

    const constrained = {
      x: assist.axisLock === "y" ? 0 : rawDelta.x,
      y: assist.axisLock === "x" ? 0 : rawDelta.y,
    };
    const resolver = movementSnapResolver;
    const fallbackDelta = {
      x: assist.axisLock === "y"
        ? 0
        : Math.round((assist.moving.rect.x + constrained.x) / GRID) * GRID - assist.moving.rect.x,
      y: assist.axisLock === "x"
        ? 0
        : Math.round((assist.moving.rect.y + constrained.y) / GRID) * GRID - assist.moving.rect.y,
    };
    const result = resolver
      ? resolver({
          moving: assist.moving,
          stationary: assist.stationary,
          connections: assist.connections,
          zoom: effectiveZoom,
          rawDelta: constrained,
          gridSize: GRID,
          modifiers: { altKey: modifiers.altKey, axisLock: assist.axisLock },
          previous: assist.snapState,
          contextKey: assist.contextKey,
        })
      : {
          // A direct click-drag can beat the tiny deferred module on a cold
          // cache. Keep that first frame pointer-synchronous and grid-correct;
          // the next sample upgrades to magnets as soon as the import lands.
          delta: fallbackDelta,
          rect: {
            ...assist.moving.rect,
            x: assist.moving.rect.x + fallbackDelta.x,
            y: assist.moving.rect.y + fallbackDelta.y,
          },
          guides: [] as readonly CanvasSnapGuide[],
          state: { contextKey: assist.contextKey },
        };
    assist.snapState = result.state;
    assist.lastDelta = result.delta;

    const guides = [...result.guides];
    if (assist.axisLock) {
      const horizontal = assist.axisLock === "x";
      const reach = 72 / effectiveZoom;
      guides.push({
        id: `axis-lock:${assist.axisLock}`,
        kind: "alignment",
        axis: horizontal ? "y" : "x",
        lines: horizontal
          ? [{
              x1: result.rect.x - reach,
              y1: result.rect.y + result.rect.height / 2,
              x2: result.rect.x + result.rect.width + reach,
              y2: result.rect.y + result.rect.height / 2,
            }]
          : [{
              x1: result.rect.x + result.rect.width / 2,
              y1: result.rect.y - reach,
              x2: result.rect.x + result.rect.width / 2,
              y2: result.rect.y + result.rect.height + reach,
            }],
        targetIds: ["axis-lock"],
      });
    }
    publishMovementGuides(guides);
    return result.delta;
  }, [publishMovementGuides, viewportScaleFactor]);
  useEffect(() => {
    // Manual group and cross-window previews live outside React Flow's native
    // `dragging` flag. Preserve the whole active gesture closure when an
    // unrelated data refresh rebuilds blueprints mid-drag; otherwise objects
    // visibly jump back under the pointer until the next pointermove.
    const preserveGeometryIds = new Set<string>();
    const groupDrag = groupDragRef.current;
    if (groupDrag) {
      preserveGeometryIds.add(groupDrag.nodeId);
      groupDrag.members.forEach(({ landmarkId }) => preserveGeometryIds.add(landmarkId));
      groupDrag.nestedGroups.forEach(({ nodeId }) => preserveGeometryIds.add(nodeId));
    }
    selectionMoveRef.current?.positions.forEach((_position, id) => {
      preserveGeometryIds.add(id);
    });
    activeNodeDragRef.current?.positions.forEach((_position, id) => {
      preserveGeometryIds.add(id);
    });
    const desktopDrag = desktopDragRef.current;
    if (desktopDrag && !desktopDrag.ended) {
      preserveGeometryIds.add(desktopDrag.event.nodeId);
      desktopDrag.selection?.positions.forEach((_position, id) => {
        preserveGeometryIds.add(id);
      });
    }
    setNodes((currentNodes) => reconcileRuntimeNodes(
      currentNodes,
      nodeBlueprints,
      preserveGeometryIds.size ? preserveGeometryIds : undefined,
    ));
  }, [nodeBlueprints, setNodes]);

  const connectionNodeCenters = useMemo(() => new Map(
    [...regionNodes, ...baseLandmarkNodes].map((node) => [node.id, [
      node.position.x + (node.width ?? LANDMARK_WIDTH) / 2,
      node.position.y + (node.height ?? LANDMARK_HEIGHT) / 2,
    ] as const]),
  ), [baseLandmarkNodes, regionNodes]);

  const visibleIds = useMemo(() => new Set([
    ...groups.map(({ nodeId }) => nodeId),
    ...visibleLandmarks.map(({ id }) => id),
  ]), [groups, visibleLandmarks]);
  const baseEdges = useMemo(() => {
    const candidates: CachedEdge[] = [];
    snapshot.connections.forEach((connection) => {
      const override = customizations.connectionOverrides[connection.id] ?? {};
      const endpoints = relationVisualEndpoints(connection, override);
      const candidate = connectionEdge(connection.id, endpoints.source, endpoints.target, override, {
        label: connection.label,
        lineStyle: defaultLineByRelation[connection.kind],
        handles: inferredConnectionHandles(endpoints.source, endpoints.target, connectionNodeCenters),
      }, visibleIds, false);
      if (candidate) candidates.push(candidate);
    });
    customizations.customConnections.forEach((connection) => {
      const candidate = connectionEdge(connection.id, connection.source, connection.target, connection, {
        lineStyle: "solid",
        handles: inferredConnectionHandles(connection.source, connection.target, connectionNodeCenters),
      }, visibleIds, false);
      if (candidate) candidates.push(candidate);
    });
    const previousCache = edgeCacheRef.current;
    const nextCache = new Map<string, CachedEdge>();
    const nextEdges = candidates.map((candidate) => {
      const previous = previousCache.get(candidate.edge.id);
      const stable = previous?.signature === candidate.signature ? previous : candidate;
      nextCache.set(stable.edge.id, stable);
      return stable.edge;
    });
    edgeCacheRef.current = nextCache;
    const previousEdges = edgeListRef.current;
    const stableList = previousEdges.length === nextEdges.length &&
      previousEdges.every((edge, index) => edge === nextEdges[index])
      ? previousEdges
      : nextEdges;
    edgeListRef.current = stableList;
    return stableList;
  }, [connectionNodeCenters, customizations.connectionOverrides, customizations.customConnections, snapshot.connections, visibleIds]);

  useEffect(() => {
    const liveNodeIds = new Set(nodeBlueprints.map(({ id }) => id));
    const liveConnectionIds = new Set(baseEdges.map(({ id }) => id));
    cancelledNodeDragsRef.current.forEach((id) => {
      if (liveNodeIds.has(id)) return;
      cancelledNodeDragsRef.current.delete(id);
      cancelledNodeDragStatesRef.current.delete(id);
    });
    setSelectedCanvasNodeIds((current) => {
      const next = new Set([...current].filter((id) => liveNodeIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setSelectedConnectionIds((current) => {
      const next = new Set([...current].filter((id) => liveConnectionIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setMenu((current) => {
      if (!current || current.kind === "canvas") return current;
      if (current.kind === "landmark") {
        return liveNodeIds.has(current.landmarkId) ? current : undefined;
      }
      if (current.kind === "group") {
        return groupByRegionId.has(current.regionId) ? current : undefined;
      }
      return liveConnectionIds.has(current.connectionId) ? current : undefined;
    });
    setHoveredNodeId((current) => current && !liveNodeIds.has(current) ? undefined : current);
    setConnectionSourceNodeId((current) => current && !liveNodeIds.has(current) ? undefined : current);

    // An external file refresh, undo, or desktop snapshot can remove an object
    // without a local pointer-up. Do not let that vanished owner leave Delete,
    // menus, or every later drag stuck behind an "active" gesture flag.
    const direct = activeDirectGestureRef.current;
    if (direct && !liveNodeIds.has(direct.nodeId)) {
      activeDirectGestureRef.current = undefined;
      setIsNodeDragging(false);
    }
    const nativeDrag = activeNodeDragRef.current;
    if (nativeDrag && !liveNodeIds.has(nativeDrag.primaryId)) {
      cancelledNodeDragsRef.current.delete(nativeDrag.primaryId);
      cancelledNodeDragStatesRef.current.delete(nativeDrag.primaryId);
      activeNodeDragRef.current = undefined;
      setIsNodeDragging(false);
    }
    const groupDrag = groupDragRef.current;
    if (groupDrag && !liveNodeIds.has(groupDrag.nodeId)) {
      if (groupDragFrameRef.current !== undefined) {
        cancelAnimationFrame(groupDragFrameRef.current);
        groupDragFrameRef.current = undefined;
      }
      groupDragPreviewRef.current = undefined;
      groupDragRef.current = undefined;
      setIsNodeDragging(false);
    }
    const selectionMove = selectionMoveRef.current;
    if (selectionMove && !liveNodeIds.has(selectionMove.primaryId)) {
      if (groupDragFrameRef.current !== undefined) {
        cancelAnimationFrame(groupDragFrameRef.current);
        groupDragFrameRef.current = undefined;
      }
      groupDragPreviewRef.current = undefined;
      selectionMoveRef.current = undefined;
      setIsNodeDragging(false);
    }
    const desktopDrag = desktopDragRef.current;
    if (desktopDrag && !liveNodeIds.has(desktopDrag.event.nodeId)) {
      desktopDrag.ended = true;
      finishedDesktopGesturesRef.current.add(desktopDrag.event.gestureId);
      desktopDragRef.current = undefined;
      setIsNodeDragging(false);
    }
    const movementAssist = movementAssistRef.current;
    if (movementAssist && !liveNodeIds.has(movementAssist.primaryId)) {
      clearMovementAssist();
    }
  }, [baseEdges, clearMovementAssist, groupByRegionId, nodeBlueprints]);

  const searchEdges = useMemo(() => {
    if (!searchMatchIds) {
      if (searchEdgeCacheRef.current.size) searchEdgeCacheRef.current.clear();
      searchEdgeListRef.current = baseEdges;
      return baseEdges;
    }
    const previousCache = searchEdgeCacheRef.current;
    const nextCache = new Map<string, CachedSearchEdge>();
    const nextEdges = baseEdges.map((base) => {
      const sourceMatches = searchMatchIds.has(base.source);
      const targetMatches = searchMatchIds.has(base.target);
      const emphasis = sourceMatches && targetMatches
        ? "match" as const
        : sourceMatches || targetMatches
          ? "context" as const
          : "muted" as const;
      const previous = previousCache.get(base.id);
      if (previous?.base === base && previous.emphasis === emphasis) {
        nextCache.set(base.id, previous);
        return previous.edge;
      }
      const cached: CachedSearchEdge = {
        base,
        emphasis,
        edge: {
          ...base,
          className: `${base.className ?? ""} is-search-${emphasis}`.trim(),
          style: {
            ...base.style,
            opacity: emphasis === "match" ? 1 : emphasis === "context" ? .28 : .08,
            strokeWidth: emphasis === "match" ? 1.8 : base.style?.strokeWidth,
          },
        },
      };
      nextCache.set(base.id, cached);
      return cached.edge;
    });
    searchEdgeCacheRef.current = nextCache;
    const previousEdges = searchEdgeListRef.current;
    const stableList = previousEdges.length === nextEdges.length &&
      previousEdges.every((edge, index) => edge === nextEdges[index])
      ? previousEdges
      : nextEdges;
    searchEdgeListRef.current = stableList;
    return stableList;
  }, [baseEdges, searchMatchIds]);

  const edges = useMemo(() => {
    if (!selectedConnectionIds.size) return searchEdges;
    let changed = false;
    const nextEdges = searchEdges.map((edge) => {
      if (!selectedConnectionIds.has(edge.id)) return edge;
      changed = true;
      return {
        ...edge,
        selected: true,
        zIndex: selectedConnectionZIndex,
        ...(edge.labelBgStyle ? {
          labelBgStyle: { ...edge.labelBgStyle, stroke: "#111111" },
        } : {}),
        style: { ...edge.style, strokeWidth: 2.4, opacity: 1 },
      };
    });
    return changed ? nextEdges : searchEdges;
  }, [searchEdges, selectedConnectionIds]);

  const renderedEdges = useMemo(() => {
    if (!hoveredNodeId) return edges;
    let changed = false;
    const next = edges.map((edge) => {
      if (edge.source !== hoveredNodeId && edge.target !== hoveredNodeId) return edge;
      changed = true;
      return {
        ...edge,
        className: `${edge.className ?? ""} is-incident-hover`.trim(),
      };
    });
    return changed ? next : edges;
  }, [edges, hoveredNodeId]);

  const connectionKeys = useMemo(() => new Set(baseEdges.map(connectionKey)), [baseEdges]);

  const selectedConnection = useMemo<EditableConnectionState | undefined>(() => {
    const id = menu?.kind === "connection" ? menu.connectionId : selectedConnectionId;
    if (!id) return undefined;
    const custom = customizations.customConnections.find((connection) => connection.id === id);
    if (custom) return {
      id,
      label: custom.label ?? "",
      direction: custom.direction ?? "forward",
      lineStyle: custom.lineStyle ?? "solid",
      pathStyle: custom.pathStyle ?? "smooth",
      color: custom.color ?? neutralConnectionColor,
    };
    const base = snapshot.connections.find((connection) => connection.id === id);
    if (!base) return undefined;
    const override = customizations.connectionOverrides[id] ?? {};
    return {
      id,
      label: override.label ?? base.label ?? "",
      direction: override.direction ?? "forward",
      lineStyle: override.lineStyle ?? defaultLineByRelation[base.kind],
      pathStyle: override.pathStyle ?? "smooth",
      color: override.color ?? neutralConnectionColor,
    };
  }, [customizations.connectionOverrides, customizations.customConnections, menu, selectedConnectionId, snapshot.connections]);

  const updateConnection = useCallback((id: string, patch: ConnectionCustomization) => {
    const custom = customizations.customConnections.find((connection) => connection.id === id);
    const existing = custom ?? customizations.connectionOverrides[id];
    if (existing && !patchChanges(existing, patch)) return;
    onCustomizationsChange((current) => {
      const index = current.customConnections.findIndex((connection) => connection.id === id);
      if (index >= 0) {
        if (!patchChanges(current.customConnections[index], patch)) return current;
        const customConnections = [...current.customConnections];
        customConnections[index] = { ...customConnections[index], ...patch };
        return { ...current, customConnections };
      }
      if (!patchChanges(current.connectionOverrides[id], patch)) return current;
      return { ...current, connectionOverrides: { ...current.connectionOverrides, [id]: { ...current.connectionOverrides[id], ...patch } } };
    });
  }, [customizations.connectionOverrides, customizations.customConnections, onCustomizationsChange]);

  const deleteConnection = useCallback((id: string) => {
    onCustomizationsChange((current) => {
      const customConnections = current.customConnections.filter((connection) => connection.id !== id);
      if (customConnections.length !== current.customConnections.length) return { ...current, customConnections };
      return { ...current, connectionOverrides: { ...current.connectionOverrides, [id]: { ...current.connectionOverrides[id], hidden: true } } };
    });
    clearConnectionSelection();
    setMenu(undefined);
  }, [clearConnectionSelection, onCustomizationsChange]);

  const commitConnection = useCallback((connection: FlowConnection) => {
    const created: CustomConnection = {
      id: uniqueId("connection"),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      label: "",
      direction: "forward",
      lineStyle: "solid",
      pathStyle: "smooth",
      color: neutralConnectionColor,
    };
    onCustomizationsChange((current) => ({ ...current, customConnections: [...current.customConnections, created] }));
    selectOnlyConnection(created.id);
  }, [onCustomizationsChange, selectOnlyConnection]);

  const queueConnection = useCallback<OnConnect>((connection) => {
    if (reconnectGestureRef.current || cancelledConnectionRef.current) return;
    pendingConnectionRef.current = connection;
  }, []);

  const startConnection = useCallback<NonNullable<ReactFlowProps<AtlasGraphNode, Edge>["onConnectStart"]>>((_event, params) => {
    cancelledConnectionRef.current = false;
    pendingConnectionRef.current = undefined;
    setMenu(undefined);
    setIsConnecting(true);
    setConnectionSourceNodeId(params?.nodeId ?? undefined);
  }, []);

  const finishConnection = useCallback<OnConnectEnd>((_event, finalState) => {
    const wasCancelled = cancelledConnectionRef.current;
    cancelledConnectionRef.current = false;
    const pending = pendingConnectionRef.current;
    pendingConnectionRef.current = undefined;
    setIsConnecting(false);
    setConnectionSourceNodeId(undefined);
    if (reconnectGestureRef.current || wasCancelled) return;
    if (
      !pending ||
      finalState.isValid !== true ||
      !finalState.toNode ||
      !finalState.toHandle ||
      !canCreateConnection(pending, connectionKeys)
    ) return;
    commitConnection(pending);
  }, [commitConnection, connectionKeys]);

  const handleReconnect = useCallback<OnReconnect<Edge>>((edge, connection: FlowConnection) => {
    if (cancelledReconnectRef.current) return;
    const originalKey = connectionKey(edge);
    if (connectionKey(connection) === originalKey || !canCreateConnection(connection, connectionKeys, originalKey)) return;
    updateConnection(edge.id, {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    });
  }, [connectionKeys, updateConnection]);

  const handleReconnectStart = useCallback<NonNullable<ReactFlowProps<AtlasGraphNode, Edge>["onReconnectStart"]>>((_event, edge) => {
    cancelledReconnectRef.current = false;
    reconnectGestureRef.current = connectionKey(edge);
  }, []);

  const handleReconnectEnd = useCallback<NonNullable<ReactFlowProps<AtlasGraphNode, Edge>["onReconnectEnd"]>>(() => {
    const wasCancelled = cancelledReconnectRef.current;
    cancelledReconnectRef.current = false;
    reconnectGestureRef.current = undefined;
    if (wasCancelled) clearConnectionSelection();
  }, [clearConnectionSelection]);

  const handleNodeClick = useCallback<NodeMouseHandler<AtlasGraphNode>>((event, node) => {
    // A click is the terminal state of this pointer sequence. Clear any drag
    // bookkeeping left by a threshold-crossing/no-grid-movement gesture so
    // Escape cannot keep treating an idle selected node as an active drag.
    activeNodeDragRef.current = undefined;
    cancelledNodeDragsRef.current.delete(node.id);
    cancelledNodeDragStatesRef.current.delete(node.id);
    setIsNodeDragging(false);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const togglingOff = additive && selectedCanvasNodeIds.has(node.id);
    if (!additive) {
      requestCanvasNodeSelection(node.id, "replace");
    } else setMenu(undefined);
    if (isLandmarkNode(node)) {
      if (!togglingOff) onSelectLandmark(node.data.landmark);
      else if (node.data.landmark.id === selectedLandmarkId) clearActiveShellSelection();
    } else if (!additive) clearActiveShellSelection();
  }, [clearActiveShellSelection, onSelectLandmark, requestCanvasNodeSelection, selectedCanvasNodeIds, selectedLandmarkId]);

  const handleNodeMouseEnter = useCallback<NodeMouseHandler<AtlasGraphNode>>((_event, node) => {
    setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback<NodeMouseHandler<AtlasGraphNode>>((_event, node) => {
    setHoveredNodeId((current) => current === node.id ? undefined : current);
  }, []);

  const handleNodeContextMenu = useCallback<NodeMouseHandler<AtlasGraphNode>>((event, node) => {
    event.preventDefault();
    const replacingSelection = !selectedCanvasNodeIds.has(node.id);
    if (replacingSelection) {
      setSelectedCanvasNodeIds(new Set([node.id]));
      clearConnectionSelection();
    }
    if (isLandmarkNode(node)) {
      onSelectLandmark(node.data.landmark);
      setMenu({ kind: "landmark", landmarkId: node.id, x: event.clientX, y: event.clientY });
    } else if (isRegionNode(node)) {
      if (replacingSelection) clearActiveShellSelection(true);
      setMenu({ kind: "group", regionId: node.data.regionId, x: event.clientX, y: event.clientY });
    }
  }, [clearActiveShellSelection, clearConnectionSelection, onSelectLandmark, selectedCanvasNodeIds]);

  const buildGroupDrag = useCallback((group: GroupDescriptor) => {
    const groupsById = new Map(groups.map((candidate) => [candidate.region.id, candidate]));
    const isExplicitDescendant = (candidate: GroupDescriptor) => {
      const seen = new Set<string>();
      let parentId = candidate.parentId;
      while (parentId && !seen.has(parentId)) {
        if (parentId === group.region.id) return true;
        seen.add(parentId);
        parentId = groupsById.get(parentId)?.parentId;
      }
      return false;
    };
    const descendants = groups.filter((candidate) => (
      candidate.nodeId !== group.nodeId && isExplicitDescendant(candidate)
    ));
    // A hierarchy drag is a closure, not just a stack of frames. Include every
    // descendant's landmark members even when the child extends beyond the
    // parent contour; otherwise the child frame moves while its ideas stay.
    const groupMemberIds = new Set(group.memberIds);
    descendants.forEach(({ memberIds }) => memberIds.forEach((id) => groupMemberIds.add(id)));
    const members = [...groupMemberIds].flatMap((id) => {
      const placement = resolvedPlacements.get(id);
      return placement ? [{ ...placement }] : [];
    });
    const nestedGroups = descendants.flatMap((candidate) => {
      const imported = customizations.groups[candidate.region.id];
      return [{
        nodeId: candidate.nodeId,
        regionId: candidate.region.id,
        x: candidate.x,
        y: candidate.y,
        persistPosition: candidate.variant === "custom" || imported?.x !== undefined || imported?.y !== undefined,
      }];
    });
    return {
      nodeId: group.nodeId,
      regionId: group.region.id,
      variant: group.variant,
      startX: group.x,
      startY: group.y,
      members,
      memberById: new Map(members.map((placement) => [placement.landmarkId, placement])),
      nestedGroups,
      nestedByNodeId: new Map(nestedGroups.map((nested) => [nested.nodeId, nested])),
    } satisfies GroupDragState;
  }, [customizations.groups, groups, resolvedPlacements]);

  const captureGroupDrag = useCallback((group: GroupDescriptor) => {
    setMenu(undefined);
    clearConnectionSelection();
    const drag = buildGroupDrag(group);
    groupDragRef.current = drag;
    return drag;
  }, [buildGroupDrag, clearConnectionSelection]);

  const buildSelectionMove = useCallback((
    primaryId: string,
    selectedIds: ReadonlySet<string> = selectedCanvasNodeIds,
  ) => {
    if (selectedIds.size < 2 || !selectedIds.has(primaryId)) return undefined;

    const groupByNodeId = new Map(groups.map((group) => [group.nodeId, group]));
    const selectedGroups = [...selectedIds].flatMap((id) => {
      const group = groupByNodeId.get(id);
      return group ? [group] : [];
    });
    const selectedRegionIds = new Set(selectedGroups.map(({ region }) => region.id));
    // A selected ancestor already carries its complete hierarchy closure. Drop
    // selected descendants as movement roots so neither their frames nor their
    // landmark members can receive the same delta twice.
    const movementRoots = selectedGroups.filter((candidate) => {
      const seen = new Set<string>();
      let parentId = candidate.parentId;
      while (parentId && !seen.has(parentId)) {
        if (selectedRegionIds.has(parentId)) return false;
        seen.add(parentId);
        parentId = groupByRegionId.get(parentId)?.parentId;
      }
      return true;
    });
    const positions = new Map<string, { x: number; y: number }>();
    const landmarkIds = new Set<string>();
    const groupCarriedLandmarkIds = new Set<string>();
    const moveGroups = new Map<string, CanvasSelectionMoveGroup>();

    const addLandmark = (placement: Placement | undefined) => {
      if (!placement || landmarkIds.has(placement.landmarkId)) return;
      landmarkIds.add(placement.landmarkId);
      positions.set(placement.landmarkId, { x: placement.x, y: placement.y });
    };
    const addGroup = (nodeId: string, origin: CanvasSelectionMoveGroup) => {
      const existing = moveGroups.get(nodeId);
      if (!existing) {
        moveGroups.set(nodeId, origin);
        positions.set(nodeId, { x: origin.x, y: origin.y });
      } else if (origin.persistPosition && !existing.persistPosition) {
        moveGroups.set(nodeId, { ...existing, persistPosition: true });
      }
    };

    [...selectedIds].forEach((id) => addLandmark(resolvedPlacements.get(id)));
    movementRoots.forEach((root) => {
      const drag = buildGroupDrag(root);
      drag.members.forEach((placement) => {
        groupCarriedLandmarkIds.add(placement.landmarkId);
        addLandmark(placement);
      });
      const existing = customizations.groups[root.region.id];
      addGroup(root.nodeId, {
        regionId: root.region.id,
        x: root.x,
        y: root.y,
        persistPosition: root.variant === "subject" ||
          root.variant === "custom" ||
          existing?.x !== undefined ||
          existing?.y !== undefined ||
          existing?.width !== undefined ||
          existing?.height !== undefined,
      });
      drag.nestedGroups.forEach(({ nodeId, ...nested }) => addGroup(nodeId, nested));
    });

    const primary = positions.get(primaryId);
    if (!primary) return undefined;
    const snapNodeIds = new Set<string>(movementRoots.map(({ nodeId }) => nodeId));
    selectedIds.forEach((id) => {
      if (resolvedPlacements.has(id) && !groupCarriedLandmarkIds.has(id)) {
        snapNodeIds.add(id);
      }
    });
    return {
      primaryId,
      primaryStartX: primary.x,
      primaryStartY: primary.y,
      positions,
      snapNodeIds,
      landmarkIds,
      groups: moveGroups,
    } satisfies CanvasSelectionMoveState;
  }, [buildGroupDrag, customizations.groups, groupByRegionId, groups, resolvedPlacements, selectedCanvasNodeIds]);

  const renderGroupDrag = useCallback((drag: GroupDragState, deltaX: number, deltaY: number, moveRoot: boolean) => {
    setNodes((current) => current.map((node) => {
      if (moveRoot && node.id === drag.nodeId && isRegionNode(node)) return { ...node, position: { x: drag.startX + deltaX, y: drag.startY + deltaY } };
      const placement = drag.memberById.get(node.id);
      if (placement && isLandmarkNode(node)) return { ...node, position: { x: placement.x + deltaX, y: placement.y + deltaY } };
      const nested = drag.nestedByNodeId.get(node.id);
      return nested && isRegionNode(node) ? { ...node, position: { x: nested.x + deltaX, y: nested.y + deltaY } } : node;
    }));
  }, [setNodes]);

  const renderSelectionMove = useCallback((
    drag: CanvasSelectionMoveState,
    deltaX: number,
    deltaY: number,
  ) => {
    setNodes((current) => current.map((node) => {
      const origin = drag.positions.get(node.id);
      return origin
        ? { ...node, position: { x: origin.x + deltaX, y: origin.y + deltaY } }
        : node;
    }));
  }, [setNodes]);

  const renderCapturedPositions = useCallback((
    positions: ReadonlyMap<string, CanvasSnapPoint>,
    delta: CanvasSnapPoint,
  ) => {
    setNodes((current) => current.map((node) => {
      const origin = positions.get(node.id);
      return origin
        ? { ...node, position: { x: origin.x + delta.x, y: origin.y + delta.y } }
        : node;
    }));
  }, [setNodes]);

  const cancelGroupDragPreview = useCallback(() => {
    if (groupDragFrameRef.current !== undefined) {
      cancelAnimationFrame(groupDragFrameRef.current);
      groupDragFrameRef.current = undefined;
    }
    groupDragPreviewRef.current = undefined;
  }, []);

  const flushGroupDragPreview = useCallback((preview?: GroupDragPreview) => {
    if (groupDragFrameRef.current !== undefined) {
      cancelAnimationFrame(groupDragFrameRef.current);
      groupDragFrameRef.current = undefined;
    }
    const next = preview ?? groupDragPreviewRef.current;
    groupDragPreviewRef.current = undefined;
    if (next?.selection) {
      renderSelectionMove(next.selection, next.deltaX, next.deltaY);
    } else if (next?.drag) {
      renderGroupDrag(next.drag, next.deltaX, next.deltaY, next.moveRoot);
    }
  }, [renderGroupDrag, renderSelectionMove]);

  const queueGroupDragPreview = useCallback((preview: GroupDragPreview) => {
    groupDragPreviewRef.current = preview;
    if (groupDragFrameRef.current !== undefined) return;
    groupDragFrameRef.current = requestAnimationFrame(() => {
      groupDragFrameRef.current = undefined;
      const next = groupDragPreviewRef.current;
      groupDragPreviewRef.current = undefined;
      if (next?.selection) {
        renderSelectionMove(next.selection, next.deltaX, next.deltaY);
      } else if (next?.drag) {
        renderGroupDrag(next.drag, next.deltaX, next.deltaY, next.moveRoot);
      }
    });
  }, [renderGroupDrag, renderSelectionMove]);

  useEffect(() => cancelGroupDragPreview, [cancelGroupDragPreview]);

  const commitGroupDrag = useCallback((drag: GroupDragState, rawX: number, rawY: number) => {
    // The shared resolver has already chosen either an exact smart alignment
    // or the grid fallback. Re-snapping here would destroy half-grid centres.
    const finalX = rawX;
    const finalY = rawY;
    const deltaX = finalX - drag.startX;
    const deltaY = finalY - drag.startY;
    onPlacementChanges(drag.members.map((placement) => ({
      landmarkId: placement.landmarkId,
      x: placement.x + deltaX,
      y: placement.y + deltaY,
    })));
    const existing = customizations.groups[drag.regionId];
    const persistRoot = drag.variant === "subject" || drag.variant === "custom" || existing?.x !== undefined || existing?.y !== undefined || existing?.width !== undefined || existing?.height !== undefined;
    const groupPatches: Array<readonly [string, GroupCustomization]> = [];
    if (persistRoot) groupPatches.push([drag.regionId, { x: finalX, y: finalY }]);
    drag.nestedGroups.filter(({ persistPosition }) => persistPosition).forEach((nested) => {
      groupPatches.push([nested.regionId, {
        x: nested.x + deltaX,
        y: nested.y + deltaY,
      }]);
    });
    changeGroupAppearances(groupPatches);

    // Canvas hierarchy follows the visible drop, not a stale historical
    // parent. Otherwise a subgroup moved into Group B can still jump when the
    // distant Group A is moved later. Reparent only authored groups, choose the
    // smallest valid containing parent, and explicitly detach outside one.
    const root = groups.find(({ region }) => region.id === drag.regionId);
    if (root?.variant === "custom") {
      const requiredParentLevel = root.level === "group"
        ? "subject"
        : root.level === "subgroup"
          ? "group"
          : undefined;
      const hierarchyIds = new Set([
        drag.regionId,
        ...drag.nestedGroups.map(({ regionId }) => regionId),
      ]);
      const center = {
        x: finalX + root.width / 2,
        y: finalY + root.height / 2,
      };
      const parent = requiredParentLevel
        ? groups.filter((candidate) => (
            candidate.level === requiredParentLevel &&
            !hierarchyIds.has(candidate.region.id) &&
            objectShapeContainsPoint(
              candidate.shape,
              (center.x - candidate.x) / candidate.width,
              (center.y - candidate.y) / candidate.height,
            )
          )).sort((left, right) => (
            left.width * left.height - right.width * right.height
          ))[0]
        : undefined;
      onCustomizationsChange((current) => {
        const index = current.customGroups.findIndex(({ id }) => id === drag.regionId);
        if (index < 0) return current;
        const existing = current.customGroups[index];
        const nextParentId = parent?.region.id;
        const nextSubjectId = parent?.region.subjectId ?? existing.subjectId;
        const parentMatches = existing.parentId === nextParentId;
        const subjectMatches = existing.subjectId === nextSubjectId;
        const descendantsMatch = !parent || current.customGroups.every((candidate) => (
          !hierarchyIds.has(candidate.id) || candidate.subjectId === nextSubjectId
        ));
        if (parentMatches && subjectMatches && descendantsMatch) return current;
        const customGroups = current.customGroups.map((candidate) => {
          if (candidate.id === drag.regionId) {
            const { parentId: _discarded, ...withoutParent } = candidate;
            return {
              ...withoutParent,
              subjectId: nextSubjectId,
              ...(nextParentId ? { parentId: nextParentId } : {}),
            };
          }
          return parent && hierarchyIds.has(candidate.id)
            ? { ...candidate, subjectId: nextSubjectId }
            : candidate;
        });
        return { ...current, customGroups };
      });
    }
  }, [changeGroupAppearances, customizations.groups, groups, onCustomizationsChange, onPlacementChanges]);

  const commitSelectionMove = useCallback((
    drag: CanvasSelectionMoveState,
    rawPrimaryX: number,
    rawPrimaryY: number,
  ) => {
    const finalPrimaryX = rawPrimaryX;
    const finalPrimaryY = rawPrimaryY;
    const deltaX = finalPrimaryX - drag.primaryStartX;
    const deltaY = finalPrimaryY - drag.primaryStartY;

    // Apply one common delta to the captured origins. Avoid independently
    // snapping secondaries: even legacy off-grid geometry must keep its exact
    // internal spacing after a batch move.
    onPlacementChanges([...drag.landmarkIds].flatMap((landmarkId) => {
      const origin = drag.positions.get(landmarkId);
      return origin ? [{
        landmarkId,
        x: origin.x + deltaX,
        y: origin.y + deltaY,
      }] : [];
    }));
    changeGroupAppearances([...drag.groups.values()].flatMap((group) => (
      group.persistPosition
        ? [[group.regionId, {
            x: group.x + deltaX,
            y: group.y + deltaY,
          }] as const]
        : []
    )));
    // A multi-object move preserves authored hierarchy. Reparenting individual
    // roots while their siblings are still being committed can create
    // order-dependent parentage; a later explicit single-group move retains
    // the existing drop-to-reparent behavior in commitGroupDrag.
  }, [changeGroupAppearances, onPlacementChanges]);

  const flowPointForClient = useCallback((point: DesktopCanvasPoint) => {
    return flowRef.current?.screenToFlowPosition(point);
  }, []);

  const rememberFinishedDesktopGesture = useCallback((gestureId: string) => {
    rememberSettledDesktopGesture(gestureId);
    const finished = finishedDesktopGesturesRef.current;
    finished.add(gestureId);
    // A small bounded tombstone set prevents a delayed move packet from
    // resurrecting a gesture after its end packet crossed renderer processes.
    while (finished.size > 64) {
      const oldest = finished.values().next().value as string | undefined;
      if (!oldest) break;
      finished.delete(oldest);
    }
  }, []);

  const ensureDesktopDrag = useCallback((event: DesktopCanvasDragEvent) => {
    if (
      settledDesktopGestures.has(event.gestureId) ||
      finishedDesktopGesturesRef.current.has(event.gestureId)
    ) return undefined;
    const current = desktopDragRef.current;
    if (current?.event.gestureId === event.gestureId) return current;

    const selection = event.selectionNodeIds
      ? buildSelectionMove(event.nodeId, new Set(event.selectionNodeIds))
      : undefined;
    if (selection) {
      const runtime: DesktopDragRuntime = {
        event,
        startX: selection.primaryStartX,
        startY: selection.primaryStartY,
        selection,
        ended: false,
      };
      desktopDragRef.current = runtime;
      beginMovementAssist(
        selection.primaryId,
        selection.positions,
        selection.snapNodeIds,
      );
      return runtime;
    }

    if (event.nodeKind === "group") {
      const group = groups.find(({ nodeId }) => nodeId === event.nodeId);
      if (!group) return undefined;
      const drag = captureGroupDrag(group);
      const runtime: DesktopDragRuntime = {
        event,
        startX: drag.startX,
        startY: drag.startY,
        group: drag,
        ended: false,
      };
      desktopDragRef.current = runtime;
      beginMovementAssist(
        drag.nodeId,
        new Map<string, CanvasSnapPoint>([
          [drag.nodeId, { x: drag.startX, y: drag.startY }],
          ...drag.members.map((member) => [
            member.landmarkId,
            { x: member.x, y: member.y },
          ] as const),
          ...drag.nestedGroups.map((nested) => [
            nested.nodeId,
            { x: nested.x, y: nested.y },
          ] as const),
        ]),
        new Set([drag.nodeId]),
      );
      return runtime;
    }

    const placement = resolvedPlacements.get(event.nodeId);
    if (!placement) return undefined;
    const runtime: DesktopDragRuntime = {
      event,
      startX: placement.x,
      startY: placement.y,
      ended: false,
    };
    desktopDragRef.current = runtime;
    beginMovementAssist(
      event.nodeId,
      new Map([[event.nodeId, { x: placement.x, y: placement.y }]]),
      new Set([event.nodeId]),
    );
    return runtime;
  }, [beginMovementAssist, buildSelectionMove, captureGroupDrag, groups, resolvedPlacements]);

  const previewDesktopDrag = useCallback((
    runtime: DesktopDragRuntime,
    event: DesktopCanvasDragEvent,
  ) => {
    const rawDelta = desktopCanvasDragDelta(event);
    const delta = event.phase === "start"
      ? { x: 0, y: 0 }
      : resolveMovementAssist(event.nodeId, rawDelta, {
          altKey: event.smartSnapDisabled,
          axisLock: event.axisLock,
        });
    runtime.event = {
      ...event,
      pointer: {
        x: event.startPointer.x + delta.x,
        y: event.startPointer.y + delta.y,
      },
    };
    if (runtime.selection) {
      renderSelectionMove(runtime.selection, delta.x, delta.y);
      return;
    }
    if (runtime.group) {
      renderGroupDrag(runtime.group, delta.x, delta.y, true);
      return;
    }
    setNodes((current) => current.map((node) =>
      node.id === event.nodeId && isLandmarkNode(node)
        ? {
            ...node,
            position: {
              x: runtime.startX + delta.x,
              y: runtime.startY + delta.y,
            },
          }
        : node
    ));
  }, [renderGroupDrag, renderSelectionMove, resolveMovementAssist, setNodes]);

  const applyDesktopDrag = useCallback((event: DesktopCanvasDragEvent) => {
    const runtime = ensureDesktopDrag(event);
    if (!runtime || runtime.ended) return;
    cancelGroupDragPreview();
    // Every surface, including the native landmark owner, renders the same
    // resolved packet. This makes the magnetic result authoritative and avoids
    // React Flow choosing a different grid point at a monitor boundary.
    previewDesktopDrag(runtime, event);
    if (event.phase === "start" || event.phase === "move") {
      // Remote monitor surfaces participate in the same gesture even though
      // React Flow never emits a native onNodeDragStart there. Mark them busy
      // so a camera packet cannot move the world underneath the pointer.
      setIsNodeDragging(true);
      return;
    }

    runtime.ended = true;
    rememberFinishedDesktopGesture(event.gestureId);

    // Pointer-up can occur in a different WebView. In that case the origin may
    // never receive React Flow's native drag-stop/lost-capture callbacks, so
    // the transport's terminal packet must release every matching logical
    // owner. Otherwise Delete stays blocked and a deferred camera can replay
    // on some unrelated later gesture.
    const nativeDrag = activeNodeDragRef.current;
    if (nativeDrag?.primaryId === event.nodeId) {
      if (event.phase === "cancel") {
        cancelledNodeDragsRef.current.add(nativeDrag.primaryId);
        cancelledNodeDragStatesRef.current.set(nativeDrag.primaryId, nativeDrag);
      }
      activeNodeDragRef.current = undefined;
    }
    if (activeDirectGestureRef.current?.nodeId === event.nodeId) {
      activeDirectGestureRef.current = undefined;
      if (event.phase === "cancel") {
        setInteractionCancelToken((current) => current + 1);
      }
    }
    setIsNodeDragging(false);

    if (event.phase === "cancel") {
      if (runtime.selection) renderSelectionMove(runtime.selection, 0, 0);
      else if (runtime.group) renderGroupDrag(runtime.group, 0, 0, true);
      else {
        setNodes((current) => current.map((node) =>
          node.id === event.nodeId && isLandmarkNode(node)
            ? { ...node, position: { x: runtime.startX, y: runtime.startY } }
            : node
        ));
      }
      groupDragRef.current = undefined;
      clearMovementAssist();
      return;
    }

    // The surface that actually sees pointer-up owns persistence. This keeps a
    // cross-monitor drop safe even if the origin WebView closed during the
    // handoff. The module-level tombstone prevents a retained `end` packet from
    // committing again after AtlasGraph remounts.
    const persistenceSurfaceId = event.finalizerSurfaceId ?? event.ownerSurfaceId;
    if (
      persistenceSurfaceId === desktopSurfaceId &&
      !committedDesktopGestures.has(event.gestureId)
    ) {
      rememberCommittedDesktopGesture(event.gestureId);
      const delta = desktopCanvasDragDelta(runtime.event);
      if (runtime.selection) {
        commitSelectionMove(
          runtime.selection,
          runtime.startX + delta.x,
          runtime.startY + delta.y,
        );
      } else if (runtime.group) {
        commitGroupDrag(
          runtime.group,
          runtime.startX + delta.x,
          runtime.startY + delta.y,
        );
      } else {
        onPlacementChange({
          landmarkId: event.nodeId,
          x: runtime.startX + delta.x,
          y: runtime.startY + delta.y,
        });
      }
    }
    groupDragRef.current = undefined;
    clearMovementAssist();
  }, [
    cancelGroupDragPreview,
    clearMovementAssist,
    commitSelectionMove,
    commitGroupDrag,
    desktopSurfaceId,
    ensureDesktopDrag,
    onPlacementChange,
    previewDesktopDrag,
    rememberFinishedDesktopGesture,
    renderGroupDrag,
    renderSelectionMove,
    setNodes,
  ]);

  const publishDesktopDrag = useCallback((event: DesktopCanvasDragEvent) => {
    applyDesktopDrag(event);
    onDesktopCanvasDrag?.(event);
  }, [applyDesktopDrag, onDesktopCanvasDrag]);

  const beginDesktopDrag = useCallback((
    node: AtlasGraphNode,
    clientPoint: DesktopCanvasPoint,
  ) => {
    if (!desktopSurfaceId || !onDesktopCanvasDrag) return;
    const pointer = flowPointForClient(clientPoint);
    if (!pointer) return;
    const current = desktopDragRef.current;
    if (current && !current.ended) {
      publishDesktopDrag({ ...current.event, phase: "cancel" });
    }
    const event: DesktopCanvasDragEvent = {
      gestureId: canvasGestureId(desktopSurfaceId),
      ownerSurfaceId: desktopSurfaceId,
      nodeId: node.id,
      nodeKind: isRegionNode(node) ? "group" : "landmark",
      ...(selectedCanvasNodeIds.has(node.id) && selectedCanvasNodeIds.size > 1
        ? { selectionNodeIds: [...selectedCanvasNodeIds] }
        : {}),
      phase: "start",
      startPointer: pointer,
      pointer,
    };
    publishDesktopDrag(event);
  }, [desktopSurfaceId, flowPointForClient, onDesktopCanvasDrag, publishDesktopDrag, selectedCanvasNodeIds]);

  const forwardDesktopPointer = useCallback((
    phase: "move" | "end" | "cancel",
    clientPoint?: DesktopCanvasPoint,
    modifiers: CanvasMovementModifiers = {},
  ) => {
    const runtime = desktopDragRef.current;
    if (!runtime || runtime.ended) return;
    const rawPointer = clientPoint
      ? flowPointForClient(clientPoint) ?? runtime.event.pointer
      : runtime.event.pointer;
    const rawDelta = {
      x: rawPointer.x - runtime.event.startPointer.x,
      y: rawPointer.y - runtime.event.startPointer.y,
    };
    const delta = phase === "cancel"
      ? rawDelta
      : resolveMovementAssist(runtime.event.nodeId, rawDelta, modifiers);
    const pointer = {
      x: runtime.event.startPointer.x + delta.x,
      y: runtime.event.startPointer.y + delta.y,
    };
    publishDesktopDrag({
      ...runtime.event,
      phase,
      pointer,
      smartSnapDisabled: modifiers.altKey || undefined,
      axisLock: movementAssistRef.current?.axisLock,
      ...(phase === "end" && desktopSurfaceId
        ? { finalizerSurfaceId: desktopSurfaceId }
        : {}),
    });
  }, [desktopSurfaceId, flowPointForClient, publishDesktopDrag, resolveMovementAssist]);

  useEffect(() => {
    if (!desktopSurfaceId || !onDesktopCanvasDrag) return;
    const move = (event: PointerEvent) => {
      const runtime = desktopDragRef.current;
      if (!runtime || runtime.ended) return;
      // A receiving monitor may retain a remote `start` after the physical
      // release happened elsewhere. Never turn ordinary no-button hover into
      // continued movement merely because this surface is not the origin.
      if ((event.buttons & 1) === 1) {
        forwardDesktopPointer(
          "move",
          { x: event.clientX, y: event.clientY },
          { shiftKey: event.shiftKey, altKey: event.altKey },
        );
      } else {
        forwardDesktopPointer(
          "end",
          { x: event.clientX, y: event.clientY },
          { shiftKey: event.shiftKey, altKey: event.altKey },
        );
      }
    };
    const end = (event: PointerEvent) => {
      if (event.button !== 0 && event.buttons !== 0) return;
      forwardDesktopPointer(
        "end",
        { x: event.clientX, y: event.clientY },
        { shiftKey: event.shiftKey, altKey: event.altKey },
      );
    };
    const cancelFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      forwardDesktopPointer("cancel");
    };
    const cancelFromPointer = () => {
      const active = activeNodeDragRef.current;
      if (active) {
        cancelledNodeDragsRef.current.add(active.primaryId);
        cancelledNodeDragStatesRef.current.set(active.primaryId, active);
        activeNodeDragRef.current = undefined;
        setIsNodeDragging(false);
        setNodes((current) => current.map((node) => {
          const origin = active.positions.get(node.id);
          return origin ? { ...node, position: { ...origin } } : node;
        }));
      }
      forwardDesktopPointer("cancel");
    };
    const cancelFromPageLifecycle = () => forwardDesktopPointer("cancel");
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", cancelFromPointer, true);
    window.addEventListener("pagehide", cancelFromPageLifecycle);
    window.addEventListener("keydown", cancelFromKeyboard, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", cancelFromPointer, true);
      window.removeEventListener("pagehide", cancelFromPageLifecycle);
      window.removeEventListener("keydown", cancelFromKeyboard, true);
    };
  }, [desktopSurfaceId, forwardDesktopPointer, onDesktopCanvasDrag, setNodes]);

  useEffect(() => {
    if (!desktopCanvasDrag) return;
    applyDesktopDrag(desktopCanvasDrag);
  }, [applyDesktopDrag, desktopCanvasDrag]);

  const handleNodeDragStart = useCallback<OnNodeDrag<AtlasGraphNode>>((event, node, draggedNodes) => {
    // Region nodes are deliberately not owned by React Flow's drag engine;
    // their nameplates use the single group gesture below.
    if (isRegionNode(node)) return;
    setMenu(undefined);
    clearConnectionSelection();
    const additive = !desktopSurfaceId && "ctrlKey" in event && Boolean(
      event.ctrlKey || event.metaKey || event.shiftKey
    );
    const primaryWasSelected = selectedCanvasNodeIds.has(node.id);
    if (!primaryWasSelected) {
      // XYFlow decides its drag closure before this callback. When a modifier
      // drag already contains the prior selection plus this node, mirror that
      // closure instead of painting only the primary as selected while several
      // objects move. Desktop transports the explicit selection separately.
      requestCanvasNodeSelection(node.id, additive ? "add" : "replace");
    }
    const gestureSelectionIds = primaryWasSelected
      ? new Set(selectedCanvasNodeIds)
      : additive
        ? new Set([...selectedCanvasNodeIds, node.id])
        : new Set([node.id]);
    if (!desktopSurfaceId && (primaryWasSelected || additive)) {
      (draggedNodes ?? []).forEach((candidate) => {
        if (candidate.selected) gestureSelectionIds.add(candidate.id);
      });
    }
    const selection = buildSelectionMove(node.id, gestureSelectionIds);
    const candidates = (draggedNodes?.length ? draggedNodes : [node])
      .filter(isLandmarkNode);
    const positions = selection?.positions ?? new Map(candidates.map((candidate) => [
      candidate.id,
      { ...candidate.position },
    ]));
    const pending = pendingLandmarkPointerRef.current;
    pendingLandmarkPointerRef.current = undefined;
    const startPoint = pending?.nodeId === node.id
      ? { x: pending.clientX, y: pending.clientY }
      : "clientX" in event && "clientY" in event
        ? { x: event.clientX, y: event.clientY }
        : undefined;
    activeNodeDragRef.current = {
      primaryId: node.id,
      positions,
      selection,
      pointerStart: startPoint ? flowPointForClient(startPoint) : undefined,
      lastDelta: { x: 0, y: 0 },
    };
    cancelledNodeDragsRef.current.delete(node.id);
    cancelledNodeDragStatesRef.current.delete(node.id);
    setIsNodeDragging(true);
    if (
      desktopSurfaceId &&
      onDesktopCanvasDrag &&
      "clientX" in event &&
      "clientY" in event
    ) {
      beginDesktopDrag(node, startPoint ?? { x: event.clientX, y: event.clientY });
      // The move that crossed React Flow's threshold reached window capture
      // before onNodeDragStart created the transferable runtime. Publish it
      // now so the first few pixels are not lost at the monitor seam.
      forwardDesktopPointer(
        "move",
        { x: event.clientX, y: event.clientY },
        { shiftKey: event.shiftKey, altKey: event.altKey },
      );
    } else {
      beginMovementAssist(
        node.id,
        positions,
        selection?.snapNodeIds ?? new Set([node.id]),
      );
    }
  }, [
    beginDesktopDrag,
    beginMovementAssist,
    buildSelectionMove,
    clearConnectionSelection,
    desktopSurfaceId,
    forwardDesktopPointer,
    flowPointForClient,
    onDesktopCanvasDrag,
    requestCanvasNodeSelection,
    selectedCanvasNodeIds,
  ]);

  const handleNodeDrag = useCallback<OnNodeDrag<AtlasGraphNode>>((event, node) => {
    if (isRegionNode(node)) return;
    const active = activeNodeDragRef.current;
    if (cancelledNodeDragsRef.current.has(node.id)) {
      const cancelled = cancelledNodeDragStatesRef.current.get(node.id) ?? active;
      if (cancelled?.primaryId === node.id) setNodes((current) => current.map((candidate) => {
        const origin = cancelled.positions.get(candidate.id);
        return origin ? { ...candidate, position: { ...origin } } : candidate;
      }));
      return;
    }
    if (!active || active.primaryId !== node.id) return;
    // Desktop pointer capture owns the shared delta and writes the preview on
    // every surface. Letting the native owner resolve it again causes a small
    // but visible tug-of-war at monitor seams.
    if (desktopDragRef.current?.event.nodeId === node.id) return;
    const pointer = "clientX" in event && "clientY" in event
      ? flowPointForClient({ x: event.clientX, y: event.clientY })
      : undefined;
    const origin = active.positions.get(node.id);
    const rawDelta = pointer && active.pointerStart
      ? { x: pointer.x - active.pointerStart.x, y: pointer.y - active.pointerStart.y }
      : origin
        ? { x: node.position.x - origin.x, y: node.position.y - origin.y }
        : active.lastDelta;
    const delta = resolveMovementAssist(node.id, rawDelta, {
      shiftKey: "shiftKey" in event && event.shiftKey,
      altKey: "altKey" in event && event.altKey,
    });
    active.lastDelta = delta;
    renderCapturedPositions(active.positions, delta);
  }, [flowPointForClient, renderCapturedPositions, resolveMovementAssist, setNodes]);

  const handleNodeDragStop = useCallback<OnNodeDrag<AtlasGraphNode>>((event, node, _draggedNodes) => {
    if (isRegionNode(node)) return;
    setIsNodeDragging(false);
    const active = activeNodeDragRef.current;
    activeNodeDragRef.current = undefined;
    if (cancelledNodeDragsRef.current.delete(node.id)) {
      const cancelled = cancelledNodeDragStatesRef.current.get(node.id) ?? active;
      cancelledNodeDragStatesRef.current.delete(node.id);
      if (cancelled?.primaryId === node.id) setNodes((current) => current.map((candidate) => {
        const origin = cancelled.positions.get(candidate.id);
        return origin ? { ...candidate, position: { ...origin } } : candidate;
      }));
      clearMovementAssist();
      return;
    }
    const desktopDrag = desktopDragRef.current;
    if (desktopDrag?.event.nodeId === node.id) {
      if (!desktopDrag.ended) {
        if ("clientX" in event && "clientY" in event) {
          forwardDesktopPointer(
            "end",
            { x: event.clientX, y: event.clientY },
            { shiftKey: event.shiftKey, altKey: event.altKey },
          );
        } else {
          publishDesktopDrag({
            ...desktopDrag.event,
            phase: "end",
            ...(desktopSurfaceId ? { finalizerSurfaceId: desktopSurfaceId } : {}),
            pointer: {
              x: desktopDrag.event.startPointer.x + node.position.x - desktopDrag.startX,
              y: desktopDrag.event.startPointer.y + node.position.y - desktopDrag.startY,
            },
          });
        }
      }
      return;
    }
    if (!active || active.primaryId !== node.id) {
      onPlacementChange({
        landmarkId: node.id,
        x: snap(node.position.x),
        y: snap(node.position.y),
      });
      clearMovementAssist();
      return;
    }
    const pointer = "clientX" in event && "clientY" in event
      ? flowPointForClient({ x: event.clientX, y: event.clientY })
      : undefined;
    const origin = active.positions.get(node.id);
    const rawDelta = pointer && active.pointerStart
      ? { x: pointer.x - active.pointerStart.x, y: pointer.y - active.pointerStart.y }
      : origin
        ? { x: node.position.x - origin.x, y: node.position.y - origin.y }
        : active.lastDelta;
    const delta = resolveMovementAssist(node.id, rawDelta, {
      shiftKey: "shiftKey" in event && event.shiftKey,
      altKey: "altKey" in event && event.altKey,
    });
    active.lastDelta = delta;
    renderCapturedPositions(active.positions, delta);
    clearMovementAssist();
    if (active.selection) {
      commitSelectionMove(
        active.selection,
        active.selection.primaryStartX + delta.x,
        active.selection.primaryStartY + delta.y,
      );
      return;
    }
    const placements = [...active.positions].flatMap(([id, position]) => (
      resolvedPlacements.has(id)
        ? [{ landmarkId: id, x: position.x + delta.x, y: position.y + delta.y }]
        : []
    ));
    if (placements.length > 1) onPlacementChanges(placements);
    else if (placements[0]) onPlacementChange(placements[0]);
  }, [
    clearMovementAssist,
    desktopSurfaceId,
    commitSelectionMove,
    flowPointForClient,
    forwardDesktopPointer,
    onPlacementChange,
    onPlacementChanges,
    publishDesktopDrag,
    renderCapturedPositions,
    resolveMovementAssist,
    resolvedPlacements,
    setNodes,
  ]);

  titleDragHandlersRef.current = {
    start: (regionId, startClientX, startClientY, clientX, clientY, shiftKey, altKey) => {
      cancelGroupDragPreview();
      const group = groupByRegionId.get(regionId);
      if (group) {
        setIsNodeDragging(true);
        const node = regionNodes.find((candidate) => candidate.id === group.nodeId);
        if (node && desktopSurfaceId && onDesktopCanvasDrag) {
          beginDesktopDrag(node, { x: startClientX, y: startClientY });
          forwardDesktopPointer(
            "move",
            { x: clientX, y: clientY },
            { shiftKey, altKey },
          );
        } else {
          const selection = buildSelectionMove(group.nodeId);
          if (selection) {
            selectionMoveRef.current = selection;
            beginMovementAssist(
              selection.primaryId,
              selection.positions,
              selection.snapNodeIds,
            );
          } else {
            const drag = captureGroupDrag(group);
            const positions = new Map<string, CanvasSnapPoint>([
              [drag.nodeId, { x: drag.startX, y: drag.startY }],
              ...drag.members.map((member) => [
                member.landmarkId,
                { x: member.x, y: member.y },
              ] as const),
              ...drag.nestedGroups.map((nested) => [
                nested.nodeId,
                { x: nested.x, y: nested.y },
              ] as const),
            ]);
            beginMovementAssist(drag.nodeId, positions, new Set([drag.nodeId]));
          }
        }
      }
    },
    move: (regionId, x, y, _clientX, _clientY, shiftKey, altKey) => {
      const group = groupByRegionId.get(regionId);
      const selection = selectionMoveRef.current;
      const drag = groupDragRef.current;
      const desktopDrag = desktopDragRef.current;
      if (desktopDrag && group && desktopDrag.event.nodeId === group.nodeId) return;
      if (selection && group && selection.primaryId === group.nodeId) {
        const delta = resolveMovementAssist(
          selection.primaryId,
          { x, y },
          { shiftKey, altKey },
        );
        queueGroupDragPreview({
          selection,
          deltaX: delta.x,
          deltaY: delta.y,
          moveRoot: true,
        });
        return;
      }
      if (drag?.regionId === regionId) {
        const delta = resolveMovementAssist(
          drag.nodeId,
          { x, y },
          { shiftKey, altKey },
        );
        queueGroupDragPreview({ drag, deltaX: delta.x, deltaY: delta.y, moveRoot: true });
      }
    },
    end: (regionId, x, y, clientX, clientY, shiftKey, altKey) => {
      setIsNodeDragging(false);
      const group = groupByRegionId.get(regionId);
      const selection = selectionMoveRef.current;
      const drag = groupDragRef.current;
      const desktopDrag = desktopDragRef.current;
      if (desktopDrag && group && desktopDrag.event.nodeId === group.nodeId) {
        if (!desktopDrag.ended) {
          forwardDesktopPointer(
            "end",
            { x: clientX, y: clientY },
            { shiftKey, altKey },
          );
        }
        return;
      }
      selectionMoveRef.current = undefined;
      groupDragRef.current = undefined;
      if (selection && group && selection.primaryId === group.nodeId) {
        const delta = resolveMovementAssist(
          selection.primaryId,
          { x, y },
          { shiftKey, altKey },
        );
        const finalX = selection.primaryStartX + delta.x;
        const finalY = selection.primaryStartY + delta.y;
        flushGroupDragPreview({
          selection,
          deltaX: delta.x,
          deltaY: delta.y,
          moveRoot: true,
        });
        clearMovementAssist();
        commitSelectionMove(selection, finalX, finalY);
        return;
      }
      if (!drag || drag.regionId !== regionId) return;
      const delta = resolveMovementAssist(
        drag.nodeId,
        { x, y },
        { shiftKey, altKey },
      );
      const finalX = drag.startX + delta.x;
      const finalY = drag.startY + delta.y;
      flushGroupDragPreview({
        drag,
        deltaX: delta.x,
        deltaY: delta.y,
        moveRoot: true,
      });
      clearMovementAssist();
      commitGroupDrag(drag, finalX, finalY);
    },
    cancel: (regionId) => {
      setIsNodeDragging(false);
      const group = groupByRegionId.get(regionId);
      const selection = selectionMoveRef.current;
      const drag = groupDragRef.current;
      const desktopDrag = desktopDragRef.current;
      if (desktopDrag && group && desktopDrag.event.nodeId === group.nodeId && !desktopDrag.ended) {
        forwardDesktopPointer("cancel");
        return;
      }
      if (selection && group && selection.primaryId === group.nodeId) {
        cancelGroupDragPreview();
        renderSelectionMove(selection, 0, 0);
        selectionMoveRef.current = undefined;
        clearMovementAssist();
        return;
      }
      if (!drag || drag.regionId !== regionId) return;
      cancelGroupDragPreview();
      renderGroupDrag(drag, 0, 0, true);
      groupDragRef.current = undefined;
      clearMovementAssist();
    },
  };

  const handleEdgeClick = useCallback<EdgeMouseHandler<Edge>>((event, edge) => {
    setMenu(undefined);
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      clearActiveShellSelection();
      clearCanvasNodeSelection();
      setSelectedConnectionIds(new Set([edge.id]));
    }
  }, [clearActiveShellSelection, clearCanvasNodeSelection]);

  const handleEdgeContextMenu = useCallback<EdgeMouseHandler<Edge>>((event, edge) => {
    event.preventDefault();
    if (!selectedConnectionIds.has(edge.id)) {
      clearActiveShellSelection(true);
      clearCanvasNodeSelection();
      selectOnlyConnection(edge.id);
    }
    setMenu({ kind: "connection", connectionId: edge.id, x: event.clientX, y: event.clientY });
  }, [clearActiveShellSelection, clearCanvasNodeSelection, selectOnlyConnection, selectedConnectionIds]);

  const handleEdgesChange = useCallback<OnEdgesChange<Edge>>((changes) => {
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (!selectionChanges.length) return;
    setSelectedConnectionIds((current) => {
      const next = new Set(current);
      selectionChanges.forEach((change) => {
        next.delete(change.id);
        if (change.selected) next.add(change.id);
      });
      return next;
    });
  }, []);

  const subjectAt = useCallback((x: number, y: number) => {
    const containing = groups
      .filter((group) => objectShapeContainsPoint(
        group.shape,
        (x - group.x) / group.width,
        (y - group.y) / group.height,
      ))
      .sort((left, right) => left.width * left.height - right.width * right.height)[0];
    if (containing) return containing.region.subjectId;

    const firstSnapshotSubject = snapshot.subjects[0];
    if (!firstSnapshotSubject) return "root";
    return snapshot.subjects.reduce((best, subject) => {
      const point = zoneDefaults.get(subject.id)?.x ?? 0;
      const bestPoint = zoneDefaults.get(best.id)?.x ?? 0;
      return Math.abs(x - point) < Math.abs(x - bestPoint) ? subject : best;
    }, firstSnapshotSubject).id;
  }, [groups, snapshot.subjects, zoneDefaults]);

  const placeDroppedNotes = useCallback((
    notes: readonly NoteFileDragItem[],
    point: { x: number; y: number },
  ) => {
    const instance = flowRef.current;
    if (!instance) return;

    const flow = instance.screenToFlowPosition(point);
    const subjectId = subjectAt(flow.x, flow.y);
    void import("./batchNotePlacement").then(({ placeDroppedNotes: place }) => {
      void place(
        notes,
        flow,
        subjectId,
        groups,
        snapshot.regions,
        visibleGroupLandmarks,
        resolvedPlacements,
        landmarkDimensions,
        [GRID, LANDMARK_WIDTH, LANDMARK_HEIGHT, INFORMAL_NOTE_HEIGHT],
        onPlaceNotes,
        onPlaceNote,
      );
    });
  }, [
    groups,
    landmarkDimensions,
    onPlaceNote,
    onPlaceNotes,
    resolvedPlacements,
    snapshot.regions,
    subjectAt,
    visibleGroupLandmarks,
  ]);
  const noteFileDrop = useNoteFileDropTarget(
    onPlaceNotes || onPlaceNote ? placeDroppedNotes : undefined,
  );

  const closeMenu = useCallback(() => {
    landmarkCreationAttemptRef.current += 1;
    setLandmarkCreationKind(undefined);
    setGroupCreationLevel(undefined);
    setGroupSurfacePreview(undefined);
    setInformalNotePending(false);
    setInformalNoteError(undefined);
    setMenu(undefined);
  }, []);

  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent<Element>) => {
    event.preventDefault();
    const instance = flowRef.current;
    if (!instance) return;
    const flow = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const flowX = snap(flow.x);
    const flowY = snap(flow.y);
    landmarkCreationAttemptRef.current += 1;
    setLandmarkCreationKind(undefined);
    setGroupCreationLevel(undefined);
    setInformalNotePending(false);
    setInformalNoteError(undefined);
    setMenu({ kind: "canvas", x: event.clientX, y: event.clientY, flowX, flowY, subjectId: subjectAt(flowX, flowY) });
    clearActiveShellSelection(true);
    clearCanvasNodeSelection();
    clearConnectionSelection();
  }, [clearActiveShellSelection, clearCanvasNodeSelection, clearConnectionSelection, subjectAt]);

  const submitLandmarkCreation = useCallback(async (
    kind: EditableLandmarkKind,
    title: string,
  ) => {
    if (
      menu?.kind !== "canvas" ||
      !onCreateLandmark
    ) return;

    const attempt = landmarkCreationAttemptRef.current + 1;
    landmarkCreationAttemptRef.current = attempt;
    const subject = snapshot.subjects.find(({ id }) => id === menu.subjectId);
    const region = snapshot.regions.find(({ subjectId }) => subjectId === menu.subjectId);
    const height = kind === "concept" ? INFORMAL_NOTE_HEIGHT : LANDMARK_HEIGHT;
    try {
      await onCreateLandmark({
        title,
        kind,
        subjectId: menu.subjectId,
        regionId: region?.id ?? subjectZoneKey(menu.subjectId),
        x: snap(menu.flowX - LANDMARK_WIDTH / 2),
        y: snap(menu.flowY - height / 2),
        color: SUBJECT_RAINBOW_COLORS[menu.subjectId] ?? subject?.accent ?? "#333333",
        shape: defaultLandmarkShape(kind),
      });
      if (landmarkCreationAttemptRef.current !== attempt) return;
      setLandmarkCreationKind(undefined);
      setGroupCreationLevel(undefined);
      setMenu(undefined);
    } catch (cause) {
      if (landmarkCreationAttemptRef.current !== attempt) return;
      throw cause;
    }
  }, [menu, onCreateLandmark, snapshot.regions, snapshot.subjects]);

  const beginLandmarkCreation = useCallback((kind: EditableLandmarkKind) => {
    if (menu?.kind !== "canvas" || !onCreateLandmark || informalNotePending) return;
    setGroupCreationLevel(undefined);
    setInformalNoteError(undefined);
    if (kind !== "concept") {
      landmarkCreationAttemptRef.current += 1;
      setLandmarkCreationKind(kind);
      return;
    }

    // An informal paper note is its body, not a separately named mathematical
    // object. Create its backing file immediately; the shell opens the empty
    // live-preview editor as soon as this promise resolves.
    setLandmarkCreationKind(undefined);
    setInformalNotePending(true);
    void submitLandmarkCreation(kind, "").catch((cause: unknown) => {
      setInformalNoteError(
        cause instanceof Error ? cause.message : "The note could not be created.",
      );
    }).finally(() => setInformalNotePending(false));
  }, [informalNotePending, menu?.kind, onCreateLandmark, submitLandmarkCreation]);

  const beginGroupCreation = useCallback((level: GroupLevel) => {
    if (menu?.kind !== "canvas") return;
    landmarkCreationAttemptRef.current += 1;
    setLandmarkCreationKind(undefined);
    setInformalNoteError(undefined);
    setGroupCreationLevel(level);
  }, [menu?.kind]);

  const createGroup = useCallback((level: GroupLevel, title: string) => {
    if (menu?.kind !== "canvas") return;
    const possibleParents = level === "subject"
      ? []
      : groups.filter((group) =>
          group.level === (level === "group" ? "subject" : "group") &&
          objectShapeContainsPoint(
            group.shape,
            (menu.flowX - group.x) / group.width,
            (menu.flowY - group.y) / group.height,
          )
        ).sort((left, right) => left.width * left.height - right.width * right.height);
    const parent = possibleParents[0] ?? (
      level === "subgroup"
        ? groups.find((group) => group.level === "subject" && group.region.subjectId === menu.subjectId)
        : undefined
    );
    const subjectId = level === "subject"
      ? uniqueId("subject")
      : parent?.region.subjectId ?? menu.subjectId;
    const defaults = level === "subject"
      ? { width: 1120, height: 700, shape: "rounded-rectangle" as const, borderStyle: "solid" as const }
      : level === "group"
        ? { width: 700, height: 448, shape: "rectangle" as const, borderStyle: "solid" as const }
        : { width: 420, height: 252, shape: "oval" as const, borderStyle: "solid" as const };
    onCustomizationsChange((current) => ({
      ...current,
      customGroups: [...current.customGroups, {
        id: uniqueId("group"),
        title,
        subjectId,
        level,
        ...(parent ? { parentId: parent.region.id } : {}),
        x: snap(menu.flowX - defaults.width / 2),
        y: snap(menu.flowY - defaults.height / 2),
        width: defaults.width,
        height: defaults.height,
        color: DEFAULT_GROUP_COLOR,
        shape: defaults.shape,
        borderStyle: defaults.borderStyle,
        ...(level === "subject" ? { subjectFrameStyle: DEFAULT_SUBJECT_FRAME_STYLE } : {}),
        titlePosition: "top-left",
      }],
    }));
    setGroupCreationLevel(undefined);
    setMenu(undefined);
  }, [groups, menu, onCustomizationsChange]);

  const deleteCustomGroup = useCallback((regionId: string) => {
    onCustomizationsChange((current) => {
      const removed = current.customGroups.find(({ id }) => id === regionId);
      return {
        ...current,
        customGroups: current.customGroups.flatMap((group) => {
          if (group.id === regionId) return [];
          if (group.parentId !== regionId) return [group];
          const { parentId: _discarded, ...withoutParent } = group;
          return [{ ...withoutParent, ...(removed?.parentId ? { parentId: removed.parentId } : {}) }];
        }),
        customConnections: current.customConnections.filter(({ source, target }) => source !== `custom-group:${regionId}` && target !== `custom-group:${regionId}`),
      };
    });
    setSelectedCanvasNodeIds((current) => {
      const nodeId = `custom-group:${regionId}`;
      if (!current.has(nodeId)) return current;
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setMenu(undefined);
  }, [onCustomizationsChange]);

  const deleteSelectedCanvasObjects = useCallback(() => {
    if (
      !onRemoveCanvasObjects ||
      isConnecting ||
      isNodeDragging ||
      reconnectGestureRef.current ||
      groupDragRef.current ||
      selectionMoveRef.current ||
      activeDirectGestureRef.current ||
      activeNodeDragRef.current ||
      movementAssistRef.current ||
      (desktopDragRef.current && !desktopDragRef.current.ended)
    ) return false;
    const landmarkIds: string[] = [];
    const customGroupIds: string[] = [];
    nodeBlueprints.forEach((node) => {
      if (!selectedCanvasNodeIds.has(node.id)) return;
      if (isLandmarkNode(node)) {
        landmarkIds.push(node.id);
      } else if (node.data.variant === "custom") {
        customGroupIds.push(node.data.regionId);
      }
    });
    const connectionIds = [...selectedConnectionIds].filter((id) => (
      baseEdges.some((edge) => edge.id === id)
    ));
    if (!landmarkIds.length && !customGroupIds.length && !connectionIds.length) return false;

    onRemoveCanvasObjects({ landmarkIds, customGroupIds, connectionIds });

    clearCanvasNodeSelection();
    clearConnectionSelection();
    setMenu(undefined);
    return true;
  }, [
    baseEdges,
    clearCanvasNodeSelection,
    clearConnectionSelection,
    isConnecting,
    isNodeDragging,
    nodeBlueprints,
    onRemoveCanvasObjects,
    selectedCanvasNodeIds,
    selectedConnectionIds,
  ]);

  const isValidConnection = useCallback((connection: Edge | FlowConnection) => {
    return canCreateConnection(connection, connectionKeys, reconnectGestureRef.current);
  }, [connectionKeys]);

  const handleMove = useCallback<OnMove>((_event, viewport) => {
    setZoomTier((current) => canvasZoomTier(current, viewport.zoom));
    if (
      !viewportGestureRef.current ||
      !viewportReadyRef.current ||
      applyingExternalViewportRef.current
    ) return;
    onViewportChange?.(viewport);
  }, [onViewportChange]);

  useEffect(() => {
    const previousExternalViewport = lastExternalViewportRef.current;
    // App stores each received camera object verbatim, so identity represents
    // a new remote-camera event. Do not collapse equal coordinates here: a
    // companion may intentionally resend the last camera after this surface
    // has panned somewhere else. The instance comparison below still avoids a
    // redundant setViewport when the visible camera already matches.
    const externalViewportChanged = externalViewport !== previousExternalViewport;
    lastExternalViewportRef.current = externalViewport;

    const instance = flowRef.current;
    if (!instance || viewportGestureRef.current) return;
    const desktopGestureActive = Boolean(
      desktopDragRef.current && !desktopDragRef.current.ended,
    );
    if (isNodeDragging || isConnecting || desktopGestureActive) {
      // Entering a drag with an unchanged prop must not queue that prop: after
      // a local pan it may be an old stored camera, and applying it on
      // pointer-up teleports every monitor back to the same stale location.
      // A genuinely new remote camera is still deferred until the gesture is
      // over so it cannot fight direct manipulation.
      if (externalViewportChanged) {
        pendingExternalViewportRef.current = externalViewport;
      }
      return;
    }
    // If a newer prop and a deferred camera arrive in the same render, the
    // newest prop wins. An explicit removal also discards any stale pending
    // value instead of replaying it.
    const targetViewport = externalViewportChanged
      ? externalViewport
      : pendingExternalViewportRef.current;
    pendingExternalViewportRef.current = undefined;
    if (!targetViewport) return;
    if (sameViewport(instance.getViewport(), targetViewport)) {
      viewportReadyRef.current = true;
      return;
    }
    applyingExternalViewportRef.current = targetViewport;
    void instance.setViewport(targetViewport, { duration: 0 }).finally(() => {
      if (applyingExternalViewportRef.current === targetViewport) {
        applyingExternalViewportRef.current = undefined;
      }
      viewportReadyRef.current = true;
    });
  }, [externalViewport, isConnecting, isNodeDragging]);

  const handleMoveEnd = useCallback<OnMove>((_event, viewport) => {
    setIsNavigating(false);
    const wasLocalGesture = viewportGestureRef.current;
    viewportGestureRef.current = false;
    if (applyingExternalViewportRef.current) {
      applyingExternalViewportRef.current = undefined;
      viewportReadyRef.current = true;
      return;
    }
    // React Flow also emits move-end for setViewport/fitView/setCenter. Only a
    // pointer or wheel gesture may publish through this lifecycle; deliberate
    // navigation commands publish explicitly after their promise resolves.
    if (!wasLocalGesture || !viewportReadyRef.current) return;
    onViewportChange?.(viewport);
    saveStoredViewport(viewportStorageKey, viewport);
  }, [onViewportChange, viewportStorageKey]);

  const initializeLocalViewport = useCallback((
    instance: ReactFlowInstance<AtlasGraphNode, Edge>,
  ) => {
    if (viewportReadyRef.current || initializingViewportRef.current) return;
    initializingViewportRef.current = true;
    const finish = () => {
      initializingViewportRef.current = false;
      viewportReadyRef.current = true;
      onViewportChange?.(instance.getViewport());
    };
    const storedViewport = loadStoredViewport(viewportStorageKey);
    if (storedViewport) {
      requestAnimationFrame(() => {
        void instance.setViewport(storedViewport, { duration: 0 }).finally(finish);
      });
      return;
    }
    const selected = nodeBlueprints.find((node) => node.id === selectedLandmarkId);
    const firstSubject = groups.find((group) => group.variant === "subject");
    const x = selected ? selected.position.x + (selected.width ?? LANDMARK_WIDTH) / 2 : (firstSubject?.x ?? 0) + 420;
    const y = selected ? selected.position.y + (selected.height ?? LANDMARK_HEIGHT) / 2 : (firstSubject?.y ?? 0) + 300;
    requestAnimationFrame(() => {
      void instance.setCenter(x, y, { zoom: .78, duration: 0 }).finally(finish);
    });
  }, [groups, nodeBlueprints, onViewportChange, selectedLandmarkId, viewportStorageKey]);

  useEffect(() => {
    if (deferInitialViewport || externalViewport || viewportReadyRef.current) return;
    const instance = flowRef.current;
    if (instance) initializeLocalViewport(instance);
  }, [deferInitialViewport, externalViewport, initializeLocalViewport]);

  const publishNavigationViewport = useCallback((
    instance: ReactFlowInstance<AtlasGraphNode, Edge>,
    operation: Promise<boolean>,
  ) => {
    void operation.then(() => {
      if (!viewportReadyRef.current) return;
      const viewport = instance.getViewport();
      onViewportChange?.(viewport);
      saveStoredViewport(viewportStorageKey, viewport);
    });
  }, [onViewportChange, viewportStorageKey]);

  const zoomMap = useCallback((direction: "in" | "out") => {
    const instance = flowRef.current;
    if (!instance) return;
    publishNavigationViewport(
      instance,
      direction === "in"
        ? instance.zoomIn({ duration: 120 })
        : instance.zoomOut({ duration: 120 }),
    );
  }, [publishNavigationViewport]);

  const fitMap = useCallback(() => {
    const instance = flowRef.current;
    if (!instance) return;
    publishNavigationViewport(
      instance,
      instance.fitView({ padding: .08, maxZoom: .92, duration: 180 }),
    );
  }, [publishNavigationViewport]);

  const focusSelected = useCallback(() => {
    const instance = flowRef.current;
    if (!instance) return;
    const selected = instance.getNodes().find((node) => node.selected) ??
      nodeBlueprints.find((node) => node.id === selectedLandmarkId);
    if (!selected && selectedConnectionId) {
      const connection = baseEdges.find((edge) => edge.id === selectedConnectionId);
      if (!connection) return;
      publishNavigationViewport(
        instance,
        instance.fitView({
          nodes: [{ id: connection.source }, { id: connection.target }],
          padding: .28,
          minZoom: .38,
          maxZoom: 1.05,
          duration: 180,
        }),
      );
      return;
    }
    if (!selected) return;
    publishNavigationViewport(
      instance,
      instance.setCenter(
        selected.position.x + (selected.width ?? LANDMARK_WIDTH) / 2,
        selected.position.y + (selected.height ?? LANDMARK_HEIGHT) / 2,
        { zoom: 1, duration: 180 },
      ),
    );
  }, [baseEdges, nodeBlueprints, publishNavigationViewport, selectedConnectionId, selectedLandmarkId]);

  const nudgeSelectedCanvasObjects = useCallback((delta: CanvasSnapPoint) => {
    const primaryId = [...selectedCanvasNodeIds][0];
    if (!primaryId) return false;
    setMenu(undefined);
    clearConnectionSelection();
    clearMovementAssist();

    const selection = buildSelectionMove(primaryId);
    if (selection) {
      renderSelectionMove(selection, delta.x, delta.y);
      commitSelectionMove(
        selection,
        selection.primaryStartX + delta.x,
        selection.primaryStartY + delta.y,
      );
      return true;
    }

    const group = groups.find(({ nodeId }) => nodeId === primaryId);
    if (group) {
      const drag = buildGroupDrag(group);
      renderGroupDrag(drag, delta.x, delta.y, true);
      commitGroupDrag(drag, drag.startX + delta.x, drag.startY + delta.y);
      return true;
    }

    const placement = resolvedPlacements.get(primaryId);
    if (!placement) return false;
    renderCapturedPositions(
      new Map([[primaryId, { x: placement.x, y: placement.y }]]),
      delta,
    );
    onPlacementChange({
      landmarkId: primaryId,
      x: placement.x + delta.x,
      y: placement.y + delta.y,
    });
    return true;
  }, [
    buildGroupDrag,
    buildSelectionMove,
    clearConnectionSelection,
    clearMovementAssist,
    commitGroupDrag,
    commitSelectionMove,
    groups,
    onPlacementChange,
    renderCapturedPositions,
    renderGroupDrag,
    renderSelectionMove,
    resolvedPlacements,
    selectedCanvasNodeIds,
  ]);

  const cancelCanvasInteraction = useCallback(() => {
    const hadInteraction = Boolean(
      menu ||
      isConnecting ||
      reconnectGestureRef.current ||
      groupDragRef.current ||
      activeDirectGestureRef.current ||
      activeNodeDragRef.current ||
      (desktopDragRef.current && !desktopDragRef.current.ended)
    );
    // Child nodes own pointer capture for exact contour/title gestures. Only
    // invalidate their data when one is actually active; an idle Escape on a
    // thousand-node atlas should remain a constant-cost selection command.
    if (activeDirectGestureRef.current) {
      setInteractionCancelToken((current) => current + 1);
    }
    activeDirectGestureRef.current = undefined;
    if (isConnecting || pendingConnectionRef.current) {
      cancelledConnectionRef.current = true;
    }
    pendingConnectionRef.current = undefined;
    const reconnectActive = Boolean(reconnectGestureRef.current);
    if (reconnectActive) cancelledReconnectRef.current = true;
    else reconnectGestureRef.current = undefined;
    setIsConnecting(false);
    setConnectionSourceNodeId(undefined);
    setMenu(undefined);
    setIsNavigating(false);
    setIsNodeDragging(false);

    // React Flow may continue delivering move events until the physical
    // pointer is released. Detach the active drag immediately, retain its
    // origins in a cancellation tombstone, and force every trailing event
    // back to those origins. Escape therefore cannot be "undone" by moving
    // the mouse one more pixel, and Delete is no longer blocked meanwhile.
    const active = activeNodeDragRef.current;
    if (active) {
      cancelledNodeDragsRef.current.add(active.primaryId);
      cancelledNodeDragStatesRef.current.set(active.primaryId, active);
      activeNodeDragRef.current = undefined;
      setNodes((current) => current.map((node) => {
        const origin = active.positions.get(node.id);
        return origin ? { ...node, position: { ...origin } } : node;
      }));
    }
    clearMovementAssist();

    const desktopRuntime = desktopDragRef.current;
    if (desktopRuntime && !desktopRuntime.ended) {
      forwardDesktopPointer("cancel");
      return true;
    }

    cancelGroupDragPreview();
    const selectionMove = selectionMoveRef.current;
    if (selectionMove) renderSelectionMove(selectionMove, 0, 0);
    selectionMoveRef.current = undefined;
    const groupDrag = groupDragRef.current;
    if (groupDrag) renderGroupDrag(groupDrag, 0, 0, true);
    groupDragRef.current = undefined;
    return hadInteraction;
  }, [cancelGroupDragPreview, clearMovementAssist, forwardDesktopPointer, isConnecting, menu, renderGroupDrag, renderSelectionMove, setNodes]);

  useEffect(() => {
    // Desktop window focus legitimately changes while crossing monitor
    // surfaces; its transferable runtime handles that handoff. A normal web
    // canvas has no such receiver, so losing the page must cancel capture
    // instead of leaving an invisible drag/resize owner behind.
    if (desktopSurfaceId) return;
    const cancelOnBlur = () => { cancelCanvasInteraction(); };
    const cancelWhenHidden = () => {
      if (document.visibilityState === "hidden") cancelCanvasInteraction();
    };
    window.addEventListener("blur", cancelOnBlur);
    window.addEventListener("pointercancel", cancelOnBlur, true);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancelOnBlur);
      window.removeEventListener("pointercancel", cancelOnBlur, true);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
    };
  }, [cancelCanvasInteraction, desktopSurfaceId]);

  useEffect(() => {
    const navigateCanvas = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isTextEditingTarget(target) ||
        (target instanceof Element && target.closest(".file-explorer, [data-keyboard-scope='files']"))
      ) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const cancelled = cancelCanvasInteraction();
        if (!cancelled) {
          clearActiveShellSelection();
          clearCanvasNodeSelection();
          clearConnectionSelection();
        }
      } else if (
        !menu &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        const step = GRID * (event.shiftKey ? 4 : 1);
        const delta = {
          x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
          y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
        };
        if (nudgeSelectedCanvasObjects(delta)) {
          event.preventDefault();
          event.stopPropagation();
        }
      } else if (event.key === "Delete" || event.key === "Backspace") {
        // This is an application canvas, never browser history navigation.
        // Consume the key even when a protected/stale selection has nothing
        // deletable; the command must not leak into the browser shell.
        event.preventDefault();
        deleteSelectedCanvasObjects();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        fitMap();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Home") {
        event.preventDefault();
        fitMap();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomMap("in");
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        zoomMap("out");
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        focusSelected();
      }
    };
    window.addEventListener("keydown", navigateCanvas, true);
    return () => window.removeEventListener("keydown", navigateCanvas, true);
  }, [cancelCanvasInteraction, clearActiveShellSelection, clearCanvasNodeSelection, clearConnectionSelection, deleteSelectedCanvasObjects, fitMap, focusSelected, menu, nudgeSelectedCanvasObjects, zoomMap]);

  const canFocusSelected = Boolean(
    selectedLandmarkId || selectedConnectionId || nodes.some((node) => node.selected),
  );

  const contextLandmark = menu?.kind === "landmark" ? allLandmarkById.get(menu.landmarkId) : undefined;
  const contextLandmarkNode = menu?.kind === "landmark" ? nodeBlueprints.find((node): node is LandmarkGraphNode => node.id === menu.landmarkId && isLandmarkNode(node)) : undefined;
  const contextGroup = menu?.kind === "group" ? groupByRegionId.get(menu.regionId) : undefined;

  return (
    <div
      className={`atlas-graph is-zoom-${zoomTier}${zoomTier === "far" ? " is-overview" : ""}${isConnecting ? " is-connecting" : ""}${isNavigating ? " is-navigating" : ""}${isNodeDragging ? " is-node-dragging" : ""}${hoveredNodeId ? " has-hovered-node" : ""}${noteFileDrop.active ? " is-note-drag-over" : ""}`}
      data-testid="atlas-graph"
      data-hovered-node={hoveredNodeId}
      data-connection-source={connectionSourceNodeId}
      {...noteFileDrop.handlers}
    >
      <ReactFlow
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
          if (initialViewSetRef.current) return;
          initialViewSetRef.current = true;
          if (externalViewport) {
            applyingExternalViewportRef.current = externalViewport;
            requestAnimationFrame(() => {
              void instance.setViewport(externalViewport, { duration: 0 }).finally(() => {
                if (applyingExternalViewportRef.current === externalViewport) {
                  applyingExternalViewportRef.current = undefined;
                }
                viewportReadyRef.current = true;
              });
            });
            return;
          }
          if (deferInitialViewport) return;
          initializeLocalViewport(instance);
        }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onEdgeClick={handleEdgeClick}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={() => {
          setMenu(undefined);
          clearActiveShellSelection();
          clearCanvasNodeSelection();
          clearConnectionSelection();
        }}
        onPaneContextMenu={handlePaneContextMenu}
        onMoveStart={(event) => {
          setMenu(undefined);
          if (event) {
            applyingExternalViewportRef.current = undefined;
            viewportGestureRef.current = true;
            setIsNavigating(true);
          }
        }}
        onConnect={queueConnection}
        onConnectStart={startConnection}
        onConnectEnd={finishConnection}
        onReconnect={handleReconnect}
        onReconnectStart={handleReconnectStart}
        onReconnectEnd={handleReconnectEnd}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={16}
        reconnectRadius={12}
        connectionDragThreshold={4}
        connectOnClick={false}
        connectionLineStyle={{ stroke: neutralConnectionColor, strokeWidth: 1.5 }}
        minZoom={.04 / (Number.isFinite(viewportScaleFactor) && viewportScaleFactor > 0 ? viewportScaleFactor : 1)}
        maxZoom={1.8 / (Number.isFinite(viewportScaleFactor) && viewportScaleFactor > 0 ? viewportScaleFactor : 1)}
        // One resolver owns grid fallback and smart guides. Enabling XYFlow's
        // independent grid would double-snap landmark drags before groups see
        // the same pointer delta.
        snapToGrid={false}
        snapGrid={[GRID, GRID]}
        zoomOnDoubleClick={false}
        panOnDrag={[2]}
        selectionOnDrag
        onlyRenderVisibleElements
        nodesDraggable
        nodesConnectable
        autoPanOnNodeDrag={!desktopSurfaceId}
        multiSelectionKeyCode={["Meta", "Control", "Shift"]}
        selectionKeyCode="Shift"
        edgesFocusable
        edgesReconnectable
        selectNodesOnDrag={false}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        zIndexMode="manual"
        deleteKeyCode={null}
        paneClickDistance={5}
        nodeClickDistance={4}
        nodeDragThreshold={4}
        proOptions={proOptions}
      >
        {movementGuides.length > 0 && (
          <Suspense fallback={null}>
            <LazyCanvasAlignmentGuides guides={movementGuides} />
          </Suspense>
        )}
        <Background color="#111418" gap={GRID} size={1.45} variant={BackgroundVariant.Dots} />
      </ReactFlow>

      {noteFileDrop.active && (
        <div className="canvas-note-drop-cue" data-testid="canvas-note-drop-cue" aria-hidden="true">
          <FilePlus2 size={15} />
          <span>Place a copy</span>
        </div>
      )}

      <nav className="canvas-nav" aria-label="Canvas navigation">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomMap("in")}><ZoomIn size={15} aria-hidden="true" /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomMap("out")}><ZoomOut size={15} aria-hidden="true" /></button>
        <button type="button" aria-label="Fit all topics" title="Fit all · Ctrl 0" onClick={fitMap}><Scan size={15} aria-hidden="true" /></button>
        <button type="button" aria-label="Focus selected" title="Focus selected · F" disabled={!canFocusSelected} onClick={focusSelected}><Focus size={15} aria-hidden="true" /></button>
      </nav>

      {menu && (
        <Suspense fallback={null}>
          <LazyDeferredAtlasMenus
            menu={menu}
            landmarkCreationKind={landmarkCreationKind}
            groupCreationLevel={groupCreationLevel}
            informalNotePending={informalNotePending}
            informalNoteError={informalNoteError}
            contextLandmark={contextLandmark}
            contextLandmarkNode={contextLandmarkNode}
            contextGroup={contextGroup}
            selectedConnection={selectedConnection}
            copiedColor={copiedColor}
            panel={menuPanel}
            onPanelChange={setMenuPanel}
            onClose={closeMenu}
            onBackFromLandmarkCreation={() => {
              landmarkCreationAttemptRef.current += 1;
              setLandmarkCreationKind(undefined);
            }}
            onBackFromGroupCreation={() => {
              landmarkCreationAttemptRef.current += 1;
              setGroupCreationLevel(undefined);
            }}
            onCreateLandmark={submitLandmarkCreation}
            onCreateGroup={createGroup}
            onBeginLandmarkCreation={beginLandmarkCreation}
            onBeginGroupCreation={beginGroupCreation}
            onLandmarkKindChange={onKindChange}
            onLandmarkAppearanceChange={changeLandmarkAppearance}
            onGroupLevelChange={changeGroupLevel}
            onGroupAppearanceChange={changeGroupAppearance}
            onGroupTitleFontSizePreview={(nodeId, titleFontSize) => flowRef.current?.updateNode?.(
              nodeId,
              (node) => isRegionNode(node)
                ? { data: { ...node.data, titleFontSize } }
                : {},
            )}
            onGroupFillOpacityPreview={(regionId, fillOpacity) => setGroupSurfacePreview({
              regionId,
              fillOpacity,
            })}
            onGroupFillOpacityCommit={(regionId, fillOpacity) => {
              setGroupSurfacePreview(undefined);
              changeGroupAppearance(regionId, { fillOpacity });
            }}
            onCopyColor={setCopiedColor}
            onDeleteSelected={deleteSelectedCanvasObjects}
            onRemoveLandmark={onRemoveCanvasObjects ? (landmarkId) => {
              onRemoveCanvasObjects({
                landmarkIds: [landmarkId],
                customGroupIds: [],
                connectionIds: [],
              });
              setMenu(undefined);
            } : undefined}
            onDeleteCustomGroup={deleteCustomGroup}
            onConnectionChange={updateConnection}
            onDeleteConnection={deleteConnection}
          />
        </Suspense>
      )}
    </div>
  );
}
