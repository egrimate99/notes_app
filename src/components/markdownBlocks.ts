export type MarkdownBlockKind =
  | "paragraph"
  | "heading"
  | "list"
  | "blockquote"
  | "callout"
  | "code"
  | "math"
  | "thematic-break";

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  /** Inclusive UTF-16 offset into the original Markdown string. */
  start: number;
  /** Exclusive UTF-16 offset into the original Markdown string. */
  end: number;
  /** The exact, unnormalised source represented by this block. */
  markdown: string;
}

interface SourceLine {
  start: number;
  contentEnd: number;
  text: string;
}

interface CodeFence {
  marker: "`" | "~";
  length: number;
}

const blankLine = /^[\t ]*$/;
const atxHeading = /^ {0,3}#{1,6}(?:[\t ]+|$)/;
const setextHeading = /^ {0,3}(?:=+|-+)[\t ]*$/;
const blockquote = /^ {0,3}>/;
const callout = /^ {0,3}>[\t ]?\[![^\]\r\n]+\]/i;
const listItem = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[\t ]+|$)/;
const thematicBreak =
  /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/;
const displayMathFence = /^ {0,3}\$\$[\t ]*$/;

function sourceLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let lineStart = 0;

  for (let cursor = 0; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor];
    if (character !== "\n" && character !== "\r") continue;

    const isCrLf =
      character === "\r" && markdown[cursor + 1] === "\n";
    lines.push({
      start: lineStart,
      contentEnd: cursor,
      text: markdown.slice(lineStart, cursor),
    });

    if (isCrLf) cursor += 1;
    lineStart = cursor + 1;
  }

  if (lineStart < markdown.length) {
    lines.push({
      start: lineStart,
      contentEnd: markdown.length,
      text: markdown.slice(lineStart),
    });
  }

  return lines;
}

function openingCodeFence(text: string): CodeFence | undefined {
  const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return undefined;

  const run = match[1];
  if (run[0] === "`" && match[2].includes("`")) return undefined;

  return {
    marker: run[0] as CodeFence["marker"],
    length: run.length,
  };
}

function closesCodeFence(text: string, fence: CodeFence): boolean {
  const match = text.match(/^ {0,3}(`+|~+)[\t ]*$/);
  return Boolean(
    match &&
      match[1][0] === fence.marker &&
      match[1].length >= fence.length,
  );
}

function leadingIndent(text: string): number {
  let width = 0;
  for (const character of text) {
    if (character === " ") {
      width += 1;
    } else if (character === "\t") {
      width += 4 - (width % 4);
    } else {
      break;
    }
  }
  return width;
}

function startsIndependentBlock(text: string): boolean {
  return Boolean(
    openingCodeFence(text) ||
      displayMathFence.test(text) ||
      atxHeading.test(text) ||
      thematicBreak.test(text) ||
      blockquote.test(text) ||
      listItem.test(text),
  );
}

function consumeFencedCode(lines: SourceLine[], from: number): number {
  const fence = openingCodeFence(lines[from].text);
  if (!fence) return from + 1;

  for (let cursor = from + 1; cursor < lines.length; cursor += 1) {
    if (closesCodeFence(lines[cursor].text, fence)) return cursor + 1;
  }
  return lines.length;
}

function consumeDisplayMath(lines: SourceLine[], from: number): number {
  for (let cursor = from + 1; cursor < lines.length; cursor += 1) {
    if (displayMathFence.test(lines[cursor].text)) return cursor + 1;
  }
  return lines.length;
}

function consumeBlockquote(lines: SourceLine[], from: number): number {
  let cursor = from + 1;
  while (cursor < lines.length && blockquote.test(lines[cursor].text)) {
    cursor += 1;
  }
  return cursor;
}

function consumeList(lines: SourceLine[], from: number): number {
  const baseIndent = leadingIndent(lines[from].text);
  let cursor = from + 1;

  while (cursor < lines.length) {
    const text = lines[cursor].text;

    if (blankLine.test(text)) {
      let next = cursor + 1;
      while (next < lines.length && blankLine.test(lines[next].text)) next += 1;
      if (next >= lines.length) break;

      const nextText = lines[next].text;
      const continuesAfterBlank =
        !thematicBreak.test(nextText) &&
        (listItem.test(nextText) || leadingIndent(nextText) > baseIndent);
      if (!continuesAfterBlank) break;

      // Advancing beyond the next content line deliberately keeps meaningful
      // loose-list blank lines inside the list's exact source range.
      cursor = next + 1;
      continue;
    }

    if (thematicBreak.test(text)) break;
    if (listItem.test(text) || leadingIndent(text) > baseIndent) {
      cursor += 1;
      continue;
    }
    if (startsIndependentBlock(text)) break;

    // CommonMark permits an unindented lazy continuation of a list item.
    cursor += 1;
  }

  return cursor;
}

function makeBlock(
  markdown: string,
  lines: SourceLine[],
  from: number,
  to: number,
  kind: MarkdownBlockKind,
): MarkdownBlock {
  const start = lines[from].start;
  const end = lines[to - 1].contentEnd;
  return { kind, start, end, markdown: markdown.slice(start, end) };
}

/**
 * Splits Markdown into editable top-level visual blocks without normalising it.
 *
 * Every range points directly into `markdown`. Line endings and blank separators
 * around blocks are intentionally outside the ranges, so replacing one block
 * cannot silently rewrite the surrounding document's whitespace or CRLF style.
 */
export function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = sourceLines(markdown);
  const blocks: MarkdownBlock[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const text = lines[cursor].text;
    if (blankLine.test(text)) {
      cursor += 1;
      continue;
    }

    const codeFence = openingCodeFence(text);
    if (codeFence) {
      const end = consumeFencedCode(lines, cursor);
      blocks.push(makeBlock(markdown, lines, cursor, end, "code"));
      cursor = end;
      continue;
    }

    if (displayMathFence.test(text)) {
      const end = consumeDisplayMath(lines, cursor);
      blocks.push(makeBlock(markdown, lines, cursor, end, "math"));
      cursor = end;
      continue;
    }

    if (atxHeading.test(text)) {
      blocks.push(makeBlock(markdown, lines, cursor, cursor + 1, "heading"));
      cursor += 1;
      continue;
    }

    if (thematicBreak.test(text)) {
      blocks.push(
        makeBlock(markdown, lines, cursor, cursor + 1, "thematic-break"),
      );
      cursor += 1;
      continue;
    }

    if (blockquote.test(text)) {
      const end = consumeBlockquote(lines, cursor);
      blocks.push(
        makeBlock(
          markdown,
          lines,
          cursor,
          end,
          callout.test(text) ? "callout" : "blockquote",
        ),
      );
      cursor = end;
      continue;
    }

    if (listItem.test(text)) {
      const end = consumeList(lines, cursor);
      blocks.push(makeBlock(markdown, lines, cursor, end, "list"));
      cursor = end;
      continue;
    }

    const start = cursor;
    let kind: MarkdownBlockKind = "paragraph";
    cursor += 1;
    while (cursor < lines.length && !blankLine.test(lines[cursor].text)) {
      if (setextHeading.test(lines[cursor].text)) {
        cursor += 1;
        kind = "heading";
        break;
      }
      if (startsIndependentBlock(lines[cursor].text)) break;
      cursor += 1;
    }
    blocks.push(makeBlock(markdown, lines, start, cursor, kind));
  }

  return blocks;
}
