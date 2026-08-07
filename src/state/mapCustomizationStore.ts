import {
  DEFAULT_GROUP_GREY,
  isGroupShape,
  isLandmarkShape,
  type GroupShape,
  type LandmarkShape,
  type ObjectTitlePosition,
} from "../domain/mapAppearance";
import {
  isSubjectFrameStyle,
  type SubjectFrameStyle,
} from "../domain/subjectFrameStyle";
import { repositoryPath } from "../domain/contentPaths";
import { type LandmarkKind, type SubjectId } from "../domain/types";

export type { GroupShape, LandmarkShape } from "../domain/mapAppearance";
export type { SubjectFrameStyle } from "../domain/subjectFrameStyle";

export const MAP_CUSTOMIZATIONS_SCHEMA_VERSION = 1;
export const MAX_CONNECTION_LABEL_LENGTH = 160;
export const DEFAULT_GROUP_TITLE_FONT_SIZE = 28;
export const DEFAULT_GROUP_COLOR = DEFAULT_GROUP_GREY;
const LEGACY_DEFAULT_GROUP_COLOR = "#686D73";
export const MIN_GROUP_TITLE_FONT_SIZE = 12;
export const MAX_GROUP_TITLE_FONT_SIZE = 56;
export const MIN_GROUP_FILL_OPACITY = 0;
export const MAX_GROUP_FILL_OPACITY = .5;

/** Keeps interactive title-size controls within the supported, integer range. */
export function clampGroupTitleFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GROUP_TITLE_FONT_SIZE;
  return Math.min(
    MAX_GROUP_TITLE_FONT_SIZE,
    Math.max(MIN_GROUP_TITLE_FONT_SIZE, Math.round(value)),
  );
}

/**
 * Normalizes interactive opacity input without manufacturing precision that
 * neither the canvas nor a human-facing control can use.
 */
export function clampGroupFillOpacity(value: number): number {
  if (!Number.isFinite(value)) return .34;
  const bounded = Math.min(MAX_GROUP_FILL_OPACITY, Math.max(MIN_GROUP_FILL_OPACITY, value));
  return Math.round(bounded * 100) / 100;
}

const STORAGE_PREFIX = "math-atlas:map-customizations";

export type EditableLandmarkKind = Extract<
  LandmarkKind,
  | "concept"
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  | "method"
  | "example"
>;

export type GroupBorderStyle = "solid" | "dashed" | "double";
export type GroupBorderWeight = "hairline" | "regular" | "strong";
/** Spatial hierarchy only. It never implies a matching filesystem folder. */
export type GroupLevel = "subject" | "group" | "subgroup";
export type GroupTitlePosition = ObjectTitlePosition;
export type ConnectionDirection = "forward" | "reverse" | "both" | "none";
export type ConnectionLineStyle = "solid" | "dashed" | "dotted";
export type ConnectionPathStyle = "smooth" | "curve" | "straight";
export type LandmarkContentMode = "title" | "formula" | "statement" | "note";

/**
 * The hierarchy remains legible when legacy groups do not yet carry authored
 * surface values. Subjects are neutral, empty overview frames; subgroups
 * receive the strongest tint because they are the smallest territories.
 */
export function defaultGroupFillOpacity(level: GroupLevel): number {
  if (level === "subject") return 0;
  if (level === "subgroup") return .44;
  return .34;
}

export function defaultGroupBorderWeight(level: GroupLevel): GroupBorderWeight {
  if (level === "subject") return "strong";
  if (level === "subgroup") return "hairline";
  return "regular";
}

export const SUBJECT_GROUP_SHAPE: GroupShape = "rounded-rectangle";

/**
 * Subjects have one deliberate silhouette. Resolve that invariant at runtime
 * instead of normalizing saved metadata, so a legacy object's authored shape
 * remains available if it is later changed back to a group or subgroup.
 */
export function resolveGroupShape(level: GroupLevel, authoredShape: GroupShape): GroupShape {
  return level === "subject" ? SUBJECT_GROUP_SHAPE : authoredShape;
}

export interface GroupCustomization {
  level?: GroupLevel;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  shape?: GroupShape;
  borderStyle?: GroupBorderStyle;
  borderWeight?: GroupBorderWeight;
  fillOpacity?: number;
  titlePosition?: GroupTitlePosition;
  titleFontSize?: number;
}

export interface LandmarkCustomization {
  color?: string;
  shape?: LandmarkShape;
  width?: number;
  height?: number;
  contentMode?: LandmarkContentMode;
  /** Zero-based choice among the note's available formula previews. */
  formulaIndex?: number;
  /**
   * Hides only the canvas representation. The Markdown file remains in the
   * content tree and can be placed on the canvas again later.
   */
  hidden?: boolean;
}

export interface CustomLandmark {
  id: string;
  title: string;
  subjectId: SubjectId;
  regionId: string;
  contentPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shape: LandmarkShape;
  kind?: EditableLandmarkKind;
  contentMode?: LandmarkContentMode;
  formulaIndex?: number;
}

export interface CustomGroup {
  id: string;
  title: string;
  subjectId: SubjectId;
  /** Optional atlas-only parent group id; never a content-folder path. */
  parentId?: string;
  regionId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shape: GroupShape;
  level?: GroupLevel;
  borderStyle?: GroupBorderStyle;
  borderWeight?: GroupBorderWeight;
  fillOpacity?: number;
  titlePosition?: GroupTitlePosition;
  titleFontSize?: number;
  subjectFrameStyle?: SubjectFrameStyle;
}

export interface ConnectionCustomization {
  source?: string;
  target?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  direction?: ConnectionDirection;
  lineStyle?: ConnectionLineStyle;
  pathStyle?: ConnectionPathStyle;
  color?: string;
  hidden?: boolean;
}

export interface CustomConnection extends ConnectionCustomization {
  id: string;
  source: string;
  target: string;
}

export interface MapCustomizations {
  schemaVersion: typeof MAP_CUSTOMIZATIONS_SCHEMA_VERSION;
  snapshotKey: string;
  landmarkKinds: Record<string, EditableLandmarkKind>;
  landmarks: Record<string, LandmarkCustomization>;
  groups: Record<string, GroupCustomization>;
  customLandmarks: CustomLandmark[];
  customGroups: CustomGroup[];
  connectionOverrides: Record<string, ConnectionCustomization>;
  customConnections: CustomConnection[];
}

export type MapCustomizationsUpdater = (
  current: MapCustomizations,
) => MapCustomizations;

const editableLandmarkKinds = new Set<EditableLandmarkKind>([
  "concept",
  "definition",
  "theorem",
  "proposition",
  "lemma",
  "corollary",
  "method",
  "example",
]);
const groupBorderStyles = new Set<GroupBorderStyle>([
  "solid",
  "dashed",
  "double",
]);
const groupBorderWeights = new Set<GroupBorderWeight>([
  "hairline",
  "regular",
  "strong",
]);
const groupLevels = new Set<GroupLevel>(["subject", "group", "subgroup"]);
const groupTitlePositions = new Set<GroupTitlePosition>([
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
]);
const connectionDirections = new Set<ConnectionDirection>([
  "forward",
  "reverse",
  "both",
  "none",
]);
const connectionLineStyles = new Set<ConnectionLineStyle>([
  "solid",
  "dashed",
  "dotted",
]);
const connectionPathStyles = new Set<ConnectionPathStyle>([
  "smooth",
  "curve",
  "straight",
]);
const landmarkContentModes = new Set<LandmarkContentMode>([
  "title",
  "formula",
  "statement",
  "note",
]);

function storageKey(snapshotKey: string) {
  const normalized = snapshotKey.trim();
  return normalized
    ? `${STORAGE_PREFIX}:v${MAP_CUSTOMIZATIONS_SCHEMA_VERSION}:${encodeURIComponent(normalized)}`
    : undefined;
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeFormulaIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000
    ? value
    : undefined;
}

function safeGroupTitleFontSize(value: unknown): number | undefined {
  const size = finiteNumber(value);
  if (
    size === undefined ||
    size < MIN_GROUP_TITLE_FONT_SIZE ||
    size > MAX_GROUP_TITLE_FONT_SIZE
  ) {
    return undefined;
  }
  return Math.round(size);
}

function safeGroupFillOpacity(value: unknown): number | undefined {
  const opacity = finiteNumber(value);
  if (
    opacity === undefined ||
    opacity < MIN_GROUP_FILL_OPACITY ||
    opacity > MAX_GROUP_FILL_OPACITY
  ) {
    return undefined;
  }
  return Math.round(opacity * 100) / 100;
}

function safeColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : undefined;
}

function safeGroupColor(value: unknown): string | undefined {
  const color = safeColor(value);
  return color === LEGACY_DEFAULT_GROUP_COLOR ? DEFAULT_GROUP_COLOR : color;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(normalized)
    ? normalized
    : undefined;
}

function safeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 160) : undefined;
}

function safeSubjectId(value: unknown): SubjectId | undefined {
  return safeId(value);
}

function safeContentPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const relative = repositoryPath(value.trim());
  return relative && /\.md$/i.test(relative) ? `content/${relative}` : undefined;
}

function normalizeGroupShape(value: unknown): GroupShape | undefined {
  if (isGroupShape(value)) return value;
  // Preserve the intent of customizations saved before the shared clean-shape
  // vocabulary replaced the prototype-only group shapes.
  if (value === "frame") return "rectangle";
  if (value === "rounded" || value === "capsule") return "oval";
  return undefined;
}

function safeHandle(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/i.test(value)
    ? value
    : undefined;
}

function normalizeLandmarkKind(value: unknown): EditableLandmarkKind | undefined {
  if (value === "result") return "theorem";
  return editableLandmarkKinds.has(value as EditableLandmarkKind)
    ? (value as EditableLandmarkKind)
    : undefined;
}

function normalizeLandmarkCustomization(
  value: unknown,
): LandmarkCustomization | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: LandmarkCustomization = {};
  const color = safeColor(value.color);
  if (color) normalized.color = color;
  if (isLandmarkShape(value.shape)) normalized.shape = value.shape;
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (width !== undefined && width >= 96) normalized.width = width;
  if (height !== undefined && height >= 48) normalized.height = height;
  if (landmarkContentModes.has(value.contentMode as LandmarkContentMode)) {
    normalized.contentMode = value.contentMode as LandmarkContentMode;
  }
  const formulaIndex = safeFormulaIndex(value.formulaIndex);
  if (formulaIndex !== undefined) normalized.formulaIndex = formulaIndex;
  if (typeof value.hidden === "boolean") normalized.hidden = value.hidden;
  return normalized;
}

function normalizeCustomLandmark(value: unknown): CustomLandmark | undefined {
  if (!isRecord(value)) return undefined;
  const position = isRecord(value.position) ? value.position : value;
  const size = isRecord(value.size) ? value.size : value;
  const id = safeId(value.id);
  const title = safeTitle(value.title);
  const subjectId = safeSubjectId(value.subjectId);
  const regionId = safeId(value.regionId);
  const contentPath = safeContentPath(value.contentPath);
  const x = finiteNumber(position.x);
  const y = finiteNumber(position.y);
  const width = finiteNumber(size.width);
  const height = finiteNumber(size.height);
  const color = safeColor(value.color);
  const shape = isLandmarkShape(value.shape) ? value.shape : undefined;

  if (
    !id ||
    !title ||
    !subjectId ||
    !regionId ||
    !contentPath ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    width < 96 ||
    height === undefined ||
    height < 48 ||
    !color ||
    !shape
  ) {
    return undefined;
  }

  const normalized: CustomLandmark = {
    id,
    title,
    subjectId,
    regionId,
    contentPath,
    x,
    y,
    width,
    height,
    color,
    shape,
  };
  const kind = normalizeLandmarkKind(value.kind);
  if (kind) normalized.kind = kind;
  if (landmarkContentModes.has(value.contentMode as LandmarkContentMode)) {
    normalized.contentMode = value.contentMode as LandmarkContentMode;
  }
  const formulaIndex = safeFormulaIndex(value.formulaIndex);
  if (formulaIndex !== undefined) normalized.formulaIndex = formulaIndex;
  return normalized;
}

function normalizeCustomGroup(value: unknown): CustomGroup | undefined {
  if (!isRecord(value)) return undefined;
  const position = isRecord(value.position) ? value.position : value;
  const size = isRecord(value.size) ? value.size : value;
  const id = safeId(value.id);
  const title = safeTitle(value.title);
  const subjectId = safeSubjectId(value.subjectId);
  const regionId = safeId(value.regionId);
  const parentId = safeId(value.parentId);
  const x = finiteNumber(position.x);
  const y = finiteNumber(position.y);
  const width = finiteNumber(size.width);
  const height = finiteNumber(size.height);
  const color = safeGroupColor(value.color);
  const shape = normalizeGroupShape(value.shape);
  const level = groupLevels.has(value.level as GroupLevel)
    ? value.level as GroupLevel
    : undefined;

  if (
    !id ||
    !title ||
    !subjectId ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    width < 180 ||
    height === undefined ||
    height < 120 ||
    !color ||
    !shape
  ) {
    return undefined;
  }

  const normalized: CustomGroup = {
    id,
    title,
    subjectId,
    x,
    y,
    width,
    height,
    color,
    shape,
  };
  if (parentId && parentId !== id) normalized.parentId = parentId;
  if (level) normalized.level = level;
  if (regionId) normalized.regionId = regionId;
  if (groupBorderStyles.has(value.borderStyle as GroupBorderStyle)) {
    normalized.borderStyle = value.borderStyle as GroupBorderStyle;
  }
  if (groupBorderWeights.has(value.borderWeight as GroupBorderWeight)) {
    normalized.borderWeight = value.borderWeight as GroupBorderWeight;
  }
  const fillOpacity = safeGroupFillOpacity(value.fillOpacity);
  if (fillOpacity !== undefined) normalized.fillOpacity = fillOpacity;
  if (groupTitlePositions.has(value.titlePosition as GroupTitlePosition)) {
    normalized.titlePosition = value.titlePosition as GroupTitlePosition;
  }
  const titleFontSize = safeGroupTitleFontSize(value.titleFontSize);
  if (titleFontSize !== undefined) normalized.titleFontSize = titleFontSize;
  if (isSubjectFrameStyle(value.subjectFrameStyle)) {
    normalized.subjectFrameStyle = value.subjectFrameStyle;
  }
  return normalized;
}

function normalizeConnection(
  value: unknown,
): ConnectionCustomization | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: ConnectionCustomization = {};

  if (typeof value.source === "string" && value.source) {
    normalized.source = value.source;
  }
  if (typeof value.target === "string" && value.target) {
    normalized.target = value.target;
  }
  const sourceHandle = safeHandle(value.sourceHandle);
  const targetHandle = safeHandle(value.targetHandle);
  if (sourceHandle !== undefined) normalized.sourceHandle = sourceHandle;
  if (targetHandle !== undefined) normalized.targetHandle = targetHandle;
  if (typeof value.label === "string") {
    normalized.label = value.label.slice(0, MAX_CONNECTION_LABEL_LENGTH);
  }
  if (connectionDirections.has(value.direction as ConnectionDirection)) {
    normalized.direction = value.direction as ConnectionDirection;
  }
  if (connectionLineStyles.has(value.lineStyle as ConnectionLineStyle)) {
    normalized.lineStyle = value.lineStyle as ConnectionLineStyle;
  }
  if (connectionPathStyles.has(value.pathStyle as ConnectionPathStyle)) {
    normalized.pathStyle = value.pathStyle as ConnectionPathStyle;
  }
  const color = safeColor(value.color);
  if (color) normalized.color = color;
  if (typeof value.hidden === "boolean") normalized.hidden = value.hidden;

  return normalized;
}

export function emptyMapCustomizations(snapshotKey: string): MapCustomizations {
  return {
    schemaVersion: MAP_CUSTOMIZATIONS_SCHEMA_VERSION,
    snapshotKey: snapshotKey.trim(),
    landmarkKinds: {},
    landmarks: {},
    groups: {},
    customLandmarks: [],
    customGroups: [],
    connectionOverrides: {},
    customConnections: [],
  };
}

function normalizeMapCustomizations(
  value: unknown,
  snapshotKey: string,
): MapCustomizations {
  const normalized = emptyMapCustomizations(snapshotKey);
  if (
    !isRecord(value) ||
    value.schemaVersion !== MAP_CUSTOMIZATIONS_SCHEMA_VERSION ||
    typeof value.snapshotKey !== "string" ||
    value.snapshotKey.trim() !== normalized.snapshotKey
  ) {
    return normalized;
  }

  if (isRecord(value.landmarkKinds)) {
    for (const [id, kind] of Object.entries(value.landmarkKinds)) {
      const normalizedKind = normalizeLandmarkKind(kind);
      if (normalizedKind) normalized.landmarkKinds[id] = normalizedKind;
    }
  }

  if (isRecord(value.landmarks)) {
    for (const [id, landmark] of Object.entries(value.landmarks)) {
      const customization = normalizeLandmarkCustomization(landmark);
      if (customization) normalized.landmarks[id] = customization;
    }
  }

  if (isRecord(value.groups)) {
    for (const [regionId, group] of Object.entries(value.groups)) {
      if (!isRecord(group)) continue;
      const customization: GroupCustomization = {};
      if (groupLevels.has(group.level as GroupLevel)) {
        customization.level = group.level as GroupLevel;
      }
      const title = safeTitle(group.title);
      const x = finiteNumber(group.x);
      const y = finiteNumber(group.y);
      const width = finiteNumber(group.width);
      const height = finiteNumber(group.height);
      if (title) customization.title = title;
      if (x !== undefined) customization.x = x;
      if (y !== undefined) customization.y = y;
      if (width !== undefined && width >= 180) customization.width = width;
      if (height !== undefined && height >= 120) customization.height = height;
      const color = safeGroupColor(group.color);
      if (color) customization.color = color;
      const shape = normalizeGroupShape(group.shape);
      if (shape) customization.shape = shape;
      if (groupBorderStyles.has(group.borderStyle as GroupBorderStyle)) {
        customization.borderStyle = group.borderStyle as GroupBorderStyle;
      }
      if (groupBorderWeights.has(group.borderWeight as GroupBorderWeight)) {
        customization.borderWeight = group.borderWeight as GroupBorderWeight;
      }
      const fillOpacity = safeGroupFillOpacity(group.fillOpacity);
      if (fillOpacity !== undefined) customization.fillOpacity = fillOpacity;
      if (groupTitlePositions.has(group.titlePosition as GroupTitlePosition)) {
        customization.titlePosition = group.titlePosition as GroupTitlePosition;
      }
      const titleFontSize = safeGroupTitleFontSize(group.titleFontSize);
      if (titleFontSize !== undefined) customization.titleFontSize = titleFontSize;
      normalized.groups[regionId] = customization;
    }
  }

  if (Array.isArray(value.customLandmarks)) {
    const landmarkIds = new Set<string>();
    for (const candidate of value.customLandmarks) {
      const landmark = normalizeCustomLandmark(candidate);
      if (!landmark || landmarkIds.has(landmark.id)) {
        continue;
      }
      landmarkIds.add(landmark.id);
      normalized.customLandmarks.push(landmark);
    }
  }

  if (Array.isArray(value.customGroups)) {
    const groupIds = new Set<string>();
    for (const candidate of value.customGroups) {
      const group = normalizeCustomGroup(candidate);
      if (!group || groupIds.has(group.id)) continue;
      groupIds.add(group.id);
      normalized.customGroups.push(group);
    }
    const groupById = new Map(normalized.customGroups.map((group) => [group.id, group]));
    normalized.customGroups.forEach((group) => {
      const seen = new Set([group.id]);
      let parentId = group.parentId;
      while (parentId && groupById.has(parentId)) {
        if (seen.has(parentId)) {
          delete group.parentId;
          break;
        }
        seen.add(parentId);
        parentId = groupById.get(parentId)?.parentId;
      }
    });
  }

  if (isRecord(value.connectionOverrides)) {
    for (const [id, connection] of Object.entries(value.connectionOverrides)) {
      const customization = normalizeConnection(connection);
      if (customization) normalized.connectionOverrides[id] = customization;
    }
  }

  if (Array.isArray(value.customConnections)) {
    const connectionIds = new Set<string>();
    for (const candidate of value.customConnections) {
      const customization = normalizeConnection(candidate);
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        !candidate.id ||
        !customization?.source ||
        !customization.target ||
        customization.source === customization.target ||
        connectionIds.has(candidate.id)
      ) {
        continue;
      }
      connectionIds.add(candidate.id);
      normalized.customConnections.push({
        ...customization,
        id: candidate.id,
        source: customization.source,
        target: customization.target,
      });
    }
  }

  return normalized;
}

export function loadMapCustomizations(snapshotKey: string): MapCustomizations {
  const key = storageKey(snapshotKey);
  const storage = browserStorage();
  if (!key || !storage) return emptyMapCustomizations(snapshotKey);

  try {
    const serialized = storage.getItem(key);
    return serialized
      ? normalizeMapCustomizations(JSON.parse(serialized), snapshotKey)
      : emptyMapCustomizations(snapshotKey);
  } catch {
    return emptyMapCustomizations(snapshotKey);
  }
}

export function saveMapCustomizations(customizations: MapCustomizations) {
  const key = storageKey(customizations.snapshotKey);
  const storage = browserStorage();
  if (!key || !storage) return false;

  try {
    storage.setItem(
      key,
      JSON.stringify(
        normalizeMapCustomizations(customizations, customizations.snapshotKey),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearMapCustomizations(snapshotKey: string) {
  const key = storageKey(snapshotKey);
  const storage = browserStorage();
  if (!key || !storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
