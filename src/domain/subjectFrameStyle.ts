/** Stable persisted identities for the decorative treatment of subject frames. */
export const SUBJECT_FRAME_STYLE_OPTIONS = [
  { id: "double-rule", label: "Curve" },
  { id: "triple-rule", label: "Candlesticks" },
  { id: "corner-brackets", label: "Vector grid" },
  { id: "dashed-inset", label: "Neural circuit" },
  { id: "cardinal-ticks", label: "Chess knight" },
  { id: "beaded", label: "Dice" },
  { id: "offset-rails", label: "Scatter plot" },
] as const;

export type SubjectFrameStyle = (typeof SUBJECT_FRAME_STYLE_OPTIONS)[number]["id"];

export const DEFAULT_SUBJECT_FRAME_STYLE: SubjectFrameStyle = "double-rule";

const subjectFrameStyles = new Set<SubjectFrameStyle>(
  SUBJECT_FRAME_STYLE_OPTIONS.map(({ id }) => id),
);

export function isSubjectFrameStyle(value: unknown): value is SubjectFrameStyle {
  return subjectFrameStyles.has(value as SubjectFrameStyle);
}
