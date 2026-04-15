const debugLogger = require("../../helpers/debugLogger");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

// Plugins stored in a JSON file
const PLUGINS_FILE = path.join(app.getPath("userData"), "whisperwoof-plugins.json");

const DEFAULT_PLUGINS = [
    { id: "todoist", name: "Todoist", description: "Add tasks to Todoist", command: "npx @whisperwoof/todoist-mcp", enabled: false, hotkeyBinding: "Fn+T", setup: { envKey: "TODOIST_API_KEY", label: "API Token", url: "https://app.todoist.com/app/settings/integrations/developer", instructions: "Copy your API token from the Developer tab in Todoist Settings." } },
    { id: "ticktick", name: "TickTick", description: "Add tasks to TickTick", command: "npx @whisperwoof/ticktick-mcp", enabled: false, hotkeyBinding: null, setup: { envKey: "TICKTICK_ACCESS_TOKEN", label: "Access Token", url: "https://developer.ticktick.com/manage", instructions: "Create an app at the TickTick Developer portal, then use the OAuth2 flow to get an access token." } },
    { id: "notion", name: "Notion", description: "Save notes to Notion", command: "npx @whisperwoof/notion-mcp", enabled: false, hotkeyBinding: null, setup: { envKey: "NOTION_API_KEY", label: "Integration Token", url: "https://www.notion.so/my-integrations", instructions: "Create a new integration at notion.so/my-integrations, then copy the Internal Integration Secret." } },
    { id: "calendar", name: "Google Calendar", description: "Add events to Google Calendar", command: "npx @whisperwoof/calendar-mcp", enabled: false, hotkeyBinding: "Fn+C", setup: { envKey: "GOOGLE_CALENDAR_API_KEY", label: "API Key", url: "https://console.cloud.google.com/apis/credentials", instructions: "Create an OAuth2 credential in Google Cloud Console with Calendar API enabled." } },
    { id: "slack", name: "Slack", description: "Send messages to Slack", command: "npx @whisperwoof/slack-mcp", enabled: false, hotkeyBinding: null, setup: { envKey: "SLACK_BOT_TOKEN", label: "Bot Token", url: "https://api.slack.com/apps", instructions: "Create a Slack App, add chat:write scope, install to workspace, and copy the Bot User OAuth Token." } },
];

function loadPlugins() {
  try {
    if (fs.existsSync(PLUGINS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(PLUGINS_FILE, "utf-8"));
      // Merge in any new default plugins the user doesn't have yet
      const savedIds = new Set(saved.map(p => p.id));
      const missing = DEFAULT_PLUGINS.filter(d => !savedIds.has(d.id));
      if (missing.length > 0) {
        const merged = [...saved, ...missing];
        savePlugins(merged);
        return merged;
      }
      // Backfill setup metadata for existing plugins that were saved before setup info existed
      let needsSave = false;
      const backfilled = saved.map(p => {
        const def = DEFAULT_PLUGINS.find(d => d.id === p.id);
        if (def?.setup && !p.setup) {
          needsSave = true;
          return { ...p, setup: def.setup };
        }
        return p;
      });
      if (needsSave) savePlugins(backfilled);
      return backfilled;
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load plugins", { error: err.message });
  }
  return [...DEFAULT_PLUGINS];
}

function savePlugins(plugins) {
  try {
    fs.writeFileSync(PLUGINS_FILE, JSON.stringify(plugins, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save plugins", { error: err.message });
  }
}

function getPlugins() { return loadPlugins(); }

function updatePlugin(id, updates) {
  const plugins = loadPlugins();
  const idx = plugins.findIndex(p => p.id === id);
  if (idx === -1) return null;
  // If env is provided (API key from setup), store it securely via safeStorage
  // and set the key in process.env so child processes (MCP servers) can read it
  if (updates.env) {
    for (const [key, value] of Object.entries(updates.env)) {
      if (value) process.env[key] = value;
    }
  }
  const { env, ...rest } = updates;
  plugins[idx] = { ...plugins[idx], ...rest };
  savePlugins(plugins);
  return plugins[idx];
}

function addPlugin(config) {
  const plugins = loadPlugins();
  if (plugins.some(p => p.id === config.id)) return null; // duplicate
  plugins.push(config);
  savePlugins(plugins);
  return config;
}

function removePlugin(id) {
  const plugins = loadPlugins().filter(p => p.id !== id);
  savePlugins(plugins);
}

module.exports = { getPlugins, updatePlugin, addPlugin, removePlugin };
