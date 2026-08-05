import { describe, expect, it } from "vitest";
import snapshotJson from "./public-atlas.test-fixture.json";
import type { AtlasSnapshot } from "../domain/types";

const snapshot = snapshotJson as unknown as AtlasSnapshot;

describe("public atlas test fixture", () => {
  it("contains a small, explicitly synthetic graph", () => {
    expect(snapshot.landmarks).toHaveLength(3);
    expect(snapshot.importReport).toMatchObject({
      sourceVault: "synthetic-public-fixture",
      scannedMarkdown: 3,
      importedLandmarks: 3,
      importedConnections: 1,
    });
    expect(new Set(snapshot.landmarks.map((landmark) => landmark.id)).size).toBe(3);
  });

  it("keeps all graph references valid", () => {
    const landmarkIds = new Set(snapshot.landmarks.map((landmark) => landmark.id));

    snapshot.placements.forEach((placement) => {
      expect(landmarkIds.has(placement.landmarkId)).toBe(true);
    });
    snapshot.connections.forEach((connection) => {
      expect(landmarkIds.has(connection.source)).toBe(true);
      expect(landmarkIds.has(connection.target)).toBe(true);
    });
    snapshot.trails.forEach((trail) => {
      trail.steps.forEach((step) => {
        expect(landmarkIds.has(step.landmarkId)).toBe(true);
      });
    });
  });

  it("uses a single generic subject for its examples", () => {
    expect(snapshot.subjects.map((subject) => subject.id)).toEqual(["synthetic-field"]);
    expect(snapshot.subjects[0]?.landmarkCount).toBe(3);
    expect(snapshot.landmarks.every(({ subjectIds }) => subjectIds[0] === "synthetic-field"))
      .toBe(true);
  });

  it("contains a complete synthetic learning trail", () => {
    const trail = snapshot.trails.find(
      (candidate) => candidate.id === "fixture-trail-public-example",
    );
    expect(trail?.steps).toHaveLength(2);
    expect(trail?.steps.every((step) => Boolean(step.prompt))).toBe(true);

    const placementById = new Map(
      snapshot.placements.map((placement) => [placement.landmarkId, placement]),
    );
    const firstY = placementById.get(trail!.steps[0].landmarkId)?.y;
    const lastY = placementById.get(
      trail!.steps[trail!.steps.length - 1].landmarkId,
    )?.y;
    expect(firstY).toBeGreaterThan(lastY!);
  });

  it("preserves parent-child region structure", () => {
    const regionsByTitle = new Map(
      snapshot.regions.map((region) => [region.title, region]),
    );
    expect(regionsByTitle.has("Example collection")).toBe(true);
    expect(regionsByTitle.get("Example details")?.parentId).toBe(
      "fixture-region-examples",
    );
  });
});
