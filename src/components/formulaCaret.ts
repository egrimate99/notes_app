export interface FormulaBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SourceRow {
  from: number;
  to: number;
}

function sourceRows(source: string): SourceRow[] {
  const rows: SourceRow[] = [];
  let from = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\r" || character === "\n") {
      rows.push({ from, to: cursor });
      cursor += character === "\r" && source[cursor + 1] === "\n" ? 2 : 1;
      from = cursor;
      continue;
    }

    // In aligned/gathered formulae, `\\` is the visual row boundary even
    // when the source itself was kept on one line. Mapping vertical clicks to
    // those rows is substantially less surprising than treating the whole
    // environment as one long string.
    if (character === "\\" && source[cursor + 1] === "\\") {
      rows.push({ from, to: cursor });
      cursor += 2;
      from = cursor;
      continue;
    }
    cursor += 1;
  }

  rows.push({ from, to: source.length });
  return rows;
}

function editableRow(row: SourceRow, source: string): SourceRow {
  let { from, to } = row;
  const leadingEnvironment = source.slice(from, to).match(
    /^\s*\\begin\{[^}\r\n]+\}\s*/,
  );
  if (leadingEnvironment) from += leadingEnvironment[0].length;
  const trailingEnvironment = source.slice(from, to).match(
    /\s*\\end\{[^}\r\n]+\}\s*$/,
  );
  if (trailingEnvironment) to -= trailingEnvironment[0].length;
  return from <= to ? { from, to } : row;
}

/**
 * Maps a point on compiled mathematics back into the exact LaTeX source.
 *
 * It is deliberately row-aware and removes invisible environment wrappers
 * from the horizontal weighting. The returned offset is always a source
 * boundary, never an invented or normalised representation of the formula.
 */
export function formulaSourceOffsetAtPoint(
  source: string,
  bounds: FormulaBounds,
  clientX: number,
  clientY: number,
) {
  if (!source.length) return 0;
  const rows = sourceRows(source);
  const yRatio = bounds.height > 0
    ? Math.max(0, Math.min(0.999_999, (clientY - bounds.top) / bounds.height))
    : 0.5;
  const row = editableRow(
    rows[Math.min(rows.length - 1, Math.floor(yRatio * rows.length))],
    source,
  );
  const xRatio = bounds.width > 0
    ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
    : 0.5;
  return row.from + Math.round((row.to - row.from) * xRatio);
}

/** The visible KaTeX ink is a better hit-testing surface than a full-width
 * display wrapper. JSDOM and not-yet-laid-out nodes safely fall back to host. */
export function formulaVisualElement(host: HTMLElement): HTMLElement {
  const candidates = host.querySelectorAll<HTMLElement>(
    ".katex-html, .katex",
  );
  for (const candidate of candidates) {
    const bounds = candidate.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) return candidate;
  }
  return host;
}

export function formulaSourceRatioAtPoint(
  source: string,
  host: HTMLElement,
  clientX: number,
  clientY: number,
) {
  if (!source.length) return 0;
  const visual = formulaVisualElement(host);
  const bounds = visual.getBoundingClientRect();
  // Synthetic keyboard/programmatic activation has no meaningful point. Keep
  // the established end-of-formula placement instead of inventing a midpoint.
  if (bounds.width <= 0 || bounds.height <= 0) return 1;
  return formulaSourceOffsetAtPoint(source, bounds, clientX, clientY) /
    source.length;
}
