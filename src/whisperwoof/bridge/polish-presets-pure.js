/**
 * Polish Presets — Pure data and lookup functions (no electron dependency).
 *
 * Extracted from polish-presets.js so that tests can import without mocking electron.
 * The main polish-presets.js re-exports everything from here and adds custom preset
 * persistence (which requires electron's app.getPath).
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
      "- LIST FORMATTING: When the speaker enumerates items (first/second/third, 1/2/3, or any sequential list), format each item on its own line as a numbered or bulleted list with a line break between items. Do NOT collapse lists into a single run-on sentence.\n" +
      "- PARAGRAPH SEPARATION: When the speaker shifts to a different topic or subject, start a new paragraph. Use your best judgment to detect topic changes — for example, switching from describing a task to discussing a meeting, or from one idea to a separate request. Insert a blank line between paragraphs.\n" +
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
      '- Use direct, confident statements ("We should redesign" not "I think maybe we should redesign")\n' +
      "- ALWAYS add proper punctuation: periods, commas, question marks\n" +
      "- Capitalize first word of each sentence\n" +
      "- LIST FORMATTING: Convert spoken lists to numbered or bulleted format with each item on its own line, separated by line breaks. Never collapse enumerated items into a single sentence.\n" +
      "- PARAGRAPH SEPARATION: When the speaker shifts topics, start a new paragraph with a blank line. Detect topic boundaries — e.g., switching from action items to a separate discussion point, or from one subject to another.\n" +
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
      "- If the speaker clearly intended a list (first/second/third, numbering items), format each item on its own line\n" +
      "- When the speaker shifts to a completely different topic, start a new paragraph with a blank line between them\n" +
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
      "- Organize into logical sections with ## headings — each distinct topic gets its own section\n" +
      "- Use numbered lists for sequences and bullet points for items, with each item on its own line\n" +
      "- Use **bold** for key terms or action items\n" +
      "- Separate different topics into distinct sections with blank lines between them\n" +
      "- Keep all factual content — only add structure\n" +
      "- If the text is short (1-2 sentences), don't over-structure — just clean it\n" +
      "- Return ONLY the Markdown text",
  },
};

const DEFAULT_PRESET_ID = "clean";

/**
 * Look up a preset prompt by ID, falling back to the clean preset.
 * Pure function — works with built-in presets only (no custom presets).
 */
function getBuiltInPresetPrompt(presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return PRESETS[DEFAULT_PRESET_ID].prompt;
  return preset.prompt;
}

/**
 * Look up a full preset object by ID, falling back to the clean preset.
 * Pure function — works with built-in presets only (no custom presets).
 */
function getBuiltInPreset(presetId) {
  return PRESETS[presetId] || PRESETS[DEFAULT_PRESET_ID];
}

module.exports = {
  PRESETS,
  DEFAULT_PRESET_ID,
  getBuiltInPresetPrompt,
  getBuiltInPreset,
};
