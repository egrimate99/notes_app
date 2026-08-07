import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Landmark } from "../domain/types";
import { InspectorPanel } from "./InspectorPanel";

beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
});

afterEach(cleanup);

const landmark: Landmark = {
  id: "test-definition",
  title: "Continuity",
  kind: "definition",
  subtype: "overly specific imported subtype",
  subjectIds: ["synthetic-field-02"],
  regionId: "synthetic-foundations",
  summary: "RAW_SUMMARY \\theta [formula]",
  markdown: "> [!definition]\n> A function is continuous when $f(x_n) \\to f(x)$.",
  tags: [],
  status: "imported",
  mastery: { state: 0, explain: 0, derive: 0, apply: 0 },
};

describe("InspectorPanel", () => {
  it("shows the note title and compiled content without type or tag controls", async () => {
    const { container } = render(<InspectorPanel landmark={landmark} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Continuity" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/overly specific imported subtype/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/RAW_SUMMARY/)).not.toBeInTheDocument();
    expect(
      await screen.findByText(/A function is continuous/, undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector(".katex")).toBeInTheDocument();
  });

  it("keeps the compiled note visible and opens only clicked LaTeX source", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <InspectorPanel
        landmark={landmark}
        contentPath="Primary Field/Public Fixture Note 001.md"
        markdown={landmark.markdown}
        editable
        onSave={onSave}
      />,
    );

    await screen.findByText(/A function is continuous/);
    const compiledFormula = container.querySelector(".katex");
    expect(compiledFormula).not.toBeNull();
    fireEvent.click(compiledFormula!);
    expect(
      await screen.findByRole("textbox", {
        name: "Edit mathematical environment",
      }),
    ).toBeInTheDocument();
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent(
      "f(x_n) \\to f(x)",
    );
    expect(screen.getByLabelText("Live formula preview")).toBeInTheDocument();

    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Edit mathematical environment" }),
      { key: "Escape" },
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Edit mathematical environment" }),
      ).not.toBeInTheDocument(),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("offers a clear close action without adding note metadata controls", () => {
    const onCollapse = vi.fn();
    render(
      <InspectorPanel
        landmark={landmark}
        contentPath="Primary Field/Public Fixture Note 001.md"
        markdown={landmark.markdown}
        onCollapse={onCollapse}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close note sidebar" }));
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps the empty panel minimal and collapsible", () => {
    const onCollapse = vi.fn();
    render(
      <InspectorPanel onCollapse={onCollapse} />,
    );

    expect(screen.getByText("Select a note on the map or in the file tree.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close note sidebar" }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
