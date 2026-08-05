import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { Plugin } from "vite";

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_FRONTMATTER_SCAN_BYTES = 64 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 1_024;
const MAX_ALIAS_LENGTH = 512;
const MAX_ALIASES = 128;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARACTER = /[<>:"|?*]/;
const TRASH_DIRECTORY_NAME = ".trash";
const TRASH_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ContentTreeEntry =
  | {
      type: "directory";
      name: string;
      path: string;
      children: ContentTreeEntry[];
    }
  | {
      type: "file";
      name: string;
      path: string;
      id?: string;
      aliases?: string[];
    };

export interface ContentDocument {
  path: string;
  markdown: string;
  revision: string;
  id?: string;
  aliases?: string[];
}

export type ContentEntryKind = "directory" | "file";

export interface ContentMutationResult {
  path: string;
  type: ContentEntryKind;
}

export interface DeletedContentReceipt extends ContentMutationResult {
  token: string;
  deletedAt: string;
  originalPath: string;
}

export type ContentErrorCode =
  | "conflict"
  | "invalid_markdown"
  | "invalid_path"
  | "invalid_request"
  | "io_error"
  | "not_found";

export class ContentRepositoryError extends Error {
  constructor(
    public readonly code: ContentErrorCode,
    message: string,
    public readonly status: number,
    public readonly currentRevision?: string,
  ) {
    super(message);
    this.name = "ContentRepositoryError";
  }
}

function invalidPath(message = "The note path is invalid."): never {
  throw new ContentRepositoryError("invalid_path", message, 400);
}

/**
 * The API accepts one portable path dialect: content-root-relative POSIX paths.
 * This keeps drive letters, UNC paths, traversal, ADS paths, and platform-specific
 * separators out of the trust boundary before any filesystem operation occurs.
 */
export function validateEntryPath(
  relativePath: string,
  kind?: ContentEntryKind,
): string[] {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > MAX_RELATIVE_PATH_LENGTH ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return invalidPath();
  }

  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.endsWith(" ") ||
        segment.endsWith(".") ||
        WINDOWS_RESERVED_NAME.test(segment) ||
        WINDOWS_INVALID_CHARACTER.test(segment) ||
        [...segment].some((character) => character.charCodeAt(0) < 32),
    )
  ) {
    return invalidPath();
  }

  const leafIsMarkdown = segments.at(-1)?.toLocaleLowerCase("en").endsWith(".md");
  if (kind === "file" && !leafIsMarkdown) {
    return invalidPath("Only Markdown files inside the content folder can be edited.");
  }
  if (kind === "directory" && leafIsMarkdown) {
    return invalidPath("Folder names cannot end in .md.");
  }

  return segments;
}

export function validateContentPath(relativePath: string): string[] {
  return validateEntryPath(relativePath, "file");
}

function revisionFor(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

interface MarkdownParts {
  prefix: string;
  body: string;
  lineEnding: "\n" | "\r\n";
}

interface DiskContentFile extends MarkdownParts {
  document: ContentDocument;
}

function lineEndingOf(markdown: string): "\n" | "\r\n" {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

/** Separates YAML (and its following blank lines) without rewriting one byte. */
export function splitMarkdownFile(markdown: string): MarkdownParts {
  const bomLength = markdown.startsWith("\uFEFF") ? 1 : 0;
  const content = markdown.slice(bomLength);
  const lineEnding: "\n" | "\r\n" = content.startsWith("---\r\n")
    ? "\r\n"
    : "\n";
  const opening = `---${lineEnding}`;
  if (!content.startsWith(opening)) {
    return {
      prefix: markdown.slice(0, bomLength),
      body: markdown.slice(bomLength),
      lineEnding: lineEndingOf(markdown),
    };
  }

  let lineStart = bomLength + opening.length;
  while (lineStart <= markdown.length) {
    const nextNewline = markdown.indexOf("\n", lineStart);
    const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (line === "---" || line === "...") {
      let prefixEnd = nextNewline === -1 ? markdown.length : nextNewline + 1;

      // Blank separator lines are part of the structural prefix. This keeps
      // the editor focused on mathematics and preserves the original spacing.
      while (prefixEnd < markdown.length) {
        const blankLineEnd = markdown.indexOf("\n", prefixEnd);
        const end = blankLineEnd === -1 ? markdown.length : blankLineEnd;
        const candidate = markdown.slice(prefixEnd, end).replace(/\r$/, "");
        if (candidate.trim().length > 0) break;
        prefixEnd = blankLineEnd === -1 ? markdown.length : blankLineEnd + 1;
      }

      return {
        prefix: markdown.slice(0, prefixEnd),
        body: markdown.slice(prefixEnd),
        lineEnding,
      };
    }
    if (nextNewline === -1) break;
    lineStart = nextNewline + 1;
  }

  // An unclosed delimiter is ordinary Markdown, not frontmatter we can safely hide.
  return {
    prefix: markdown.slice(0, bomLength),
    body: markdown.slice(bomLength),
    lineEnding: lineEndingOf(markdown),
  };
}

/** Reads the canonical top-level YAML `id` without normalising the YAML. */
export function stableIdFromPrefix(prefix: string): string | undefined {
  const content = prefix.startsWith("\uFEFF") ? prefix.slice(1) : prefix;
  const openingMatch = content.match(/^---(\r?\n)/);
  if (!openingMatch) return undefined;
  const lineEnding = openingMatch[1];
  const yamlStart = openingMatch[0].length;
  let lineStart = yamlStart;
  let closingStart = -1;

  while (lineStart <= content.length) {
    const nextNewline = content.indexOf("\n", lineStart);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (line === "---" || line === "...") {
      closingStart = lineStart;
      break;
    }
    if (nextNewline === -1) break;
    lineStart = nextNewline + 1;
  }
  if (closingStart === -1) return undefined;

  const yaml = content.slice(yamlStart, closingStart);
  const match = yaml.match(
    /^id:[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^#\r\n]+?))[ \t]*(?:#.*)?$/m,
  );
  const id = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return undefined;

  // Keep the captured line-ending variable meaningful as an explicit check
  // that the opening delimiter was complete in the bounded prefix.
  if (lineEnding !== "\n" && lineEnding !== "\r\n") return undefined;
  return id;
}

function frontmatterLines(prefix: string): string[] | undefined {
  const content = prefix.startsWith("\uFEFF") ? prefix.slice(1) : prefix;
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return undefined;

  const closing = lines.findIndex(
    (line, index) => index > 0 && (line === "---" || line === "..."),
  );
  return closing < 0 ? undefined : lines.slice(1, closing);
}

/** Removes a YAML comment without treating a hash inside a quoted value as one. */
function withoutYamlComment(value: string): string {
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (quote === "'") {
      if (character !== quote) continue;
      if (value[index + 1] === "'") index += 1;
      else quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (
      character === "#" &&
      (index === 0 || /[ \t]/.test(value[index - 1]))
    ) {
      return value.slice(0, index);
    }
  }
  return value;
}

function validAlias(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ALIAS_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function yamlAliasScalar(rawValue: string): string | undefined {
  const value = withoutYamlComment(rawValue).trim();
  if (!value || /^(?:null|~)$/i.test(value)) return undefined;

  let parsed: unknown = value;
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) return undefined;
    parsed = value.slice(1, -1).replace(/''/g, "'");
  } else if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) return undefined;
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  } else if (/^[\[{]|[\]}]$/.test(value) || value === "|" || value === ">") {
    // Collection-shaped values are handled separately. Never turn malformed
    // YAML structures into link aliases by accident.
    return undefined;
  }

  if (typeof parsed !== "string") return undefined;
  const alias = parsed.trim();
  return validAlias(alias) ? alias : undefined;
}

function splitInlineYamlList(value: string): string[] | undefined {
  const source = withoutYamlComment(value).trim();
  if (!source.startsWith("[") || !source.endsWith("]")) return undefined;
  const body = source.slice(1, -1);
  if (!body.trim()) return [];

  const items: string[] = [];
  let start = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (quote === "'") {
      if (character !== quote) continue;
      if (body[index + 1] === "'") index += 1;
      else quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === ",") {
      items.push(body.slice(start, index));
      start = index + 1;
    } else if (character === "[" || character === "]" || character === "{") {
      return undefined;
    }
  }
  if (quote) return undefined;
  items.push(body.slice(start));
  return items;
}

/**
 * Reads Obsidian's top-level YAML `alias`/`aliases` property without taking a
 * YAML dependency or exposing the rest of frontmatter to the editor. Scalar,
 * inline-list and indented block-list forms are supported. Invalid entries are
 * ignored and duplicates are collapsed case-insensitively in source order.
 */
export function aliasesFromPrefix(prefix: string): string[] {
  const lines = frontmatterLines(prefix);
  if (!lines) return [];

  const aliases: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined) => {
    if (!candidate || aliases.length >= MAX_ALIASES) return;
    const key = candidate.normalize("NFC").toLocaleLowerCase("en");
    if (seen.has(key)) return;
    seen.add(key);
    aliases.push(candidate);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const property = lines[index].match(/^(?:alias|aliases):[ \t]*(.*)$/i);
    if (!property) continue;
    const value = property[1];
    if (withoutYamlComment(value).trim()) {
      const inline = splitInlineYamlList(value);
      if (inline) inline.forEach((item) => add(yamlAliasScalar(item)));
      else add(yamlAliasScalar(value));
      continue;
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const item = line.match(/^[ \t]+-[ \t]*(.*)$/);
      if (!item) break;
      add(yamlAliasScalar(item[1]));
      index = cursor;
    }
  }
  return aliases;
}

interface FrontmatterMetadata {
  id?: string;
  aliases: string[];
}

function frontmatterMetadata(prefix: string): FrontmatterMetadata {
  return {
    id: stableIdFromPrefix(prefix),
    aliases: aliasesFromPrefix(prefix),
  };
}

function withLineEnding(markdown: string, lineEnding: "\n" | "\r\n"): string {
  return markdown.replace(/\r\n|\r|\n/g, lineEnding);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function toIoError(error: unknown): ContentRepositoryError {
  if (error instanceof ContentRepositoryError) return error;
  const message = error instanceof Error ? error.message : "The content operation failed.";
  return new ContentRepositoryError("io_error", message, 500);
}

export class DiskContentRepository {
  private resolvedRoot?: Promise<string>;

  constructor(private readonly configuredRoot: string) {}

  private root(): Promise<string> {
    this.resolvedRoot ??= (async () => {
      await mkdir(this.configuredRoot, { recursive: true });
      const configuredMetadata = await lstat(this.configuredRoot);
      if (configuredMetadata.isSymbolicLink() || !configuredMetadata.isDirectory()) {
        throw new ContentRepositoryError(
          "invalid_path",
          "The configured content root must be a real directory.",
          500,
        );
      }
      return realpath(this.configuredRoot);
    })();
    return this.resolvedRoot;
  }

  private async resolveNotePath(
    relativePath: string,
    leafMayBeMissing: boolean,
  ): Promise<string> {
    return this.resolveEntryPath(relativePath, leafMayBeMissing, "file");
  }

  private async resolveEntryPath(
    relativePath: string,
    leafMayBeMissing: boolean,
    kind?: ContentEntryKind,
  ): Promise<string> {
    const segments = validateEntryPath(relativePath, kind);
    const root = await this.root();
    const candidate = path.resolve(root, ...segments);
    const relation = path.relative(root, candidate);
    if (relation.startsWith("..") || path.isAbsolute(relation)) return invalidPath();

    let cursor = root;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]);
      const isLeaf = index === segments.length - 1;
      try {
        const metadata = await lstat(cursor);
        if (metadata.isSymbolicLink()) {
          return invalidPath("Links and junctions are not allowed inside the content tree.");
        }
        if (!isLeaf && !metadata.isDirectory()) {
          return invalidPath("A parent path is not a directory.");
        }
      } catch (error) {
        if (isMissing(error) && isLeaf && leafMayBeMissing) break;
        if (isMissing(error)) {
          throw new ContentRepositoryError("not_found", "The note does not exist.", 404);
        }
        throw toIoError(error);
      }
    }

    return candidate;
  }

  private async entryKind(absolutePath: string): Promise<ContentEntryKind> {
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        return invalidPath("Links and junctions are not allowed inside the content tree.");
      }
      if (metadata.isDirectory()) return "directory";
      if (metadata.isFile()) return "file";
      return invalidPath("Only notes and folders can be changed.");
    } catch (error) {
      if (isMissing(error)) {
        throw new ContentRepositoryError("not_found", "The item does not exist.", 404);
      }
      throw toIoError(error);
    }
  }

  private async pathExists(absolutePath: string): Promise<boolean> {
    try {
      await lstat(absolutePath);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw toIoError(error);
    }
  }

  async createFolder(relativePath: string): Promise<ContentMutationResult> {
    const absolutePath = await this.resolveEntryPath(relativePath, true, "directory");
    if (await this.pathExists(absolutePath)) {
      throw new ContentRepositoryError(
        "conflict",
        "A note or folder with that name already exists.",
        409,
      );
    }
    try {
      await mkdir(absolutePath);
      return { path: relativePath, type: "directory" };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new ContentRepositoryError(
          "conflict",
          "A note or folder with that name already exists.",
          409,
        );
      }
      throw toIoError(error);
    }
  }

  async moveEntry(
    relativePath: string,
    destinationPath: string,
  ): Promise<ContentMutationResult> {
    if (relativePath === destinationPath) {
      const absolutePath = await this.resolveEntryPath(relativePath, false);
      return { path: destinationPath, type: await this.entryKind(absolutePath) };
    }

    const sourcePath = await this.resolveEntryPath(relativePath, false);
    const kind = await this.entryKind(sourcePath);
    // Validate the source against its actual kind too. In particular, hidden or
    // non-Markdown files can never be smuggled into the visible note tree.
    validateEntryPath(relativePath, kind);
    const destination = await this.resolveEntryPath(destinationPath, true, kind);
    const relation = path.relative(sourcePath, destination);
    if (kind === "directory" && relation && !relation.startsWith("..") && !path.isAbsolute(relation)) {
      return invalidPath("A folder cannot be moved inside itself.");
    }

    const sameCaseInsensitivePath =
      process.platform === "win32" &&
      sourcePath.toLocaleLowerCase("en") === destination.toLocaleLowerCase("en");
    if (!sameCaseInsensitivePath && await this.pathExists(destination)) {
      throw new ContentRepositoryError(
        "conflict",
        "A note or folder with that name already exists.",
        409,
      );
    }

    try {
      if (sameCaseInsensitivePath) {
        const temporaryPath = path.join(
          path.dirname(sourcePath),
          `.rename-${randomUUID()}.tmp`,
        );
        await rename(sourcePath, temporaryPath);
        try {
          await rename(temporaryPath, destination);
        } catch (error) {
          await rename(temporaryPath, sourcePath).catch(() => undefined);
          throw error;
        }
      } else {
        await rename(sourcePath, destination);
      }
      return { path: destinationPath, type: kind };
    } catch (error) {
      throw toIoError(error);
    }
  }

  private async trashRoot(): Promise<string> {
    const root = await this.root();
    const trashRoot = path.join(root, TRASH_DIRECTORY_NAME);
    try {
      const metadata = await lstat(trashRoot);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        return invalidPath("The content trash must be a real directory.");
      }
    } catch (error) {
      if (!isMissing(error)) throw toIoError(error);
      await mkdir(trashRoot);
    }
    return trashRoot;
  }

  async trashEntry(relativePath: string): Promise<DeletedContentReceipt> {
    const sourcePath = await this.resolveEntryPath(relativePath, false);
    const kind = await this.entryKind(sourcePath);
    validateEntryPath(relativePath, kind);
    const token = randomUUID();
    const deletedAt = new Date().toISOString();
    const receipt: DeletedContentReceipt = {
      token,
      deletedAt,
      originalPath: relativePath,
      path: relativePath,
      type: kind,
    };
    const container = path.join(await this.trashRoot(), token);
    const trashedEntry = path.join(container, "entry");
    const metadataPath = path.join(container, "receipt.json");
    let containerCreated = false;

    try {
      await mkdir(container);
      containerCreated = true;
      const metadataFile = await open(metadataPath, "wx");
      try {
        await metadataFile.writeFile(JSON.stringify(receipt), "utf8");
        await metadataFile.sync();
      } finally {
        await metadataFile.close();
      }
      await rename(sourcePath, trashedEntry);
      return receipt;
    } catch (error) {
      // Never remove a pre-existing UUID container if mkdir itself collided.
      if (containerCreated) {
        await rm(container, { recursive: true, force: true }).catch(() => undefined);
      }
      throw toIoError(error);
    }
  }

  async restoreEntry(token: string): Promise<ContentMutationResult> {
    if (typeof token !== "string" || !TRASH_TOKEN.test(token)) {
      return invalidPath("The restore token is invalid.");
    }
    const container = path.join(await this.trashRoot(), token);
    const metadataPath = path.join(container, "receipt.json");
    const trashedEntry = path.join(container, "entry");
    let receipt: DeletedContentReceipt;
    try {
      const parsed: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("token" in parsed) ||
        parsed.token !== token ||
        !("originalPath" in parsed) ||
        typeof parsed.originalPath !== "string" ||
        !("type" in parsed) ||
        (parsed.type !== "file" && parsed.type !== "directory")
      ) {
        return invalidPath("The deleted item metadata is invalid.");
      }
      receipt = parsed as DeletedContentReceipt;
    } catch (error) {
      if (error instanceof ContentRepositoryError) throw error;
      if (isMissing(error)) {
        throw new ContentRepositoryError("not_found", "The deleted item is no longer available.", 404);
      }
      throw toIoError(error);
    }

    const destination = await this.resolveEntryPath(
      receipt.originalPath,
      true,
      receipt.type,
    );
    if (await this.pathExists(destination)) {
      throw new ContentRepositoryError(
        "conflict",
        "That path is in use. Rename the current item before restoring.",
        409,
      );
    }
    const trashedKind = await this.entryKind(trashedEntry);
    if (trashedKind !== receipt.type) {
      return invalidPath("The deleted item no longer matches its metadata.");
    }

    try {
      await rename(trashedEntry, destination);
      // The restore is committed once the entry reaches its original path.
      // Receipt cleanup is housekeeping; reporting failure here would make an
      // undo retry target a token whose entry is already live.
      await rm(container, { recursive: true, force: true }).catch(() => undefined);
      return { path: receipt.originalPath, type: receipt.type };
    } catch (error) {
      throw toIoError(error);
    }
  }

  async listTree(): Promise<ContentTreeEntry[]> {
    try {
      const root = await this.root();
      return await this.listDirectory(root, "", 0);
    } catch (error) {
      throw toIoError(error);
    }
  }

  private async listDirectory(
    directory: string,
    relativeDirectory: string,
    depth: number,
  ): Promise<ContentTreeEntry[]> {
    if (depth > 64) {
      throw new ContentRepositoryError(
        "invalid_path",
        "The content tree is nested too deeply.",
        400,
      );
    }

    const entries = await readdir(directory, { withFileTypes: true });
    const tree: ContentTreeEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const entryPath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        tree.push({
          type: "directory",
          name: entry.name,
          path: entryPath,
          children: await this.listDirectory(absolutePath, entryPath, depth + 1),
        });
      } else if (
        entry.isFile() &&
        entry.name.toLocaleLowerCase("en").endsWith(".md")
      ) {
        const metadata = await this.readFrontmatterMetadata(absolutePath);
        tree.push({
          type: "file",
          name: entry.name,
          path: entryPath,
          ...(metadata.id ? { id: metadata.id } : {}),
          ...(metadata.aliases.length ? { aliases: metadata.aliases } : {}),
        });
      }
    }

    return tree.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    });
  }

  private async readFrontmatterMetadata(
    absolutePath: string,
  ): Promise<FrontmatterMetadata> {
    const file = await open(absolutePath, "r");
    try {
      const bytes = Buffer.alloc(MAX_FRONTMATTER_SCAN_BYTES);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const prefix = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        bytes.subarray(0, bytesRead),
      );
      return frontmatterMetadata(splitMarkdownFile(prefix).prefix);
    } finally {
      await file.close();
    }
  }

  async readNote(relativePath: string): Promise<ContentDocument> {
    const file = await this.readFileState(relativePath);
    if (!file) {
      throw new ContentRepositoryError("not_found", "The note does not exist.", 404);
    }
    return file.document;
  }

  private async readFileState(
    relativePath: string,
    missingAllowed = false,
  ): Promise<DiskContentFile | undefined> {
    try {
      const absolutePath = await this.resolveNotePath(relativePath, missingAllowed);
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile()) {
        throw new ContentRepositoryError("not_found", "The note does not exist.", 404);
      }

      const bytes = await readFile(absolutePath);
      if (bytes.byteLength > MAX_MARKDOWN_BYTES) {
        throw new ContentRepositoryError(
          "invalid_markdown",
          "The Markdown file is larger than 2 MiB.",
          422,
        );
      }

      let markdown: string;
      try {
        markdown = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        throw new ContentRepositoryError(
          "invalid_markdown",
          "The Markdown file is not valid UTF-8.",
          422,
        );
      }
      if (markdown.includes("\0")) {
        throw new ContentRepositoryError(
          "invalid_markdown",
          "Markdown cannot contain null characters.",
          422,
        );
      }

      const parts = splitMarkdownFile(markdown);
      const frontmatter = frontmatterMetadata(parts.prefix);
      return {
        ...parts,
        document: {
          path: relativePath,
          markdown: parts.body,
          revision: revisionFor(bytes),
          ...(frontmatter.id ? { id: frontmatter.id } : {}),
          ...(frontmatter.aliases.length
            ? { aliases: frontmatter.aliases }
            : {}),
        },
      };
    } catch (error) {
      if (missingAllowed && isMissing(error)) return undefined;
      if (
        missingAllowed &&
        error instanceof ContentRepositoryError &&
        error.code === "not_found"
      ) {
        return undefined;
      }
      throw toIoError(error);
    }
  }

  async writeNote(
    relativePath: string,
    markdown: string,
    expectedRevision: string | null,
  ): Promise<ContentDocument> {
    if (typeof markdown !== "string" || markdown.includes("\0")) {
      throw new ContentRepositoryError(
        "invalid_markdown",
        "Markdown must be text without null characters.",
        422,
      );
    }
    if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
      throw new ContentRepositoryError(
        "invalid_markdown",
        "Markdown cannot be larger than 2 MiB.",
        422,
      );
    }

    const absolutePath = await this.resolveNotePath(relativePath, true);
    const current = await this.readFileState(relativePath, true);
    this.assertExpectedRevision(current?.document.revision, expectedRevision);
    const savedBody = current
      ? withLineEnding(markdown, current.lineEnding)
      : markdown;
    const savedMarkdown = `${current?.prefix ?? ""}${savedBody}`;
    const bytes = Buffer.from(savedMarkdown, "utf8");
    if (bytes.byteLength > MAX_MARKDOWN_BYTES) {
      throw new ContentRepositoryError(
        "invalid_markdown",
        "The complete Markdown file cannot be larger than 2 MiB.",
        422,
      );
    }

    const temporaryPath = path.join(
      path.dirname(absolutePath),
      `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
    );

    try {
      const temporaryFile = await open(temporaryPath, "wx");
      try {
        await temporaryFile.writeFile(bytes);
        await temporaryFile.sync();
      } finally {
        await temporaryFile.close();
      }

      // Recheck after the temporary file is durable so an external edit made
      // during the save window is surfaced rather than silently overwritten.
      const latest = await this.readFileState(relativePath, true);
      this.assertExpectedRevision(latest?.document.revision, expectedRevision);
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      throw toIoError(error);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    return {
      path: relativePath,
      markdown: savedBody,
      revision: revisionFor(bytes),
      ...(current?.document.id ? { id: current.document.id } : {}),
      ...(current?.document.aliases?.length
        ? { aliases: current.document.aliases }
        : {}),
    };
  }

  private assertExpectedRevision(
    currentRevision: string | undefined,
    expectedRevision: string | null,
  ) {
    const matchesExisting =
      currentRevision !== undefined && expectedRevision === currentRevision;
    const createsNew = currentRevision === undefined && expectedRevision === null;
    if (matchesExisting || createsNew) return;

    throw new ContentRepositoryError(
      "conflict",
      currentRevision
        ? "The note changed on disk. Reload it before saving your edits."
        : "The note was removed or moved before it could be saved.",
      409,
      currentRevision,
    );
  }
}

interface ErrorPayload {
  error: {
    code: ContentErrorCode;
    message: string;
    currentRevision?: string;
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLocaleLowerCase("en").startsWith("application/json")) {
    throw new ContentRepositoryError(
      "invalid_request",
      "Content writes require an application/json body.",
      415,
    );
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_MARKDOWN_BYTES + 16_384) {
      throw new ContentRepositoryError("invalid_request", "The request is too large.", 413);
    }
    chunks.push(bytes);
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ContentRepositoryError(
      "invalid_request",
      "The request body is not valid JSON.",
      400,
    );
  }
}

type NextFunction = (error?: unknown) => void;

export function createContentApiMiddleware(repository: DiskContentRepository) {
  return async function contentApiMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: NextFunction,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://math-atlas.local");
    if (!url.pathname.startsWith("/api/content")) {
      next();
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/content/tree") {
        sendJson(response, 200, await repository.listTree());
        return;
      }

      if (url.pathname === "/api/content/file") {
        const relativePath = url.searchParams.get("path");
        if (relativePath === null) {
          throw new ContentRepositoryError(
            "invalid_request",
            "A content-relative note path is required.",
            400,
          );
        }

        if (request.method === "GET") {
          sendJson(response, 200, await repository.readNote(relativePath));
          return;
        }

        if (request.method === "PUT") {
          const body = await readJsonBody(request);
          const markdown = body.markdown;
          const expectedRevision = body.expectedRevision;
          if (typeof markdown !== "string" || !("expectedRevision" in body)) {
            throw new ContentRepositoryError(
              "invalid_request",
              "A Markdown string and expected revision are required.",
              400,
            );
          }
          if (expectedRevision !== null && typeof expectedRevision !== "string") {
            throw new ContentRepositoryError(
              "invalid_request",
              "The expected revision must be a string or null.",
              400,
            );
          }
          const validatedRevision = expectedRevision as string | null;
          sendJson(
            response,
            200,
            await repository.writeNote(
              relativePath,
              markdown,
              validatedRevision,
            ),
          );
          return;
        }
      }

      if (request.method === "POST" && url.pathname === "/api/content/folder") {
        const body = await readJsonBody(request);
        if (typeof body.path !== "string") {
          throw new ContentRepositoryError(
            "invalid_request",
            "A content-relative folder path is required.",
            400,
          );
        }
        sendJson(response, 201, await repository.createFolder(body.path));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/content/move") {
        const body = await readJsonBody(request);
        if (typeof body.path !== "string" || typeof body.destinationPath !== "string") {
          throw new ContentRepositoryError(
            "invalid_request",
            "Source and destination paths are required.",
            400,
          );
        }
        sendJson(
          response,
          200,
          await repository.moveEntry(body.path, body.destinationPath),
        );
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/content/entry") {
        const relativePath = url.searchParams.get("path");
        if (relativePath === null) {
          throw new ContentRepositoryError(
            "invalid_request",
            "A content-relative note or folder path is required.",
            400,
          );
        }
        sendJson(response, 200, await repository.trashEntry(relativePath));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/content/restore") {
        const body = await readJsonBody(request);
        if (typeof body.token !== "string") {
          throw new ContentRepositoryError(
            "invalid_request",
            "A restore token is required.",
            400,
          );
        }
        sendJson(response, 200, await repository.restoreEntry(body.token));
        return;
      }

      throw new ContentRepositoryError("not_found", "Content endpoint not found.", 404);
    } catch (error) {
      const repositoryError = toIoError(error);
      const payload: ErrorPayload = {
        error: {
          code: repositoryError.code,
          message: repositoryError.message,
          ...(repositoryError.currentRevision
            ? { currentRevision: repositoryError.currentRevision }
            : {}),
        },
      };
      sendJson(response, repositoryError.status, payload);
    }
  };
}

export function contentApiPlugin(contentRoot: string): Plugin {
  const repository = new DiskContentRepository(contentRoot);
  const middleware = createContentApiMiddleware(repository);

  return {
    name: "math-atlas-content-api",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
