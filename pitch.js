export const NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const SPOKEN = ['C','C sharp','D','E flat','E','F','F sharp','G','A flat','A','B flat','B'];
export const STRINGS = [40,45,50,55,59,64];
export const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
export const centsFrom = (hz, target) => 1200 * Math.log2(hz / target);
export function reading(hz) {
  const position = 69 + 12 * Math.log2(hz / 440), midi = Math.round(position);
  return { midi, name: NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: (position - midi) * 100 };
}
export function nearestString(hz) {
  return STRINGS.reduce((best, midi) => Math.abs(centsFrom(hz, frequency(midi))) < Math.abs(centsFrom(hz, frequency(best))) ? midi : best);
}
// YIN: choose the first convincing period, then refine at the input sample rate.
export function detectPitch(samples, sampleRate) {
  if (!(sampleRate > 0) || samples.length < 2048) return null;
  const n = samples.length, min = Math.max(2, Math.floor(sampleRate / 2000));
  const max = Math.min(Math.ceil(sampleRate / 55), Math.floor(n / 2) - 1);
  if (max <= min) return null;
  let mean = 0, energy = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  for (let i = 0; i < n; i++) energy += (samples[i] - mean) ** 2;
  if (energy / n < 0.00001) return null;
  const difference = new Float64Array(max + 1), normalized = new Float64Array(max + 1);
  normalized.fill(1);
  let running = 0;
  const window = n - max - 1;
  for (let lag = 1; lag <= max; lag++) {
    let sum = 0;
    for (let i = 0; i < window; i++) { const d = samples[i] - samples[i + lag]; sum += d * d; }
    difference[lag] = sum; running += sum;
    normalized[lag] = running > 0 ? sum * lag / running : 1;
  }
  for (let lag = min; lag < max; lag++) {
    if (normalized[lag] >= .12) continue;
    while (lag + 1 < max && normalized[lag + 1] < normalized[lag]) lag++;
    const left = difference[lag - 1], center = difference[lag], right = difference[lag + 1];
    const denominator = left - 2 * center + right;
    const shift = Math.abs(denominator) > 1e-12 ? .5 * (left - right) / denominator : 0;
    const hz = sampleRate / (lag + Math.max(-1, Math.min(1, shift)));
    return hz >= 55 && hz <= 2000 ? hz : null;
  }
  return null;
}
