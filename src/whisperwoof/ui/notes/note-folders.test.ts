/**
 * The Notes view's folder column: All notes, one folder per project, and
 * No project. A note naming a project the app doesn't have (deleted, or
 * edited in Obsidian) is treated as unfiled.
 */
import { describe, it, expect } from "vitest";
import { notesInFolder, folderCounts, projectOf } from "./note-folders";

const projects = [
  { id: "p-inbox", name: "Inbox" },
  { id: "p-reno", name: "Kitchen reno" },
];
const note = (name: string, projectId = "") => ({ name, projectId });
const notes = [note("a.md", "p-inbox"), note("b.md", "p-reno"), note("c.md"), note("d.md", "p-deleted")];

describe("notesInFolder", () => {
  it("All notes shows everything", () => {
    expect(notesInFolder(notes, { kind: "all" }, projects)).toHaveLength(4);
  });

  it("a project folder shows only its notes", () => {
    expect(notesInFolder(notes, { kind: "project", id: "p-reno" }, projects).map((n) => n.name)).toEqual(["b.md"]);
  });

  it("No project shows unfiled notes and ones pointing at a missing project", () => {
    expect(notesInFolder(notes, { kind: "none" }, projects).map((n) => n.name)).toEqual(["c.md", "d.md"]);
  });
});

describe("folderCounts", () => {
  it("counts every folder in one pass", () => {
    expect(folderCounts(notes, projects)).toEqual({
      all: 4,
      none: 2,
      byProject: { "p-inbox": 1, "p-reno": 1 },
    });
  });
});

describe("projectOf", () => {
  it("finds a note's project, or null when unfiled or unknown", () => {
    expect(projectOf(notes[1], projects)?.name).toBe("Kitchen reno");
    expect(projectOf(notes[2], projects)).toBeNull();
    expect(projectOf(notes[3], projects)).toBeNull();
  });
});
