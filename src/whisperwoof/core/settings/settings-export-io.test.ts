/**
 * Settings export/import file layer: the main process picks the path with a
 * native dialog, so a renderer can't point these handlers at ~/.zshrc or
 * read arbitrary files through them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const showSaveDialog = vi.fn();
const showOpenDialog = vi.fn();

let dir = "";

const BUNDLE = {
  version: 1,
  exportedAt: "2026-09-25T00:00:00.000Z",
  appName: "WhisperWoof",
  data: { vocabulary: [{ word: "Mando" }] },
};

function loadBridge() {
  // The bridge is CommonJS and requires electron at load time.
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => dir, isReady: () => false },
      dialog: { showSaveDialog, showOpenDialog },
    },
  } as unknown as NodeJS.Module;
  delete require.cache[require.resolve("../../bridge/settings-export.js")];
  return require("../../bridge/settings-export.js");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-settings-"));
  showSaveDialog.mockReset();
  showOpenDialog.mockReset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("saveExportFile", () => {
  it("writes the bundle to the path the user picked", async () => {
    const target = path.join(dir, "backup.json");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });

    const result = await loadBridge().saveExportFile(BUNDLE);

    expect(result).toMatchObject({ success: true, path: target });
    expect(JSON.parse(fs.readFileSync(target, "utf-8"))).toEqual(BUNDLE);
    const [options] = showSaveDialog.mock.calls[0];
    expect(options.filters).toEqual([{ name: "WhisperWoof Settings", extensions: ["json"] }]);
    expect(options.defaultPath).toMatch(/whisperwoof-settings-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("rejects the old (path, bundle) call without opening a dialog", async () => {
    const rc = path.join(dir, ".zshrc");

    const result = await loadBridge().saveExportFile(rc, BUNDLE);

    expect(result.success).toBe(false);
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(fs.existsSync(rc)).toBe(false);
  });

  it("writes nothing when the dialog is canceled", async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: "" });

    const result = await loadBridge().saveExportFile(BUNDLE);

    expect(result).toEqual({ success: false, canceled: true });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses a non-.json path", async () => {
    const rc = path.join(dir, ".zshrc");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: rc });

    const result = await loadBridge().saveExportFile(BUNDLE);

    expect(result.success).toBe(false);
    expect(fs.existsSync(rc)).toBe(false);
  });
});

describe("loadImportFile", () => {
  it("reads the file the user picked, ignoring any renderer path", async () => {
    const picked = path.join(dir, "backup.json");
    fs.writeFileSync(picked, JSON.stringify(BUNDLE));
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] });

    const result = await loadBridge().loadImportFile("/etc/passwd");

    expect(result).toEqual({ success: true, bundle: BUNDLE });
    const [options] = showOpenDialog.mock.calls[0];
    expect(options.properties).toEqual(["openFile"]);
    expect(options.filters).toEqual([{ name: "WhisperWoof Settings", extensions: ["json"] }]);
  });

  it("returns canceled when the user backs out", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    expect(await loadBridge().loadImportFile()).toEqual({ success: false, canceled: true });
  });

  it("refuses a non-.json file without reading it", async () => {
    const secret = path.join(dir, ".zshrc");
    fs.writeFileSync(secret, "export OPENAI_KEY=sk-live-123");
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [secret] });
    const bridge = loadBridge();
    const read = vi.spyOn(fs, "readFileSync");

    const result = await bridge.loadImportFile();

    expect(result.success).toBe(false);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it("does not leak file content when the JSON is invalid", async () => {
    const picked = path.join(dir, "broken.json");
    fs.writeFileSync(picked, "export OPENAI_KEY=sk-live-123");
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] });

    const result = await loadBridge().loadImportFile();

    expect(result).toEqual({ success: false, error: "Invalid JSON" });
  });
});
