import { FileWarning, PanelRightClose } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useRef } from "react";
import type { Landmark } from "../domain/types";
import { mathNoteType } from "../domain/landmarkDisplay";
import type { WikiLinkIndex } from "../domain/wikiLinks";
import type { LiveNoteEditorSafety } from "./LiveNoteEditor";

const MarkdownView = lazy(() =>
  import("./MarkdownView").then((module) => ({ default: module.MarkdownView })),
);

const LiveNoteEditor = lazy(() =>
  import("./LiveNoteEditor").then((module) => ({
    default: module.LiveNoteEditor,
  })),
);

function MarkdownSkeleton({ label = "Rendering mathematical note" }) {
  return (
    <div className="markdown-skeleton" aria-label={label}>
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

interface InspectorPanelProps {
  landmark?: Landmark;
  title?: string;
  contentPath?: string;
  markdown?: string;
  loading?: boolean;
  errorMessage?: string;
  editable?: boolean;
  onSave?: (markdown: string) => void | Promise<void>;
  wikiLinkIndex?: WikiLinkIndex;
  onNavigateWikiLink?: (path: string) => void;
  onCollapse?: () => void;
  onEditorSafetyChange?: (safety: LiveNoteEditorSafety) => void;
  /** Start a just-created body directly in the live-preview caret. */
  initialEditAtEnd?: boolean;
}

export const InspectorPanel = memo(function InspectorPanel({
  landmark,
  title,
  contentPath,
  markdown,
  loading = false,
  errorMessage,
  editable = false,
  onSave,
  wikiLinkIndex,
  onNavigateWikiLink,
  onCollapse,
  onEditorSafetyChange,
  initialEditAtEnd = false,
}: InspectorPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fallbackMarkdown =
    landmark?.markdown || landmark?.statement || landmark?.summary || "";
  const suppliedMarkdown = markdown ?? fallbackMarkdown;
  const canEdit = Boolean(editable && contentPath && onSave && !loading);
  const reportEditorSafety = useCallback((safety: LiveNoteEditorSafety) => {
    onEditorSafetyChange?.(safety);
  }, [onEditorSafetyChange]);
  const saveMarkdown = useCallback(
    async (nextMarkdown: string) => {
      if (!onSave) return;
      await onSave(nextMarkdown);
    },
    [onSave],
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [contentPath]);

  if (!landmark && !contentPath) {
    return (
      <aside className="inspector-panel inspector-panel--empty">
        {onCollapse && (
          <button className="panel-hide panel-hide--right" type="button" aria-label="Hide note sidebar" onClick={onCollapse}>
            <PanelRightClose size={14} aria-hidden="true" />
          </button>
        )}
        <p>Select a note on the map or in the file tree.</p>
      </aside>
    );
  }

  const displayTitle = title || landmark?.title || "Untitled";
  const isInformalNote = landmark ? mathNoteType(landmark.kind) === "note" : false;

  return (
    <aside className="inspector-panel" data-testid="inspector-panel">
      <div ref={scrollRef} className="inspector-scroll">
        <header className={`inspector-header${isInformalNote ? " inspector-header--titleless" : ""}`}>
          {!isInformalNote && <h2 title={contentPath}>{displayTitle}</h2>}
          {onCollapse && (
            <button className="panel-hide panel-hide--right" type="button" aria-label="Hide note sidebar" onClick={onCollapse}>
              <PanelRightClose size={14} aria-hidden="true" />
            </button>
          )}
        </header>

        {errorMessage && (
          <div className="inspector-file-error" role="status">
            <FileWarning size={14} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {loading ? (
          <MarkdownSkeleton label="Loading Markdown file" />
        ) : canEdit && contentPath ? (
          <Suspense fallback={<MarkdownSkeleton label="Opening live note editor" />}>
            <LiveNoteEditor
              key={contentPath}
              noteId={contentPath}
              markdown={suppliedMarkdown}
              onSave={saveMarkdown}
              wikiLinkIndex={wikiLinkIndex}
              onNavigateWikiLink={onNavigateWikiLink}
              onRefreshSafetyChange={reportEditorSafety}
              initialEditAtEnd={initialEditAtEnd}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<MarkdownSkeleton />}>
            <MarkdownView
              markdown={suppliedMarkdown}
              contentPath={contentPath}
              wikiLinkIndex={wikiLinkIndex}
              onNavigateWikiLink={onNavigateWikiLink}
            />
          </Suspense>
        )}
      </div>
    </aside>
  );
});
