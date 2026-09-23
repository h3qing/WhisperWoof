/**
 * Fn+T copies the dictation instead of pasting it. The dictation overlay never
 * takes focus, and Chromium rejects navigator.clipboard.writeText from an
 * unfocused document ("Document is not focused"), so the copy silently failed.
 * The overlay must write through the main process's native clipboard.
 */
import { describe, it, expect, vi } from "vitest";
import { copyTextFromOverlay } from "./copy-to-clipboard";

describe("copyTextFromOverlay", () => {
  it("writes through the main process, never the renderer clipboard API", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const rendererWrite = vi.fn().mockRejectedValue(new Error("Document is not focused."));

    await copyTextFromOverlay("hello", { writeClipboard }, rendererWrite);

    expect(writeClipboard).toHaveBeenCalledWith("hello");
    expect(rendererWrite).not.toHaveBeenCalled();
  });

  it("falls back to the renderer API only when there is no bridge (browser preview)", async () => {
    const rendererWrite = vi.fn().mockResolvedValue(undefined);

    await copyTextFromOverlay("hello", undefined, rendererWrite);

    expect(rendererWrite).toHaveBeenCalledWith("hello");
  });

  it("surfaces a failed write so the caller doesn't claim it copied", async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(copyTextFromOverlay("hello", { writeClipboard }, vi.fn())).rejects.toThrow("boom");
  });
});
