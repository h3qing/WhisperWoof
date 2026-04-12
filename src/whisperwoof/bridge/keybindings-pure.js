/**
 * Pure logic for Keybinding Customization.
 *
 * No file I/O, no electron. Shared between keybindings.js (which layers
 * on the on-disk override store) and keybindings.test.ts.
 *
 * These are the correctness-critical gates: key-combo format validation,
 * the default-binding registry, the defaults-merged-with-overrides
 * computation, and the conflict detector. Any drift here silently
 * breaks hotkey behavior — at best two actions shadow each other, at
 * worst a user-configured combo never fires.
 */

/**
 * Default keybindings — the single source of truth for every action's
 * out-of-the-box combo. Exported so tests and production agree on the
 * set of actions *and* their default keys.
 */
const DEFAULT_KEYBINDINGS = Object.freeze({
  // Core actions
  "toggle-recording": { key: "Fn", label: "Toggle recording", category: "core" },
  "command-bar": { key: "CommandOrControl+K", label: "Command bar", category: "core" },
  "paste-at-cursor": { key: "Fn", label: "Paste at cursor", category: "routing" },

  // Routing
  "save-markdown": { key: "Fn+N", label: "Save as Markdown", category: "routing" },
  "route-project": { key: "Fn+P", label: "Route to project", category: "routing" },
  "route-todo": { key: "Fn+T", label: "Route to todo", category: "routing" },

  // Navigation
  "open-history": { key: "CommandOrControl+H", label: "Open history", category: "navigation" },
  "open-settings": { key: "CommandOrControl+,", label: "Open settings", category: "navigation" },
  "open-projects": { key: "CommandOrControl+P", label: "Open projects", category: "navigation" },

  // Focus mode
  "start-focus": { key: "CommandOrControl+Shift+F", label: "Start focus sprint", category: "focus" },
  "end-focus": { key: "CommandOrControl+Shift+E", label: "End focus sprint", category: "focus" },

  // Privacy
  "toggle-privacy": { key: "CommandOrControl+Shift+L", label: "Toggle privacy lock", category: "privacy" },
});

/**
 * Categories shown in the grouped settings UI. Exported so tests can
 * assert that every default binding belongs to a real category.
 */
const CATEGORIES = Object.freeze([
  { id: "core", name: "Core", description: "Recording and command bar" },
  { id: "routing", name: "Routing", description: "Where voice text goes" },
  { id: "navigation", name: "Navigation", description: "Open panels and views" },
  { id: "focus", name: "Focus", description: "Focus sprint controls" },
  { id: "privacy", name: "Privacy", description: "Privacy lock" },
]);

/**
 * Valid key combo format: modifier+key or a standalone key name.
 * Examples: "CommandOrControl+K", "Fn+N", "Shift+Enter", "F5".
 */
const KEY_COMBO_PATTERN = /^(Fn|F[1-9]|F1[0-2]|[A-Z]|[0-9]|Space|Enter|Tab|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|,|\.|\[|\]|\\|\/|;|'|`|-|=)$|^(CommandOrControl|Cmd|Ctrl|Alt|Shift|Fn)\+/i;

/**
 * Validate a proposed key combo string against KEY_COMBO_PATTERN.
 */
function isValidKeyCombo(key) {
  if (!key || typeof key !== "string") return false;
  return KEY_COMBO_PATTERN.test(key.trim());
}

/**
 * Merge defaults with user overrides into a flat array of bindings
 * suitable for the settings UI. Each entry carries the current key,
 * the default key, and an `isCustom` flag so the UI can show a "reset"
 * affordance.
 */
function mergeWithOverrides(overrides = {}) {
  return Object.entries(DEFAULT_KEYBINDINGS).map(([actionId, def]) => ({
    actionId,
    key: overrides[actionId]?.key || def.key,
    label: def.label,
    category: def.category,
    isCustom: !!overrides[actionId]?.key,
    defaultKey: def.key,
  }));
}

/**
 * Detect a key-combo conflict: if any OTHER binding in the list already
 * uses `newKey`, return its actionId. Case-insensitive match (so
 * "cmd+k" and "Cmd+K" count as the same combo). Returns null if no
 * conflict. Rebinding an action to its own key is NOT a conflict.
 */
function detectConflict(bindings, actionId, newKey) {
  if (!newKey) return null;
  const lower = newKey.toLowerCase();
  for (const b of bindings || []) {
    if (b.actionId !== actionId && b.key.toLowerCase() === lower) {
      return b.actionId;
    }
  }
  return null;
}

/**
 * Validate a keybindings export bundle. Returns null if valid, or a
 * human-readable error string. Mirrors the shape produced by
 * exportKeybindings in keybindings.js.
 */
function validateKeybindingBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return "Invalid keybinding export file";
  }
  if (bundle.appName !== "WhisperWoof" || bundle.type !== "keybindings") {
    return "Invalid keybinding export file";
  }
  if (!bundle.bindings || typeof bundle.bindings !== "object") {
    return "No bindings found in export";
  }
  return null;
}

module.exports = {
  DEFAULT_KEYBINDINGS,
  CATEGORIES,
  KEY_COMBO_PATTERN,
  isValidKeyCombo,
  mergeWithOverrides,
  detectConflict,
  validateKeybindingBundle,
};
