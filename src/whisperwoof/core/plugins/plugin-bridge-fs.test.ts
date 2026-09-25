/**
 * Plugin command gate against a real temp userData folder: whatever the
 * renderer writes into whisperwoof-plugins.json — add-plugin, settings
 * import — only runs after the user allows the exact command in the native
 * dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let userData = "";
let dialogResponse = 0;
const showMessageBox = vi.fn(async () => ({ response: dialogResponse }));

function load() {
  // The bridge is CommonJS and requires electron at load time.
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => userData, isReady: () => false },
      dialog: { showMessageBox },
    },
  } as unknown as NodeJS.Module;
  for (const mod of ["plugin-bridge", "settings-export"]) {
    delete require.cache[require.resolve(`../../bridge/${mod}.js`)];
  }
  return {
    bridge: require("../../bridge/plugin-bridge.js"),
    settings: require("../../bridge/settings-export.js"),
  };
}

function asking(command: string) {
  return expect.objectContaining({ detail: expect.stringContaining(command) });
}

function plugin(bridge: { getPlugins: () => { id: string }[] }, id: string) {
  return bridge.getPlugins().find((p) => p.id === id);
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "ww-plugins-"));
  dialogResponse = 0;
  showMessageBox.mockClear();
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("authorizePluginCommand", () => {
  it("asks even for a built-in command: npx runs whatever is published under that name", async () => {
    const { bridge } = load();
    dialogResponse = 1;
    const result = await bridge.authorizePluginCommand(plugin(bridge, "todoist"));
    expect(result).toEqual({ ok: true, command: "npx", args: ["@whisperwoof/todoist-mcp"] });
    expect(showMessageBox).toHaveBeenCalledWith(asking("npx @whisperwoof/todoist-mcp"));
  });

  it("asks before running a command added through add-plugin, and refuses on Don't Allow", async () => {
    const { bridge } = load();
    bridge.addPlugin({ id: "evil", name: "Evil", command: "sh -c whoami", enabled: true });
    const result = await bridge.authorizePluginCommand(plugin(bridge, "evil"));
    expect(result.ok).toBe(false);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledWith(asking("sh -c whoami"));
  });

  it("runs an allowed command, and doesn't ask again this session", async () => {
    const { bridge } = load();
    bridge.addPlugin({ id: "mine", name: "Mine", command: "npx my-mcp", enabled: true });
    dialogResponse = 1;
    expect(await bridge.authorizePluginCommand(plugin(bridge, "mine"))).toEqual({
      ok: true,
      command: "npx",
      args: ["my-mcp"],
    });
    expect(await bridge.authorizePluginCommand(plugin(bridge, "mine"))).toMatchObject({ ok: true });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("remembers a Don't Allow for the session, so the renderer can't keep asking", async () => {
    const { bridge } = load();
    bridge.addPlugin({ id: "evil", name: "Evil", command: "sh -c whoami", enabled: true });
    await bridge.authorizePluginCommand(plugin(bridge, "evil"));
    dialogResponse = 1;
    expect(await bridge.authorizePluginCommand(plugin(bridge, "evil"))).toMatchObject({
      ok: false,
    });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("shows one dialog when dispatches overlap", async () => {
    const { bridge } = load();
    bridge.addPlugin({ id: "mine", name: "Mine", command: "npx my-mcp", enabled: true });
    dialogResponse = 1;
    const results = await Promise.all([
      bridge.authorizePluginCommand(plugin(bridge, "mine")),
      bridge.authorizePluginCommand(plugin(bridge, "mine")),
    ]);
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true]);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("treats a dialog that fails to open as Don't Allow", async () => {
    const { bridge } = load();
    showMessageBox.mockRejectedValueOnce(new Error("no window"));
    expect(await bridge.authorizePluginCommand(plugin(bridge, "todoist"))).toMatchObject({
      ok: false,
    });
  });

  it("asks again after a restart", async () => {
    const first = load();
    first.bridge.addPlugin({ id: "mine", name: "Mine", command: "npx my-mcp", enabled: true });
    dialogResponse = 1;
    await first.bridge.authorizePluginCommand(plugin(first.bridge, "mine"));

    const { bridge } = load();
    dialogResponse = 0;
    expect(await bridge.authorizePluginCommand(plugin(bridge, "mine"))).toMatchObject({
      ok: false,
    });
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it("asks when settings import replaces a built-in plugin's command", async () => {
    const { bridge, settings } = load();
    const bundle = {
      appName: "WhisperWoof",
      data: {
        plugins: [{ id: "todoist", name: "Todoist", command: "sh -c whoami", enabled: true }],
      },
    };
    expect(settings.importSettings(bundle, { merge: false }).success).toBe(true);
    const result = await bridge.authorizePluginCommand(plugin(bridge, "todoist"));
    expect(result.ok).toBe(false);
    expect(showMessageBox).toHaveBeenCalledWith(asking("sh -c whoami"));
  });

  it("asks when settings import merges in a new plugin", async () => {
    const { bridge, settings } = load();
    const bundle = {
      appName: "WhisperWoof",
      data: { plugins: [{ id: "evil", name: "Evil", command: "sh -c whoami", enabled: true }] },
    };
    settings.importSettings(bundle, { merge: true });
    expect(await bridge.authorizePluginCommand(plugin(bridge, "evil"))).toMatchObject({
      ok: false,
    });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });
});

describe("updatePlugin env", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("sets only the API key the built-in plugin declares", () => {
    const { bridge } = load();
    const pathBefore = process.env.PATH;
    bridge.updatePlugin("todoist", {
      configured: true,
      env: { TODOIST_API_KEY: "abc", PATH: "/tmp/evil", NODE_OPTIONS: "--require /tmp/x.js" },
    });
    expect(process.env.TODOIST_API_KEY).toBe("abc");
    expect(process.env.PATH).toBe(pathBefore);
    expect(process.env.NODE_OPTIONS).toBe(saved.NODE_OPTIONS);
  });
});
