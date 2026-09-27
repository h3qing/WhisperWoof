const path = require("path");
const debugLogger = require("./debugLogger");
const MeetingLocalTranscriber = require("./meetingLocalTranscriber");
const { joinTranscriptSegments } = require("./parakeetWsResult");

// SenseVoice (2024-07): 15.6% mixed error rate at 0.03x real time on
// eval/meeting-bench bench-a. FireRedASR2 AED is more accurate (13.3%) but
// 15x slower, so it's for re-transcribing, not for every meeting.
const LOCAL_MEETING_MODEL = "sense-voice-zh-en";
const LOCAL_MEETING_SAMPLE_RATE = 16000;

// Its own ports, apart from the dictation servers' (parakeetWsServer.js), so
// the two never start on the same one.
const MEETING_PORT_RANGE = [6050, 6069];

function createMeetingServer() {
  const ParakeetWsServer = require("./parakeetWsServer");
  return new ParakeetWsServer({ pidKey: "parakeet-meeting", portRange: MEETING_PORT_RANGE });
}

/** What a meeting note stores as its transcript: the renderer's format. */
function transcriptJson(lines) {
  return JSON.stringify(lines.map(({ text, source, timestamp }) => ({ text, source, timestamp })));
}

/**
 * A meeting transcribed on this Mac. SenseVoice runs in a sherpa-onnx server
 * of its own, so dictating during a meeting keeps using the dictation server.
 * Lines go to the window as each piece is transcribed, and into the meeting's
 * note, so a crash loses at most the clip in progress (whose audio stays in
 * the meeting's crash buffer).
 */
class MeetingLocalSession {
  /**
   * @param {Object} deps
   * @param {Object} deps.parakeetManager - finds the model and the server binary
   * @param {(noteId: number, transcript: string) => boolean} deps.saveTranscript
   * @param {() => Object} [deps.createServer] - the meeting's ParakeetWsServer
   */
  constructor({
    parakeetManager,
    saveTranscript,
    createServer = createMeetingServer,
    clipTargetS,
  }) {
    this._parakeet = parakeetManager;
    this._createServer = createServer;
    this._saveTranscript = saveTranscript;
    this._clipTargetS = clipTargetS;
    this._run = null; // { server, transcriber, save, saveFailed } of the meeting in progress
  }

  /** The model is downloaded and the server binary is here. */
  isAvailable() {
    const servers = this._parakeet?.serverManager;
    return Boolean(
      servers?.isAvailable("offline") && servers.isModelDownloaded(LOCAL_MEETING_MODEL)
    );
  }

  get isActive() {
    return this._run !== null;
  }

  /** Starts the model; throws if it can't. `onLines` gets each batch of new lines. */
  async start({ noteId = null, onLines = () => {} } = {}) {
    if (this._run) throw new Error("A local meeting is already running");
    const server = this._createServer();
    const modelDir = path.join(this._parakeet.getModelsDir(), LOCAL_MEETING_MODEL);
    try {
      await server.start(LOCAL_MEETING_MODEL, modelDir, "offline");
    } catch (error) {
      await server.stop().catch(() => {});
      throw error;
    }

    // This meeting's note and save state, so nothing of it can reach the next meeting.
    let saveFailed = false;
    const save = (lines) => {
      if (!noteId || !lines.length) return;
      let saved = false;
      try {
        saved = this._saveTranscript(noteId, transcriptJson(lines));
      } catch (error) {
        debugLogger.error("Saving the local meeting transcript failed", { error: error.message });
      }
      // A later save of the whole transcript makes up for an earlier failure.
      saveFailed = !saved;
    };
    const transcriber = new MeetingLocalTranscriber({
      sampleRate: LOCAL_MEETING_SAMPLE_RATE,
      ...(this._clipTargetS ? { clipTargetS: this._clipTargetS } : {}),
      transcribe: async (samples, sampleRate) => {
        const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
        const { text, detail } = await server.transcribe(bytes, sampleRate);
        return detail ?? { text };
      },
      onLines: (lines) => {
        try {
          onLines(lines);
        } catch (error) {
          debugLogger.warn("Sending local meeting lines failed", { error: error.message });
        }
        save(transcriber.lines);
      },
    });
    this._run = { server, transcriber, save, saveFailed: () => saveFailed };
  }

  /** 16-bit mono PCM at 16 kHz from "mic" or "system". */
  push(source, pcm16) {
    this._run?.transcriber.push(source, pcm16);
  }

  /**
   * Transcribes what's left, saves the whole transcript to the note and stops
   * the model. `complete` is false when a piece failed or the note wasn't
   * saved: the caller keeps the meeting's audio then.
   */
  async stop() {
    const run = this._run;
    if (!run) return { lines: [], transcript: "", complete: true };
    this._run = null;

    let lines;
    let finished = true;
    try {
      lines = await run.transcriber.finish();
    } catch (error) {
      debugLogger.error("Finishing the local meeting transcript failed", { error: error.message });
      lines = run.transcriber.lines;
      finished = false;
    }
    await run.server.stop().catch(() => {});
    run.save(lines);
    const complete = finished && run.transcriber.failedPieces === 0 && !run.saveFailed();
    return { lines, transcript: joinTranscriptSegments(lines.map((l) => l.text)), complete };
  }

  /** The app is quitting: stop the model now. The meeting's audio stays in its crash buffer. */
  shutdown() {
    const run = this._run;
    this._run = null;
    return run ? run.server.stop() : Promise.resolve();
  }
}

module.exports = {
  MeetingLocalSession,
  LOCAL_MEETING_MODEL,
  LOCAL_MEETING_SAMPLE_RATE,
  transcriptJson,
};
