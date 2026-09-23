/**
 * Streaming downsampler for the mic PCM tap: two cascaded one-pole low-pass
 * filters (anti-aliasing, cutoff ~0.45 × outRate) then linear interpolation,
 * carrying its phase across chunks so 128-sample render quanta produce the same
 * output as one big block.
 *
 * Self-contained on purpose: audioManager inlines `createDownsampler.toString()`
 * into the AudioWorklet source, which cannot import modules.
 *
 * @param {number} inRate  device sample rate (the AudioContext's)
 * @param {number} outRate target rate (16000 for sherpa-onnx)
 * @returns {(input: Float32Array) => Float32Array}
 */
export function createDownsampler(inRate, outRate) {
  if (inRate === outRate) return (input) => Float32Array.from(input);
  const step = inRate / outRate;
  const alpha = 1 - Math.exp((-2 * Math.PI * 0.45 * outRate) / inRate);
  let lp1 = 0;
  let lp2 = 0;
  let tail = null; // last filtered sample of the previous chunk
  let t = 0; // next output position, in input samples, relative to `tail`

  return (input) => {
    const offset = tail === null ? 0 : 1;
    const buf = new Float32Array(input.length + offset);
    if (tail !== null) buf[0] = tail;
    for (let i = 0; i < input.length; i++) {
      lp1 += alpha * (input[i] - lp1);
      lp2 += alpha * (lp1 - lp2);
      buf[i + offset] = lp2;
    }
    const out = [];
    while (t + 1 < buf.length) {
      const i = Math.floor(t);
      const frac = t - i;
      out.push(buf[i] * (1 - frac) + buf[i + 1] * frac);
      t += step;
    }
    t -= buf.length - 1;
    tail = buf[buf.length - 1];
    return Float32Array.from(out);
  };
}
