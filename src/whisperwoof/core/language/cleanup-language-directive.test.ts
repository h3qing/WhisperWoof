import { describe, it, expect } from "vitest";
import {
  getSystemPrompt,
  CLEANUP_LANGUAGE_DIRECTIVE,
} from "../../../config/prompts";

// Regression for: dictating in Chinese came back polished into English. The
// bundled local model (Qwen 2B) translates non-English speech because the cleanup
// prompt body + examples are all English. The fix hoists a strong same-language
// rule to the TOP of the cleanup prompt. Agent mode must still translate on
// command, so the directive is cleanup-only.
describe("cleanup language preservation", () => {
  it("prepends the same-language directive at the very top of the cleanup prompt", () => {
    // No transcript / no agent-name match => cleanup mode.
    const prompt = getSystemPrompt("Assistant", undefined, "auto", "随便说点什么", "en");
    expect(prompt.startsWith(CLEANUP_LANGUAGE_DIRECTIVE)).toBe(true);
    expect(prompt).toContain("Never translate");
  });

  it("keeps the same-language directive regardless of preferred language setting", () => {
    for (const lang of ["auto", "en", "zh-CN", undefined]) {
      const prompt = getSystemPrompt("Assistant", undefined, lang, "hello there", "en");
      expect(prompt.startsWith(CLEANUP_LANGUAGE_DIRECTIVE)).toBe(true);
    }
  });

  it("does NOT inject the cleanup directive in agent mode (so translate-on-command still works)", () => {
    // Transcript addresses the agent by name => full/agent prompt, not cleanup.
    const prompt = getSystemPrompt(
      "Jarvis",
      undefined,
      "auto",
      "Jarvis, translate this to Spanish",
      "en"
    );
    expect(prompt.startsWith(CLEANUP_LANGUAGE_DIRECTIVE)).toBe(false);
    expect(prompt).not.toContain(CLEANUP_LANGUAGE_DIRECTIVE);
  });
});
