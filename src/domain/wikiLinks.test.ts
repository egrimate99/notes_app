import { describe, expect, it } from "vitest";
import {
  buildWikiLinkIndex,
  resolveWikiLink,
  wikiLinkHref,
  wikiLinkSuggestions,
  wikiLinkTargetFromHref,
  wikiLinkVisibleLabel,
} from "./wikiLinks";

const paths = [
  "Subject Alpha/Topic One/Shared Concept.md",
  "Subject Alpha/Topic Two/Basics/Shared Concept.md",
  "Subject Alpha/Topic One/Local Concept.md",
  "Subject Beta/Local Concept.md",
  "Standalone Concept.md",
  { path: "Subject Gamma/Alias Concept.md", aliases: ["Synthetic alias"] },
];

describe("wiki links", () => {
  const index = buildWikiLinkIndex(paths);

  it("resolves explicit vault paths and unique basenames case-insensitively", () => {
    expect(resolveWikiLink(index, "subject alpha/topic two/basics/shared concept"))
      .toMatchObject({ status: "resolved", note: { path: paths[1] } });
    expect(resolveWikiLink(index, "Standalone Concept"))
      .toMatchObject({ status: "resolved", note: { path: "Standalone Concept.md" } });
    expect(resolveWikiLink(index, "Synthetic alias"))
      .toMatchObject({ status: "resolved", note: { path: "Subject Gamma/Alias Concept.md" } });
  });

  it("prefers a duplicate basename in the current folder and reports genuine ties", () => {
    expect(resolveWikiLink(index, "Shared Concept", "Subject Alpha/Topic One/Sequence.md"))
      .toMatchObject({ status: "resolved", note: { path: paths[0] } });
    expect(resolveWikiLink(index, "Local Concept", "Subject Alpha/Other/Note.md"))
      .toMatchObject({ status: "resolved", note: { path: paths[2] } });
    expect(resolveWikiLink(index, "Shared Concept", "Unrelated/Note.md").status)
      .toBe("ambiguous");
  });

  it("shows folders for every completion and inserts hidden paths only for duplicates", () => {
    const shared = wikiLinkSuggestions(index, "shared", "Subject Alpha/Topic One/Sequence.md");
    expect(shared.map(({ folder }) => folder)).toEqual([
      "Subject Alpha/Topic One",
      "Subject Alpha/Topic Two/Basics",
    ]);
    expect(shared.map(({ insertion }) => insertion)).toEqual([
      "[[Subject Alpha/Topic One/Shared Concept|Shared Concept]]",
      "[[Subject Alpha/Topic Two/Basics/Shared Concept|Shared Concept]]",
    ]);
    expect(wikiLinkSuggestions(index, "standalone")[0]).toMatchObject({
      insertion: "[[Standalone Concept]]",
      duplicateTitle: false,
    });
  });

  it("round-trips encoded hrefs and keeps paths out of the visible label", () => {
    const target = "Subject Alpha/Topic One/Shared Concept";
    expect(wikiLinkTargetFromHref(wikiLinkHref(target))).toBe(target);
    expect(wikiLinkVisibleLabel(target)).toBe("Shared Concept");
    expect(wikiLinkVisibleLabel(target, "shared idea")).toBe("shared idea");
  });
});
