import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
} from "react";
import {
  NOTE_FILE_DRAG_MIME,
  readNoteFileDragItems,
  writeNoteFileDragBatchPayload,
  type NoteFileDragItem,
} from "../domain/noteDrag";

let placementChunkPrefetched = false;

function prefetchPlacementChunk() {
  if (placementChunkPrefetched) return;
  placementChunkPrefetched = true;
  void import("./batchNotePlacement").catch(() => {
    placementChunkPrefetched = false;
  });
}

export function beginNoteFileDrag(
  event: DragEvent<HTMLElement>,
  payload: NoteFileDragItem | readonly NoteFileDragItem[],
) {
  const notes = "path" in payload ? [payload] : payload;
  if (!notes.length) return;
  writeNoteFileDragBatchPayload(event.dataTransfer, notes);
  if (typeof event.dataTransfer.setDragImage !== "function") return;
  const preview = document.createElement("div");
  preview.className = "file-tree__drag-preview";
  preview.textContent = notes.length === 1
    ? notes[0].title
    : `${notes.length} notes`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 14, 14);
  window.setTimeout(() => preview.remove(), 0);
}

export function useNoteFileDropTarget(
  onDrop: ((notes: readonly NoteFileDragItem[], point: { x: number; y: number }) => void) | undefined,
) {
  const [active, setActive] = useState(false);
  const accepts = useCallback((event: DragEvent<HTMLElement>) => (
    Boolean(onDrop) && Array.from(event.dataTransfer.types).includes(NOTE_FILE_DRAG_MIME)
  ), [onDrop]);
  const enter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    // Warm the tiny placement chunk during pointer travel so releasing a large
    // folder still feels immediate on the first drop of a session.
    prefetchPlacementChunk();
    setActive(true);
  }, [accepts]);
  const leave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setActive(false);
  }, []);
  const drop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    const notes = readNoteFileDragItems(event.dataTransfer);
    if (notes?.length) onDrop?.(notes, { x: event.clientX, y: event.clientY });
  }, [accepts, onDrop]);

  useEffect(() => {
    if (!active) return;
    const clear = () => setActive(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [active]);

  return {
    active,
    handlers: {
      onDragEnter: enter,
      onDragOver: enter,
      onDragLeave: leave,
      onDrop: drop,
    },
  };
}
