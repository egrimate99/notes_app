import { titleForRepositoryPath } from "./contentPaths";

export const WIKI_LINK_SCHEME = "math-atlas-wiki:";

export interface WikiNoteReference {
  /** Forward-slash path relative to the canonical content directory. */
  path: string;
  title: string;
  folder: string;
  aliases: readonly string[];
}

export interface WikiLinkIndex {
  notes: readonly WikiNoteReference[];
  byPath: ReadonlyMap<string, WikiNoteReference>;
  byTitle: ReadonlyMap<string, readonly WikiNoteReference[]>;
  byAlias: ReadonlyMap<string, readonly WikiNoteReference[]>;
}

export type WikiNoteInput = string | {
  path: string;
  aliases?: readonly string[];
};

export type WikiLinkResolution =
  | { status: "resolved"; note: WikiNoteReference }
  | { status: "ambiguous"; candidates: readonly WikiNoteReference[] }
  | { status: "missing" };

export interface WikiLinkSuggestion extends WikiNoteReference {
  insertion: string;
  duplicateTitle: boolean;
  score: number;
}

function normalizeSlashes(value: string) {
  return value.normalize("NFKC").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function withoutMarkdownExtension(value: string) {
  return value.replace(/\.md$/i, "");
}

function pathKey(value: string) {
  return withoutMarkdownExtension(normalizeSlashes(value)).toLocaleLowerCase();
}

function titleKey(value: string) {
  return withoutMarkdownExtension(value.trim().normalize("NFKC")).toLocaleLowerCase();
}

function folderFor(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function pathWithoutExtension(path: string) {
  return withoutMarkdownExtension(normalizeSlashes(path));
}

function targetWithoutSubpath(rawTarget: string) {
  const target = rawTarget.trim();
  const heading = target.indexOf("#");
  const block = target.indexOf("^");
  const boundary = [heading, block]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return (boundary === undefined ? target : target.slice(0, boundary)).trim();
}

function commonDirectoryDepth(sourcePath: string | undefined, candidatePath: string) {
  if (!sourcePath) return 0;
  const source = folderFor(normalizeSlashes(sourcePath)).toLocaleLowerCase().split("/").filter(Boolean);
  const candidate = folderFor(candidatePath).toLocaleLowerCase().split("/").filter(Boolean);
  let depth = 0;
  while (depth < source.length && depth < candidate.length && source[depth] === candidate[depth]) {
    depth += 1;
  }
  return depth;
}

function relativeDistance(sourcePath: string | undefined, candidatePath: string) {
  if (!sourcePath) return candidatePath.split("/").length;
  const source = folderFor(normalizeSlashes(sourcePath)).toLocaleLowerCase().split("/").filter(Boolean);
  const candidate = folderFor(candidatePath).toLocaleLowerCase().split("/").filter(Boolean);
  const common = commonDirectoryDepth(sourcePath, candidatePath);
  return (source.length - common) + (candidate.length - common);
}

export function buildWikiLinkIndex(inputs: readonly WikiNoteInput[]): WikiLinkIndex {
  const notes: WikiNoteReference[] = [];
  const seen = new Set<string>();
  for (const candidate of inputs) {
    const path = normalizeSlashes(typeof candidate === "string" ? candidate : candidate.path);
    if (!path.toLocaleLowerCase().endsWith(".md")) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({
      path,
      title: titleForRepositoryPath(path),
      folder: folderFor(path),
      aliases: typeof candidate === "string"
        ? []
        : [...new Set((candidate.aliases ?? [])
          .map((alias) => alias.trim().normalize("NFKC"))
          .filter(Boolean))],
    });
  }
  notes.sort((left, right) => (
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
  ));

  const byPath = new Map<string, WikiNoteReference>();
  const byTitleMutable = new Map<string, WikiNoteReference[]>();
  const byAliasMutable = new Map<string, WikiNoteReference[]>();
  for (const note of notes) {
    byPath.set(pathKey(note.path), note);
    const key = titleKey(note.title);
    const matches = byTitleMutable.get(key) ?? [];
    matches.push(note);
    byTitleMutable.set(key, matches);
    for (const alias of note.aliases) {
      const aliasKey = titleKey(alias);
      const aliasMatches = byAliasMutable.get(aliasKey) ?? [];
      if (!aliasMatches.includes(note)) aliasMatches.push(note);
      byAliasMutable.set(aliasKey, aliasMatches);
    }
  }
  const byTitle = new Map<string, readonly WikiNoteReference[]>(byTitleMutable);
  const byAlias = new Map<string, readonly WikiNoteReference[]>(byAliasMutable);
  return { notes, byPath, byTitle, byAlias };
}

function resolveCandidateSet(
  candidates: readonly WikiNoteReference[],
  sourcePath?: string,
): WikiLinkResolution {
  if (candidates.length === 0) return { status: "missing" };
  if (candidates.length === 1) return { status: "resolved", note: candidates[0] };

  const sourceFolder = sourcePath ? folderFor(normalizeSlashes(sourcePath)).toLocaleLowerCase() : undefined;
  const sameFolder = sourceFolder
    ? candidates.filter((note) => note.folder.toLocaleLowerCase() === sourceFolder)
    : [];
  if (sameFolder.length === 1) return { status: "resolved", note: sameFolder[0] };

  const ranked = candidates
    .map((note) => ({
      note,
      common: commonDirectoryDepth(sourcePath, note.path),
      distance: relativeDistance(sourcePath, note.path),
    }))
    .sort((left, right) => (
      right.common - left.common ||
      left.distance - right.distance ||
      left.note.path.localeCompare(right.note.path, undefined, { sensitivity: "base" })
    ));
  const [best, runnerUp] = ranked;
  if (
    best &&
    (!runnerUp || (best.common > 0 && best.common > runnerUp.common))
  ) {
    return { status: "resolved", note: best.note };
  }
  return { status: "ambiguous", candidates };
}

export function resolveWikiLink(
  index: WikiLinkIndex | undefined,
  rawTarget: string,
  sourcePath?: string,
): WikiLinkResolution {
  if (!index) return { status: "missing" };
  const target = targetWithoutSubpath(rawTarget);
  if (!target) {
    const current = sourcePath ? index.byPath.get(pathKey(sourcePath)) : undefined;
    return current ? { status: "resolved", note: current } : { status: "missing" };
  }

  const explicit = index.byPath.get(pathKey(target));
  if (explicit) return { status: "resolved", note: explicit };

  if (normalizeSlashes(target).includes("/")) {
    const suffix = `/${pathKey(target)}`;
    const suffixMatches = index.notes.filter((note) => pathKey(note.path).endsWith(suffix));
    if (suffixMatches.length === 1) return { status: "resolved", note: suffixMatches[0] };
    if (suffixMatches.length > 1) return { status: "ambiguous", candidates: suffixMatches };
  }

  const title = target.slice(target.lastIndexOf("/") + 1);
  const titleCandidates = index.byTitle.get(titleKey(title)) ?? [];
  if (titleCandidates.length) return resolveCandidateSet(titleCandidates, sourcePath);
  return resolveCandidateSet(index.byAlias.get(titleKey(title)) ?? [], sourcePath);
}

function suggestionScore(note: WikiNoteReference, query: string, sourcePath?: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const title = note.title.toLocaleLowerCase();
  const path = pathWithoutExtension(note.path).toLocaleLowerCase();
  const aliases = note.aliases.map((alias) => alias.toLocaleLowerCase());
  let score = 0;
  if (!normalizedQuery) score = 10;
  else if (title === normalizedQuery) score = 1_000;
  else if (title.startsWith(normalizedQuery)) score = 700;
  else if (title.includes(normalizedQuery)) score = 450;
  else if (aliases.some((alias) => alias === normalizedQuery)) score = 420;
  else if (aliases.some((alias) => alias.startsWith(normalizedQuery))) score = 360;
  else if (aliases.some((alias) => alias.includes(normalizedQuery))) score = 320;
  else if (path.includes(normalizedQuery)) score = 250;
  else {
    const words = normalizedQuery.split(/\s+/).filter(Boolean);
    if (!words.every((word) => path.includes(word))) return Number.NEGATIVE_INFINITY;
    score = 150;
  }
  return score + commonDirectoryDepth(sourcePath, note.path) * 12 - relativeDistance(sourcePath, note.path);
}

export function wikiLinkSuggestions(
  index: WikiLinkIndex | undefined,
  query: string,
  sourcePath?: string,
  limit = 80,
): WikiLinkSuggestion[] {
  if (!index) return [];
  return index.notes
    .map((note) => ({ note, score: suggestionScore(note, query, sourcePath) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => (
      right.score - left.score ||
      left.note.title.localeCompare(right.note.title, undefined, { sensitivity: "base" }) ||
      left.note.path.localeCompare(right.note.path, undefined, { sensitivity: "base" })
    ))
    .slice(0, limit)
    .map(({ note, score }) => {
      const duplicateTitle = (index.byTitle.get(titleKey(note.title))?.length ?? 0) > 1;
      const target = duplicateTitle ? pathWithoutExtension(note.path) : note.title;
      return {
        ...note,
        score,
        duplicateTitle,
        insertion: duplicateTitle
          ? `[[${target}|${note.title}]]`
          : `[[${target}]]`,
      };
    });
}

export function wikiLinkHref(target: string) {
  return `${WIKI_LINK_SCHEME}${encodeURIComponent(target)}`;
}

export function wikiLinkTargetFromHref(href: string | undefined) {
  if (!href?.startsWith(WIKI_LINK_SCHEME)) return undefined;
  try {
    return decodeURIComponent(href.slice(WIKI_LINK_SCHEME.length));
  } catch {
    return undefined;
  }
}

export function wikiLinkVisibleLabel(target: string, alias?: string) {
  if (alias?.trim()) return alias.trim();
  const withoutSubpath = targetWithoutSubpath(target);
  const leaf = withoutSubpath.slice(withoutSubpath.lastIndexOf("/") + 1);
  return withoutMarkdownExtension(leaf) || target;
}
