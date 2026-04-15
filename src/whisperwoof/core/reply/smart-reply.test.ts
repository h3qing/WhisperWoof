/**
 * Tests for Smart Reply — reply detection and mode mapping.
 *
 * Imports `isReplyIntent`, `getReplyMode`, `REPLY_SIGNALS`, and
 * `APP_REPLY_MODE` directly from the real bridge/smart-reply.js module.
 * The LLM draft call (`draftReply`) is a network path and is out of scope.
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
  isReplyIntent,
  getReplyMode,
  getReplyModes,
  REPLY_SIGNALS,
  REPLY_PROMPTS,
  APP_REPLY_MODE,
} from "../../bridge/smart-reply";

describe("isReplyIntent", () => {
  it('detects "reply" keywords', () => {
    expect(isReplyIntent("Reply to Sarah about the meeting")).toBe(true);
    expect(isReplyIntent("I need to respond to the email")).toBe(true);
    expect(isReplyIntent("Write back to the client")).toBe(true);
  });

  it('detects "tell them" patterns', () => {
    expect(isReplyIntent("Tell them we agree with the proposal")).toBe(true);
    expect(isReplyIntent("Let him know the meeting is moved")).toBe(true);
    expect(isReplyIntent("Tell the team we're on track")).toBe(true);
  });

  it("detects casual reply patterns", () => {
    expect(isReplyIntent("Say yes to the dinner invite")).toBe(true);
    expect(isReplyIntent("That works for me, sounds good")).toBe(true);
    expect(isReplyIntent("I agree with their approach")).toBe(true);
  });

  it("detects message-back patterns", () => {
    expect(isReplyIntent("Email them back with the updated timeline")).toBe(true);
    expect(isReplyIntent("Slack him the meeting notes")).toBe(true);
    expect(isReplyIntent("DM her the link")).toBe(true);
  });

  it('detects "regarding" patterns', () => {
    expect(isReplyIntent("Regarding their proposal, we should accept")).toBe(true);
    expect(isReplyIntent("In response to the budget question")).toBe(true);
  });

  it("returns false for non-reply text", () => {
    expect(isReplyIntent("I need to buy groceries")).toBe(false);
    expect(isReplyIntent("Schedule a meeting for Friday")).toBe(false);
    expect(isReplyIntent("Create a new function for the API")).toBe(false);
  });

  it("returns false for short / null input", () => {
    expect(isReplyIntent("")).toBe(false);
    expect(isReplyIntent(null)).toBe(false);
    expect(isReplyIntent("hi")).toBe(false);
  });
});

describe("getReplyMode", () => {
  it("maps email apps to email mode", () => {
    expect(getReplyMode("com.apple.mail")).toBe("email");
    expect(getReplyMode("com.microsoft.Outlook")).toBe("email");
    expect(getReplyMode("com.superhuman.electron")).toBe("email");
  });

  it("maps chat apps to slack mode", () => {
    expect(getReplyMode("com.tinyspeck.slackmacgap")).toBe("slack");
    expect(getReplyMode("com.hnc.Discord")).toBe("slack");
    expect(getReplyMode("com.microsoft.teams2")).toBe("slack");
    expect(getReplyMode("ru.keepcoder.Telegram")).toBe("slack");
  });

  it("maps IDEs to comment mode", () => {
    expect(getReplyMode("com.microsoft.VSCode")).toBe("comment");
    expect(getReplyMode("com.apple.dt.Xcode")).toBe("comment");
    expect(getReplyMode("dev.zed.Zed")).toBe("comment");
  });

  it("defaults to general for unknown apps", () => {
    expect(getReplyMode("com.unknown.app")).toBe("general");
    expect(getReplyMode(null)).toBe("general");
  });
});

describe("REPLY_SIGNALS registry", () => {
  it("has 5 detection patterns", () => {
    expect(REPLY_SIGNALS).toHaveLength(5);
  });

  it("every entry is a RegExp", () => {
    for (const sig of REPLY_SIGNALS) {
      expect(sig).toBeInstanceOf(RegExp);
    }
  });
});

describe("reply modes", () => {
  it("has 4 reply modes: email, slack, comment, general", () => {
    const ids = Object.keys(REPLY_PROMPTS).sort();
    expect(ids).toEqual(["comment", "email", "general", "slack"]);
  });

  it("every mode has a non-empty prompt", () => {
    for (const mode of Object.values(REPLY_PROMPTS) as { id: string; name: string; prompt: string }[]) {
      expect(mode.id).toBeTruthy();
      expect(mode.name).toBeTruthy();
      expect(mode.prompt.length).toBeGreaterThan(30);
    }
  });

  it("getReplyModes returns every registered mode with id+name", () => {
    const list = getReplyModes() as { id: string; name: string }[];
    expect(list).toHaveLength(Object.keys(REPLY_PROMPTS).length);
    for (const m of list) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
    }
  });
});

describe("APP_REPLY_MODE coverage", () => {
  it("all mapped modes exist in REPLY_PROMPTS", () => {
    const validModes = new Set(Object.keys(REPLY_PROMPTS));
    for (const mode of Object.values(APP_REPLY_MODE) as string[]) {
      expect(validModes.has(mode)).toBe(true);
    }
  });
});
