const path = require("path");

/**
 * Argument construction for the sherpa-onnx websocket servers — pure, so the
 * exact command line each model kind produces is unit-testable without
 * spawning anything.
 *
 * Two model kinds run through the offline server:
 *   transducer   (Parakeet TDT)  --encoder/--decoder/--joiner
 *   sense-voice  (SenseVoice)    --sense-voice-model
 * The online server only runs transducers (Nemotron streaming).
 *
 * SenseVoice language is fixed to `auto` on purpose: it is a server-start
 * argument, not per-request, and auto is both what a zh/en code-switching
 * speaker needs and what eval/dictation-bench measured (17.3% MER). `use-itn`
 * matches the bench config too — it is what turns spoken numbers into digits.
 */
function buildServerArgs({ modelDir, runtime, kind, port, threads, onlineEndTailPaddingS }) {
  const modelArgs =
    kind === "sense-voice"
      ? [
          `--tokens=${path.join(modelDir, "tokens.txt")}`,
          `--sense-voice-model=${path.join(modelDir, "model.int8.onnx")}`,
          "--sense-voice-language=auto",
          "--sense-voice-use-itn=true",
        ]
      : [
          `--tokens=${path.join(modelDir, "tokens.txt")}`,
          `--encoder=${path.join(modelDir, "encoder.int8.onnx")}`,
          `--decoder=${path.join(modelDir, "decoder.int8.onnx")}`,
          `--joiner=${path.join(modelDir, "joiner.int8.onnx")}`,
        ];

  return [
    ...modelArgs,
    `--port=${port}`,
    ...(runtime === "online"
      ? [
          // --num-threads is ONNX intra-op parallelism for the single dictation
          // stream; --num-work-threads only spreads across concurrent streams.
          `--num-threads=${threads}`,
          "--num-work-threads=2",
          // Default 10ms decode-loop tick adds idle time to faster-than-realtime decode.
          "--loop-interval-ms=2",
          `--end-tail-padding=${onlineEndTailPaddingS}`,
          // Nonzero --warm-up aborts startup for non-zipformer2 models; _warmUp()
          // covers it app-side.
          "--warm-up=0",
        ]
      : [`--num-threads=${threads}`]),
  ];
}

module.exports = { buildServerArgs };
