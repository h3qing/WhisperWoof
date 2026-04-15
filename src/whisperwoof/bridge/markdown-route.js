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

function setNotesDir(dir) {
  const settingsPath = path.join(app.getPath("userData"), "whisperwoof-settings.json");
  let settings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
  } catch {
    // Start fresh
  }
  settings = { ...settings, notesDirectory: dir };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
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
 * @returns {{ success: boolean, filePath?: string, error?: string }}
 */
function saveAsMarkdown(text) {
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

    fs.writeFileSync(filePath, frontmatter + text.trim() + "\n", "utf-8");

    debugLogger.info("[WhisperWoof] Saved markdown note", {
      filePath,
      textLength: text.length,
    });

    return { success: true, filePath };
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

module.exports = { saveAsMarkdown, getNotesDirectory, setNotesDir, DEFAULT_NOTES_DIR };
