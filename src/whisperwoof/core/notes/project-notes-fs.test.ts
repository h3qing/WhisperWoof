/**
 * Notes ↔ projects ↔ recordings, against a real temp notes folder and an
 * in-memory stand-in for the bf_ tables (better-sqlite3 is built for
 * Electron's ABI, so it can't load under vitest).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let dir = "";
let userData = "";

function fakeDb() {
  const projects: { id: string; name: string }[] = [];
  const entries = new Map<string, { id: string; project_id: string | null; source: string; metadata: string }>();
  return {
    projects,
    entries,
    api: {
      getWhisperWoofProjects: () => [...projects],
      createWhisperWoofProject: (name: string) => {
        const p = { id: `p-${projects.length + 1}`, name };
        projects.push(p);
        return { ...p, createdAt: "" };
      },
      getWhisperWoofEntryRow: (id: string) => entries.get(id) ?? null,
      setEntryProject: (id: string, projectId: string | null) => {
        const row = entries.get(id);
        if (!row) return false;
        entries.set(id, { ...row, project_id: projectId });
        return true;
      },
    },
  };
}

function load(db: ReturnType<typeof fakeDb>) {
  const inject = (request: string, exports: unknown) => {
    const resolved = require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
  };
  inject("electron", {
    app: { getPath: () => userData, isReady: () => false },
    shell: { trashItem: vi.fn(), showItemInFolder: vi.fn(), openPath: vi.fn() },
  });
  inject("../../bridge/app-init.js", db.api);
  for (const mod of ["markdown-route", "notes-folder", "project-notes"]) {
    delete require.cache[require.resolve(`../../bridge/${mod}.js`)];
  }
  return {
    projectNotes: require("../../bridge/project-notes.js"),
    folder: require("../../bridge/notes-folder.js"),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-pn-notes-"));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-pn-data-"));
  process.env.WHISPERWOOF_NOTES_DIR = dir;
});

afterEach(() => {
  delete process.env.WHISPERWOOF_NOTES_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("fn+P → default project", () => {
  it("creates Inbox on first use, remembers it, and files the note there", () => {
    const db = fakeDb();
    const { projectNotes, folder } = load(db);
    const saved = projectNotes.saveProjectNote("Measure the cabinets");
    expect(saved.project).toEqual({ id: "p-1", name: "Inbox" });
    expect(folder.listNotes().notes[0]).toMatchObject({ project: "Inbox", projectId: "p-1" });

    projectNotes.saveProjectNote("Order the tiles");
    expect(db.projects).toHaveLength(1); // not a second Inbox
  });

  it("uses the project the user made the default", () => {
    const db = fakeDb();
    const { projectNotes } = load(db);
    const reno = db.api.createWhisperWoofProject("Kitchen reno");
    projectNotes.setDefaultProject(reno.id);
    expect(projectNotes.saveProjectNote("Pick a sink").project.name).toBe("Kitchen reno");
    expect(() => projectNotes.setDefaultProject("p-nope")).toThrow("Unknown project");
  });
});

describe("note ↔ recording ↔ project", () => {
  it("links a note to its dictation, which joins the note's project", () => {
    const db = fakeDb();
    db.entries.set("e-1", { id: "e-1", project_id: null, source: "voice", metadata: '{"transcriptionId":42}' });
    const { projectNotes, folder } = load(db);
    const { name } = projectNotes.saveProjectNote("Call the plumber");
    projectNotes.linkNoteToEntry(name, "e-1");

    expect(folder.listNotes().notes[0].entryId).toBe("e-1");
    expect(db.entries.get("e-1")?.project_id).toBe("p-1");
    expect(projectNotes.getEntryRecordingId("e-1")).toBe(42);
  });

  it("moves a note between projects and its dictation follows; null takes both out", () => {
    const db = fakeDb();
    db.entries.set("e-2", { id: "e-2", project_id: null, source: "voice", metadata: "{}" });
    const { projectNotes } = load(db);
    const travel = db.api.createWhisperWoofProject("Travel");
    const { name } = projectNotes.saveProjectNote("Book Kyoto");
    projectNotes.linkNoteToEntry(name, "e-2");

    projectNotes.setNoteProject(name, travel.id);
    expect(projectNotes.listProjectNotes(travel.id).map((n: { name: string }) => n.name)).toEqual([name]);
    expect(db.entries.get("e-2")?.project_id).toBe(travel.id);

    projectNotes.setNoteProject(name, null);
    expect(projectNotes.listProjectNotes(travel.id)).toEqual([]);
    expect(db.entries.get("e-2")?.project_id).toBeNull();
  });

  it("refuses unknown entries and projects", () => {
    const db = fakeDb();
    const { projectNotes } = load(db);
    const { name } = projectNotes.saveProjectNote("x");
    expect(() => projectNotes.linkNoteToEntry(name, "e-missing")).toThrow("Unknown entry");
    expect(() => projectNotes.setNoteProject(name, "p-missing")).toThrow("Unknown project");
    expect(projectNotes.getEntryRecordingId("e-missing")).toBeNull();
  });
});
