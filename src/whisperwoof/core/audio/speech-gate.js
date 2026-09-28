/**
 * Two-stage "is there any speech in this capture" gate, ported from upstream
 * OpenWhispr's localSpeechGate.js (same thresholds), kept immutable here.
 * Fed one (rms, peak) pair per ~100ms analyser window while recording; the
 * decision runs before transcription so noise-only captures never reach an
 * engine that would hallucinate text for them.
 *
 * A window is voiced when it looks like speech (enough energy and a real
 * peak) or is simply loud. One voiced window is not enough: a key click or a
 * bump on the desk fills exactly one, and Whisper turns such a capture into
 * odd characters. Speech lasts longer than that — even a short word spans
 * two windows.
 */
const SILENCE_RMS_THRESHOLD = 0.002;
const SPEECH_WINDOW_RMS_THRESHOLD = 0.003;
const SPEECH_WINDOW_PEAK_THRESHOLD = 0.02;
const STRONG_SPEECH_RMS_THRESHOLD = 0.006;
const MIN_VOICED_WINDOWS = 2;

export const createSpeechGate = () =>
  Object.freeze({ peakRms: 0, peakAmplitude: 0, windowCount: 0, speechWindowCount: 0 });

export const recordSpeechWindow = (state, rms, peak) => {
  const isVoiced =
    (rms >= SPEECH_WINDOW_RMS_THRESHOLD && peak >= SPEECH_WINDOW_PEAK_THRESHOLD) ||
    rms >= STRONG_SPEECH_RMS_THRESHOLD;
  return Object.freeze({
    peakRms: Math.max(state.peakRms, rms),
    peakAmplitude: Math.max(state.peakAmplitude, peak),
    windowCount: state.windowCount + 1,
    speechWindowCount: state.speechWindowCount + (isVoiced ? 1 : 0),
  });
};

export const speechGateDecision = (state) => {
  if (!state?.windowCount) return { skip: false, reason: "unavailable" };
  const metrics = { ...state };
  if (state.peakRms < SILENCE_RMS_THRESHOLD) return { skip: true, reason: "silence", ...metrics };
  return state.speechWindowCount >= MIN_VOICED_WINDOWS
    ? { skip: false, reason: "speech_detected", ...metrics }
    : { skip: true, reason: "insufficient_speech", ...metrics };
};
