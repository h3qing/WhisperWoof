/**
 * The live-dictation mic tap used to open its own AudioContext at 16kHz. On a
 * Bluetooth headset (AirPods: 24kHz HFP) that second, differently-clocked
 * consumer wrecked the MediaRecorder capture it shares the device with — the
 * batch recording came out buried in noise and every engine transcribed
 * garbage. The tap now runs at the device rate and downsamples itself.
 */
import { describe, it, expect } from "vitest";
import { createDownsampler } from "./downsampler.js";

const sine = (hz: number, rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

const zeroCrossings = (x: Float32Array) => {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
  return n;
};

describe("createDownsampler", () => {
  it("passes audio through untouched when the rates match", () => {
    const push = createDownsampler(16000, 16000);
    const x = sine(440, 16000, 0.1);
    expect(Array.from(push(x))).toEqual(Array.from(x));
  });

  it.each([48000, 44100, 24000])("resamples %i Hz to 16 kHz with the right length and pitch", (rate) => {
    const push = createDownsampler(rate, 16000);
    const out = push(sine(440, rate, 1));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2);
    // 440 Hz → 880 zero crossings per second, regardless of rate.
    expect(Math.abs(zeroCrossings(out) - 880)).toBeLessThanOrEqual(4);
  });

  it("gives the same output whether audio arrives in one block or 128-sample render quanta", () => {
    const x = sine(300, 24000, 0.5);
    const whole = createDownsampler(24000, 16000)(x);
    const push = createDownsampler(24000, 16000);
    const parts: number[] = [];
    for (let i = 0; i < x.length; i += 128) parts.push(...push(x.subarray(i, i + 128)));
    expect(parts.length).toBe(whole.length);
    parts.forEach((v, i) => expect(v).toBeCloseTo(whole[i], 6));
  });

  it("attenuates content above the 8 kHz output Nyquist instead of aliasing it", () => {
    const out = createDownsampler(48000, 16000)(sine(11000, 48000, 0.5));
    const rms = Math.sqrt(out.reduce((s, v) => s + v * v, 0) / out.length);
    expect(rms).toBeLessThan(0.35); // a full-scale sine has RMS 0.707
  });
});
