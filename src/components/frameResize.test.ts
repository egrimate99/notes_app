import { describe, expect, it } from "vitest";
import { snappedFrameDimensions } from "./frameResize";

describe("snappedFrameDimensions", () => {
  const start = { x: 112, y: 84, width: 196, height: 84 };

  it("snaps only the moving right edge and preserves the opposite edge", () => {
    expect(snappedFrameDimensions(
      { x: 112, y: 84, width: 227, height: 84 },
      start,
      { x: 1, y: 0 },
      28,
      112,
      56,
    )).toEqual({ x: 112, y: 84, width: 224, height: 84 });
  });

  it("snaps a north-west corner without moving the fixed south-east corner", () => {
    expect(snappedFrameDimensions(
      { x: 91, y: 53, width: 217, height: 115 },
      start,
      { x: -1, y: -1 },
      28,
      112,
      56,
    )).toEqual({ x: 84, y: 56, width: 224, height: 112 });
  });

  it("respects minimum dimensions at the grid edge", () => {
    expect(snappedFrameDimensions(
      { x: 112, y: 84, width: 25, height: 18 },
      start,
      { x: 1, y: 1 },
      28,
      112,
      56,
    )).toEqual({ x: 112, y: 84, width: 112, height: 56 });
  });
});
