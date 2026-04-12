/**
 * Style Learner — Adaptive polish that learns from user edits
 *
 * Captures before/after pairs when the user edits polished text.
 * Injects the best examples as few-shot demonstrations in the polish prompt.
 *
 * Competitive feature: Willow Voice learns writing style, SuperWhisper
 * remembers corrected spellings. WhisperWoof goes further — full style
 * adaptation via few-shot learning.
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-style-examples.json
 * Format: Array of { polished, edited, timestamp, similarity }
 * Max: 50 examples (oldest pruned first)
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  editDistance,
  shouldRecordStyleExample,
  buildPromptFromExamples,
} = require("./style-learner-pure");

const STYLE_FILE = path.join(app.getPath("userData"), "whisperwoof-style-examples.json");
const MAX_EXAMPLES = 50;

/**
 * Load style examples from disk.
 */
function loadExamples() {
  try {
    if (fs.existsSync(STYLE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STYLE_FILE, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load style examples", { error: err.message });
  }
  return [];
}

/**
 * Save style examples to disk.
 */
function saveExamples(examples) {
  try {
    fs.writeFileSync(STYLE_FILE, JSON.stringify(examples, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save style examples", { error: err.message });
  }
}

/**
 * Record a style example (polished text → user's edited version).
 * Only records if the edit is meaningful (>5% change).
 */
function recordStyleExample(polishedText, editedText) {
  if (!shouldRecordStyleExample(polishedText, editedText)) return false;

  const polished = polishedText.trim();
  const edited = editedText.trim();
  const distance = editDistance(polished, edited);
  const maxLen = Math.max(polished.length, edited.length);
  const ratio = distance / maxLen;

  const examples = loadExamples();

  // Dedup: skip if we already have a very similar example
  const isDuplicate = examples.some((ex) => {
    const d = editDistance(ex.polished, polished);
    return d / Math.max(ex.polished.length, polished.length) < 0.1;
  });
  if (isDuplicate) return false;

  const example = {
    polished: polished.slice(0, 500), // Cap length
    edited: edited.slice(0, 500),
    timestamp: new Date().toISOString(),
    editRatio: Math.round(ratio * 100) / 100,
  };

  examples.push(example);

  // Prune oldest if over limit
  const pruned = examples.length > MAX_EXAMPLES
    ? examples.slice(examples.length - MAX_EXAMPLES)
    : examples;

  saveExamples(pruned);

  debugLogger.info("[WhisperWoof] Style example recorded", {
    editRatio: example.editRatio,
    total: pruned.length,
  });

  return true;
}

/**
 * Build a few-shot style section to append to the polish prompt.
 * Loads examples from disk and delegates the pure scoring+formatting
 * to buildPromptFromExamples.
 */
function buildStylePrompt(inputText) {
  return buildPromptFromExamples(inputText, loadExamples());
}

/**
 * Get style learning stats (for settings UI).
 */
function getStyleStats() {
  const examples = loadExamples();
  return {
    exampleCount: examples.length,
    maxExamples: MAX_EXAMPLES,
    oldestExample: examples.length > 0 ? examples[0].timestamp : null,
    newestExample: examples.length > 0 ? examples[examples.length - 1].timestamp : null,
  };
}

/**
 * Clear all style examples (reset learning).
 */
function clearStyleExamples() {
  saveExamples([]);
  return { success: true };
}

/**
 * Get all style examples (for debugging/review).
 */
function getStyleExamples() {
  return loadExamples();
}

module.exports = {
  recordStyleExample,
  buildStylePrompt,
  getStyleStats,
  clearStyleExamples,
  getStyleExamples,
  editDistance,
};
