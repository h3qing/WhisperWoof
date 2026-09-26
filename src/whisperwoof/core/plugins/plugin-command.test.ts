/**
 * Tests for the plugin command gate — `bridge/plugin-command-pure.js`.
 *
 * whisperwoof-plugins.json is renderer-writable (add/update-plugin IPC,
 * settings import, save-export-file), so the main process treats a stored
 * `command` as untrusted: it spawns only a command the user allowed in a
 * native dialog. `plugin-bridge.js` layers the dialog and the session's
 * approvals on top of these helpers.
 */

import { describe, it, expect } from "vitest";
import {
  ALLOW_BUTTON,
  parsePluginCommand,
  buildApprovalDialog,
  pickSetupEnv,
} from "../../bridge/plugin-command-pure";

const DEFAULTS = [
  { id: "todoist", command: "npx @whisperwoof/todoist-mcp", setup: { envKey: "TODOIST_API_KEY" } },
  { id: "slack", command: "npx @whisperwoof/slack-mcp", setup: { envKey: "SLACK_BOT_TOKEN" } },
];

describe("parsePluginCommand", () => {
  it("splits a command into the binary and its args", () => {
    expect(parsePluginCommand("npx @whisperwoof/todoist-mcp --verbose")).toEqual({
      command: "npx",
      args: ["@whisperwoof/todoist-mcp", "--verbose"],
      display: "npx @whisperwoof/todoist-mcp --verbose",
    });
  });

  it("shows exactly the tokens that run, on one line", () => {
    const parsed = parsePluginCommand("  npx   my-mcp\n\n\n\n\nsh\t-c ");
    expect(parsed?.args).toEqual(["my-mcp", "sh", "-c"]);
    expect(parsed?.display).toBe("npx my-mcp sh -c");
  });

  it("rejects missing, non-string and blank commands", () => {
    expect(parsePluginCommand(undefined)).toBeNull();
    expect(parsePluginCommand(42)).toBeNull();
    expect(parsePluginCommand("")).toBeNull();
    expect(parsePluginCommand("   \n ")).toBeNull();
  });

  it("rejects invisible and blank-looking characters that could make the dialog lie", () => {
    expect(parsePluginCommand("npx my-mcp \u202Ehs.live")).toBeNull(); // right-to-left override
    expect(parsePluginCommand("npx\u200B my-mcp")).toBeNull(); // zero-width space
    expect(parsePluginCommand("npx my-mcp\u0000")).toBeNull();
    expect(parsePluginCommand(`npx my-mcp ${"\u2800".repeat(1500)} --evil`)).toBeNull(); // braille blank
    expect(parsePluginCommand("npx my-mcp \u3164")).toBeNull(); // hangul filler
  });

  it("accepts only visible ASCII, so a non-ASCII path is refused too", () => {
    expect(parsePluginCommand("/Users/jos\u00E9/bin/mcp")).toBeNull();
  });

  it("rejects commands too long to show in a dialog", () => {
    expect(parsePluginCommand(`npx ${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("buildApprovalDialog", () => {
  it("shows the exact command and defaults to Don't Allow", () => {
    const opts = buildApprovalDialog("My Tool", "npx my-mcp --flag");
    expect(opts.detail).toContain("npx my-mcp --flag");
    expect(opts.message).toContain("My Tool");
    expect(opts.buttons[ALLOW_BUTTON]).toBe("Allow");
    expect(opts.defaultId).not.toBe(ALLOW_BUTTON);
    expect(opts.cancelId).not.toBe(ALLOW_BUTTON);
  });

  it("flattens a plugin name that tries to add its own lines to the dialog", () => {
    const opts = buildApprovalDialog("Todoist\n\nVerified safe by WhisperWoof\u202E", "npx x");
    expect(opts.message).not.toContain("\n");
    expect(opts.message).not.toContain("\u202E");
  });

  it("caps a very long plugin name", () => {
    const opts = buildApprovalDialog("x".repeat(500), "npx x");
    expect(opts.message.length).toBeLessThan(150);
  });
});

describe("pickSetupEnv", () => {
  it("keeps the API key env var the built-in plugin declares", () => {
    expect(pickSetupEnv("todoist", { TODOIST_API_KEY: "abc" }, DEFAULTS)).toEqual({
      TODOIST_API_KEY: "abc",
    });
  });

  it("drops env vars that would change what runs", () => {
    const env = { TODOIST_API_KEY: "abc", PATH: "/tmp/evil", NODE_OPTIONS: "--require /tmp/x.js" };
    expect(pickSetupEnv("todoist", env, DEFAULTS)).toEqual({ TODOIST_API_KEY: "abc" });
  });

  it("drops another plugin's key", () => {
    expect(pickSetupEnv("todoist", { SLACK_BOT_TOKEN: "abc" }, DEFAULTS)).toEqual({});
  });

  it("allows nothing for custom plugins", () => {
    expect(pickSetupEnv("my-tool", { PATH: "/tmp/evil" }, DEFAULTS)).toEqual({});
  });

  it("ignores empty and non-string values", () => {
    expect(pickSetupEnv("todoist", { TODOIST_API_KEY: "" }, DEFAULTS)).toEqual({});
    expect(pickSetupEnv("todoist", { TODOIST_API_KEY: 5 }, DEFAULTS)).toEqual({});
    expect(pickSetupEnv("todoist", null, DEFAULTS)).toEqual({});
  });
});
