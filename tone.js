import { frequency } from './pitch.js';

export function createReferenceTone(audio, midi) {
  const oscillator = audio.createOscillator();
  oscillator.frequency.setValueAtTime(frequency(midi), audio.currentTime);
  if (midi < 60) {
    // A few exact harmonics carry low notes through small speakers.
    // Keep the fundamental at its original level. At the maximum volume (.35),
    // the sum of these amplitudes bounds the output below 1, avoiding clipping.
    const harmonics = new Float32Array([0, 1, .6, .45, .3, .2, .12]);
    oscillator.setPeriodicWave(audio.createPeriodicWave(new Float32Array(harmonics.length), harmonics, {disableNormalization:true}));
  } else {
    oscillator.type = 'sine';
  }
  return oscillator;
}
