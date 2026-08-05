import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_GROUP_TITLE_FONT_SIZE,
  MAP_CUSTOMIZATIONS_SCHEMA_VERSION,
  MAX_GROUP_TITLE_FONT_SIZE,
  MIN_GROUP_TITLE_FONT_SIZE,
  clampGroupFillOpacity,
  clampGroupTitleFontSize,
  clearMapCustomizations,
  emptyMapCustomizations,
  loadMapCustomizations,
  saveMapCustomizations,
  defaultGroupBorderWeight,
  defaultGroupFillOpacity,
  type MapCustomizations,
} from "./mapCustomizationStore";

const snapshotKey = "synthetic-atlas:2026-08-03";

function storageKeyFor(snapshot: string) {
  expect(saveMapCustomizations(emptyMapCustomizations(snapshot))).toBe(true);
  const key = localStorage.key(localStorage.length - 1);
  expect(key).not.toBeNull();
  return key!;
}

describe("mapCustomizationStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates and loads an empty snapshot with a normalized key", () => {
    const expected = {
      schemaVersion: MAP_CUSTOMIZATIONS_SCHEMA_VERSION,
      snapshotKey,
      landmarkKinds: {},
      landmarks: {},
      groups: {},
      customLandmarks: [],
      customGroups: [],
      connectionOverrides: {},
      customConnections: [],
    };

    expect(emptyMapCustomizations(`  ${snapshotKey}  `)).toEqual(expected);
    expect(loadMapCustomizations(`  ${snapshotKey}  `)).toEqual(expected);
  });

  it("provides bounded surface controls and hierarchy-aware legacy defaults", () => {
    expect(clampGroupFillOpacity(-1)).toBe(0);
    expect(clampGroupFillOpacity(.346)).toBe(.35);
    expect(clampGroupFillOpacity(2)).toBe(.5);
    expect(clampGroupFillOpacity(Number.NaN)).toBe(.34);
    expect(defaultGroupFillOpacity("subject")).toBe(0);
    expect(defaultGroupFillOpacity("group")).toBe(.34);
    expect(defaultGroupFillOpacity("subgroup")).toBe(.44);
    expect(defaultGroupBorderWeight("subject")).toBe("strong");
    expect(defaultGroupBorderWeight("group")).toBe("regular");
    expect(defaultGroupBorderWeight("subgroup")).toBe("hairline");
    expect(DEFAULT_GROUP_COLOR).toBe("#92989F");
  });

  it("updates groups saved with the former default grey", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      groups: {
        legacyRegion: { color: "#686d73" },
      },
      customGroups: [{
        id: "legacy-group",
        title: "Legacy group",
        subjectId: "synthetic-field-02",
        x: 0,
        y: 0,
        width: 280,
        height: 168,
        color: "#686D73",
        shape: "rectangle",
      }],
    } as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    const loaded = loadMapCustomizations(snapshotKey);
    expect(loaded.groups.legacyRegion.color).toBe(DEFAULT_GROUP_COLOR);
    expect(loaded.customGroups[0].color).toBe(DEFAULT_GROUP_COLOR);
  });

  it("round-trips customizations whose snapshot key has surrounding whitespace", () => {
    const padded = {
      ...emptyMapCustomizations(snapshotKey),
      snapshotKey: `  ${snapshotKey}  `,
      landmarkKinds: { regression: "concept" as const },
    };

    expect(saveMapCustomizations(padded)).toBe(true);
    expect(loadMapCustomizations(snapshotKey)).toEqual({
      ...emptyMapCustomizations(snapshotKey),
      landmarkKinds: { regression: "concept" },
    });
  });

  it("round-trips a complete valid customization payload", () => {
    const customizations: MapCustomizations = {
      ...emptyMapCustomizations(snapshotKey),
      landmarkKinds: {
        "least-squares": "method",
      },
      landmarks: {
        "least-squares": {
          color: "#AA3366",
          shape: "parallelogram",
          width: 336,
          height: 196,
          contentMode: "formula",
          formulaIndex: 3,
          hidden: true,
        },
      },
      groups: {
        "linear-models": {
          level: "group",
          title: "Linear models",
          x: -40,
          y: 220,
          width: 460,
          height: 300,
          color: "#336699",
          shape: "oval",
          borderStyle: "double",
          borderWeight: "strong",
          fillOpacity: .18,
          titlePosition: "bottom-right",
          titleFontSize: 42,
        },
      },
      customLandmarks: [
        {
          id: "ridge-regression",
          title: "Ridge regression",
          subjectId: "synthetic-field-05",
          regionId: "linear-models",
          contentPath: "content/Synthetic Field/Ridge regression.md",
          x: 120,
          y: 240,
          width: 220,
          height: 100,
          color: "#445566",
          shape: "hexagon",
          kind: "theorem",
          contentMode: "note",
          formulaIndex: 2,
        },
      ],
      customGroups: [
        {
          id: "regularized-models",
          title: "Regularized models",
          subjectId: "synthetic-field-05",
          level: "subgroup",
          parentId: "linear-models",
          regionId: "linear-models",
          x: 80,
          y: 180,
          width: 520,
          height: 360,
          color: "#225577",
          shape: "rounded-rectangle",
          borderStyle: "dashed",
          borderWeight: "hairline",
          fillOpacity: .5,
          titlePosition: "top-center",
          titleFontSize: 34,
        },
      ],
      connectionOverrides: {
        "depends-on": {
          label: "requires",
          direction: "reverse",
          lineStyle: "dashed",
          pathStyle: "curve",
          color: "#AA5500",
          hidden: false,
        },
      },
      customConnections: [
        {
          id: "custom-1",
          source: "normal-equations",
          target: "least-squares",
          sourceHandle: "top",
          targetHandle: null,
          label: "solves",
          direction: "forward",
          lineStyle: "solid",
          pathStyle: "smooth",
          color: "#225588",
          hidden: false,
        },
      ],
    };

    expect(saveMapCustomizations(customizations)).toBe(true);
    expect(loadMapCustomizations(snapshotKey)).toEqual(customizations);
  });

  it("ignores corrupt JSON and incompatible storage envelopes", () => {
    const key = storageKeyFor(snapshotKey);
    const empty = emptyMapCustomizations(snapshotKey);

    localStorage.setItem(key, "{not valid JSON");
    expect(loadMapCustomizations(snapshotKey)).toEqual(empty);

    localStorage.setItem(
      key,
      JSON.stringify({
        ...empty,
        schemaVersion: MAP_CUSTOMIZATIONS_SCHEMA_VERSION + 1,
        landmarkKinds: { theorem: "result" },
      }),
    );
    expect(loadMapCustomizations(snapshotKey)).toEqual(empty);

    localStorage.setItem(
      key,
      JSON.stringify({
        ...empty,
        snapshotKey: "another-snapshot",
        landmarkKinds: { theorem: "result" },
      }),
    );
    expect(loadMapCustomizations(snapshotKey)).toEqual(empty);
  });

  it("keeps every valid landmark role override and drops malformed roles", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      landmarkKinds: {
        concept: "concept",
        definition: "definition",
        theorem: "theorem",
        proposition: "proposition",
        lemma: "lemma",
        corollary: "corollary",
        legacyResult: "result",
        algorithm: "method",
        workedExample: "example",
        tooSpecific: "claim",
        notText: 42,
        missing: null,
      },
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(loadMapCustomizations(snapshotKey).landmarkKinds).toEqual({
      concept: "concept",
      definition: "definition",
      theorem: "theorem",
      proposition: "proposition",
      lemma: "lemma",
      corollary: "corollary",
      legacyResult: "theorem",
      algorithm: "method",
      workedExample: "example",
    });
  });

  it("normalizes landmark colour, shape, compiled content, and dimensions", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      landmarks: {
        theorem: { color: "#c01a7b", shape: "hexagon", width: 336, height: 196, contentMode: "formula" },
        example: { shape: "oval" },
        dirty: { color: "magenta", shape: "document", width: 20, height: 12, contentMode: "raw" },
        nonObject: null,
      },
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(loadMapCustomizations(snapshotKey).landmarks).toEqual({
      theorem: { color: "#C01A7B", shape: "hexagon", width: 336, height: 196, contentMode: "formula" },
      example: { shape: "oval" },
      dirty: {},
    });
  });

  it("drops malformed formula selections without discarding their landmarks", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      landmarks: {
        negative: { formulaIndex: -1 },
        fractional: { formulaIndex: 1.5 },
        oversized: { formulaIndex: 10_001 },
        textual: { formulaIndex: "2" },
      },
      customLandmarks: [{
        id: "formula-copy",
        title: "Formula copy",
        subjectId: "synthetic-field-02",
        regionId: "synthetic-foundations",
        contentPath: "content/Synthetic Field/Formula copy.md",
        x: 0,
        y: 0,
        width: 196,
        height: 84,
        color: "#112233",
        shape: "rectangle",
        contentMode: "formula",
        formulaIndex: Number.NaN,
      }],
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    const loaded = loadMapCustomizations(snapshotKey);
    expect(loaded.landmarks).toEqual({
      negative: {},
      fractional: {},
      oversized: {},
      textual: {},
    });
    expect(loaded.customLandmarks).toEqual([{
      id: "formula-copy",
      title: "Formula copy",
      subjectId: "synthetic-field-02",
      regionId: "synthetic-foundations",
      contentPath: "content/Synthetic Field/Formula copy.md",
      x: 0,
      y: 0,
      width: 196,
      height: 84,
      color: "#112233",
      shape: "rectangle",
      contentMode: "formula",
    }]);
  });

  it("normalizes valid group shapes, colors, borders, positions, and sizes", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      groups: {
        frame: {
          title: "  Framed region  ",
          x: -12.5,
          y: 0,
          width: 180,
          height: 120,
          color: "#abcdef",
          shape: "frame",
          borderStyle: "solid",
          borderWeight: "strong",
          fillOpacity: .346,
          titlePosition: "top-left",
          titleFontSize: MIN_GROUP_TITLE_FONT_SIZE,
        },
        rounded: {
          width: 320,
          height: 240,
          color: "#123456",
          shape: "rounded",
          borderStyle: "dashed",
          borderWeight: "hairline",
          fillOpacity: 0,
          titlePosition: "top-center",
          titleFontSize: MAX_GROUP_TITLE_FONT_SIZE,
        },
        capsule: {
          width: 640,
          height: 160,
          color: "#a1b2c3",
          shape: "capsule",
          borderStyle: "double",
          titlePosition: "middle-right",
          titleFontSize: 28.4,
        },
        hexagon: {
          x: 90,
          y: 110,
          shape: "hexagon",
          titlePosition: "bottom-center",
        },
        dirty: {
          x: Number.NaN,
          y: Number.POSITIVE_INFINITY,
          width: 179,
          height: 119,
          color: "blue",
          shape: "triangle",
          borderStyle: "dotted",
          borderWeight: "heavy",
          fillOpacity: .51,
          titlePosition: "center",
          titleFontSize: MAX_GROUP_TITLE_FONT_SIZE + 1,
        },
        nonObject: null,
      },
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(loadMapCustomizations(snapshotKey).groups).toEqual({
      frame: {
        title: "Framed region",
        x: -12.5,
        y: 0,
        width: 180,
        height: 120,
        color: "#ABCDEF",
        shape: "rectangle",
        borderStyle: "solid",
        borderWeight: "strong",
        fillOpacity: .35,
        titlePosition: "top-left",
        titleFontSize: MIN_GROUP_TITLE_FONT_SIZE,
      },
      rounded: {
        width: 320,
        height: 240,
        color: "#123456",
        shape: "oval",
        borderStyle: "dashed",
        borderWeight: "hairline",
        fillOpacity: 0,
        titlePosition: "top-center",
        titleFontSize: MAX_GROUP_TITLE_FONT_SIZE,
      },
      capsule: {
        width: 640,
        height: 160,
        color: "#A1B2C3",
        shape: "oval",
        borderStyle: "double",
        titlePosition: "middle-right",
        titleFontSize: 28,
      },
      hexagon: {
        x: 90,
        y: 110,
        shape: "hexagon",
        titlePosition: "bottom-center",
      },
      dirty: { shape: "triangle" },
    });
  });

  it("normalizes canvas instances, keeps file copies, and rejects id collisions", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      customLandmarks: [
        {
          id: "custom-estimator",
          title: "  Custom estimator  ",
          subjectId: "synthetic-field-05",
          regionId: "linear-models",
          contentPath: "Synthetic Field/Custom estimator.md",
          position: { x: -25.5, y: 400 },
          size: { width: 240, height: 96 },
          color: "#1a2b3c",
          shape: "rhombus",
          kind: "result",
        },
        {
          id: "custom-estimator",
          title: "Duplicate id",
          subjectId: "synthetic-field-05",
          regionId: "linear-models",
          contentPath: "Synthetic Field/Duplicate.md",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          color: "#112233",
          shape: "rectangle",
        },
        {
          id: "duplicate-path",
          title: "Duplicate path",
          subjectId: "synthetic-field-05",
          regionId: "linear-models",
          contentPath: "content/Synthetic Field/Custom estimator.md",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          color: "#112233",
          shape: "rectangle",
        },
        {
          id: "too-small",
          title: "Too small",
          subjectId: "synthetic-field-05",
          regionId: "linear-models",
          contentPath: "Synthetic Field/Too small.md",
          x: 0,
          y: 0,
          width: 95,
          height: 47,
          color: "#112233",
          shape: "rectangle",
        },
      ],
      customGroups: [
        {
          id: "custom-region",
          title: "  Custom region  ",
          subjectId: "synthetic-field-05",
          regionId: "linear-models",
          position: { x: 10, y: 20 },
          size: { width: 500, height: 320 },
          color: "#5a6b7c",
          shape: "rounded",
          borderStyle: "double",
          borderWeight: "regular",
          fillOpacity: .499,
          titlePosition: "middle-left",
          titleFontSize: 35.6,
        },
        {
          id: "custom-region",
          title: "Duplicate",
          subjectId: "synthetic-field-05",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          color: "#112233",
          shape: "rectangle",
        },
        {
          id: "bad-shape",
          title: "Bad shape",
          subjectId: "synthetic-field-07",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          color: "#112233",
          shape: "stepped",
        },
      ],
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    const loaded = loadMapCustomizations(snapshotKey);
    expect(loaded.customLandmarks).toEqual([
      {
        id: "custom-estimator",
        title: "Custom estimator",
        subjectId: "synthetic-field-05",
        regionId: "linear-models",
        contentPath: "content/Synthetic Field/Custom estimator.md",
        x: -25.5,
        y: 400,
        width: 240,
        height: 96,
        color: "#1A2B3C",
        shape: "rhombus",
        kind: "theorem",
      },
      {
        id: "duplicate-path",
        title: "Duplicate path",
        subjectId: "synthetic-field-05",
        regionId: "linear-models",
        contentPath: "content/Synthetic Field/Custom estimator.md",
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        color: "#112233",
        shape: "rectangle",
      },
    ]);
    expect(loaded.customGroups).toEqual([
      {
        id: "custom-region",
        title: "Custom region",
        subjectId: "synthetic-field-05",
        regionId: "linear-models",
        x: 10,
        y: 20,
        width: 500,
        height: 320,
        color: "#5A6B7C",
        shape: "oval",
        borderStyle: "double",
        borderWeight: "regular",
        fillOpacity: .5,
        titlePosition: "middle-left",
        titleFontSize: 36,
      },
    ]);
  });

  it("loads version-one snapshots written before appearance fields existed", () => {
    const key = storageKeyFor(snapshotKey);
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: MAP_CUSTOMIZATIONS_SCHEMA_VERSION,
        snapshotKey,
        landmarkKinds: { theorem: "theorem" },
        groups: { legacy: { shape: "frame" } },
        connectionOverrides: {},
        customConnections: [],
      }),
    );

    expect(loadMapCustomizations(snapshotKey)).toEqual({
      ...emptyMapCustomizations(snapshotKey),
      landmarkKinds: { theorem: "theorem" },
      groups: { legacy: { shape: "rectangle" } },
    });
  });

  it("keeps title font sizes optional and safely clamps interactive values", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      groups: {
        missing: {},
        below: { titleFontSize: MIN_GROUP_TITLE_FONT_SIZE - 1 },
        above: { titleFontSize: MAX_GROUP_TITLE_FONT_SIZE + 1 },
        nonFinite: { titleFontSize: Number.NaN },
      },
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(loadMapCustomizations(snapshotKey).groups).toEqual({
      missing: {},
      below: {},
      above: {},
      nonFinite: {},
    });
    expect(clampGroupTitleFontSize(4)).toBe(MIN_GROUP_TITLE_FONT_SIZE);
    expect(clampGroupTitleFontSize(80)).toBe(MAX_GROUP_TITLE_FONT_SIZE);
    expect(clampGroupTitleFontSize(31.6)).toBe(32);
    expect(clampGroupTitleFontSize(Number.NaN)).toBe(
      DEFAULT_GROUP_TITLE_FONT_SIZE,
    );
  });

  it.each([
    "top-left",
    "top-center",
    "top-right",
    "middle-right",
    "bottom-right",
    "bottom-center",
    "bottom-left",
    "middle-left",
  ] as const)("round-trips the %s group-title anchor", (titlePosition) => {
    const candidate: MapCustomizations = {
      ...emptyMapCustomizations(snapshotKey),
      groups: { sample: { titlePosition } },
    };

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(
      loadMapCustomizations(snapshotKey).groups.sample.titlePosition,
    ).toBe(titlePosition);
  });

  it("sanitizes connection overrides without discarding valid options", () => {
    const longLabel = "x".repeat(200);
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      connectionOverrides: {
        complete: {
          source: "group-a",
          target: "landmark-b",
          sourceHandle: null,
          targetHandle: "bottom-2",
          label: longLabel,
          direction: "both",
          lineStyle: "dotted",
          pathStyle: "straight",
          color: "#c0ffee",
          hidden: true,
        },
        malformed: {
          source: "",
          target: 17,
          sourceHandle: "contains spaces",
          targetHandle: 4,
          label: false,
          direction: "sideways",
          lineStyle: "wavy",
          pathStyle: "orthogonal",
          color: "#fff",
          hidden: "yes",
        },
        nonObject: false,
      },
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(loadMapCustomizations(snapshotKey).connectionOverrides).toEqual({
      complete: {
        source: "group-a",
        target: "landmark-b",
        sourceHandle: null,
        targetHandle: "bottom-2",
        label: "x".repeat(160),
        direction: "both",
        lineStyle: "dotted",
        pathStyle: "straight",
        color: "#C0FFEE",
        hidden: true,
      },
      malformed: {},
    });
  });

  it("keeps valid custom connections and rejects missing endpoints and loops", () => {
    const candidate = {
      ...emptyMapCustomizations(snapshotKey),
      customConnections: [
        {
          id: "custom-valid",
          source: "group-a",
          target: "landmark-b",
          sourceHandle: "right",
          targetHandle: "left",
          label: "motivates",
          direction: "none",
          lineStyle: "dashed",
          pathStyle: "curve",
          color: "#deaf01",
          hidden: false,
        },
        {
          id: "custom-valid",
          source: "duplicate-source",
          target: "duplicate-target",
          label: "must be ignored",
        },
        { id: "", source: "a", target: "b" },
        { id: "missing-source", target: "b" },
        { id: "missing-target", source: "a" },
        { id: "self-loop", source: "a", target: "a" },
        null,
        "not-an-edge",
      ],
    } as unknown as MapCustomizations;

    expect(saveMapCustomizations(candidate)).toBe(true);
    expect(loadMapCustomizations(snapshotKey).customConnections).toEqual([
      {
        id: "custom-valid",
        source: "group-a",
        target: "landmark-b",
        sourceHandle: "right",
        targetHandle: "left",
        label: "motivates",
        direction: "none",
        lineStyle: "dashed",
        pathStyle: "curve",
        color: "#DEAF01",
        hidden: false,
      },
    ]);
  });

  it("clears only the requested snapshot and rejects blank snapshot keys", () => {
    const otherSnapshot = "secondary-atlas:2026-08-03";
    const first = emptyMapCustomizations(snapshotKey);
    first.landmarkKinds.regression = "concept";
    const second = emptyMapCustomizations(otherSnapshot);
    second.landmarkKinds.expectation = "definition";

    expect(saveMapCustomizations(first)).toBe(true);
    expect(saveMapCustomizations(second)).toBe(true);
    expect(clearMapCustomizations(snapshotKey)).toBe(true);

    expect(loadMapCustomizations(snapshotKey)).toEqual(
      emptyMapCustomizations(snapshotKey),
    );
    expect(loadMapCustomizations(otherSnapshot)).toEqual(second);
    expect(saveMapCustomizations(emptyMapCustomizations("   "))).toBe(false);
    expect(clearMapCustomizations(" ")).toBe(false);
  });
});
