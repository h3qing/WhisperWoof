const modelRegistryData = require("../models/modelRegistryData.json");

// Transducer exports (Parakeet TDT, Nemotron) ship four files; SenseVoice
// ships a single fused model. Which set a model needs is decided by its
// registry `modelType`, so downloads, isModelDownloaded and server args all
// agree on what "installed" means.
const TRANSDUCER_MODEL_FILES = [
  "encoder.int8.onnx",
  "decoder.int8.onnx",
  "joiner.int8.onnx",
  "tokens.txt",
];

const SENSE_VOICE_MODEL_FILES = ["model.int8.onnx", "tokens.txt"];

function getModelEntry(modelName) {
  return modelRegistryData.parakeetModels?.[modelName];
}

/** "sense-voice" for SenseVoice CTC models, "transducer" for everything else. */
function getModelKind(modelName) {
  return getModelEntry(modelName)?.modelType === "sense-voice" ? "sense-voice" : "transducer";
}

function getRequiredModelFiles(modelName) {
  return getModelKind(modelName) === "sense-voice"
    ? SENSE_VOICE_MODEL_FILES
    : TRANSDUCER_MODEL_FILES;
}

function getModelRuntime(modelName) {
  return getModelEntry(modelName)?.runtime === "online" ? "online" : "offline";
}

module.exports = {
  // Kept for callers that predate per-model file sets; new code should ask
  // getRequiredModelFiles(modelName) instead.
  REQUIRED_MODEL_FILES: TRANSDUCER_MODEL_FILES,
  TRANSDUCER_MODEL_FILES,
  SENSE_VOICE_MODEL_FILES,
  getModelKind,
  getRequiredModelFiles,
  getModelRuntime,
};
