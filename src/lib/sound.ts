import { useSettings } from '../store/settings';

// Tiny synthesized foley: no audio files, just WebAudio. Pins thock, paper
// rustles, strings twang, and digging thumps.

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

// Starting the audio engine takes a moment: do it just after the first click,
// not in the middle of dropping a card.
window.addEventListener(
  'pointerdown',
  () =>
    setTimeout(() => {
      try {
        ac();
      } catch {
        /* no audio on this device */
      }
    }, 0),
  { once: true },
);

function noise(duration: number, filterFreq: number, gain: number, q = 1) {
  const a = ac();
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

function tone(from: number, to: number, duration: number, gain: number, type: OscillatorType = 'sine') {
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), a.currentTime + duration);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + duration);
}

const SOUNDS = {
  pin: () => {
    noise(0.05, 2400, 0.35, 3);
    tone(900 + Math.random() * 200, 300, 0.07, 0.08, 'triangle');
  },
  paper: () => noise(0.18, 3200 + Math.random() * 800, 0.18, 0.7),
  string: () => tone(220 + Math.random() * 60, 180, 0.35, 0.06, 'triangle'),
  dig: () => {
    tone(120, 45, 0.35, 0.28);
    noise(0.25, 400, 0.25, 0.8);
  },
  found: () => {
    tone(660, 880, 0.12, 0.05);
    setTimeout(() => tone(880, 1320, 0.16, 0.04), 90);
  },
};

let last = 0;
export function play(name: keyof typeof SOUNDS) {
  if (!useSettings.getState().sounds) return;
  const now = performance.now();
  if (name === 'pin' && now - last < 45) return;
  last = now;
  try {
    if (ac().state === 'suspended') void ac().resume();
    SOUNDS[name]();
  } catch {
    /* audio is decoration */
  }
}
