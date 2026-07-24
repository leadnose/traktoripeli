// ---------------------------------------------------------------------------
// Sound: synthesized with the Web Audio API. A continuous engine loop follows
// the throttle, ground work rumbles through a per-implement bandpass, and the
// hydraulic lift whines. Created on the first keypress (autoplay policy).
// ---------------------------------------------------------------------------

let audio = null;
let soundMuted = false; // Q: all sound
let musicMuted = false; // M: just the music

function initAudio() {
  if (audio) return;
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const master = ac.createGain();
  master.gain.value = soundMuted ? 0 : 0.5;
  master.connect(ac.destination);

  // Engine: two oscillators an octave apart through a lowpass, with an
  // LFO chopping the gain at the firing rate for the putt-putt
  const engineGain = ac.createGain();
  engineGain.gain.value = 0;
  const engineFilter = ac.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 320;
  const osc1 = ac.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.value = 55;
  const osc2 = ac.createOscillator();
  osc2.type = "square";
  osc2.frequency.value = 28;
  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.5;
  osc1.connect(engineFilter);
  osc2.connect(osc2Gain);
  osc2Gain.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(master);
  const lfo = ac.createOscillator();
  lfo.frequency.value = 12;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.06; // putt-putt depth on top of the base gain
  lfo.connect(lfoGain);
  lfoGain.connect(engineGain.gain);
  osc1.start();
  osc2.start();
  lfo.start();

  // Ground work: looped white noise through a bandpass whose center moves
  // with the implement (plow scrape low, harvester threshing high)
  const noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const workFilter = ac.createBiquadFilter();
  workFilter.type = "bandpass";
  workFilter.frequency.value = 300;
  workFilter.Q.value = 0.8;
  const workGain = ac.createGain();
  workGain.gain.value = 0;
  noise.connect(workFilter);
  workFilter.connect(workGain);
  workGain.connect(master);
  noise.start();

  // Background music bus: plucks go through a feedback echo for a soft
  // music-box feel
  const musicGain = ac.createGain();
  musicGain.gain.value = musicMuted ? 0 : 1;
  const echo = ac.createDelay(1);
  echo.delayTime.value = 0.34;
  const echoGain = ac.createGain();
  echoGain.gain.value = 0.3;
  musicGain.connect(master);
  musicGain.connect(echo);
  echo.connect(echoGain);
  echoGain.connect(echo);
  echoGain.connect(master);

  audio = {
    ac,
    master,
    engineGain,
    osc1,
    osc2,
    lfo,
    workFilter,
    workGain,
    musicGain,
    musicStep: 0,
    musicTime: ac.currentTime + 0.2,
  };
}

// Schedule one Web Audio tone: an oscillator through a gain into destGain,
// with an optional frequency ramp and a gain envelope that either eases in
// (attack > 0: silent -> gainPeak -> silent) or starts at gainPeak and
// decays straight away (attack 0, e.g. a percussive thud). Shared by every
// synthesized sound effect and each background-music note — they only ever
// differ in these parameters, never in the oscillator/gain wiring.
function scheduleTone(destGain, at, { type, freq, freqRamp, gainPeak, attack = 0, decay, stopPad }) {
  const o = audio.ac.createOscillator();
  o.type = type;
  const g = audio.ac.createGain();
  o.connect(g);
  g.connect(destGain);
  o.frequency.setValueAtTime(freq, at);
  if (freqRamp) {
    if (freqRamp.exp) o.frequency.exponentialRampToValueAtTime(freqRamp.to, at + freqRamp.time);
    else o.frequency.linearRampToValueAtTime(freqRamp.to, at + freqRamp.time);
  }
  if (attack > 0) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gainPeak, at + attack);
  } else {
    g.gain.setValueAtTime(gainPeak, at);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  o.start(at);
  o.stop(at + decay + stopPad);
}

// Hydraulic whine when the lift moves; pitch falls when dropping, rises
// when raising
function playHydraulic(downward) {
  if (!audio) return;
  const t = audio.ac.currentTime;
  scheduleTone(audio.master, t, {
    type: "triangle",
    freq: downward ? 900 : 500,
    freqRamp: { to: downward ? 500 : 900, time: 0.25 },
    gainPeak: 0.12,
    attack: 0.03,
    decay: 0.3,
    stopPad: 0.02,
  });
}

// Dull metallic thud when an implement is hitched on
function playClunk() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  scheduleTone(audio.master, t, {
    type: "sine",
    freq: 160,
    freqRamp: { to: 50, time: 0.12, exp: true },
    gainPeak: 0.25,
    decay: 0.15,
    stopPad: 0.01,
  });
}

// Soft thump when the trailer scoops up a grain sack
function playPickup() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  scheduleTone(audio.master, t, {
    type: "sine",
    freq: 300,
    freqRamp: { to: 90, time: 0.09, exp: true },
    gainPeak: 0.18,
    decay: 0.12,
    stopPad: 0.01,
  });
}

// Rising three-note chime when grain is sold at the farm
function playSell() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  [880, 1109, 1319].forEach((freq, i) => {
    scheduleTone(audio.master, t + i * 0.09, {
      type: "triangle",
      freq,
      gainPeak: 0.14,
      attack: 0.02,
      decay: 0.25,
      stopPad: 0.01,
    });
  });
}

// Falling two-note toll when the yearly property tax is collected
function playTax() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  [523, 349].forEach((freq, i) => {
    scheduleTone(audio.master, t + i * 0.16, {
      type: "triangle",
      freq,
      gainPeak: 0.16,
      attack: 0.02,
      decay: 0.4,
      stopPad: 0.02,
    });
  });
}

// Music and sound toggles work both in-game and inside the menu (which
// swallows all other input), so they live in shared helpers
function toggleMusic() {
  musicMuted = !musicMuted;
  audio.musicGain.gain.setTargetAtTime(musicMuted ? 0 : 1, audio.ac.currentTime, 0.02);
}

function toggleSound() {
  soundMuted = !soundMuted;
  audio.master.gain.setTargetAtTime(soundMuted ? 0 : 0.5, audio.ac.currentTime, 0.02);
}
