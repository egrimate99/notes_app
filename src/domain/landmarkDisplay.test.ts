import { describe, expect, it } from "vitest";
import { mathNoteLabel, mathNoteType } from "./landmarkDisplay";

describe("landmarkDisplay", () => {
  it.each([
    ["theorem", "Theorem"],
    ["proposition", "Proposition"],
    ["lemma", "Lemma"],
    ["corollary", "Corollary"],
  ] as const)("keeps %s as a standard statement role", (kind, label) => {
    expect(mathNoteType(kind)).toBe(kind);
    expect(mathNoteLabel(kind)).toBe(label);
  });

  it("treats legacy result data as a theorem", () => {
    expect(mathNoteType("result")).toBe("theorem");
    expect(mathNoteLabel("result")).toBe("Theorem");
  });
});
