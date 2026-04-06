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
 * Expected outputs by preset:
 * - clean: "I need to: 1. Go to the store 2. Pick up the kids 3. Make dinner tonight"
 * - professional: "I need to: 1. Go to the store 2. Pick up the kids 3. Make dinner tonight."
 * - casual: "I need to go to the store, pick up the kids, and make dinner tonight"
 * - minimal: "I need to first go to the store, then pick up the kids, and make dinner tonight"
 * - structured: "## Tasks\n1. Go to the store\n2. Pick up the kids\n3. Make dinner tonight"
 *
 * Test input: "hey can you um remind me to call sarah about friday's meeting
 * and also i need to you know check the budget numbers"
 *
 * Expected:
 * - clean: "Remind me to call Sarah about Friday's meeting. Also, I need to check the budget numbers."
 * - professional: "Action items: Call Sarah regarding Friday's meeting. Review budget numbers."
 * - casual: "Remind me to call Sarah about Friday's meeting, and check the budget numbers"
 * - minimal: "Remind me to call Sarah about Friday's meeting and check the budget numbers"
 * - structured: "## Reminders\n- Call Sarah about Friday's meeting\n- Check the budget numbers"
 */

const PRESETS = {
  clean: {
    id: "clean",
    name: "Clean",
    description: "Remove filler words, fix grammar, add punctuation, format lists. Default.",
    prompt:
      "Clean up this voice transcript. Rules:\n" +
      "- ALWAYS add proper punctuation: periods at end of sentences, commas for pauses, question marks for questions\n" +
      "- Break into clear sentences — voice transcripts often run on without any punctuation\n" +
      "- Capitalize the first word of each sentence\n" +
      "- Remove filler words (um, uh, like, you know, so, basically, actually, right, I mean, I guess)\n" +
      "- Fix grammar errors\n" +
      "- When the speaker says 'first... second... third...' or lists items, format as a numbered or bulleted list\n" +
      "- Keep the original meaning, tone, and vocabulary\n" +
      "- Be concise — don't add words that weren't spoken\n" +
      "- Return ONLY the cleaned text, no explanations",
  },

  professional: {
    id: "professional",
    name: "Professional",
    description: "Clean, confident tone. Removes filler words, hedging, and verbal tics. Default.",
    prompt:
      "Rewrite this voice transcript to sound professional and confident. Rules:\n" +
      "- Remove ALL filler words: um, uh, like, you know, so, basically, actually, right, I mean, I guess\n" +
      "- Remove hedging language: I think, I feel like, kind of, sort of, maybe, probably, it seems like, you know what I mean\n" +
      "- Remove verbal padding: blah blah blah, and stuff, and things, or whatever, or something\n" +
      "- Use direct, confident statements (\"We should redesign\" not \"I think maybe we should redesign\")\n" +
      "- ALWAYS add proper punctuation: periods, commas, question marks\n" +
      "- Capitalize first word of each sentence\n" +
      "- Convert spoken lists to numbered or bulleted format\n" +
      "- Keep the factual content identical — only change style and remove noise\n" +
      "- Return ONLY the rewritten text, no explanations",
  },

  casual: {
    id: "casual",
    name: "Casual",
    description: "Light cleanup only. Keeps your natural voice.",
    prompt:
      "Lightly clean up this voice transcript. Rules:\n" +
      "- Remove obvious filler words (um, uh) but keep casual connectors (like, so, you know) if they sound natural\n" +
      "- Fix only clear grammar mistakes\n" +
      "- Add basic punctuation (periods, commas) but keep it casual\n" +
      "- Don't restructure sentences or change wording\n" +
      "- Don't convert to lists unless the speaker clearly intended a list\n" +
      "- Keep contractions and informal language\n" +
      "- Return ONLY the cleaned text",
  },

  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Just remove filler words. Nothing else changes.",
    prompt:
      "Remove filler words from this voice transcript. Rules:\n" +
      "- Remove: um, uh, like (when used as filler), you know, so (at start of sentence), basically, actually, right (when used as filler), I mean\n" +
      "- Do NOT change grammar, punctuation, or sentence structure\n" +
      "- Do NOT add formatting or lists\n" +
      "- Do NOT rephrase anything\n" +
      "- Only remove the filler words and clean up resulting double spaces\n" +
      "- Return ONLY the result",
  },

  structured: {
    id: "structured",
    name: "Structured",
    description: "Markdown format with headings, lists, and sections.",
    prompt:
      "Convert this voice transcript into well-structured Markdown. Rules:\n" +
      "- Remove all filler words\n" +
      "- Organize into logical sections with ## headings\n" +
      "- Use numbered lists for sequences and bullet points for items\n" +
      "- Use **bold** for key terms or action items\n" +
      "- Keep all factual content — only add structure\n" +
      "- If the text is short (1-2 sentences), don't over-structure — just clean it\n" +
      "- Return ONLY the Markdown text",
  },
};

const DEFAULT_PRESET_ID = "clean";

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
