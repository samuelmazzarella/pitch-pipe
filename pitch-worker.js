import { detectPitch } from './pitch.js';
self.onmessage = ({data}) => {
  const frequency = detectPitch(data.samples, data.sampleRate);
  self.postMessage({ frequency, generation: data.generation });
};
