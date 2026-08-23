/**
 * The exact command lines the sherpa websocket servers are spawned with.
 * Verified against the real v1.13.4 binaries' --help on 2026-08-23: the
 * offline server accepts --sense-voice-model/--sense-voice-language/
 * --sense-voice-use-itn, and both servers take --tokens/--port/--num-threads.
 */
import { describe, it, expect } from "vitest";
import { buildServerArgs } from "../../../helpers/sherpaServerArgs.js";
import {
  getModelKind,
  getModelRuntime,
  getRequiredModelFiles,
} from "../../../helpers/parakeetModelInfo.js";

describe("buildServerArgs", () => {
  it("builds transducer args with all four model files", () => {
    const args = buildServerArgs({
      modelDir: "/m/parakeet-tdt-0.6b-v3",
      runtime: "offline",
      kind: "transducer",
      port: 6006,
      threads: 3,
      onlineEndTailPaddingS: 0.6,
    });
    expect(args).toContain("--encoder=/m/parakeet-tdt-0.6b-v3/encoder.int8.onnx");
    expect(args).toContain("--joiner=/m/parakeet-tdt-0.6b-v3/joiner.int8.onnx");
    expect(args).toContain("--port=6006");
    expect(args).toContain("--num-threads=3");
    expect(args.join(" ")).not.toContain("sense-voice");
  });

  it("builds SenseVoice args with the fused model and auto language", () => {
    const args = buildServerArgs({
      modelDir: "/m/sense-voice-zh-en",
      runtime: "offline",
      kind: "sense-voice",
      port: 6007,
      threads: 4,
      onlineEndTailPaddingS: 0.6,
    });
    expect(args).toContain("--sense-voice-model=/m/sense-voice-zh-en/model.int8.onnx");
    expect(args).toContain("--sense-voice-language=auto");
    expect(args).toContain("--sense-voice-use-itn=true");
    // A transducer flag pointing at a file SenseVoice does not ship would
    // crash the server at startup.
    expect(args.join(" ")).not.toContain("--encoder");
  });

  it("adds the streaming knobs only for the online runtime", () => {
    const online = buildServerArgs({
      modelDir: "/m/nemotron",
      runtime: "online",
      kind: "transducer",
      port: 6008,
      threads: 3,
      onlineEndTailPaddingS: 0.6,
    });
    expect(online).toContain("--end-tail-padding=0.6");
    expect(online).toContain("--warm-up=0");
    const offline = buildServerArgs({
      modelDir: "/m/x",
      runtime: "offline",
      kind: "transducer",
      port: 6009,
      threads: 3,
      onlineEndTailPaddingS: 0.6,
    });
    expect(offline.join(" ")).not.toContain("end-tail-padding");
  });
});

describe("parakeetModelInfo registry wiring", () => {
  it("marks the Nemotron models as online and SenseVoice as sense-voice", () => {
    expect(getModelRuntime("nemotron-3.5-asr-streaming-0.6b")).toBe("online");
    expect(getModelRuntime("nemotron-speech-streaming-en-0.6b")).toBe("online");
    expect(getModelRuntime("sense-voice-zh-en")).toBe("offline");
    expect(getModelKind("sense-voice-zh-en")).toBe("sense-voice");
    expect(getModelKind("parakeet-tdt-0.6b-v3")).toBe("transducer");
  });

  it("expects the file set each archive actually ships", () => {
    // Verified against the extracted archives on 2026-08-23.
    expect(getRequiredModelFiles("sense-voice-zh-en")).toEqual(["model.int8.onnx", "tokens.txt"]);
    expect(getRequiredModelFiles("nemotron-3.5-asr-streaming-0.6b")).toEqual([
      "encoder.int8.onnx",
      "decoder.int8.onnx",
      "joiner.int8.onnx",
      "tokens.txt",
    ]);
  });

  it("treats an unknown model as an offline transducer", () => {
    expect(getModelRuntime("mystery")).toBe("offline");
    expect(getModelKind("mystery")).toBe("transducer");
  });
});
