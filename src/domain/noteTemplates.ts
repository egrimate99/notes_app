import type { LandmarkKind, SubjectId } from "./types";

export type MathematicalEnvironmentKind =
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  | "example";

const mathematicalEnvironmentKinds = new Set<LandmarkKind>([
  "definition",
  "theorem",
  "proposition",
  "lemma",
  "corollary",
  "example",
]);

export function isMathematicalEnvironmentKind(
  kind: LandmarkKind,
): kind is MathematicalEnvironmentKind {
  return mathematicalEnvironmentKinds.has(kind);
}

/**
 * The editable body created for a mathematical object.
 *
 * A note (and any kind without a matching mathematical environment) starts
 * genuinely empty. The filename is the document title, so a second Markdown
 * H1 is deliberately not generated.
 */
export function noteBodyTemplate(kind: LandmarkKind): string {
  return isMathematicalEnvironmentKind(kind)
    ? `> [!${kind}]\n> `
    : "";
}

export function landmarkFileTemplate({
  id,
  kind,
  subjectId,
}: {
  id: string;
  kind: LandmarkKind;
  subjectId: SubjectId;
}): string {
  const body = noteBodyTemplate(kind);
  const frontmatter = [
    "---",
    `id: ${id}`,
    `kind: ${kind}`,
    `subject: ${subjectId}`,
    "---",
  ].join("\n");
  return body ? `${frontmatter}\n\n${body}` : `${frontmatter}\n`;
}
