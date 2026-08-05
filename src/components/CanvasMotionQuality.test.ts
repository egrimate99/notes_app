import { afterEach, describe, expect, it } from "vitest";
import motionQualityCss from "./CanvasMotionQuality.css?raw";

function contentVisibility(graphState: string) {
  const style = document.createElement("style");
  style.dataset.testid = "motion-quality-css";
  style.textContent = motionQualityCss;
  document.head.append(style);

  const graph = document.createElement("div");
  graph.className = `atlas-graph ${graphState}`;
  graph.innerHTML = [
    '<article class="landmark-node">',
    '<div class="landmark-node__document">',
    '<div class="landmark-node__preview">',
    '<div class="markdown-view">Rendered mathematics</div>',
    "</div>",
    "</div>",
    "</article>",
  ].join("");
  document.body.append(graph);

  const documentBody = graph.querySelector<HTMLElement>(".landmark-node__document");
  const preview = graph.querySelector<HTMLElement>(".landmark-node__preview");
  const markdown = graph.querySelector<HTMLElement>(".markdown-view");
  if (!documentBody || !preview || !markdown) {
    throw new Error("The motion-quality test fixture is incomplete.");
  }
  return {
    document: getComputedStyle(documentBody).visibility,
    preview: getComputedStyle(preview).visibility,
    markdown: getComputedStyle(markdown).visibility,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll('[data-testid="motion-quality-css"]').forEach((style) => style.remove());
});

describe("canvas motion-quality content policy", () => {
  it.each([
    "is-zoom-near",
    "is-zoom-near is-navigating",
    "is-zoom-near is-node-dragging",
    "is-zoom-mid",
    "is-zoom-mid is-navigating",
    "is-zoom-mid is-node-dragging",
    "is-zoom-far",
    "is-zoom-far is-navigating",
    "is-zoom-far is-node-dragging",
  ])("keeps compiled landmark content visible in %s", (graphState) => {
    expect(contentVisibility(graphState)).toEqual({
      document: "visible",
      preview: "visible",
      markdown: "visible",
    });
  });
});
