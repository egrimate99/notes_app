import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  highlightSelectionMatches,
  searchKeymap,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  createEditorInsertion,
  type MathEditorTemplate,
} from "./editorTransforms";
import "./NoteEditor.css";

export type NoteEditorSaveReason =
  | "debounce"
  | "shortcut"
  | "blur"
  | "switch"
  | "done"
  | "unmount";

export type NoteEditorSaveStatus =
  | "saved"
  | "dirty"
  | "saving"
  | "error";

export interface NoteEditorProps {
  noteId: string;
  initialMarkdown: string;
  onSave: (
    markdown: string,
    reason: NoteEditorSaveReason,
  ) => void | Promise<void>;
  onDone?: () => void;
  saveStatus?: NoteEditorSaveStatus;
  onSaveStatusChange?: (status: NoteEditorSaveStatus) => void;
  debounceMs?: number;
  autoFocus?: boolean;
  ariaLabel?: string;
}

export interface NoteEditorHandle {
  focus: () => void;
  getMarkdown: () => string;
  replaceSelection: (text: string) => void;
  applyTemplate: (template: MathEditorTemplate) => void;
  save: (reason?: NoteEditorSaveReason) => Promise<boolean>;
}

interface SavedEditorView {
  anchor: number;
  head: number;
  scrollTop: number;
}

const statusLabels: Record<NoteEditorSaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  error: "Save failed",
};

const latexCompletions = [
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
  "underbrace",
  "overbrace",
  "hat",
  "bar",
  "tilde",
  "top",
  "perp",
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

export function latexCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const command = context.matchBefore(/\\[A-Za-z]*$/);
  if (!command || (command.from === command.to && !context.explicit)) {
    return null;
  }

  return {
    from: command.from,
    options: latexCompletions,
    validFor: /\\[A-Za-z]*$/,
  };
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "#292822",
    backgroundColor: "#fffefa",
    fontSize: "15px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: "1.72",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "22px 24px 64px",
    caretColor: "#2e6d68",
  },
  ".cm-line": {
    paddingLeft: "3px",
    paddingRight: "3px",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(66, 113, 108, 0.055)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(69, 126, 120, 0.2) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#2e6d68",
  },
  ".cm-tooltip-autocomplete": {
    border: "1px solid #d8d5cb",
    borderRadius: "5px",
    boxShadow: "0 12px 30px rgba(34, 33, 29, 0.14)",
    overflow: "hidden",
  },
  ".cm-panels": {
    color: "#302f2a",
    backgroundColor: "#f4f2eb",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(217, 156, 64, 0.24)",
    outline: "1px solid rgba(171, 112, 24, 0.3)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(74, 126, 120, 0.24)",
  },
});

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  function NoteEditor(
    {
      noteId,
      initialMarkdown,
      onSave,
      onDone,
      saveStatus,
      onSaveStatusChange,
      debounceMs = 650,
      autoFocus = false,
      ariaLabel = "Markdown and LaTeX note editor",
    },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const statusRef = useRef<HTMLSpanElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const noteIdRef = useRef(noteId);
    const onSaveRef = useRef(onSave);
    const onDoneRef = useRef(onDone);
    const onStatusChangeRef = useRef(onSaveStatusChange);
    const debounceMsRef = useRef(debounceMs);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const completedMarkdownRef = useRef(initialMarkdown);
    const pendingSaveRef = useRef<{
      markdown: string;
      revision: number;
      promise: Promise<boolean>;
    } | null>(null);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const saveRevisionRef = useRef(0);
    const currentStatusRef = useRef<NoteEditorSaveStatus>(
      saveStatus ?? "saved",
    );
    const savedViewsRef = useRef(new Map<string, SavedEditorView>());
    const extensionsRef = useRef<ReturnType<typeof createExtensions> | null>(
      null,
    );

    onSaveRef.current = onSave;
    onDoneRef.current = onDone;
    onStatusChangeRef.current = onSaveStatusChange;
    debounceMsRef.current = debounceMs;

    const setStatus = useCallback(
      (status: NoteEditorSaveStatus, notify = true) => {
        const changed = currentStatusRef.current !== status;
        currentStatusRef.current = status;
        if (statusRef.current) {
          statusRef.current.textContent = statusLabels[status];
          statusRef.current.dataset.status = status;
        }
        if (notify && changed) onStatusChangeRef.current?.(status);
      },
      [],
    );

    const clearSaveTimer = useCallback(() => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const flushSave = useCallback(
      (reason: NoteEditorSaveReason): Promise<boolean> => {
        clearSaveTimer();
        const view = viewRef.current;
        if (!view) return Promise.resolve(true);

        const markdown = view.state.doc.toString();
        if (markdown === completedMarkdownRef.current) {
          setStatus("saved");
          return Promise.resolve(true);
        }
        if (pendingSaveRef.current?.markdown === markdown) {
          return pendingSaveRef.current.promise;
        }

        const revision = saveRevisionRef.current + 1;
        saveRevisionRef.current = revision;
        setStatus("saving");

        const saveOperation = saveQueueRef.current.then(() =>
          onSaveRef.current(markdown, reason),
        );
        const promise = saveOperation
          .then(() => {
            completedMarkdownRef.current = markdown;
            if (saveRevisionRef.current === revision) {
              const currentMarkdown = viewRef.current?.state.doc.toString();
              setStatus(currentMarkdown === markdown ? "saved" : "dirty");
            }
            return true;
          })
          .catch(() => {
            if (saveRevisionRef.current === revision) setStatus("error");
            return false;
          })
          .finally(() => {
            if (pendingSaveRef.current?.revision === revision) {
              pendingSaveRef.current = null;
            }
          });

        saveQueueRef.current = promise.then(() => undefined);
        pendingSaveRef.current = { markdown, revision, promise };
        return promise;
      },
      [clearSaveTimer, setStatus],
    );

    const scheduleSave = useCallback(() => {
      clearSaveTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushSave("debounce");
      }, debounceMsRef.current);
    }, [clearSaveTimer, flushSave]);

    const applyTemplate = useCallback((template: MathEditorTemplate) => {
      const view = viewRef.current;
      if (!view) return;
      const selection = view.state.selection.main;
      const insertion = createEditorInsertion(
        view.state.doc.toString(),
        selection.from,
        selection.to,
        template,
      );
      view.dispatch({
        changes: {
          from: insertion.from,
          to: insertion.to,
          insert: insertion.insert,
        },
        selection: { anchor: insertion.anchor, head: insertion.head },
        scrollIntoView: true,
      });
      view.focus();
    }, []);

    const finishEditing = useCallback(() => {
      void flushSave("done").then((saved) => {
        if (saved) onDoneRef.current?.();
      });
    }, [flushSave]);

    function createExtensions() {
      return [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          activateOnTyping: true,
          override: [latexCompletionSource],
        }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        markdown(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          spellcheck: "true",
        }),
        EditorView.domEventHandlers({
          blur: () => {
            void flushSave("blur");
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          setStatus("dirty");
          scheduleSave();
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void flushSave("shortcut");
              return true;
            },
          },
          {
            key: "Mod-e",
            preventDefault: true,
            run: () => {
              finishEditing();
              return true;
            },
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        editorTheme,
      ];
    }

    useLayoutEffect(() => {
      if (!hostRef.current) return;
      extensionsRef.current = createExtensions();
      const state = EditorState.create({
        doc: initialMarkdown,
        extensions: extensionsRef.current,
      });
      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      if (autoFocus) view.focus();

      return () => {
        clearSaveTimer();
        void flushSave("unmount");
        view.destroy();
        viewRef.current = null;
      };
      // The editor is intentionally constructed only once; note changes use
      // setState below so React never owns the keystroke hot path.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (noteIdRef.current === noteId) return;
      const view = viewRef.current;
      const extensions = extensionsRef.current;
      if (!view || !extensions) return;

      const previousSelection = view.state.selection.main;
      savedViewsRef.current.set(noteIdRef.current, {
        anchor: previousSelection.anchor,
        head: previousSelection.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      void flushSave("switch");

      noteIdRef.current = noteId;
      completedMarkdownRef.current = initialMarkdown;
      pendingSaveRef.current = null;
      const savedView = savedViewsRef.current.get(noteId);
      const documentLength = initialMarkdown.length;
      const anchor = Math.min(savedView?.anchor ?? 0, documentLength);
      const head = Math.min(savedView?.head ?? anchor, documentLength);
      view.setState(
        EditorState.create({
          doc: initialMarkdown,
          selection: { anchor, head },
          extensions,
        }),
      );
      view.scrollDOM.scrollTop = savedView?.scrollTop ?? 0;
      setStatus(saveStatus ?? "saved");
    }, [initialMarkdown, noteId, saveStatus, setStatus, flushSave]);

    useEffect(() => {
      if (saveStatus) setStatus(saveStatus, false);
    }, [saveStatus, setStatus]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => viewRef.current?.focus(),
        getMarkdown: () => viewRef.current?.state.doc.toString() ?? "",
        replaceSelection: (text: string) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch(view.state.replaceSelection(text));
          view.focus();
        },
        applyTemplate,
        save: (reason = "shortcut") => flushSave(reason),
      }),
      [applyTemplate, flushSave],
    );

    const keepEditorFocused = (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
    };

    return (
      <section className="note-editor" data-note-id={noteId}>
        <div className="note-editor__toolbar" role="toolbar" aria-label="Note formatting">
          <div className="note-editor__format-actions">
            <button
              type="button"
              onPointerDown={keepEditorFocused}
              onClick={() => applyTemplate("inline-math")}
              title="Inline math ($…$)"
            >
              $x$
            </button>
            <button
              type="button"
              onPointerDown={keepEditorFocused}
              onClick={() => applyTemplate("display-math")}
              title="Display math ($$…$$)"
            >
              $$
            </button>
            <button
              type="button"
              onPointerDown={keepEditorFocused}
              onClick={() => applyTemplate("definition")}
            >
              Definition
            </button>
            <button
              type="button"
              onPointerDown={keepEditorFocused}
              onClick={() => applyTemplate("theorem")}
              title="Insert a theorem block"
            >
              Theorem
            </button>
          </div>

          <div className="note-editor__save-actions">
            <span
              ref={statusRef}
              className="note-editor__status"
              data-status={currentStatusRef.current}
              role="status"
              aria-live="polite"
            >
              {statusLabels[currentStatusRef.current]}
            </span>
            <button
              type="button"
              className="note-editor__done"
              onPointerDown={keepEditorFocused}
              onClick={finishEditing}
              title="Save and finish editing (Ctrl+E)"
            >
              Done
            </button>
          </div>
        </div>
        <div ref={hostRef} className="note-editor__surface" />
      </section>
    );
  },
);
