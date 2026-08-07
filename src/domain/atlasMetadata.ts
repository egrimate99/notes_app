/**
 * The portable, file-backed representation of the canvas.  This module has no
 * browser or Node dependencies so the same validator guards both sides of the
 * local API boundary.
 */
import {
  isSubjectFrameStyle,
  type SubjectFrameStyle,
} from "./subjectFrameStyle";

export const ATLAS_METADATA_SCHEMA_VERSION = 1 as const;
export const ATLAS_MAP_SCHEMA_VERSION = 1 as const;
export const DEFAULT_ATLAS_SNAPSHOT_KEY = "math-atlas";

const MAX_COLLECTION_SIZE = 50_000;
const MAX_COORDINATE = 10_000_000;
const MAX_TITLE_LENGTH = 160;
const MAX_LABEL_LENGTH = 160;
const MIN_GROUP_TITLE_FONT_SIZE = 12;
const MAX_GROUP_TITLE_FONT_SIZE = 56;
const MIN_GROUP_FILL_OPACITY = 0;
const MAX_GROUP_FILL_OPACITY = .5;

const editableKinds = [
  "concept",
  "definition",
  "theorem",
  "proposition",
  "lemma",
  "corollary",
  "method",
  "example",
] as const;
const landmarkShapes = [
  "rectangle",
  "oval",
  "hexagon",
  "octagon",
  "rhombus",
  "triangle",
  "parallelogram",
] as const;
const groupShapes = [...landmarkShapes, "rounded-rectangle"] as const;
const borderStyles = ["solid", "dashed", "double"] as const;
const borderWeights = ["hairline", "regular", "strong"] as const;
const groupLevels = ["subject", "group", "subgroup"] as const;
const titlePositions = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
] as const;
const connectionDirections = ["forward", "reverse", "both", "none"] as const;
const connectionLineStyles = ["solid", "dashed", "dotted"] as const;
const connectionPathStyles = ["smooth", "curve", "straight"] as const;
const landmarkContentModes = ["title", "formula", "statement", "note"] as const;

/** Subject IDs are local project data validated with the same safe-ID grammar. */
export type AtlasSubjectId = string;
export type AtlasEditableLandmarkKind = (typeof editableKinds)[number];
export type AtlasObjectShape = (typeof landmarkShapes)[number];
export type AtlasGroupShape = (typeof groupShapes)[number];
export type AtlasGroupBorderStyle = (typeof borderStyles)[number];
export type AtlasGroupBorderWeight = (typeof borderWeights)[number];
export type AtlasGroupLevel = (typeof groupLevels)[number];
export type AtlasGroupTitlePosition = (typeof titlePositions)[number];
export type AtlasConnectionDirection = (typeof connectionDirections)[number];
export type AtlasConnectionLineStyle = (typeof connectionLineStyles)[number];
export type AtlasConnectionPathStyle = (typeof connectionPathStyles)[number];
export type AtlasLandmarkContentMode = (typeof landmarkContentModes)[number];
export type AtlasSubjectFrameStyle = SubjectFrameStyle;

export interface AtlasPlacement {
  landmarkId: string;
  x: number;
  y: number;
}

export interface AtlasLandmarkCustomization {
  color?: string;
  shape?: AtlasObjectShape;
  width?: number;
  height?: number;
  contentMode?: AtlasLandmarkContentMode;
  /** Zero-based choice among the note's available formula previews. */
  formulaIndex?: number;
  /** Canvas visibility only; it never controls the backing Markdown file. */
  hidden?: boolean;
}

export interface AtlasGroupCustomization {
  level?: AtlasGroupLevel;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  shape?: AtlasGroupShape;
  borderStyle?: AtlasGroupBorderStyle;
  borderWeight?: AtlasGroupBorderWeight;
  fillOpacity?: number;
  titlePosition?: AtlasGroupTitlePosition;
  titleFontSize?: number;
}

export interface AtlasCustomLandmark {
  id: string;
  title: string;
  subjectId: AtlasSubjectId;
  regionId: string;
  contentPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shape: AtlasObjectShape;
  kind?: AtlasEditableLandmarkKind;
  contentMode?: AtlasLandmarkContentMode;
  formulaIndex?: number;
}

export interface AtlasCustomGroup {
  id: string;
  title: string;
  subjectId: AtlasSubjectId;
  /** Atlas hierarchy only; deliberately unrelated to Markdown directories. */
  parentId?: string;
  regionId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shape: AtlasGroupShape;
  level?: AtlasGroupLevel;
  borderStyle?: AtlasGroupBorderStyle;
  borderWeight?: AtlasGroupBorderWeight;
  fillOpacity?: number;
  titlePosition?: AtlasGroupTitlePosition;
  titleFontSize?: number;
  subjectFrameStyle?: AtlasSubjectFrameStyle;
}

export interface AtlasConnectionCustomization {
  source?: string;
  target?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  direction?: AtlasConnectionDirection;
  lineStyle?: AtlasConnectionLineStyle;
  pathStyle?: AtlasConnectionPathStyle;
  color?: string;
  hidden?: boolean;
}

export interface AtlasCustomConnection extends AtlasConnectionCustomization {
  id: string;
  source: string;
  target: string;
}

/** Structurally compatible with the current MapCustomizations UI model. */
export interface AtlasMapCustomizations {
  schemaVersion: typeof ATLAS_MAP_SCHEMA_VERSION;
  snapshotKey: string;
  landmarkKinds: Record<string, AtlasEditableLandmarkKind>;
  landmarks: Record<string, AtlasLandmarkCustomization>;
  groups: Record<string, AtlasGroupCustomization>;
  customLandmarks: AtlasCustomLandmark[];
  customGroups: AtlasCustomGroup[];
  connectionOverrides: Record<string, AtlasConnectionCustomization>;
  customConnections: AtlasCustomConnection[];
}

export interface AtlasMetadata {
  schemaVersion: typeof ATLAS_METADATA_SCHEMA_VERSION;
  snapshotKey: string;
  placements: AtlasPlacement[];
  customizations: AtlasMapCustomizations;
}

export type AtlasRecoveryReason =
  | "missing"
  | "too-large"
  | "invalid-utf8"
  | "invalid-json"
  | "invalid-schema";

export interface AtlasMetadataDocument {
  atlas: AtlasMetadata;
  /** An opaque content hash. Null means the metadata file does not exist yet. */
  revision: string | null;
  /** Present when the service returned a safe default instead of disk contents. */
  recovery?: {
    reason: AtlasRecoveryReason;
    message: string;
    issues?: string[];
  };
}

export interface AtlasMetadataValidation {
  value: AtlasMetadata;
  valid: boolean;
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined;
}

function safeSnapshotKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && !normalized.includes("\0")
    ? normalized
    : undefined;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(normalized) ? normalized : undefined;
}

function safeTitle(value: unknown): string | undefined {
  if (typeof value !== "string" || value.includes("\0")) return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_TITLE_LENGTH ? normalized : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
    ? value
    : undefined;
}

function safeFormulaIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000
    ? value
    : undefined;
}

function safeDimension(value: unknown, minimum: number): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= minimum ? number : undefined;
}

function safeGroupTitleFontSize(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined &&
    number >= MIN_GROUP_TITLE_FONT_SIZE &&
    number <= MAX_GROUP_TITLE_FONT_SIZE
    ? number
    : undefined;
}

function safeGroupFillOpacity(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined &&
    number >= MIN_GROUP_FILL_OPACITY &&
    number <= MAX_GROUP_FILL_OPACITY
    ? Math.round(number * 100) / 100
    : undefined;
}

function safeColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : undefined;
}

function safeHandle(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/i.test(value)
    ? value
    : undefined;
}

function safeContentPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.includes("\0") || value.includes("\\")) return undefined;
  const normalized = value.replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    !normalized.startsWith("content/") ||
    !/\.md$/i.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
  ) {
    return undefined;
  }
  return normalized;
}

function objectKeysAre(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

function issueAt(issues: string[], path: string, message: string): void {
  if (issues.length < 100) issues.push(`${path}: ${message}`);
}

export function emptyAtlasMetadata(snapshotKey = DEFAULT_ATLAS_SNAPSHOT_KEY): AtlasMetadata {
  const normalizedKey = safeSnapshotKey(snapshotKey) ?? DEFAULT_ATLAS_SNAPSHOT_KEY;
  return {
    schemaVersion: ATLAS_METADATA_SCHEMA_VERSION,
    snapshotKey: normalizedKey,
    placements: [],
    customizations: {
      schemaVersion: ATLAS_MAP_SCHEMA_VERSION,
      snapshotKey: normalizedKey,
      landmarkKinds: {},
      landmarks: {},
      groups: {},
      customLandmarks: [],
      customGroups: [],
      connectionOverrides: {},
      customConnections: [],
    },
  };
}

function parsePlacement(value: unknown, path: string, issues: string[]): AtlasPlacement | undefined {
  if (!isRecord(value) || !objectKeysAre(value, ["landmarkId", "x", "y"])) {
    issueAt(issues, path, "expected a placement object");
    return undefined;
  }
  const landmarkId = safeId(value.landmarkId);
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (!landmarkId || x === undefined || y === undefined) {
    issueAt(issues, path, "landmarkId and finite bounded coordinates are required");
    return undefined;
  }
  return { landmarkId, x, y };
}

function parseLandmarkStyle(
  value: unknown,
  path: string,
  issues: string[],
): AtlasLandmarkCustomization | undefined {
  if (!isRecord(value) || !objectKeysAre(value, ["color", "shape", "width", "height", "contentMode", "formulaIndex", "hidden"])) {
    issueAt(issues, path, "expected a landmark style object");
    return undefined;
  }
  const result: AtlasLandmarkCustomization = {};
  if ("color" in value) {
    const color = safeColor(value.color);
    if (!color) issueAt(issues, `${path}.color`, "expected #RRGGBB");
    else result.color = color;
  }
  if ("shape" in value) {
    const shape = oneOf(value.shape, landmarkShapes);
    if (!shape) issueAt(issues, `${path}.shape`, "unknown shape");
    else result.shape = shape;
  }
  if ("width" in value) {
    const width = safeDimension(value.width, 96);
    if (!width) issueAt(issues, `${path}.width`, "expected a dimension of at least 96");
    else result.width = width;
  }
  if ("height" in value) {
    const height = safeDimension(value.height, 48);
    if (!height) issueAt(issues, `${path}.height`, "expected a dimension of at least 48");
    else result.height = height;
  }
  if ("contentMode" in value) {
    const contentMode = oneOf(value.contentMode, landmarkContentModes);
    if (!contentMode) issueAt(issues, `${path}.contentMode`, "unknown content mode");
    else result.contentMode = contentMode;
  }
  if ("formulaIndex" in value) {
    const formulaIndex = safeFormulaIndex(value.formulaIndex);
    if (formulaIndex === undefined) issueAt(issues, `${path}.formulaIndex`, "expected a non-negative integer");
    else result.formulaIndex = formulaIndex;
  }
  if ("hidden" in value) {
    if (typeof value.hidden !== "boolean") issueAt(issues, `${path}.hidden`, "expected a boolean");
    else result.hidden = value.hidden;
  }
  return result;
}

function parseGroupStyle(
  value: unknown,
  path: string,
  issues: string[],
): AtlasGroupCustomization | undefined {
  const allowed = ["level", "title", "x", "y", "width", "height", "color", "shape", "borderStyle", "borderWeight", "fillOpacity", "titlePosition", "titleFontSize"];
  if (!isRecord(value) || !objectKeysAre(value, allowed)) {
    issueAt(issues, path, "expected a group style object");
    return undefined;
  }
  const result: AtlasGroupCustomization = {};
  const optional: Array<[string, unknown, () => unknown]> = [
    ["level", value.level, () => oneOf(value.level, groupLevels)],
    ["title", value.title, () => safeTitle(value.title)],
    ["x", value.x, () => finiteNumber(value.x)],
    ["y", value.y, () => finiteNumber(value.y)],
    ["width", value.width, () => safeDimension(value.width, 180)],
    ["height", value.height, () => safeDimension(value.height, 120)],
    ["color", value.color, () => safeColor(value.color)],
    ["shape", value.shape, () => oneOf(value.shape, groupShapes)],
    ["borderStyle", value.borderStyle, () => oneOf(value.borderStyle, borderStyles)],
    ["borderWeight", value.borderWeight, () => oneOf(value.borderWeight, borderWeights)],
    ["fillOpacity", value.fillOpacity, () => safeGroupFillOpacity(value.fillOpacity)],
    ["titlePosition", value.titlePosition, () => oneOf(value.titlePosition, titlePositions)],
    ["titleFontSize", value.titleFontSize, () => safeGroupTitleFontSize(value.titleFontSize)],
  ];
  for (const [key, raw, parse] of optional) {
    if (!(key in value)) continue;
    const parsed = parse();
    if (parsed === undefined) issueAt(issues, `${path}.${key}`, "invalid value");
    else Object.assign(result, { [key]: parsed });
    void raw;
  }
  return result;
}

function parseCustomLandmark(
  value: unknown,
  path: string,
  issues: string[],
): AtlasCustomLandmark | undefined {
  const allowed = ["id", "title", "subjectId", "regionId", "contentPath", "x", "y", "width", "height", "color", "shape", "kind", "contentMode", "formulaIndex"];
  if (!isRecord(value) || !objectKeysAre(value, allowed)) {
    issueAt(issues, path, "expected a custom landmark object");
    return undefined;
  }
  const id = safeId(value.id);
  const title = safeTitle(value.title);
  const subjectId = safeId(value.subjectId);
  const regionId = safeId(value.regionId);
  const contentPath = safeContentPath(value.contentPath);
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = safeDimension(value.width, 96);
  const height = safeDimension(value.height, 48);
  const color = safeColor(value.color);
  const shape = oneOf(value.shape, landmarkShapes);
  if (!id || !title || !subjectId || !regionId || !contentPath || x === undefined || y === undefined || !width || !height || !color || !shape) {
    issueAt(issues, path, "missing or invalid required landmark field");
    return undefined;
  }
  const kind = value.kind === undefined ? undefined : oneOf(value.kind, editableKinds);
  if (value.kind !== undefined && !kind) issueAt(issues, `${path}.kind`, "unknown mathematical kind");
  const contentMode = value.contentMode === undefined ? undefined : oneOf(value.contentMode, landmarkContentModes);
  if (value.contentMode !== undefined && !contentMode) issueAt(issues, `${path}.contentMode`, "unknown content mode");
  const formulaIndex = value.formulaIndex === undefined ? undefined : safeFormulaIndex(value.formulaIndex);
  if (value.formulaIndex !== undefined && formulaIndex === undefined) issueAt(issues, `${path}.formulaIndex`, "expected a non-negative integer");
  return {
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
    ...(kind ? { kind } : {}),
    ...(contentMode ? { contentMode } : {}),
    ...(formulaIndex !== undefined ? { formulaIndex } : {}),
  };
}

function parseCustomGroup(value: unknown, path: string, issues: string[]): AtlasCustomGroup | undefined {
  const allowed = ["id", "title", "subjectId", "parentId", "regionId", "level", "x", "y", "width", "height", "color", "shape", "borderStyle", "borderWeight", "fillOpacity", "titlePosition", "titleFontSize", "subjectFrameStyle"];
  if (!isRecord(value) || !objectKeysAre(value, allowed)) {
    issueAt(issues, path, "expected a custom group object");
    return undefined;
  }
  const id = safeId(value.id);
  const title = safeTitle(value.title);
  const subjectId = safeId(value.subjectId);
  const regionId = value.regionId === undefined ? undefined : safeId(value.regionId);
  const parentId = value.parentId === undefined ? undefined : safeId(value.parentId);
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = safeDimension(value.width, 180);
  const height = safeDimension(value.height, 120);
  const color = safeColor(value.color);
  const shape = oneOf(value.shape, groupShapes);
  const level = value.level === undefined ? undefined : oneOf(value.level, groupLevels);
  const borderStyle = value.borderStyle === undefined ? undefined : oneOf(value.borderStyle, borderStyles);
  const borderWeight = value.borderWeight === undefined ? undefined : oneOf(value.borderWeight, borderWeights);
  const fillOpacity = value.fillOpacity === undefined ? undefined : safeGroupFillOpacity(value.fillOpacity);
  const titlePosition = value.titlePosition === undefined ? undefined : oneOf(value.titlePosition, titlePositions);
  const titleFontSize = value.titleFontSize === undefined ? undefined : safeGroupTitleFontSize(value.titleFontSize);
  const subjectFrameStyle = value.subjectFrameStyle === undefined || !isSubjectFrameStyle(value.subjectFrameStyle)
    ? undefined
    : value.subjectFrameStyle;
  if (!id || !title || !subjectId || (value.parentId !== undefined && (!parentId || parentId === id)) || (value.regionId !== undefined && !regionId) || x === undefined || y === undefined || !width || !height || !color || !shape || (value.level !== undefined && !level) || (value.borderStyle !== undefined && !borderStyle) || (value.borderWeight !== undefined && !borderWeight) || (value.fillOpacity !== undefined && fillOpacity === undefined) || (value.titlePosition !== undefined && !titlePosition) || (value.titleFontSize !== undefined && titleFontSize === undefined) || (value.subjectFrameStyle !== undefined && !subjectFrameStyle)) {
    issueAt(issues, path, "missing or invalid required group field");
    return undefined;
  }
  return { id, title, subjectId, ...(parentId ? { parentId } : {}), ...(regionId ? { regionId } : {}), ...(level ? { level } : {}), x, y, width, height, color, shape, ...(borderStyle ? { borderStyle } : {}), ...(borderWeight ? { borderWeight } : {}), ...(fillOpacity !== undefined ? { fillOpacity } : {}), ...(titlePosition ? { titlePosition } : {}), ...(titleFontSize !== undefined ? { titleFontSize } : {}), ...(subjectFrameStyle ? { subjectFrameStyle } : {}) };
}

function parseConnection(
  value: unknown,
  path: string,
  issues: string[],
  requireIdentity: boolean,
): AtlasConnectionCustomization | AtlasCustomConnection | undefined {
  const allowed = ["id", "source", "target", "sourceHandle", "targetHandle", "label", "direction", "lineStyle", "pathStyle", "color", "hidden"];
  if (!isRecord(value) || !objectKeysAre(value, requireIdentity ? allowed : allowed.slice(1))) {
    issueAt(issues, path, "expected a connection style object");
    return undefined;
  }
  const result: AtlasConnectionCustomization = {};
  for (const key of ["source", "target"] as const) {
    if (!(key in value)) continue;
    const id = safeId(value[key]);
    if (!id) issueAt(issues, `${path}.${key}`, "invalid object id");
    else result[key] = id;
  }
  for (const key of ["sourceHandle", "targetHandle"] as const) {
    if (!(key in value)) continue;
    const handle = safeHandle(value[key]);
    if (handle === undefined) issueAt(issues, `${path}.${key}`, "invalid handle id");
    else result[key] = handle;
  }
  if ("label" in value) {
    if (typeof value.label !== "string" || value.label.length > MAX_LABEL_LENGTH || value.label.includes("\0")) issueAt(issues, `${path}.label`, "invalid label");
    else result.label = value.label;
  }
  const enumFields = [
    ["direction", connectionDirections],
    ["lineStyle", connectionLineStyles],
    ["pathStyle", connectionPathStyles],
  ] as const;
  for (const [key, options] of enumFields) {
    if (!(key in value)) continue;
    const parsed = oneOf(value[key], options);
    if (!parsed) issueAt(issues, `${path}.${key}`, "invalid value");
    else Object.assign(result, { [key]: parsed });
  }
  if ("color" in value) {
    const color = safeColor(value.color);
    if (!color) issueAt(issues, `${path}.color`, "expected #RRGGBB");
    else result.color = color;
  }
  if ("hidden" in value) {
    if (typeof value.hidden !== "boolean") issueAt(issues, `${path}.hidden`, "expected a boolean");
    else result.hidden = value.hidden;
  }
  if (!requireIdentity) return result;
  const id = safeId(value.id);
  if (!id || !result.source || !result.target || result.source === result.target) {
    issueAt(issues, path, "custom connections require distinct source and target ids");
    return undefined;
  }
  return { ...result, id, source: result.source, target: result.target };
}

function parseRecord<T>(
  value: unknown,
  path: string,
  issues: string[],
  parser: (value: unknown, path: string, issues: string[]) => T | undefined,
): Record<string, T> {
  const result: Record<string, T> = {};
  if (!isRecord(value) || Object.keys(value).length > MAX_COLLECTION_SIZE) {
    issueAt(issues, path, "expected a bounded object map");
    return result;
  }
  for (const [id, item] of Object.entries(value)) {
    if (!safeId(id)) {
      issueAt(issues, `${path}.${id}`, "invalid map key");
      continue;
    }
    const parsed = parser(item, `${path}.${id}`, issues);
    if (parsed !== undefined) result[id] = parsed;
  }
  return result;
}

function parseArray<T>(
  value: unknown,
  path: string,
  issues: string[],
  parser: (value: unknown, path: string, issues: string[]) => T | undefined,
): T[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE) {
    issueAt(issues, path, "expected a bounded array");
    return [];
  }
  const result: T[] = [];
  value.forEach((item, index) => {
    const parsed = parser(item, `${path}[${index}]`, issues);
    if (parsed !== undefined) result.push(parsed);
  });
  return result;
}

/**
 * Strictly validates untrusted JSON while returning a safe normalized value.
 * Callers may use the value for migration; persistent reads should fall back to
 * emptyAtlasMetadata when `valid` is false to avoid presenting partial maps.
 */
export function validateAtlasMetadata(
  input: unknown,
  fallbackSnapshotKey = DEFAULT_ATLAS_SNAPSHOT_KEY,
): AtlasMetadataValidation {
  const fallback = emptyAtlasMetadata(fallbackSnapshotKey);
  const issues: string[] = [];
  if (!isRecord(input) || !objectKeysAre(input, ["schemaVersion", "snapshotKey", "placements", "customizations"])) {
    return { value: fallback, valid: false, issues: ["atlas: expected a schema-versioned atlas object"] };
  }
  if (input.schemaVersion !== ATLAS_METADATA_SCHEMA_VERSION) issueAt(issues, "atlas.schemaVersion", `expected ${ATLAS_METADATA_SCHEMA_VERSION}`);
  const snapshotKey = safeSnapshotKey(input.snapshotKey);
  if (!snapshotKey) issueAt(issues, "atlas.snapshotKey", "expected a non-empty portable key");
  const key = snapshotKey ?? fallback.snapshotKey;

  const placements = parseArray(input.placements, "atlas.placements", issues, parsePlacement);
  const placementIds = new Set<string>();
  for (const placement of placements) {
    if (placementIds.has(placement.landmarkId)) issueAt(issues, "atlas.placements", `duplicate ${placement.landmarkId}`);
    placementIds.add(placement.landmarkId);
  }

  const rawCustomizations = input.customizations;
  const customizations = emptyAtlasMetadata(key).customizations;
  if (!isRecord(rawCustomizations) || !objectKeysAre(rawCustomizations, ["schemaVersion", "snapshotKey", "landmarkKinds", "landmarks", "groups", "customLandmarks", "customGroups", "connectionOverrides", "customConnections"])) {
    issueAt(issues, "atlas.customizations", "expected map customizations");
  } else {
    if (rawCustomizations.schemaVersion !== ATLAS_MAP_SCHEMA_VERSION) issueAt(issues, "atlas.customizations.schemaVersion", `expected ${ATLAS_MAP_SCHEMA_VERSION}`);
    if (safeSnapshotKey(rawCustomizations.snapshotKey) !== key) issueAt(issues, "atlas.customizations.snapshotKey", "must match atlas.snapshotKey");
    customizations.landmarkKinds = parseRecord(rawCustomizations.landmarkKinds, "atlas.customizations.landmarkKinds", issues, (kind, path, targetIssues) => {
      const parsed = kind === "result" ? "theorem" : oneOf(kind, editableKinds);
      if (!parsed) issueAt(targetIssues, path, "unknown mathematical kind");
      return parsed;
    });
    customizations.landmarks = parseRecord(rawCustomizations.landmarks, "atlas.customizations.landmarks", issues, parseLandmarkStyle);
    customizations.groups = parseRecord(rawCustomizations.groups, "atlas.customizations.groups", issues, parseGroupStyle);
    customizations.customLandmarks = parseArray(rawCustomizations.customLandmarks, "atlas.customizations.customLandmarks", issues, parseCustomLandmark);
    customizations.customGroups = parseArray(rawCustomizations.customGroups, "atlas.customizations.customGroups", issues, parseCustomGroup);
    customizations.connectionOverrides = parseRecord(rawCustomizations.connectionOverrides, "atlas.customizations.connectionOverrides", issues, (item, path, targetIssues) => parseConnection(item, path, targetIssues, false) as AtlasConnectionCustomization | undefined);
    customizations.customConnections = parseArray(rawCustomizations.customConnections, "atlas.customizations.customConnections", issues, (item, path, targetIssues) => parseConnection(item, path, targetIssues, true) as AtlasCustomConnection | undefined);

    for (const [label, values] of [
      ["customLandmarks", customizations.customLandmarks],
      ["customGroups", customizations.customGroups],
      ["customConnections", customizations.customConnections],
    ] as const) {
      const ids = new Set<string>();
      for (const item of values) {
        if (ids.has(item.id)) issueAt(issues, `atlas.customizations.${label}`, `duplicate ${item.id}`);
        ids.add(item.id);
      }
    }

    const customGroupById = new Map(customizations.customGroups.map((group) => [group.id, group]));
    for (const group of customizations.customGroups) {
      const seen = new Set([group.id]);
      let parentId = group.parentId;
      while (parentId && customGroupById.has(parentId)) {
        if (seen.has(parentId)) {
          issueAt(issues, `atlas.customizations.customGroups.${group.id}.parentId`, "group hierarchy contains a cycle");
          break;
        }
        seen.add(parentId);
        parentId = customGroupById.get(parentId)?.parentId;
      }
    }
  }

  return {
    value: {
      schemaVersion: ATLAS_METADATA_SCHEMA_VERSION,
      snapshotKey: key,
      placements,
      customizations,
    },
    valid: issues.length === 0,
    issues,
  };
}
