import { analyzeLatexSource, type LatexSourceRange } from "./latexDiagnostics";

const FORMULA_CACHE_LIMIT = 128;
const formulaCache = new Map<string, readonly string[]>();
const EMPTY_FORMULAS: readonly string[] = Object.freeze([]);

const FRONTMATTER_PREFIX = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Formula previews must agree with the editor about what is mathematical
 * source, but metadata and comments are not visible note content. Mask them
 * without changing line structure before handing the document to the shared
 * LaTeX analyser.
 */
function visibleFormulaSource(markdown: string) {
  return markdown
    .replace(FRONTMATTER_PREFIX, (frontmatter) =>
      frontmatter.replace(/[^\r\n]/g, " ")
    )
    .replace(HTML_COMMENT, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function previewMarkdown(range: LatexSourceRange) {
  const latex = range.latex.trim();
  if (!latex) return undefined;
  return range.display ? `$$\n${latex}\n$$` : `$${latex}$`;
}

function remember(markdown: string, candidates: readonly string[]) {
  formulaCache.delete(markdown);
  formulaCache.set(markdown, candidates);
  if (formulaCache.size <= FORMULA_CACHE_LIMIT) return candidates;
  const oldest = formulaCache.keys().next().value;
  if (oldest !== undefined) formulaCache.delete(oldest);
  return candidates;
}

/**
 * Return the useful equations for a canvas landmark. Display equations are
 * substantive note landmarks, so they form the complete choice set whenever
 * any exist. Inline formulae are a fallback for notes without display math;
 * this avoids making every symbol in prose another picker entry.
 */
export function landmarkFormulaCandidates(markdown: string): readonly string[] {
  if (!markdown) return EMPTY_FORMULAS;
  const cached = formulaCache.get(markdown);
  if (cached) {
    // A small LRU prevents multiple canvas copies of one note from repeatedly
    // scanning and validating the same LaTeX while keeping memory bounded.
    formulaCache.delete(markdown);
    formulaCache.set(markdown, cached);
    return cached;
  }

  const ranges = analyzeLatexSource(visibleFormulaSource(markdown)).ranges;
  const display = ranges.filter((range) => range.display);
  const chosenRanges = display.length
    ? display
    : ranges.filter((range) => !range.display);
  const candidates = Object.freeze(
    chosenRanges
      .map(previewMarkdown)
      .filter((candidate): candidate is string => candidate !== undefined),
  );
  return remember(markdown, candidates);
}

/** Invalid or stale persisted indices safely retain the historical first
 * equation rather than making a landmark blank. */
export function selectedLandmarkFormula(
  markdown: string,
  formulaIndex = 0,
): string | undefined {
  const candidates = landmarkFormulaCandidates(markdown);
  if (!candidates.length) return undefined;
  if (!Number.isSafeInteger(formulaIndex) || formulaIndex < 0) {
    return candidates[0];
  }
  return candidates[formulaIndex] ?? candidates[0];
}
