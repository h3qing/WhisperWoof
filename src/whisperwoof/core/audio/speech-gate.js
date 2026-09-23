/**
 * Two-stage "is there any speech in this capture" gate, ported from upstream
 * OpenWhispr's localSpeechGate.js (same thresholds), kept immutable here.
 * Fed one (rms, peak) pair per ~100ms analyser window while recording; the
 * decision runs before transcription so noise-only captures never reach an
 * engine that would hallucinate text for them.
 */
const SILENCE_RMS_THRESHOLD = 0.002;
const SPEECH_WINDOW_RMS_THRESHOLD = 0.003;
const SPEECH_WINDOW_PEAK_THRESHOLD = 0.02;
const STRONG_SPEECH_RMS_THRESHOLD = 0.006;

export const createSpeechGate = () =>
  Object.freeze({ peakRms: 0, peakAmplitude: 0, windowCount: 0, speechWindowCount: 0 });

export const recordSpeechWindow = (state, rms, peak) => {
  const isSpeechWindow = rms >= SPEECH_WINDOW_RMS_THRESHOLD && peak >= SPEECH_WINDOW_PEAK_THRESHOLD;
  return Object.freeze({
    peakRms: Math.max(state.peakRms, rms),
    peakAmplitude: Math.max(state.peakAmplitude, peak),
    windowCount: state.windowCount + 1,
    speechWindowCount: state.speechWindowCount + (isSpeechWindow ? 1 : 0),
  });
};

export const speechGateDecision = (state) => {
  if (!state?.windowCount) return { skip: false, reason: "unavailable" };
  const metrics = { ...state };
  if (state.peakRms < SILENCE_RMS_THRESHOLD) return { skip: true, reason: "silence", ...metrics };
  const hasSpeech = state.speechWindowCount >= 1 || state.peakRms >= STRONG_SPEECH_RMS_THRESHOLD;
  return hasSpeech
    ? { skip: false, reason: "speech_detected", ...metrics }
    : { skip: true, reason: "insufficient_speech", ...metrics };
};
