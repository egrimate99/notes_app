export function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    "input, textarea, select, .cm-editor, .cm-content, [contenteditable]:not([contenteditable='false'])",
  )) || target instanceof HTMLElement && (
    target.isContentEditable || target.contentEditable === "true" || target.contentEditable === "plaintext-only"
  );
}
