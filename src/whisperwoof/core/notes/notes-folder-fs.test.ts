/**
 * Notes view file layer against a real temp folder: what Fn+N saves is what
 * the Notes view lists, edits keep the frontmatter, and names from the
 * renderer can't escape the folder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const trashItem = vi.fn(async (p: string) => fs.rmSync(p));
const showItemInFolder = vi.fn();

let dir = "";
const require = createRequire(import.meta.url);

function loadBridge() {
  // The bridge is CommonJS and requires electron at load time.
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => dir, isReady: () => false },
      shell: { trashItem, showItemInFolder, openPath: vi.fn(async () => "") },
    },
  } as unknown as NodeJS.Module;
  for (const mod of ["markdown-route", "notes-folder"]) {
    delete require.cache[require.resolve(`../../bridge/${mod}.js`)];
  }
  return {
    route: require("../../bridge/markdown-route.js"),
    folder: require("../../bridge/notes-folder.js"),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-notes-"));
  process.env.WHISPERWOOF_NOTES_DIR = dir;
});

afterEach(() => {
  delete process.env.WHISPERWOOF_NOTES_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("notes folder", () => {
  it("lists what Fn+N saved, with its title and body", () => {
    const { route, folder } = loadBridge();
    const saved = route.saveAsMarkdown("Call the landlord about the heater.");
    expect(saved.success).toBe(true);
    expect(saved.name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}\.md$/);

    const { notes } = folder.listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      name: saved.name,
      title: "Call the landlord about the heater.",
      body: "Call the landlord about the heater.",
    });
  });

  it("edits the body in place and keeps the frontmatter", () => {
    const { route, folder } = loadBridge();
    const { name } = route.saveAsMarkdown("first draft");
    folder.updateNoteBody(name, "second draft");
    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    expect(raw.startsWith("---\ntitle: \"first draft\"")).toBe(true);
    expect(raw.trim().endsWith("second draft")).toBe(true);
  });

  it("ignores non-notes and refuses names that leave the folder", () => {
    const { folder } = loadBridge();
    fs.writeFileSync(path.join(dir, "readme.txt"), "x");
    fs.writeFileSync(path.join(dir, ".hidden.md"), "x");
    expect(folder.listNotes().notes).toHaveLength(0);
    expect(() => folder.updateNoteBody("../escape.md", "x")).toThrow("Invalid note name");
    expect(() => folder.revealNote("/etc/passwd")).toThrow("Invalid note name");
  });

  it("won't write through a .md symlink that leads outside the folder", () => {
    const { folder } = loadBridge();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ww-outside-"));
    const target = path.join(outside, "secret.md");
    fs.writeFileSync(target, "original");
    fs.symlinkSync(target, path.join(dir, "link.md"));
    expect(() => folder.updateNoteBody("link.md", "overwritten")).toThrow("Invalid note name");
    expect(fs.readFileSync(target, "utf-8")).toBe("original");
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("skips a broken symlink instead of failing the whole list", () => {
    const { route, folder } = loadBridge();
    route.saveAsMarkdown("still listed");
    fs.symlinkSync(path.join(dir, "missing.md"), path.join(dir, "dangling.md"));
    expect(folder.listNotes().notes.map((n: { title: string }) => n.title)).toEqual(["still listed"]);
  });

  it("moves a note to the Trash through the OS, not a hard delete", async () => {
    const { route, folder } = loadBridge();
    const { name } = route.saveAsMarkdown("temp");
    await folder.trashNote(name);
    expect(trashItem).toHaveBeenCalledWith(path.join(dir, name));
    expect(folder.listNotes().notes).toHaveLength(0);
  });
});
