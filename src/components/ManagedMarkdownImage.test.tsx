import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const assets = vi.hoisted(() => ({
  readImage: vi.fn(),
}));

vi.mock("../services/assetRepository", () => ({
  assetRepository: assets,
  bytesToBase64: (bytes: Uint8Array) => btoa(
    String.fromCharCode(...bytes),
  ),
}));

import { ManagedMarkdownImage } from "./ManagedMarkdownImage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManagedMarkdownImage", () => {
  it("loads a nested note's managed image through the repository", async () => {
    const path = `.assets/${"a".repeat(64)}.png`;
    assets.readImage.mockResolvedValue({
      path,
      mediaType: "image/png",
      byteLength: 4,
      sha256: `sha256-${"a".repeat(64)}`,
      bytes: Uint8Array.from([137, 80, 78, 71]),
    });

    render(
      <ManagedMarkdownImage
        notePath="Synthetic Field/Models/Note.md"
        src={`../../${path}`}
        alt="diagram"
      />,
    );

    await waitFor(() => expect(document.querySelector("img[alt='diagram']")).toBeInTheDocument());
    const image = screen.getByRole("img", { name: "diagram" });
    expect(image).toHaveAttribute("data-managed-asset", path);
    expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(assets.readImage).toHaveBeenCalledWith(path);
  });

  it("leaves ordinary and remote images alone", () => {
    render(
      <ManagedMarkdownImage
        notePath="Primary Field/Note.md"
        src="https://example.com/diagram.png"
        alt="remote"
      />,
    );

    expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute(
      "src",
      "https://example.com/diagram.png",
    );
    expect(assets.readImage).not.toHaveBeenCalled();
  });
});
