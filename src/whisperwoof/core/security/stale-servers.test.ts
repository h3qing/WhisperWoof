/**
 * The startup sweep for crashed whisper-server / llama-server processes only
 * kills the app's own binaries, never a same-named process of the user's.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../helpers/debugLogger", () => ({
  default: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { pickStaleServerPids }: any = await import("../../../helpers/sidecarReaper").then(
  (m: any) => m.default ?? m
);

const BIN = "/Applications/WhisperWoof.app/Contents/Resources/bin";
const USER_BIN = "/Users/me/Library/Application Support/WhisperWoof/bin";

describe("pickStaleServerPids", () => {
  it("picks only servers started from the app's bin folders", () => {
    const ps = [
      ` 101 ${BIN}/whisper-server-darwin-arm64 --model x --port 8178`,
      ` 102 /usr/local/bin/llama-server --model mine.gguf`,
      ` 103 vim ${BIN}/whisper-server-darwin-arm64`,
      ` 104 ${USER_BIN}/llama-server-vulkan --port 8200`,
      ` 105 ${BIN}/sherpa-onnx-ws-darwin-arm64 --port=6006`,
      ` 106 ${BIN}-evil/whisper-server --port 1`,
      ` 107 ${BIN}/sub/whisper-server`,
    ].join("\n");
    expect(pickStaleServerPids(ps, [BIN, USER_BIN, undefined])).toEqual([101, 104]);
  });

  it("finds nothing in empty or junk output", () => {
    expect(pickStaleServerPids("", [BIN])).toEqual([]);
    expect(pickStaleServerPids("PID COMMAND\nnot a line", [BIN])).toEqual([]);
  });
});
