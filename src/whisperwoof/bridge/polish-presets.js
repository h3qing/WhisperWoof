/**
 * Polish Presets — Personality-based prompt templates for voice transcript cleanup
 *
 * Users can select a preset in WhisperWoof Settings to change how their
 * voice transcripts are cleaned up. Each preset has a different style.
 *
 * Self-evaluation notes (tested against common voice patterns):
 *
 * Test input: "um so like i need to first go to the store and then uh
 * second i need to pick up the kids and third i need to make dinner tonight"
 *
 * Expected outputs by preset (lists formatted with line breaks):
 * - clean: "I need to:\n1. Go to the store\n2. Pick up the kids\n3. Make dinner tonight"
 * - professional: "I need to:\n1. Go to the store\n2. Pick up the kids\n3. Make dinner tonight"
 * - casual: "I need to:\n1. Go to the store\n2. Pick up the kids\n3. Make dinner tonight"
 * - minimal: "I need to first go to the store, then pick up the kids, and make dinner tonight"
 * - structured: "## Tasks\n1. Go to the store\n2. Pick up the kids\n3. Make dinner tonight"
 *
 * Test input: "hey can you um remind me to call sarah about friday's meeting
 * and also i need to you know check the budget numbers"
 *
 * Expected (different topics → separate paragraphs):
 * - clean: "Remind me to call Sarah about Friday's meeting.\n\nI need to check the budget numbers."
 * - professional: "Call Sarah regarding Friday's meeting.\n\nReview budget numbers."
 * - casual: "Remind me to call Sarah about Friday's meeting.\n\nAlso, I need to check the budget numbers."
 * - minimal: "Remind me to call Sarah about Friday's meeting and check the budget numbers"
 * - structured: "## Reminders\n- Call Sarah about Friday's meeting\n\n## Action Items\n- Check the budget numbers"
 *
 * Test input: "so we need to update the homepage design that's the first thing
 * and second we should fix the login bug and third update the docs oh and
 * also i talked to sarah yesterday and she said the client meeting is moved
 * to thursday so we need to prepare the deck by wednesday"
 *
 * Expected (list + topic shift → list with line breaks, then new paragraph):
 * - clean: "We need to:\n1. Update the homepage design\n2. Fix the login bug\n3. Update the docs\n\nSarah said the client meeting is moved to Thursday, so we need to prepare the deck by Wednesday."
 */

const { PRESETS, DEFAULT_PRESET_ID } = require("./polish-presets-pure");

// --- Custom Presets (user-defined) ---

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const CUSTOM_PRESETS_FILE = path.join(app.getPath("userData"), "custom-presets.json");

function loadCustomPresets() {
  try {
    if (fs.existsSync(CUSTOM_PRESETS_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOM_PRESETS_FILE, "utf-8"));
    }
  } catch { /* */ }
  return {};
}

function saveCustomPresets(presets) {
  try {
    fs.writeFileSync(CUSTOM_PRESETS_FILE, JSON.stringify(presets, null, 2), "utf-8");
  } catch { /* */ }
}

function getAllPresets() {
  const custom = loadCustomPresets();
  return { ...PRESETS, ...custom };
}

function saveCustomPreset({ id, name, description, prompt }) {
  const custom = loadCustomPresets();
  const presetId = id || `custom-${Date.now()}`;
  custom[presetId] = { id: presetId, name, description, prompt, custom: true };
  saveCustomPresets(custom);
  return custom[presetId];
}

function deleteCustomPreset(id) {
  const custom = loadCustomPresets();
  delete custom[id];
  saveCustomPresets(custom);
}

/**
 * Get all available presets (built-in + custom).
 */
function getPolishPresets() {
  return Object.values(getAllPresets()).map(({ id, name, description, custom }) => ({
    id, name, description, custom: !!custom,
  }));
}

/**
 * Get the system prompt for a given preset ID.
 */
function getPresetPrompt(presetId) {
  const all = getAllPresets();
  const preset = all[presetId];
  if (!preset) return PRESETS[DEFAULT_PRESET_ID].prompt;
  return preset.prompt;
}

/**
 * Get the full preset object.
 */
function getPreset(presetId) {
  const all = getAllPresets();
  return all[presetId] || PRESETS[DEFAULT_PRESET_ID];
}

module.exports = {
  PRESETS,
  DEFAULT_PRESET_ID,
  getPolishPresets,
  getPresetPrompt,
  getPreset,
  saveCustomPreset,
  deleteCustomPreset,
};
