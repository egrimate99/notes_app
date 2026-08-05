import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Landmark } from "../domain/types";
import { mathNoteType } from "../domain/landmarkDisplay";
import { repositoryPath } from "../domain/contentPaths";
import type { LandmarkContentMode } from "../state/mapCustomizationStore";
import { noteRepository } from "../services/noteRepository";
import { selectedLandmarkFormula } from "./landmarkFormulaPreview";
import { MarkdownView } from "./MarkdownView";

const noteCache = new Map<string, string>();
const noteRequests = new Map<string, Promise<string>>();
const NOTE_CACHE_LIMIT = 256;

function cacheNote(path: string, markdown: string) {
  noteCache.delete(path);
  noteCache.set(path, markdown);
  if (noteCache.size <= NOTE_CACHE_LIMIT) return;
  const oldest = noteCache.keys().next().value;
  if (oldest) noteCache.delete(oldest);
}

function noteMarkdown(path: string) {
  const cached = noteCache.get(path);
  if (cached !== undefined) {
    cacheNote(path, cached);
    return Promise.resolve(cached);
  }
  const pending = noteRequests.get(path);
  if (pending) return pending;
  const request = noteRepository.readNote(path).then((document) => {
    cacheNote(path, document.markdown);
    noteRequests.delete(path);
    return document.markdown;
  }).catch((error: unknown) => {
    noteRequests.delete(path);
    throw error;
  });
  noteRequests.set(path, request);
  return request;
}

function withoutDocumentChrome(markdown: string) {
  return markdown
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/, "")
    .replace(/^\s*#\s+[^\r\n]+(?:\r?\n)+/, "")
    .trim();
}

const FRONTMATTER_PREFIX = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Informal Notes keep their stable canvas identity in YAML, but that metadata
 * is not part of the paper the user writes on. Keep it completely outside the
 * direct editor while preserving it byte-for-byte on save.
 */
export function directNoteBody(markdown: string) {
  const frontmatter = markdown.match(FRONTMATTER_PREFIX)?.[0];
  return frontmatter ? markdown.slice(frontmatter.length) : markdown;
}

function noteExcerpt(markdown: string) {
  const source = withoutDocumentChrome(markdown);
  if (source.length <= 820) return source;
  const blocks = source.split(/\r?\n\s*\r?\n/);
  let result = "";
  for (const block of blocks) {
    const candidate = result ? `${result}\n\n${block}` : block;
    if (candidate.length > 820 && result) break;
    result = candidate;
    if (result.length >= 520) break;
  }
  return result || source.slice(0, 820);
}

function statementExcerpt(landmark: Landmark, markdown: string) {
  if (landmark.statement?.trim()) return landmark.statement.trim();
  if (landmark.summary?.trim()) return landmark.summary.trim();
  const source = withoutDocumentChrome(markdown);
  return source.split(/\r?\n\s*\r?\n/, 1)[0]?.slice(0, 620).trim();
}

export function landmarkPreviewMarkdown(
  landmark: Landmark,
  mode: Exclude<LandmarkContentMode, "title">,
  markdown: string,
  formulaIndex = 0,
) {
  if (mode === "formula") {
    return selectedLandmarkFormula(markdown, formulaIndex) ??
      selectedLandmarkFormula(landmark.statement ?? "", formulaIndex) ??
      statementExcerpt(landmark, markdown) ?? landmark.title;
  }
  if (mode === "statement") {
    return statementExcerpt(landmark, markdown) ?? landmark.title;
  }
  const excerpt = noteExcerpt(markdown);
  if (mathNoteType(landmark.kind) === "note") return excerpt;
  return excerpt || statementExcerpt(landmark, markdown) || landmark.title;
}

function LandmarkPreviewContentComponent({
  landmark,
  mode,
  formulaIndex = 0,
  previewMarkdown,
  autoEdit = false,
  onBeginNoteEdit,
  onSaveNote,
}: {
  landmark: Landmark;
  mode: Exclude<LandmarkContentMode, "title">;
  formulaIndex?: number;
  previewMarkdown?: string;
  autoEdit?: boolean;
  onBeginNoteEdit?: (landmark: Landmark) => void;
  onSaveNote?: (landmark: Landmark, markdown: string) => Promise<void>;
}) {
  const path = repositoryPath(landmark.contentPath ?? landmark.importedPath);
  const initialMarkdown = previewMarkdown ?? landmark.markdown;
  const initialBody = directNoteBody(initialMarkdown);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [loaded, setLoaded] = useState(previewMarkdown !== undefined || !path);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialBody);
  const [saveError, setSaveError] = useState<string>();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(editing);
  const requestedEditRef = useRef(false);
  const autoEditHandledRef = useRef(false);
  const latestDraftRef = useRef(initialBody);
  const lastSavedRef = useRef<string | undefined>(initialBody);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushDraftOnUnmountRef = useRef<(body: string) => void>(() => undefined);
  editingRef.current = editing;

  const canEditOnPaper = mode === "note" &&
    mathNoteType(landmark.kind) === "note" && Boolean(onSaveNote);

  useEffect(() => {
    const body = directNoteBody(initialMarkdown);
    setMarkdown(initialMarkdown);
    if (!editingRef.current) {
      latestDraftRef.current = body;
      lastSavedRef.current = body;
      setDraft(body);
    }
    setLoaded(previewMarkdown !== undefined || !path);
    if (!path) return;
    if (previewMarkdown !== undefined) cacheNote(path, previewMarkdown);
    let live = true;
    void noteMarkdown(path).then((source) => {
      if (!live) return;
      const body = directNoteBody(source);
      setMarkdown(source);
      setLoaded(true);
      if (!editingRef.current) {
        latestDraftRef.current = body;
        lastSavedRef.current = body;
        setDraft(body);
      }
      if (requestedEditRef.current) {
        requestedEditRef.current = false;
        setEditing(true);
      }
    }).catch(() => undefined);
    const handleSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; markdown?: string }>).detail;
      if (detail?.path !== path || typeof detail.markdown !== "string") return;
      cacheNote(path, detail.markdown);
      setMarkdown(detail.markdown);
      lastSavedRef.current = directNoteBody(detail.markdown);
      if (!editingRef.current) {
        const body = directNoteBody(detail.markdown);
        latestDraftRef.current = body;
        setDraft(body);
      }
    };
    window.addEventListener("math-atlas:note-saved", handleSaved);
    return () => {
      live = false;
      window.removeEventListener("math-atlas:note-saved", handleSaved);
    };
  }, [initialMarkdown, path, previewMarkdown]);

  const persistDraft = useCallback((body: string) => {
    if (!onSaveNote) return Promise.resolve();
    if (body === lastSavedRef.current) return Promise.resolve();
    lastSavedRef.current = body;
    if (path) cacheNote(path, body);
    setMarkdown(body);
    setSaveError(undefined);
    return Promise.resolve(onSaveNote(landmark, body)).catch((error: unknown) => {
      if (lastSavedRef.current === body) lastSavedRef.current = undefined;
      setSaveError(error instanceof Error ? error.message : "The note could not be saved.");
    });
  }, [landmark, onSaveNote, path]);
  flushDraftOnUnmountRef.current = (body) => {
    if (!onSaveNote) return;
    if (body === lastSavedRef.current) return;
    lastSavedRef.current = body;
    if (path) cacheNote(path, body);
    void Promise.resolve(onSaveNote(landmark, body)).catch(() => undefined);
  };

  const scheduleSave = useCallback((source: string) => {
    if (saveTimerRef.current !== undefined) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined;
      void persistDraft(source);
    }, 280);
  }, [persistDraft]);

  const beginEditing = useCallback(() => {
    if (!canEditOnPaper || editingRef.current) return;
    onBeginNoteEdit?.(landmark);
    setSaveError(undefined);
    if (!loaded) {
      requestedEditRef.current = true;
      return;
    }
    const body = directNoteBody(markdown);
    latestDraftRef.current = body;
    setDraft(body);
    setEditing(true);
  }, [canEditOnPaper, landmark, loaded, markdown, onBeginNoteEdit]);

  const finishEditing = useCallback(() => {
    if (!editingRef.current) return;
    if (saveTimerRef.current !== undefined) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    const body = latestDraftRef.current;
    if (path) cacheNote(path, body);
    setMarkdown(body);
    setEditing(false);
    void persistDraft(body);
  }, [path, persistDraft]);

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    if (!autoEdit) {
      autoEditHandledRef.current = false;
      return;
    }
    if (autoEditHandledRef.current || editing || !loaded || !canEditOnPaper) return;
    autoEditHandledRef.current = true;
    beginEditing();
  }, [autoEdit, beginEditing, canEditOnPaper, editing, loaded]);

  useEffect(() => () => {
    if (saveTimerRef.current !== undefined) clearTimeout(saveTimerRef.current);
    // A node can unmount before blur (for example when it is removed from the
    // canvas). Never discard the last sub-debounce keystrokes.
    if (editingRef.current) flushDraftOnUnmountRef.current(latestDraftRef.current);
  }, []);

  const preview = useMemo(
    () => landmarkPreviewMarkdown(landmark, mode, markdown, formulaIndex),
    [formulaIndex, landmark, markdown, mode],
  );

  if (canEditOnPaper) {
    if (editing) {
      return (
        <div className="landmark-node__inline-note is-editing nodrag nopan nowheel" data-save-error={saveError || undefined}>
          <textarea
            ref={editorRef}
            className="landmark-node__inline-note-editor nodrag nopan nowheel"
            aria-label="Edit note on canvas"
            value={draft}
            spellCheck
            onChange={(event) => {
              const source = event.currentTarget.value;
              latestDraftRef.current = source;
              setDraft(source);
              scheduleSave(source);
            }}
            onBlur={finishEditing}
            onPointerDown={(event: PointerEvent<HTMLTextAreaElement>) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
                event.preventDefault();
                if (saveTimerRef.current !== undefined) {
                  clearTimeout(saveTimerRef.current);
                  saveTimerRef.current = undefined;
                }
                void persistDraft(latestDraftRef.current);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
          />
          {saveError && <span className="landmark-node__inline-note-error" role="status" title={saveError}>!</span>}
        </div>
      );
    }
    return (
      <div
        className="landmark-node__inline-note nodrag nopan nowheel"
        role="textbox"
        aria-label="Edit note on canvas"
        aria-readonly="true"
        aria-busy={!loaded || undefined}
        tabIndex={0}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          beginEditing();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Enter" && event.key !== "F2") return;
          event.preventDefault();
          event.stopPropagation();
          beginEditing();
        }}
      >
        <div className="landmark-node__preview landmark-node__preview--note">
          <MarkdownView markdown={preview} contentPath={path} compact />
        </div>
      </div>
    );
  }

  return (
    <div className={`landmark-node__preview landmark-node__preview--${mode}`}>
      <MarkdownView markdown={preview} contentPath={path} compact />
    </div>
  );
}

export const LandmarkPreviewContent = memo(LandmarkPreviewContentComponent);
