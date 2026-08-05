import { memo, useCallback, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type {
  Element as HastElement,
  Parent as HastParent,
  Root as HastRoot,
} from "hast";
import type {
  Blockquote,
  Content,
  FootnoteDefinition,
  FootnoteReference,
  Link,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  Strong,
  Text,
  Delete,
} from "mdast";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Pluggable } from "unified";
import "katex/dist/katex.min.css";
import { ManagedMarkdownImage } from "./ManagedMarkdownImage";
import { formulaSourceRatioAtPoint } from "./formulaCaret";
import {
  resolveWikiLink,
  wikiLinkHref,
  wikiLinkTargetFromHref,
  wikiLinkVisibleLabel,
  type WikiLinkIndex,
} from "../domain/wikiLinks";

export type MarkdownEditTargetKind =
  | "block"
  | "inline-math"
  | "display-math";

export interface MarkdownEditTarget {
  kind: MarkdownEditTargetKind;
  /** Offsets into the exact Markdown string passed to this view. */
  from: number;
  to: number;
  delimiter?: "$" | "$$";
  /** Approximate visual caret position, from the start (0) to end (1). */
  cursorRatio?: number;
}

interface MarkdownViewProps {
  markdown: string;
  /** Repository-relative Markdown path, used to resolve managed attachments. */
  contentPath?: string;
  compact?: boolean;
  editable?: boolean;
  activeTarget?: MarkdownEditTarget;
  onActivateTarget?: (target: MarkdownEditTarget) => void;
  wikiLinkIndex?: WikiLinkIndex;
  onNavigateWikiLink?: (path: string) => void;
}

const environmentNames: Record<string, string> = {
  definition: "Definition",
  theorem: "Theorem",
  lemma: "Lemma",
  proposition: "Proposition",
  corollary: "Corollary",
  example: "Example",
};

// The imported vault uses these as presentation-only wrappers. We deliberately
// unwrap the boundary tags instead of enabling raw HTML, so their readable
// Markdown children survive without carrying styles or event attributes into
// the application.
const importedFormattingTags = new Set(["s", "span", "u"]);

function hideObsidianCommentsForRender(markdown: string) {
  return markdown.replace(/<!--[\s\S]*?-->/g, (comment) =>
    // Keep every source offset stable for click-to-edit. In particular, do not
    // collapse CRLF or replace an astral UTF-16 pair with only one code unit.
    comment.replace(/[^\r\n]/g, " ")
  );
}

interface ImportedFormattingBoundary {
  tag: "s" | "span" | "u";
  closing: boolean;
  selfClosing: boolean;
}

function importedFormattingBoundary(value: string): ImportedFormattingBoundary | undefined {
  const match = value.trim().match(
    /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)(?:\s+[^<>]*?)?\s*(\/?)\s*>$/,
  );
  const tag = match?.[2].toLocaleLowerCase("en");
  if (!match || !tag || !importedFormattingTags.has(tag)) return undefined;
  return {
    tag: tag as ImportedFormattingBoundary["tag"],
    closing: match[1] === "/",
    selfClosing: match[3] === "/",
  };
}

function isHtmlCommentSequence(value: string) {
  return /^(?:\s*<!--[\s\S]*?-->)+\s*$/.test(value);
}

function safeFormattingNode(
  tag: "s" | "span" | "u",
  children: Parent["children"],
  opening: Content,
  closing: Content,
): Delete | Strong {
  const position = opening.position?.start && closing.position?.end
    ? { start: opening.position.start, end: closing.position.end }
    : undefined;
  if (tag === "s") {
    return {
      type: "delete",
      children: children as PhrasingContent[],
      position,
    };
  }
  if (tag === "span") {
    return {
      type: "strong",
      children: children as PhrasingContent[],
      data: {
        hName: "span",
        hProperties: { className: ["math-property-label"] },
      },
      position,
    };
  }
  return {
    type: "strong",
    children: children as PhrasingContent[],
    data: { hName: "u" },
    position,
  };
}

function normalizeImportedFormatting(children: Parent["children"]) {
  const normalized: Parent["children"] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === "html" && isHtmlCommentSequence(child.value)) continue;
    const boundary = child.type === "html"
      ? importedFormattingBoundary(child.value)
      : undefined;
    if (!boundary) {
      normalized.push(child);
      continue;
    }
    // A presentation-only boundary is never forwarded as raw HTML. For a
    // balanced pair, preserve the content and the two useful semantics through
    // mdast nodes that generate controlled, attribute-free elements.
    if (boundary.closing || boundary.selfClosing) continue;
    let depth = 0;
    let closingIndex = -1;
    for (let candidate = index + 1; candidate < children.length; candidate += 1) {
      const candidateNode = children[candidate];
      const candidateBoundary = candidateNode.type === "html"
        ? importedFormattingBoundary(candidateNode.value)
        : undefined;
      if (!candidateBoundary || candidateBoundary.tag !== boundary.tag) continue;
      if (!candidateBoundary.closing && !candidateBoundary.selfClosing) {
        depth += 1;
      } else if (candidateBoundary.closing) {
        if (depth === 0) {
          closingIndex = candidate;
          break;
        }
        depth -= 1;
      }
    }
    if (closingIndex < 0) continue;
    const inner = normalizeImportedFormatting(children.slice(index + 1, closingIndex));
    normalized.push(
      safeFormattingNode(boundary.tag, inner, child, children[closingIndex]),
    );
    index = closingIndex;
  }
  return normalized;
}

function firstTextInParagraph(paragraph: Paragraph) {
  const index = paragraph.children.findIndex((child) => child.type === "text");
  if (index < 0) return undefined;
  return { index, text: paragraph.children[index] as Text };
}

function convertMathEnvironment(node: Blockquote) {
  const firstParagraph = node.children[0];
  if (firstParagraph?.type !== "paragraph") return;

  const firstText = firstTextInParagraph(firstParagraph);
  if (!firstText) return;

  const match = firstText.text.value.match(
    /^\[!(definition|theorem|lemma|proposition|corollary|example)\][ \t]*([^\n]*)\n?/i,
  );
  if (!match) return;

  const environment = match[1].toLowerCase();
  const optionalTitle = match[2].trim();
  const remainingText = firstText.text.value.slice(match[0].length);
  const heading = `${environmentNames[environment]}${
    optionalTitle ? ` (${optionalTitle})` : ""
  }.`;

  firstParagraph.children.splice(
    firstText.index,
    1,
    {
      type: "strong",
      children: [{ type: "text", value: heading }],
    },
    ...(remainingText
      ? ([{ type: "text", value: ` ${remainingText}` }] as Text[])
      : []),
  );

  node.data = {
    ...node.data,
    hName: "section",
    hProperties: {
      className: ["math-environment", `math-environment--${environment}`],
    },
  };
}

function inlineAtlasNodes(node: Text): Array<Text | Link> {
  const nodes: Array<Text | Link> = [];
  const pattern = /\[\[([^\]\n]+?)\]\]|\[\^([^\]\r\n]+)\]/g;
  let cursor = 0;
  for (const match of node.value.matchAll(pattern)) {
    const from = match.index;
    if (from > cursor) nodes.push({ type: "text", value: node.value.slice(cursor, from) });
    if (match[2]) {
      nodes.push(footnoteLink(match[2]));
    } else {
      const inner = match[1];
      const separator = inner.indexOf("|");
      const target = (separator < 0 ? inner : inner.slice(0, separator)).trim();
      const alias = separator < 0 ? undefined : inner.slice(separator + 1).trim();
      if (!target) {
        nodes.push({ type: "text", value: match[0] });
      } else {
        nodes.push({
          type: "link",
          url: wikiLinkHref(target),
          children: [{ type: "text", value: wikiLinkVisibleLabel(target, alias) }],
        });
      }
    }
    cursor = from + match[0].length;
  }
  if (!nodes.length) return [node];
  if (cursor < node.value.length) nodes.push({ type: "text", value: node.value.slice(cursor) });
  return nodes;
}

function footnoteAnchor(identifier: string) {
  return `math-atlas-footnote-${encodeURIComponent(identifier.toLocaleLowerCase())}`;
}

function footnoteLink(identifier: string, label = identifier): Link {
  return {
    type: "link",
    url: `#${footnoteAnchor(identifier)}`,
    title: `Footnote ${label}`,
    children: [{ type: "text", value: `[${label}]` }],
    data: {
      hProperties: {
        className: ["math-footnote-reference"],
        "aria-label": `Footnote ${label}`,
      },
    },
  };
}

function footnoteReferenceLink(node: FootnoteReference): Link {
  return {
    ...footnoteLink(node.identifier, node.label || node.identifier),
    position: node.position,
  };
}

function visibleFootnoteDefinition(node: FootnoteDefinition): Blockquote {
  const label = node.label || node.identifier;
  const children = [...node.children];
  const first = children[0];
  if (first?.type === "paragraph") {
    first.children = [
      { type: "strong", children: [{ type: "text", value: `${label}.` }] },
      { type: "text", value: " " },
      ...first.children,
    ];
  }
  return {
    type: "blockquote",
    children,
    data: {
      hName: "aside",
      hProperties: {
        id: footnoteAnchor(node.identifier),
        className: ["math-footnote-definition"],
      },
    },
    position: node.position,
  };
}

function visitRemarkNodes(node: Root | Content) {
  if (node.type === "blockquote") convertMathEnvironment(node);
  if ("children" in node) {
    const parent = node as Parent;
    parent.children = normalizeImportedFormatting(parent.children);
    parent.children = parent.children.flatMap((child) => {
      if (child.type === "footnoteReference") {
        return [footnoteReferenceLink(child)];
      }
      if (child.type === "footnoteDefinition") {
        const definition = visibleFootnoteDefinition(child);
        visitRemarkNodes(definition);
        return [definition];
      }
      if (child.type === "text" && node.type !== "link") return inlineAtlasNodes(child);
      visitRemarkNodes(child);
      return [child];
    }) as Parent["children"];
  }
}

function remarkMathAtlasSyntax() {
  return (tree: Root) => visitRemarkNodes(tree);
}

function isHastElement(node: HastParent["children"][number]): node is HastElement {
  return node.type === "element";
}

function elementClasses(node: HastElement) {
  const value: unknown = node.properties?.className;
  return Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
}

function offsetOf(
  point: { offset?: number } | undefined,
): number | undefined {
  return typeof point?.offset === "number" ? point.offset : undefined;
}

function trimDisplayLineBreaks(
  markdown: string,
  from: number,
  to: number,
) {
  const interior = markdown.slice(from, to);
  const openingLine = interior.match(/^[\t ]*(?:\r\n|\n|\r)/);
  if (!openingLine) return undefined;

  const bodyFrom = from + openingLine[0].length;
  if (bodyFrom === to) return { bodyFrom, bodyTo: to };

  const beforeClosingLine = markdown.slice(bodyFrom, to);
  const closingLine = beforeClosingLine.match(/(?:\r\n|\n|\r)[\t ]*$/);
  if (!closingLine) return undefined;

  return {
    bodyFrom,
    bodyTo: to - closingLine[0].length,
  };
}

function dollarRunFromStart(value: string) {
  let length = 0;
  while (value[length] === "$") length += 1;
  return length;
}

function dollarRunFromEnd(value: string) {
  let length = 0;
  while (value[value.length - length - 1] === "$") length += 1;
  return length;
}

function hasNestedMarkdownContainer(ancestors: readonly HastElement[]) {
  return ancestors.some(
    (ancestor) =>
      ancestor.tagName === "blockquote" ||
      ancestor.tagName === "li" ||
      elementClasses(ancestor).includes("math-environment"),
  );
}

function exactMathTarget(
  markdown: string,
  start: number | undefined,
  end: number | undefined,
  mathClass: "math-display" | "math-inline",
  nested: boolean,
): MarkdownEditTarget | undefined {
  if (
    start === undefined ||
    end === undefined ||
    start < 0 ||
    end > markdown.length ||
    end <= start
  ) {
    return undefined;
  }

  const raw = markdown.slice(start, end);
  const openingRun = dollarRunFromStart(raw);
  const closingRun = dollarRunFromEnd(raw);

  // remark-math accepts arbitrarily long matching runs. The compact editor only
  // understands conventional $ and $$ delimiters, so never trim a subset of a
  // longer run and accidentally expose the remaining dollars as LaTeX.
  if (
    openingRun !== closingRun ||
    (openingRun !== 1 && openingRun !== 2) ||
    raw.length < openingRun * 2 ||
    (mathClass === "math-display" && openingRun !== 2)
  ) {
    return undefined;
  }

  const delimiter = openingRun === 2 ? "$$" : "$";
  const display = mathClass === "math-display" || delimiter === "$$";
  let bodyFrom = start + openingRun;
  let bodyTo = end - closingRun;
  const multiline = /[\r\n]/.test(raw);

  // Container markers such as `> ` and list indentation are removed from the
  // parsed math value but are non-contiguous in the original source. Editing
  // that apparent body as one LaTeX range would write those markers into the
  // formula or remove structure from the surrounding Markdown.
  if (multiline && nested) return undefined;

  if (display && multiline) {
    const trimmed = trimDisplayLineBreaks(markdown, bodyFrom, bodyTo);
    if (!trimmed) return undefined;
    bodyFrom = trimmed.bodyFrom;
    bodyTo = trimmed.bodyTo;
  }

  if (bodyFrom > bodyTo) return undefined;
  return {
    kind: display ? "display-math" : "inline-math",
    from: bodyFrom,
    to: bodyTo,
    delimiter,
  };
}

function flowMathCode(element: HastElement): HastElement | undefined {
  if (element.tagName !== "pre") return undefined;
  return element.children.find(
    (child): child is HastElement =>
      isHastElement(child) &&
      elementClasses(child).includes("math-display"),
  );
}

function rehypeEditableMath(options: {
  markdown: string;
  editable: boolean;
  activeTarget?: MarkdownEditTarget;
}) {
  const { markdown, editable, activeTarget } = options;

  return (tree: HastRoot) => {
    const markTopLevelBlock = (element: HastElement) => {
      if (!editable) return element;
      const start = offsetOf(element.position?.start);
      const end = offsetOf(element.position?.end);
      if (start === undefined || end === undefined || end < start) return element;
      element.properties = {
        ...element.properties,
        "data-source-kind": "block",
        "data-source-from": String(start),
        "data-source-to": String(end),
      };
      return element;
    };

    const wrapMath = (
      renderedElement: HastElement,
      mathElement: HastElement,
      mathClass: "math-display" | "math-inline",
      sourceElement: HastElement,
      ancestors: readonly HastElement[],
    ): HastElement => {
      const start = offsetOf(sourceElement.position?.start);
      const end = offsetOf(sourceElement.position?.end);
      const exactTarget = exactMathTarget(
        markdown,
        start,
        end,
        mathClass,
        hasNestedMarkdownContainer(ancestors),
      );
      const target: MarkdownEditTarget = exactTarget ?? {
        kind: "block",
        from: 0,
        to: markdown.length,
      };
      const display =
        mathClass === "math-display" || exactTarget?.delimiter === "$$";
      const active = Boolean(
        activeTarget &&
        activeTarget.kind === target.kind &&
        activeTarget.from === target.from &&
        activeTarget.to === target.to,
      );

      if (display && mathClass !== "math-display") {
        const classes = elementClasses(mathElement);
        mathElement.properties = {
          ...mathElement.properties,
          className: classes
            .filter((className) => className !== "math-inline")
            .concat("math-display"),
        };
      }

      return {
        type: "element",
        // Flow math wraps a <pre>, while one-line $$ can originate inside a
        // paragraph and must remain phrasing-content-safe.
        tagName: renderedElement.tagName === "pre" ? "div" : "span",
        properties: {
          className: [
            "editable-math",
            display ? "editable-math--display" : "editable-math--inline",
            exactTarget ? "" : "editable-math--block-fallback",
            active ? "is-active-edit-target" : "",
          ].filter(Boolean),
          ...(editable
            ? {
                role: "button",
                tabIndex: 0,
                "aria-label": exactTarget
                  ? `Edit ${display ? "display" : "inline"} LaTeX formula`
                  : "Edit containing Markdown block",
                "data-source-kind": target.kind,
                "data-source-from": String(target.from),
                "data-source-to": String(target.to),
                ...(target.delimiter
                  ? { "data-source-delimiter": target.delimiter }
                  : {}),
              }
            : {}),
        },
        children: [renderedElement],
        position: sourceElement.position,
      };
    };

    const visit = (
      parent: HastParent,
      ancestors: readonly HastElement[] = [],
    ) => {
      parent.children = parent.children.map((child) => {
        if (!isHastElement(child)) return child;

        const classes = elementClasses(child);
        const mathClass = classes.includes("math-display")
          ? "math-display"
          : classes.includes("math-inline")
            ? "math-inline"
            : undefined;
        if (mathClass) {
          return wrapMath(child, child, mathClass, child, ancestors);
        }

        const flowCode = flowMathCode(child);
        if (flowCode) {
          // In read-only views, leave the conventional <pre><code> structure
          // intact so rehype-katex can replace it normally.
          return editable
            ? wrapMath(child, flowCode, "math-display", child, ancestors)
            : child;
        }

        if ("children" in child) visit(child, [...ancestors, child]);
        return ancestors.length === 0 ? markTopLevelBlock(child) : child;
      });
    };

    visit(tree);
  };
}

const remarkPlugins = [remarkGfm, remarkMath, remarkMathAtlasSyntax];

function targetFromElement(element: HTMLElement): MarkdownEditTarget | undefined {
  const kind = element.dataset.sourceKind as MarkdownEditTargetKind | undefined;
  const from = Number(element.dataset.sourceFrom);
  const to = Number(element.dataset.sourceTo);
  if (
    kind !== "block" &&
    kind !== "inline-math" &&
    kind !== "display-math"
  ) {
    return undefined;
  }
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to < from
  ) {
    return undefined;
  }
  const delimiter = element.dataset.sourceDelimiter;
  if (
    kind !== "block" &&
    delimiter !== "$" &&
    delimiter !== "$$"
  ) {
    return undefined;
  }
  return {
    kind,
    from,
    to,
    ...(delimiter === "$" || delimiter === "$$" ? { delimiter } : {}),
  };
}

function MarkdownViewComponent({
  markdown,
  contentPath,
  compact = false,
  editable = false,
  activeTarget,
  onActivateTarget,
  wikiLinkIndex,
  onNavigateWikiLink,
}: MarkdownViewProps) {
  const renderedMarkdown = useMemo(
    () => hideObsidianCommentsForRender(markdown),
    [markdown],
  );
  const rehypePlugins = useMemo(
    () =>
      [[rehypeEditableMath, { markdown, editable, activeTarget }], rehypeKatex] as Pluggable[],
    [activeTarget, editable, markdown],
  );
  const ratioAtPoint = useCallback((event: MouseEvent, host: Element) => {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return 1;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(0.999, (event.clientY - rect.top) / rect.height));
    const style = globalThis.getComputedStyle?.(host);
    const parsedLineHeight = Number.parseFloat(style?.lineHeight || "");
    const parsedFontSize = Number.parseFloat(style?.fontSize || "");
    const fontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : 16;
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.5;
    const lines = Math.max(1, Math.round(rect.height / Math.max(1, lineHeight)));
    return Math.max(0, Math.min(1, (Math.floor(y * lines) + x) / lines));
  }, []);
  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!editable || !onActivateTarget) return;
      const selection = globalThis.getSelection?.();
      if (selection && !selection.isCollapsed && selection.toString()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("a, button, input, select, textarea")) return;

      const math = target.closest<HTMLElement>("[data-source-kind]");
      const editTarget = math ? targetFromElement(math) : undefined;
      if (editTarget && math) {
        const formulaSource = editTarget.kind === "inline-math" ||
            editTarget.kind === "display-math"
          ? markdown.slice(editTarget.from, editTarget.to)
          : undefined;
        const mathBounds = math.getBoundingClientRect();
        const cursorRatio = formulaSource === undefined
          ? ratioAtPoint(
              event,
              mathBounds.width && mathBounds.height ? math : event.currentTarget,
            )
          : formulaSourceRatioAtPoint(
              formulaSource,
              math,
              event.clientX,
              event.clientY,
            );
        onActivateTarget({ ...editTarget, cursorRatio });
      } else {
        onActivateTarget({
          kind: "block",
          from: 0,
          to: markdown.length,
          cursorRatio: ratioAtPoint(event, event.currentTarget),
        });
      }
    },
    [editable, markdown.length, onActivateTarget, ratioAtPoint],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!editable || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const math = target.closest<HTMLElement>("[data-source-kind]");
      if (!math || !event.currentTarget.contains(math)) return;
      const editTarget = targetFromElement(math);
      if (!editTarget) return;
      event.preventDefault();
      onActivateTarget?.(editTarget);
    },
    [editable, onActivateTarget],
  );

  return (
    <div
      className={[
        "markdown-view",
        compact ? "markdown-view--compact" : "",
        editable ? "markdown-view--editable" : "",
        activeTarget ? "has-active-source" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        skipHtml
        urlTransform={(url) => url.startsWith("math-atlas-wiki:") ? url : defaultUrlTransform(url)}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            const target = wikiLinkTargetFromHref(href);
            if (target === undefined) return <a href={href} {...props}>{children}</a>;
            const resolution = resolveWikiLink(wikiLinkIndex, target, contentPath);
            const resolved = resolution.status === "resolved" ? resolution.note : undefined;
            const title = resolution.status === "resolved"
              ? `Open ${resolution.note.path}`
              : resolution.status === "ambiguous"
                ? `Ambiguous note: ${resolution.candidates.map(({ path }) => path).join(" · ")}`
                : `Note not found: ${target}`;
            return (
              <a
                {...props}
                href={resolved ? `#note=${encodeURIComponent(resolved.path)}` : "#"}
                className={`wiki-link wiki-link--${resolution.status}`}
                data-wiki-target={target}
                data-wiki-path={resolved?.path}
                aria-disabled={resolved ? undefined : true}
                title={title}
                onClick={(event) => {
                  event.preventDefault();
                  if (resolved) onNavigateWikiLink?.(resolved.path);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ node: _node, ...props }) => (
            <ManagedMarkdownImage {...props} notePath={contentPath} />
          ),
        }}
      >
        {renderedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownView = memo(MarkdownViewComponent);
