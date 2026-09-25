/**
 * Pure logic for the plugin command gate.
 *
 * No electron, no file I/O. plugin-bridge.js layers the native dialog and the
 * session's approvals on top; plugin-command.test.ts exercises these helpers.
 *
 * whisperwoof-plugins.json is renderer-writable — add/update-plugin IPC,
 * settings import, save-export-file — so a stored `command` is untrusted.
 * The main process spawns a command only after the user allows that exact
 * command in a native dialog. Built-in defaults ask too: they are `npx`
 * lines, and npx runs whatever is published under that package name.
 */

// Long enough for any real MCP launch line, short enough to read in a dialog.
const MAX_COMMAND_LENGTH = 2048;
const MAX_NAME_LENGTH = 60;

// Command tokens must be visible ASCII. Anything else (bidi overrides,
// zero-width or blank-looking characters) could make the dialog show
// something other than what runs.
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;
// Control and format characters stripped from the plugin name.
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}]/gu;

const ALLOW_BUTTON = 1;

/**
 * Split a stored command into what StdioClientTransport spawns. `display`
 * rebuilds the line from those same tokens, so the dialog shows exactly what
 * runs. Returns null for anything that can't be shown honestly.
 */
function parsePluginCommand(raw) {
  if (typeof raw !== "string" || raw.length > MAX_COMMAND_LENGTH) return null;
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.some((t) => !VISIBLE_ASCII.test(t))) {
    return null;
  }
  const [command, ...args] = tokens;
  return { command, args, display: tokens.join(" ") };
}

/**
 * Options for dialog.showMessageBox. Don't Allow is the default and the Esc
 * answer; Allow takes a click.
 */
function buildApprovalDialog(pluginName, display) {
  const name = String(pluginName ?? "")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE_CHARS, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return {
    type: "warning",
    buttons: ["Don't Allow", "Allow"],
    defaultId: 0,
    cancelId: 0,
    title: "Allow plugin command?",
    message: `Allow the plugin "${name}" to run this command?`,
    detail:
      `${display}\n\n` +
      "It runs on your Mac with your permissions. Allow it only if you set up this plugin and recognize the command. " +
      "WhisperWoof asks again if the command changes or after it restarts.",
  };
}

/**
 * Keep only the API-key env var the built-in plugin declares in its setup.
 * The key comes from the main-process defaults, never from the stored plugin,
 * so the renderer can't set PATH, NODE_OPTIONS and friends.
 */
function pickSetupEnv(pluginId, env, defaults) {
  const envKey = defaults.find((d) => d.id === pluginId)?.setup?.envKey;
  if (!envKey || !env || typeof env !== "object") return {};
  const value = env[envKey];
  return typeof value === "string" && value ? { [envKey]: value } : {};
}

module.exports = {
  ALLOW_BUTTON,
  parsePluginCommand,
  buildApprovalDialog,
  pickSetupEnv,
};
