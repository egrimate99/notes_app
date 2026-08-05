import { repositoryPath } from "./contentPaths";

const MANAGED_IMAGE_PATH = /^\.assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;

export function isManagedImagePath(value: string): boolean {
  return MANAGED_IMAGE_PATH.test(value);
}

/**
 * Resolve a portable Markdown image reference against its note. Only managed
 * content/.assets images are returned; web, data, and ordinary relative links
 * remain under React Markdown's normal handling.
 */
export function resolveManagedImagePath(
  notePath: string | undefined,
  reference: string | undefined,
): string | undefined {
  if (!reference) return undefined;
  const withoutSuffix = reference.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  if (!withoutSuffix || /^[a-z][a-z0-9+.-]*:/i.test(withoutSuffix)) return undefined;

  const direct = withoutSuffix.replace(/^\//, "");
  if (isManagedImagePath(direct)) return direct;

  const normalizedNote = repositoryPath(notePath);
  if (!normalizedNote || withoutSuffix.startsWith("/")) return undefined;
  const segments = normalizedNote.split("/").slice(0, -1);
  for (const segment of withoutSuffix.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const resolved = segments.join("/");
  return isManagedImagePath(resolved) ? resolved : undefined;
}

/** A standards-friendly path that also opens correctly outside Math Atlas. */
export function relativeManagedImageReference(
  notePath: string,
  assetPath: string,
): string {
  const normalizedNote = repositoryPath(notePath);
  if (!normalizedNote || !isManagedImagePath(assetPath)) {
    throw new Error("A managed image requires a Markdown note and a valid .assets path.");
  }
  const depth = normalizedNote.split("/").length - 1;
  return `${"../".repeat(depth)}${assetPath}`;
}

export function markdownForManagedImage(
  notePath: string,
  assetPath: string,
  originalName: string,
): string {
  const leaf = originalName.replace(/\\/g, "/").split("/").pop() ?? "image";
  const alt = leaf
    .replace(/\.(?:png|jpe?g|gif|webp)$/i, "")
    .replace(/[\[\]\r\n]/g, " ")
    .trim() || "image";
  return `![${alt}](${relativeManagedImageReference(notePath, assetPath)})`;
}
