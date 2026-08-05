import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface PersistentPanelSizeOptions {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
}

interface PersistentPanelSize {
  size: number;
  resize: (size: number) => void;
  commit: (size: number) => void;
  reset: () => void;
}

interface PersistentPanelVisibility {
  visible: boolean;
  hide: () => void;
  show: () => void;
  toggle: () => void;
}

interface PanelResizerProps {
  label: string;
  panel: "file-sidebar" | "inspector";
  value: number;
  min: number;
  max: number;
  /** How a rightward divider movement changes the panel width. */
  direction: 1 | -1;
  onResize: (size: number) => void;
  onResizeEnd?: (size: number) => void;
}

const keyboardStep = 12;
const largeKeyboardStep = 40;

function clampSize(size: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(size)));
}

function readStoredSize(
  storageKey: string,
  defaultSize: number,
  minSize: number,
  maxSize: number,
) {
  try {
    const stored = globalThis.localStorage?.getItem(storageKey);
    if (stored === null || stored === undefined || stored.trim() === "") {
      return clampSize(defaultSize, minSize, maxSize);
    }
    const parsed = Number(stored);
    return Number.isFinite(parsed)
      ? clampSize(parsed, minSize, maxSize)
      : clampSize(defaultSize, minSize, maxSize);
  } catch {
    return clampSize(defaultSize, minSize, maxSize);
  }
}

function writeStoredSize(storageKey: string, size: number) {
  try {
    globalThis.localStorage?.setItem(storageKey, String(size));
  } catch {
    // Resizing remains functional when storage is unavailable or full.
  }
}

function removeStoredSize(storageKey: string) {
  try {
    globalThis.localStorage?.removeItem(storageKey);
  } catch {
    // Resetting the visible panel should not depend on storage availability.
  }
}

function readStoredVisibility(storageKey: string) {
  try {
    const stored = globalThis.localStorage?.getItem(storageKey);
    if (stored === null || stored === undefined || stored.trim() === "") {
      return true;
    }
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === "boolean" ? parsed : true;
  } catch {
    return true;
  }
}

function writeStoredVisibility(storageKey: string, visible: boolean) {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(visible));
  } catch {
    // Showing and hiding panels remains functional without browser storage.
  }
}

export function usePersistentPanelSize({
  storageKey,
  defaultSize,
  minSize,
  maxSize,
}: PersistentPanelSizeOptions): PersistentPanelSize {
  const [size, setSize] = useState(() =>
    readStoredSize(storageKey, defaultSize, minSize, maxSize),
  );

  const resize = useCallback(
    (nextSize: number) => setSize(clampSize(nextSize, minSize, maxSize)),
    [maxSize, minSize],
  );

  const commit = useCallback(
    (nextSize: number) => {
      const clamped = clampSize(nextSize, minSize, maxSize);
      setSize(clamped);
      writeStoredSize(storageKey, clamped);
    },
    [maxSize, minSize, storageKey],
  );

  const reset = useCallback(() => {
    setSize(clampSize(defaultSize, minSize, maxSize));
    removeStoredSize(storageKey);
  }, [defaultSize, maxSize, minSize, storageKey]);

  return { size, resize, commit, reset };
}

export function usePersistentPanelVisibility(
  storageKey: string,
): PersistentPanelVisibility {
  const [visible, setVisible] = useState(() =>
    readStoredVisibility(storageKey),
  );
  const visibleRef = useRef(visible);

  const updateVisibility = useCallback(
    (nextVisible: boolean) => {
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
      writeStoredVisibility(storageKey, nextVisible);
    },
    [storageKey],
  );

  const hide = useCallback(() => updateVisibility(false), [updateVisibility]);
  const show = useCallback(() => updateVisibility(true), [updateVisibility]);
  const toggle = useCallback(
    () => updateVisibility(!visibleRef.current),
    [updateVisibility],
  );

  return { visible, hide, show, toggle };
}

export function PanelResizer({
  label,
  panel,
  value,
  min,
  max,
  direction,
  onResize,
  onResizeEnd,
}: PanelResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<
    | {
        pointerId: number;
        startX: number;
        startValue: number;
        latestValue: number;
      }
    | undefined
  >(undefined);
  const removeWindowListeners = useRef<(() => void) | undefined>(undefined);

  const stopDragging = useCallback(() => {
    const activeDrag = drag.current;
    removeWindowListeners.current?.();
    removeWindowListeners.current = undefined;
    drag.current = undefined;
    delete document.documentElement.dataset.panelResizing;
    setIsDragging(false);
    if (activeDrag) onResizeEnd?.(activeDrag.latestValue);
  }, [onResizeEnd]);

  useEffect(
    () => () => {
      removeWindowListeners.current?.();
      delete document.documentElement.dataset.panelResizing;
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      removeWindowListeners.current?.();

      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startValue: value,
        latestValue: value,
      };
      document.documentElement.dataset.panelResizing = panel;
      setIsDragging(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const activeDrag = drag.current;
        if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) return;
        const nextValue = clampSize(
          activeDrag.startValue +
            (moveEvent.clientX - activeDrag.startX) * direction,
          min,
          max,
        );
        activeDrag.latestValue = nextValue;
        onResize(nextValue);
      };

      const handlePointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== drag.current?.pointerId) return;
        stopDragging();
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
      removeWindowListeners.current = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
      };
    },
    [direction, max, min, onResize, panel, stopDragging, value],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let nextValue: number | undefined;
      const step = event.shiftKey ? largeKeyboardStep : keyboardStep;

      if (event.key === "ArrowLeft") nextValue = value - step * direction;
      if (event.key === "ArrowRight") nextValue = value + step * direction;
      if (event.key === "Home") nextValue = min;
      if (event.key === "End") nextValue = max;
      if (nextValue === undefined) return;

      event.preventDefault();
      const clamped = clampSize(nextValue, min, max);
      onResize(clamped);
      onResizeEnd?.(clamped);
    },
    [direction, max, min, onResize, onResizeEnd, value],
  );

  return (
    <div
      className={`panel-resizer panel-resizer--${panel}`}
      data-panel-resizer={panel}
      data-resizing={isDragging ? "true" : "false"}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <span className="panel-resizer__grip" aria-hidden="true" />
    </div>
  );
}
