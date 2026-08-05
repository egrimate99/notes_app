import { describe, expect, it } from "vitest";
import {
  markdownForManagedImage,
  relativeManagedImageReference,
  resolveManagedImagePath,
} from "./assetPaths";

const hash = "a".repeat(64);
const asset = `.assets/${hash}.png`;

describe("managed image paths", () => {
  it("writes portable paths relative to deeply nested notes", () => {
    expect(relativeManagedImageReference(
      "Synthetic Field/Models/Linear/Least squares.md",
      asset,
    )).toBe(`../../../${asset}`);
    expect(markdownForManagedImage(
      "Synthetic Field/Models/Linear/Least squares.md",
      asset,
      "Normal equation [plot].png",
    )).toBe(`![Normal equation  plot](../../../${asset})`);
  });

  it("resolves both portable relative paths and vault-root asset paths", () => {
    expect(resolveManagedImagePath(
      "Synthetic Field/Models/Linear/Least squares.md",
      `../../../${asset}`,
    )).toBe(asset);
    expect(resolveManagedImagePath("Primary Field/Limit.md", `/${asset}`)).toBe(asset);
  });

  it("does not intercept remote, traversal, or ordinary note images", () => {
    expect(resolveManagedImagePath("Primary Field/Limit.md", "https://example.com/a.png")).toBeUndefined();
    expect(resolveManagedImagePath("Primary Field/Limit.md", "../../../.assets/nope.png")).toBeUndefined();
    expect(resolveManagedImagePath("Primary Field/Limit.md", "diagram.png")).toBeUndefined();
  });
});
