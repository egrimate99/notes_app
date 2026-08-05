import { describe, expect, it } from "vitest";
import snapshotJson from "./public-atlas.snapshot.json";
import type { AtlasSnapshot } from "../domain/types";

const snapshot = snapshotJson as unknown as AtlasSnapshot;

describe("public atlas snapshot", () => {
  it("starts empty without exposing local content metadata", () => {
    expect(snapshot.subjects).toEqual([]);
    expect(snapshot.regions).toEqual([]);
    expect(snapshot.landmarks).toEqual([]);
    expect(snapshot.placements).toEqual([]);
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.trails).toEqual([]);
    expect(snapshot.importReport).toMatchObject({
      sourceVault: "",
      canvasPath: "",
      scannedMarkdown: 0,
      importedLandmarks: 0,
      importedConnections: 0,
      unplacedNotes: 0,
      encodingWarnings: 0,
    });
  });
});
