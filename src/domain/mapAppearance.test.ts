import { describe, expect, it } from "vitest";
import type { LandmarkKind } from "./types";
import {
  DEFAULT_COLOR_PALETTE,
  DEFAULT_GROUP_GREY,
  DEFAULT_LANDMARK_SHAPE_BY_KIND,
  GROUP_SHAPE_OPTIONS,
  LANDMARK_GLYPH_HEIGHT,
  LANDMARK_GLYPH_WIDTH,
  OBJECT_SHAPE_OPTIONS,
  OBJECT_TITLE_POSITIONS,
  REGULAR_RAINBOW_PALETTE,
  SUBJECT_RAINBOW_COLORS,
  defaultLandmarkShape,
  isGroupShape,
  isLandmarkShape,
  isObjectShape,
  landmarkShapeGlyph,
  objectShapeGlyph,
  objectShapeContainsPoint,
  objectShapePortAnchors,
  objectShapeTitleGeometry,
} from "./mapAppearance";

describe("mapAppearance", () => {
  it("provides a regular, distinct rainbow and stable subject colours", () => {
    expect(REGULAR_RAINBOW_PALETTE.map(({ id }) => id)).toEqual([
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "indigo",
      "violet",
    ]);
    expect(
      new Set(REGULAR_RAINBOW_PALETTE.map(({ color }) => color)).size,
    ).toBe(REGULAR_RAINBOW_PALETTE.length);
    expect(SUBJECT_RAINBOW_COLORS).toEqual({});
    expect(DEFAULT_COLOR_PALETTE.map(({ id }) => id)).toEqual([
      "grey",
      ...REGULAR_RAINBOW_PALETTE.map(({ id }) => id),
    ]);
    expect(DEFAULT_COLOR_PALETTE[0]).toEqual({
      id: "grey",
      label: "Grey",
      color: DEFAULT_GROUP_GREY,
    });
  });

  it("adds a group-only cloud rectangle to the base shape vocabulary", () => {
    expect(OBJECT_SHAPE_OPTIONS.map(({ id }) => id)).toEqual([
      "rectangle",
      "oval",
      "hexagon",
      "octagon",
      "rhombus",
      "triangle",
      "parallelogram",
    ]);
    for (const { id } of OBJECT_SHAPE_OPTIONS) {
      expect(isObjectShape(id)).toBe(true);
      expect(isLandmarkShape(id)).toBe(true);
      expect(isGroupShape(id)).toBe(true);
    }
    expect(GROUP_SHAPE_OPTIONS.map(({ id }) => id)).toEqual([
      ...OBJECT_SHAPE_OPTIONS.map(({ id }) => id),
      "rounded-rectangle",
    ]);
    expect(isObjectShape("rounded-rectangle")).toBe(false);
    expect(isLandmarkShape("rounded-rectangle")).toBe(false);
    expect(isGroupShape("rounded-rectangle")).toBe(true);
    for (const legacy of ["frame", "rounded", "capsule", "stepped"]) {
      expect(isObjectShape(legacy)).toBe(false);
    }
  });

  it("assigns every landmark kind a supported default shape", () => {
    const kinds = Object.keys(DEFAULT_LANDMARK_SHAPE_BY_KIND) as LandmarkKind[];

    expect(kinds).toHaveLength(12);
    expect(kinds.every((kind) => isObjectShape(defaultLandmarkShape(kind)))).toBe(
      true,
    );
    expect(defaultLandmarkShape("definition")).toBe("rectangle");
    expect(defaultLandmarkShape("theorem")).toBe("hexagon");
    expect(defaultLandmarkShape("result")).toBe("hexagon");
    expect(defaultLandmarkShape("method")).toBe("octagon");
    expect(defaultLandmarkShape("example")).toBe("oval");
  });

  it("generates valid reusable SVG geometry for every object shape", () => {
    for (const { id } of OBJECT_SHAPE_OPTIONS) {
      const glyph = objectShapeGlyph(id);
      expect(glyph.viewBox).toBe(
        `0 0 ${LANDMARK_GLYPH_WIDTH} ${LANDMARK_GLYPH_HEIGHT}`,
      );
      expect(glyph.framePath).toMatch(/^M/);
      expect(glyph.framePath).toMatch(/Z$/);
      if (id !== "oval") expect(glyph.framePath).not.toMatch(/[CQAS]/);
      expect(landmarkShapeGlyph(id)).toEqual(glyph);
    }
  });

  it("scales glyph geometry and safely falls back for invalid dimensions", () => {
    expect(objectShapeGlyph("hexagon", 300, 100).viewBox).toBe("0 0 300 100");
    expect(objectShapeGlyph("rectangle", Number.NaN, 8).viewBox).toBe(
      `0 0 ${LANDMARK_GLYPH_WIDTH} ${LANDMARK_GLYPH_HEIGHT}`,
    );
  });

  it("renders and hit-tests a deeply rounded, cloudlike group rectangle", () => {
    const glyph = objectShapeGlyph("rounded-rectangle", 100, 100);
    expect(glyph.viewBox).toBe("0 0 100 100");
    expect(glyph.framePath).toContain("A28 28");
    expect(objectShapeContainsPoint("rounded-rectangle", .5, .5)).toBe(true);
    expect(objectShapeContainsPoint("rounded-rectangle", .01, .01)).toBe(false);
    expect(objectShapeContainsPoint("rounded-rectangle", .28, 0)).toBe(true);

    const topLeft = objectShapeTitleGeometry("rounded-rectangle")["top-left"];
    expect(topLeft.x).toBeCloseTo(.28 - .28 / Math.sqrt(2), 10);
    expect(topLeft.y).toBeCloseTo(.28 - .28 / Math.sqrt(2), 10);
  });

  it("places connection anchors on each visible shape frame", () => {
    const rectangle = objectShapePortAnchors("rectangle", 196, 84);
    expect(rectangle.top.x).toBe(50);
    expect(rectangle.top.y).toBe(0);
    expect(rectangle.right.x).toBe(100);

    const triangle = objectShapePortAnchors("triangle", 196, 84);
    expect(triangle.left.x).toBeGreaterThan(rectangle.left.x);
    expect(triangle.right.x).toBeLessThan(rectangle.right.x);

    const parallelogram = objectShapePortAnchors("parallelogram", 196, 84);
    expect(parallelogram.left.x).toBeGreaterThan(rectangle.left.x);
    expect(parallelogram.right.x).toBeLessThan(rectangle.right.x);
    expect(parallelogram.top.x).toBeGreaterThan(50);
    expect(parallelogram.bottom.x).toBeLessThan(50);
    expect(parallelogram.top.x + parallelogram.bottom.x).toBeCloseTo(100, 10);
  });

  it("keeps every title anchor on the shared shape geometry", () => {
    for (const { id } of OBJECT_SHAPE_OPTIONS) {
      const geometry = objectShapeTitleGeometry(id);
      expect(Object.keys(geometry)).toEqual([...OBJECT_TITLE_POSITIONS]);
      for (const position of OBJECT_TITLE_POSITIONS) {
        const point = geometry[position];
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(1);
        expect(Math.hypot(point.dx, point.dy)).toBeGreaterThan(0);
      }
    }

    const oval = objectShapeTitleGeometry("oval");
    for (const position of ["top-left", "top-right", "bottom-right", "bottom-left"] as const) {
      const point = oval[position];
      expect(((point.x - .5) / .5) ** 2 + ((point.y - .5) / .5) ** 2)
        .toBeCloseTo(1, 10);
    }
  });

  it("derives polygon title anchors from the same live cut and slant as the path", () => {
    const hexagon = objectShapeTitleGeometry("hexagon", 300, 100);
    expect(hexagon["top-left"].x).toBeCloseTo(24 / 300, 8);
    expect(objectShapeGlyph("hexagon", 300, 100).framePath).toContain("M24 0");

    const parallelogram = objectShapeTitleGeometry("parallelogram", 300, 100);
    expect(parallelogram["top-left"].x).toBeCloseTo(20 / 300, 8);
    expect(objectShapeGlyph("parallelogram", 300, 100).framePath).toContain("M20 0");
  });

  it("uses the visible contour rather than its bounding rectangle for grouping", () => {
    for (const { id } of OBJECT_SHAPE_OPTIONS) {
      expect(objectShapeContainsPoint(id, .5, .5)).toBe(true);
      expect(objectShapeContainsPoint(id, -0.01, .5)).toBe(false);
    }
    expect(objectShapeContainsPoint("rectangle", .02, .02)).toBe(true);
    for (const shape of ["oval", "hexagon", "octagon", "rhombus", "triangle", "parallelogram"] as const) {
      expect(objectShapeContainsPoint(shape, .01, .01)).toBe(false);
    }
  });
});
