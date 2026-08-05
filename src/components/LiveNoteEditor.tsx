import { CircleAlert, ImagePlus, LoaderCircle } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MarkdownView, type MarkdownEditTarget } from "./MarkdownView";
import {
  splitMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownBlockKind,
} from "./markdownBlocks";
import { markdownForManagedImage } from "../domain/assetPaths";
import { assetRepository } from "../services/assetRepository";
import type { LivePreviewBlockEditorHandle } from "./LivePreviewBlockEditor";
import type { WikiLinkIndex } from "../domain/wikiLinks";
import "./LiveNoteEditor.css";

const LivePreviewBlockEditor = lazy(() =>
  import("./LivePreviewBlockEditor").then((module) => ({
    default: module.LivePreviewBlockEditor,
  })),
);

export type LiveSaveStatus = "saved" | "dirty" | "saving" | "error";

export interface LiveNoteEditorSafety {
  noteId: string;
  canRefreshFromDisk: boolean;
  hasActiveEdit: boolean;
  saveStatus: LiveSaveStatus;
}

interface ActiveBlock {
  from: number;
  to: number;
  kind: MarkdownBlockKind;
  activation: number;
  cursorOffset: number;
}

function emptyEditingSession(activation = 1, offset = 0): ActiveBlock {
  return {
    from: offset,
    to: offset,
    kind: "paragraph",
    cursorOffset: 0,
    activation,
  };
}

interface LiveNoteEditorProps {
  noteId: string;
  markdown: string;
  onSave: (markdown: string) => void | Promise<void>;
  debounceMs?: number;
  wikiLinkIndex?: WikiLinkIndex;
  onNavigateWikiLink?: (path: string) => void;
  onRefreshSafetyChange?: (safety: LiveNoteEditorSafety) => void;
  /** Used once, on mount, for a newly created body. */
  initialEditAtEnd?: boolean;
}

type RenderEntry =
  | {
      type: "chunk";
      blocks: MarkdownBlock[];
      start: number;
      end: number;
      markdown: string;
    }
  | { type: "editor"; session: ActiveBlock };

const PASSIVE_CHUNK_SIZE = 24;

function estimatedChunkHeight(markdown: string) {
  const lines = markdown.split(/\r\n|\n|\r/).length;
  const displayMath = (markdown.match(/^\s*\$\$\s*$/gm)?.length ?? 0) / 2;
  const images = markdown.match(/!\[[^\]]*\]\([^)]*\)/g)?.length ?? 0;
  const headings = markdown.match(/^\s{0,3}#{1,6}\s/gm)?.length ?? 0;
  return Math.max(90, Math.min(5_000, lines * 27 + displayMath * 38 + images * 260 + headings * 18));
}

function DeferredMarkdownChunk({
  order,
  markdown,
  children,
}: {
  order: number;
  markdown: string;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLElement>(null);
  const [rendered, setRendered] = useState(() => (
    order < 3 || typeof globalThis.IntersectionObserver === "undefined"
  ));

  useEffect(() => {
    if (rendered) return;
    const host = hostRef.current;
    if (!host) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setRendered(true);
      observer.disconnect();
    }, { rootMargin: "900px 0px" });
    observer.observe(host);

    // Sections eventually become searchable even if the reader does not
    // scroll, but stagger the work so a 5,000-line note never monopolises the
    // first interaction frame.
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | undefined;
    const timer = window.setTimeout(() => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(() => setRendered(true), { timeout: 2_000 });
      } else {
        setRendered(true);
      }
    }, 2_000 + order * 220);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
    };
  }, [order, rendered]);

  return (
    <section
      ref={hostRef}
      className={`live-markdown-chunk${rendered ? " is-rendered" : " is-deferred"}`}
      data-chunk-order={order}
      data-rendered={rendered ? "true" : "false"}
      style={rendered ? undefined : { minHeight: `${estimatedChunkHeight(markdown)}px` }}
    >
      {rendered ? children : <span className="live-markdown-chunk__placeholder" aria-hidden="true" />}
    </section>
  );
}

function transferredImages(files: FileList | null) {
  return files
    ? Array.from(files).filter((file) => (
        file.type.startsWith("image/") ||
        /\.(?:png|jpe?g|gif|webp)$/i.test(file.name)
      ))
    : [];
}

function carriesImage(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.items ?? []).some((item) => (
    item.kind === "file" && (item.type.startsWith("image/") || !item.type)
  ));
}

function editingKind(source: string, fallback: MarkdownBlockKind) {
  const parsed = splitMarkdownBlocks(source);
  return parsed.length === 1 ? parsed[0].kind : fallback;
}

function renderEntries(
  blocks: MarkdownBlock[],
  markdown: string,
  session?: ActiveBlock,
): RenderEntry[] {
  const entries: RenderEntry[] = [];
  let chunk: MarkdownBlock[] = [];
  let inserted = false;

  const flushChunk = () => {
    if (!chunk.length) return;
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    entries.push({
      type: "chunk",
      blocks: chunk,
      start,
      end,
      markdown: markdown.slice(start, end),
    });
    chunk = [];
  };

  for (const block of blocks) {
    const overlapsEditor = session && block.end > session.from && block.start < session.to;
    if (overlapsEditor) {
      flushChunk();
      if (!inserted) {
        entries.push({ type: "editor", session });
        inserted = true;
      }
      continue;
    }

    if (session && !inserted && block.start >= session.to) {
      flushChunk();
      entries.push({ type: "editor", session });
      inserted = true;
    }

    chunk.push(block);
    if (chunk.length >= PASSIVE_CHUNK_SIZE) flushChunk();
  }
  flushChunk();
  if (session && !inserted) entries.push({ type: "editor", session });
  return entries;
}

/**
 * Block-oriented live preview: the document is typeset until a reader clicks a
 * passage. That exact passage then gains a real CodeMirror caret, native
 * selection, clipboard and undo history. Formulae remain compiled widgets; the
 * formula at the caret exposes only its LaTeX body and an immediate preview.
 */
export function LiveNoteEditor({
  noteId,
  markdown,
  onSave,
  debounceMs = 650,
  wikiLinkIndex,
  onNavigateWikiLink,
  onRefreshSafetyChange,
  initialEditAtEnd = false,
}: LiveNoteEditorProps) {
  const [draft, setDraft] = useState(markdown);
  const [activeBlock, setActiveBlock] = useState<ActiveBlock | undefined>(() =>
    initialEditAtEnd
      ? emptyEditingSession(1, markdown.length)
      : markdown ? undefined : emptyEditingSession()
  );
  const [status, setStatus] = useState<LiveSaveStatus>("saved");
  const [saveErrorMessage, setSaveErrorMessage] = useState<string>();
  const [imageDragOver, setImageDragOver] = useState(false);
  const [imageWriteState, setImageWriteState] = useState<"idle" | "writing" | "error">("idle");
  const [imageErrorMessage, setImageErrorMessage] = useState<string>();
  const draftRef = useRef(draft);
  const savedRef = useRef(markdown);
  const onSaveRef = useRef(onSave);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const latestRequestedMarkdownRef = useRef(markdown);
  const pendingSaveCountRef = useRef(0);
  const activeBlockRef = useRef(activeBlock);
  const mountedRef = useRef(true);
  const editingBlockRef = useRef<HTMLElement>(null);
  const blockEditorRef = useRef<LivePreviewBlockEditorHandle>(null);
  const imageWriteQueueRef = useRef<Promise<void>>(Promise.resolve());

  draftRef.current = draft;
  activeBlockRef.current = activeBlock;
  onSaveRef.current = onSave;

  const blocks = useMemo(() => splitMarkdownBlocks(draft), [draft]);
  const entries = useMemo(
    () => renderEntries(blocks, draft, activeBlock),
    [activeBlock, blocks, draft],
  );
  const hasActiveBlock = activeBlock !== undefined;

  useEffect(() => {
    onRefreshSafetyChange?.({
      noteId,
      canRefreshFromDisk: !hasActiveBlock && status === "saved",
      hasActiveEdit: hasActiveBlock,
      saveStatus: status,
    });
  }, [hasActiveBlock, noteId, onRefreshSafetyChange, status]);

  const clearSaveTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const updateStatus = useCallback((next: LiveSaveStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const saveNow = useCallback(() => {
    clearSaveTimer();
    const nextMarkdown = draftRef.current;
    if (nextMarkdown === latestRequestedMarkdownRef.current) {
      if (pendingSaveCountRef.current > 0) {
        updateStatus("saving");
        return saveQueueRef.current.then(() => nextMarkdown === savedRef.current);
      }
      if (nextMarkdown === savedRef.current) {
        updateStatus("saved");
        return Promise.resolve(true);
      }
    }

    const revision = saveRevisionRef.current + 1;
    saveRevisionRef.current = revision;
    latestRequestedMarkdownRef.current = nextMarkdown;
    pendingSaveCountRef.current += 1;
    updateStatus("saving");
    const operation = saveQueueRef.current.then(() => onSaveRef.current(nextMarkdown));
    const result = operation
      .then(() => {
        savedRef.current = nextMarkdown;
        pendingSaveCountRef.current -= 1;
        if (mountedRef.current) setSaveErrorMessage(undefined);
        if (saveRevisionRef.current === revision) {
          updateStatus(draftRef.current === nextMarkdown ? "saved" : "dirty");
        }
        return true;
      })
      .catch((error: unknown) => {
        pendingSaveCountRef.current -= 1;
        if (mountedRef.current) {
          setSaveErrorMessage(
            error instanceof Error ? error.message : "The note could not be saved.",
          );
        }
        if (saveRevisionRef.current === revision) {
          latestRequestedMarkdownRef.current = savedRef.current;
          updateStatus("error");
        }
        return false;
      });
    saveQueueRef.current = result.then(() => undefined);
    return result;
  }, [clearSaveTimer, updateStatus]);

  const scheduleSave = useCallback(() => {
    clearSaveTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void saveNow();
    }, debounceMs);
  }, [clearSaveTimer, debounceMs, saveNow]);

  useEffect(() => {
    if (markdown === draftRef.current) {
      savedRef.current = markdown;
      if (pendingSaveCountRef.current === 0) {
        latestRequestedMarkdownRef.current = markdown;
        updateStatus("saved");
      }
      return;
    }
    if (pendingSaveCountRef.current === 0 && draftRef.current === savedRef.current) {
      draftRef.current = markdown;
      savedRef.current = markdown;
      latestRequestedMarkdownRef.current = markdown;
      setDraft(markdown);
      setSaveErrorMessage(undefined);
      const nextActiveBlock = markdown ? undefined : emptyEditingSession(
        (activeBlockRef.current?.activation ?? 0) + 1,
      );
      setActiveBlock(nextActiveBlock);
      activeBlockRef.current = nextActiveBlock;
      updateStatus("saved");
    }
  }, [markdown, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSaveTimer();
      void saveNow();
    };
  }, [clearSaveTimer, saveNow]);

  const activateBlock = useCallback(
    (block: MarkdownBlock, target: MarkdownEditTarget) => {

      const targetLength = Math.max(0, target.to - target.from);
      const targetOffset = target.cursorRatio === undefined
        ? target.to
        : target.from + Math.round(targetLength * target.cursorRatio);
      const cursorOffset = target.kind === "block"
        ? Math.max(0, Math.min(block.markdown.length, targetOffset))
        : Math.max(0, Math.min(block.markdown.length, targetOffset));
      const next: ActiveBlock = {
        from: block.start,
        to: block.end,
        kind: block.kind,
        cursorOffset,
        activation: (activeBlockRef.current?.activation ?? 0) + 1,
      };
      if (activeBlockRef.current && status !== "saved") void saveNow();
      activeBlockRef.current = next;
      setActiveBlock(next);
      if (status === "error") void saveNow();
    },
    [saveNow, status],
  );

  const activateSourceTarget = useCallback((
    sourceOffset: number,
    sourceLength: number,
    target: MarkdownEditTarget,
  ) => {
    const absoluteFrom = sourceOffset + target.from;
    const absoluteTo = sourceOffset + target.to;
    const fallbackAnchor = sourceOffset + Math.round(
      sourceLength * (target.cursorRatio ?? 0.5),
    );
    const wholeChunkFallback = target.kind === "block" &&
      target.from === 0 && target.to === sourceLength;
    const candidates = blocks.filter((candidate) => (
      candidate.end > sourceOffset && candidate.start < sourceOffset + sourceLength
    ));
    const block = wholeChunkFallback
      ? candidates.find((candidate) => (
          fallbackAnchor >= candidate.start && fallbackAnchor <= candidate.end
        )) ?? candidates.reduce((nearest, candidate) => (
          Math.abs(candidate.start - fallbackAnchor) < Math.abs(nearest.start - fallbackAnchor)
            ? candidate
            : nearest
        ), candidates[0])
      : candidates.find((candidate) => (
          absoluteFrom < candidate.end && absoluteTo > candidate.start
        )) ?? candidates.find((candidate) => absoluteFrom <= candidate.end) ??
          candidates[candidates.length - 1];
    if (!block) return;

    activateBlock(block, {
      ...target,
      from: Math.max(0, Math.min(block.markdown.length, absoluteFrom - block.start)),
      to: Math.max(0, Math.min(block.markdown.length, absoluteTo - block.start)),
      ...(wholeChunkFallback
        ? {
            from: 0,
            to: block.markdown.length,
            cursorRatio: block.markdown.length
              ? Math.max(0, Math.min(1, (fallbackAnchor - block.start) / block.markdown.length))
              : 0,
          }
        : {}),
    });
  }, [activateBlock, blocks]);

  const activateEmptyBlock = useCallback(() => {
    const next = emptyEditingSession(
      (activeBlockRef.current?.activation ?? 0) + 1,
    );
    activeBlockRef.current = next;
    setActiveBlock(next);
  }, []);

  const changeActiveBlock = useCallback(
    (replacement: string) => {
      const session = activeBlockRef.current;
      if (!session) return;
      const currentDraft = draftRef.current;
      const nextDraft = `${currentDraft.slice(0, session.from)}${replacement}${currentDraft.slice(session.to)}`;
      const nextSession: ActiveBlock = {
        ...session,
        to: session.from + replacement.length,
        kind: editingKind(replacement, session.kind),
      };
      draftRef.current = nextDraft;
      activeBlockRef.current = nextSession;
      setDraft(nextDraft);
      setActiveBlock(nextSession);
      updateStatus("dirty");
      scheduleSave();
    },
    [scheduleSave, updateStatus],
  );

  const closeBlock = useCallback(() => {
    activeBlockRef.current = undefined;
    setActiveBlock(undefined);
  }, []);

  const navigateWikiLink = useCallback((path: string) => {
    void saveNow().then((saved) => {
      if (!saved) return;
      closeBlock();
      onNavigateWikiLink?.(path);
    });
  }, [closeBlock, onNavigateWikiLink, saveNow]);

  const insertImages = useCallback((
    files: readonly File[],
    point?: { x: number; y: number },
  ) => {
    if (!files.length) return;
    const operation = imageWriteQueueRef.current.then(async () => {
      if (mountedRef.current) {
        setImageWriteState("writing");
        setImageErrorMessage(undefined);
      }
      const stored = await Promise.all(files.map(async (file, index) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const asset = await assetRepository.storeImage({
          name: file.name || `pasted-image-${index + 1}.png`,
          ...(file.type ? { mediaType: file.type } : {}),
          bytes,
        });
        return markdownForManagedImage(noteId, asset.path, file.name || "image");
      }));
      const insertion = stored.join("\n\n");
      if (!mountedRef.current) return;
      if (blockEditorRef.current?.insertText(insertion, point)) return;

      const currentDraft = draftRef.current;
      const separator = currentDraft && !/\n\s*\n$/.test(currentDraft)
        ? currentDraft.endsWith("\n") ? "\n" : "\n\n"
        : "";
      const nextDraft = `${currentDraft}${separator}${insertion}\n`;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      updateStatus("dirty");
      scheduleSave();
    }).then(() => {
      if (mountedRef.current) setImageWriteState("idle");
    }).catch((error: unknown) => {
      if (!mountedRef.current) return;
      setImageWriteState("error");
      setImageErrorMessage(
        error instanceof Error ? error.message : "The image could not be stored.",
      );
    });
    imageWriteQueueRef.current = operation.catch(() => undefined);
  }, [noteId, scheduleSave, updateStatus]);

  const handleImagePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    const files = transferredImages(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    insertImages(files);
  }, [insertImages]);

  const handleImageDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!carriesImage(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setImageDragOver(true);
  }, []);

  const handleImageDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    setImageDragOver(false);
    const files = transferredImages(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    insertImages(files, { x: event.clientX, y: event.clientY });
  }, [insertImages]);

  useEffect(() => {
    if (!hasActiveBlock) return;

    const finishWhenPointerLeavesBlock = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || editingBlockRef.current?.contains(target)) {
        return;
      }

      // CodeMirror keeps autocomplete and documentation tooltips inside its
      // editor in normal use, but honour externally-mounted tooltips too.
      if (target instanceof Element && target.closest(".cm-tooltip")) return;

      if (target instanceof Element) {
        const link = target.closest<HTMLElement>("[data-wiki-path]");
        const linkedPath = link?.dataset.wikiPath;
        if (linkedPath) {
          event.preventDefault();
          event.stopPropagation();
          navigateWikiLink(linkedPath);
          return;
        }

        const source = target.closest<HTMLElement>("[data-source-kind]");
        const chunk = target.closest<HTMLElement>("[data-source-offset]");
        const sourceOffset = Number(chunk?.dataset.sourceOffset);
        const from = Number(source?.dataset.sourceFrom);
        const to = Number(source?.dataset.sourceTo);
        const kind = source?.dataset.sourceKind as MarkdownEditTarget["kind"] | undefined;
        if (
          chunk && source &&
          Number.isFinite(sourceOffset) && Number.isFinite(from) && Number.isFinite(to) &&
          (kind === "block" || kind === "inline-math" || kind === "display-math")
        ) {
          const rect = source.getBoundingClientRect();
          const cursorRatio = rect.width
            ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
            : 0.5;
          event.preventDefault();
          event.stopPropagation();
          void saveNow();
          activateSourceTarget(
            sourceOffset,
            Number(chunk.dataset.sourceLength) || 0,
            {
              kind,
              from,
              to,
              cursorRatio,
              ...(source.dataset.sourceDelimiter === "$" || source.dataset.sourceDelimiter === "$$"
                ? { delimiter: source.dataset.sourceDelimiter }
                : {}),
            },
          );
          return;
        }
      }

      void saveNow();
      closeBlock();
    };

    document.addEventListener("pointerdown", finishWhenPointerLeavesBlock, true);
    return () => {
      document.removeEventListener("pointerdown", finishWhenPointerLeavesBlock, true);
    };
  }, [activateSourceTarget, closeBlock, hasActiveBlock, navigateWikiLink, saveNow]);

  return (
    <section
      className={`live-note-editor${imageDragOver ? " is-image-drag-over" : ""}`}
      data-note-id={noteId}
      onPaste={handleImagePaste}
      onDragEnter={handleImageDragOver}
      onDragOver={handleImageDragOver}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setImageDragOver(false);
      }}
      onDrop={handleImageDrop}
    >
      {status === "error" && (
        <button
          type="button"
          className="live-note-editor__status"
          data-status={status}
          aria-label="Save failed; retry"
          title={`${saveErrorMessage || "Save failed"} — click to retry`}
          onClick={() => void saveNow()}
        >
          <CircleAlert size={13} aria-hidden="true" />
        </button>
      )}

      {imageWriteState === "writing" && (
        <div className="live-note-editor__image-status" role="status" title="Storing image">
          <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
          <span>Adding image</span>
        </div>
      )}
      {imageWriteState === "error" && (
        <button
          type="button"
          className="live-note-editor__image-status is-error"
          aria-label="Dismiss image error"
          title={imageErrorMessage}
          onClick={() => setImageWriteState("idle")}
        >
          <CircleAlert size={13} aria-hidden="true" />
          <span>Image failed</span>
        </button>
      )}

      {imageDragOver && (
        <div className="live-note-editor__image-drop-cue" aria-hidden="true">
          <ImagePlus size={15} />
          <span>Drop to insert</span>
        </div>
      )}

      <div className="live-note-editor__document">
        {entries.map((entry, entryIndex) => {
          if (entry.type === "editor") {
            const source = draft.slice(entry.session.from, entry.session.to);
            return (
              <section
                key={`editor:${entry.session.activation}`}
                ref={editingBlockRef}
                className="live-markdown-block is-editing"
                data-block-kind={entry.session.kind}
              >
                <Suspense fallback={<MarkdownView markdown={source} contentPath={noteId} compact wikiLinkIndex={wikiLinkIndex} onNavigateWikiLink={navigateWikiLink} />}>
                  <LivePreviewBlockEditor
                    ref={blockEditorRef}
                    value={source}
                    kind={entry.session.kind}
                    initialCursor={entry.session.cursorOffset}
                    onChange={changeActiveBlock}
                    onSave={() => void saveNow()}
                    onClose={closeBlock}
                    wikiLinkIndex={wikiLinkIndex}
                    currentNotePath={noteId}
                    onNavigateWikiLink={navigateWikiLink}
                  />
                </Suspense>
              </section>
            );
          }

          return (
            <DeferredMarkdownChunk
              key={`chunk:${entry.start}:${entry.end}`}
              order={entryIndex}
              markdown={entry.markdown}
            >
              <div
                className="live-markdown-chunk__content"
                data-block-count={entry.blocks.length}
                data-source-offset={entry.start}
                data-source-length={entry.markdown.length}
              >
                <MarkdownView
                  markdown={entry.markdown}
                  contentPath={noteId}
                  compact
                  editable
                  wikiLinkIndex={wikiLinkIndex}
                  onNavigateWikiLink={navigateWikiLink}
                  onActivateTarget={(target) => activateSourceTarget(
                    entry.start,
                    entry.markdown.length,
                    target,
                  )}
                />
              </div>
            </DeferredMarkdownChunk>
          );
        })}

        {!blocks.length && !activeBlock && (
          <button
            type="button"
            className="live-empty-note"
            aria-label="Edit empty note"
            onClick={activateEmptyBlock}
          />
        )}
      </div>
    </section>
  );
}
