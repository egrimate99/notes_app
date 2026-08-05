import { describe, expect, it } from "vitest";
import {
  repositoryPath,
  subjectForRepositoryPath,
  titleForRepositoryPath,
} from "./contentPaths";

describe("content paths", () => {
  it("maps stored content paths to repository-relative Markdown paths", () => {
    expect(repositoryPath("content/Synthetic Field/Fixture Topic/Fixture Note.md")).toBe(
      "Synthetic Field/Fixture Topic/Fixture Note.md",
    );
    expect(repositoryPath("content\\Subject Alpha\\Sample Note.md")).toBe(
      "Subject Alpha/Sample Note.md",
    );
  });

  it("rejects paths that could escape or do not identify a file", () => {
    expect(repositoryPath("content/../private.md")).toBeUndefined();
    expect(repositoryPath("content//note.md")).toBeUndefined();
    expect(repositoryPath(undefined)).toBeUndefined();
  });

  it("derives the subject and display title from a real path", () => {
    expect(subjectForRepositoryPath("Synthetic Field 02/Sample Note.md")).toBe(
      "synthetic-field-02",
    );
    expect(subjectForRepositoryPath("Root note.md")).toBeUndefined();
    expect(titleForRepositoryPath("Subject Alpha/Fixture Topic/Sample Note.md")).toBe(
      "Sample Note",
    );
  });
});
