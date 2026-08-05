import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUP_GREY } from "../domain/mapAppearance";
import { ColorStudio } from "./ColorStudio";

afterEach(cleanup);

describe("ColorStudio RGB drafts", () => {
  it("offers the default group grey as a one-click preset", () => {
    const onChange = vi.fn();
    render(<ColorStudio color="#336699" onChange={onChange} onCopy={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Grey" }));

    expect(onChange).toHaveBeenCalledWith(DEFAULT_GROUP_GREY);
  });

  it("lets a channel be cleared while typing without persisting black", () => {
    const onChange = vi.fn();
    render(<ColorStudio color="#336699" onChange={onChange} onCopy={vi.fn()} />);
    const red = screen.getByRole("spinbutton", { name: "red channel" });

    fireEvent.change(red, { target: { value: "" } });
    expect(red).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(red);
    expect(red).toHaveValue(51);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits one complete RGB edit on blur and clamps it safely", () => {
    const onChange = vi.fn();
    render(<ColorStudio color="#336699" onChange={onChange} onCopy={vi.fn()} />);
    const red = screen.getByRole("spinbutton", { name: "red channel" });

    fireEvent.change(red, { target: { value: "255" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(red);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("#FF6699");
  });

  it("Escape restores the canonical channel without a history write", () => {
    const onChange = vi.fn();
    render(<ColorStudio color="#336699" onChange={onChange} onCopy={vi.fn()} />);
    const blue = screen.getByRole("spinbutton", { name: "blue channel" });

    fireEvent.change(blue, { target: { value: "2" } });
    fireEvent.keyDown(blue, { key: "Escape" });
    expect(blue).toHaveValue(153);
    expect(onChange).not.toHaveBeenCalled();
  });
});
