import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const atlasCss = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

const groupFixtures = [
  { level: "subject", shape: "oval" },
  { level: "group", shape: "hexagon" },
  { level: "subgroup", shape: "rhombus" },
] as const;

function overviewBoundaries() {
  const style = document.createElement("style");
  style.dataset.testid = "group-boundary-interaction-css";
  style.textContent = atlasCss;
  document.head.append(style);

  const graph = document.createElement("div");
  graph.className = "atlas-graph is-zoom-far is-overview";
  graph.innerHTML = groupFixtures.map(({ level, shape }) => `
    <section class="region-frame region-frame--level-${level} region-frame--${shape}">
      <svg>
        <path
          class="region-frame__hit-target"
          data-level="${level}"
          data-shape="${shape}"
          pointer-events="stroke"
          vector-effect="non-scaling-stroke"
          stroke-width="28"
        ></path>
      </svg>
    </section>
  `).join("");
  document.body.append(graph);
  return [...graph.querySelectorAll<SVGPathElement>(".region-frame__hit-target")];
}

afterEach(() => {
  document.body.replaceChildren();
  document.head
    .querySelectorAll('[data-testid="group-boundary-interaction-css"]')
    .forEach((style) => style.remove());
});

describe("group boundary interaction styling", () => {
  it("retains a precise screen-space hit corridor for every group level at overview zoom", () => {
    expect(atlasCss).toContain(".region-frame__hit-target");
    const boundaries = overviewBoundaries();
    expect(boundaries).toHaveLength(groupFixtures.length);

    boundaries.forEach((boundary, index) => {
      expect(boundary.dataset).toMatchObject(groupFixtures[index]);
      const computed = getComputedStyle(boundary);
      expect(computed.pointerEvents).toBe("stroke");
      expect(boundary).toHaveAttribute("vector-effect", "non-scaling-stroke");
    });
  });
});
