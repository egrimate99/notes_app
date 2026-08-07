import type { LandmarkKind, SubjectId } from "./types";

export const OBJECT_SHAPE_OPTIONS = [
  { id: "rectangle", label: "Rectangle" },
  { id: "oval", label: "Oval" },
  { id: "hexagon", label: "Hexagon" },
  { id: "octagon", label: "Octagon" },
  { id: "rhombus", label: "Rhombus" },
  { id: "triangle", label: "Triangle" },
  { id: "parallelogram", label: "Parallelogram" },
] as const;

/** Landmarks keep the compact mathematical-object shape vocabulary. */
export type ObjectShape = (typeof OBJECT_SHAPE_OPTIONS)[number]["id"];
export type LandmarkShape = ObjectShape;

/** Territories add one softer, highly rounded silhouette of their own. */
export const GROUP_SHAPE_OPTIONS = [
  ...OBJECT_SHAPE_OPTIONS,
  { id: "rounded-rectangle", label: "Cloud rectangle" },
] as const;

export type GroupShape = (typeof GROUP_SHAPE_OPTIONS)[number]["id"];

export const OBJECT_TITLE_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
] as const;

export type ObjectTitlePosition = (typeof OBJECT_TITLE_POSITIONS)[number];

export interface ObjectTitleGeometry {
  /** Normalized point on the visible perimeter. */
  x: number;
  y: number;
  /** Normalized readable tangent followed by the label. */
  dx: number;
  dy: number;
}

export const REGULAR_RAINBOW_PALETTE = [
  { id: "red", label: "Red", color: "#D62828" },
  { id: "orange", label: "Orange", color: "#E86F00" },
  { id: "yellow", label: "Yellow", color: "#C79500" },
  { id: "green", label: "Green", color: "#238636" },
  { id: "blue", label: "Blue", color: "#1F6FEB" },
  { id: "indigo", label: "Indigo", color: "#4F46B5" },
  { id: "violet", label: "Violet", color: "#8A2AA5" },
] as const;

/** The neutral used by newly-created spatial groups and the colour picker. */
export const DEFAULT_GROUP_GREY = "#92989F" as const;

/**
 * Authored objects can use a neutral as well as the regular rainbow. Keeping
 * the neutral in this shared list guarantees the group default is always one
 * click away after choosing another colour.
 */
export const DEFAULT_COLOR_PALETTE = [
  { id: "grey", label: "Grey", color: DEFAULT_GROUP_GREY },
  ...REGULAR_RAINBOW_PALETTE,
] as const;

export type RainbowColorId = (typeof REGULAR_RAINBOW_PALETTE)[number]["id"];
export type RainbowColor = (typeof REGULAR_RAINBOW_PALETTE)[number]["color"];

/** Public code has no subject-name palette; local subject accents are authoritative. */
export const SUBJECT_RAINBOW_COLORS: Readonly<Partial<Record<SubjectId, RainbowColor>>> = {};

export const DEFAULT_LANDMARK_SHAPE_BY_KIND: Record<
  LandmarkKind,
  ObjectShape
> = {
  concept: "rectangle",
  definition: "rectangle",
  theorem: "hexagon",
  proposition: "parallelogram",
  lemma: "triangle",
  corollary: "rhombus",
  result: "hexagon",
  method: "octagon",
  example: "oval",
  problem: "triangle",
  insight: "rhombus",
  source: "oval",
};

const objectShapes = new Set<ObjectShape>(
  OBJECT_SHAPE_OPTIONS.map(({ id }) => id),
);
const groupShapes = new Set<GroupShape>(
  GROUP_SHAPE_OPTIONS.map(({ id }) => id),
);

export function isObjectShape(value: unknown): value is ObjectShape {
  return objectShapes.has(value as ObjectShape);
}

// Landmarks retain the base object vocabulary; groups accept its additional
// territory-only silhouette.
export const isLandmarkShape = isObjectShape;
export function isGroupShape(value: unknown): value is GroupShape {
  return groupShapes.has(value as GroupShape);
}

export function defaultLandmarkShape(kind: LandmarkKind): ObjectShape {
  return DEFAULT_LANDMARK_SHAPE_BY_KIND[kind];
}

export const OBJECT_GLYPH_WIDTH = 206;
export const OBJECT_GLYPH_HEIGHT = 76;

// Compatibility aliases for consumers that size landmark cards explicitly.
export const LANDMARK_GLYPH_WIDTH = OBJECT_GLYPH_WIDTH;
export const LANDMARK_GLYPH_HEIGHT = OBJECT_GLYPH_HEIGHT;

export interface ObjectShapeGlyph {
  viewBox: string;
  framePath: string;
}

export type ObjectPortSide = "top" | "right" | "bottom" | "left";

export interface ObjectPortAnchor {
  x: number;
  y: number;
}

export type LandmarkShapeGlyph = ObjectShapeGlyph;

function safeDimension(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 32 ? value : fallback;
}

function coordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}

function percentage(value: number, dimension: number) {
  return coordinate((value / dimension) * 100);
}

function objectShapeMetrics(width: number, height: number) {
  const safeWidth = safeDimension(width, OBJECT_GLYPH_WIDTH);
  const safeHeight = safeDimension(height, OBJECT_GLYPH_HEIGHT);
  return {
    safeWidth,
    safeHeight,
    x0: 0,
    y0: 0,
    x1: coordinate(safeWidth),
    y1: coordinate(safeHeight),
    centerX: coordinate(safeWidth / 2),
    centerY: coordinate(safeHeight / 2),
    radiusX: coordinate(safeWidth / 2),
    radiusY: coordinate(safeHeight / 2),
    cut: coordinate(Math.min(14, safeWidth / 8, safeHeight / 4)),
    side: coordinate(Math.min(24, safeWidth / 8, safeHeight / 3)),
    slant: coordinate(Math.min(20, safeWidth / 7, safeHeight / 3)),
    roundedCorner: coordinate(Math.min(safeWidth * .28, safeHeight * .46)),
  };
}

/**
 * Exact title attachment points generated from the same dimensions as the SVG
 * contour. Values are normalized because the group SVG is stretched to its
 * live frame while the title keeps a constant proportion to that frame.
 */
export function objectShapeTitleGeometry(
  shape: GroupShape,
  width = 100,
  height = 100,
): Record<ObjectTitlePosition, ObjectTitleGeometry> {
  const { safeWidth, safeHeight, cut, side, slant, roundedCorner } = objectShapeMetrics(width, height);
  const nx = (value: number) => value / safeWidth;
  const rectangle = {
    "top-left": { x: 0, y: 0, dx: 1, dy: 0 },
    "top-center": { x: .5, y: 0, dx: 1, dy: 0 },
    "top-right": { x: 1, y: 0, dx: 1, dy: 0 },
    "middle-right": { x: 1, y: .5, dx: 0, dy: -1 },
    "bottom-right": { x: 1, y: 1, dx: 1, dy: 0 },
    "bottom-center": { x: .5, y: 1, dx: 1, dy: 0 },
    "bottom-left": { x: 0, y: 1, dx: 1, dy: 0 },
    "middle-left": { x: 0, y: .5, dx: 0, dy: -1 },
  } satisfies Record<ObjectTitlePosition, ObjectTitleGeometry>;

  switch (shape) {
    case "rectangle":
      return rectangle;
    case "oval": {
      const diagonal = .5 - .5 / Math.sqrt(2);
      return {
        ...rectangle,
        "top-left": { x: diagonal, y: diagonal, dx: 1, dy: -1 },
        "top-right": { x: 1 - diagonal, y: diagonal, dx: 1, dy: 1 },
        "bottom-right": { x: 1 - diagonal, y: 1 - diagonal, dx: 1, dy: -1 },
        "bottom-left": { x: diagonal, y: 1 - diagonal, dx: 1, dy: 1 },
      };
    }
    case "rounded-rectangle": {
      const radiusX = roundedCorner / safeWidth;
      const radiusY = roundedCorner / safeHeight;
      const cornerX = radiusX - radiusX / Math.sqrt(2);
      const cornerY = radiusY - radiusY / Math.sqrt(2);
      return {
        ...rectangle,
        "top-left": { x: cornerX, y: cornerY, dx: radiusX, dy: -radiusY },
        "top-right": { x: 1 - cornerX, y: cornerY, dx: radiusX, dy: radiusY },
        "bottom-right": { x: 1 - cornerX, y: 1 - cornerY, dx: radiusX, dy: -radiusY },
        "bottom-left": { x: cornerX, y: 1 - cornerY, dx: radiusX, dy: radiusY },
      };
    }
    case "hexagon": {
      const edgeX = nx(side);
      return {
        ...rectangle,
        "top-left": { x: edgeX, y: 0, dx: 1, dy: 0 },
        "top-right": { x: 1 - edgeX, y: 0, dx: 1, dy: 0 },
        "middle-right": { x: 1 - edgeX / 2, y: .25, dx: edgeX, dy: .5 },
        "bottom-right": { x: 1 - edgeX, y: 1, dx: 1, dy: 0 },
        "bottom-left": { x: edgeX, y: 1, dx: 1, dy: 0 },
        "middle-left": { x: edgeX / 2, y: .25, dx: edgeX, dy: -.5 },
      };
    }
    case "octagon": {
      const cutX = nx(cut);
      return {
        ...rectangle,
        "top-left": { x: cutX, y: 0, dx: 1, dy: 0 },
        "top-right": { x: 1 - cutX, y: 0, dx: 1, dy: 0 },
        "bottom-right": { x: 1 - cutX, y: 1, dx: 1, dy: 0 },
        "bottom-left": { x: cutX, y: 1, dx: 1, dy: 0 },
      };
    }
    case "rhombus":
      return {
        ...rectangle,
        "top-left": { x: .25, y: .25, dx: .5, dy: -.5 },
        "top-right": { x: .75, y: .25, dx: .5, dy: .5 },
        "bottom-right": { x: .75, y: .75, dx: .5, dy: -.5 },
        "bottom-left": { x: .25, y: .75, dx: .5, dy: .5 },
      };
    case "triangle":
      return {
        "top-left": { x: .25, y: .5, dx: .5, dy: -1 },
        "top-center": { x: .5, y: 0, dx: 1, dy: 0 },
        "top-right": { x: .75, y: .5, dx: .5, dy: 1 },
        "middle-right": { x: .875, y: .75, dx: .5, dy: 1 },
        "bottom-right": { x: 1, y: 1, dx: 1, dy: 0 },
        "bottom-center": { x: .5, y: 1, dx: 1, dy: 0 },
        "bottom-left": { x: 0, y: 1, dx: 1, dy: 0 },
        "middle-left": { x: .125, y: .75, dx: .5, dy: -1 },
      };
    case "parallelogram": {
      const slantX = nx(slant);
      return {
        "top-left": { x: slantX, y: 0, dx: 1, dy: 0 },
        "top-center": { x: (1 + slantX) / 2, y: 0, dx: 1, dy: 0 },
        "top-right": { x: 1, y: 0, dx: 1, dy: 0 },
        "middle-right": { x: 1 - slantX / 2, y: .5, dx: slantX, dy: -1 },
        "bottom-right": { x: 1 - slantX, y: 1, dx: 1, dy: 0 },
        "bottom-center": { x: (1 - slantX) / 2, y: 1, dx: 1, dy: 0 },
        "bottom-left": { x: 0, y: 1, dx: 1, dy: 0 },
        "middle-left": { x: slantX / 2, y: .5, dx: slantX, dy: -1 },
      };
    }
  }
}

function pointInPolygon(
  x: number,
  y: number,
  vertices: ReadonlyArray<readonly [number, number]>,
) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const [x1, y1] = vertices[index];
    const [x2, y2] = vertices[previous];
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    const onSegment = Math.abs(cross) < 1e-9 &&
      x >= Math.min(x1, x2) - 1e-9 && x <= Math.max(x1, x2) + 1e-9 &&
      y >= Math.min(y1, y2) - 1e-9 && y <= Math.max(y1, y2) + 1e-9;
    if (onSegment) return true;
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shape-aware containment for spatial grouping; inputs are normalized. */
export function objectShapeContainsPoint(shape: GroupShape, x: number, y: number) {
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) return false;
  if (shape === "rectangle") return true;
  if (shape === "oval") {
    return ((x - .5) / .5) ** 2 + ((y - .5) / .5) ** 2 <= 1 + 1e-9;
  }
  if (shape === "rounded-rectangle") {
    const radius = .28;
    const nearestX = Math.min(1 - radius, Math.max(radius, x));
    const nearestY = Math.min(1 - radius, Math.max(radius, y));
    return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2 + 1e-9;
  }

  const metrics = objectShapeMetrics(100, 100);
  const cut = metrics.cut / metrics.safeWidth;
  const side = metrics.side / metrics.safeWidth;
  const slant = metrics.slant / metrics.safeWidth;
  const vertices: Record<Exclude<GroupShape, "rectangle" | "oval" | "rounded-rectangle">, ReadonlyArray<readonly [number, number]>> = {
    hexagon: [[side, 0], [1 - side, 0], [1, .5], [1 - side, 1], [side, 1], [0, .5]],
    octagon: [[cut, 0], [1 - cut, 0], [1, cut], [1, 1 - cut], [1 - cut, 1], [cut, 1], [0, 1 - cut], [0, cut]],
    rhombus: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
    triangle: [[.5, 0], [1, 1], [0, 1]],
    parallelogram: [[slant, 0], [1, 0], [1 - slant, 1], [0, 1]],
  };
  return pointInPolygon(x, y, vertices[shape]);
}

/** Cardinal connection anchors that lie on the visible SVG frame. */
export function objectShapePortAnchors(
  shape: GroupShape,
  width = OBJECT_GLYPH_WIDTH,
  height = OBJECT_GLYPH_HEIGHT,
): Record<ObjectPortSide, ObjectPortAnchor> {
  const { safeWidth, safeHeight, slant } = objectShapeMetrics(width, height);
  const x0 = 0;
  const y0 = 0;
  const x1 = safeWidth;
  const y1 = safeHeight;
  const centerX = safeWidth / 2;
  let leftX = x0;
  let rightX = x1;
  let topX = centerX;
  let bottomX = centerX;

  if (shape === "triangle") {
    leftX = (x0 + centerX) / 2;
    rightX = (x1 + centerX) / 2;
  } else if (shape === "parallelogram") {
    leftX = x0 + slant / 2;
    rightX = x1 - slant / 2;
    // Use the visual midpoint of each slanted frame edge. Keeping both at the
    // bounding-box centre makes vertically aligned parallelograms terminate
    // their arrows at different relative points and appear subtly crooked.
    topX = (x0 + slant + x1) / 2;
    bottomX = (x0 + x1 - slant) / 2;
  }

  return {
    top: { x: percentage(topX, safeWidth), y: percentage(y0, safeHeight) },
    right: { x: percentage(rightX, safeWidth), y: 50 },
    bottom: { x: percentage(bottomX, safeWidth), y: percentage(y1, safeHeight) },
    left: { x: percentage(leftX, safeWidth), y: 50 },
  };
}

/** Returns reusable SVG geometry without coupling the domain layer to React. */
export function objectShapeGlyph(
  shape: GroupShape,
  width = OBJECT_GLYPH_WIDTH,
  height = OBJECT_GLYPH_HEIGHT,
): ObjectShapeGlyph {
  const {
    safeWidth, safeHeight, x0, y0, x1, y1, centerX, centerY,
    radiusX, radiusY, cut, side, slant, roundedCorner,
  } = objectShapeMetrics(width, height);
  const viewBox = `0 0 ${coordinate(safeWidth)} ${coordinate(safeHeight)}`;

  switch (shape) {
    case "rectangle":
      return { viewBox, framePath: `M${x0} ${y0}H${x1}V${y1}H${x0}Z` };
    case "oval":
      return {
        viewBox,
        framePath: `M${centerX} ${y0}A${radiusX} ${radiusY} 0 1 1 ${centerX} ${y1}A${radiusX} ${radiusY} 0 1 1 ${centerX} ${y0}Z`,
      };
    case "rounded-rectangle":
      return {
        viewBox,
        framePath: `M${x0 + roundedCorner} ${y0}H${x1 - roundedCorner}A${roundedCorner} ${roundedCorner} 0 0 1 ${x1} ${y0 + roundedCorner}V${y1 - roundedCorner}A${roundedCorner} ${roundedCorner} 0 0 1 ${x1 - roundedCorner} ${y1}H${x0 + roundedCorner}A${roundedCorner} ${roundedCorner} 0 0 1 ${x0} ${y1 - roundedCorner}V${y0 + roundedCorner}A${roundedCorner} ${roundedCorner} 0 0 1 ${x0 + roundedCorner} ${y0}Z`,
      };
    case "hexagon":
      return {
        viewBox,
        framePath: `M${x0 + side} ${y0}H${x1 - side}L${x1} ${centerY}L${x1 - side} ${y1}H${x0 + side}L${x0} ${centerY}Z`,
      };
    case "octagon":
      return {
        viewBox,
        framePath: `M${x0 + cut} ${y0}H${x1 - cut}L${x1} ${y0 + cut}V${y1 - cut}L${x1 - cut} ${y1}H${x0 + cut}L${x0} ${y1 - cut}V${y0 + cut}Z`,
      };
    case "rhombus":
      return {
        viewBox,
        framePath: `M${centerX} ${y0}L${x1} ${centerY}L${centerX} ${y1}L${x0} ${centerY}Z`,
      };
    case "triangle":
      return {
        viewBox,
        framePath: `M${centerX} ${y0}L${x1} ${y1}H${x0}Z`,
      };
    case "parallelogram":
      return {
        viewBox,
        framePath: `M${x0 + slant} ${y0}H${x1}L${x1 - slant} ${y1}H${x0}Z`,
      };
  }
}

export const landmarkShapeGlyph = objectShapeGlyph;
