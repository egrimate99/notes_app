/** Subject identities belong to each local atlas, never to the public build. */
export type SubjectId = string;

export type LandmarkKind =
  | "concept"
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  // Compatibility for imported snapshots and Markdown created before the
  // standard result classes were introduced. New edits should use a class above.
  | "result"
  | "method"
  | "example"
  | "problem"
  | "insight"
  | "source";

export type RelationKind =
  | "requires"
  | "implies"
  | "generalises"
  | "equivalent-to"
  | "uses"
  | "applies-to"
  | "example-of"
  | "counterexample-to"
  | "contrasts-with"
  | "analogous-to"
  | "related-to";

export type TrailKind =
  | "learning"
  | "proof"
  | "application"
  | "contrast"
  | "research"
  | "review";

export type KnowledgeStatus = "canonical" | "draft" | "frontier" | "imported";

export interface MasteryFacets {
  state: number;
  explain: number;
  derive: number;
  apply: number;
}

export interface SourceReference {
  label: string;
  path?: string;
  page?: number;
  locator?: string;
}

export interface Subject {
  id: SubjectId;
  title: string;
  shortTitle: string;
  description: string;
  accent: string;
  tint: string;
  landmarkCount: number;
}

export interface Region {
  id: string;
  title: string;
  subjectId: SubjectId;
  parentId?: string;
  description?: string;
}

export interface Landmark {
  id: string;
  title: string;
  kind: LandmarkKind;
  subtype?: string;
  subjectIds: SubjectId[];
  regionId: string;
  summary: string;
  markdown: string;
  statement?: string;
  notation?: string;
  tags: string[];
  status: KnowledgeStatus;
  mastery: MasteryFacets;
  source?: SourceReference;
  importedPath?: string;
  contentPath?: string;
  reviewDue?: boolean;
}

export interface Placement {
  landmarkId: string;
  x: number;
  y: number;
}

export interface Connection {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  label?: string;
  provisional?: boolean;
}

export interface TrailStep {
  landmarkId: string;
  prompt?: string;
}

export interface Trail {
  id: string;
  title: string;
  kind: TrailKind;
  subjectId: SubjectId;
  description: string;
  estimatedMinutes: number;
  steps: TrailStep[];
}

export interface ImportReport {
  generatedAt: string;
  sourceVault: string;
  canvasPath: string;
  scannedMarkdown: number;
  importedLandmarks: number;
  importedConnections: number;
  unplacedNotes: number;
  encodingWarnings: number;
  notes: string[];
}

export interface AtlasSnapshot {
  subjects: Subject[];
  regions: Region[];
  landmarks: Landmark[];
  placements: Placement[];
  connections: Connection[];
  trails: Trail[];
  importReport: ImportReport;
}
