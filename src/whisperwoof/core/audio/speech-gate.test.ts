/**
 * A capture with no speech (a quiet room through AirPods) sat just above the
 * old single 0.002 peak-RMS gate, so Whisper got it and hallucinated
 * "Thank you." The two-stage gate (ported from upstream OpenWhispr's
 * localSpeechGate) also requires one 100ms window that looks like speech.
 * Window stats below are the measured values from those captures.
 */
import { describe, it, expect } from "vitest";
import { createSpeechGate, recordSpeechWindow, speechGateDecision } from "./speech-gate.js";

const feed = (windows: Array<[number, number]>) =>
  windows.reduce((state, [rms, peak]) => recordSpeechWindow(state, rms, peak), createSpeechGate());

describe("speech gate", () => {
  it("skips a capture that is silence", () => {
    expect(speechGateDecision(feed([[0.001, 0.004], [0.0015, 0.006]]))).toMatchObject({ skip: true, reason: "silence" });
  });

  it("skips room noise that clears the silence floor but never looks like speech", () => {
    // Measured on a silent AirPods capture that Whisper turned into "Thank you."
    const noise = Array.from({ length: 30 }, (): [number, number] => [0.0025, 0.009]);
    expect(speechGateDecision(feed(noise))).toMatchObject({ skip: true, reason: "insufficient_speech" });
  });

  it("keeps a capture with at least one speech-like window", () => {
    expect(speechGateDecision(feed([[0.002, 0.008], [0.07, 0.3], [0.002, 0.008]]))).toMatchObject({
      skip: false,
      reason: "speech_detected",
    });
  });

  it("keeps a capture whose loudest window is strong even with a low peak", () => {
    expect(speechGateDecision(feed([[0.007, 0.015]]))).toMatchObject({ skip: false });
  });

  it("never skips when no windows were measured (analysis unavailable)", () => {
    expect(speechGateDecision(createSpeechGate())).toMatchObject({ skip: false, reason: "unavailable" });
  });

  it("returns a new state instead of mutating the old one", () => {
    const s0 = createSpeechGate();
    const s1 = recordSpeechWindow(s0, 0.05, 0.2);
    expect(s0.windowCount).toBe(0);
    expect(s1.windowCount).toBe(1);
  });
});
