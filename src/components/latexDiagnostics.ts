import katex from "katex";

export type LatexSourceSyntax = "inline" | "display-inline" | "display-fence";
export type LatexDiagnosticCode =
  | "unclosed-inline"
  | "unclosed-display"
  | "display-fence-layout"
  | "parse-error";

export interface LatexSourceRange {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  delimiter: "$" | "$$";
  display: boolean;
  syntax: LatexSourceSyntax;
  /** Container-normalized source passed to KaTeX. */
  latex: string;
}

export interface LatexDiagnostic {
  code: LatexDiagnosticCode;
  message: string;
  /** The most useful source span to underline or move the caret to. */
  from: number;
  to: number;
  /** Complete affected formula, including delimiters when present. */
  formulaFrom: number;
  formulaTo: number;
  line: number;
  column: number;
  display: boolean;
}

export interface LatexAnalysis {
  ranges: LatexSourceRange[];
  diagnostics: LatexDiagnostic[];
}

export interface LatexDiagnosticPresentation {
  title: string;
  detail: string;
  action: string;
  location: string;
  /** Complete screen-reader text for an icon-only passive-view affordance. */
  ariaLabel: string;
}

export interface LatexTextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface LatexDiagnosticFix {
  label: string;
  edits: LatexTextEdit[];
}

interface NormalizedBody {
  latex: string;
  /** Source position for each normalized character, plus an EOF sentinel. */
  offsets: number[];
}

interface ParseFailure {
  message: string;
  position: number;
}

const validationCache = new Map<string, ParseFailure | null>();
const MAX_VALIDATION_CACHE_SIZE = 256;

function escapedAt(source: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function dollarRun(source: string, from: number) {
  let length = 0;
  while (source[from + length] === "$") length += 1;
  return length;
}

function lineStartAt(source: string, index: number) {
  return source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function lineEndAt(source: string, index: number) {
  const end = source.indexOf("\n", index);
  return end < 0 ? source.length : end;
}

function lineBreakLengthAt(source: string, index: number) {
  if (source.startsWith("\r\n", index)) return 2;
  return source[index] === "\n" || source[index] === "\r" ? 1 : 0;
}

/**
 * Prefixes accepted before a math-flow fence. This covers ordinary indentation
 * and the blockquote/list containers used by mathematical callouts, while not
 * mistaking a `$$` in prose for a fenced display.
 */
function conventionalContainerPrefix(prefix: string) {
  let rest = prefix;
  let consumed = 0;
  while (rest) {
    const quote = rest.match(/^[ \t]{0,3}>[ \t]?/);
    if (quote) {
      consumed += quote[0].length;
      rest = rest.slice(quote[0].length);
      continue;
    }
    const list = rest.match(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/);
    if (list) {
      consumed += list[0].length;
      rest = rest.slice(list[0].length);
      continue;
    }
    const indent = rest.match(/^[ \t]{1,3}$/);
    if (indent) {
      consumed += indent[0].length;
      rest = "";
      continue;
    }
    return undefined;
  }
  return consumed;
}

function isDisplayFenceAt(source: string, index: number) {
  if (
    source.slice(index, index + 2) !== "$$" ||
    dollarRun(source, index) !== 2 ||
    escapedAt(source, index)
  ) {
    return false;
  }
  const lineStart = lineStartAt(source, index);
  const lineEnd = lineEndAt(source, index);
  const prefix = source.slice(lineStart, index);
  const suffix = source.slice(index + 2, lineEnd);
  return conventionalContainerPrefix(prefix) !== undefined && /^[ \t\r]*$/.test(suffix);
}

function isDisplayFenceOpeningAt(source: string, index: number) {
  if (
    source.slice(index, index + 2) !== "$$" ||
    dollarRun(source, index) !== 2 ||
    escapedAt(source, index)
  ) {
    return false;
  }
  const prefix = source.slice(lineStartAt(source, index), index);
  // remark-math accepts the rest of an opening `$$` line as fence metadata.
  // That distinction is essential: it must not later be reinterpreted as the
  // first row of a same-line/soft-line formula by the live editor.
  return conventionalContainerPrefix(prefix) !== undefined;
}

function nextLineStart(source: string, currentLineStart: number) {
  const end = source.indexOf("\n", currentLineStart);
  return end < 0 ? source.length : end + 1;
}

function displayFenceOnLine(source: string, lineStart: number) {
  const lineEnd = lineEndAt(source, lineStart);
  const line = source.slice(lineStart, lineEnd);
  const match = line.match(/\$\$/);
  if (match?.index === undefined) return undefined;
  const index = lineStart + match.index;
  return isDisplayFenceAt(source, index) ? index : undefined;
}

function blockquoteDepthBefore(source: string, delimiterFrom: number) {
  const prefix = source.slice(lineStartAt(source, delimiterFrom), delimiterFrom);
  const container = prefix.match(/^(?:[ \t]{0,3}>[ \t]?)+/i)?.[0] ?? "";
  return (container.match(/>/g) ?? []).length;
}

function stripBlockquotePrefix(source: string, index: number, depth: number) {
  let cursor = index;
  for (let level = 0; level < depth; level += 1) {
    const match = source.slice(cursor).match(/^[ \t]{0,3}>[ \t]?/);
    if (!match) break;
    cursor += match[0].length;
  }
  return cursor;
}

/**
 * remark-math removes blockquote markers before handing a formula to KaTeX.
 * Preserve a character-to-source map while doing the same so parse positions
 * still point at the exact authored character.
 */
function normalizedBody(
  source: string,
  bodyFrom: number,
  bodyTo: number,
  delimiterFrom: number,
): NormalizedBody {
  const offsets: number[] = [];
  const characters: string[] = [];
  const quoteDepth = blockquoteDepthBefore(source, delimiterFrom);
  const openingLineStart = lineStartAt(source, delimiterFrom);
  let cursor = bodyFrom;
  let atLineStart = bodyFrom === 0 || source[bodyFrom - 1] === "\n";

  while (cursor < bodyTo) {
    if (atLineStart && quoteDepth > 0 && cursor !== openingLineStart) {
      cursor = Math.min(bodyTo, stripBlockquotePrefix(source, cursor, quoteDepth));
    }
    if (cursor >= bodyTo) break;
    offsets.push(cursor);
    characters.push(source[cursor]);
    atLineStart = source[cursor] === "\n";
    cursor += 1;
  }
  offsets.push(bodyTo);
  return { latex: characters.join(""), offsets };
}

function sourceLocation(source: string, offset: number) {
  const safe = Math.max(0, Math.min(source.length, offset));
  const before = source.slice(0, safe);
  const line = (before.match(/\n/g) ?? []).length + 1;
  const previousBreak = before.lastIndexOf("\n");
  return { line, column: safe - previousBreak };
}

function cleanKatexMessage(message: string) {
  const cleaned = message
    .replace(/^KaTeX parse error:\s*/i, "")
    .replace(/\s+at (?:position \d+|end of input):[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "This formula could not be parsed.";
}

function parseFailure(latex: string): ParseFailure | undefined {
  const cached = validationCache.get(latex);
  if (cached !== undefined) return cached ?? undefined;
  let failure: ParseFailure | null = null;
  try {
    katex.renderToString(latex || "\\phantom{x}", {
      throwOnError: true,
      strict: "ignore",
      trust: false,
      maxExpand: 1000,
      output: "mathml",
    });
  } catch (error) {
    const position = error instanceof katex.ParseError && Number.isFinite(error.position)
      ? error.position
      : 0;
    failure = {
      message: cleanKatexMessage(error instanceof Error ? error.message : ""),
      position,
    };
  }
  validationCache.set(latex, failure);
  if (validationCache.size > MAX_VALIDATION_CACHE_SIZE) {
    validationCache.delete(validationCache.keys().next().value as string);
  }
  return failure ?? undefined;
}

function diagnostic(
  source: string,
  value: Omit<LatexDiagnostic, "line" | "column">,
): LatexDiagnostic {
  return { ...value, ...sourceLocation(source, value.from) };
}

function currencyLikeOpening(source: string, index: number) {
  if (!/\d/.test(source[index + 1] ?? "")) return false;
  const previous = source[index - 1];
  return previous === undefined || /[\s([{:;,]/.test(previous);
}

function paragraphBoundary(source: string, index: number) {
  if (source[index] !== "\n") return false;
  const tail = source.slice(index + 1);
  return /^(?:[ \t]*(?:>[ \t]?)?)*\r?\n/.test(tail);
}

function scanTextClosing(
  source: string,
  from: number,
  delimiter: "$" | "$$",
) {
  const runLength = delimiter.length;
  let cursor = from + runLength;
  while (cursor < source.length) {
    if (paragraphBoundary(source, cursor)) {
      return { closing: undefined, boundary: cursor };
    }
    if (source[cursor] === "`" && !escapedAt(source, cursor)) {
      const ticks = source.slice(cursor).match(/^`+/)?.[0].length ?? 1;
      const codeClosing = source.indexOf("`".repeat(ticks), cursor + ticks);
      if (codeClosing < 0) return { closing: undefined, boundary: cursor };
      cursor = codeClosing + ticks;
      continue;
    }
    if (
      source[cursor] === "$" &&
      !escapedAt(source, cursor) &&
      dollarRun(source, cursor) !== runLength
    ) {
      return { closing: undefined, boundary: cursor };
    }
    if (
      source.startsWith(delimiter, cursor) &&
      !escapedAt(source, cursor) &&
      dollarRun(source, cursor) === runLength
    ) {
      if (delimiter === "$" && currencyLikeOpening(source, cursor)) {
        cursor += 1;
        continue;
      }
      // A line-level $$ starts a math-flow construct in remark-math. It cannot
      // close a text-math run opened in prose on a previous line.
      if (delimiter === "$$" && isDisplayFenceAt(source, cursor)) {
        return { closing: undefined, boundary: cursor };
      }
      return { closing: cursor, boundary: cursor };
    }
    cursor += 1;
  }
  return { closing: undefined, boundary: source.length };
}

function rawMatchingRun(source: string, from: number, delimiter: "$" | "$$") {
  let cursor = from + delimiter.length;
  while (cursor < source.length) {
    if (
      source.startsWith(delimiter, cursor) &&
      !escapedAt(source, cursor) &&
      dollarRun(source, cursor) === delimiter.length
    ) {
      return cursor;
    }
    cursor += 1;
  }
  return undefined;
}

/**
 * Analyze conventional `$…$`, same-line/soft-line `$$…$$`, and fenced display
 * math. The distinction deliberately mirrors remark-math's flow precedence.
 */
export function analyzeLatexSource(source: string): LatexAnalysis {
  const ranges: LatexSourceRange[] = [];
  const diagnostics: LatexDiagnostic[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    if (source[cursor] === "`" && !escapedAt(source, cursor)) {
      const ticks = source.slice(cursor).match(/^`+/)?.[0].length ?? 1;
      const closing = source.indexOf("`".repeat(ticks), cursor + ticks);
      cursor = closing < 0 ? source.length : closing + ticks;
      continue;
    }
    if (source[cursor] !== "$" || escapedAt(source, cursor)) {
      cursor += 1;
      continue;
    }

    const runLength = dollarRun(source, cursor);
    if (runLength !== 1 && runLength !== 2) {
      cursor += runLength;
      continue;
    }
    const delimiter = runLength === 2 ? "$$" : "$";
    const display = runLength === 2;

    if (!display && currencyLikeOpening(source, cursor)) {
      cursor += 1;
      continue;
    }

    if (display && isDisplayFenceOpeningAt(source, cursor) && !isDisplayFenceAt(source, cursor)) {
      const openingLineEnd = lineEndAt(source, cursor);
      const rawClosing = rawMatchingRun(source, cursor, delimiter);
      if (openingLineEnd < source.length && (rawClosing === undefined || rawClosing > openingLineEnd)) {
        const formulaTo = rawClosing === undefined ? source.length : rawClosing + 2;
        diagnostics.push(diagnostic(source, {
          code: "display-fence-layout",
          message: "Put $$ on its own line before and after this display formula.",
          from: cursor,
          to: cursor + 2,
          formulaFrom: cursor,
          formulaTo,
          display: true,
        }));
        cursor = formulaTo;
        continue;
      }
    }

    if (display && isDisplayFenceAt(source, cursor)) {
      const openingLineEnd = lineEndAt(source, cursor);
      const bodyFrom = openingLineEnd + lineBreakLengthAt(source, openingLineEnd);
      let closingLineStart = nextLineStart(source, lineStartAt(source, cursor));
      let closing: number | undefined;
      while (closingLineStart < source.length) {
        const candidate = displayFenceOnLine(source, closingLineStart);
        if (candidate !== undefined) {
          closing = candidate;
          break;
        }
        closingLineStart = nextLineStart(source, closingLineStart);
      }

      if (closing === undefined) {
        diagnostics.push(diagnostic(source, {
          code: "unclosed-display",
          message: "Close this display formula with $$ on its own line.",
          from: cursor,
          to: cursor + 2,
          formulaFrom: cursor,
          formulaTo: source.length,
          display: true,
        }));
        cursor = source.length;
        continue;
      }

      let bodyTo = lineStartAt(source, closing);
      if (bodyTo > bodyFrom && source[bodyTo - 1] === "\n") bodyTo -= 1;
      if (bodyTo > bodyFrom && source[bodyTo - 1] === "\r") bodyTo -= 1;
      const normalized = normalizedBody(source, bodyFrom, bodyTo, cursor);
      const closingLineEnd = lineEndAt(source, closing);
      ranges.push({
        from: cursor,
        to: closing + 2,
        bodyFrom,
        bodyTo,
        delimiter,
        display: true,
        syntax: "display-fence",
        latex: normalized.latex,
      });
      const failure = parseFailure(normalized.latex);
      if (failure) {
        const normalizedPosition = Math.max(
          0,
          Math.min(Math.max(0, normalized.offsets.length - 2), failure.position),
        );
        const from = normalized.offsets[normalizedPosition] ?? bodyFrom;
        const to = Math.min(bodyTo, from + 1);
        diagnostics.push(diagnostic(source, {
          code: "parse-error",
          message: failure.message,
          from,
          to: Math.max(from + 1, to),
          formulaFrom: cursor,
          formulaTo: closing + 2,
          display: true,
        }));
      }
      cursor = closingLineEnd;
      continue;
    }

    const scanned = scanTextClosing(source, cursor, delimiter);
    if (scanned.closing === undefined) {
      if (runLength === 1 && currencyLikeOpening(source, cursor)) {
        cursor += 1;
        continue;
      }
      diagnostics.push(diagnostic(source, {
        code: display ? "unclosed-display" : "unclosed-inline",
        message: display
          ? "Close this display formula with $$."
          : "Close this inline formula with $.",
        from: cursor,
        to: cursor + runLength,
        formulaFrom: cursor,
        formulaTo: scanned.boundary,
        display,
      }));
      cursor = Math.max(cursor + runLength, scanned.boundary);
      continue;
    }

    const closing = scanned.closing;
    const bodyFrom = cursor + runLength;
    const bodyTo = closing;
    const normalized = normalizedBody(source, bodyFrom, bodyTo, cursor);
    const range: LatexSourceRange = {
      from: cursor,
      to: closing + runLength,
      bodyFrom,
      bodyTo,
      delimiter,
      display,
      syntax: display ? "display-inline" : "inline",
      latex: normalized.latex,
    };
    ranges.push(range);
    const failure = parseFailure(normalized.latex);
    if (failure) {
      const normalizedPosition = Math.max(
        0,
        Math.min(Math.max(0, normalized.offsets.length - 2), failure.position),
      );
      const from = normalized.offsets[normalizedPosition] ?? bodyFrom;
      const to = Math.min(bodyTo, from + 1);
      diagnostics.push(diagnostic(source, {
        code: "parse-error",
        message: failure.message,
        from,
        to: Math.max(from + 1, to),
        formulaFrom: cursor,
        formulaTo: range.to,
        display,
      }));
    }
    cursor = range.to;
  }

  diagnostics.sort((left, right) => left.from - right.from || left.to - right.to);
  return { ranges, diagnostics };
}

export function findLatexDiagnostics(source: string): LatexDiagnostic[] {
  return analyzeLatexSource(source).diagnostics;
}

function parseErrorAction(message: string) {
  if (/undefined control sequence/i.test(message)) {
    return "Check the highlighted command spelling or replace it with a KaTeX-supported command.";
  }
  if (/\\end|environment/i.test(message)) {
    return "Close the environment with the matching \\end{…} command.";
  }
  if (/expected ['\"]?}|macro argument|unexpected end|got ['\"]?EOF/i.test(message)) {
    return "Add the missing closing brace near the highlighted position.";
  }
  if (/expected ['\"]?\]/i.test(message)) {
    return "Add the missing closing bracket near the highlighted position.";
  }
  return "Edit the highlighted LaTeX until the compiled preview renders normally.";
}

/** Stable wording shared by editor markers, passive badges, and tooltips. */
export function formatLatexDiagnostic(
  value: LatexDiagnostic,
): LatexDiagnosticPresentation {
  const location = `Line ${value.line}, column ${value.column}`;
  const presentation = (() => {
    switch (value.code) {
      case "display-fence-layout":
        return {
          title: "Markdown display fence",
          detail: "Markdown treats LaTeX beside an opening $$ as fence metadata. In an aligned block this strips \\begin{aligned}, so KaTeX encounters & outside an alignment.",
          action: "Put each $$ on its own line, with all LaTeX between them.",
        };
      case "unclosed-inline":
        return {
          title: "Unclosed inline formula",
          detail: value.message,
          action: "Add the matching $ before this paragraph ends.",
        };
      case "unclosed-display":
        return {
          title: "Unclosed display formula",
          detail: value.message,
          action: "Add the matching $$; keep it on its own line when this is a fenced display.",
        };
      case "parse-error":
        return {
          title: "LaTeX syntax error",
          detail: value.message,
          action: parseErrorAction(value.message),
        };
    }
  })();
  return {
    ...presentation,
    location,
    ariaLabel: `${presentation.title}. ${location}. ${presentation.detail} ${presentation.action}`,
  };
}

function preferredLineBreak(source: string) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function safeFenceContinuationPrefix(source: string, delimiterFrom: number) {
  const prefix = source.slice(lineStartAt(source, delimiterFrom), delimiterFrom);
  if (/^[ \t]{0,3}$/.test(prefix)) return prefix;
  if (/^(?:[ \t]{0,3}>[ \t]?)+$/.test(prefix)) return prefix;
  return undefined;
}

/**
 * Returns only deterministic repairs. KaTeX parse errors deliberately remain
 * advisory: guessing at mathematical source is more damaging than a clear
 * diagnostic. Edits use CodeMirror-compatible half-open source offsets.
 */
export function suggestLatexDiagnosticFix(
  source: string,
  value: LatexDiagnostic,
): LatexDiagnosticFix | undefined {
  const formulaFrom = Math.max(0, Math.min(source.length, value.formulaFrom));
  const formulaTo = Math.max(formulaFrom, Math.min(source.length, value.formulaTo));

  if (value.code === "parse-error") return undefined;

  if (value.code === "unclosed-inline") {
    if (source[formulaTo] === "$") return undefined;
    return {
      label: "Add closing $",
      edits: [{ from: formulaTo, to: formulaTo, insert: "$" }],
    };
  }

  if (value.code === "display-fence-layout") {
    const closingFrom = formulaTo - 2;
    if (
      source.slice(formulaFrom, formulaFrom + 2) !== "$$" ||
      closingFrom <= formulaFrom ||
      source.slice(closingFrom, formulaTo) !== "$$"
    ) {
      return undefined;
    }
    const prefix = safeFenceContinuationPrefix(source, formulaFrom);
    if (prefix === undefined) return undefined;
    const lineBreak = preferredLineBreak(source);
    const edits: LatexTextEdit[] = [
      { from: formulaFrom + 2, to: formulaFrom + 2, insert: `${lineBreak}${prefix}` },
    ];
    if (!isDisplayFenceAt(source, closingFrom)) {
      edits.push({ from: closingFrom, to: closingFrom, insert: `${lineBreak}${prefix}` });
    }
    return { label: "Put $$ on separate lines", edits };
  }

  if (source.slice(formulaFrom, formulaFrom + 2) !== "$$" || source[formulaTo] === "$") {
    return undefined;
  }
  if (isDisplayFenceAt(source, formulaFrom)) {
    const prefix = safeFenceContinuationPrefix(source, formulaFrom);
    if (prefix === undefined) return undefined;
    const lineBreak = preferredLineBreak(source);
    const separator = formulaTo > 0 && /[\r\n]/.test(source[formulaTo - 1] ?? "")
      ? ""
      : lineBreak;
    return {
      label: "Add closing $$ line",
      edits: [{ from: formulaTo, to: formulaTo, insert: `${separator}${prefix}$$` }],
    };
  }
  return {
    label: "Add closing $$",
    edits: [{ from: formulaTo, to: formulaTo, insert: "$$" }],
  };
}

export function applyLatexDiagnosticFix(
  source: string,
  fix: LatexDiagnosticFix,
): string {
  const edits = [...fix.edits].sort((left, right) => right.from - left.from || right.to - left.to);
  let previousFrom = source.length + 1;
  let result = source;
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < 0 ||
      edit.to < edit.from ||
      edit.to > source.length ||
      edit.to > previousFrom
    ) {
      throw new RangeError("Invalid or overlapping LaTeX diagnostic edits.");
    }
    result = `${result.slice(0, edit.from)}${edit.insert}${result.slice(edit.to)}`;
    previousFrom = edit.from;
  }
  return result;
}
