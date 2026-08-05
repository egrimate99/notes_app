import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PanelResizer,
  usePersistentPanelSize,
  usePersistentPanelVisibility,
} from "./PanelResizer";

const storageKey = "test:panel-width";
const visibilityStorageKey = "test:panel-visible";

function ResizableHarness({ direction = 1 }: { direction?: 1 | -1 }) {
  const panel = usePersistentPanelSize({
    storageKey,
    defaultSize: direction === 1 ? 246 : 548,
    minSize: direction === 1 ? 180 : 360,
    maxSize: direction === 1 ? 480 : 860,
  });

  return (
    <>
      <output data-testid="panel-size">{panel.size}</output>
      <PanelResizer
        label="Resize test panel"
        panel={direction === 1 ? "file-sidebar" : "inspector"}
        value={panel.size}
        min={direction === 1 ? 180 : 360}
        max={direction === 1 ? 480 : 860}
        direction={direction}
        onResize={panel.resize}
        onResizeEnd={panel.commit}
      />
    </>
  );
}

function VisibilityHarness() {
  const panel = usePersistentPanelVisibility(visibilityStorageKey);

  return (
    <>
      <output data-testid="panel-visibility">
        {panel.visible ? "visible" : "hidden"}
      </output>
      <button type="button" onClick={panel.hide}>Hide</button>
      <button type="button" onClick={panel.show}>Show</button>
      <button type="button" onClick={panel.toggle}>Toggle</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());

describe("PanelResizer", () => {
  it("tracks the pointer, clamps the result, and persists on release", () => {
    render(<ResizableHarness />);
    const separator = screen.getByRole("separator", {
      name: "Resize test panel",
    });

    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "180");
    expect(separator).toHaveAttribute("aria-valuemax", "480");
    expect(separator).toHaveAttribute("aria-valuenow", "246");
    expect(localStorage.getItem(storageKey)).toBeNull();

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 246,
      pointerId: 7,
    });
    fireEvent.pointerMove(window, { clientX: 326, pointerId: 7 });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("326");
    expect(localStorage.getItem(storageKey)).toBeNull();

    fireEvent.pointerMove(window, { clientX: 900, pointerId: 7 });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("480");
    fireEvent.pointerUp(window, { clientX: 900, pointerId: 7 });
    expect(localStorage.getItem(storageKey)).toBe("480");
    expect(separator).toHaveAttribute("data-resizing", "false");
  });

  it("uses the opposite drag direction for the right-hand inspector", () => {
    render(<ResizableHarness direction={-1} />);
    const separator = screen.getByRole("separator", {
      name: "Resize test panel",
    });

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 900,
      pointerId: 3,
    });
    fireEvent.pointerMove(window, { clientX: 940, pointerId: 3 });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("508");
    fireEvent.pointerUp(window, { clientX: 940, pointerId: 3 });
    expect(localStorage.getItem(storageKey)).toBe("508");
  });

  it("supports keyboard resizing without a double-click reset action", () => {
    render(<ResizableHarness />);
    const separator = screen.getByRole("separator", {
      name: "Resize test panel",
    });

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("258");
    expect(localStorage.getItem(storageKey)).toBe("258");

    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("298");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("180");
    fireEvent.keyDown(separator, { key: "End" });
    expect(screen.getByTestId("panel-size")).toHaveTextContent("480");

    fireEvent.doubleClick(separator);
    expect(screen.getByTestId("panel-size")).toHaveTextContent("480");
    expect(localStorage.getItem(storageKey)).toBe("480");
  });

  it("restores a saved size and ignores malformed storage", () => {
    localStorage.setItem(storageKey, "312");
    const { unmount } = render(<ResizableHarness />);
    expect(screen.getByTestId("panel-size")).toHaveTextContent("312");
    unmount();

    localStorage.setItem(storageKey, "not-a-size");
    render(<ResizableHarness />);
    expect(screen.getByTestId("panel-size")).toHaveTextContent("246");
  });
});

describe("usePersistentPanelVisibility", () => {
  it("defaults to visible and persists hide, show, and toggle actions", () => {
    render(<VisibilityHarness />);

    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("visible");
    expect(localStorage.getItem(visibilityStorageKey)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("hidden");
    expect(localStorage.getItem(visibilityStorageKey)).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("visible");
    expect(localStorage.getItem(visibilityStorageKey)).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("hidden");
    expect(localStorage.getItem(visibilityStorageKey)).toBe("false");
  });

  it("restores a saved visibility and treats malformed storage as visible", () => {
    localStorage.setItem(visibilityStorageKey, "false");
    const { unmount } = render(<VisibilityHarness />);
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("hidden");
    unmount();

    localStorage.setItem(visibilityStorageKey, "not-a-boolean");
    render(<VisibilityHarness />);
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("visible");
  });

  it("remains usable when localStorage reads and writes fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    render(<VisibilityHarness />);
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("visible");

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("panel-visibility")).toHaveTextContent("visible");
  });
});
