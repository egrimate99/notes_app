import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPlacementOverrides,
  loadPlacementOverrides,
  savePlacementOverrides,
} from "./placementStore";

const snapshotKey = "synthetic-atlas:2026-08-03";
const allowedIds = ["linear-models", "kernel-trick"];

describe("placementStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips finite coordinates for landmarks in the active snapshot", () => {
    expect(
      savePlacementOverrides(
        snapshotKey,
        [
          { landmarkId: "linear-models", x: 120.5, y: -32 },
          { landmarkId: "not-in-this-snapshot", x: 1, y: 2 },
          { landmarkId: "kernel-trick", x: Number.POSITIVE_INFINITY, y: 4 },
        ],
        allowedIds,
      ),
    ).toBe(true);

    expect(loadPlacementOverrides(snapshotKey, allowedIds)).toEqual([
      { landmarkId: "linear-models", x: 120.5, y: -32 },
    ]);
  });

  it("keeps the latest valid coordinate when a landmark is duplicated", () => {
    savePlacementOverrides(
      snapshotKey,
      [
        { landmarkId: "kernel-trick", x: 10, y: 20 },
        { landmarkId: "kernel-trick", x: 30, y: 40 },
      ],
      allowedIds,
    );

    expect(loadPlacementOverrides(snapshotKey, allowedIds)).toEqual([
      { landmarkId: "kernel-trick", x: 30, y: 40 },
    ]);
  });

  it("ignores corrupt JSON and payloads from an incompatible schema", () => {
    savePlacementOverrides(
      snapshotKey,
      [{ landmarkId: "linear-models", x: 1, y: 2 }],
      allowedIds,
    );
    const key = localStorage.key(0);
    expect(key).not.toBeNull();

    localStorage.setItem(key!, "{not valid JSON");
    expect(loadPlacementOverrides(snapshotKey, allowedIds)).toEqual([]);

    localStorage.setItem(
      key!,
      JSON.stringify({
        schemaVersion: 999,
        snapshotKey,
        placements: [{ landmarkId: "linear-models", x: 1, y: 2 }],
      }),
    );
    expect(loadPlacementOverrides(snapshotKey, allowedIds)).toEqual([]);
  });

  it("isolates snapshots and can reset an individual snapshot", () => {
    savePlacementOverrides(
      snapshotKey,
      [{ landmarkId: "linear-models", x: 5, y: 6 }],
      allowedIds,
    );

    expect(loadPlacementOverrides("another-snapshot", allowedIds)).toEqual([]);
    expect(clearPlacementOverrides(snapshotKey)).toBe(true);
    expect(loadPlacementOverrides(snapshotKey, allowedIds)).toEqual([]);
  });

  it("normalizes surrounding whitespace in snapshot keys", () => {
    savePlacementOverrides(
      `  ${snapshotKey}  `,
      [{ landmarkId: "linear-models", x: 7, y: 8 }],
      allowedIds,
    );

    expect(loadPlacementOverrides(snapshotKey, allowedIds)).toEqual([
      { landmarkId: "linear-models", x: 7, y: 8 },
    ]);
  });

  it("treats blank snapshot keys as non-persistable", () => {
    expect(
      savePlacementOverrides(
        "   ",
        [{ landmarkId: "linear-models", x: 1, y: 2 }],
        allowedIds,
      ),
    ).toBe(false);
    expect(loadPlacementOverrides("", allowedIds)).toEqual([]);
    expect(clearPlacementOverrides(" ")).toBe(false);
  });
});
