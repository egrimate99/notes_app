import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapContextMenu } from "./MapContextMenu";

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
});

describe("MapContextMenu", () => {
  it("repositions when deferred menu content changes size", () => {
    let height = 100;
    let resized: ResizeObserverCallback | undefined;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!(this instanceof HTMLElement) || !this.classList.contains("map-context-menu")) {
        return new DOMRect();
      }
      return new DOMRect(0, 0, 200, height);
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });

    render(
      <MapContextMenu x={700} y={500} label="Edit object" onClose={vi.fn()}>
        <div>Tools</div>
      </MapContextMenu>,
    );

    const menu = screen.getByRole("dialog", { name: "Edit object" });
    expect(menu).toHaveStyle({ left: "494px", top: "394px" });
    expect(menu).toHaveAttribute("data-horizontal", "before");
    expect(menu).toHaveAttribute("data-vertical", "before");

    height = 300;
    act(() => resized?.([], {} as ResizeObserver));
    expect(menu).toHaveStyle({ left: "494px", top: "194px" });
  });
});
