const debugLogger = require("./debugLogger");
const {
  rms,
  findLullCut,
  splitAtLulls,
  sentencesFromResult,
} = require("./meetingLocalTranscription");
const { pcm16ToFloat32 } = require("../utils/audioUtils");

// Pieces quieter than this aren't sent to the model: mostly the system track
// while nobody else is talking. A source with a quieter microphone passes its own.
const SILENCE_RMS = 0.003;

/**
 * Transcribes a meeting on this Mac, clip by clip. Each track (mic, system)
 * is buffered on its own; once a track holds its target length plus the
 * lookahead, the clip is cut at the quietest moment in the lookahead and
 * queued. One queue, one clip at a time: a local model runs ~30x faster than
 * real time (eval/meeting-bench), so two tracks keep it about 5% busy.
 *
 * `transcribe(float32Samples, sampleRate)` returns the model's raw reply
 * ({ text, tokens, timestamps }); lines go to `onLines` as they arrive, in
 * the shape the renderer already takes: { text, source, type: "final",
 * timestamp (epoch ms) }.
 *
 * Audio that isn't live (a recording read from disk) passes `zeroMs`, the
 * time of sample 0 of the fed stream: lines are then dated zeroMs plus their
 * sample offset, with no clock involved. Disk is ~1000x faster than the
 * model, so such a caller feeds a little at a time and awaits idle() whenever
 * push() returns true (it queued a clip): at most one clip waits in memory.
 */
class MeetingLocalTranscriber {
  constructor({
    sampleRate = 16000,
    clipTargetS = 120,
    lookaheadS = 20,
    transcribe,
    onLines = () => {},
    zeroMs,
    silenceRms = SILENCE_RMS,
  }) {
    this.sampleRate = sampleRate;
    this.clipTargetS = clipTargetS;
    this.lookaheadS = lookaheadS;
    this.silenceRms = silenceRms;
    this._zeroMs = Number.isFinite(zeroMs) ? zeroMs : null;
    this._transcribe = transcribe;
    this._onLines = onLines;
    this._tracks = new Map();
    this._lines = [];
    this._queue = Promise.resolve();
    this._pending = 0;
    this._ended = false;
    this.failedPieces = 0;
  }

  /**
   * 16-bit little-endian mono PCM at `sampleRate`, as it arrives. A track's
   * time zero is when its first chunk began (or `zeroMs`), so the mic and
   * the system audio line up although their captures start a moment apart.
   * Returns true when this chunk completed a clip and queued it.
   */
  push(source, pcm16) {
    if (this._ended || !pcm16?.length) return false;
    const track = this._track(source, pcm16.length);
    track.chunks.push(Buffer.from(pcm16));
    track.bytes += pcm16.length;
    const due = (this.clipTargetS + this.lookaheadS) * this.sampleRate * 2;
    if (track.bytes < due) return false;
    this._cutClip(source, track, false);
    return true;
  }

  /** Clips cut but not transcribed yet. */
  get pendingClips() {
    return this._pending;
  }

  /** PCM bytes held for clips not cut yet, all tracks. */
  get bufferedBytes() {
    let total = 0;
    for (const track of this._tracks.values()) total += track.bytes;
    return total;
  }

  /** Resolves once every queued clip is transcribed. */
  idle() {
    return this._queue;
  }

  /** Ends the meeting: transcribes what's left and returns every line in time order. */
  async finish() {
    if (!this._ended) {
      this._ended = true;
      for (const [source, track] of this._tracks) {
        if (track.bytes) this._cutClip(source, track, true);
      }
    }
    await this._queue;
    return this.lines;
  }

  get lines() {
    return [...this._lines].sort((a, b) => a.timestamp - b.timestamp);
  }

  _track(source, firstChunkBytes) {
    if (!this._tracks.has(source)) {
      const zeroMs = this._zeroMs ?? Date.now() - (firstChunkBytes / 2 / this.sampleRate) * 1000;
      this._tracks.set(source, { chunks: [], bytes: 0, offsetSamples: 0, zeroMs });
    }
    return this._tracks.get(source);
  }

  _cutClip(source, track, final) {
    const audio = Buffer.concat(track.chunks);
    const samples = pcm16ToFloat32(audio);
    const cut = final
      ? samples.length
      : findLullCut(samples, this.sampleRate, this.clipTargetS, this.clipTargetS + this.lookaheadS);
    const rest = audio.subarray(cut * 2);
    track.chunks = rest.length ? [Buffer.from(rest)] : [];
    track.bytes = rest.length;
    const clipStartS = track.offsetSamples / this.sampleRate;
    track.offsetSamples += cut;
    const clip = samples.slice(0, cut);
    const { zeroMs } = track;
    this._pending += 1;
    this._queue = this._queue
      .then(() => this._transcribeClip(source, clip, clipStartS, zeroMs))
      .catch((error) => {
        this.failedPieces += 1;
        debugLogger.warn("Local meeting transcription failed for a clip", {
          source,
          error: error.message,
        });
      })
      .finally(() => {
        this._pending -= 1;
      });
  }

  async _transcribeClip(source, clip, clipStartS, zeroMs) {
    for (const [start, end] of splitAtLulls(clip, this.sampleRate)) {
      const piece = clip.subarray(start, end);
      if (rms(piece) < this.silenceRms) continue;
      let result;
      try {
        result = await this._transcribe(piece, this.sampleRate);
      } catch (error) {
        this.failedPieces += 1;
        debugLogger.warn("Local meeting transcription failed for a piece", {
          source,
          atS: +(clipStartS + start / this.sampleRate).toFixed(1),
          error: error.message,
        });
        continue;
      }
      const lines = sentencesFromResult(result, clipStartS + start / this.sampleRate).map(
        ({ startS, text }) => ({
          text,
          source,
          type: "final",
          timestamp: Math.round(zeroMs + startS * 1000),
        })
      );
      if (lines.length) {
        this._lines = [...this._lines, ...lines];
        this._onLines(lines);
      }
    }
  }
}

module.exports = MeetingLocalTranscriber;
