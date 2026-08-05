import { describe, expect, it } from "vitest";
import { arrangeBatchNotePositions } from "./batchNotePlacement";

describe("arrangeBatchNotePositions", () => {
  it("preserves the established centered and snapped single-note drop", () => {
    expect(arrangeBatchNotePositions(
      [{ width: 196, height: 112 }],
      { x: 197, y: 141 },
      [{ x: 112, y: 84, width: 196, height: 112 }],
      28,
    )).toEqual([{ x: 112, y: 84 }]);
  });

  it("packs a batch into a compact grid in source order", () => {
    expect(arrangeBatchNotePositions(
      Array.from({ length: 5 }, () => ({ width: 196, height: 84 })),
      { x: 98, y: 42 },
      [],
      28,
    )).toEqual([
      { x: 0, y: 0 },
      { x: 224, y: 0 },
      { x: 448, y: 0 },
      { x: 0, y: 112 },
      { x: 224, y: 112 },
    ]);
  });

  it("uses the widest column and tallest row so mixed source sizes never overlap", () => {
    expect(arrangeBatchNotePositions(
      [
        { width: 196, height: 84 },
        { width: 280, height: 140 },
        { width: 252, height: 112 },
        { width: 168, height: 168 },
      ],
      { x: 98, y: 42 },
      [],
      28,
    )).toEqual([
      { x: 0, y: 0 },
      { x: 280, y: 0 },
      { x: 0, y: 168 },
      { x: 280, y: 168 },
    ]);
  });

  it("moves a colliding batch as one block to the nearest clear snapped lane", () => {
    expect(arrangeBatchNotePositions(
      [
        { width: 196, height: 84 },
        { width: 196, height: 84 },
      ],
      { x: 98, y: 42 },
      [{ x: 0, y: 0, width: 196, height: 84 }],
      28,
    )).toEqual([
      { x: 0, y: 112 },
      { x: 224, y: 112 },
    ]);
  });
});
