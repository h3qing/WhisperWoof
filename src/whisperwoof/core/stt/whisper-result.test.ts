/**
 * What whisper-server hands back is what gets pasted, so the parse is where a
 * broken full-width comma ("�", see core/language/lost-punctuation.js) and
 * segment newlines are settled.
 */
import os from "os";
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => os.tmpdir()), isPackaged: false },
  net: {},
}));

const { default: WhisperManager } = await import("../../../helpers/whisper").then((m) => ({
  default: (m.default ?? m) as new () => {
    parseWhisperResult: (output: unknown) => { success: boolean; text?: string; message?: string };
  },
}));

describe("WhisperManager.parseWhisperResult", () => {
  const whisper = new WhisperManager();

  it("pastes commas, not '�', for a Chinese dictation Whisper Turbo broke", () => {
    const result = whisper.parseWhisperResult({
      text: "方便查询�看这个数据有多大的影响�如果对实际生产造成影响的话�可以酌情调整\n",
      language: "chinese",
    });
    expect(result).toEqual({
      success: true,
      text: "方便查询，看这个数据有多大的影响，如果对实际生产造成影响的话，可以酌情调整",
      language: "chinese",
    });
  });

  it("treats a transcript of nothing but broken bytes as no audio", () => {
    expect(whisper.parseWhisperResult({ text: " � \n" })).toEqual({
      success: false,
      message: "No audio detected",
    });
  });
});
