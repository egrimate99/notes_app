import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import { latexCompletionSource } from "./NoteEditor";
import "./NoteEditor.css";

interface InlineSourceEditorProps {
  value: string;
  mode: "latex" | "markdown";
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  autoFocus?: boolean;
}

const inlineEditorTheme = EditorView.theme({
  "&": {
    width: "100%",
    maxHeight: "190px",
    color: "#292822",
    backgroundColor: "transparent",
    fontSize: "13px",
  },
  ".cm-scroller": {
    maxHeight: "190px",
    overflow: "auto",
    fontFamily:
      '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: "1.65",
  },
  ".cm-content": {
    minHeight: "38px",
    padding: "9px 10px 10px",
    caretColor: "#315f8f",
  },
  ".cm-line": { padding: "0" },
  ".cm-activeLine": { backgroundColor: "rgba(78, 127, 203, 0.055)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(78, 127, 203, 0.18) !important",
  },
  ".cm-cursor": { borderLeftColor: "#315f8f" },
  ".cm-gutters": { display: "none" },
  ".cm-tooltip-autocomplete": {
    border: "1px solid #cbc8bf",
    borderRadius: "6px",
    boxShadow: "0 14px 34px rgba(34, 33, 29, 0.16)",
    overflow: "hidden",
  },
});

export function InlineSourceEditor({
  value,
  mode,
  onChange,
  onSave,
  onClose,
  autoFocus = true,
}: InlineSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  const syncingRef = useRef(false);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          activateOnTyping: mode === "latex",
          override: mode === "latex" ? [latexCompletionSource] : undefined,
        }),
        highlightActiveLine(),
        mode === "markdown" ? markdown() : [],
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label":
            mode === "latex" ? "Edit LaTeX source" : "Edit Markdown block",
          spellcheck: mode === "latex" ? "false" : "true",
        }),
        EditorView.domEventHandlers({
          blur: () => {
            onSaveRef.current();
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || syncingRef.current) return;
          onChangeRef.current(update.state.doc.toString());
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          {
            key: "Mod-e",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              onCloseRef.current();
              return true;
            },
          },
          {
            key: "Escape",
            preventDefault: true,
            run: () => {
              onCloseRef.current();
              return true;
            },
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        inlineEditorTheme,
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The compact editor is intentionally reconstructed only when the target
    // changes; controlled value updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
    syncingRef.current = false;
  }, [value]);

  return <div ref={hostRef} className="inline-source-editor" />;
}
