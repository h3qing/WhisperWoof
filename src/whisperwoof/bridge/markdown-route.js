/**
 * Markdown Route — Save polished text as a .md file
 *
 * Triggered by Fn+N hotkey routing. Saves voice transcript
 * as a Markdown file to a configurable directory.
 *
 * Default: ~/Documents/WhisperWoof Notes/
 * Filename: YYYY-MM-DD-HHMMSS.md
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { withFields } = require("./notes-folder-pure");

const DEFAULT_NOTES_DIR = path.join(
  app.getPath("documents"),
  "WhisperWoof Notes"
);

function getNotesDir() {
  // Priority: env var > persisted setting > default
  const envDir = process.env.WHISPERWOOF_NOTES_DIR;
  if (envDir) return envDir;

  try {
    const settingsPath = path.join(app.getPath("userData"), "whisperwoof-settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (settings.notesDirectory) return settings.notesDirectory;
    }
  } catch {
    // Fall through to default
  }

  return DEFAULT_NOTES_DIR;
}

function settingsPath() {
  return path.join(app.getPath("userData"), "whisperwoof-settings.json");
}

function readSettings() {
  try {
    if (fs.existsSync(settingsPath())) return JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
  } catch {
    // Start fresh
  }
  return {};
}

function updateSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function setNotesDir(dir) {
  updateSettings({ notesDirectory: dir });
  return dir;
}

function generateFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save text as a Markdown file.
 * @param {string} text - The polished (or raw) text to save
 * @param {Record<string,string>} [fields] - extra frontmatter (e.g. project)
 * @returns {{ success: boolean, filePath?: string, name?: string, error?: string }}
 */
function saveAsMarkdown(text, fields = {}) {
  if (!text || !text.trim()) {
    return { success: false, error: "No text to save" };
  }

  try {
    const dir = getNotesDir();
    ensureDir(dir);

    const filename = generateFilename();
    const filePath = path.join(dir, filename);

    const now = new Date();
    const title = text.trim().split("\n")[0].slice(0, 60);
    const frontmatter = [
      "---",
      `title: "${title.replace(/"/g, '\\"')}"`,
      `date: ${now.toISOString()}`,
      "source: voice",
      "app: WhisperWoof",
      "---",
      "",
    ].join("\n");

    const content = withFields(frontmatter + text.trim() + "\n", fields);
    fs.writeFileSync(filePath, content, "utf-8");

    debugLogger.info("[WhisperWoof] Saved markdown note", {
      filePath,
      textLength: text.length,
    });

    return { success: true, filePath, name: filename };
  } catch (err) {
    debugLogger.error("[WhisperWoof] Failed to save markdown note", {
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

/**
 * Get the current notes directory path.
 * @returns {string}
 */
function getNotesDirectory() {
  return getNotesDir();
}

module.exports = { saveAsMarkdown, getNotesDirectory, setNotesDir, readSettings, updateSettings, DEFAULT_NOTES_DIR };
