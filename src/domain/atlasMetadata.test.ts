import { describe, expect, it } from "vitest";
import {
  ATLAS_METADATA_SCHEMA_VERSION,
  emptyAtlasMetadata,
  validateAtlasMetadata,
} from "./atlasMetadata";

describe("atlas metadata schema", () => {
  it("creates a complete versioned empty document", () => {
    expect(emptyAtlasMetadata("  synthetic-atlas-pilot-v1  ")).toEqual({
      schemaVersion: ATLAS_METADATA_SCHEMA_VERSION,
      snapshotKey: "synthetic-atlas-pilot-v1",
      placements: [],
      customizations: {
        schemaVersion: 1,
        snapshotKey: "synthetic-atlas-pilot-v1",
        landmarkKinds: {},
        landmarks: {},
        groups: {},
        customLandmarks: [],
        customGroups: [],
        connectionOverrides: {},
        customConnections: [],
      },
    });
  });

  it("validates and normalizes a complete atlas", () => {
    const atlas = emptyAtlasMetadata("pilot");
    atlas.placements.push({ landmarkId: "least-squares", x: 120, y: -40 });
    atlas.customizations.landmarkKinds["least-squares"] = "theorem";
    atlas.customizations.landmarks["least-squares"] = {
      color: "#aa3366",
      shape: "hexagon",
      width: 336,
      height: 196,
      contentMode: "statement",
      formulaIndex: 4,
      hidden: true,
    };
    atlas.customizations.groups.overview = { shape: "rounded-rectangle" };
    atlas.customizations.customGroups.push({
      id: "linear-models",
      title: "Linear models",
      subjectId: "synthetic-field-05",
      level: "group",
      x: 0,
      y: 0,
      width: 500,
      height: 300,
      color: "#225577",
      shape: "rounded-rectangle",
      borderStyle: "dashed",
      borderWeight: "strong",
      fillOpacity: .345,
      titlePosition: "top-left",
      titleFontSize: 38,
    });
    atlas.customizations.customGroups.push({
      id: "least-squares-family",
      title: "Least-squares family",
      subjectId: "synthetic-field-05",
      level: "subgroup",
      parentId: "linear-models",
      x: 40,
      y: 40,
      width: 320,
      height: 180,
      color: "#336699",
      shape: "oval",
    });

    const result = validateAtlasMetadata(atlas);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value.customizations.landmarks["least-squares"].color).toBe("#AA3366");
    expect(result.value.customizations.landmarks["least-squares"]).toMatchObject({
      width: 336,
      height: 196,
      contentMode: "statement",
      formulaIndex: 4,
      hidden: true,
    });
    expect(result.value.customizations.groups.overview.shape).toBe("rounded-rectangle");
    expect(result.value.customizations.customGroups[1]).toMatchObject({
      level: "subgroup",
      parentId: "linear-models",
    });
    expect(result.value.customizations.customGroups[0].titleFontSize).toBe(38);
    expect(result.value.customizations.customGroups[0]).toMatchObject({
      shape: "rounded-rectangle",
      borderWeight: "strong",
      fillOpacity: .35,
    });
  });

  it("keeps the cloud rectangle territory-only in portable metadata", () => {
    const atlas = emptyAtlasMetadata("pilot") as unknown as {
      customizations: {
        landmarks: Record<string, Record<string, unknown>>;
      };
    };
    atlas.customizations.landmarks.note = { shape: "rounded-rectangle" };

    const result = validateAtlasMetadata(atlas);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("atlas.customizations.landmarks.note.shape: unknown shape");
  });

  it("accepts bounded optional group title font sizes and rejects invalid ones", () => {
    const atlas = emptyAtlasMetadata("pilot");
    atlas.customizations.groups.subject = { titleFontSize: 12 };
    atlas.customizations.customGroups.push({
      id: "sized-group",
      title: "Sized group",
      subjectId: "synthetic-field-02",
      x: 0,
      y: 0,
      width: 280,
      height: 168,
      color: "#D62828",
      shape: "rectangle",
      titleFontSize: 56,
    });

    const valid = validateAtlasMetadata(atlas);
    expect(valid.valid).toBe(true);
    expect(valid.value.customizations.groups.subject.titleFontSize).toBe(12);
    expect(valid.value.customizations.customGroups[0].titleFontSize).toBe(56);

    const invalid = structuredClone(atlas) as unknown as {
      customizations: {
        groups: Record<string, Record<string, unknown>>;
        customGroups: Array<Record<string, unknown>>;
      };
    };
    invalid.customizations.groups.subject.titleFontSize = 11;
    invalid.customizations.customGroups[0].titleFontSize = 57;
    const result = validateAtlasMetadata(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/titleFontSize|group field/);
  });

  it("validates authored fill opacity and border weight on both group forms", () => {
    const atlas = emptyAtlasMetadata("pilot");
    atlas.customizations.groups.subject = {
      borderWeight: "strong",
      fillOpacity: 0,
    };
    atlas.customizations.customGroups.push({
      id: "surface-group",
      title: "Surface group",
      subjectId: "synthetic-field-02",
      x: 0,
      y: 0,
      width: 280,
      height: 168,
      color: "#D62828",
      shape: "rectangle",
      borderWeight: "hairline",
      fillOpacity: .5,
    });

    const valid = validateAtlasMetadata(atlas);
    expect(valid.valid).toBe(true);
    expect(valid.value.customizations.groups.subject).toMatchObject({
      borderWeight: "strong",
      fillOpacity: 0,
    });
    expect(valid.value.customizations.customGroups[0]).toMatchObject({
      borderWeight: "hairline",
      fillOpacity: .5,
    });

    const invalid = structuredClone(atlas) as unknown as {
      customizations: {
        groups: Record<string, Record<string, unknown>>;
        customGroups: Array<Record<string, unknown>>;
      };
    };
    invalid.customizations.groups.subject.fillOpacity = -.01;
    invalid.customizations.customGroups[0].fillOpacity = .51;
    invalid.customizations.customGroups[0].borderWeight = "heavy";
    const result = validateAtlasMetadata(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/fillOpacity|group field/);
  });

  it("accepts legacy groups without a level and rejects invalid hierarchy fields", () => {
    const legacy = emptyAtlasMetadata("pilot");
    legacy.customizations.customGroups.push({
      id: "legacy-group",
      title: "Legacy group",
      subjectId: "synthetic-field-02",
      x: 0,
      y: 0,
      width: 280,
      height: 168,
      color: "#D62828",
      shape: "rectangle",
    });
    expect(validateAtlasMetadata(legacy).valid).toBe(true);

    const invalid = structuredClone(legacy) as unknown as {
      customizations: { customGroups: Array<Record<string, unknown>> };
    };
    invalid.customizations.customGroups[0].level = "chapter";
    invalid.customizations.customGroups[0].parentId = "legacy-group";
    const result = validateAtlasMetadata(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/group field/);
  });

  it("accepts multiple independent canvas instances of one Markdown file", () => {
    const atlas = emptyAtlasMetadata("pilot");
    const shared = {
      title: "Least squares",
      subjectId: "synthetic-field-05" as const,
      regionId: "linear-models",
      contentPath: "content/Synthetic Field/Least squares.md",
      width: 196,
      height: 84,
      color: "#336699",
      shape: "rectangle" as const,
    };
    atlas.customizations.customLandmarks.push(
      { ...shared, id: "least-squares-copy-a", x: 0, y: 0, formulaIndex: 0 },
      { ...shared, id: "least-squares-copy-b", x: 280, y: 140, formulaIndex: 3 },
    );

    const result = validateAtlasMetadata(atlas);
    expect(result.valid).toBe(true);
    expect(result.value.customizations.customLandmarks).toHaveLength(2);
    expect(new Set(result.value.customizations.customLandmarks.map(({ id }) => id))).toEqual(
      new Set(["least-squares-copy-a", "least-squares-copy-b"]),
    );
    expect(result.value.customizations.customLandmarks.map(({ formulaIndex }) => formulaIndex))
      .toEqual([0, 3]);
  });

  it("rejects malformed formula selections on styles and custom landmarks", () => {
    const atlas = emptyAtlasMetadata("pilot");
    const landmarks = atlas.customizations.landmarks as Record<string, Record<string, unknown>>;
    landmarks.negative = { formulaIndex: -1 };
    landmarks.fractional = { formulaIndex: 1.5 };
    landmarks.oversized = { formulaIndex: 10_001 };
    (atlas.customizations.customLandmarks as unknown[]).push({
      id: "invalid-formula-copy",
      title: "Invalid formula copy",
      subjectId: "synthetic-field-02",
      regionId: "synthetic-foundations",
      contentPath: "content/Synthetic Field/Invalid formula copy.md",
      x: 0,
      y: 0,
      width: 196,
      height: 84,
      color: "#112233",
      shape: "rectangle",
      contentMode: "formula",
      formulaIndex: "2",
    });

    const result = validateAtlasMetadata(atlas);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "atlas.customizations.landmarks.negative.formulaIndex: expected a non-negative integer",
      "atlas.customizations.landmarks.fractional.formulaIndex: expected a non-negative integer",
      "atlas.customizations.landmarks.oversized.formulaIndex: expected a non-negative integer",
      "atlas.customizations.customLandmarks[0].formulaIndex: expected a non-negative integer",
    ]));
    expect(result.value.customizations.landmarks.negative).not.toHaveProperty("formulaIndex");
    expect(result.value.customizations.customLandmarks[0]).not.toHaveProperty("formulaIndex");
  });

  it("rejects partial, dangerous, duplicate, and incompatible content", () => {
    const atlas = emptyAtlasMetadata("pilot");
    atlas.placements = [
      { landmarkId: "same", x: 1, y: 2 },
      { landmarkId: "same", x: 3, y: 4 },
    ];
    const unsafe = atlas as unknown as Record<string, unknown>;
    unsafe.schemaVersion = 999;
    (atlas.customizations.customLandmarks as unknown[]).push({
      id: "unsafe-note",
      title: "Unsafe",
      subjectId: "synthetic-field-02",
      regionId: "region",
      contentPath: "content/../outside.md",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      color: "#112233",
      shape: "rectangle",
    });

    const result = validateAtlasMetadata(unsafe, "fallback");
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/schemaVersion/);
    expect(result.issues.join(" ")).toMatch(/duplicate same/);
    expect(result.issues.join(" ")).toMatch(/landmark field/);
  });

  it("does not accept map customizations for a different snapshot", () => {
    const atlas = emptyAtlasMetadata("pilot");
    atlas.customizations.snapshotKey = "another-pilot";
    expect(validateAtlasMetadata(atlas)).toMatchObject({ valid: false });
  });
});
