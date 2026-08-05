import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactPicker } from "./DeferredCompactPicker";
import { GroupFillOpacityPicker, GroupSurfaceTools, KindPicker } from "./DeferredGeometryTools";

afterEach(cleanup);

describe("deferred group surface controls", () => {
  it("offers icon-only opacity presets and commits fine input without stale state", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <GroupFillOpacityPicker value={.34} onPreview={onPreview} onCommit={onCommit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set fill opacity to 18 percent" }));
    expect(onPreview).toHaveBeenLastCalledWith(.18);
    expect(onCommit).toHaveBeenLastCalledWith(.18);

    const slider = screen.getByRole("slider", { name: "Fine tune group fill opacity" });
    fireEvent.input(slider, { target: { value: ".27" } });
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(onPreview).toHaveBeenLastCalledWith(.27);
    expect(onCommit).toHaveBeenLastCalledWith(.27);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Current group fill opacity")).toHaveTextContent("27");
  });

  it("reuses the compact icon picker for the three frame weights", () => {
    const onChange = vi.fn();
    render(<CompactPicker kind="weight" value="regular" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Regular frame" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Strong frame" }));
    expect(onChange).toHaveBeenCalledWith("strong");
  });

  it("composes opacity and weight into one context-menu primitive", () => {
    render(
      <GroupSurfaceTools
        fillOpacity={.34}
        borderWeight="hairline"
        onFillOpacityPreview={vi.fn()}
        onFillOpacityCommit={vi.fn()}
        onBorderWeightChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Group fill opacity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hairline frame" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("landmark kind picker", () => {
  it("keeps informal notes separate from mathematical objects", () => {
    const onChange = vi.fn();
    render(<KindPicker value="theorem" onChange={onChange} />);

    const informal = screen.getByRole("region", { name: "Informal note" });
    const mathematics = screen.getByRole("region", { name: "Mathematical objects" });
    expect(informal).toContainElement(screen.getByRole("button", { name: "Note" }));
    expect(mathematics).not.toContainElement(screen.getByRole("button", { name: "Note" }));
    expect(informal.querySelector(".map-paper-note-glyph")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    expect(onChange).toHaveBeenCalledWith("concept", "rectangle");
  });

  it("does not reset a custom shape when the active Note kind is clicked again", () => {
    const onChange = vi.fn();
    render(<KindPicker value="concept" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
