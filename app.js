import { NAMES, SPOKEN, STRINGS, frequency, reading, centsFrom, nearestString } from './pitch.js';
const $ = id => document.getElementById(id);
let mode = 'pipe', octave = 4, volume = .18, selectedString = null, detectedString = null;
let context, tone, toneGain, playing = null, stream, analyser, microphone, listening = false, requesting = false;
let generation = 0, animation, lastFrame = 0, recent = [], workerBusy = false, worker;
try {
  const saved = JSON.parse(localStorage.getItem('pitch-pipe-preferences') || '{}');
  if ([3,4,5].includes(saved.octave)) octave = saved.octave;
  if (Number.isFinite(saved.volume)) volume = Math.max(.02, Math.min(.35, saved.volume));
} catch {}
function save() { try { localStorage.setItem('pitch-pipe-preferences', JSON.stringify({octave,volume})); } catch {} }
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function getContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('This browser cannot play reference tones. Open this page in Safari.');
  if (!context || context.state === 'closed') {
    context = new AudioContext();
    context.addEventListener('statechange', () => {
      if (context.state === 'interrupted' || (context.state === 'suspended' && (playing !== null || listening))) {
        stopAll(); error('Audio was interrupted. Tap a note or Listen to resume.');
      }
    });
  }
  return context;
}
function updateNotes() {
  $('notes').replaceChildren(...NAMES.map((name, index) => {
    const midi = (octave + 1) * 12 + index, button = document.createElement('button');
    button.textContent = name;
    button.setAttribute('aria-label', `${SPOKEN[index]} ${octave}, ${frequency(midi).toFixed(2)} hertz`);
    button.setAttribute('aria-pressed', String(playing === midi));
    button.addEventListener('click', () => play(midi));
    return button;
  }));
  document.querySelectorAll('[data-octave]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.octave) === octave)));
  $('stop-tone').disabled = playing === null;
}
function updateStrings() {
  $('strings').replaceChildren(...STRINGS.map((midi, index) => {
    const button = document.createElement('button');
    button.innerHTML = `<small>${6-index}</small>${NAMES[midi%12]}<sub>${Math.floor(midi/12)-1}</sub>`;
    button.setAttribute('aria-label', `String ${6-index}, ${NAMES[midi%12]} ${Math.floor(midi/12)-1}, ${frequency(midi).toFixed(2)} hertz`);
    button.setAttribute('aria-pressed', String(selectedString === midi));
    button.classList.toggle('detected', detectedString === midi && listening);
    button.addEventListener('click', () => {
      selectedString = selectedString === midi ? null : midi;
      recent = [];
      if (playing !== null) stopTone();
      display(null); updateStrings();
    });
    return button;
  }));
  $('auto').setAttribute('aria-pressed', String(selectedString === null));
  const target = selectedString ?? detectedString ?? 40;
  const label = `${NAMES[target%12]}${Math.floor(target/12)-1}`;
  $('reference-tone').textContent = playing !== null ? 'Stop reference' : `Play ${label} reference`;
  $('string-hint').textContent = selectedString === null ? 'Thickest → thinnest · tap a string to lock.' : `Locked to string ${6-STRINGS.indexOf(selectedString)} · tap Auto to detect any string.`;
}
function display(hz) {
  const r = hz ? reading(hz) : null;
  let note = r?.name ?? '—', oct = r?.octave ?? '', cents = r?.cents, target;
  if (mode === 'guitar' && playing === null) {
    if (hz) detectedString = nearestString(hz);
    else detectedString = null;
    target = selectedString ?? (hz ? detectedString : null);
    if (target !== null) {
      note = NAMES[target%12]; oct = Math.floor(target/12)-1;
      cents = hz ? centsFrom(hz, frequency(target)) : null;
    }
    $('context').textContent = target !== null ? `STRING ${6-STRINGS.indexOf(target)} · ${selectedString === null ? 'AUTO' : 'LOCKED'}` : 'STANDARD GUITAR';
  } else $('context').textContent = playing !== null || mode === 'pipe' ? 'REFERENCE PITCH' : 'CHROMATIC TUNER';
  $('note').textContent = note; $('octave-label').textContent = oct;
  $('frequency').textContent = hz ? `${hz.toFixed(2)} Hz` : mode === 'pipe' ? 'Choose a note' : mode === 'guitar' ? 'Pluck one open string' : 'Sing or play one note';
  const hasReading = cents !== null && cents !== undefined && hz !== null && playing === null;
  $('needle').hidden = !hasReading;
  $('needle').style.left = `${50 + Math.max(-50, Math.min(50, cents || 0))}%`;
  $('needle').classList.toggle('good', hasReading && Math.abs(cents) <= 3);
  const meter = document.querySelector('[role=meter]');
  meter.setAttribute('aria-valuenow', String(hasReading ? Math.max(-50, Math.min(50, cents)).toFixed(1) : 0));
  let status = 'Tap Listen to begin';
  if (requesting) status = 'Allow microphone access';
  else if (playing !== null) status = 'Reference tone playing';
  else if (listening && !hasReading) status = mode === 'guitar' ? 'Pluck one open string' : 'Sing or play one note';
  if (hasReading) {
    if (mode === 'guitar' && Math.abs(cents) > 200) status = 'Far from target · check the string';
    else if (Math.abs(cents) <= 3) status = `${cents >= 0 ? '+' : '−'}${Math.abs(cents).toFixed(1)} cents · in tune`;
    else status = `${Math.abs(cents).toFixed(1)} cents ${cents < 0 ? 'flat' : 'sharp'}${mode === 'guitar' ? (cents < 0 ? ' · tune up' : ' · tune down') : ''}`;
  }
  $('cents').textContent = status;
  meter.setAttribute('aria-valuetext', status);
}
function updateListen() {
  $('listen').querySelector('span').textContent = requesting ? 'Cancel' : listening ? 'Stop listening' : 'Listen';
  $('listen').setAttribute('aria-pressed', String(listening || requesting));
  $('listen-hint').textContent = requesting ? 'Waiting for microphone permission…' : listening ? 'Listening · audio stays on this device' : 'Audio stays on your device.';
}
function stopTone() {
  if (tone) {
    const old = tone, gain = toneGain, t = context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + .015);
    old.stop(t + .02);
    old.onended = () => { old.disconnect(); gain.disconnect(); };
  }
  tone = null; toneGain = null; playing = null;
  updateNotes(); updateStrings(); display(null);
}
function stopListening() {
  generation++; listening = false; requesting = false; recent = [];
  cancelAnimationFrame(animation);
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  microphone?.disconnect(); microphone = null; analyser?.disconnect(); analyser = null;
  updateListen(); display(null); updateStrings();
}
function stopAll() { stopListening(); stopTone(); }
async function play(midi) {
  if (playing === midi) { stopTone(); return; }
  stopListening(); stopTone(); error();
  const token = ++generation;
  try {
    const audio = getContext();
    await audio.resume();
    if (token !== generation) return;
    tone = audio.createOscillator(); toneGain = audio.createGain();
    tone.type = 'sine'; tone.frequency.setValueAtTime(frequency(midi), audio.currentTime);
    toneGain.gain.setValueAtTime(0, audio.currentTime);
    toneGain.gain.linearRampToValueAtTime(volume, audio.currentTime + .015);
    tone.connect(toneGain); toneGain.connect(audio.destination); tone.start(); playing = midi;
    display(frequency(midi)); updateNotes(); updateStrings();
  } catch (e) { stopTone(); error(e.message || 'Could not play audio. Try opening this page in Safari.'); }
}
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./pitch-worker.js', import.meta.url), {type:'module'});
    worker.onmessage = ({data}) => {
      workerBusy = false;
      if (!listening || data.generation !== generation) return;
      let hz = data.frequency;
      if (hz) {
        if (recent.length && Math.abs(centsFrom(hz, recent[recent.length-1])) > 70) recent = [];
        recent.push(hz); if (recent.length > 3) recent.shift();
        hz = [...recent].sort((a,b) => a-b)[Math.floor(recent.length/2)];
      } else recent = [];
      display(hz); if (mode === 'guitar') updateStrings();
    };
    worker.onerror = () => {
      stopListening(); worker.terminate(); worker = null; workerBusy = false;
      error('The tuner could not load. Reopen this page while online and try again.');
    };
  }
  return worker;
}
function sample(now) {
  if (!listening) return;
  if (!workerBusy && now - lastFrame >= 85) {
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    workerBusy = true; lastFrame = now;
    getWorker().postMessage({samples, sampleRate:context.sampleRate, generation}, [samples.buffer]);
  }
  animation = requestAnimationFrame(sample);
}
async function listen() {
  if (listening || requesting) { stopListening(); return; }
  stopTone(); error();
  if (!navigator.mediaDevices?.getUserMedia) { error('Microphone access is unavailable here. Open the secure site address directly in Safari.'); return; }
  const token = ++generation;
  requesting = true; updateListen(); display(null);
  let acquired;
  try {
    const audio = getContext();
    await audio.resume();
    if (token !== generation) return;
    getWorker();
    acquired = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
    if (token !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired;
    microphone = audio.createMediaStreamSource(stream);
    analyser = audio.createAnalyser();
    analyser.fftSize = audio.sampleRate > 96000 ? 16384 : audio.sampleRate > 48000 ? 8192 : 4096;
    analyser.smoothingTimeConstant = 0;
    microphone.connect(analyser); // Never connect microphone audio to the speakers.
    stream.getTracks().forEach(track => track.addEventListener('ended', () => {
      if (listening && generation === token) { stopListening(); error('Microphone disconnected. Tap Listen to try again.'); }
    }));
    requesting = false; listening = true; recent = []; lastFrame = 0;
    updateListen(); display(null); animation = requestAnimationFrame(sample);
  } catch (e) {
    acquired?.getTracks().forEach(t => t.stop());
    if (token !== generation) return;
    stopListening();
    error(e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow the microphone in Safari’s website settings, then tap Listen again.' : e.name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again.' : 'Could not start the microphone. Close other apps using it, then tap Listen again.');
  }
}
function setMode(next) {
  stopAll(); error(); mode = next; detectedString = null;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('pipe-panel').hidden = mode !== 'pipe'; $('tuner-panel').hidden = mode === 'pipe';
  $('guitar-controls').hidden = mode !== 'guitar'; $('meter').hidden = mode === 'pipe';
  display(null); updateStrings();
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-octave]').forEach(b => b.addEventListener('click', () => { generation++; stopTone(); octave = Number(b.dataset.octave); save(); updateNotes(); }));
$('volume').value = volume;
$('volume').addEventListener('input', e => {
  volume = Number(e.target.value); save();
  if (toneGain) toneGain.gain.setTargetAtTime(volume, context.currentTime, .015);
});
$('stop-tone').addEventListener('click', () => { generation++; stopTone(); });
$('listen').addEventListener('click', listen);
$('auto').addEventListener('click', () => { selectedString = null; recent = []; display(null); updateStrings(); });
$('reference-tone').addEventListener('click', () => {
  if (playing !== null) { generation++; stopTone(); }
  else play(selectedString ?? detectedString ?? 40);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
window.addEventListener('pagehide', stopAll);
document.addEventListener('keydown', e => { if (e.key === 'Escape') stopAll(); });
function updateConnection() { $('connection-status').textContent = navigator.onLine ? 'On-device audio' : 'Offline'; }
window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection);
updateNotes(); updateStrings(); updateListen(); display(null); updateConnection();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(async registration => {
    await navigator.serviceWorker.ready;
    function ask() { registration.active?.postMessage('offline-status'); }
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data === 'offline-ready') $('offline-status').textContent = 'Saved for offline use on this device. Your browser may clear saved files if storage runs low.';
    });
    navigator.serviceWorker.addEventListener('controllerchange', ask);
    ask();
  }).catch(() => { $('offline-status').textContent = 'Offline setup is unavailable. You can still use the app while online.'; });
} else $('offline-status').textContent = 'This browser needs an internet connection to open the app.';
