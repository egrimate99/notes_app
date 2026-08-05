export type MathEditorTemplate =
  | "inline-math"
  | "display-math"
  | "definition"
  | "example"
  | "theorem"
  | "proposition"
  | "lemma";

export type MathEnvironmentTemplate = Exclude<
  MathEditorTemplate,
  "inline-math" | "display-math"
>;

export interface EditorInsertion {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

function preferredLineBreak(document: string) {
  return document.includes("\r\n") ? "\r\n" : "\n";
}

function boundaryBefore(document: string, from: number, lineBreak: string) {
  const before = document.slice(0, from);
  if (!before || before.endsWith(`${lineBreak}${lineBreak}`)) return "";
  return before.endsWith(lineBreak) ? lineBreak : `${lineBreak}${lineBreak}`;
}

function boundaryAfter(document: string, to: number, lineBreak: string) {
  const after = document.slice(to);
  if (!after || after.startsWith(`${lineBreak}${lineBreak}`)) return "";
  return after.startsWith(lineBreak) ? lineBreak : `${lineBreak}${lineBreak}`;
}

function createEnvironmentInsertion(
  document: string,
  from: number,
  to: number,
  environment: MathEnvironmentTemplate,
): EditorInsertion {
  const lineBreak = preferredLineBreak(document);
  const before = boundaryBefore(document, from, lineBreak);
  const after = boundaryAfter(document, to, lineBreak);
  const selected = document.slice(from, to);
  const quotedSelection = selected.replace(/\r\n|\r|\n/g, `${lineBreak}> `);
  const prefix = `${before}> [!${environment}]${lineBreak}> `;
  const insert = `${prefix}${quotedSelection}${after}`;
  const selectionStart = from + prefix.length;

  return {
    from,
    to,
    insert,
    anchor: selectionStart,
    head: selectionStart + quotedSelection.length,
  };
}

export function createEditorInsertion(
  document: string,
  from: number,
  to: number,
  template: MathEditorTemplate,
): EditorInsertion {
  const selected = document.slice(from, to);
  let prefix = "";
  let suffix = "";

  if (template === "inline-math") {
    prefix = "$";
    suffix = "$";
  } else if (template === "display-math") {
    prefix = "$$\n";
    suffix = "\n$$";
  } else {
    return createEnvironmentInsertion(document, from, to, template);
  }

  const content = selected;
  const insert = `${prefix}${content}${suffix}`;
  const selectionStart = from + prefix.length;

  return {
    from,
    to,
    insert,
    anchor: selectionStart,
    head: selectionStart + content.length,
  };
}
