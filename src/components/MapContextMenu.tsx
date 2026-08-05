import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface MapContextMenuProps {
  x: number;
  y: number;
  label: string;
  children: ReactNode;
  onClose: () => void;
}

export function MapContextMenu({
  x,
  y,
  label,
  children,
  onClose,
}: MapContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    x,
    y,
    horizontal: "after",
    vertical: "after",
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const place = () => {
      const margin = 8;
      const pointerGap = 6;
      const rect = menu.getBoundingClientRect();
      const horizontal = x + pointerGap + rect.width <= window.innerWidth - margin ? "after" : "before";
      const vertical = y + pointerGap + rect.height <= window.innerHeight - margin ? "after" : "before";
      const next = {
        x: Math.max(margin, Math.min(horizontal === "after" ? x + pointerGap : x - rect.width - pointerGap, window.innerWidth - rect.width - margin)),
        y: Math.max(margin, Math.min(vertical === "after" ? y + pointerGap : y - rect.height - pointerGap, window.innerHeight - rect.height - margin)),
        horizontal,
        vertical,
      };
      setPosition((current) => current.x === next.x && current.y === next.y && current.horizontal === next.horizontal && current.vertical === next.vertical ? current : next);
    };
    place();
    menu.focus({ preventScroll: true });
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [x, y]);

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) onClose();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const close = () => onClose();
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof globalThis.Node && menuRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", closeOnPointer, true);
    window.addEventListener("keydown", closeOnKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointer, true);
      window.removeEventListener("keydown", closeOnKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="map-context-menu nodrag nopan nowheel"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      data-horizontal={position.horizontal}
      data-vertical={position.vertical}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MapMenuHeader({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`map-menu-header ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function MapMenuTitle({ children }: { children: ReactNode }) {
  return <strong className="map-menu-title">{children}</strong>;
}

export function MapMenuBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`map-tool-panel ${className}`.trim()}>{children}</div>;
}

export function MapMenuTextField({
  value,
  onCommit,
  onCancel,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  const initialRef = useRef(value);
  const commitRef = useRef(onCommit);
  draftRef.current = draft;
  commitRef.current = onCommit;

  useEffect(() => {
    setDraft(value);
    draftRef.current = value;
    initialRef.current = value;
  }, [value]);

  useEffect(() => () => {
    if (draftRef.current !== initialRef.current) commitRef.current(draftRef.current);
  }, []);

  const commit = () => {
    if (draftRef.current === initialRef.current) return;
    onCommit(draftRef.current);
    initialRef.current = draftRef.current;
  };

  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => {
        draftRef.current = event.currentTarget.value;
        setDraft(event.currentTarget.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          draftRef.current = initialRef.current;
          setDraft(initialRef.current);
          onCancel?.();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
