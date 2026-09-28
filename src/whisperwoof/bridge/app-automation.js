/**
 * Voice-Driven App Automation — Control your Mac with voice
 *
 * Open apps, switch windows, and run system commands via voice.
 * Uses macOS osascript for app launching and window management.
 *
 * Examples:
 *   "Open Safari" → launches Safari
 *   "Switch to VS Code" → activates VS Code window
 *   "Close this window" → closes frontmost window
 *   "Open terminal" → launches Terminal
 *   "Turn on dark mode" → toggles system appearance
 *   "Mute" → mutes system volume
 *
 * Competitor: Alter (Mac-wide AI layer), VoiceOS (agentic layer).
 */

const { execFile } = require("child_process");
const debugLogger = require("../../helpers/debugLogger");

// --- App automation commands ---

const AUTOMATION_COMMANDS = {
  // Navigation (before generic "open" to avoid pattern conflicts)
  newTab: {
    id: "newTab",
    patterns: [/^new\s+tab$/i, /^open\s+(a\s+)?new\s+tab$/i],
    execute: () => runAppleScript('tell application "System Events" to keystroke "t" using command down'),
    label: "New tab",
  },
  newWindow: {
    id: "newWindow",
    patterns: [/^new\s+window$/i, /^open\s+(a\s+)?new\s+window$/i],
    execute: () => runAppleScript('tell application "System Events" to keystroke "n" using command down'),
    label: "New window",
  },

  // App launching
  open: {
    id: "open",
    patterns: [/^open\s+(.+)$/i, /^launch\s+(.+)$/i, /^start\s+(.+)$/i],
    execute: (match) => openApp(match),
    label: "Open app",
  },

  // Window switching
  switch: {
    id: "switch",
    patterns: [/^switch\s+to\s+(.+)$/i, /^go\s+to\s+(.+)$/i, /^activate\s+(.+)$/i],
    execute: (match) => switchToApp(match),
    label: "Switch to app",
  },

  // Window management
  close: {
    id: "close",
    patterns: [/^close\s+(this\s+)?(window|tab|app)$/i],
    execute: () => runAppleScript('tell application "System Events" to keystroke "w" using command down'),
    label: "Close window",
  },
  minimize: {
    id: "minimize",
    patterns: [/^minimize\s*(this)?$/i, /^hide\s+(this\s+)?window$/i],
    execute: () => runAppleScript('tell application "System Events" to keystroke "m" using command down'),
    label: "Minimize window",
  },
  fullscreen: {
    id: "fullscreen",
    patterns: [/^(full\s*screen|toggle\s+full\s*screen|maximize)$/i],
    execute: () => runAppleScript('tell application "System Events" to keystroke "f" using {command down, control down}'),
    label: "Toggle fullscreen",
  },

  // System controls
  mute: {
    id: "mute",
    patterns: [/^(mute|unmute|toggle\s+mute)$/i],
    execute: () => runAppleScript('set volume with output muted'),
    label: "Mute audio",
  },
  volumeUp: {
    id: "volumeUp",
    patterns: [/^(volume\s+up|louder|increase\s+volume)$/i],
    execute: () => runAppleScript('set volume output volume ((output volume of (get volume settings)) + 15)'),
    label: "Volume up",
  },
  volumeDown: {
    id: "volumeDown",
    patterns: [/^(volume\s+down|quieter|decrease\s+volume|lower\s+volume)$/i],
    execute: () => runAppleScript('set volume output volume ((output volume of (get volume settings)) - 15)'),
    label: "Volume down",
  },
  darkMode: {
    id: "darkMode",
    patterns: [/^(dark\s+mode|toggle\s+dark\s+mode|switch\s+to\s+dark|turn\s+on\s+dark\s+mode)$/i],
    execute: () => runAppleScript('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'),
    label: "Toggle dark mode",
  },
  doNotDisturb: {
    id: "doNotDisturb",
    patterns: [/^(do\s+not\s+disturb|dnd|focus\s+mode|turn\s+on\s+dnd)$/i],
    execute: () => runAppleScript('do shell script "shortcuts run \\"Focus\\""'),
    label: "Toggle Do Not Disturb",
  },
};

// --- Helpers ---

/**
 * Run AppleScript. `script` is one line or a list of lines; `args` reach the
 * script as `argv` (data, never source text, so an app name can't inject code).
 */
function runAppleScript(script, args = []) {
  if (process.platform !== "darwin") {
    return Promise.resolve({ success: false, error: "macOS only" });
  }

  const lines = Array.isArray(script) ? script : [script];
  const osaArgs = [...lines.flatMap((line) => ["-e", line]), ...args.map(String)];
  return new Promise((resolve) => {
    execFile("osascript", osaArgs, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        debugLogger.debug("[WhisperWoof] AppleScript error", { error: err.message });
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

// The app name arrives as data: quotes (straight or curly), backslashes and
// newlines in it can't end the string and run `do shell script`.
const ACTIVATE_APP_SCRIPT = ["on run argv", "tell application (item 1 of argv) to activate", "end run"];

function openApp(appName) {
  const name = String(appName ?? "").trim();
  if (!name) return Promise.resolve({ success: false, error: "No app name" });
  return runAppleScript(ACTIVATE_APP_SCRIPT, [name]);
}

function switchToApp(appName) {
  return openApp(appName);
}

// --- Detection ---

/**
 * Detect if spoken text is an automation command.
 * Returns { id, label, appName? } or null.
 */
function detectAutomationCommand(text) {
  if (!text || text.length < 3) return null;
  const trimmed = text.trim();

  for (const [, cmd] of Object.entries(AUTOMATION_COMMANDS)) {
    for (const pattern of cmd.patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return {
          id: cmd.id,
          label: cmd.label,
          appName: match[1] ? match[1].trim() : null,
        };
      }
    }
  }

  return null;
}

/**
 * Execute an automation command.
 */
async function executeAutomation(commandId, appName) {
  const cmd = AUTOMATION_COMMANDS[commandId];
  if (!cmd) return { success: false, error: `Unknown command: ${commandId}` };

  debugLogger.info("[WhisperWoof] Automation executing", { command: commandId, appName });

  const result = await cmd.execute(appName || "");
  return result;
}

/**
 * Get available automation commands (for help/UI).
 */
function getAutomationCommands() {
  return Object.values(AUTOMATION_COMMANDS).map(({ id, label }) => ({ id, label }));
}

module.exports = {
  detectAutomationCommand,
  executeAutomation,
  getAutomationCommands,
  AUTOMATION_COMMANDS,
};
