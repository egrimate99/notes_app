import { describe, expect, it } from "vitest";
import { emptyMapCustomizations } from "../state/mapCustomizationStore";
import {
  atlasMetadataToLegacyState,
  migrateLegacyAtlasState,
} from "./atlasMigration";

describe("atlas localStorage migration boundary", () => {
  it("combines map customizations and placements into one canonical document", () => {
    const customizations = emptyMapCustomizations("synthetic-atlas-pilot-v1");
    customizations.landmarks.ridge = { color: "#225588", shape: "hexagon" };
    const migrated = migrateLegacyAtlasState(customizations, [
      { landmarkId: "ridge", x: 100, y: 200 },
    ]);

    expect(migrated).toMatchObject({
      schemaVersion: 1,
      snapshotKey: "synthetic-atlas-pilot-v1",
      placements: [{ landmarkId: "ridge", x: 100, y: 200 }],
      customizations: {
        snapshotKey: "synthetic-atlas-pilot-v1",
        landmarks: { ridge: { color: "#225588", shape: "hexagon" } },
      },
    });
    expect(atlasMetadataToLegacyState(migrated)).toEqual({
      customizations,
      placements: [{ landmarkId: "ridge", x: 100, y: 200 }],
    });
  });

  it("drops invalid legacy coordinates at the migration boundary", () => {
    const customizations = emptyMapCustomizations("pilot");
    expect(
      migrateLegacyAtlasState(customizations, [
        { landmarkId: "valid", x: 10, y: 20 },
        { landmarkId: "valid", x: 30, y: 40 },
        { landmarkId: "broken", x: Number.POSITIVE_INFINITY, y: 20 },
      ]).placements,
    ).toEqual([{ landmarkId: "valid", x: 30, y: 40 }]);
  });
});
