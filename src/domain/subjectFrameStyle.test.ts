import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBJECT_FRAME_STYLE,
  SUBJECT_FRAME_STYLE_OPTIONS,
  isSubjectFrameStyle,
} from "./subjectFrameStyle";

describe("subject frame styles", () => {
  it("exposes exactly seven stable, uniquely labelled choices", () => {
    expect(SUBJECT_FRAME_STYLE_OPTIONS.map(({ id }) => id)).toEqual([
      "double-rule",
      "triple-rule",
      "corner-brackets",
      "dashed-inset",
      "cardinal-ticks",
      "beaded",
      "offset-rails",
    ]);
    expect(new Set(SUBJECT_FRAME_STYLE_OPTIONS.map(({ id }) => id)).size).toBe(7);
    expect(SUBJECT_FRAME_STYLE_OPTIONS.map(({ label }) => label)).toEqual([
      "Curve",
      "Candlesticks",
      "Vector grid",
      "Neural circuit",
      "Chess knight",
      "Dice",
      "Scatter plot",
    ]);
  });

  it("recognizes every supported style and rejects unknown values", () => {
    SUBJECT_FRAME_STYLE_OPTIONS.forEach(({ id }) => {
      expect(isSubjectFrameStyle(id)).toBe(true);
    });
    expect(isSubjectFrameStyle("plain")).toBe(false);
    expect(isSubjectFrameStyle(1)).toBe(false);
    expect(isSubjectFrameStyle(undefined)).toBe(false);
    expect(isSubjectFrameStyle(DEFAULT_SUBJECT_FRAME_STYLE)).toBe(true);
    expect(DEFAULT_SUBJECT_FRAME_STYLE).toBe("double-rule");
  });
});
