import type { SubjectId } from "./types";

function subjectIdForDirectory(directory: string): SubjectId | undefined {
  const slug = directory
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase("en")
    .slice(0, 120);
  return slug || undefined;
}

export function repositoryPath(contentPath: string | undefined): string | undefined {
  if (!contentPath) return undefined;
  const normalized = contentPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const withoutRoot = normalized.replace(/^content\//i, "");
  if (
    !withoutRoot ||
    withoutRoot.startsWith("/") ||
    withoutRoot.includes("\0") ||
    withoutRoot.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return withoutRoot;
}

export function subjectForRepositoryPath(path: string): SubjectId | undefined {
  const normalized = path.replace(/\\/g, "/");
  const separator = normalized.indexOf("/");
  if (separator <= 0) return undefined;
  return subjectIdForDirectory(normalized.slice(0, separator));
}

export function titleForRepositoryPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return filename.replace(/\.md$/i, "") || "Untitled";
}
