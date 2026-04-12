/**
 * Voice Snippets — Trigger phrases that expand to saved text blocks
 *
 * Say a trigger phrase → WhisperWoof inserts the saved text instead.
 * Like TextExpander but for voice. Competitors: Wispr Flow snippets,
 * VoiceInk custom shortcuts, Willow shared shortcuts.
 *
 * Examples:
 *   "my address" → "123 Main St, San Francisco, CA 94102"
 *   "standup update" → "Yesterday I worked on... Today I'll focus on..."
 *   "email sign off" → "Best regards,\nHeqing Huang"
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-snippets.json
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const { matchSnippet, simpleEditDistance } = require("./snippets-pure");

const SNIPPETS_FILE = path.join(app.getPath("userData"), "whisperwoof-snippets.json");
const MAX_SNIPPETS = 200;

/**
 * Load snippets from disk.
 * @returns {Array<{id: string, trigger: string, body: string, createdAt: string, usageCount: number}>}
 */
function loadSnippets() {
  try {
    if (fs.existsSync(SNIPPETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SNIPPETS_FILE, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load snippets", { error: err.message });
  }
  return getDefaultSnippets();
}

/**
 * Save snippets to disk.
 */
function saveSnippets(snippets) {
  try {
    fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save snippets", { error: err.message });
  }
}

/**
 * Default starter snippets to demonstrate the feature.
 */
function getDefaultSnippets() {
  return [
    {
      id: "default-1",
      trigger: "my email",
      body: "[Your email address]",
      createdAt: new Date().toISOString(),
      usageCount: 0,
    },
    {
      id: "default-2",
      trigger: "standup update",
      body: "Yesterday I worked on:\n- \n\nToday I'll focus on:\n- \n\nBlockers:\n- None",
      createdAt: new Date().toISOString(),
      usageCount: 0,
    },
    {
      id: "default-3",
      trigger: "email sign off",
      body: "Best regards,\n[Your Name]",
      createdAt: new Date().toISOString(),
      usageCount: 0,
    },
  ];
}

// --- CRUD ---

function getSnippets() {
  return loadSnippets();
}

function addSnippet(trigger, body) {
  if (!trigger || !body) return { success: false, error: "Trigger and body are required" };

  const trimmedTrigger = trigger.trim().toLowerCase();
  if (trimmedTrigger.length < 2) return { success: false, error: "Trigger must be at least 2 characters" };

  const snippets = loadSnippets();

  // Check for duplicate trigger
  if (snippets.some((s) => s.trigger.toLowerCase() === trimmedTrigger)) {
    return { success: false, error: `Trigger "${trimmedTrigger}" already exists` };
  }

  if (snippets.length >= MAX_SNIPPETS) {
    return { success: false, error: `Maximum ${MAX_SNIPPETS} snippets reached` };
  }

  const snippet = {
    id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: trimmedTrigger,
    body: body.trim(),
    createdAt: new Date().toISOString(),
    usageCount: 0,
  };

  const updated = [...snippets, snippet];
  saveSnippets(updated);

  debugLogger.info("[WhisperWoof] Snippet added", { trigger: trimmedTrigger });
  return { success: true, snippet };
}

function updateSnippet(id, updates) {
  const snippets = loadSnippets();
  const idx = snippets.findIndex((s) => s.id === id);
  if (idx === -1) return { success: false, error: "Snippet not found" };

  // Only allow updating trigger and body
  const allowed = {};
  if (updates.trigger !== undefined) allowed.trigger = updates.trigger.trim().toLowerCase();
  if (updates.body !== undefined) allowed.body = updates.body.trim();

  // Check trigger uniqueness if changed
  if (allowed.trigger && allowed.trigger !== snippets[idx].trigger) {
    if (snippets.some((s, i) => i !== idx && s.trigger.toLowerCase() === allowed.trigger)) {
      return { success: false, error: `Trigger "${allowed.trigger}" already exists` };
    }
  }

  const updated = [...snippets];
  updated[idx] = { ...updated[idx], ...allowed };
  saveSnippets(updated);

  return { success: true, snippet: updated[idx] };
}

function removeSnippet(id) {
  const snippets = loadSnippets();
  const filtered = snippets.filter((s) => s.id !== id);
  if (filtered.length === snippets.length) {
    return { success: false, error: "Snippet not found" };
  }
  saveSnippets(filtered);
  return { success: true };
}

// --- Trigger detection ---

/**
 * Check if transcribed text matches a snippet trigger.
 * Returns the expanded body text, or null if no match.
 *
 * Matching rules:
 * 1. Exact match (case-insensitive): "my email" → match
 * 2. Prefix match: "my email please" → match on "my email", rest discarded
 * 3. Fuzzy: tolerate minor STT errors (1 char off for triggers >5 chars)
 */
function expandSnippet(transcribedText) {
  const result = matchSnippet(transcribedText, loadSnippets());
  if (result) incrementUsage(result.id);
  return result;
}

/**
 * Increment usage counter for a snippet.
 */
function incrementUsage(id) {
  const snippets = loadSnippets();
  const idx = snippets.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const updated = [...snippets];
  updated[idx] = { ...updated[idx], usageCount: (updated[idx].usageCount || 0) + 1 };
  saveSnippets(updated);
}

module.exports = {
  getSnippets,
  addSnippet,
  updateSnippet,
  removeSnippet,
  expandSnippet,
  matchSnippet,
  simpleEditDistance,
};
