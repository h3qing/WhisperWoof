/**
 * Tests for Privacy Lock Mode — URL / provider validation + overrides.
 *
 * Imports the real allowlist helpers from the pure bridge module so these
 * tests catch regressions in the production security checks. The persisted
 * state (loadState/saveState) and lock/unlock lifecycle live in
 * privacy-lock.js and are out of scope here.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_ALLOWED_LOCAL,
  PRIVACY_OVERRIDES,
  isUrlAllowedWhenLocked,
  isProviderAllowedWhenLocked,
} from "../../bridge/privacy-lock-pure";

describe("isUrlAllowedWhenLocked", () => {
  it("allows localhost URLs", () => {
    expect(isUrlAllowedWhenLocked("http://localhost:11434/api/chat")).toBe(true);
    expect(isUrlAllowedWhenLocked("http://127.0.0.1:11434/api/tags")).toBe(true);
    expect(isUrlAllowedWhenLocked("http://0.0.0.0:8080/test")).toBe(true);
  });

  it("blocks cloud URLs", () => {
    expect(isUrlAllowedWhenLocked("https://api.openai.com/v1/chat/completions")).toBe(false);
    expect(isUrlAllowedWhenLocked("https://api.anthropic.com/v1/messages")).toBe(false);
    expect(isUrlAllowedWhenLocked("https://api.groq.com/openai/v1/chat/completions")).toBe(false);
    expect(isUrlAllowedWhenLocked("https://api.todoist.com/rest/v2/tasks")).toBe(false);
  });

  it("blocks Telegram API", () => {
    expect(isUrlAllowedWhenLocked("https://api.telegram.org/bot123/getUpdates")).toBe(false);
  });

  it("blocks invalid URLs (fail-closed)", () => {
    expect(isUrlAllowedWhenLocked("not-a-url")).toBe(false);
    expect(isUrlAllowedWhenLocked("")).toBe(false);
  });

  it("handles localhost with port and path", () => {
    expect(isUrlAllowedWhenLocked("http://localhost:3000")).toBe(true);
    expect(isUrlAllowedWhenLocked("http://localhost:11434/api/chat")).toBe(true);
    expect(isUrlAllowedWhenLocked("http://localhost/deep/path/here")).toBe(true);
  });

  it("blocks local-looking but not actually local domains", () => {
    expect(isUrlAllowedWhenLocked("http://localhost.evil.com/steal")).toBe(false);
  });

  it("blocks private IP ranges (only explicit loopback passes)", () => {
    expect(isUrlAllowedWhenLocked("http://192.168.1.1:11434")).toBe(false);
    expect(isUrlAllowedWhenLocked("http://10.0.0.1:11434")).toBe(false);
  });

  it("honors a custom allowlist passed by the caller", () => {
    const custom = ["10.0.0.5"];
    expect(isUrlAllowedWhenLocked("http://10.0.0.5/path", custom)).toBe(true);
    expect(isUrlAllowedWhenLocked("http://localhost", custom)).toBe(false);
  });
});

describe("isProviderAllowedWhenLocked", () => {
  it("only allows ollama", () => {
    expect(isProviderAllowedWhenLocked("ollama")).toBe(true);
    expect(isProviderAllowedWhenLocked("openai")).toBe(false);
    expect(isProviderAllowedWhenLocked("anthropic")).toBe(false);
    expect(isProviderAllowedWhenLocked("groq")).toBe(false);
    expect(isProviderAllowedWhenLocked("")).toBe(false);
  });
});

describe("PRIVACY_OVERRIDES", () => {
  it("forces ollama provider and local STT", () => {
    expect(PRIVACY_OVERRIDES.provider).toBe("ollama");
    expect(PRIVACY_OVERRIDES.useLocalWhisper).toBe(true);
  });

  it("disables all cloud-dependent services", () => {
    expect(PRIVACY_OVERRIDES.cloudSttDisabled).toBe(true);
    expect(PRIVACY_OVERRIDES.telegramSyncPaused).toBe(true);
    expect(PRIVACY_OVERRIDES.analyticsDisabled).toBe(true);
    expect(PRIVACY_OVERRIDES.pluginNetworkBlocked).toBe(true);
  });

  it("is frozen so runtime mutation can't relax the lock", () => {
    expect(Object.isFrozen(PRIVACY_OVERRIDES)).toBe(true);
  });
});

describe("DEFAULT_ALLOWED_LOCAL", () => {
  it("recognizes all standard loopback addresses", () => {
    expect(DEFAULT_ALLOWED_LOCAL).toContain("localhost");
    expect(DEFAULT_ALLOWED_LOCAL).toContain("127.0.0.1");
    expect(DEFAULT_ALLOWED_LOCAL).toContain("0.0.0.0");
    expect(DEFAULT_ALLOWED_LOCAL).toContain("::1");
  });

  it("has exactly 4 allowed addresses", () => {
    expect(DEFAULT_ALLOWED_LOCAL).toHaveLength(4);
  });

  it("is frozen so runtime mutation can't widen the allowlist", () => {
    expect(Object.isFrozen(DEFAULT_ALLOWED_LOCAL)).toBe(true);
  });
});
