import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { EditorState, Prec, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  createEditorInsertion,
  type MathEnvironmentTemplate,
} from "./editorTransforms";
import type { MarkdownBlockKind } from "./markdownBlocks";
import {
  resolveWikiLink,
  wikiLinkSuggestions,
  wikiLinkVisibleLabel,
  type WikiLinkIndex,
} from "../domain/wikiLinks";
import {
  formulaSourceOffsetAtPoint,
  formulaVisualElement,
} from "./formulaCaret";
import {
  analyzeLatexSource,
  formatLatexDiagnostic,
  type LatexDiagnostic,
} from "./latexDiagnostics";

interface LivePreviewBlockEditorProps {
  value: string;
  kind: MarkdownBlockKind;
  initialCursor?: number;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  wikiLinkIndex?: WikiLinkIndex;
  currentNotePath?: string;
  onNavigateWikiLink?: (path: string) => void;
}

export interface LivePreviewBlockEditorHandle {
  insertText: (text: string, point?: { x: number; y: number }) => boolean;
  focus: () => void;
}

interface MathRange {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  latex: string;
  display: boolean;
}

export interface UnmatchedMathDelimiter {
  from: number;
  to: number;
  delimiter: "$" | "$$";
}

const environmentNames: Record<string, string> = {
  definition: "Definition",
  theorem: "Theorem",
  lemma: "Lemma",
  proposition: "Proposition",
  corollary: "Corollary",
  example: "Example",
};

function insertEnvironment(
  view: EditorView,
  environment: MathEnvironmentTemplate,
) {
  const selection = view.state.selection.main;
  const insertion = createEditorInsertion(
    view.state.doc.toString(),
    selection.from,
    selection.to,
    environment,
  );
  view.dispatch({
    changes: {
      from: insertion.from,
      to: insertion.to,
      insert: insertion.insert,
    },
    selection: { anchor: insertion.anchor, head: insertion.head },
    scrollIntoView: true,
    userEvent: "input.math-environment",
  });
  view.focus();
  return true;
}

const environmentShortcuts: ReadonlyArray<readonly [string, MathEnvironmentTemplate]> = [
  ["Alt-d", "definition"],
  ["Alt-e", "example"],
  ["Alt-t", "theorem"],
  ["Alt-p", "proposition"],
  ["Alt-l", "lemma"],
];

const environmentShortcutKeymap: readonly KeyBinding[] = environmentShortcuts.map((
  [key, environment],
) => ({
  key,
  preventDefault: true,
  stopPropagation: true,
  run: (view) => insertEnvironment(view, environment),
}));

// Completion commands must run before the editor's Enter, Tab, Escape and
// cursor bindings. Keeping the complete CodeMirror completion keymap at the
// highest precedence also makes Escape dismiss the picker before it closes the
// editing session, and lets arrow keys move through results predictably.
const highPriorityCompletionKeymap = Prec.highest(keymap.of([
  ...completionKeymap,
  { key: "Tab", run: acceptCompletion },
]));

const latexCommands = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "theta",
  "lambda",
  "mu",
  "pi",
  "rho",
  "sigma",
  "phi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Sigma",
  "Phi",
  "Omega",
  "mathbb",
  "mathbf",
  "mathcal",
  "mathrm",
  "operatorname",
  "frac",
  "sqrt",
  "sum",
  "prod",
  "int",
  "partial",
  "nabla",
  "infty",
  "left",
  "right",
  "begin",
  "end",
  "text",
  "hat",
  "bar",
  "tilde",
  "subset",
  "subseteq",
  "in",
  "notin",
  "forall",
  "exists",
  "implies",
  "iff",
  "to",
  "mapsto",
  "leq",
  "geq",
  "neq",
  "approx",
  "sim",
  "equiv",
].map((command) => ({
  label: `\\${command}`,
  apply: `\\${command}`,
  type: "keyword" as const,
}));

function latexCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const command = context.matchBefore(/\\[A-Za-z]*$/);
  if (!command || (command.from === command.to && !context.explicit)) {
    return null;
  }
  return {
    from: command.from,
    options: latexCommands,
    validFor: /\\[A-Za-z]*$/,
  };
}

export function createWikiLinkCompletionSource(
  index: WikiLinkIndex | undefined | (() => WikiLinkIndex | undefined),
  currentNotePath?: string | (() => string | undefined),
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const token = context.matchBefore(/\[\[[^\]\r\n|]*$/);
    if (!token || (!context.explicit && token.text.length < 2)) return null;
    const query = token.text.slice(2);
    const currentIndex = typeof index === "function" ? index() : index;
    const currentPath = typeof currentNotePath === "function"
      ? currentNotePath()
      : currentNotePath;
    const suggestions = wikiLinkSuggestions(currentIndex, query, currentPath);
    if (!suggestions.length) return null;
    return {
      from: token.from,
      filter: false,
      options: suggestions.map((suggestion): Completion => ({
        label: suggestion.title,
        detail: suggestion.folder || "Vault root",
        apply: (view, _completion, from, to) => {
          // closeBrackets may already have placed one or two closing brackets.
          // Consume them so accepting a result can never produce `]]]]`.
          const suffix = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2));
          const existingClosing = suffix.match(/^\]{1,2}/)?.[0].length ?? 0;
          view.dispatch({
            changes: {
              from,
              to: to + existingClosing,
              insert: suggestion.insertion,
            },
            selection: { anchor: from + suggestion.insertion.length },
            scrollIntoView: true,
            userEvent: "input.complete",
          });
        },
        type: "text",
        boost: Math.max(-50, Math.min(99, Math.round(suggestion.score / 10))),
      })),
      validFor: /\[\[[^\]\r\n|]*$/,
    };
  };
}

/**
 * Renderer-compatible formula ranges. The shared analysis deliberately
 * distinguishes display-fence metadata from LaTeX source, so editing and
 * reading can never disagree about which dollar run closes a formula.
 */
export function findEditableMath(source: string): MathRange[] {
  return analyzeLatexSource(source).ranges.map((range) => ({
    from: range.from,
    to: range.to,
    bodyFrom: range.bodyFrom,
    bodyTo: range.bodyTo,
    latex: range.latex,
    display: range.display,
  }));
}

/** Conventional delimiter runs that are not part of a renderer-compatible
 * formula. They stay as exact source and receive a quiet syntax diagnostic. */
export function findUnmatchedMathDelimiters(
  source: string,
  _ranges?: readonly MathRange[],
): UnmatchedMathDelimiter[] {
  return analyzeLatexSource(source).diagnostics
    .filter((issue) => issue.code === "unclosed-inline" || issue.code === "unclosed-display")
    .map((issue) => ({
      from: issue.from,
      to: issue.to,
      delimiter: issue.display ? "$$" : "$",
    }));
}

function renderKatex(host: HTMLElement, latex: string, displayMode: boolean) {
  katex.render(latex || "\\phantom{x}", host, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    output: "htmlAndMathml",
  });
}

class CompiledMathWidget extends WidgetType {
  constructor(
    private readonly range: MathRange,
    private readonly activePreview: boolean,
  ) {
    super();
  }

  eq(other: CompiledMathWidget) {
    return (
      other.range.from === this.range.from &&
      other.range.to === this.range.to &&
      other.range.latex === this.range.latex &&
      other.range.display === this.range.display &&
      other.activePreview === this.activePreview
    );
  }

  toDOM(view: EditorView) {
    const host = document.createElement("span");
    host.className = [
      "cm-compiled-math",
      this.range.display ? "cm-compiled-math--display" : "cm-compiled-math--inline",
      this.activePreview ? "cm-compiled-math--preview" : "",
    ].filter(Boolean).join(" ");
    host.setAttribute(
      "aria-label",
      this.activePreview ? "Live formula preview" : "Edit formula",
    );
    host.title = this.activePreview
      ? "Compiled preview — click a symbol to move the source caret"
      : "Click a symbol to edit its LaTeX source";
    renderKatex(host, this.range.latex, this.range.display);

    host.tabIndex = 0;
    host.setAttribute("role", "button");
    const activate = (event?: Event) => {
      event?.preventDefault();
      event?.stopPropagation();
      let sourceOffset = Math.round(this.range.latex.length / 2);
      if (
        event &&
        "clientX" in event && typeof event.clientX === "number" &&
        "clientY" in event && typeof event.clientY === "number"
      ) {
        const visual = formulaVisualElement(host);
        sourceOffset = formulaSourceOffsetAtPoint(
          this.range.latex,
          visual.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
      }
      view.dispatch({
        selection: { anchor: this.range.bodyFrom + sourceOffset },
        scrollIntoView: true,
      });
      view.focus();
    };
    host.addEventListener("pointerdown", activate);
    host.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    });
    return host;
  }

  ignoreEvent() {
    return false;
  }
}

class LatexDiagnosticWidget extends WidgetType {
  constructor(private readonly issue: LatexDiagnostic) {
    super();
  }

  eq(other: LatexDiagnosticWidget) {
    return other.issue.code === this.issue.code &&
      other.issue.message === this.issue.message &&
      other.issue.from === this.issue.from &&
      other.issue.line === this.issue.line &&
      other.issue.column === this.issue.column;
  }

  toDOM(view: EditorView) {
    const presentation = formatLatexDiagnostic(this.issue);
    const host = document.createElement("span");
    host.className = [
      "cm-live-latex-diagnostic-note",
      `cm-live-latex-diagnostic-note--${this.issue.code}`,
    ].join(" ");
    host.tabIndex = 0;
    host.setAttribute("role", "button");
    host.setAttribute(
      "aria-label",
      `${presentation.ariaLabel} Press Enter to edit the highlighted source.`,
    );
    host.title = "Go to highlighted LaTeX source";

    const icon = document.createElement("span");
    icon.className = "cm-live-latex-diagnostic-note__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const content = document.createElement("span");
    content.className = "cm-live-latex-diagnostic-note__content";

    const heading = document.createElement("span");
    heading.className = "cm-live-latex-diagnostic-note__heading";

    const title = document.createElement("strong");
    title.className = "cm-live-latex-diagnostic-note__title";
    title.textContent = presentation.title;

    const location = document.createElement("span");
    location.className = "cm-live-latex-diagnostic-note__location";
    location.textContent = presentation.location.replace(", ", " · ");

    const message = document.createElement("span");
    message.className = "cm-live-latex-diagnostic-note__message";
    message.textContent = presentation.detail;

    const action = document.createElement("span");
    action.className = "cm-live-latex-diagnostic-note__action";
    action.textContent = presentation.action;

    heading.append(title, location);
    content.append(heading, message, action);
    host.append(icon, content);

    const goToSource = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: this.issue.from },
        scrollIntoView: true,
      });
      view.focus();
    };
    host.addEventListener("pointerdown", goToSource);
    host.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") goToSource(event);
    });
    return host;
  }

  ignoreEvent() {
    return false;
  }
}

class EnvironmentLabelWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: EnvironmentLabelWidget) {
    return other.label === this.label;
  }

  toDOM() {
    const label = document.createElement("strong");
    label.className = "cm-math-environment-label";
    label.textContent = `${this.label}.`;
    return label;
  }
}

interface WikiLinkWidgetContext {
  index?: WikiLinkIndex;
  currentNotePath?: string;
  onNavigate?: (path: string) => void;
}

type WikiLinkWidgetContextReader = () => WikiLinkWidgetContext;

class LinkWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly label: string,
    private readonly from: number,
    private readonly to: number,
    private readonly wikiContext: WikiLinkWidgetContextReader,
  ) {
    super();
  }

  eq(other: LinkWidget) {
    return other.target === this.target && other.label === this.label &&
      other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    const link = document.createElement("span");
    const context = this.wikiContext();
    const resolution = resolveWikiLink(
      context.index,
      this.target,
      context.currentNotePath,
    );
    const resolved = resolution.status === "resolved" ? resolution.note : undefined;
    link.className = `cm-live-link cm-live-link--${resolution.status}`;
    link.textContent = this.label;
    link.title = resolved
      ? `Click to edit · Ctrl-click to open ${resolved.path}`
      : resolution.status === "ambiguous"
        ? "Click to edit · this link is ambiguous"
        : "Click to edit · note not found";
    link.tabIndex = 0;
    link.setAttribute("role", "link");
    link.setAttribute("aria-label", resolved ? `Open ${resolved.path}` : `${this.label}, unresolved link`);
    link.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && resolved && context.onNavigate) {
        context.onNavigate(resolved.path);
        return;
      }
      view.dispatch({ selection: { anchor: this.from + 2 }, scrollIntoView: true });
      view.focus();
    });
    link.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && resolved && context.onNavigate) {
        event.preventDefault();
        context.onNavigate(resolved.path);
      }
    });
    return link;
  }

  ignoreEvent() {
    return false;
  }
}

function containsSelection(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

function selectionInside(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some(
    (range) => range.empty
      ? range.head >= from && range.head < to
      : range.from < to && range.to > from,
  );
}

function intersectsRanges(from: number, to: number, ranges: readonly MathRange[]) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function buildLivePreview(
  view: EditorView,
  wikiContext: WikiLinkWidgetContextReader,
): DecorationSet {
  const source = view.state.doc.toString();
  const latexAnalysis = analyzeLatexSource(source);
  const mathRanges: MathRange[] = latexAnalysis.ranges.map((range) => ({
    from: range.from,
    to: range.to,
    bodyFrom: range.bodyFrom,
    bodyTo: range.bodyTo,
    latex: range.latex,
    display: range.display,
  }));
  const decorations: Range<Decoration>[] = [];

  for (const range of mathRanges) {
    const startLine = view.state.doc.lineAt(range.from);
    const endLine = view.state.doc.lineAt(range.to);
    const crossesLines = startLine.number !== endLine.number;
    const active = selectionInside(view, range.from, range.to);
    if (!active) {
      if (range.display && crossesLines) {
        decorations.push(
          Decoration.replace({
            widget: new CompiledMathWidget(range, false),
          }).range(range.from, startLine.to),
        );
        for (let lineNumber = startLine.number + 1; lineNumber <= endLine.number; lineNumber += 1) {
          const line = view.state.doc.line(lineNumber);
          const from = Math.max(range.from, line.from);
          const to = Math.min(range.to, line.to);
          if (from < to) decorations.push(Decoration.replace({}).range(from, to));
          decorations.push(
            Decoration.line({
              attributes: { class: "cm-live-hidden-math-line" },
            }).range(line.from),
          );
        }
        continue;
      }
      decorations.push(
        Decoration.replace({
          widget: new CompiledMathWidget(range, false),
          inclusive: false,
        }).range(range.from, range.to),
      );
      continue;
    }

    const delimiterLength = range.display ? 2 : 1;
    decorations.push(
      Decoration.mark({
        class: `cm-live-math-delimiter cm-live-math-delimiter--${range.display ? "display" : "inline"}`,
        attributes: {
          title: `${range.display ? "Display" : "Inline"} LaTeX delimiter`,
        },
      }).range(range.from, range.from + delimiterLength),
    );
    if (range.bodyFrom < range.bodyTo) {
      decorations.push(
        Decoration.mark({ class: "cm-live-latex-source" }).range(range.bodyFrom, range.bodyTo),
      );
    }
    decorations.push(
      Decoration.mark({
        class: `cm-live-math-delimiter cm-live-math-delimiter--${range.display ? "display" : "inline"}`,
        attributes: {
          title: `${range.display ? "Display" : "Inline"} LaTeX delimiter`,
        },
      }).range(range.to - delimiterLength, range.to),
    );
    decorations.push(
      Decoration.widget({
        widget: new CompiledMathWidget(range, true),
        side: 1,
      }).range(range.to),
    );
  }

  for (const issue of latexAnalysis.diagnostics) {
    const presentation = formatLatexDiagnostic(issue);
    const from = Math.max(0, Math.min(source.length, issue.from));
    const to = Math.max(from, Math.min(source.length, issue.to));
    if (from === to) continue;
    decorations.push(
      Decoration.mark({
        class: issue.code === "parse-error"
          ? "cm-live-latex-diagnostic cm-live-latex-diagnostic--parse"
          : "cm-live-latex-diagnostic cm-live-unmatched-math-delimiter",
        attributes: {
          title: `${presentation.title}: ${presentation.detail}`,
          "aria-label": presentation.ariaLabel,
        },
      }).range(from, to),
    );
    const anchor = view.state.doc.lineAt(to).to;
    decorations.push(
      Decoration.widget({
        widget: new LatexDiagnosticWidget(issue),
        side: 20,
      }).range(anchor),
    );
  }

  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    const heading = line.text.match(/^(#{1,6})([ \t]+)/);
    if (heading) {
      decorations.push(
        Decoration.line({
          attributes: {
            class: `cm-live-heading cm-live-heading--${heading[1].length}`,
          },
        }).range(line.from),
      );
      const markerTo = line.from + heading[0].length;
      if (!containsSelection(view, line.from, markerTo)) {
        decorations.push(Decoration.replace({}).range(line.from, markerTo));
      } else {
        decorations.push(
          Decoration.mark({ class: "cm-live-markup" }).range(line.from, markerTo),
        );
      }
    }

    const callout = line.text.match(/^([ \t]*>[ \t]?)(?:\[!(definition|theorem|lemma|proposition|corollary|example)\]([ \t]*))?/i);
    if (callout) {
      decorations.push(
        Decoration.line({ attributes: { class: "cm-live-callout-line" } }).range(line.from),
      );
      const fullPrefixTo = line.from + callout[0].length;
      if (!containsSelection(view, line.from, fullPrefixTo)) {
        const environment = callout[2]?.toLowerCase();
        decorations.push(
          Decoration.replace({
            widget: environment
              ? new EnvironmentLabelWidget(environmentNames[environment])
              : undefined,
          }).range(line.from, fullPrefixTo),
        );
      } else {
        decorations.push(
          Decoration.mark({ class: "cm-live-markup" }).range(line.from, fullPrefixTo),
        );
      }
    }
  }

  const strong = /(?<!\\)(\*\*|__)(?=\S)(.+?\S)\1/g;
  const strongRanges: Array<{ from: number; to: number }> = [];
  for (const match of source.matchAll(strong)) {
    const from = match.index;
    const delimiter = match[1].length;
    const to = from + match[0].length;
    if (intersectsRanges(from, to, mathRanges) || selectionInside(view, from, to)) continue;
    strongRanges.push({ from, to });
    decorations.push(Decoration.replace({}).range(from, from + delimiter));
    decorations.push(Decoration.mark({ class: "cm-live-strong" }).range(from + delimiter, to - delimiter));
    decorations.push(Decoration.replace({}).range(to - delimiter, to));
  }

  const emphasis = /(?<![\\*])\*(?!\*)(?=\S)(.+?\S)\*(?!\*)/g;
  for (const match of source.matchAll(emphasis)) {
    const from = match.index;
    const to = from + match[0].length;
    if (
      intersectsRanges(from, to, mathRanges) ||
      strongRanges.some((range) => from < range.to && to > range.from) ||
      selectionInside(view, from, to)
    ) {
      continue;
    }
    decorations.push(Decoration.replace({}).range(from, from + 1));
    decorations.push(Decoration.mark({ class: "cm-live-emphasis" }).range(from + 1, to - 1));
    decorations.push(Decoration.replace({}).range(to - 1, to));
  }

  const inlineCode = /(?<![\\`])`([^`\r\n]+)`/g;
  for (const match of source.matchAll(inlineCode)) {
    const from = match.index;
    const to = from + match[0].length;
    if (intersectsRanges(from, to, mathRanges) || selectionInside(view, from, to)) continue;
    decorations.push(Decoration.replace({}).range(from, from + 1));
    decorations.push(Decoration.mark({ class: "cm-live-code" }).range(from + 1, to - 1));
    decorations.push(Decoration.replace({}).range(to - 1, to));
  }

  const wikilink = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  for (const match of source.matchAll(wikilink)) {
    const from = match.index;
    const to = from + match[0].length;
    if (intersectsRanges(from, to, mathRanges) || selectionInside(view, from, to)) continue;
    decorations.push(
      Decoration.replace({
        widget: new LinkWidget(
          match[1].trim(),
          wikiLinkVisibleLabel(match[1], match[2]),
          from,
          to,
          wikiContext,
        ),
      }).range(from, to),
    );
  }

  decorations.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(decorations, true);
}

function createLivePreviewPlugin(wikiContext: WikiLinkWidgetContextReader) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildLivePreview(view, wikiContext);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildLivePreview(update.view, wikiContext);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}

const liveEditorTheme = EditorView.theme({
  "&": {
    width: "100%",
    color: "#18191b",
    backgroundColor: "transparent",
    fontFamily: '"Times New Roman", Times, serif',
    fontSize: "16px",
    lineHeight: "1.62",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "visible",
    fontFamily: "inherit",
    lineHeight: "inherit",
  },
  ".cm-content": {
    minHeight: "1.62em",
    padding: "0",
    caretColor: "#111827",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeft: "1.5px solid #111827" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(37, 99, 235, .19) !important",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-tooltip-autocomplete": {
    border: "1px solid #b7bdc5",
    borderRadius: "0",
    boxShadow: "0 10px 28px rgba(15, 23, 42, .14)",
    overflow: "hidden",
    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    fontSize: "12px",
  },
});

export const LivePreviewBlockEditor = forwardRef<
  LivePreviewBlockEditorHandle,
  LivePreviewBlockEditorProps
>(function LivePreviewBlockEditor({
  value,
  kind,
  initialCursor,
  onChange,
  onSave,
  onClose,
  wikiLinkIndex,
  currentNotePath,
  onNavigateWikiLink,
}, forwardedRef) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  const syncingRef = useRef(false);
  const closingRef = useRef(false);
  const wikiContextRef = useRef({
    index: wikiLinkIndex,
    currentNotePath,
    onNavigate: onNavigateWikiLink,
  });

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCloseRef.current = onClose;
  wikiContextRef.current = {
    index: wikiLinkIndex,
    currentNotePath,
    onNavigate: onNavigateWikiLink,
  };

  useImperativeHandle(forwardedRef, () => ({
    insertText: (text, point) => {
      const view = viewRef.current;
      if (!view || !text) return false;
      const pointPosition = point ? view.posAtCoords(point) : null;
      const selection = view.state.selection.main;
      const from = pointPosition ?? selection.from;
      const to = pointPosition ?? selection.to;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
      return true;
    },
    focus: () => viewRef.current?.focus(),
  }), []);

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    closingRef.current = false;
    const finishEditing = () => {
      // A pointer leaving the block and CodeMirror's blur event can arrive for
      // the same gesture. Treat them as one semantic action so persistence and
      // focus transitions never race each other.
      if (closingRef.current) return;
      closingRef.current = true;
      onSaveRef.current();
      onCloseRef.current();
    };
    const cursor = Math.max(0, Math.min(value.length, initialCursor ?? value.length));
    const state = EditorState.create({
      doc: value,
      selection: { anchor: cursor },
      extensions: [
        history(),
        closeBrackets(),
        autocompletion({
          activateOnTyping: true,
          defaultKeymap: false,
          // Wikilink suggestions are local and synchronous. Delaying keyboard
          // interaction makes a quick Enter fall through to Markdown's newline
          // command even while the picker is visibly open.
          interactionDelay: 0,
          override: [
            createWikiLinkCompletionSource(
              () => wikiContextRef.current.index,
              () => wikiContextRef.current.currentNotePath,
            ),
            latexCompletionSource,
          ],
        }),
        highPriorityCompletionKeymap,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": `Edit ${kind === "callout" ? "mathematical environment" : kind}`,
          spellcheck: kind === "math" ? "false" : "true",
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || syncingRef.current) return;
          onChangeRef.current(update.state.doc.toString());
        }),
        keymap.of([
          ...environmentShortcutKeymap,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          {
            key: "Escape",
            preventDefault: true,
            run: () => {
              finishEditing();
              return true;
            },
          },
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              finishEditing();
              return true;
            },
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        createLivePreviewPlugin(() => wikiContextRef.current),
        liveEditorTheme,
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // A block editor is a short-lived editing session. External value changes
    // are synchronised below without reconstructing CodeMirror or its history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: {
        anchor: Math.min(selection.anchor, value.length),
        head: Math.min(selection.head, value.length),
      },
    });
    syncingRef.current = false;
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="live-preview-block-editor"
      data-block-kind={kind}
    />
  );
});
