import type { LandmarkKind } from "./types";

export type MathNoteType =
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  | "method"
  | "example"
  | "note";

const displayTypeByKind: Record<LandmarkKind, MathNoteType> = {
  definition: "definition",
  theorem: "theorem",
  proposition: "proposition",
  lemma: "lemma",
  corollary: "corollary",
  result: "theorem",
  method: "method",
  example: "example",
  concept: "note",
  problem: "note",
  insight: "note",
  source: "note",
};

const displayLabelByType: Record<MathNoteType, string> = {
  definition: "Definition",
  theorem: "Theorem",
  proposition: "Proposition",
  lemma: "Lemma",
  corollary: "Corollary",
  method: "Method",
  example: "Example",
  note: "Note",
};

export function mathNoteType(kind: LandmarkKind) {
  return displayTypeByKind[kind];
}

export function mathNoteLabel(kind: LandmarkKind) {
  return displayLabelByType[mathNoteType(kind)];
}
