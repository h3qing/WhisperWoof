const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");
const LlamaServerManager = require("./llamaServer");
const {
  downloadFile,
  createDownloadSignal,
  createDownloadInProgressError,
  cleanupStaleDownloads,
  checkDiskSpace,
} = require("./downloadUtils");
const { getModelsDirForService } = require("./modelDirUtils");
const {
  isWavFormat,
  parseWavFormat,
  pcmToWav,
  convertBufferToWav,
  wavToFloat32Samples,
} = require("./ffmpegUtils");
const { splitAtLulls } = require("./meetingLocalTranscription");
const modelRegistryData = require("../models/modelRegistryData.json");
const { parseQwenAsrOutput, joinTranscripts } = require("../whisperwoof/core/audio/qwen-asr-output");
const {
  levelStats,
  isSteadyNoise,
  isNoiseHallucination,
} = require("../whisperwoof/core/audio/steady-noise");

// Its own llama-server, next to the cleanup model's (8200-8220): neither
// waits on, restarts or shares a key with the other.
const PORT_RANGE = [8221, 8240];
// One slot, and no prompt cache: llama-server's default 8 GB cache degrades
// results and grows the process to 12 GB (eval/real-dictation/RESULTS.md).
const SERVER_ARGS = ["--ctx-size", "8192", "--parallel", "1", "--cache-ram", "0"];
// Audio takes ~13 tokens a second: 8 min fill the 8192-token context and a
// longer capture's text would be cut off. Longer captures are decoded in
// pieces of at most 5 min, cut at the quietest moment after 4; a tail under
// 30 s joins the piece before it (5.5 min still leaves room for the text).
const PIECE_SECONDS = { minS: 240, maxS: 300, spanMs: 400 };
const MIN_TAIL_SECONDS = 30;
const WAV_BYTES_PER_SECOND = 16000 * 2;
// Memory / Dictionary words (the 560-character STT hint) as context.
const MAX_CONTEXT_CHARS = 1000;
const DEFAULT_MODEL = "qwen3-asr-1.7b";

const getModels = () => modelRegistryData.qwenAsrModels || {};

// Speech runs at most a few tokens a second; a looping decode stops here.
function maxTokensFor(wavBytes) {
  const seconds = Math.max(1, (wavBytes - 44) / WAV_BYTES_PER_SECOND);
  return Math.min(4096, Math.round(64 + seconds * 10));
}

const NO_SPEECH = Object.freeze({ success: false, message: "No audio detected" });

function isSpeechWav(input) {
  const format = parseWavFormat(input);
  return format?.sampleRate === 16000 && format.channels === 1 && format.bitsPerSample === 16;
}

function wavSamples(wav) {
  const bytes = wavToFloat32Samples(wav);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

/** [start, end) pieces of a capture, the last one never a short tail. */
function capturePieces(samples) {
  const pieces = splitAtLulls(samples, 16000, PIECE_SECONDS);
  const tail = pieces[pieces.length - 1];
  if (pieces.length < 2 || tail[1] - tail[0] >= MIN_TAIL_SECONDS * 16000) return pieces;
  return [...pieces.slice(0, -2), [pieces[pieces.length - 2][0], tail[1]]];
}

function samplesToWav(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  return pcmToWav(pcm);
}

function toBuffer(audio) {
  if (Buffer.isBuffer(audio)) return audio;
  if (ArrayBuffer.isView(audio)) return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  throw new Error(`Unsupported audio data type: ${typeof audio}`);
}

class QwenAsrManager {
  constructor() {
    this.server = new LlamaServerManager({ portRange: PORT_RANGE, bundledOnly: true });
    this.currentDownload = null;
  }

  getModelsDir() {
    return getModelsDirForService("qwen-asr");
  }

  getModelInfo(modelName) {
    const info = Object.hasOwn(getModels(), modelName) ? getModels()[modelName] : null;
    if (!info) {
      throw new Error(`Invalid Qwen3-ASR model: ${modelName}. Valid models: ${Object.keys(getModels()).join(", ")}`);
    }
    return info;
  }

  /** The model's two files: the language model and its audio projector. */
  getModelFiles(modelName) {
    const info = this.getModelInfo(modelName);
    const dir = path.join(this.getModelsDir(), modelName);
    return [
      { kind: "model", path: path.join(dir, info.fileName), bytes: info.sizeBytes, sha256: info.sha256 },
      { kind: "mmproj", path: path.join(dir, info.mmprojFileName), bytes: info.mmprojSizeBytes, sha256: info.mmprojSha256 },
    ].map((file) => ({
      ...file,
      // A pinned revision: the sha256 above can't go stale on a re-upload.
      url: `https://huggingface.co/${info.hfRepo}/resolve/${info.hfRevision || "main"}/${path.basename(file.path)}`,
    }));
  }

  isModelDownloaded(modelName) {
    try {
      return this.getModelFiles(modelName).every((f) => fs.existsSync(f.path) && fs.statSync(f.path).size === f.bytes);
    } catch {
      return false;
    }
  }

  isAvailable() {
    return this.server.isAvailable();
  }

  async initializeAtStartup({ localTranscriptionProvider, qwenAsrModel } = {}) {
    // Partial downloads (.tmp) sit in each model's own folder.
    for (const name of Object.keys(getModels())) {
      await cleanupStaleDownloads(path.join(this.getModelsDir(), name));
    }
    if (localTranscriptionProvider !== "qwen") return;
    await this.prewarm(qwenAsrModel || DEFAULT_MODEL);
  }

  /** Start the server ahead of the first dictation; a failure waits for first use. */
  async prewarm(modelName) {
    if (!this.isAvailable() || !this.isModelDownloaded(modelName)) return;
    try {
      await this.startServer(modelName);
    } catch (error) {
      debugLogger.warn("Qwen3-ASR pre-warm failed (will start on first use)", { error: error.message });
    }
  }

  async startServer(modelName) {
    const [model, mmproj] = this.getModelFiles(modelName);
    await this.server.start(model.path, { threads: 4, mmprojPath: mmproj.path, serverArgs: SERVER_ARGS });
  }

  async stopServer() {
    await this.server.stop();
  }

  /** { success, text } or { success: false, message: "No audio detected" }, like the other engines. */
  async transcribe(audio, options = {}) {
    const modelName = options.model || DEFAULT_MODEL;
    if (!this.isAvailable()) throw new Error("llama-server binary not found. Please reinstall the app.");
    if (!this.isModelDownloaded(modelName)) {
      throw new Error(`Qwen3-ASR model "${modelName}" not downloaded. Please download it from Settings.`);
    }
    const input = toBuffer(audio);
    if (!input.length) throw new Error("Audio buffer is empty - no audio data received");
    const wav =
      isWavFormat(input) && isSpeechWav(input)
        ? input
        : await convertBufferToWav(input, { sampleRate: 16000, channels: 1 });
    const samples = wavSamples(wav);
    const pieces = capturePieces(samples);
    if (pieces.length > 1 || !isSteadyNoise(levelStats(samples, 16000))) await this.startServer(modelName);

    const startTime = Date.now();
    const texts = [];
    for (const [start, end] of pieces) {
      const pieceSamples = samples.subarray(start, end);
      const pieceWav = pieces.length === 1 ? wav : samplesToWav(pieceSamples);
      texts.push(await this._transcribePiece(pieceWav, pieceSamples, options));
    }
    const text = joinTranscripts(texts);
    debugLogger.debug("Qwen3-ASR transcription completed", {
      elapsed: Date.now() - startTime,
      pieces: pieces.length,
      textLength: text.length,
    });
    return text ? { success: true, text } : NO_SPEECH;
  }

  /** One piece's text, or "" for silence, steady noise and what the model makes up for noise. */
  async _transcribePiece(wav, samples, options) {
    // The model makes up sentences for silence and steady noise (steady-noise.js).
    const stats = levelStats(samples, 16000);
    if (isSteadyNoise(stats)) {
      debugLogger.debug("Qwen3-ASR: steady noise, nothing to transcribe", { peakDb: stats.peakDb });
      return "";
    }
    // The audio alone as the user turn, what the bench measured (run_llama_asr.js
    // --mode chat); Memory and Dictionary words go in the system turn, which
    // Qwen3-ASR reads as context (an unrelated term list changed no mistakes).
    const context = typeof options.context === "string" ? options.context.trim().slice(0, MAX_CONTEXT_CHARS) : "";
    const audioTurn = { type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } };
    const raw = await this.server.inference(
      [...(context ? [{ role: "system", content: context }] : []), { role: "user", content: [audioTurn] }],
      { temperature: 0, max_tokens: maxTokensFor(wav.length), signal: options.signal }
    );
    const { text, language } = parseQwenAsrOutput(raw);
    const userLanguages = [options.language, options.uiLanguage ?? process.env.UI_LANGUAGE];
    if (isNoiseHallucination({ rangeDb: stats?.spreadDb ?? null, language, userLanguages })) {
      debugLogger.debug("Qwen3-ASR: text made up for noise, dropped", { language, spreadDb: stats.spreadDb });
      return "";
    }
    return text;
  }

  async downloadModel(modelName, progressCallback = null) {
    const files = this.getModelFiles(modelName);
    if (this.isModelDownloaded(modelName)) {
      return { model: modelName, downloaded: true, path: path.dirname(files[0].path), success: true };
    }
    if (this.currentDownload) throw createDownloadInProgressError(modelName, this.currentDownload.model);

    const dir = path.dirname(files[0].path);
    fs.mkdirSync(dir, { recursive: true });
    const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
    const disk = await checkDiskSpace(dir, totalBytes * 1.2);
    if (!disk.ok) {
      throw Object.assign(new Error("Not enough disk space to download the model"), { code: "INSUFFICIENT_DISK_SPACE" });
    }

    const { signal, abort } = createDownloadSignal();
    this.currentDownload = { model: modelName, abort, percentage: 0, downloadedBytes: 0, totalBytes };
    const emit = (data) => progressCallback?.({ model: modelName, ...data });
    try {
      let doneBytes = 0;
      for (const file of files) {
        if (!fs.existsSync(file.path) || fs.statSync(file.path).size !== file.bytes) {
          await downloadFile(file.url, file.path, {
            signal,
            sha256: file.sha256,
            expectedSize: file.bytes,
            onProgress: (downloaded) => {
              const downloadedBytes = doneBytes + downloaded;
              const percentage = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
              this.currentDownload = { ...this.currentDownload, percentage, downloadedBytes };
              emit({ type: "progress", downloaded_bytes: downloadedBytes, total_bytes: totalBytes, percentage });
            },
          });
        }
        doneBytes += file.bytes;
      }
      emit({ type: "complete", percentage: 100 });
      return { model: modelName, downloaded: true, path: dir, success: true };
    } catch (error) {
      // Worded like Parakeet's cancel, which the download hook doesn't report as a failure.
      if (signal.aborted) throw Object.assign(new Error("Download interrupted by user"), { code: "DOWNLOAD_CANCELLED" });
      throw error;
    } finally {
      this.currentDownload = null;
    }
  }

  async cancelDownload() {
    if (!this.currentDownload) return { success: false, error: "No active download to cancel" };
    this.currentDownload.abort();
    return { success: true, message: "Download cancelled" };
  }

  async checkModelStatus(modelName) {
    const active = this.currentDownload?.model === modelName ? this.currentDownload : null;
    const downloadStatus = {
      isDownloading: Boolean(active),
      isInstalling: false,
      downloadProgress: active?.percentage ?? 0,
      downloadedBytes: active?.downloadedBytes ?? 0,
      totalBytes: active?.totalBytes ?? 0,
    };
    if (!this.isModelDownloaded(modelName)) return { model: modelName, downloaded: false, success: true, ...downloadStatus };
    const files = this.getModelFiles(modelName);
    const sizeBytes = files.reduce((sum, f) => sum + f.bytes, 0);
    return {
      model: modelName,
      downloaded: true,
      path: path.dirname(files[0].path),
      size_bytes: sizeBytes,
      size_mb: Math.round(sizeBytes / (1024 * 1024)),
      success: true,
      ...downloadStatus,
    };
  }

  async listModels() {
    const models = await Promise.all(Object.keys(getModels()).map((name) => this.checkModelStatus(name)));
    return { models, cache_dir: this.getModelsDir(), success: true };
  }

  async deleteModel(modelName) {
    const files = this.getModelFiles(modelName);
    const dir = path.dirname(files[0].path);
    if (!fs.existsSync(dir)) return { model: modelName, deleted: false, error: "Model not found", success: false };
    if (this.server.modelPath === files[0].path) await this.stopServer();
    const freedBytes = files.reduce((sum, f) => sum + (fs.existsSync(f.path) ? fs.statSync(f.path).size : 0), 0);
    fs.rmSync(dir, { recursive: true, force: true });
    return { model: modelName, deleted: true, freed_bytes: freedBytes, freed_mb: Math.round(freedBytes / (1024 * 1024)), success: true };
  }

  async deleteAllModels() {
    const results = [];
    for (const name of Object.keys(getModels())) {
      if (fs.existsSync(path.join(this.getModelsDir(), name))) results.push(await this.deleteModel(name));
    }
    const freedBytes = results.reduce((sum, r) => sum + (r.freed_bytes || 0), 0);
    return { success: true, deleted_count: results.length, freed_bytes: freedBytes, freed_mb: Math.round(freedBytes / (1024 * 1024)) };
  }
}

module.exports = QwenAsrManager;
module.exports.maxTokensFor = maxTokensFor;
module.exports.capturePieces = capturePieces;
module.exports.DEFAULT_QWEN_ASR_MODEL = DEFAULT_MODEL;
