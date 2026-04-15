/**
 * Tests for Vibe Coding — voice-to-code dictation.
 *
 * Imports `hasCodeIntent`, `getCodingPrompt`, and the `CODE_MODE_APPS` /
 * `SHELL_MODE_APPS` registries directly from the real bridge/vibe-coding.js
 * module. Source only requires debugLogger — direct import works.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  hasCodeIntent,
  getCodingPrompt,
  isCodeModeApp,
  isShellModeApp,
  CODE_MODE_APPS,
  SHELL_MODE_APPS,
  CODE_PROMPT,
  SHELL_PROMPT,
} from "../../bridge/vibe-coding";

describe("hasCodeIntent", () => {
  it("detects function / class creation", () => {
    expect(hasCodeIntent("create a function that takes a list of numbers and returns the sum")).toBe(true);
    expect(hasCodeIntent("write a method to validate email addresses")).toBe(true);
    expect(hasCodeIntent("make a component called UserProfile")).toBe(true);
  });

  it("detects import statements", () => {
    expect(hasCodeIntent("import react and use state")).toBe(true);
    expect(hasCodeIntent("require express and set up a server")).toBe(true);
  });

  it("detects control flow wrapping", () => {
    expect(hasCodeIntent("add a try catch around that block")).toBe(true);
    expect(hasCodeIntent("wrap this in an if else statement")).toBe(true);
    expect(hasCodeIntent("create a for loop that iterates over the array")).toBe(true);
  });

  it("detects variable declarations", () => {
    expect(hasCodeIntent("declare a constant for the API URL")).toBe(true);
    expect(hasCodeIntent("add a useState hook for the loading state")).toBe(true);
  });

  it("detects data structures", () => {
    expect(hasCodeIntent("create an array of user objects")).toBe(true);
    expect(hasCodeIntent("return a new promise that resolves after 5 seconds")).toBe(true);
  });

  it("detects common operations", () => {
    expect(hasCodeIntent("filter the list to only include active users")).toBe(true);
    expect(hasCodeIntent("map over the items and extract the names")).toBe(true);
    expect(hasCodeIntent("fetch data from the API endpoint")).toBe(true);
  });

  it("detects React hooks", () => {
    expect(hasCodeIntent("add a useEffect that runs on mount")).toBe(true);
    expect(hasCodeIntent("create a useCallback for the submit handler")).toBe(true);
  });

  it("detects shell commands", () => {
    expect(hasCodeIntent("run npm install")).toBe(true);
    expect(hasCodeIntent("git commit with message fix typo")).toBe(true);
    expect(hasCodeIntent("install the latest version of express")).toBe(true);
  });

  it("returns false for normal prose", () => {
    expect(hasCodeIntent("I need to buy groceries for dinner tonight")).toBe(false);
    expect(hasCodeIntent("The meeting is at 3pm in the conference room")).toBe(false);
    expect(hasCodeIntent("Please send the report to Sarah by Friday")).toBe(false);
    expect(hasCodeIntent("Remember to call the dentist tomorrow morning")).toBe(false);
  });

  it("returns false for short / empty input", () => {
    expect(hasCodeIntent("")).toBe(false);
    expect(hasCodeIntent(null)).toBe(false);
    expect(hasCodeIntent("hi")).toBe(false);
  });
});

describe("getCodingPrompt — mode selection", () => {
  it('returns "code" mode + CODE_PROMPT for IDE + code intent', () => {
    const result = getCodingPrompt("com.microsoft.VSCode", "create a function to sum numbers");
    expect(result.mode).toBe("code");
    expect(result.prompt).toBe(CODE_PROMPT);
  });

  it('returns "code" for Cursor (com.todesktop.230313mzl4w4u92)', () => {
    const result = getCodingPrompt("com.todesktop.230313mzl4w4u92", "import react");
    expect(result.mode).toBe("code");
  });

  it('returns "code" for Xcode with code intent', () => {
    const result = getCodingPrompt("com.apple.dt.Xcode", "add a try catch");
    expect(result.mode).toBe("code");
  });

  it('returns "prose" for IDE + no code intent (prompt: null)', () => {
    const result = getCodingPrompt("com.microsoft.VSCode", "this is a comment about the meeting");
    expect(result.mode).toBe("prose");
    expect(result.prompt).toBeNull();
  });

  it('returns "shell" mode + SHELL_PROMPT for terminal apps', () => {
    const iterm = getCodingPrompt("com.googlecode.iterm2", "list all files");
    expect(iterm.mode).toBe("shell");
    expect(iterm.prompt).toBe(SHELL_PROMPT);

    expect(getCodingPrompt("com.apple.Terminal", "check disk space").mode).toBe("shell");
    expect(getCodingPrompt("dev.warp.Warp-Stable", "run the tests").mode).toBe("shell");
  });

  it('returns "prose" for non-IDE apps even with code-like text', () => {
    expect(getCodingPrompt("com.apple.mail", "create a function").mode).toBe("prose");
    expect(getCodingPrompt("com.tinyspeck.slackmacgap", "import react").mode).toBe("prose");
    expect(getCodingPrompt(null, "create a function").mode).toBe("prose");
  });
});

describe("app registries", () => {
  it("isCodeModeApp recognizes major IDEs", () => {
    expect(isCodeModeApp("com.microsoft.VSCode")).toBe(true);
    expect(isCodeModeApp("com.todesktop.230313mzl4w4u92")).toBe(true);
    expect(isCodeModeApp("com.apple.dt.Xcode")).toBe(true);
    expect(isCodeModeApp("dev.zed.Zed")).toBe(true);
  });

  it("isShellModeApp recognizes major terminals", () => {
    expect(isShellModeApp("com.googlecode.iterm2")).toBe(true);
    expect(isShellModeApp("com.apple.Terminal")).toBe(true);
  });

  it("no overlap between code and shell app sets", () => {
    for (const app of CODE_MODE_APPS) {
      expect(SHELL_MODE_APPS.has(app)).toBe(false);
    }
  });

  it("unknown bundle IDs return false for both modes", () => {
    expect(isCodeModeApp("com.unknown.app")).toBe(false);
    expect(isShellModeApp("com.unknown.app")).toBe(false);
  });
});
