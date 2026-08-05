#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

export const IMPORT_MANIFEST_SCHEMA_VERSION = 1;
export const IMPORT_TRANSACTION_SCHEMA_VERSION = 1;
export const DEFAULT_IMPORT_SNAPSHOT_KEY = "math-atlas-v1";
export const DEFAULT_EXPECTATIONS = Object.freeze({});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const defaultContentRoot = path.join(projectRoot, "content");
const BACKUP_DIRECTORY_NAME = ".obsidian-import-backups";
const STAGING_PREFIX = ".obsidian-import-staging-";
const MANIFEST_RELATIVE_PATH = ".math-atlas/import-manifest.json";
const ATLAS_RELATIVE_PATH = ".math-atlas/atlas.json";
const MAX_SOURCE_READ_ATTEMPTS = 4;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 1_024;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARACTER = /[<>:"|?*]/;
const SUPPORTED_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class ObsidianImportError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ObsidianImportError";
    this.details = details;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "base" }) ||
    (left < right ? -1 : left > right ? 1 : 0);
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function normalizedLookupKey(value) {
  return toPosix(value)
    .normalize("NFKC")
    .replace(/^\/+|\/+$/g, "")
    .toLocaleLowerCase("en");
}

function withoutMarkdownExtension(value) {
  return value.replace(/\.md$/i, "");
}

function withoutSubpath(value) {
  const target = value.trim();
  const heading = target.indexOf("#");
  const block = target.indexOf("^");
  const boundary = [heading, block]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return (boundary === undefined ? target : target.slice(0, boundary)).trim();
}

function lineEndingOf(value) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function safeIsoTime(milliseconds) {
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertOutsideSource(candidate, vaultRoot, label) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedVault = path.resolve(vaultRoot);
  if (
    resolvedCandidate === resolvedVault ||
    isInside(resolvedCandidate, resolvedVault) ||
    isInside(resolvedVault, resolvedCandidate)
  ) {
    throw new ObsidianImportError(`${label} and the read-only Obsidian vault must be disjoint.`);
  }
}

function safeTarget(root, relativePath) {
  const target = path.resolve(root, ...toPosix(relativePath).split("/"));
  if (!isInside(target, root)) {
    throw new ObsidianImportError(`Import target escapes its root: ${relativePath}`);
  }
  return target;
}

export function validatePortableMarkdownPath(relativePath) {
  const normalized = toPosix(relativePath);
  if (
    !normalized ||
    normalized.length > MAX_RELATIVE_PATH_LENGTH ||
    normalized.includes("\0") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized)
  ) {
    throw new ObsidianImportError(`Invalid Markdown path: ${relativePath}`);
  }
  const segments = normalized.split("/");
  if (
    segments.length > 64 ||
    segments.some((segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.startsWith(".") ||
      segment.endsWith(" ") ||
      segment.endsWith(".") ||
      WINDOWS_RESERVED_NAME.test(segment) ||
      WINDOWS_INVALID_CHARACTER.test(segment) ||
      [...segment].some((character) => character.charCodeAt(0) < 32)
    ) ||
    !segments.at(-1)?.toLocaleLowerCase("en").endsWith(".md")
  ) {
    throw new ObsidianImportError(`Invalid Markdown path: ${relativePath}`);
  }
  return normalized;
}

function stableStatSignature(metadata) {
  return [
    metadata.dev,
    metadata.ino,
    metadata.size,
    metadata.mtimeNs,
    metadata.ctimeNs,
  ].join(":");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Read through one file handle and prove that both that handle and its path
 * still identify the same ordinary file after the read. A changing file is
 * retried; the source is never opened with write permissions.
 */
export async function stableReadFile(absolutePath, attempts = MAX_SOURCE_READ_ATTEMPTS) {
  let lastReason = "the file kept changing";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let handle;
    try {
      const pathMetadata = await lstat(absolutePath, { bigint: true });
      if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
        throw new ObsidianImportError(`Source entries must be ordinary files: ${absolutePath}`);
      }
      handle = await open(absolutePath, "r");
      const before = await handle.stat({ bigint: true });
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      const pathAfter = await lstat(absolutePath, { bigint: true });
      if (
        stableStatSignature(before) === stableStatSignature(after) &&
        stableStatSignature(after) === stableStatSignature(pathAfter) &&
        BigInt(bytes.byteLength) === after.size
      ) {
        return {
          bytes,
          sha256: sha256(bytes),
          byteLength: bytes.byteLength,
          modifiedAt: safeIsoTime(Number(after.mtimeNs / 1_000_000n)),
        };
      }
      lastReason = "the file changed during the read";
    } catch (error) {
      if (error instanceof ObsidianImportError) throw error;
      lastReason = error instanceof Error ? error.message : String(error);
    } finally {
      await handle?.close().catch(() => undefined);
    }
    if (attempt < attempts) await delay(attempt * 8);
  }
  throw new ObsidianImportError(
    `Could not obtain a stable read of ${absolutePath}: ${lastReason}`,
  );
}

function decodeUtf8(bytes, relativePath) {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const decoded = strictUtf8.decode(hasBom ? bytes.subarray(3) : bytes);
    if (decoded.includes("\0")) {
      throw new ObsidianImportError(`Markdown contains a null character: ${relativePath}`);
    }
    return `${hasBom ? "\uFEFF" : ""}${decoded}`;
  } catch (error) {
    if (error instanceof ObsidianImportError) throw error;
    throw new ObsidianImportError(`Markdown is not valid UTF-8: ${relativePath}`);
  }
}

export function splitFrontmatter(markdown) {
  const bomLength = markdown.startsWith("\uFEFF") ? 1 : 0;
  const content = markdown.slice(bomLength);
  const opening = content.match(/^---(\r?\n)/);
  if (!opening) {
    return {
      prefix: markdown.slice(0, bomLength),
      yaml: undefined,
      body: markdown.slice(bomLength),
      lineEnding: lineEndingOf(markdown),
    };
  }
  const lineEnding = opening[1];
  const yamlStart = bomLength + opening[0].length;
  let lineStart = yamlStart;
  while (lineStart <= markdown.length) {
    const nextNewline = markdown.indexOf("\n", lineStart);
    const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (line === "---" || line === "...") {
      const bodyStart = nextNewline === -1 ? markdown.length : nextNewline + 1;
      return {
        prefix: markdown.slice(0, bodyStart),
        yaml: markdown.slice(yamlStart, lineStart),
        body: markdown.slice(bodyStart),
        lineEnding,
        yamlInsertionOffset: yamlStart,
      };
    }
    if (nextNewline === -1) break;
    lineStart = nextNewline + 1;
  }
  return {
    prefix: markdown.slice(0, bomLength),
    yaml: undefined,
    body: markdown.slice(bomLength),
    lineEnding: lineEndingOf(markdown),
  };
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

export function frontmatterAliases(markdown) {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml === undefined) return [];
  const aliases = [];
  const lines = yaml.split(/\r?\n/);
  let collecting = false;
  for (const line of lines) {
    const key = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (key) {
      collecting = key[1].toLocaleLowerCase("en") === "aliases";
      if (collecting && key[2]) {
        const inline = key[2].trim();
        if (inline.startsWith("[") && inline.endsWith("]")) {
          for (const item of inline.slice(1, -1).split(",")) {
            const alias = unquoteYamlScalar(item);
            if (alias) aliases.push(alias);
          }
        } else {
          const alias = unquoteYamlScalar(inline);
          if (alias) aliases.push(alias);
        }
      }
      continue;
    }
    if (collecting) {
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item) {
        const alias = unquoteYamlScalar(item[1]);
        if (alias) aliases.push(alias);
      } else if (line.trim() && !/^\s/.test(line)) {
        collecting = false;
      }
    }
  }
  const seen = new Set();
  return aliases.filter((alias) => {
    const key = normalizedLookupKey(alias);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableIdFromMarkdown(markdown) {
  const { yaml } = splitFrontmatter(markdown);
  if (yaml === undefined) return undefined;
  const match = yaml.match(
    /^id:[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^#\r\n]+?))[ \t]*(?:#.*)?$/m,
  );
  const id = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
  return id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : undefined;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase("en")
    .slice(0, 56) || "note";
}

export function deterministicNoteId(relativePath) {
  const normalized = normalizedLookupKey(validatePortableMarkdownPath(relativePath));
  const title = path.posix.basename(withoutMarkdownExtension(toPosix(relativePath)));
  return `obsidian-${slugify(title)}-${sha256(normalized).slice(0, 16)}`;
}

/** Insert one structural id line while leaving every existing YAML/body byte intact. */
export function injectStableId(markdown, deterministicId) {
  const existing = stableIdFromMarkdown(markdown);
  if (existing) return { markdown, id: existing, injected: false };
  const parts = splitFrontmatter(markdown);
  const idLine = `id: ${JSON.stringify(deterministicId)}${parts.lineEnding}`;
  if (parts.yaml !== undefined && parts.yamlInsertionOffset !== undefined) {
    return {
      markdown:
        markdown.slice(0, parts.yamlInsertionOffset) +
        idLine +
        markdown.slice(parts.yamlInsertionOffset),
      id: deterministicId,
      injected: true,
    };
  }
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = markdown.slice(bom.length);
  return {
    markdown: `${bom}---${parts.lineEnding}${idLine}---${parts.lineEnding}${parts.lineEnding}${body}`,
    id: deterministicId,
    injected: true,
  };
}

function validateImageDimensions(format, width, height, relativePath) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) throw new ObsidianImportError(`Referenced image has invalid dimensions: ${relativePath}`);
  return { ...format, width, height };
}

function jpegDimensions(bytes, relativePath) {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return validateImageDimensions(
        { extension: "jpg", mediaType: "image/jpeg" },
        bytes.readUInt16BE(offset + 5),
        bytes.readUInt16BE(offset + 3),
        relativePath,
      );
    }
    offset += segmentLength;
  }
  throw new ObsidianImportError(`Referenced JPEG has no valid frame: ${relativePath}`);
}

function imageFormat(bytes, relativePath) {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new ObsidianImportError(`Referenced image has an invalid byte length: ${relativePath}`);
  }
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return validateImageDimensions(
    { extension: "png", mediaType: "image/png" },
    bytes.readUInt32BE(16),
    bytes.readUInt32BE(20),
    relativePath,
  );
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return jpegDimensions(bytes, relativePath);
  }
  if (bytes.length >= 10) {
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
      return validateImageDimensions(
        { extension: "gif", mediaType: "image/gif" },
        bytes.readUInt16LE(6),
        bytes.readUInt16LE(8),
        relativePath,
      );
    }
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X" && bytes.length >= 30) {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return validateImageDimensions(
        { extension: "webp", mediaType: "image/webp" }, width, height, relativePath,
      );
    }
    if (
      chunk === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a
    ) {
      return validateImageDimensions(
        { extension: "webp", mediaType: "image/webp" },
        bytes.readUInt16LE(26) & 0x3fff,
        bytes.readUInt16LE(28) & 0x3fff,
        relativePath,
      );
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      return validateImageDimensions(
        { extension: "webp", mediaType: "image/webp" },
        1 + b0 + ((b1 & 0x3f) << 8),
        1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
        relativePath,
      );
    }
    throw new ObsidianImportError(`Referenced WebP subtype is unsupported: ${relativePath}`);
  }
  throw new ObsidianImportError(`Unsupported or corrupt referenced image: ${relativePath}`);
}

async function enumerateDirectory(root, directory = root, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  const files = [];
  const skippedSymlinks = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      skippedSymlinks.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      const nested = await enumerateDirectory(root, absolutePath, relativePath);
      files.push(...nested.files);
      skippedSymlinks.push(...nested.skippedSymlinks);
    } else if (entry.isFile()) {
      files.push({ relativePath: toPosix(relativePath), absolutePath });
    }
  }
  return { files, skippedSymlinks };
}

function extensionLabel(relativePath) {
  return path.posix.extname(relativePath).toLocaleLowerCase("en") || "<none>";
}

function indexBy(items, keyOf) {
  const result = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const current = result.get(key) ?? [];
    current.push(item);
    result.set(key, current);
  }
  return result;
}

function createNoteIndex(notes) {
  const byPath = new Map();
  const byTitle = new Map();
  const byAlias = new Map();
  for (const note of notes) {
    byPath.set(normalizedLookupKey(withoutMarkdownExtension(note.path)), note);
    const titleKey = normalizedLookupKey(note.title);
    const titles = byTitle.get(titleKey) ?? [];
    titles.push(note);
    byTitle.set(titleKey, titles);
    for (const alias of note.aliases) {
      const key = normalizedLookupKey(alias);
      const aliases = byAlias.get(key) ?? [];
      aliases.push(note);
      byAlias.set(key, aliases);
    }
  }
  return { byPath, byTitle, byAlias, notes };
}

function directorySegments(notePath) {
  return path.posix.dirname(notePath) === "."
    ? []
    : path.posix.dirname(notePath).split("/");
}

function candidateRank(sourcePath, candidatePath) {
  const source = directorySegments(sourcePath).map(normalizedLookupKey);
  const candidate = directorySegments(candidatePath).map(normalizedLookupKey);
  let common = 0;
  while (common < source.length && common < candidate.length && source[common] === candidate[common]) {
    common += 1;
  }
  return { common, distance: source.length + candidate.length - common * 2 };
}

function chooseByProximity(candidates, sourcePath) {
  if (candidates.length <= 1) return candidates[0];
  const ranked = candidates
    .map((note) => ({ note, ...candidateRank(sourcePath, note.path) }))
    .sort((left, right) =>
      right.common - left.common ||
      left.distance - right.distance ||
      compareText(left.note.path, right.note.path)
    );
  const [best, next] = ranked;
  return best && next && (best.common > next.common || best.distance < next.distance)
    ? best.note
    : undefined;
}

function resolveNoteTarget(index, rawTarget, sourcePath) {
  const target = withoutMarkdownExtension(withoutSubpath(rawTarget).replaceAll("\\", "/"));
  if (!target) return index.byPath.get(normalizedLookupKey(withoutMarkdownExtension(sourcePath)));
  const explicit = index.byPath.get(normalizedLookupKey(target));
  if (explicit) return explicit;
  if (target.includes("/")) {
    const suffix = `/${normalizedLookupKey(target)}`;
    const matches = index.notes.filter((note) =>
      normalizedLookupKey(withoutMarkdownExtension(note.path)).endsWith(suffix)
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return chooseByProximity(matches, sourcePath);
  }
  const leaf = path.posix.basename(target);
  const titleMatches = index.byTitle.get(normalizedLookupKey(leaf)) ?? [];
  if (titleMatches.length) return chooseByProximity(titleMatches, sourcePath);
  const aliasMatches = index.byAlias.get(normalizedLookupKey(leaf)) ?? [];
  return chooseByProximity(aliasMatches, sourcePath);
}

function wikiTarget(body) {
  return body.split("|", 1)[0].trim();
}

function replaceAsync(value, expression, replacer) {
  const matches = [...value.matchAll(expression)];
  if (!matches.length) return Promise.resolve(value);
  return Promise.all(matches.map((match) => replacer(match))).then((replacements) => {
    let cursor = 0;
    let result = "";
    matches.forEach((match, index) => {
      result += value.slice(cursor, match.index) + replacements[index];
      cursor = match.index + match[0].length;
    });
    return result + value.slice(cursor);
  });
}

function markdownDestination(rawValue) {
  const value = rawValue.trim();
  if (!value) return undefined;
  if (value.startsWith("<")) {
    const closing = value.indexOf(">");
    return closing > 0 ? value.slice(1, closing) : undefined;
  }
  return value.match(/^\S+/)?.[0];
}

function cleanReference(value) {
  const withoutQuery = value.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

function assetAltText(target, explicitAlias = "") {
  const alias = explicitAlias.trim();
  if (alias) return alias.replace(/[\[\]\r\n]/g, " ").trim();
  return path.posix.basename(cleanReference(target)).replace(/\.[^.]+$/, "")
    .replace(/[\[\]\r\n]/g, " ").trim() || "image";
}

function managedReference(notePath, assetPath) {
  const directory = path.posix.dirname(notePath);
  return path.posix.relative(directory === "." ? "" : directory, assetPath) || assetPath;
}

function emptyAtlasMetadata(snapshotKey = DEFAULT_IMPORT_SNAPSHOT_KEY) {
  return {
    schemaVersion: 1,
    snapshotKey,
    placements: [],
    customizations: {
      schemaVersion: 1,
      snapshotKey,
      landmarkKinds: {},
      landmarks: {},
      groups: {},
      customLandmarks: [],
      customGroups: [],
      connectionOverrides: {},
      customConnections: [],
    },
  };
}

function assertExpected(label, actual, expected) {
  if (expected !== undefined && actual !== expected) {
    throw new ObsidianImportError(
      `${label} changed: expected ${expected}, found ${actual}. Run a dry-run and review the new manifest before applying.`,
    );
  }
}

function latestIso(values) {
  return values.slice().sort().at(-1) ?? new Date(0).toISOString();
}

/**
 * Build and fully validate a replacement in memory. This performs no writes.
 */
export async function buildImportPlan({
  vaultRoot,
  contentRoot,
  expectations = {},
  snapshotKey = DEFAULT_IMPORT_SNAPSHOT_KEY,
}) {
  const resolvedVault = path.resolve(vaultRoot);
  const resolvedContent = path.resolve(contentRoot);
  assertOutsideSource(resolvedContent, resolvedVault, "Canonical content");
  const vaultMetadata = await lstat(resolvedVault);
  if (vaultMetadata.isSymbolicLink() || !vaultMetadata.isDirectory()) {
    throw new ObsidianImportError("The Obsidian source must be a real directory.");
  }

  const { files, skippedSymlinks } = await enumerateDirectory(resolvedVault);
  if (skippedSymlinks.length) {
    throw new ObsidianImportError(
      "The vault contains links or junctions; refusing to follow them.",
      skippedSymlinks,
    );
  }
  const markdownFiles = files.filter(({ relativePath }) => /\.md$/i.test(relativePath));
  assertExpected("Markdown note count", markdownFiles.length, expectations.markdown);

  const pathCollisionIndex = indexBy(
    markdownFiles,
    ({ relativePath }) => normalizedLookupKey(relativePath),
  );
  const collisions = [...pathCollisionIndex.values()].filter((matches) => matches.length > 1);
  if (collisions.length) {
    throw new ObsidianImportError(
      "Case-insensitive or Unicode-normalized Markdown path collisions were found.",
      collisions.flatMap((matches) => matches.map(({ relativePath }) => relativePath)),
    );
  }

  const sourceNotes = [];
  for (const file of markdownFiles) {
    const portablePath = validatePortableMarkdownPath(file.relativePath);
    const stable = await stableReadFile(file.absolutePath);
    if (stable.byteLength > MAX_MARKDOWN_BYTES) {
      throw new ObsidianImportError(`Markdown is larger than 2 MiB: ${portablePath}`);
    }
    const sourceMarkdown = decodeUtf8(stable.bytes, portablePath);
    sourceNotes.push({
      path: portablePath,
      absolutePath: file.absolutePath,
      sourceMarkdown,
      sourceSha256: stable.sha256,
      sourceBytes: stable.byteLength,
      modifiedAt: stable.modifiedAt,
      title: path.posix.basename(portablePath, path.posix.extname(portablePath)),
      aliases: frontmatterAliases(sourceMarkdown),
      deterministicId: deterministicNoteId(portablePath),
    });
  }
  sourceNotes.sort((left, right) => compareText(left.path, right.path));

  const imageFiles = files.filter(({ relativePath }) => SUPPORTED_IMAGE_EXTENSION.test(relativePath));
  const imagesByPath = new Map(
    imageFiles.map((file) => [normalizedLookupKey(file.relativePath), file]),
  );
  const imagesByLeaf = indexBy(
    imageFiles,
    ({ relativePath }) => normalizedLookupKey(path.posix.basename(relativePath)),
  );
  const assetsByCanonicalPath = new Map();
  const sourceAssetCache = new Map();
  const assetReferences = [];

  function sourceImageFor(notePath, rawTarget) {
    const target = cleanReference(rawTarget);
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined;
    const exactRelative = target.startsWith("/")
      ? path.posix.normalize(target.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(notePath), target));
    if (exactRelative && !exactRelative.startsWith("../")) {
      const exact = imagesByPath.get(normalizedLookupKey(exactRelative));
      if (exact) return exact;
    }
    const matches = imagesByLeaf.get(normalizedLookupKey(path.posix.basename(target))) ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new ObsidianImportError(
        `Ambiguous image reference "${rawTarget}" in ${notePath}.`,
        matches.map(({ relativePath }) => relativePath),
      );
    }
    return undefined;
  }

  async function importImage(notePath, rawTarget, syntax) {
    const source = sourceImageFor(notePath, rawTarget);
    if (!source) {
      throw new ObsidianImportError(`Missing image "${rawTarget}" referenced by ${notePath}.`);
    }
    let stable = sourceAssetCache.get(source.absolutePath);
    if (!stable) {
      stable = await stableReadFile(source.absolutePath);
      sourceAssetCache.set(source.absolutePath, stable);
    }
    const format = imageFormat(stable.bytes, source.relativePath);
    const canonicalPath = `.assets/${stable.sha256}.${format.extension}`;
    let asset = assetsByCanonicalPath.get(canonicalPath);
    if (!asset) {
      asset = {
        path: canonicalPath,
        sha256: stable.sha256,
        mediaType: format.mediaType,
        width: format.width,
        height: format.height,
        byteLength: stable.byteLength,
        bytes: stable.bytes,
        sourcePaths: [],
      };
      assetsByCanonicalPath.set(canonicalPath, asset);
    }
    if (!asset.sourcePaths.includes(source.relativePath)) asset.sourcePaths.push(source.relativePath);
    assetReferences.push({ notePath, sourcePath: source.relativePath, assetPath: canonicalPath, syntax });
    return canonicalPath;
  }

  const canonicalNotes = [];
  for (const note of sourceNotes) {
    const sourceParts = splitFrontmatter(note.sourceMarkdown);
    let body = sourceParts.body;
    body = await replaceAsync(
      body,
      /!\[([^\]\r\n]*)\]\(([^)\r\n]+)\)/g,
      async (match) => {
        const target = markdownDestination(match[2]);
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return match[0];
        const assetPath = await importImage(note.path, target, "markdown-image");
        return `![${match[1]}](${managedReference(note.path, assetPath)})`;
      },
    );
    // Convert Obsidian embeds second so their newly-created standard Markdown
    // image syntax is not mistaken for another source-vault reference.
    body = await replaceAsync(
      body,
      /!\[\[([^\]\r\n]+)\]\]/g,
      async (match) => {
        const bodyValue = match[1];
        const target = wikiTarget(bodyValue);
        if (!SUPPORTED_IMAGE_EXTENSION.test(cleanReference(target))) return match[0];
        const assetPath = await importImage(note.path, target, "obsidian-embed");
        const alias = bodyValue.includes("|")
          ? bodyValue.slice(bodyValue.indexOf("|") + 1)
          : "";
        return `![${assetAltText(target, alias)}](${managedReference(note.path, assetPath)})`;
      },
    );
    const withRewrittenImages = `${sourceParts.prefix}${body}`;
    const injected = injectStableId(withRewrittenImages, note.deterministicId);
    canonicalNotes.push({
      ...note,
      id: injected.id,
      idInjected: injected.injected,
      markdown: injected.markdown,
      canonicalSha256: sha256(Buffer.from(injected.markdown, "utf8")),
      canonicalBytes: Buffer.byteLength(injected.markdown, "utf8"),
    });
  }

  const idCollisions = [...indexBy(canonicalNotes, ({ id }) => normalizedLookupKey(id)).values()]
    .filter((matches) => matches.length > 1);
  if (idCollisions.length) {
    throw new ObsidianImportError(
      "Stable note IDs are not unique.",
      idCollisions.flatMap((matches) => matches.map(({ path: notePath }) => notePath)),
    );
  }

  const noteIndex = createNoteIndex(sourceNotes);
  const linkIssues = [];
  let noteLinkCount = 0;
  let wikiImageEmbedCount = 0;
  for (const note of sourceNotes) {
    for (const match of note.sourceMarkdown.matchAll(/(!)?\[\[([^\]\r\n]+)\]\]/g)) {
      const embedded = Boolean(match[1]);
      const target = wikiTarget(match[2]);
      if (embedded && SUPPORTED_IMAGE_EXTENSION.test(cleanReference(target))) {
        wikiImageEmbedCount += 1;
        continue;
      }
      noteLinkCount += 1;
      const resolved = resolveNoteTarget(noteIndex, target, note.path);
      if (!resolved) linkIssues.push(`${note.path}: [[${match[2]}]]`);
    }
  }
  if (linkIssues.length) {
    throw new ObsidianImportError("Unresolved or ambiguous Obsidian note links were found.", linkIssues);
  }
  assertExpected("Obsidian note-link count", noteLinkCount, expectations.noteLinks);

  const assets = [...assetsByCanonicalPath.values()].sort((left, right) =>
    compareText(left.path, right.path)
  );
  for (const asset of assets) asset.sourcePaths.sort(compareText);
  assertExpected("Referenced asset count", assets.length, expectations.assets);

  const atlas = emptyAtlasMetadata(snapshotKey);
  const atlasJson = stringifyJson(atlas);
  const sourceDigest = sha256(
    canonicalNotes.map(({ path: notePath, sourceSha256 }) => `${notePath}\0${sourceSha256}\n`).join("") +
      assets.flatMap(({ sourcePaths, sha256: assetHash }) =>
        sourcePaths.map((sourcePath) => `${sourcePath}\0${assetHash}\n`)
      ).join(""),
  );
  const skippedByExtension = {};
  for (const file of files) {
    if (markdownFiles.includes(file) || imageFiles.includes(file)) continue;
    const extension = extensionLabel(file.relativePath);
    skippedByExtension[extension] = (skippedByExtension[extension] ?? 0) + 1;
  }
  const manifest = {
    schemaVersion: IMPORT_MANIFEST_SCHEMA_VERSION,
    importId: `obsidian-${sourceDigest.slice(0, 16)}`,
    generatedAt: latestIso(sourceNotes.map(({ modifiedAt }) => modifiedAt)),
    sourceVault: resolvedVault,
    sourceDigest: `sha256-${sourceDigest}`,
    snapshotKey,
    counts: {
      markdown: canonicalNotes.length,
      assets: assets.length,
      assetReferences: assetReferences.length,
      noteLinks: noteLinkCount,
      wikiImageEmbeds: wikiImageEmbedCount,
      skippedFiles: Object.values(skippedByExtension).reduce((sum, count) => sum + count, 0),
    },
    skippedByExtension,
    notes: canonicalNotes.map((note) => ({
      path: note.path,
      id: note.id,
      aliases: note.aliases,
      sourceSha256: `sha256-${note.sourceSha256}`,
      canonicalSha256: `sha256-${note.canonicalSha256}`,
      sourceBytes: note.sourceBytes,
      canonicalBytes: note.canonicalBytes,
      modifiedAt: note.modifiedAt,
    })),
    assets: assets.map((asset) => ({
      path: asset.path,
      sha256: `sha256-${asset.sha256}`,
      mediaType: asset.mediaType,
      width: asset.width,
      height: asset.height,
      byteLength: asset.byteLength,
      sourcePaths: asset.sourcePaths,
    })),
    atlas: {
      path: ATLAS_RELATIVE_PATH,
      sha256: `sha256-${sha256(Buffer.from(atlasJson, "utf8"))}`,
      placements: 0,
    },
  };

  return {
    vaultRoot: resolvedVault,
    contentRoot: resolvedContent,
    notes: canonicalNotes,
    assets,
    assetReferences,
    atlas,
    atlasJson,
    manifest,
  };
}

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function writeDurableFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const file = await open(absolutePath, "wx");
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function writeJournal(absolutePath, journal) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const file = await open(absolutePath, "w");
  try {
    await file.writeFile(stringifyJson(journal));
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function writeImportPayload(plan, payloadRoot) {
  if (await pathExists(payloadRoot)) {
    throw new ObsidianImportError(`Staging payload already exists: ${payloadRoot}`);
  }
  await mkdir(payloadRoot, { recursive: true });
  for (const note of plan.notes) {
    await writeDurableFile(safeTarget(payloadRoot, note.path), Buffer.from(note.markdown, "utf8"));
  }
  for (const asset of plan.assets) {
    await writeDurableFile(safeTarget(payloadRoot, asset.path), asset.bytes);
  }
  await writeDurableFile(safeTarget(payloadRoot, ATLAS_RELATIVE_PATH), plan.atlasJson);
  await writeDurableFile(
    safeTarget(payloadRoot, MANIFEST_RELATIVE_PATH),
    stringifyJson(plan.manifest),
  );
}

async function visibleMarkdownFiles(root) {
  const { files, skippedSymlinks } = await enumerateDirectory(root);
  if (skippedSymlinks.length) {
    throw new ObsidianImportError("Canonical content contains links or junctions.", skippedSymlinks);
  }
  return files.filter(({ relativePath }) => /\.md$/i.test(relativePath));
}

function parseManifest(value) {
  let manifest;
  try {
    manifest = JSON.parse(value);
  } catch {
    throw new ObsidianImportError("The Obsidian import manifest is not valid JSON.");
  }
  if (
    !manifest ||
    manifest.schemaVersion !== IMPORT_MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(manifest.notes) ||
    !Array.isArray(manifest.assets) ||
    typeof manifest.sourceDigest !== "string"
  ) {
    throw new ObsidianImportError("The Obsidian import manifest has an unsupported schema.");
  }
  return manifest;
}

export async function verifyImportPayload(payloadRoot, suppliedManifest) {
  const manifest = suppliedManifest ?? parseManifest(
    await readFile(safeTarget(payloadRoot, MANIFEST_RELATIVE_PATH), "utf8"),
  );
  const issues = [];
  const expectedNotes = new Map(
    manifest.notes.map((note) => [normalizedLookupKey(note.path), note]),
  );
  const actualMarkdown = await visibleMarkdownFiles(payloadRoot);
  for (const file of actualMarkdown) {
    if (!expectedNotes.has(normalizedLookupKey(file.relativePath))) {
      issues.push(`Unexpected Markdown: ${file.relativePath}`);
    }
  }
  if (actualMarkdown.length !== manifest.notes.length) {
    issues.push(`Expected ${manifest.notes.length} Markdown files, found ${actualMarkdown.length}.`);
  }
  const canonicalNotes = [];
  for (const expected of manifest.notes) {
    const absolutePath = safeTarget(payloadRoot, expected.path);
    if (!(await pathExists(absolutePath))) {
      issues.push(`Missing Markdown: ${expected.path}`);
      continue;
    }
    const stable = await stableReadFile(absolutePath);
    const actualHash = `sha256-${stable.sha256}`;
    if (actualHash !== expected.canonicalSha256) {
      issues.push(`Markdown hash mismatch: ${expected.path}`);
      continue;
    }
    const markdown = decodeUtf8(stable.bytes, expected.path);
    if (stableIdFromMarkdown(markdown) !== expected.id) {
      issues.push(`Stable id mismatch: ${expected.path}`);
    }
    canonicalNotes.push({
      path: expected.path,
      title: path.posix.basename(expected.path, ".md"),
      aliases: frontmatterAliases(markdown),
      sourceMarkdown: markdown,
    });
  }

  const assetPaths = new Set();
  for (const expected of manifest.assets) {
    const absolutePath = safeTarget(payloadRoot, expected.path);
    if (!(await pathExists(absolutePath))) {
      issues.push(`Missing asset: ${expected.path}`);
      continue;
    }
    const stable = await stableReadFile(absolutePath);
    if (`sha256-${stable.sha256}` !== expected.sha256 || stable.byteLength !== expected.byteLength) {
      issues.push(`Asset hash or length mismatch: ${expected.path}`);
    }
    assetPaths.add(normalizedLookupKey(expected.path));
  }
  const assetsRoot = path.join(payloadRoot, ".assets");
  if (await pathExists(assetsRoot)) {
    const actualAssets = await readdir(assetsRoot, { withFileTypes: true });
    for (const entry of actualAssets) {
      const assetPath = `.assets/${entry.name}`;
      if (!entry.isFile() || !assetPaths.has(normalizedLookupKey(assetPath))) {
        issues.push(`Unexpected asset entry: ${assetPath}`);
      }
    }
  }

  const atlasPath = safeTarget(payloadRoot, ATLAS_RELATIVE_PATH);
  if (!(await pathExists(atlasPath))) {
    issues.push("Missing empty atlas metadata.");
  } else {
    const atlas = await stableReadFile(atlasPath);
    if (`sha256-${atlas.sha256}` !== manifest.atlas?.sha256) {
      issues.push("Atlas metadata hash mismatch.");
    }
    try {
      const parsed = JSON.parse(atlas.bytes.toString("utf8"));
      if (
        parsed.snapshotKey !== manifest.snapshotKey ||
        parsed.placements?.length !== 0 ||
        parsed.customizations?.customLandmarks?.length !== 0 ||
        parsed.customizations?.customGroups?.length !== 0 ||
        parsed.customizations?.customConnections?.length !== 0
      ) issues.push("Atlas metadata is not an empty canvas.");
    } catch {
      issues.push("Atlas metadata is not valid JSON.");
    }
  }

  const noteIndex = createNoteIndex(canonicalNotes);
  let noteLinkCount = 0;
  let managedImageCount = 0;
  for (const note of canonicalNotes) {
    const body = splitFrontmatter(note.sourceMarkdown).body;
    for (const match of body.matchAll(/(!)?\[\[([^\]\r\n]+)\]\]/g)) {
      const target = wikiTarget(match[2]);
      if (match[1] && SUPPORTED_IMAGE_EXTENSION.test(cleanReference(target))) {
        issues.push(`Unconverted Obsidian image embed in ${note.path}: ${match[0]}`);
        continue;
      }
      noteLinkCount += 1;
      if (!resolveNoteTarget(noteIndex, target, note.path)) {
        issues.push(`Unresolved note link in ${note.path}: ${match[0]}`);
      }
    }
    for (const match of body.matchAll(/!\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g)) {
      const target = markdownDestination(match[1]);
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(note.path), cleanReference(target)));
      if (!assetPaths.has(normalizedLookupKey(resolved))) {
        issues.push(`Unmanaged or missing image in ${note.path}: ${target}`);
      } else {
        managedImageCount += 1;
      }
    }
  }
  if (noteLinkCount !== manifest.counts.noteLinks) {
    issues.push(`Expected ${manifest.counts.noteLinks} note links, found ${noteLinkCount}.`);
  }
  if (managedImageCount !== manifest.counts.assetReferences) {
    issues.push(`Expected ${manifest.counts.assetReferences} managed image references, found ${managedImageCount}.`);
  }
  if (issues.length) {
    throw new ObsidianImportError("Imported payload verification failed.", issues);
  }
  return {
    markdown: actualMarkdown.length,
    assets: manifest.assets.length,
    noteLinks: noteLinkCount,
    assetReferences: managedImageCount,
    sourceDigest: manifest.sourceDigest,
  };
}

function transactionIdFor(plan) {
  const instant = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${instant}-${plan.manifest.sourceDigest.slice(7, 15)}-${randomBytes(3).toString("hex")}`;
}

async function rootEntries(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.sort((left, right) => compareText(left.name, right.name));
}

async function moveEntry(source, destination) {
  if (!(await pathExists(source))) return false;
  if (await pathExists(destination)) {
    throw new ObsidianImportError(`Transaction destination already exists: ${destination}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  return true;
}

async function rollbackJournal(contentRoot, backupRoot, journal, reason) {
  const failedPayload = path.join(backupRoot, "failed-payload");
  await mkdir(failedPayload, { recursive: true });
  for (const name of [...journal.promotedEntries].reverse()) {
    const current = path.join(contentRoot, name);
    if (await pathExists(current)) {
      await moveEntry(current, path.join(failedPayload, name));
    }
  }
  for (const name of [...journal.previousEntries].reverse()) {
    const previous = path.join(backupRoot, "previous", name);
    if (!(await pathExists(previous))) continue;
    const destination = path.join(contentRoot, name);
    if (await pathExists(destination)) {
      await moveEntry(destination, path.join(failedPayload, `collision-${name}`));
    }
    await moveEntry(previous, destination);
  }
  journal.status = "rolled-back";
  journal.rolledBackAt = new Date().toISOString();
  journal.rollbackReason = reason;
  await writeJournal(path.join(backupRoot, "transaction.json"), journal);
}

/** Stage, verify, and promote a plan. Existing content remains in a hidden backup. */
export async function applyImportPlan(plan) {
  const contentRoot = path.resolve(plan.contentRoot);
  assertOutsideSource(contentRoot, plan.vaultRoot, "Canonical content");
  await mkdir(contentRoot, { recursive: true });
  const existingEntries = await rootEntries(contentRoot);
  const staleStages = existingEntries.filter(({ name }) => name.startsWith(STAGING_PREFIX));
  const unresolvedStages = [];
  for (const stage of staleStages) {
    const stageId = stage.name.slice(STAGING_PREFIX.length);
    const matchingBackup = path.join(contentRoot, BACKUP_DIRECTORY_NAME, stageId);
    try {
      const previousJournal = await readJournal(matchingBackup);
      if (previousJournal.status !== "rolled-back") {
        unresolvedStages.push(stage.name);
        continue;
      }
      // This payload was created by this importer and its durable journal
      // proves that the failed transaction restored the previous content.
      await rm(path.join(contentRoot, stage.name), { recursive: true, force: true });
    } catch {
      unresolvedStages.push(stage.name);
    }
  }
  if (unresolvedStages.length) {
    throw new ObsidianImportError(
      "A previous Obsidian import staging directory remains. Inspect or remove it before applying.",
      unresolvedStages,
    );
  }

  const transactionId = transactionIdFor(plan);
  const stagingRoot = path.join(contentRoot, `${STAGING_PREFIX}${transactionId}`);
  const payloadRoot = path.join(stagingRoot, "payload");
  const backupRoot = path.join(contentRoot, BACKUP_DIRECTORY_NAME, transactionId);
  const journalPath = path.join(backupRoot, "transaction.json");
  const journal = {
    schemaVersion: IMPORT_TRANSACTION_SCHEMA_VERSION,
    id: transactionId,
    status: "staging",
    createdAt: new Date().toISOString(),
    sourceDigest: plan.manifest.sourceDigest,
    previousEntries: [],
    promotedEntries: [],
  };

  try {
    await writeImportPayload(plan, payloadRoot);
    await verifyImportPayload(payloadRoot, plan.manifest);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await mkdir(path.join(backupRoot, "previous"), { recursive: true });
  await writeJournal(journalPath, journal);
  try {
    journal.status = "committing";
    await writeJournal(journalPath, journal);
    const beforeCommit = await rootEntries(contentRoot);
    for (const entry of beforeCommit) {
      if (
        entry.name === BACKUP_DIRECTORY_NAME ||
        entry.name === path.basename(stagingRoot) ||
        // The running content service can hold this recovery directory open
        // on Windows. It is app infrastructure, remains hidden, and is neither
        // canonical note content nor part of the replacement payload.
        entry.name === ".trash"
      ) continue;
      // Record intent durably before the rename. Recovery remains correct if
      // the process stops on either side of the filesystem operation.
      journal.previousEntries.push(entry.name);
      await writeJournal(journalPath, journal);
      await moveEntry(
        path.join(contentRoot, entry.name),
        path.join(backupRoot, "previous", entry.name),
      );
    }

    for (const entry of await rootEntries(payloadRoot)) {
      journal.promotedEntries.push(entry.name);
      await writeJournal(journalPath, journal);
      await moveEntry(path.join(payloadRoot, entry.name), path.join(contentRoot, entry.name));
    }
    journal.status = "committed";
    journal.committedAt = new Date().toISOString();
    await writeJournal(journalPath, journal);
    await rm(stagingRoot, { recursive: true, force: true });
    try {
      await verifyImportPayload(contentRoot, plan.manifest);
    } catch (error) {
      await rollbackJournal(
        contentRoot,
        backupRoot,
        journal,
        error instanceof Error ? error.message : "post-commit verification failed",
      );
      throw error;
    }
    return { transactionId, backupRoot, manifest: plan.manifest };
  } catch (error) {
    if (journal.status !== "rolled-back") {
      try {
        await rollbackJournal(
          contentRoot,
          backupRoot,
          journal,
          error instanceof Error ? error.message : "commit failed",
        );
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Import and automatic rollback both failed.");
      }
    }
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJournal(backupRoot) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.join(backupRoot, "transaction.json"), "utf8"));
  } catch {
    throw new ObsidianImportError(`Backup journal is missing or invalid: ${backupRoot}`);
  }
  if (
    parsed?.schemaVersion !== IMPORT_TRANSACTION_SCHEMA_VERSION ||
    !Array.isArray(parsed.previousEntries) ||
    !Array.isArray(parsed.promotedEntries)
  ) throw new ObsidianImportError(`Backup journal has an unsupported schema: ${backupRoot}`);
  return parsed;
}

export async function listImportBackups(contentRoot) {
  const backupDirectory = path.join(path.resolve(contentRoot), BACKUP_DIRECTORY_NAME);
  if (!(await pathExists(backupDirectory))) return [];
  const entries = await rootEntries(backupDirectory);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const backupRoot = path.join(backupDirectory, entry.name);
    try {
      backups.push({ root: backupRoot, journal: await readJournal(backupRoot) });
    } catch {
      // Keep a malformed backup untouched; it is surfaced when explicitly selected.
    }
  }
  return backups.sort((left, right) => compareText(right.journal.createdAt, left.journal.createdAt));
}

/** Restore a committed backup without deleting the replacement being rolled back. */
export async function rollbackImport(contentRoot, requestedId = "latest") {
  const resolvedContent = path.resolve(contentRoot);
  const backups = await listImportBackups(resolvedContent);
  const recoverableStatuses = new Set(["staging", "committing", "committed"]);
  const selected = requestedId === "latest"
    ? backups.find(({ journal }) => recoverableStatuses.has(journal.status))
    : backups.find(({ journal }) => journal.id === requestedId);
  if (!selected) throw new ObsidianImportError(`No recoverable import backup matches "${requestedId}".`);
  const { root: backupRoot, journal } = selected;
  if (!recoverableStatuses.has(journal.status)) {
    throw new ObsidianImportError(`Import backup ${journal.id} is already ${journal.status}.`);
  }
  if (journal.status === "staging" || journal.status === "committing") {
    await rollbackJournal(
      resolvedContent,
      backupRoot,
      journal,
      "manual recovery of an interrupted import",
    );
    const stagingRoot = path.join(resolvedContent, `${STAGING_PREFIX}${journal.id}`);
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    return { transactionId: journal.id, displacedRoot: path.join(backupRoot, "failed-payload") };
  }
  const displacedRoot = path.join(
    backupRoot,
    `replacement-before-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await mkdir(displacedRoot, { recursive: true });
  for (const name of journal.promotedEntries) {
    const current = path.join(resolvedContent, name);
    if (await pathExists(current)) await moveEntry(current, path.join(displacedRoot, name));
  }
  const collisions = [];
  for (const name of journal.previousEntries) {
    if (
      await pathExists(path.join(backupRoot, "previous", name)) &&
      await pathExists(path.join(resolvedContent, name))
    ) collisions.push(name);
  }
  if (collisions.length) {
    for (const name of journal.promotedEntries) {
      const displaced = path.join(displacedRoot, name);
      if (await pathExists(displaced) && !(await pathExists(path.join(resolvedContent, name)))) {
        await moveEntry(displaced, path.join(resolvedContent, name));
      }
    }
    throw new ObsidianImportError("Rollback would overwrite newer content.", collisions);
  }
  const restored = [];
  try {
    for (const name of journal.previousEntries) {
      const previous = path.join(backupRoot, "previous", name);
      if (!(await pathExists(previous))) continue;
      const destination = path.join(resolvedContent, name);
      if (await pathExists(destination)) {
        throw new ObsidianImportError(`Rollback would overwrite a newer entry: ${name}`);
      }
      await moveEntry(previous, destination);
      restored.push(name);
    }
  } catch (error) {
    for (const name of restored.reverse()) {
      const destination = path.join(resolvedContent, name);
      if (await pathExists(destination)) {
        await moveEntry(destination, path.join(backupRoot, "previous", name));
      }
    }
    for (const name of journal.promotedEntries) {
      const displaced = path.join(displacedRoot, name);
      if (await pathExists(displaced) && !(await pathExists(path.join(resolvedContent, name)))) {
        await moveEntry(displaced, path.join(resolvedContent, name));
      }
    }
    throw error;
  }
  journal.status = "rolled-back";
  journal.rolledBackAt = new Date().toISOString();
  journal.displacedReplacement = path.relative(backupRoot, displacedRoot);
  await writeJournal(path.join(backupRoot, "transaction.json"), journal);
  return { transactionId: journal.id, displacedRoot };
}

export async function verifyCurrentImport(contentRoot) {
  const resolvedContent = path.resolve(contentRoot);
  const manifest = parseManifest(
    await readFile(safeTarget(resolvedContent, MANIFEST_RELATIVE_PATH), "utf8"),
  );
  return verifyImportPayload(resolvedContent, manifest);
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ObsidianImportError(`${option} requires a non-negative integer.`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    mode: "dry-run",
    vaultRoot: undefined,
    contentRoot: defaultContentRoot,
    expectations: { ...DEFAULT_EXPECTATIONS },
    rollbackId: undefined,
    json: false,
  };
  let explicitMode = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (["--dry-run", "--apply", "--verify"].includes(argument)) {
      if (explicitMode) throw new ObsidianImportError("Choose exactly one import mode.");
      options.mode = argument.slice(2);
      explicitMode = true;
      continue;
    }
    if (argument === "--rollback") {
      if (explicitMode) throw new ObsidianImportError("Choose exactly one import mode.");
      options.mode = "rollback";
      explicitMode = true;
      const candidate = argv[index + 1];
      if (candidate && !candidate.startsWith("--")) {
        options.rollbackId = candidate;
        index += 1;
      } else {
        options.rollbackId = "latest";
      }
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    const pathOptions = new Map([
      ["--vault", "vaultRoot"],
      ["--content", "contentRoot"],
    ]);
    if (pathOptions.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new ObsidianImportError(`${argument} requires a path.`);
      }
      options[pathOptions.get(argument)] = path.resolve(value);
      index += 1;
      continue;
    }
    const countOptions = new Map([
      ["--expected-notes", "markdown"],
      ["--expected-assets", "assets"],
      ["--expected-note-links", "noteLinks"],
    ]);
    if (countOptions.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new ObsidianImportError(`${argument} requires a count.`);
      options.expectations[countOptions.get(argument)] = parsePositiveInteger(value, argument);
      index += 1;
      continue;
    }
    throw new ObsidianImportError(`Unknown option: ${argument}`);
  }
  return options;
}

function usage() {
  return `Usage: node scripts/import-obsidian-vault.mjs [mode] [options]

Modes (default is the non-writing dry-run):
  --dry-run               Read and validate the vault without writing anything
  --apply                 Stage, verify, then promote the complete replacement
  --verify                Verify current content against its saved manifest
  --rollback [id|latest]  Restore a recoverable import backup (default: latest)

Options:
  --vault <path>                Read-only Obsidian vault root (required for import)
  --content <path>              Canonical content root
  --expected-notes <count>      Optional safety expectation
  --expected-assets <count>     Optional safety expectation
  --expected-note-links <count> Optional safety expectation
  --json                        Print a machine-readable report
  --help                        Show this help

Applying is never implicit. The source vault is only opened for reading.`;
}

function planReport(plan) {
  return {
    mode: "dry-run",
    sourceVault: plan.vaultRoot,
    contentRoot: plan.contentRoot,
    sourceDigest: plan.manifest.sourceDigest,
    ...plan.manifest.counts,
    backupPolicy: `${BACKUP_DIRECTORY_NAME}/<transaction-id>`,
    wouldResetCanvas: true,
  };
}

function printResult(value, json) {
  if (json) {
    process.stdout.write(stringifyJson(value));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    process.stdout.write(`${key}: ${typeof item === "object" ? JSON.stringify(item) : item}\n`);
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.mode === "verify") {
    const result = await verifyCurrentImport(options.contentRoot);
    printResult({ mode: "verify", verified: true, ...result }, options.json);
    return;
  }
  if (options.mode === "rollback") {
    const result = await rollbackImport(options.contentRoot, options.rollbackId ?? "latest");
    printResult({ mode: "rollback", restored: true, ...result }, options.json);
    return;
  }
  if (!options.vaultRoot) {
    throw new ObsidianImportError("--vault <path> is required for dry-run and apply modes.");
  }
  const plan = await buildImportPlan({
    vaultRoot: options.vaultRoot,
    contentRoot: options.contentRoot,
    expectations: options.expectations,
  });
  if (options.mode === "dry-run") {
    printResult(planReport(plan), options.json);
    return;
  }
  if (options.mode !== "apply") throw new ObsidianImportError(`Unsupported mode: ${options.mode}`);
  const result = await applyImportPlan(plan);
  printResult({
    mode: "apply",
    imported: true,
    transactionId: result.transactionId,
    backupRoot: result.backupRoot,
    ...plan.manifest.counts,
  }, options.json);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Obsidian import failed: ${message}\n`);
    if (error instanceof ObsidianImportError && error.details.length) {
      for (const detail of error.details.slice(0, 100)) process.stderr.write(`  - ${detail}\n`);
    }
    process.exitCode = 1;
  });
}
