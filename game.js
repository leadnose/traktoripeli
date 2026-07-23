"use strict";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const screenCanvas = document.getElementById("game");
const screenCtx = screenCanvas.getContext("2d");
screenCtx.imageSmoothingEnabled = false;

// Everything is drawn to a low-res buffer and scaled up, so polygons come out
// as chunky pixels instead of smooth edges.
const PIXEL = 2;
const VIEW_W = screenCanvas.width / PIXEL; // 320
const VIEW_H = screenCanvas.height / PIXEL; // 200

const view = document.createElement("canvas");
view.width = VIEW_W;
view.height = VIEW_H;
const ctx = view.getContext("2d");

// Restrict a value to a [lo, hi] range — used all over for keeping a number
// (a coordinate, a rolling stick axis, an angle delta) within its bounds.
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Is (px, py) within radius r of (x, y)? Shared by every "am I standing at
// this landmark" proximity check (farm, fuel tank, city).
function nearPoint(px, py, x, y, r) {
  return Math.hypot(px - x, py - y) < r;
}

// ---------------------------------------------------------------------------
// Map profiles: the world is always one of exactly 10 fixed archetypes,
// each with its own RNG seed (so it's exactly as reproducible as a free
// seed used to be) and its own target ranges for water/field/forest
// coverage and hill scale. Within its own ranges a map still rolls organic
// variation call to call — the bands just keep it from ever drifting into a
// different archetype the way an arbitrary free-form seed could.
// water and field are shares the generator always rolled (water: share of
// the whole grid, field: share of dry land). forest is a share of what's
// left over after water and field — the open, unfarmed grass — so forest
// and "free land" are a direct complementary pair: forest: [0,1] means
// none of that leftover land is wooded (all free/open grass) up to all of
// it (no free land at all), and every value in between is reachable.
// meadow is, in turn, a share of whatever free grass forest didn't claim —
// open ground given over to tall wildflower patches instead of plain grass.
// hilliness is a multiplier on the hill generator's stock count/height.
// ---------------------------------------------------------------------------

// Each profile also carries a palette: the map's own take on ground, water,
// sky and canopy color, so e.g. Highlands reads as cool heather moorland
// while Patchwork Farm reads as bright cultivated lowland. grass/dirt/skyTop/
// skyBottom/canopy are [spring, summer, autumn] triples fed through the same
// seasonHex() wheel as before; water/road/conifer are single tones (conifers
// don't turn with the seasons, and water/roads read as one steady color
// year-round). Everything else — dot speckles, furrows, bridges, ditches,
// minimap tones, tree canopy tiers — is derived from these few tones at load
// time via tint(), so a new theme only needs these fields.
const MAP_PROFILES = [
  {
    name: "Homestead Plains", seed: 1137, water: [0.03, 0.10], field: [0.45, 0.65], forest: [0.10, 0.25], meadow: [0.20, 0.40], hilliness: [0.4, 0.6], broadleaf: 0.8,
    palette: {
      grass: ["#78b064", "#609554", "#a69e62"],
      dirt: ["#9c8771", "#9c8771", "#9c8771"],
      water: "#4e7eb3",
      skyTop: ["#93b8cc", "#8ab0c3", "#9db1c0"],
      skyBottom: ["#d4e5ec", "#cee0e6", "#e0e1cb"],
      road: "#b2a38e",
      canopy: ["#659f61", "#5f945a", "#a18049"],
      conifer: "#365938",
    },
  },
  {
    name: "River Valley", seed: 1274, water: [0.35, 0.50], field: [0.20, 0.35], forest: [0.15, 0.30], meadow: [0.15, 0.30], hilliness: [0.8, 1.2], broadleaf: 0.6,
    palette: {
      grass: ["#73ad60", "#5a8d4e", "#9d955a"],
      dirt: ["#937c65", "#937c65", "#937c65"],
      water: "#4e85b7",
      skyTop: ["#97b9cd", "#8bafc3", "#99aebd"],
      skyBottom: ["#d7e5eb", "#d0e0e5", "#dadbc6"],
      road: "#aa9a86",
      canopy: ["#639b5f", "#598d57", "#9c7c47"],
      conifer: "#365938",
    },
  },
  {
    name: "Highlands", seed: 1411, water: [0.10, 0.20], field: [0.15, 0.30], forest: [0.30, 0.50], meadow: [0.25, 0.45], hilliness: [1.7, 2.2], broadleaf: 0.1,
    palette: {
      grass: ["#7d8863", "#707d56", "#90875e"],
      dirt: ["#8b8376", "#8b8376", "#8b8376"],
      water: "#607a86",
      skyTop: ["#95a0a8", "#8b98a1", "#89929a"],
      skyBottom: ["#ced5d7", "#c8d0d3", "#d0d0c5"],
      road: "#9b9488",
      canopy: ["#6a7d5a", "#5e6f50", "#8b764c"],
      conifer: "#3e4e42",
      flowers: ["#b48fd1", "#ffffff", "#e0d156"], // heather and gorse, not the usual meadow mix
    },
  },
  {
    name: "Deep Woods", seed: 1548, water: [0.20, 0.35], field: [0.05, 0.15], forest: [0.85, 1.00], meadow: [0.00, 0.10], hilliness: [0.8, 1.2], broadleaf: 0.25,
    palette: {
      grass: ["#659058", "#547e4c", "#8e8856"],
      dirt: ["#786b5a", "#786b5a", "#786b5a"],
      water: "#416989",
      skyTop: ["#86a5b8", "#7d9eb0", "#8c9ead"],
      skyBottom: ["#c9d9de", "#c4d5d6", "#d4d4c2"],
      road: "#9b8d7d",
      canopy: ["#4a754d", "#3f6642", "#846f40"],
      conifer: "#2d4436",
    },
  },
  {
    name: "Patchwork Farm", seed: 1685, water: [0.03, 0.10], field: [0.55, 0.72], forest: [0.00, 0.08], meadow: [0.35, 0.55], hilliness: [0.4, 0.6], broadleaf: 0.85,
    palette: {
      grass: ["#82b96c", "#679d5a", "#aca46e"],
      dirt: ["#a08b73", "#a08b73", "#a08b73"],
      water: "#5a8cbb",
      skyTop: ["#9abdd0", "#91b6c9", "#a2b6c5"],
      skyBottom: ["#d8e9ef", "#d3e5ea", "#e3e5cf"],
      road: "#b8a995",
      canopy: ["#6ca467", "#64965e", "#ad8d4e"],
      conifer: "#365938",
    },
  },
  {
    name: "Lake District", seed: 1822, water: [0.45, 0.60], field: [0.10, 0.20], forest: [0.10, 0.25], meadow: [0.20, 0.35], hilliness: [0.4, 0.6], broadleaf: 0.45,
    palette: {
      grass: ["#76b568", "#609c57", "#a19a5f"],
      dirt: ["#95846e", "#95846e", "#95846e"],
      water: "#5091c3",
      skyTop: ["#98bfd1", "#8eb7ca", "#9fb7c6"],
      skyBottom: ["#cee5ec", "#c9e1e8", "#dcdeca"],
      road: "#ab9c88",
      canopy: ["#68a463", "#5e9359", "#9d8148"],
      conifer: "#39603f",
    },
  },
  {
    name: "Rolling Hills", seed: 1959, water: [0.10, 0.20], field: [0.30, 0.45], forest: [0.30, 0.50], meadow: [0.25, 0.45], hilliness: [1.3, 1.7], broadleaf: 0.65,
    palette: {
      grass: ["#7cb065", "#659757", "#a99e65"],
      dirt: ["#9b8771", "#9b8771", "#9b8771"],
      water: "#5785b1",
      skyTop: ["#96bbcd", "#8db3c5", "#9fb2be"],
      skyBottom: ["#d5e5eb", "#d0dfe4", "#e1e2cb"],
      road: "#afa08c",
      canopy: ["#67a062", "#5e925b", "#a1824b"],
      conifer: "#3c6441",
    },
  },
  {
    name: "Wetlands", seed: 2096, water: [0.35, 0.50], field: [0.05, 0.15], forest: [0.60, 0.80], meadow: [0.05, 0.20], hilliness: [0.4, 0.6], broadleaf: 0.7,
    palette: {
      grass: ["#789465", "#698558", "#89885f"],
      dirt: ["#70695b", "#70695b", "#70695b"],
      water: "#4f7061",
      skyTop: ["#99aeb4", "#90a7ad", "#9ba5a5"],
      skyBottom: ["#d6e0df", "#d0dcdc", "#d2d5c4"],
      road: "#8b8373",
      canopy: ["#62865c", "#567851", "#8b8051"],
      conifer: "#394f40",
    },
  },
  {
    name: "The Common", seed: 2233, water: [0.03, 0.10], field: [0.05, 0.15], forest: [0.00, 0.08], meadow: [0.45, 0.65], hilliness: [0.8, 1.2], broadleaf: 0.6,
    palette: {
      grass: ["#8ea369", "#7d915b", "#a99f61"],
      dirt: ["#a2907a", "#a2907a", "#a2907a"],
      water: "#638fb4",
      skyTop: ["#b5cad8", "#adc2d0", "#adb9c1"],
      skyBottom: ["#e6eff2", "#e1eaee", "#dfe1cb"],
      road: "#b5a894",
      canopy: ["#7da469", "#6e935d", "#a38b51"],
      conifer: "#436245",
    },
  },
  {
    name: "The Weald", seed: 2370, water: [0.10, 0.20], field: [0.05, 0.15], forest: [0.85, 1.00], meadow: [0.00, 0.10], hilliness: [1.7, 2.2], broadleaf: 0.75,
    palette: {
      grass: ["#69885c", "#59794f", "#7f7a4c"],
      dirt: ["#7b6d5e", "#7b6d5e", "#7b6d5e"],
      water: "#497088",
      skyTop: ["#8caabb", "#81a1b2", "#8897a1"],
      skyBottom: ["#cbdbde", "#c6d6da", "#d1d3c0"],
      road: "#968978",
      canopy: ["#568457", "#4a764c", "#817045"],
      conifer: "#2c4435",
    },
  },
];

// ---------------------------------------------------------------------------
// Seeded RNG: the whole world is generated through rand(), so the same map
// number always produces the same world. Picked from the F1 menu (or ?map=
// in the URL, 1-10); anything out of range gets replaced with a random pick.
// ---------------------------------------------------------------------------

const urlParams = new URLSearchParams(location.search);
const mapParam = parseInt(urlParams.get("map"), 10);
const MAP_INDEX =
  Number.isInteger(mapParam) && mapParam >= 1 && mapParam <= MAP_PROFILES.length
    ? mapParam
    : 1 + ((Math.random() * MAP_PROFILES.length) | 0);
const PROFILE = MAP_PROFILES[MAP_INDEX - 1];
const SEED = PROFILE.seed;

// Game mode: "survival" rolls year after year — growing season running
// straight through, Jan 1 to Dec 31 — with a property tax due every Dec 31,
// and "sandbox" rolls the same years with no taxes, no failure and no end —
// just roaming. Chosen in the start menu; reloads carry the mode in the URL
// next to the map number, and a fresh visit (no mode in the URL) opens the
// start menu before anything moves.
const MODES = ["survival", "sandbox"];
let mode = MODES.includes(urlParams.get("mode")) ? urlParams.get("mode") : "survival";
let gameStarted = urlParams.has("mode");

const rand = (function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(SEED >>> 0);

console.log(
  `map ${MAP_INDEX}/${MAP_PROFILES.length} — ${PROFILE.name} — reload with ?map=${MAP_INDEX} to reproduce`
);

// Roll a value within one of this map's profile bands (a [min,max] pair)
function rollBand(range) {
  return range[0] + rand() * (range[1] - range[0]);
}

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

// ---------------------------------------------------------------------------
// Background music: a gentle music-box arpeggio over an A / F#m / D / E
// progression, with a soft bass under it. Notes are scheduled a quarter
// second ahead of the clock from the frame loop.
// ---------------------------------------------------------------------------

const MUSIC_BASE = 440; // arpeggio around A4; the bass sits two octaves down
const ARP_PATTERN = [0, 1, 2, 3, 1, 2, 3, 2];

// The tune follows the season: spring is quick and bright, summer eases
// into the familiar lazy progression, and autumn slows down and turns minor
const MUSIC_SEASONS = [
  {
    bpm: 112,
    dur: 0.4,
    chords: [
      { root: 0, minor: false }, // A
      { root: -7, minor: false }, // D
      { root: 0, minor: false }, // A
      { root: -5, minor: false }, // E
    ],
  },
  {
    bpm: 104,
    dur: 0.5,
    chords: [
      { root: 0, minor: false }, // A
      { root: -3, minor: true }, // F#m
      { root: -7, minor: false }, // D
      { root: -5, minor: false }, // E
    ],
  },
  {
    bpm: 88,
    dur: 0.75,
    chords: [
      { root: -3, minor: true }, // F#m
      { root: -7, minor: false }, // D
      { root: 2, minor: true }, // Bm
      { root: -5, minor: false }, // E
    ],
  },
];

function musicNote(freq, at, dur, vol) {
  const o = audio.ac.createOscillator();
  o.type = "triangle";
  const g = audio.ac.createGain();
  o.connect(g);
  g.connect(audio.musicGain);
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function scheduleMusic() {
  // After a pause (hidden tab), skip ahead instead of replaying missed notes
  if (audio.musicTime < audio.ac.currentTime - 0.1) {
    audio.musicTime = audio.ac.currentTime + 0.1;
  }
  while (audio.musicTime < audio.ac.currentTime + 0.25) {
    const step = audio.musicStep;
    const at = audio.musicTime;
    // The season's arrangement is picked up at bar boundaries
    if (step % 8 === 0 || !audio.musicSeason) {
      audio.musicSeason =
        MUSIC_SEASONS[seasonQ < 1 / 3 ? 0 : seasonQ < 2 / 3 ? 1 : 2];
    }
    const cfg = audio.musicSeason;
    const chord = cfg.chords[((step / 8) | 0) % cfg.chords.length];
    const tones = [0, 7, 12, 12 + (chord.minor ? 3 : 4)];
    const st = chord.root + tones[ARP_PATTERN[step % 8]];
    musicNote(MUSIC_BASE * Math.pow(2, st / 12), at, cfg.dur, 0.055);
    if (step % 4 === 0) {
      musicNote((MUSIC_BASE / 4) * Math.pow(2, chord.root / 12), at, cfg.dur * 1.8, 0.09);
    }
    audio.musicStep++;
    audio.musicTime += 60 / cfg.bpm / 2;
  }
}

const WORK_NOISE = { plow: [220, 0.16], seeder: [480, 0.14], harvester: [1100, 0.22] };

function updateAudio() {
  if (!audio) return;
  scheduleMusic();
  const t = audio.ac.currentTime;
  const set = (param, v, tc) => param.setTargetAtTime(v, t, tc);

  // Engine pitch and volume track speed, with a bump while throttling
  const throttle =
    !gameOver &&
    !paused &&
    (keys.ArrowUp ||
      keys.ArrowDown ||
      autoThrottling() ||
      (touchDrive.throttleActive && Math.abs(touchDrive.throttle) > 0.05))
      ? 1
      : 0;
  const rpm = gameOver
    ? 0
    : 0.25 + 0.55 * Math.min(1, Math.abs(tractor.speed) / GEAR_FAST) + 0.2 * throttle;
  set(audio.osc1.frequency, 50 + rpm * 60, 0.08);
  set(audio.osc2.frequency, 25 + rpm * 30, 0.08);
  set(audio.lfo.frequency, 7 + rpm * 20, 0.1);
  set(audio.engineGain.gain, gameOver ? 0 : 0.1 + rpm * 0.1, 0.1);

  // Ground work noise while a lowered implement is moving
  const imp = IMPLEMENTS[tractor.implement];
  const working =
    !gameOver && imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > MOVING_THRESHOLD;
  const [center, level] = WORK_NOISE[tractor.implement] || [300, 0.15];
  set(audio.workFilter.frequency, center, 0.1);
  set(audio.workGain.gain, working ? level : 0, 0.15);
}

// Hydraulic whine when the lift moves; pitch falls when dropping, rises
// when raising
function playHydraulic(downward) {
  if (!audio) return;
  const t = audio.ac.currentTime;
  const o = audio.ac.createOscillator();
  o.type = "triangle";
  const g = audio.ac.createGain();
  o.connect(g);
  g.connect(audio.master);
  o.frequency.setValueAtTime(downward ? 900 : 500, t);
  o.frequency.linearRampToValueAtTime(downward ? 500 : 900, t + 0.25);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.start(t);
  o.stop(t + 0.32);
}

// Dull metallic thud when an implement is hitched on
function playClunk() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  const o = audio.ac.createOscillator();
  o.type = "sine";
  const g = audio.ac.createGain();
  o.connect(g);
  g.connect(audio.master);
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  o.start(t);
  o.stop(t + 0.16);
}

// Soft thump when the trailer scoops up a grain sack
function playPickup() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  const o = audio.ac.createOscillator();
  o.type = "sine";
  const g = audio.ac.createGain();
  o.connect(g);
  g.connect(audio.master);
  o.frequency.setValueAtTime(300, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.start(t);
  o.stop(t + 0.13);
}

// Rising three-note chime when grain is sold at the farm
function playSell() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  [880, 1109, 1319].forEach((freq, i) => {
    const o = audio.ac.createOscillator();
    o.type = "triangle";
    const g = audio.ac.createGain();
    o.connect(g);
    g.connect(audio.master);
    const at = t + i * 0.09;
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.14, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    o.start(at);
    o.stop(at + 0.26);
  });
}

// Falling two-note toll when the yearly property tax is collected
function playTax() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  [523, 349].forEach((freq, i) => {
    const o = audio.ac.createOscillator();
    o.type = "triangle";
    const g = audio.ac.createGain();
    o.connect(g);
    g.connect(audio.master);
    const at = t + i * 0.16;
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.16, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    o.start(at);
    o.stop(at + 0.42);
  });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = {};
const touchDrive = {
  steering: 0, // -1..1 (left..right)
  throttle: 0, // -1..1 (reverse/brake..forward)
  steeringActive: false,
  throttleActive: false,
};
const IMPLEMENT_KEYS = { 1: "plow", 2: "seeder", 3: "harvester", 4: "trailer" };

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

// F1 opens the menu, the only place the map and mode can be picked. It is
// also the start menu: a fresh visit begins with it open and the clock held.
let menuOpen = !gameStarted;
// P holds the whole world still — clock, crops, critters — until P again.
// Unlike the F1 menu, which leaves the calendar running, pause means pause.
let paused = false;
// A toggles work mode's auto-throttle off and back on, for anyone who'd
// rather hold the accelerator themselves. On by default.
let autoThrottleOn = true;
// D opens a little date field: type MMDD and Enter fast-forwards the
// calendar to that date — into next year if it's already passed, in the
// cyclical modes — growing crops and collecting taxes on the way, exactly
// like the away clock would.
let dateJump = null; // null = closed, else the digits typed so far
let dateJumpError = false; // the last Enter was an impossible or past date
let menuMap = 1; // the start menu defaults to map 1; R rolls a random one
let menuMode = mode;
// The autosave the menu offers to continue, read once when the menu opens
// (parsing the save JSON every drawn frame would be wasteful)
let menuSaveInfo = null;

// Away clock, toggled in the menu: rAF stops in a hidden tab, so normally
// game time freezes there. With this on, the lost time is applied in one
// catch-up step on return — crops grow, the calendar turns, taxes fall due.
const AWAY_CLOCK_KEY = "traktoripeli.awayclock";
let awayClock = false;
try {
  awayClock = localStorage.getItem(AWAY_CLOCK_KEY) === "1";
} catch {
  // private browsing etc: the option just isn't persisted
}

window.addEventListener("keydown", (e) => {
  // Browsers only allow audio after a user gesture
  initAudio();
  if (audio.ac.state === "suspended") audio.ac.resume();
  if (e.key === "F1" && !e.repeat) {
    e.preventDefault();
    if (!gameStarted) return; // the start menu stays until a mode is picked
    menuOpen = !menuOpen;
    dateJump = null; // one sign at a time
    menuMap = MAP_INDEX; // mid-game the field opens on the current map
    menuMode = mode;
    if (menuOpen) menuSaveInfo = loadSave();
    return;
  }
  if (gameOver && !menuOpen && (e.key === "s" || e.key === "S") && !e.repeat) {
    continueInSandbox();
    return;
  }
  if (menuOpen) {
    // The menu swallows all input: left/right pick the map, up/down pick
    // the mode, digits jump straight to a map, R rolls a random one, Enter
    // starts, Esc closes (once a game is running)
    e.preventDefault();
    if (e.key === "Enter") {
      clearSave(); // Enter always begins a fresh run
      if (!gameStarted && menuMap === MAP_INDEX) {
        // Same map as the one already generated: start without a reload
        startGame(menuMode);
      } else {
        // The reload's pagehide must not re-save the run just discarded
        savingDisabled = true;
        location.search = `?map=${menuMap}&mode=${menuMode}`;
      }
    } else if (e.key === "c" || e.key === "C") {
      // Continue the autosaved run: reloading with its map and mode in
      // the URL restores the save at boot
      if (menuSaveInfo)
        location.search = `?map=${menuSaveInfo.map}&mode=${menuSaveInfo.mode}`;
    } else if (e.key === "r" || e.key === "R") {
      menuMap = 1 + ((Math.random() * MAP_PROFILES.length) | 0);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const dir = e.key === "ArrowDown" ? 1 : -1;
      menuMode = MODES[(MODES.indexOf(menuMode) + dir + MODES.length) % MODES.length];
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      menuMap = ((menuMap - 1 + dir + MAP_PROFILES.length) % MAP_PROFILES.length) + 1;
    } else if ((e.key === "t" || e.key === "T") && !e.repeat) {
      awayClock = !awayClock;
      try {
        localStorage.setItem(AWAY_CLOCK_KEY, awayClock ? "1" : "0");
      } catch {
        // not persisted, still applies to this session
      }
    } else if ((e.key === "m" || e.key === "M") && !e.repeat) {
      toggleMusic();
    } else if ((e.key === "q" || e.key === "Q") && !e.repeat) {
      toggleSound();
    } else if (e.key === "Escape") {
      if (gameStarted) menuOpen = false;
    } else if (/^[0-9]$/.test(e.key)) {
      // 1-9 jump straight to that map, 0 is map 10
      const n = e.key === "0" ? 10 : parseInt(e.key, 10);
      if (n <= MAP_PROFILES.length) menuMap = n;
    }
    return;
  }
  // The date-jump field swallows all input while it is open: type the
  // digits of MMDD, Enter jumps, Esc (or D again) closes
  if (dateJump !== null) {
    e.preventDefault();
    if (e.key === "Enter") {
      tryDateJump();
    } else if (e.key === "Escape" || e.key === "d" || e.key === "D") {
      dateJump = null;
    } else if (e.key === "Backspace") {
      dateJump = dateJump.slice(0, -1);
      dateJumpError = false;
    } else if (/^[0-9]$/.test(e.key) && dateJump.length < 4) {
      dateJump += e.key;
      dateJumpError = false;
    }
    return;
  }
  if (e.key.startsWith("Arrow")) e.preventDefault();
  keys[e.key] = true;
  if ((e.key === "m" || e.key === "M") && !e.repeat) toggleMusic();
  if ((e.key === "q" || e.key === "Q") && !e.repeat) toggleSound();
  if ((e.key === "f" || e.key === "F") && !e.repeat) fpsShown = !fpsShown;
  if ((e.key === "p" || e.key === "P") && !e.repeat && gameStarted && !gameOver)
    paused = !paused;
  if (paused) return; // the frozen world ignores gear and implement keys
  if ((e.key === "a" || e.key === "A") && !e.repeat && gameStarted && !gameOver) {
    autoThrottleOn = !autoThrottleOn;
  }
  if ((e.key === "d" || e.key === "D") && !e.repeat && gameStarted && !gameOver) {
    dateJump = "";
    dateJumpError = false;
    return;
  }
  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    // One toggle for the whole maneuver: road mode is the fast gear with the
    // implement raised, work mode the slow gear with it lowered
    const imp = IMPLEMENTS[tractor.implement];
    if (tractor.fastGear) {
      tractor.fastGear = false;
      if (imp.liftable) {
        // Lowering needs field dirt under the working width
        if (!implementOverField()) {
          tractor.implBounce = 0.6; // it tries, catches, and springs back up
        } else {
          tractor.implDown = true;
          tractor.implBounce = 0;
        }
        playHydraulic(true);
      }
    } else {
      // Lift before shifting up
      tractor.fastGear = true;
      if (tractor.implDown) {
        tractor.implDown = false;
        playHydraulic(false);
      }
    }
  }
  if (IMPLEMENT_KEYS[e.key] && !e.repeat) {
    // Implements are swapped at the farmyard
    if (nearFarm()) {
      if (tractor.implement !== IMPLEMENT_KEYS[e.key]) {
        tractor.implement = IMPLEMENT_KEYS[e.key];
        tractor.implDown = false;
        tractor.implLift = 1;
        playClunk();
      }
    } else {
      tractor.implFlash = 0.9;
    }
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

// ---------------------------------------------------------------------------
// Touch controls: on-screen buttons for phones/tablets (CSS shows them only
// on coarse, hover-less pointers). Every button just dispatches the same
// synthetic keyboard events the handlers above already process, so driving,
// menus and implement switching all work identically to keyboard input
// without a second code path to keep in sync.
// ---------------------------------------------------------------------------

(function setupTouchControls() {
  const root = document.getElementById("touch-controls");
  if (!root) return;

  function fireKey(type, key) {
    initAudio(); // a touch is a user gesture too; unlocks audio the same way
    if (audio.ac.state === "suspended") audio.ac.resume();
    window.dispatchEvent(new KeyboardEvent(type, { key }));
  }

  // Tracked by pointerId (not just per-button) so a finger that slides off
  // a button, or a cancelled touch, can never leave a key stuck down.
  const activePointers = new Map();

  function release(pointerId) {
    const entry = activePointers.get(pointerId);
    if (!entry) return;
    activePointers.delete(pointerId);
    entry.btn.classList.remove("tbtn-active");
    fireKey("keyup", entry.key);
  }

  // Drive controls: two separate joysticks so right hand steers and left
  // hand controls the throttle.  Each joystick is constrained to a single
  // axis so the intention is always unambiguous.
  (function setupDriveJoysticks() {
    // axes: "horizontal" → ArrowLeft/ArrowRight  |  "vertical" → ArrowUp/ArrowDown
    function setupJoystickElement(baseId, knobId, axes, deadzone = 0.35) {
      const base = document.getElementById(baseId);
      const knob = document.getElementById(knobId);
      if (!base || !knob) return;
      const axisSize = axes === "horizontal" ? base.clientWidth : base.clientHeight;
      const RADIUS = Math.max(40, axisSize * 0.3); // px the knob can travel from centre
      const DEADZONE = deadzone; // fraction of RADIUS before an axis engages
      let pointerId = null;
      const dir = axes === "horizontal"
        ? { ArrowLeft: false, ArrowRight: false }
        : { ArrowUp: false, ArrowDown: false };

      function setDir(key, on) {
        if (dir[key] === on) return;
        dir[key] = on;
        fireKey(on ? "keydown" : "keyup", key);
      }

      function resetAll() {
        for (const key of Object.keys(dir)) setDir(key, false);
        knob.style.transform = "translate(0, 0)";
        if (axes === "horizontal") {
          touchDrive.steering = 0;
          touchDrive.steeringActive = false;
        } else {
          touchDrive.throttle = 0;
          touchDrive.throttleActive = false;
        }
      }

      function handleMove(e) {
        const rect = base.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const applyDeadzone = (v) => {
          const av = Math.abs(v);
          if (av <= DEADZONE) return 0;
          return ((av - DEADZONE) / (1 - DEADZONE)) * Math.sign(v);
        };
        if (axes === "horizontal") {
          const nxRaw = clamp(dx / RADIUS, -1, 1);
          const cx = nxRaw * RADIUS;
          knob.style.transform = `translate(${cx}px, 0)`;
          const steering = applyDeadzone(nxRaw);
          touchDrive.steering = steering;
          touchDrive.steeringActive = true;
          setDir("ArrowLeft", steering < 0);
          setDir("ArrowRight", steering > 0);
        } else {
          const nyRaw = clamp(dy / RADIUS, -1, 1);
          const cy = nyRaw * RADIUS;
          knob.style.transform = `translate(0, ${cy}px)`;
          const throttle = -applyDeadzone(nyRaw);
          touchDrive.throttle = throttle;
          touchDrive.throttleActive = true;
          setDir("ArrowUp", throttle > 0);
          setDir("ArrowDown", throttle < 0);
        }
      }

      base.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pointerId = e.pointerId;
        base.setPointerCapture(pointerId);
        initAudio();
        if (audio.ac.state === "suspended") audio.ac.resume();
        handleMove(e);
      });
      base.addEventListener("pointermove", (e) => {
        if (e.pointerId !== pointerId) return;
        handleMove(e);
      });
      function end(e) {
        if (pointerId === null || e.pointerId !== pointerId) return;
        pointerId = null;
        resetAll();
      }
      base.addEventListener("pointerup", end);
      base.addEventListener("pointercancel", end);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    }

    setupJoystickElement("td-joystick", "td-joystick-knob", "horizontal", 0.55); // steering (higher dead-zone → less twitchy)
    setupJoystickElement("td-throttle", "td-throttle-knob", "vertical");   // throttle
  })();

  root.querySelectorAll(".tbtn[data-key]").forEach((btn) => {
    const key = btn.dataset.key;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.classList.add("tbtn-active");
      activePointers.set(e.pointerId, { btn, key });
      fireKey("keydown", key);
    });
    btn.addEventListener("pointerup", (e) => release(e.pointerId));
    btn.addEventListener("pointercancel", (e) => release(e.pointerId));
    btn.addEventListener("pointerleave", (e) => release(e.pointerId));
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  window.addEventListener("pointerup", (e) => release(e.pointerId));
  window.addEventListener("pointercancel", (e) => release(e.pointerId));

  const fsBtn = document.getElementById("td-fullscreen");
  fsBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    initAudio();
    if (audio.ac.state === "suspended") audio.ac.resume();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (screenCanvas.requestFullscreen) {
      screenCanvas.requestFullscreen().catch(() => {});
    }
  });

  // The Enter button and the driving-only controls (gear/implements) are
  // shown or hidden depending on whether a menu or the date-jump field is
  // currently open, so idle buttons never sit in the way of the other mode.
  // The gear button also relabels itself to match the current mode (the
  // HUD's own "MODE: ROAD/WORK") instead of showing a static glyph, and
  // flashes the same way the HUD text does when a lower is refused.
  const spaceBtn = document.getElementById("td-space");
  const autoBtn = document.getElementById("td-auto");
  function syncVisibility() {
    const menuish = !gameStarted || menuOpen || dateJump !== null;
    document.body.classList.toggle("menu-mode", menuish);
    if (gameStarted) {
      const flash = tractor.implFlash > 0 && ((tractor.implFlash * 8) | 0) % 2 === 0;
      spaceBtn.textContent = tractor.fastGear ? "⬆ ROAD" : "⬇ WORK";
      spaceBtn.classList.toggle("tbtn-warn", flash);
      spaceBtn.setAttribute(
        "aria-label",
        tractor.fastGear ? "Lower implement, work mode" : "Raise implement, road mode"
      );
      autoBtn.classList.toggle("tbtn-off", !autoThrottleOn);
    }
    requestAnimationFrame(syncVisibility);
  }
  requestAnimationFrame(syncVisibility);
})();

// ---------------------------------------------------------------------------
// Isometric projection (2:1, SimCity 2000 style)
// ---------------------------------------------------------------------------

// World: x/y on the ground plane, z up. One tile is TILE x TILE world units
// and projects to a 2*TILE wide, TILE tall diamond on screen.
const TILE = 16;
const MAP_TILES = 60;
const MAP_SIZE = MAP_TILES * TILE;

function projX(wx, wy) {
  return wx - wy;
}

function projY(wx, wy, wz) {
  return (wx + wy) / 2 - (wz || 0);
}

// Rotate a local (lx, ly) point by a precomputed cos/sin pair — the inner
// step of rotateLocal(), split out so hot per-frame loops that already have
// cos/sin for their model's heading can reuse them across many points
// instead of recomputing Math.cos/Math.sin for each one.
function rotateXY(cos, sin, lx, ly) {
  return { x: lx * cos - ly * sin, y: lx * sin + ly * cos };
}

// Rotate a local (lx, ly) point by angle and place it relative to an origin
// (ox, oy) — the common "local model point -> world position" transform
// used for fixtures, collision boxes and box-model corners alike.
function rotateLocal(ox, oy, angle, lx, ly) {
  const p = rotateXY(Math.cos(angle), Math.sin(angle), lx, ly);
  return { x: ox + p.x, y: oy + p.y };
}

// ---------------------------------------------------------------------------
// Farmyard location (needed by the terrain: the yard sits on a flat pad)
// ---------------------------------------------------------------------------

// The farmyard lands somewhere different on every map, kept well away from
// the edges. The buildings are square-cornered boxes on an isometric grid,
// so they only ever face one of the 4 cardinal ways — anything in between
// reads as buildings sitting crooked, off the grid.
const FARM = {
  x: MAP_SIZE * (0.2 + rand() * 0.6),
  y: MAP_SIZE * (0.2 + rand() * 0.6),
  angle: (Math.floor(rand() * 4) * Math.PI) / 2,
};
const FARM_RADIUS = 50; // within this distance farm services are available

function nearFarm() {
  return nearPoint(tractor.x, tractor.y, FARM.x, FARM.y, FARM_RADIUS);
}

// Cow and pig paddocks: unlike the other grazing species, these two stay
// fenced rather than free-ranging the whole map (see PENNED_SPECIES
// below), but each pen is a proper roomy field on open land — not a
// cramped pocket between buildings, not overlapping the working yard, not
// laid across a road, and not on water (cows get noticeably more room
// than pigs). Which of those actually holds depends entirely on this
// map's road/water layout, which doesn't exist yet this early — so only
// each paddock's SIZE is fixed here. The actual placement is picked in
// the block right after makeMap() below, once roadTiles/water exist, by
// generating a ring-and-angle spread of candidate positions all the way
// around the farm (not just a couple of fixed compass directions — a farm
// on a small spit of land needs every direction tried, not just south and
// east) and keeping whichever scores cleanest. PADDOCKS_LOCAL/PADDOCKS_WORLD
// are declared here as `let` and stay null until that block runs —
// nothing before it may read them.
const PADDOCK_SIZE = {
  cow: { w: 70, h: 32 },
  pig: { w: 36, h: 30 },
};
const PENNED_SPECIES = new Set(Object.keys(PADDOCK_SIZE));
let PADDOCKS_LOCAL = null;
let PADDOCKS_WORLD = null;

// Building footprints a paddock candidate must never cover — the same
// list FARM_SOLID_LOCAL (tractor collision, further down) builds from,
// minus the pig sty, which isn't a fixed obstacle: it gets carved out of
// whichever pig candidate wins, not placed independently of it.
const FARM_BUILDING_FOOTPRINTS = [
  [-16.0, 2.0, -12.0, 2.0], // barn
  [-13.0, 1.0, -30.0, -16.0], // farmhouse
  [-9.0, -4.0, 6.0, 11.0], // hen house
  [6.0, 15.0, -13.0, -4.0], // granary body
  [40.0, 42.0, -3.0, 9.0], // cartshed back wall
  [32.0, 42.0, -3.0, -1.0], // cartshed side wall
  [32.0, 42.0, 7.0, 9.0], // cartshed side wall
  [-2.0, 10.0, 32.0, 39.0], // cowshed
];

// Fixed rather than derived from the eventual pick (terrain generation
// runs, and needs this, before any candidate is scored) — sized to clear
// the single furthest corner the placement search below can ever produce
// (ring radius up to 108 + a paddock's own far corner, checked by hand),
// +16 margin (room for a forest blob's own radius, they grow up to ~6.5
// units). Re-check this by hand if the search's ring radii or PADDOCK_SIZE
// change.
const FARM_PASTURE_RADIUS = 205;

// The fuel tank sits out near the rim of the trampled yard (YARD_RADIUS
// is ~64 units; this is ~90% of that, clear of the barn/yard cluster
// near the center) rather than anywhere within FARM_RADIUS, so refueling
// (which costs cash) only happens when the player deliberately drives
// out to it, instead of automatically every time they're at the farm
// for seed or grain.
const FUEL_TANK_LOCAL = { x: -8, y: 57 };
const FUEL_TANK_RADIUS = 16;
// Shape of the tank itself: a long horizontal cylinder up on legs,
// see the FARM_BOXES/FARM_SHAPES entries built from these.
const FUEL_TANK_LEN = 5.0; // half-length of the cylinder
const FUEL_TANK_R = 2.2; // cylinder radius
const FUEL_TANK_STAND_H = 2.4; // leg height under the tank
function fuelTankPos() {
  return rotateLocal(FARM.x, FARM.y, FARM.angle, FUEL_TANK_LOCAL.x, FUEL_TANK_LOCAL.y);
}
function nearFuelTank() {
  const p = fuelTankPos();
  return nearPoint(tractor.x, tractor.y, p.x, p.y, FUEL_TANK_RADIUS);
}

// ---------------------------------------------------------------------------
// City location: where grain actually gets sold. Placed a real drive away
// from the farm so hauling a full trailer there and back is a genuine trip,
// not a same-spot errand.
// ---------------------------------------------------------------------------

// Keyed by its own hash (not the shared `rand()`), same reasoning as
// yardHash below: placing the city must never shift the seeded sequence
// hill/water/decoration generation depends on for the hand-tuned map
// archetypes, and a rejection-sampling loop would otherwise burn a
// different, unpredictable number of rand() calls on every map.
function cityHash(i) {
  let s = (SEED ^ Math.imul(i + 1, 0x27d4eb2f)) | 0;
  s = (s + 0x165667b1) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const CITY_MIN_DIST = MAP_SIZE * 0.55;
function pickCityPos() {
  for (let tries = 0; tries < 50; tries++) {
    const x = MAP_SIZE * (0.1 + cityHash(tries * 2) * 0.8);
    const y = MAP_SIZE * (0.1 + cityHash(tries * 2 + 1) * 0.8);
    if (Math.hypot(x - FARM.x, y - FARM.y) >= CITY_MIN_DIST) return { x, y };
  }
  // Fallback: the farthest corner of the sampling square from the farm.
  // FARM only ever lands within the central 60% of the map, so even its
  // worst case (dead center) leaves every corner of this 80%-wide square
  // comfortably past CITY_MIN_DIST — unlike a mirror-through-center trick,
  // which degrades to no distance at all exactly when the farm is central.
  let best = null;
  let bestDist = -1;
  for (const fx of [0.1, 0.9]) {
    for (const fy of [0.1, 0.9]) {
      const x = MAP_SIZE * fx;
      const y = MAP_SIZE * fy;
      const d = Math.hypot(x - FARM.x, y - FARM.y);
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  return best;
}
const CITY = { ...pickCityPos(), angle: cityHash(500) * Math.PI * 2 };
const CITY_RADIUS = 30; // within this distance the depot buys grain

function nearCity() {
  return nearPoint(tractor.x, tractor.y, CITY.x, CITY.y, CITY_RADIUS);
}

// The trodden yard isn't a perfect ellipse: each map bends its rim in and
// out by a deterministic amount so every farmyard reads as its own trampled
// patch of ground rather than a stamped-out shape. Keyed by its own hash
// (not the shared `rand()`) so adding it never shifts the seeded sequence
// everything after it — hills, decorations — depends on for the hand-tuned
// map archetypes.
const YARD_LOBES = 14;
function yardHash(i) {
  let s = (SEED ^ Math.imul(i + 1, 0x9e3779b9)) | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const YARD_SHAPE = [];
for (let i = 0; i < YARD_LOBES; i++) YARD_SHAPE.push(0.8 + yardHash(i) * 0.4);

// Interpolated rim scale at a given angle (0 = the ellipse's own radius).
function yardScaleAt(angle) {
  const t = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * YARD_LOBES;
  const i0 = Math.floor(t) % YARD_LOBES;
  const i1 = (i0 + 1) % YARD_LOBES;
  const f = t - Math.floor(t);
  return YARD_SHAPE[i0] * (1 - f) + YARD_SHAPE[i1] * f;
}
const YARD_MAX_SCALE = Math.max(...YARD_SHAPE);

// A world-space circle matching the yard's screen ellipse (screen ellipse
// radii are the true isometric projection of a world circle: projX has
// amplitude r*sqrt(2), projY has amplitude r/sqrt(2), a 2:1 ratio — exactly
// the ellipse's 1.8/0.9 radii). Used to gate tire tracks on the yard dirt,
// which otherwise only marks the unplowed-field tile type.
const YARD_RADIUS = (FARM_RADIUS * 1.8) / Math.SQRT2;
function inYard(wx, wy) {
  return Math.hypot(wx - FARM.x, wy - FARM.y) < YARD_RADIUS;
}

// Traces the yard's smoothed, lobed outline onto mapCtx around screen point
// fc (as returned by mp()); caller fills/strokes/clips as needed. Points sit
// at YARD_SHAPE's radii and the path threads their midpoints with quadratic
// curves, the standard canvas trick for a smooth closed blob through a fixed
// ring of control points.
function farmYardPath(fc) {
  const Rx = FARM_RADIUS * 1.8;
  const Ry = FARM_RADIUS * 0.9;
  const pts = YARD_SHAPE.map((scale, i) => {
    const a = (i / YARD_LOBES) * Math.PI * 2;
    return { x: fc.x + Math.cos(a) * Rx * scale, y: fc.y + Math.sin(a) * Ry * scale };
  });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  mapCtx.beginPath();
  const start = mid(pts[YARD_LOBES - 1], pts[0]);
  mapCtx.moveTo(start.x, start.y);
  for (let i = 0; i < YARD_LOBES; i++) {
    const next = pts[(i + 1) % YARD_LOBES];
    const nm = mid(pts[i], next);
    mapCtx.quadraticCurveTo(pts[i].x, pts[i].y, nm.x, nm.y);
  }
  mapCtx.closePath();
}

// ---------------------------------------------------------------------------
// Terrain: smooth rolling hills from summed cosine bumps, fading to flat
// near the map edges so the dirt cliffs stay level.
// ---------------------------------------------------------------------------

// This map's hilliness: a multiplier on both how many hills stack up and
// how tall each one is, rolled from the profile's band.
const HILLINESS = rollBand(PROFILE.hilliness);

const HILLS = [];
for (let i = 0; i < Math.round(40 * HILLINESS); i++) {
  HILLS.push({
    cx: MAP_SIZE * rand(),
    cy: MAP_SIZE * rand(),
    r: 60 + rand() * 100,
    h: (10 + rand() * 16) * HILLINESS,
  });
}

// No flattening under the farmyard: the buildings drape over the natural
// terrain like everything else. No flattening at the map edges either —
// hills run right up to (and are sliced by) the boundary; the cliff and
// clip both trace the real per-point height so there's nothing to keep flat.
function terrainHeight(wx, wy) {
  let h = 0;
  for (const hill of HILLS) {
    const d = Math.hypot(wx - hill.cx, wy - hill.cy);
    if (d < hill.r) h += hill.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / hill.r));
  }
  return 40 * Math.tanh(h / 40); // soft cap where hills stack
}

// ---------------------------------------------------------------------------
// Shared lighting helpers
// ---------------------------------------------------------------------------

const LIGHT = { x: 0.35, y: 0.6, z: 0.71 };

// Before shading, every base color is pulled a little toward warm cream and
// tilted away from blue, so the scene reads like inks printed on soft paper
// rather than raw screen color. Direct fills that skip lighting use
// shade(color, 1) to pick up the same treatment.
const PAPER_MIX = 0.12;
const PAPER = [246, 233, 205];
const INK_GAIN = [1.03, 1.0, 0.93];

// Outline ink shared by the scene silhouettes and the map's boundary lines
const INK = "#4a3827";

// Same ink, thinned out for the ground's own boundary lines so they read as
// soft creases in the paper rather than the heavier silhouette lines used
// elsewhere. The road/ditch rim gets its own, fainter still: stamps overlap
// along a path, so any tint there stacks up darker than a single tile edge.
const MAP_INK = "rgba(74, 56, 39, 0.3)";
const ROAD_INK = "rgba(74, 56, 39, 0.14)";

const shadeCache = {};
function shade(color, k) {
  const key = color + ((k * 100 + 0.5) | 0);
  if (shadeCache[key]) return shadeCache[key];
  const ch = (i) => {
    const v = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
    const p = (v * (1 - PAPER_MIX) + PAPER[i] * PAPER_MIX) * INK_GAIN[i];
    return Math.min(255, Math.round(p * k));
  };
  return (shadeCache[key] = `rgb(${ch(0)},${ch(1)},${ch(2)})`);
}

const mixCache = {};
function mixHex(a, b, t) {
  const key = a + b + ((t * 64) | 0);
  if (mixCache[key]) return mixCache[key];
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  let out = "#";
  for (const shift of [16, 8, 0]) {
    const v = Math.round(((va >> shift) & 255) * (1 - t) + ((vb >> shift) & 255) * t);
    out += v.toString(16).padStart(2, "0");
  }
  return (mixCache[key] = out);
}

// Lighten (amt > 0) or darken (amt < 0) a hex color toward white/black. Used
// to derive dot speckles, tiers, furrows and the like from a palette's few
// base tones instead of hand-authoring every shade per map.
function tint(hex, amt) {
  return amt >= 0 ? mixHex(hex, "#ffffff", amt) : mixHex(hex, "#000000", -amt);
}

function grassDotShades(base) {
  return [tint(base, -0.16), tint(base, 0.2), tint(base, 0.32), tint(base, -0.3)];
}

function dirtDotShades(base) {
  return [tint(base, -0.16), tint(base, 0.16)];
}

// Warms a grass tone toward wildflower-meadow yellow-green, so meadows read
// as a distinct patch of a map's own grass rather than a separate hue
function meadowTint(hex) {
  return mixHex(hex, "#ffe066", 0.35);
}

// Dries a dirt tone toward pale straw-gold, for stubble left standing after
// harvest but not yet plowed under — distinct from the darker turned-soil
// tone of a plowed or seeded tile, derived from the map's own dirt rather
// than a separate authored color
function stubbleTint(hex) {
  return mixHex(hex, "#e6c85a", 0.5);
}

// ---------------------------------------------------------------------------
// Ordered dithering: posterize colors to coarse levels and dither between
// them with a Bayer matrix, the classic pixel-art way to draw gradients.
// ---------------------------------------------------------------------------

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const DITHER_STEP = 24; // size of one posterized color level

function ditherRegion(c2d, x, y, w, h) {
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(c2d.canvas.width - x, Math.ceil(w));
  h = Math.min(c2d.canvas.height - y, Math.ceil(h));
  if (w <= 0 || h <= 0) return;
  const img = c2d.getImageData(x, y, w, h);
  const data = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (data[i + 3] === 0) continue;
      // Threshold from the absolute canvas position, so re-dithering a
      // repainted region is stable and lines up with its surroundings
      const t = ((BAYER[(y + py) & 3][(x + px) & 3] + 0.5) / 16) * DITHER_STEP;
      for (let ch = 0; ch < 3; ch++) {
        const v = data[i + ch];
        const base = Math.floor(v / DITHER_STEP) * DITHER_STEP;
        data[i + ch] = Math.min(255, base + (v - base > t ? DITHER_STEP : 0));
      }
    }
  }
  c2d.putImageData(img, x, y);
}

// ---------------------------------------------------------------------------
// Ground map (prerendered once)
// ---------------------------------------------------------------------------

const EDGE_DEPTH = 36; // thickness of the dirt "cliff" at the map's near edges
const MAP_OFFSET_X = MAP_SIZE; // shift so projX is never negative
const MAP_OFFSET_Y = 64; // headroom for hilltops that project above y = 0

const mapCanvas = document.createElement("canvas");
mapCanvas.width = MAP_SIZE * 2;
mapCanvas.height = MAP_SIZE + EDGE_DEPTH + MAP_OFFSET_Y;

// willReadFrequently keeps the canvas CPU-side: the constant background
// repaints re-dither through getImageData, and on a GPU-backed canvas every
// one of those is a pipeline-stalling readback
const mapCtx = mapCanvas.getContext("2d", { willReadFrequently: true });

// Tile types: 0 = grass, 1 = field (unplowed / stubble), 2 = plowed, 3 = seeded.
// dirs holds the furrow direction (0 = along world y, 1 = along world x) and
// growth the seconds since seeding, which drives the crop stages.
const tiles = [];
const dirs = [];
const growth = [];
const CROP_STAGES = [8, 18, 32]; // seconds to reach sprout / young / mature

function cropStage(g) {
  let s = 0;
  for (const t of CROP_STAGES) if (g >= t) s++;
  return s;
}

function tileTypeAt(wx, wy) {
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return -1;
  return tiles[ty][tx];
}

// Ground colors are seasonal: these are the spring values (from this map's
// own palette), and updateSeason() rewrites them as the round progresses
let GRASS = PROFILE.palette.grass[0];
const GRASS_DOTS = grassDotShades(GRASS);
// Meadow is warmer/yellower than plain grass — a wildflower patch — derived
// from the map's own grass tone rather than a separate authored color
let MEADOW = meadowTint(GRASS);
const MEADOW_DOTS = grassDotShades(MEADOW);
let DIRT = PROFILE.palette.dirt[0];
const DIRT_DOTS = dirtDotShades(DIRT);
// Stubble — a harvested field before it's plowed — reads as dried pale
// straw rather than bare soil
let STUBBLE = stubbleTint(DIRT);
const STUBBLE_DOTS = dirtDotShades(STUBBLE);

// The season color wheel, declared here because the initial map paint
// already reads it (through seasonHex): 0 = spring, 1/3 = summer,
// 2/3 = autumn; 1 wraps back onto spring. Continuous — mixHex quantizes
// the blends, so colors still move in tiny ticks.
let seasonQ = 0;
let seasonStep = -1; // sky repaint trigger, on a fine grid of seasonQ
const FLOWER_COLORS = PROFILE.palette.flowers || ["#ff9ed2", "#ffffff", "#c9a6ff", "#ffb27d"];

// The map's own water tone, and the drainage-ditch and ripple shades derived
// from it
const WATER_COLOR = PROFILE.palette.water;
const WATER_RIPPLE = tint(WATER_COLOR, 0.25);
const DITCH_COLOR = tint(WATER_COLOR, -0.12); // water-filled drainage ditches

// The farmyard's trodden dirt never turns with the seasons (unlike field
// dirt), so it's pinned to the map's base dirt tone rather than the mutable
// DIRT variable
const YARD_DIRT = PROFILE.palette.dirt[0];
const YARD_DIRT_DARK = tint(YARD_DIRT, -0.16);

const mp = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y,
});

// Flat (height-0) projection: used only for the cliffs' straight bottom rim,
// which sits level regardless of how the terrain above it undulates.
const mp0 = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, 0) + MAP_OFFSET_Y,
});

// Brightness at a world point from the terrain normal against the light
function groundShade(wx, wy) {
  const d = 4;
  const dzdx = (terrainHeight(wx + d, wy) - terrainHeight(wx - d, wy)) / (2 * d);
  const dzdy = (terrainHeight(wx, wy + d) - terrainHeight(wx, wy - d)) / (2 * d);
  const len = Math.hypot(dzdx, dzdy, 1);
  const dot = (-dzdx * LIGHT.x - dzdy * LIGHT.y + LIGHT.z) / len;
  return clamp(0.3 + dot, 0.4, 1.25);
}

function isField(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
  const t = tiles[ty][tx];
  return t >= 1 && t <= 3;
}

function isWater(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
  return tiles[ty][tx] === 4;
}

// Corners of a tile that are outer corners of its patch (both edge-neighbors
// touching that corner are a different kind); those corners get rounded
// off. Works for both field patches and water bodies via the `same`
// predicate. Deliberately ignores the diagonal neighbor: a fine zigzag
// shoreline is mostly "saddle" vertices (two of one kind and two of the
// other, meeting only corner-to-corner) rather than one tile alone against
// three — requiring the diagonal too would leave every one of those sharp,
// which is most of a jagged coast. Each of the (up to) four tiles touching
// such a vertex rounds its own corner independently; together they turn the
// crossing into a small rounded pinwheel instead of a hard point.
function tileGeometry(tx, ty, same) {
  const P = [
    mp(tx * TILE, ty * TILE),
    mp((tx + 1) * TILE, ty * TILE),
    mp((tx + 1) * TILE, (ty + 1) * TILE),
    mp(tx * TILE, (ty + 1) * TILE),
  ];
  const other = (ax, ay) => !same(ax, ay);
  const rounded = [
    other(tx, ty - 1) && other(tx - 1, ty),
    other(tx, ty - 1) && other(tx + 1, ty),
    other(tx + 1, ty) && other(tx, ty + 1),
    other(tx - 1, ty) && other(tx, ty + 1),
  ];
  return { P, rounded };
}

const CORNER_T = 0.45; // how far along the tile edges the rounding cuts in

// Dirt outline of a field tile with the rounded corners curved inward
function fieldPath(P, rounded) {
  const path = new Path2D();
  let started = false;
  for (let i = 0; i < 4; i++) {
    const cur = P[i];
    const prev = P[(i + 3) % 4];
    const next = P[(i + 1) % 4];
    if (rounded[i]) {
      const ax = cur.x + (prev.x - cur.x) * CORNER_T;
      const ay = cur.y + (prev.y - cur.y) * CORNER_T;
      const bx = cur.x + (next.x - cur.x) * CORNER_T;
      const by = cur.y + (next.y - cur.y) * CORNER_T;
      if (started) path.lineTo(ax, ay);
      else path.moveTo(ax, ay);
      path.quadraticCurveTo(cur.x, cur.y, bx, by);
    } else if (started) {
      path.lineTo(cur.x, cur.y);
    } else {
      path.moveTo(cur.x, cur.y);
    }
    started = true;
  }
  path.closePath();
  return path;
}

// Points along one straight edge of the map square, stepped per tile so the
// polyline follows the real terrain height instead of cutting a flat line
// corner-to-corner — hills run up to (and are sliced by) the boundary now.
// `project` defaults to the real-height mp(); pass mp0 for a level line.
function mapEdge(fromX, fromY, toX, toY, project = mp) {
  const pts = [];
  for (let i = 0; i <= MAP_TILES; i++) {
    const t = i / MAP_TILES;
    pts.push(project(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t));
  }
  return pts;
}

// Clip the map context to the ground diamond (caller does save/restore)
function clipMapDiamond() {
  mapCtx.beginPath();
  let started = false;
  for (const edge of [
    mapEdge(0, 0, MAP_SIZE, 0),
    mapEdge(MAP_SIZE, 0, MAP_SIZE, MAP_SIZE),
    mapEdge(MAP_SIZE, MAP_SIZE, 0, MAP_SIZE),
    mapEdge(0, MAP_SIZE, 0, 0),
  ]) {
    for (const p of edge) {
      if (!started) { mapCtx.moveTo(p.x, p.y); started = true; }
      else mapCtx.lineTo(p.x, p.y);
    }
  }
  mapCtx.closePath();
  mapCtx.clip();
}

// Ink lines along terrain boundaries. Each shared edge is drawn by the tile
// with the higher-ranking type (water > seeded > plowed > stubble > grass),
// following that tile's patch geometry so the line hugs the same rounded
// outline the fills use; rounded corners ink their crescent arc, and edges
// against the void draw the island's rim. Everything derives from the tile
// grid, so any repaint reproduces the exact same line pixels.
const EDGE_NEIGHBOR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function tileInk(tx, ty) {
  const t = tiles[ty][tx];
  const same = t === 4 ? isWater : t > 0 ? isField : () => true;
  const { P, rounded } = tileGeometry(tx, ty, same);

  // Grass has no patch of its own to round (`same` above is trivially true
  // for it), but a spit of grass against water gets the same crescent
  // treatment paintTile gives its fill: borrow the water-inverse geometry
  // so its own tip arcs here too.
  if (t === 0) {
    const wr = tileGeometry(tx, ty, (ax, ay) => !isWater(ax, ay)).rounded;
    for (let i = 0; i < 4; i++) rounded[i] = wr[i];
  }
  // `trim` extends `rounded` for straight-edge cutting only — never for
  // drawing this tile's own arc. Grass never draws its own edges (water
  // always outranks it), so at a corner where a lone grass tile rounds
  // (surrounded by water on both sides there), the water tile on either
  // side needs to stop its straight edge short to meet the grass tile's
  // arc — but that water tile's *other* edge at the same corner is often
  // just more water, an edge with no boundary at all, and letting the
  // ordinary rounded-corner code arc toward it would draw a stray line
  // into open water. (Saddle corners, where water is genuinely alone
  // against two grass edges, don't have this problem — both of the
  // corner's edges are real there, so self-detection via `same` above
  // already covers it, arc included.)
  const trim = rounded.slice();
  if (t === 4) {
    for (let i = 0; i < 4; i++) {
      const nx = tx + EDGE_NEIGHBOR[i][0];
      const ny = ty + EDGE_NEIGHBOR[i][1];
      if (nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES || tiles[ny][nx] !== 0) continue;
      const gr = tileGeometry(nx, ny, (ax, ay) => !isWater(ax, ay)).rounded;
      if (gr[(i + 3) % 4]) trim[i] = true;
      if (gr[(i + 2) % 4]) trim[(i + 1) % 4] = true;
    }
  }

  mapCtx.strokeStyle = MAP_INK;
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  let any = false;
  for (let i = 0; i < 4; i++) {
    const cur = P[i];
    const next = P[(i + 1) % 4];
    if (rounded[i]) {
      // The crescent arc always separates this tile's fill from grass
      const prev = P[(i + 3) % 4];
      mapCtx.moveTo(cur.x + (prev.x - cur.x) * CORNER_T, cur.y + (prev.y - cur.y) * CORNER_T);
      mapCtx.quadraticCurveTo(
        cur.x, cur.y,
        cur.x + (next.x - cur.x) * CORNER_T, cur.y + (next.y - cur.y) * CORNER_T
      );
      any = true;
    }
    const nx = tx + EDGE_NEIGHBOR[i][0];
    const ny = ty + EDGE_NEIGHBOR[i][1];
    const n = nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES ? -1 : tiles[ny][nx];
    if (n === t || (n !== -1 && n > t)) continue;
    // Straight edge, cut short where a rounded corner replaces it
    let x0 = cur.x, y0 = cur.y;
    let x1 = next.x, y1 = next.y;
    if (trim[i]) {
      x0 = cur.x + (next.x - cur.x) * CORNER_T;
      y0 = cur.y + (next.y - cur.y) * CORNER_T;
    }
    if (trim[(i + 1) % 4]) {
      x1 = next.x + (cur.x - next.x) * CORNER_T;
      y1 = next.y + (cur.y - next.y) * CORNER_T;
    }
    mapCtx.moveTo(x0, y0);
    mapCtx.lineTo(x1, y1);
    any = true;
  }
  if (any) mapCtx.stroke();
}

// Crop sprites for a seeded tile; the caller must have clipped to the
// tile's field outline so plants never poke into the surrounding grass
function drawCropsOn(tx, ty, kc) {
  const alongX = dirs[ty][tx] === 1;
  const stage = cropStage(growth[ty][tx]);
  for (const s of [0.25, 0.5, 0.75]) {
    for (const t of [0.15, 0.38, 0.62, 0.85]) {
      const p = alongX
        ? mp((tx + t) * TILE, (ty + s) * TILE)
        : mp((tx + s) * TILE, (ty + t) * TILE);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (stage === 0) {
        mapCtx.fillStyle = shade("#6b5228", kc); // seed spot
        mapCtx.fillRect(x, y, 1, 1);
      } else if (stage === 1) {
        mapCtx.fillStyle = shade("#8ee06a", kc); // sprout
        mapCtx.fillRect(x, y - 2, 1, 2);
      } else if (stage === 2) {
        mapCtx.fillStyle = shade("#5cbf47", kc); // young plant
        mapCtx.fillRect(x, y - 3, 1, 3);
      } else {
        mapCtx.fillStyle = shade("#c2a044", kc); // mature stalk
        mapCtx.fillRect(x, y - 3, 1, 3);
        mapCtx.fillStyle = shade("#f5d96b", kc); // grain head
        mapCtx.fillRect(x, y - 5, 1, 2);
      }
    }
  }
}

// Repaint one tile, then re-dither just that neighborhood of the map canvas
function drawTile(tx, ty) {
  paintTile(tx, ty);
  minimapTile(tx, ty);

  // Crop sprites lean a few pixels above their ground point, so at build
  // time the back-to-front order lets them paint over the tile behind.
  // Repainting this tile just erased any such overhang from the tiles in
  // front of it: redraw their crops.
  for (const [nx, ny] of [[tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]]) {
    if (nx >= MAP_TILES || ny >= MAP_TILES || tiles[ny][nx] !== 3) continue;
    const g = tileGeometry(nx, ny, isField);
    mapCtx.save();
    mapCtx.clip(fieldPath(g.P, g.rounded));
    drawCropsOn(nx, ny, groundShade((nx + 0.5) * TILE, (ny + 0.5) * TILE));
    mapCtx.restore();
  }

  // Terrain boundary lines: this repaint painted over the ones crossing the
  // tile, and its edge antialiasing nicked the neighbors' — redraw the whole
  // neighborhood's lines (they are deterministic, so overdraw is a no-op)
  for (let ny = Math.max(0, ty - 1); ny <= Math.min(MAP_TILES - 1, ty + 1); ny++)
    for (let nx = Math.max(0, tx - 1); nx <= Math.min(MAP_TILES - 1, tx + 1); nx++)
      tileInk(nx, ny);

  // The repaint region: the 3x3 block whose boundary lines were redrawn
  // (which covers the front neighbors' crops too), with a margin for road
  // stamps that stick out, plus the yard when it gets redrawn below. The
  // road restore clips to this rect and the final re-dither covers it.
  // 2.6: far enough that any road stamp the 5x5 gather can repaint under
  // the yard's rim also triggers the yard that covers it back up
  const nearYard =
    Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) <
    FARM_RADIUS * 2.6;
  const fc = mp(FARM.x, FARM.y);
  const c = [
    mp((tx - 1) * TILE, (ty - 1) * TILE),
    mp((tx + 2) * TILE, (ty - 1) * TILE),
    mp((tx + 2) * TILE, (ty + 2) * TILE),
    mp((tx - 1) * TILE, (ty + 2) * TILE),
  ];
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  let x0 = Math.min(...xs) - 8;
  let y0 = Math.min(...ys) - 10; // crops draw a few pixels above the ground
  let x1 = Math.max(...xs) + 8;
  let y1 = Math.max(...ys) + 8;
  if (nearYard) {
    x0 = Math.min(x0, fc.x - FARM_RADIUS * 1.8 * YARD_MAX_SCALE - 2);
    x1 = Math.max(x1, fc.x + FARM_RADIUS * 1.8 * YARD_MAX_SCALE + 2);
    y0 = Math.min(y0, fc.y - FARM_RADIUS * 0.9 * YARD_MAX_SCALE - 2);
    y1 = Math.max(y1, fc.y + FARM_RADIUS * 0.9 * YARD_MAX_SCALE + 2);
  }
  // Same idea, for the trampled-pasture mud dabs inside/around a paddock
  // fence (see paddockDabs, stamped once well after makeMap() — a
  // paddock's exact position isn't known until then, so like the yard
  // this can't live in paintTile's tile-type switch)
  const nearPaddock = nearAnyPaddock(tx, ty);
  if (nearPaddock) {
    for (const species of Object.keys(PADDOCKS_WORLD)) {
      const p = PADDOCKS_WORLD[species];
      for (const pc of [mp(p.x0, p.y0), mp(p.x1, p.y0), mp(p.x1, p.y1), mp(p.x0, p.y1)]) {
        x0 = Math.min(x0, pc.x - 4);
        x1 = Math.max(x1, pc.x + 4);
        y0 = Math.min(y0, pc.y - 4);
        y1 = Math.max(y1, pc.y + 4);
      }
    }
  }

  // Restore road and ditch surfaces: they live on top of the tiles and
  // their boundary lines. Both passes are clipped so an ink ellipse can
  // never land on road surface that no gathered fill covers (which would
  // cap a continuing road): the clip is the repainted block itself, world-
  // aligned exactly like the stamp gather, and the 5x5 gather guarantees
  // every stamp whose fill overlaps it is present. The dither bbox would
  // NOT work as the clip — a screen rect pokes tiles beyond the gather at
  // its corners. Stamps are shared objects across tile lists, so a Set
  // dedupes them.
  const stamps = new Set();
  for (let ny = Math.max(0, ty - 2); ny <= Math.min(MAP_TILES - 1, ty + 2); ny++)
    for (let nx = Math.max(0, tx - 2); nx <= Math.min(MAP_TILES - 1, tx + 2); nx++) {
      const list = roadStamps.get(ny * MAP_TILES + nx);
      if (list) for (const s of list) stamps.add(s);
    }
  if (stamps.size) {
    // The dither pass must cover every repainted pixel: grow the region to
    // the gathered stamps' full extent, since the fills are not clipped
    for (const s of stamps) {
      const p = mp(s.x, s.y);
      x0 = Math.min(x0, p.x - s.r * 1.5 - 2);
      x1 = Math.max(x1, p.x + s.r * 1.5 + 2);
      y0 = Math.min(y0, p.y - s.r * 0.75 - 2);
      y1 = Math.max(y1, p.y + s.r * 0.75 + 2);
    }
    mapCtx.save();
    clipMapDiamond();
    // Ink goes down only inside the repainted block (world-aligned like the
    // stamp gather, pushed out a few pixels for the terrain lines' edge
    // antialiasing): every ink pixel in there is re-covered by a fill or is
    // genuine rim, so a continuing road can't get capped
    mapCtx.save();
    mapCtx.beginPath();
    mapCtx.moveTo(c[0].x, c[0].y - 6);
    mapCtx.lineTo(c[1].x + 8, c[1].y);
    mapCtx.lineTo(c[2].x, c[2].y + 6);
    mapCtx.lineTo(c[3].x - 8, c[3].y);
    mapCtx.closePath();
    mapCtx.clip();
    mapCtx.fillStyle = ROAD_INK;
    for (const s of stamps) {
      const p = mp(s.x, s.y);
      mapCtx.beginPath();
      mapCtx.ellipse(p.x, p.y, s.r * 1.5 + 1, s.r * 0.75 + 1, 0, 0, Math.PI * 2);
      mapCtx.fill();
    }
    mapCtx.restore();
    // The fills are NOT clipped to the block — a clipped fill ends in an
    // antialiased cut that reads as a straight seam across the road. Full
    // ellipses repaint to exactly their build-time pixels instead. They go
    // down in build order — ditch water first, road surface on top — so
    // culverts keep reading as the road crossing over the ditch.
    for (const ditchPass of [true, false])
      for (const s of stamps) {
        if ((s.color === DITCH_COLOR) !== ditchPass) continue;
        const p = mp(s.x, s.y);
        mapCtx.fillStyle = shade(s.color, groundShade(s.x, s.y));
        mapCtx.beginPath();
        mapCtx.ellipse(p.x, p.y, s.r * 1.5, s.r * 0.75, 0, 0, Math.PI * 2);
        mapCtx.fill();
      }
    mapCtx.restore();
  }

  // Restore the farmyard's trodden dirt if this tile is anywhere near it.
  // The whole yard is repainted unclipped — its pixels are deterministic, so
  // overpainting neighbors is a no-op, and clipping to the tile would leave
  // antialiasing seams across the yard.
  if (nearYard) {
    mapCtx.fillStyle = shade(YARD_DIRT, 1);
    farmYardPath(fc);
    mapCtx.fill();
    mapCtx.strokeStyle = MAP_INK;
    mapCtx.lineWidth = 1;
    mapCtx.stroke();
    mapCtx.fillStyle = shade(YARD_DIRT_DARK, 1);
    for (const p of yardPixels) mapCtx.fillRect(p.x, p.y, 1, 1);
  }

  // Restore the paddock ground — flat green fill, then the worn-dirt
  // dabs on top — for whichever paddock(s) this tile is near. Same
  // "whole thing repaints unclipped, overdraw is a no-op" deal as the
  // yard just above.
  if (nearPaddock) {
    paintPaddockFills();
    for (const d of paddockDabs) {
      mapCtx.fillStyle = shade(d.color, 1);
      mapCtx.fillRect(d.x, d.y, 1, 1);
    }
  }

  // Re-dither everything that was repainted
  ditherRegion(mapCtx, x0, y0, x1 - x0, y1 - y0);

  // The ground repaint erased any wheel marks on this tile: stamp them back.
  // A yard repaint just blanked every tile under the whole (unclipped) blob,
  // not only this one, so every tile the yard's world-circle overlaps also
  // needs its marks replayed — restamping only (tx, ty) would drop tracks
  // the tractor left elsewhere in the yard the moment any nearby tile
  // repaints. (tx, ty) itself is restamped separately since the "wake"
  // radius that triggers a yard repaint reaches slightly further out than
  // the yard's own tile footprint.
  if (nearYard) {
    const yardTileR = Math.ceil((YARD_RADIUS * YARD_MAX_SCALE) / TILE) + 1;
    const fcx = Math.floor(FARM.x / TILE);
    const fcy = Math.floor(FARM.y / TILE);
    for (let ny = Math.max(0, fcy - yardTileR); ny <= Math.min(MAP_TILES - 1, fcy + yardTileR); ny++)
      for (let nx = Math.max(0, fcx - yardTileR); nx <= Math.min(MAP_TILES - 1, fcx + yardTileR); nx++) {
        if (nx === tx && ny === ty) continue;
        restampTracks(nx, ny);
      }
  }
  restampTracks(tx, ty);
}

// Per-tile deterministic randomness for tile details (speckles, flowers,
// ripples): a tile repaint must reproduce the exact same pixels, otherwise
// the constant background repaints (seasons, field work) twinkle
function tileRand(tx, ty) {
  let s = (SEED ^ Math.imul(tx + 1, 374761393) ^ Math.imul(ty + 1, 668265263)) | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintTile(tx, ty) {
  const type = tiles[ty][tx];
  const kc = groundShade((tx + 0.5) * TILE, (ty + 0.5) * TILE);
  const tr = tileRand(tx, ty);

  // Ground in sub-quads, each shaded from its own terrain normal, so slope
  // shading varies inside a tile instead of stepping at tile borders. Each
  // quad overdraws its outline in its own color: antialiasing otherwise
  // leaves hairline seams that read as a grid over the terrain.
  const SUB = 3;
  const subQuads = (color) => {
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        const x0 = (tx + sx / SUB) * TILE;
        const y0 = (ty + sy / SUB) * TILE;
        const x1 = (tx + (sx + 1) / SUB) * TILE;
        const y1 = (ty + (sy + 1) / SUB) * TILE;
        const a = mp(x0, y0);
        const b = mp(x1, y0);
        const c = mp(x1, y1);
        const d = mp(x0, y1);
        mapCtx.fillStyle = shade(color, groundShade((x0 + x1) / 2, (y0 + y1) / 2));
        mapCtx.beginPath();
        mapCtx.moveTo(a.x, a.y);
        mapCtx.lineTo(b.x, b.y);
        mapCtx.lineTo(c.x, c.y);
        mapCtx.lineTo(d.x, d.y);
        mapCtx.closePath();
        mapCtx.fill();
        mapCtx.strokeStyle = mapCtx.fillStyle;
        mapCtx.lineWidth = 1;
        mapCtx.stroke();
      }
    }
  };

  if (type === 0) {
    const meadow = meadowTiles.has(ty * MAP_TILES + tx);
    subQuads(meadow ? MEADOW : GRASS);

    // Speckles: grass tufts (meadow tufts run warmer and thicker)
    const dots = meadow ? MEADOW_DOTS : GRASS_DOTS;
    for (let i = 0; i < (meadow ? 11 : 8); i++) {
      const p = mp((tx + tr()) * TILE, (ty + tr()) * TILE);
      mapCtx.fillStyle = shade(dots[(tr() * dots.length) | 0], kc);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    // Little flowers: four petals around a yellow heart; forests keep
    // their floor bare, and meadows bloom with two or three where plain
    // grass gets at most one
    if (!forestTiles.has(ty * MAP_TILES + tx)) {
      const spots = meadow ? 1 + ((tr() * 3) | 0) : tr() < 0.5 ? 1 : 0;
      for (let f = 0; f < spots; f++) {
        const p = mp(
          (tx + 0.2 + tr() * 0.6) * TILE,
          (ty + 0.2 + tr() * 0.6) * TILE
        );
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        mapCtx.fillStyle = shade(FLOWER_COLORS[(tr() * FLOWER_COLORS.length) | 0], kc);
        mapCtx.fillRect(x - 1, y, 1, 1);
        mapCtx.fillRect(x + 1, y, 1, 1);
        mapCtx.fillRect(x, y - 1, 1, 1);
        mapCtx.fillRect(x, y + 1, 1, 1);
        mapCtx.fillStyle = shade("#ffd94f", kc);
        mapCtx.fillRect(x, y, 1, 1);
      }
    }

    // Round every corner this grass tile turns against water: same crescent
    // trick the water/field patches use to round their own outer corners,
    // mirrored here so grass's corners get cut back too — otherwise only
    // the water side ever rounded and the shore read as sharp wherever land
    // poked the other way (which, along a jagged coast, is most corners)
    {
      const { P, rounded } = tileGeometry(tx, ty, (ax, ay) => !isWater(ax, ay));
      for (let i = 0; i < 4; i++) {
        if (!rounded[i]) continue;
        const cur = P[i];
        const prev = P[(i + 3) % 4];
        const next = P[(i + 1) % 4];
        const ax = cur.x + (prev.x - cur.x) * CORNER_T;
        const ay = cur.y + (prev.y - cur.y) * CORNER_T;
        const bx = cur.x + (next.x - cur.x) * CORNER_T;
        const by = cur.y + (next.y - cur.y) * CORNER_T;
        mapCtx.fillStyle = shade(WATER_COLOR, 1); // matches the water fill
        mapCtx.beginPath();
        mapCtx.moveTo(ax, ay);
        mapCtx.quadraticCurveTo(cur.x, cur.y, bx, by);
        mapCtx.lineTo(cur.x, cur.y);
        mapCtx.closePath();
        mapCtx.fill();
        mapCtx.strokeStyle = mapCtx.fillStyle;
        mapCtx.lineWidth = 1;
        mapCtx.stroke();
      }
    }
    return;
  }

  if (type === 4) {
    // Water: a level fill across the whole tile, self-stroked so borders
    // between water tiles stay seam-free, with grass crescents rounding the
    // shore corners and pale ripple flecks on top
    const w0 = mp(tx * TILE, ty * TILE);
    const w1 = mp((tx + 1) * TILE, ty * TILE);
    const w2 = mp((tx + 1) * TILE, (ty + 1) * TILE);
    const w3 = mp(tx * TILE, (ty + 1) * TILE);
    mapCtx.fillStyle = shade(WATER_COLOR, 1);
    mapCtx.beginPath();
    mapCtx.moveTo(w0.x, w0.y);
    mapCtx.lineTo(w1.x, w1.y);
    mapCtx.lineTo(w2.x, w2.y);
    mapCtx.lineTo(w3.x, w3.y);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.strokeStyle = mapCtx.fillStyle;
    mapCtx.lineWidth = 1;
    mapCtx.stroke();

    mapCtx.fillStyle = shade(WATER_RIPPLE, 1); // ripples
    for (let i = 0; i < 5; i++) {
      const p = mp((tx + 0.15 + tr() * 0.7) * TILE, (ty + 0.15 + tr() * 0.7) * TILE);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 2, 1);
    }

    const { P, rounded } = tileGeometry(tx, ty, isWater);
    const cornerTile = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]];
    for (let i = 0; i < 4; i++) {
      if (!rounded[i]) continue;
      const cur = P[i];
      const prev = P[(i + 3) % 4];
      const next = P[(i + 1) % 4];
      const ax = cur.x + (prev.x - cur.x) * CORNER_T;
      const ay = cur.y + (prev.y - cur.y) * CORNER_T;
      const bx = cur.x + (next.x - cur.x) * CORNER_T;
      const by = cur.y + (next.y - cur.y) * CORNER_T;
      mapCtx.fillStyle = shade(
        GRASS,
        groundShade(cornerTile[i][0] * TILE, cornerTile[i][1] * TILE)
      );
      mapCtx.beginPath();
      mapCtx.moveTo(ax, ay);
      mapCtx.quadraticCurveTo(cur.x, cur.y, bx, by);
      mapCtx.lineTo(cur.x, cur.y);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.strokeStyle = mapCtx.fillStyle;
      mapCtx.lineWidth = 1;
      mapCtx.stroke();
    }
    return;
  }

  // Field tile: dirt across the whole tile, seamless against neighboring
  // dirt tiles thanks to the sub-quads' own outline overdraw. Unplowed
  // (type 1) is dried stubble, not turned soil, so it reads in a distinct
  // pale straw tone rather than the same brown as plowed/seeded ground.
  subQuads(type === 1 ? STUBBLE : DIRT);

  // Round the patch's outer corners by painting the cut crescents back to
  // grass; their outer edges only ever border grass tiles, so the overdraw
  // never bleeds onto dirt
  const { P, rounded } = tileGeometry(tx, ty, isField);
  const cornerTile = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]];
  for (let i = 0; i < 4; i++) {
    if (!rounded[i]) continue;
    const cur = P[i];
    const prev = P[(i + 3) % 4];
    const next = P[(i + 1) % 4];
    const ax = cur.x + (prev.x - cur.x) * CORNER_T;
    const ay = cur.y + (prev.y - cur.y) * CORNER_T;
    const bx = cur.x + (next.x - cur.x) * CORNER_T;
    const by = cur.y + (next.y - cur.y) * CORNER_T;
    mapCtx.fillStyle = shade(
      GRASS,
      groundShade(cornerTile[i][0] * TILE, cornerTile[i][1] * TILE)
    );
    mapCtx.beginPath();
    mapCtx.moveTo(ax, ay);
    mapCtx.quadraticCurveTo(cur.x, cur.y, bx, by);
    mapCtx.lineTo(cur.x, cur.y);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.strokeStyle = mapCtx.fillStyle;
    mapCtx.lineWidth = 1;
    mapCtx.stroke();
  }

  // Furrows, crops and clods stay inside the rounded outline
  mapCtx.save();
  mapCtx.clip(fieldPath(P, rounded));

  if (type >= 2) {
    // Furrow lines parallel to the direction the tile was plowed in
    const alongX = dirs[ty][tx] === 1;
    mapCtx.strokeStyle = shade(tint(DIRT, -0.22), kc);
    mapCtx.lineWidth = 1;
    for (const s of [0.25, 0.5, 0.75]) {
      const a = alongX
        ? mp(tx * TILE, (ty + s) * TILE)
        : mp((tx + s) * TILE, ty * TILE);
      const b = alongX
        ? mp((tx + 1) * TILE, (ty + s) * TILE)
        : mp((tx + s) * TILE, (ty + 1) * TILE);
      mapCtx.beginPath();
      mapCtx.moveTo(a.x, a.y);
      mapCtx.lineTo(b.x, b.y);
      mapCtx.stroke();
    }

    // Seeds / crops in rows along the furrows
    if (type === 3) drawCropsOn(tx, ty, kc);
  } else {
    // Speckles: dried stubble stalks
    for (let i = 0; i < 8; i++) {
      const p = mp((tx + tr()) * TILE, (ty + tr()) * TILE);
      mapCtx.fillStyle = shade(STUBBLE_DOTS[(tr() * STUBBLE_DOTS.length) | 0], kc);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
  }
  mapCtx.restore();
}

// --- Field work, one function per implement ---------------------------------

// Plow: turn unplowed field into furrows along the travel direction
function plowTileAt(wx, wy, alongX) {
  if (tileTypeAt(wx, wy) !== 1) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = 2;
  dirs[ty][tx] = alongX ? 1 : 0;
  drawTile(tx, ty);
}

// Seeder: plant a plowed tile, consuming one seed
function seedTileAt(wx, wy) {
  if (seeds <= 0 || tileTypeAt(wx, wy) !== 2) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = 3;
  growth[ty][tx] = 0;
  seeds--;
  drawTile(tx, ty);
}

// Harvester: cut a mature crop, leaving a grain sack and stubble behind
function harvestTileAt(wx, wy) {
  if (tileTypeAt(wx, wy) !== 3) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  if (cropStage(growth[ty][tx]) < 3) return;
  tiles[ty][tx] = 1;
  growth[ty][tx] = 0;
  drawTile(tx, ty);
  const cx = (tx + 0.5) * TILE;
  const cy = (ty + 0.5) * TILE;
  sacks.push({ wx: cx, wy: cy });
  spawnChaff(cx, cy);
}

// Advance crop growth on seeded tiles, repainting when a stage is reached
function updateCrops(dt) {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      if (tiles[ty][tx] !== 3) continue;
      const g = growth[ty][tx];
      growth[ty][tx] = g + dt;
      if (cropStage(g + dt) !== cropStage(g)) drawTile(tx, ty);
    }
  }
}

// Tally the field tiles by working state for the HUD's ledger tag. Sown
// splits into growing and ripe, since a mature crop is what the harvester
// hunts for. The 60×60 map is small enough to recount every frame.
function countFieldTiles() {
  const c = { stubble: 0, plowed: 0, sown: 0, ripe: 0 };
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const t = tiles[ty][tx];
      if (t === 1) c.stubble++;
      else if (t === 2) c.plowed++;
      else if (t === 3) {
        if (cropStage(growth[ty][tx]) >= 3) c.ripe++;
        else c.sown++;
      }
    }
  }
  return c;
}

// Roads are generated inside makeMap; the samples and covered tiles are kept
// so field patches, trees and bushes can stay off them, and the roads
// themselves (point sequences) so the delivery cart can drive the network.
// The field patch rectangles are kept for the hedgerows planted along their
// edges.
const roads = [];
const roadSamples = [];
const roadTiles = new Set();
const patches = [];
const forestTiles = new Set(); // tile indexes under forest stands
const meadowTiles = new Set(); // tile indexes under wildflower meadow patches
const tileKey = (wx, wy) => ((wy / TILE) | 0) * MAP_TILES + ((wx / TILE) | 0);
const ROAD_COLOR = PROFILE.palette.road;
const BRIDGE_COLOR = tint(ROAD_COLOR, -0.2); // road surface where it crosses water
const ROAD_SPECKLE = tint(ROAD_COLOR, -0.15); // wheel-worn speckles along the middle
// Stamps by tile index: roads and ditches are painted over the tiles, so
// whenever a tile repaints (field work, seasons) they must be restored
const roadStamps = new Map();

function addStamp(x, y, r, color) {
  // The margin past r covers the painted ellipse plus its one-pixel ink rim,
  // so every pixel a stamp can touch lies in a tile that knows the stamp
  const touched = new Set();
  for (const dx of [-r - 2, r + 2])
    for (const dy of [-r - 2, r + 2]) touched.add(tileKey(x + dx, y + dy));
  for (const k of touched) {
    if (!roadStamps.has(k)) roadStamps.set(k, []);
    roadStamps.get(k).push({ x, y, r, color });
  }
}
// Same for the farmyard's trodden dirt: its speckles are kept so the yard
// can be redrawn identically over a repainted tile
const yardPixels = [];

function makeMap() {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    tiles.push(new Array(MAP_TILES).fill(0));
    dirs.push(new Array(MAP_TILES).fill(0));
    growth.push(new Array(MAP_TILES).fill(0));
  }

  // Water first: seas flood low corners, lakes and ponds sit in hollows,
  // and rivers wander across following the low ground
  const lowEnough = (tx, ty, limit = 3.5) =>
    terrainHeight((tx + 0.5) * TILE, (ty + 0.5) * TILE) < limit;
  const awayFromFarm = (tx, ty) =>
    Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) >
    FARM_RADIUS + 48;
  const awayFromCity = (tx, ty) =>
    Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y) >
    CITY_RADIUS + 48;
  let waterTiles = 0;
  const setWater = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return;
    if (!awayFromFarm(tx, ty) || !awayFromCity(tx, ty)) return;
    if (tiles[ty][tx] === 4) return;
    tiles[ty][tx] = 4;
    waterTiles++;
  };
  // How watery this map is comes from its profile
  const waterTarget = MAP_TILES * MAP_TILES * rollBand(PROFILE.water);

  // Seas: each corner has a chance of flooding its low ground
  for (const [cx, cy] of [
    [0, 0],
    [MAP_TILES - 1, 0],
    [0, MAP_TILES - 1],
    [MAP_TILES - 1, MAP_TILES - 1],
  ]) {
    if (rand() < 0.5) continue;
    const reach = 7 + rand() * 6;
    for (let ty = 0; ty < MAP_TILES; ty++)
      for (let tx = 0; tx < MAP_TILES; tx++)
        if (Math.hypot(tx - cx, ty - cy) < reach * (0.75 + rand() * 0.5) && lowEnough(tx, ty))
          setWater(tx, ty);
  }

  // Lakes: irregular blobs in hollows. The first is a big one — several
  // overlapping blobs around a center — the rest are ordinary.
  for (let lakes = 0, tries = 0; lakes < 4 && tries < 400; tries++) {
    const big = lakes === 0;
    const cx = 6 + ((rand() * (MAP_TILES - 12)) | 0);
    const cy = 6 + ((rand() * (MAP_TILES - 12)) | 0);
    if (!lowEnough(cx, cy) || !awayFromFarm(cx, cy)) continue;
    for (let blob = 0; blob < (big ? 5 : 1); blob++) {
      const bx = cx + (big ? (rand() - 0.5) * 8 : 0);
      const by = cy + (big ? (rand() - 0.5) * 8 : 0);
      const r = (big ? 3.5 : 2) + rand() * 2.5;
      for (let ty = Math.floor(by - r - 1); ty <= by + r + 1; ty++)
        for (let tx = Math.floor(bx - r - 1); tx <= bx + r + 1; tx++)
          if (Math.hypot(tx - bx, ty - by) < r * (0.7 + rand() * 0.6) && lowEnough(tx, ty))
            setWater(tx, ty);
    }
    lakes++;
  }

  // Ponds: little one-or-two tile dots
  for (let ponds = 0, tries = 0; ponds < 5 && tries < 200; tries++) {
    const tx = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    const ty = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    if (!lowEnough(tx, ty) || !awayFromFarm(tx, ty) || tiles[ty][tx] === 4) continue;
    setWater(tx, ty);
    if (rand() < 0.5) setWater(tx + 1, ty);
    ponds++;
  }

  // Rivers: continuous channels that enter at one edge and flow across,
  // steering toward low ground with a capped turn rate. The channel is a
  // smooth world-space curve — free to run diagonally — and every tile it
  // touches becomes water, so the course stays connected the whole way.
  for (let i = 0; i < 2; i++) {
    let x, y, dir0;
    if (rand() < 0.5) {
      x = MAP_SIZE * (0.15 + rand() * 0.7);
      y = 2;
      dir0 = Math.PI / 2; // enters the top edge, flows south
    } else {
      x = 2;
      y = MAP_SIZE * (0.15 + rand() * 0.7);
      dir0 = 0; // enters the left edge, flows east
    }
    let dir = dir0;
    const halfW = 9 + rand() * 5;
    for (let step = 0; step < 400; step++) {
      // Flood the channel's width around this point
      for (let oy = -halfW; oy <= halfW; oy += 8)
        for (let ox = -halfW; ox <= halfW; ox += 8)
          if (Math.hypot(ox, oy) <= halfW)
            setWater(((x + ox) / TILE) | 0, ((y + oy) / TILE) | 0);
      // Steer toward the lowest ground ahead, but never double back
      let bestDir = dir;
      let bestScore = Infinity;
      for (const dd of [-0.3, 0, 0.3]) {
        const nd = dir + dd;
        const score = terrainHeight(x + Math.cos(nd) * 24, y + Math.sin(nd) * 24) + rand() * 2;
        if (score < bestScore) {
          bestScore = score;
          bestDir = nd;
        }
      }
      dir += clamp(bestDir - dir, -0.12, 0.12);
      const dev = Math.atan2(Math.sin(dir - dir0), Math.cos(dir - dir0));
      if (dev > 0.9) dir = dir0 + 0.9;
      else if (dev < -0.9) dir = dir0 - 0.9;
      x += Math.cos(dir) * 6;
      y += Math.sin(dir) * 6;
      if (x < -8 || x > MAP_SIZE + 8 || y < -8 || y > MAP_SIZE + 8) break;
    }
  }

  // More lakes until this map's water share is reached; late attempts
  // accept ever higher ground so even waterlogged targets fill up
  for (let tries = 0; waterTiles < waterTarget && tries < 600; tries++) {
    const limit = 3.5 + (tries / 600) * 14;
    const cx = 3 + ((rand() * (MAP_TILES - 6)) | 0);
    const cy = 3 + ((rand() * (MAP_TILES - 6)) | 0);
    if (!lowEnough(cx, cy, limit) || !awayFromFarm(cx, cy)) continue;
    const r = 2.5 + rand() * 3.5;
    for (let ty = Math.floor(cy - r - 1); ty <= cy + r + 1; ty++)
      for (let tx = Math.floor(cx - r - 1); tx <= cx + r + 1; tx++)
        if (Math.hypot(tx - cx, ty - cy) < r * (0.7 + rand() * 0.6) && lowEnough(tx, ty, limit))
          setWater(tx, ty);
  }

  // Field patches next: the road network is routed to them afterwards.
  // How much of the dry land is farmed comes from this map's profile; the
  // farm clearing and road carving eat a little of it back.
  const targetFieldTiles = (MAP_TILES * MAP_TILES - waterTiles) * rollBand(PROFILE.field);
  let fieldTiles = 0;
  for (let i = 0; i < 400 && fieldTiles < targetFieldTiles; i++) {
    const px = 1 + ((rand() * (MAP_TILES - 13)) | 0);
    const py = 1 + ((rand() * (MAP_TILES - 13)) | 0);
    const pw = 5 + ((rand() * 7) | 0);
    const ph = 5 + ((rand() * 7) | 0);
    let wet = false;
    for (let ty = py; ty < py + ph && !wet; ty++)
      for (let tx = px; tx < px + pw && !wet; tx++)
        if (tiles[ty][tx] === 4) wet = true;
    if (wet) continue; // fields keep out of the water
    patches.push({ px, py, pw, ph });
    for (let ty = py; ty < py + ph; ty++)
      for (let tx = px; tx < px + pw; tx++)
        if (tiles[ty][tx] === 0) {
          tiles[ty][tx] = 1;
          fieldTiles++;
        }
  }

  // Water-filled drainage ditches along some field edges; roads painted
  // over them later read as culverts. Registered as stamps so tile
  // repaints restore them.
  const ditchSamples = [];
  for (const p of patches) {
    const x0 = p.px * TILE;
    const x1 = (p.px + p.pw) * TILE;
    const y0 = p.py * TILE;
    const y1 = (p.py + p.ph) * TILE;
    const off = 4.5;
    for (const [sx, sy, ex, ey] of [
      [x0, y0 - off, x1, y0 - off],
      [x0, y1 + off, x1, y1 + off],
      [x0 - off, y0, x0 - off, y1],
      [x1 + off, y0, x1 + off, y1],
    ]) {
      if (rand() > 0.4) continue;
      const len = Math.hypot(ex - sx, ey - sy);
      for (let s = 0; s <= len; s += 1.6) {
        const wx = sx + ((ex - sx) * s) / len;
        const wy = sy + ((ey - sy) * s) / len;
        if (tileTypeAt(wx, wy) !== 0) continue; // never across fields or water
        if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS * 1.9) continue;
        ditchSamples.push({ x: wx, y: wy });
        addStamp(wx, wy, 1.1, DITCH_COLOR);
      }
    }
  }

  // Road network: main roads from the farm out to the map edges, then a spur
  // from the nearest existing road to each field. Each road is a fractal
  // midpoint-displacement curve from its start to its end: the straight line
  // is bent at its midpoint by a random sideways nudge, then both halves are
  // bent again with a smaller nudge, recursively — the same self-similar
  // construction used for generating natural coastlines and rivers — so
  // roads wander like real ones instead of running dead straight.
  const net = [{ x: FARM.x, y: FARM.y }];

  const traceRoad = (from, tx, ty, r) => {
    const dist = Math.hypot(tx - from.x, ty - from.y);
    if (dist < 1) return;
    // Thicker roads are the trunk network and stay closer to direct; thin
    // spurs are country tracks that can wander more.
    let rough = r >= 3 ? 0.16 : 0.32;
    const PERSISTENCE = 0.6;
    const MIN_SEG = 10; // stop bending once a segment is this short
    let poly = [{ x: from.x, y: from.y }, { x: tx, y: ty }];
    for (let pass = 0; pass < 8; pass++) {
      let bent = false;
      const next = [poly[0]];
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLen > MIN_SEG) {
          bent = true;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const px = -(b.y - a.y) / segLen;
          const py = (b.x - a.x) / segLen;
          const offset = (rand() - 0.5) * 2 * rough * segLen;
          next.push({ x: mx + px * offset, y: my + py * offset });
        }
        next.push(b);
      }
      poly = next;
      rough *= PERSISTENCE;
      if (!bent) break;
    }
    // Resample the bent polyline at an even 3-unit arc-length spacing, so
    // stamping, the cart's drive loop and vegetation clearance all still see
    // a steady stream of points regardless of how much the curve wanders.
    const pts = [];
    let cum = 0;
    let nextSample = 3;
    let lastDir = 0;
    let clipped = false;
    outer: for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-6) continue;
      lastDir = Math.atan2(b.y - a.y, b.x - a.x);
      while (nextSample <= cum + segLen) {
        const t = (nextSample - cum) / segLen;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        // Roads may run a little past the map edge; painting clips them there
        if (x < -24 || x > MAP_SIZE + 24 || y < -24 || y > MAP_SIZE + 24) {
          clipped = true;
          break outer;
        }
        pts.push({ x, y, dir: lastDir });
        nextSample += 3;
      }
      cum += segLen;
    }
    // The 3-unit sampling grid rarely lands exactly on the target, so tack
    // the true endpoint on (unless the road was clipped short at the map
    // edge) — junctions and field spurs still meet precisely.
    if (!clipped && pts.length && Math.hypot(tx - pts[pts.length - 1].x, ty - pts[pts.length - 1].y) > 1.5) {
      pts.push({ x: tx, y: ty, dir: lastDir });
    }
    if (pts.length) {
      roads.push({ pts, r });
      net.push(...pts);
    }
  };

  const nearestRoadPoint = (x, y) => {
    let best = net[0];
    let bd = Infinity;
    for (const s of net) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  // Main roads out of the farm, exiting past the map edges
  for (const [tx, ty] of [
    [MAP_SIZE * 0.3, -16],
    [MAP_SIZE + 16, MAP_SIZE * 0.3],
    [-16, MAP_SIZE * 0.25],
  ]) {
    traceRoad(net[0], tx, ty, 3.0);
  }

  // Trunk road to the city, so the grain run has a real route to follow
  traceRoad(nearestRoadPoint(CITY.x, CITY.y), CITY.x, CITY.y, 3.0);

  // Field spurs, nearest fields first so far ones can chain off their roads.
  // Each spur aims for a point just outside its field's edge.
  const patchCenter = (p) => ({
    x: (p.px + p.pw / 2) * TILE,
    y: (p.py + p.ph / 2) * TILE,
  });
  patches.sort((a, b) => {
    const ca = patchCenter(a);
    const cb = patchCenter(b);
    return (
      Math.hypot(ca.x - FARM.x, ca.y - FARM.y) -
      Math.hypot(cb.x - FARM.x, cb.y - FARM.y)
    );
  });
  for (const p of patches) {
    const c = patchCenter(p);
    const from = nearestRoadPoint(c.x, c.y);
    // Nearest point on the patch rectangle grown by a road's berth
    const ax = clamp(from.x, p.px * TILE - 14, (p.px + p.pw) * TILE + 14);
    const ay = clamp(from.y, p.py * TILE - 14, (p.py + p.ph) * TILE + 14);
    if (Math.hypot(ax - from.x, ay - from.y) >= 10) traceRoad(from, ax, ay, 2.0);

    // Short straight entry path from the road up to the field's edge
    const gate = nearestRoadPoint(c.x, c.y);
    const bx = clamp(gate.x, p.px * TILE, (p.px + p.pw) * TILE);
    const by = clamp(gate.y, p.py * TILE, (p.py + p.ph) * TILE);
    const len = Math.hypot(bx - gate.x, by - gate.y);
    if (len > 2 && len < 45) {
      const dir = Math.atan2(by - gate.y, bx - gate.x);
      const pts = [];
      for (let s = 3; s < len; s += 3)
        pts.push({ x: gate.x + Math.cos(dir) * s, y: gate.y + Math.sin(dir) * s, dir });
      pts.push({ x: bx, y: by, dir });
      roads.push({ pts, r: 1.6, entry: true });
    }
  }

  // Roads arriving from outside the map: they enter at the edge and merge
  // into the nearest road, forming a junction
  for (const [ex, ey] of [
    [MAP_SIZE * 0.7, -16],
    [-16, MAP_SIZE * 0.6],
    [MAP_SIZE + 16, MAP_SIZE * 0.7],
  ]) {
    const join = nearestRoadPoint(ex, ey);
    traceRoad({ x: ex, y: ey }, join.x, join.y, 3.0);
  }

  // Link roads between distant parts of the network: junctions and loops
  for (let i = 0; i < 4; i++) {
    const a = net[(rand() * net.length) | 0];
    let b = null;
    for (let tries = 0; tries < 30 && !b; tries++) {
      const cand = net[(rand() * net.length) | 0];
      const d = Math.hypot(cand.x - a.x, cand.y - a.y);
      if (d > 90 && d < 260) b = cand;
    }
    if (b) traceRoad(a, b.x, b.y, 2.4);
  }

  // Register road coverage (for vegetation and the minimap) and carve the
  // roads through any field they cross
  for (const road of roads) {
    for (const p of road.pts) {
      roadSamples.push(p);
      for (const dx of [-5, 0, 5])
        for (const dy of [-5, 0, 5]) roadTiles.add(tileKey(p.x + dx, p.y + dy));
      // Remember the stamp on every tile its ellipse touches; over water the
      // surface is bridge planks instead of packed dirt
      addStamp(
        p.x,
        p.y,
        road.r,
        tileTypeAt(p.x, p.y) === 4 ? BRIDGE_COLOR : ROAD_COLOR
      );
      if (road.entry) continue; // entry paths touch the field edge on purpose
      for (const dx of [-4, 0, 4]) {
        for (const dy of [-4, 0, 4]) {
          const tx = ((p.x + dx) / TILE) | 0;
          const ty = ((p.y + dy) / TILE) | 0;
          if (tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES && tiles[ty][tx] === 1)
            tiles[ty][tx] = 0;
        }
      }
    }
  }

  // Keep the farmyard and the city clear of fields
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const df = Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y);
      const dc = Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y);
      if ((df < FARM_PASTURE_RADIUS || dc < CITY_RADIUS + 24) && tiles[ty][tx] !== 4)
        tiles[ty][tx] = 0;
    }
  }

  // Forest stands: how much of the leftover, unfarmed land is forested (as
  // opposed to open free grass) comes from this map's profile — a share of
  // what's left after water and field, so 0 means none of it wooded and 1
  // means all of it. Blobs grow on free grass; only the tiles are marked
  // here (darker floor and minimap color) — the trees themselves are
  // planted after the map exists.
  const openLand = MAP_TILES * MAP_TILES - waterTiles - fieldTiles;
  const forestTarget = openLand * rollBand(PROFILE.forest);
  for (let tries = 0; forestTiles.size < forestTarget && tries < 600; tries++) {
    const cx = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    const cy = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    if (tiles[cy][cx] !== 0) continue;
    if (Math.hypot((cx + 0.5) * TILE - FARM.x, (cy + 0.5) * TILE - FARM.y) < FARM_PASTURE_RADIUS)
      continue;
    if (Math.hypot((cx + 0.5) * TILE - CITY.x, (cy + 0.5) * TILE - CITY.y) < CITY_RADIUS + 40)
      continue;
    const r = 2.5 + rand() * 4;
    for (let ty = Math.max(0, Math.floor(cy - r)); ty <= Math.min(MAP_TILES - 1, Math.ceil(cy + r)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - r)); tx <= Math.min(MAP_TILES - 1, Math.ceil(cx + r)); tx++)
        if (
          tiles[ty][tx] === 0 &&
          Math.hypot(tx - cx, ty - cy) < r * (0.7 + rand() * 0.6) &&
          Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) > FARM_PASTURE_RADIUS &&
          Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y) > CITY_RADIUS + 40
        )
          forestTiles.add(ty * MAP_TILES + tx);
  }

  // Meadow patches: grown the same way as forest stands, but over whatever
  // free grass forest left behind — bright open wildflower ground instead
  // of tree cover. Share is of that remaining free land, from the profile.
  const meadowTarget = (openLand - forestTiles.size) * rollBand(PROFILE.meadow);
  for (let tries = 0; meadowTiles.size < meadowTarget && tries < 600; tries++) {
    const cx = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    const cy = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    if (tiles[cy][cx] !== 0 || forestTiles.has(cy * MAP_TILES + cx)) continue;
    if (Math.hypot((cx + 0.5) * TILE - FARM.x, (cy + 0.5) * TILE - FARM.y) < FARM_PASTURE_RADIUS)
      continue;
    if (Math.hypot((cx + 0.5) * TILE - CITY.x, (cy + 0.5) * TILE - CITY.y) < CITY_RADIUS + 40)
      continue;
    const r = 2.5 + rand() * 4;
    for (let ty = Math.max(0, Math.floor(cy - r)); ty <= Math.min(MAP_TILES - 1, Math.ceil(cy + r)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - r)); tx <= Math.min(MAP_TILES - 1, Math.ceil(cx + r)); tx++)
        if (
          tiles[ty][tx] === 0 &&
          !forestTiles.has(ty * MAP_TILES + tx) &&
          Math.hypot(tx - cx, ty - cy) < r * (0.7 + rand() * 0.6) &&
          Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) > FARM_PASTURE_RADIUS &&
          Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y) > CITY_RADIUS + 40
        )
          meadowTiles.add(ty * MAP_TILES + tx);
  }

  // Back-to-front so nearer hills paint over the ones behind them. paintTile
  // skips the per-tile dithering: the whole canvas gets one pass at the end.
  for (let s = 0; s <= 2 * (MAP_TILES - 1); s++) {
    for (let ty = Math.max(0, s - MAP_TILES + 1); ty <= Math.min(MAP_TILES - 1, s); ty++) {
      paintTile(s - ty, ty);
    }
  }

  // Cliffs along the two near (bottom) edges of the map diamond. Their top
  // follows the real terrain height along the boundary — where a hill runs
  // up to the edge, the wall shows a slice through it — but the bottom rim
  // stays a flat, level line (height 0) dropped by EDGE_DEPTH, so the wall
  // reads as a slab of consistent thickness rather than undulating itself.
  // Every segment fills dirt-colored first; where a lake or river touches
  // the boundary, a water band sits on top of that, shallowest (0 deep)
  // right where the water meets the shore and ramping down to
  // WATER_EDGE_DEPTH a couple of tiles into open water — so it reads as
  // water sloping off the edge over the dirt bed beneath, not a deep
  // water-filled trench as tall as the dirt cliff. They go down before the
  // ink so a border tile's repaint reproduces the same layering: cliff
  // below, its boundary line on top.
  const WATER_EDGE_DEPTH = 10; // max thickness of the water band, shallower than EDGE_DEPTH
  const eastEdge = mapEdge(MAP_SIZE, 0, MAP_SIZE, MAP_SIZE);
  const southEdge = mapEdge(MAP_SIZE, MAP_SIZE, 0, MAP_SIZE);
  const eastFloor = mapEdge(MAP_SIZE, 0, MAP_SIZE, MAP_SIZE, mp0);
  const southFloor = mapEdge(MAP_SIZE, MAP_SIZE, 0, MAP_SIZE, mp0);
  // Per-vertex water depth along a boundary: how many tiles of open water
  // separate this point from the nearest shore, ramped into a pixel depth
  // that's 0 at the shore and caps at WATER_EDGE_DEPTH two tiles out.
  function shoreDepths(tileAt) {
    const steps = new Array(MAP_TILES).fill(0);
    let run = -1;
    for (let i = 0; i < MAP_TILES; i++) {
      run = tileAt(i) === 4 ? run + 1 : -1;
      if (run > steps[i]) steps[i] = run;
    }
    run = -1;
    for (let i = MAP_TILES - 1; i >= 0; i--) {
      run = tileAt(i) === 4 ? run + 1 : -1;
      if (run > steps[i]) steps[i] = run;
    }
    const v = [];
    for (let j = 0; j <= MAP_TILES; j++) {
      const near = Math.min(steps[Math.max(0, j - 1)], steps[Math.min(MAP_TILES - 1, j)]);
      v.push(Math.min(WATER_EDGE_DEPTH, near * (WATER_EDGE_DEPTH / 2)));
    }
    return v;
  }
  for (const [top, floor, tileAt, dirt, water] of [
    [eastEdge, eastFloor, (i) => tiles[i][MAP_TILES - 1], tint(YARD_DIRT, -0.22), tint(WATER_COLOR, -0.22)],
    [southEdge, southFloor, (i) => tiles[MAP_TILES - 1][MAP_TILES - 1 - i], tint(YARD_DIRT, -0.36), tint(WATER_COLOR, -0.36)],
  ]) {
    const depth = shoreDepths(tileAt);
    for (let i = 0; i < MAP_TILES; i++) {
      mapCtx.fillStyle = shade(dirt, 1);
      mapCtx.beginPath();
      mapCtx.moveTo(top[i].x, top[i].y);
      mapCtx.lineTo(top[i + 1].x, top[i + 1].y);
      mapCtx.lineTo(floor[i + 1].x, floor[i + 1].y + EDGE_DEPTH);
      mapCtx.lineTo(floor[i].x, floor[i].y + EDGE_DEPTH);
      mapCtx.closePath();
      mapCtx.fill();

      if (tileAt(i) !== 4) continue;
      mapCtx.fillStyle = shade(water, 1);
      mapCtx.beginPath();
      mapCtx.moveTo(top[i].x, top[i].y);
      mapCtx.lineTo(top[i + 1].x, top[i + 1].y);
      mapCtx.lineTo(top[i + 1].x, top[i + 1].y + depth[i + 1]);
      mapCtx.lineTo(top[i].x, top[i].y + depth[i]);
      mapCtx.closePath();
      mapCtx.fill();
    }
  }

  // Close the island's ink silhouette under the cliffs; their top edge is
  // drawn by the border tiles' own boundary lines
  mapCtx.strokeStyle = INK;
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  mapCtx.moveTo(eastEdge[0].x, eastEdge[0].y);
  mapCtx.lineTo(eastFloor[0].x, eastFloor[0].y + EDGE_DEPTH);
  mapCtx.lineTo(southFloor[0].x, southFloor[0].y + EDGE_DEPTH);
  mapCtx.lineTo(southFloor[southFloor.length - 1].x, southFloor[southFloor.length - 1].y + EDGE_DEPTH);
  mapCtx.lineTo(southEdge[southEdge.length - 1].x, southEdge[southEdge.length - 1].y);
  mapCtx.stroke();

  // Ink every terrain boundary before the roads go down on top
  for (let ty = 0; ty < MAP_TILES; ty++)
    for (let tx = 0; tx < MAP_TILES; tx++) tileInk(tx, ty);

  // One ink pass under every road and ditch stamp: the fills that follow
  // cover all of it except a one-pixel rim around the union
  const allStamps = new Set();
  for (const list of roadStamps.values()) for (const s of list) allStamps.add(s);
  mapCtx.save();
  clipMapDiamond();
  mapCtx.fillStyle = ROAD_INK;
  for (const s of allStamps) {
    const c = mp(s.x, s.y);
    mapCtx.beginPath();
    mapCtx.ellipse(c.x, c.y, s.r * 1.5 + 1, s.r * 0.75 + 1, 0, 0, Math.PI * 2);
    mapCtx.fill();
  }
  mapCtx.restore();

  // Ditches go down before the roads, so crossings read as culverts
  for (const d of ditchSamples) {
    const c = mp(d.x, d.y);
    mapCtx.fillStyle = shade(DITCH_COLOR, groundShade(d.x, d.y));
    mapCtx.beginPath();
    mapCtx.ellipse(c.x, c.y, 1.1 * 1.5, 1.1 * 0.75, 0, 0, Math.PI * 2);
    mapCtx.fill();
  }

  // Roads: stamped as overlapping ground ellipses so they follow the hills,
  // shaded like the terrain under them. Clipped to the map diamond so roads
  // running past the edge are cut off cleanly, as if continuing beyond.
  mapCtx.save();
  clipMapDiamond();
  for (const road of roads) {
    for (const p of road.pts) {
      const c = mp(p.x, p.y);
      mapCtx.fillStyle = shade(
        tileTypeAt(p.x, p.y) === 4 ? BRIDGE_COLOR : ROAD_COLOR,
        groundShade(p.x, p.y)
      );
      mapCtx.beginPath();
      mapCtx.ellipse(c.x, c.y, road.r * 1.5, road.r * 0.75, 0, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Wheel-worn speckles along the middle
    mapCtx.fillStyle = shade(ROAD_SPECKLE, 1);
    for (let i = 0; i < road.pts.length; i += 3) {
      const p = road.pts[i];
      const c = mp(
        p.x + (rand() - 0.5) * road.r,
        p.y + (rand() - 0.5) * road.r
      );
      mapCtx.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
    }
  }
  mapCtx.restore();

  // Trodden dirt yard around the farm buildings
  const fc = mp(FARM.x, FARM.y);
  mapCtx.fillStyle = shade(YARD_DIRT, 1);
  farmYardPath(fc);
  mapCtx.fill();
  mapCtx.strokeStyle = MAP_INK;
  mapCtx.lineWidth = 1;
  mapCtx.stroke();
  mapCtx.fillStyle = shade(YARD_DIRT_DARK, 1);
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * yardScaleAt(a) * 0.94; // stay shy of the rim
    const px = Math.round(fc.x + Math.cos(a) * r * FARM_RADIUS * 1.7);
    const py = Math.round(fc.y + Math.sin(a) * r * FARM_RADIUS * 0.85);
    yardPixels.push({ x: px, y: py });
    mapCtx.fillRect(px, py, 1, 1);
  }

  // Dither everything painted after the tiles (ink, roads, yard); tiles are
  // already dithered and the pass leaves them unchanged
  ditherRegion(mapCtx, 0, 0, mapCanvas.width, mapCanvas.height);
}

// ---------------------------------------------------------------------------
// Minimap: one 2x1-pixel tile diamond, kept up to date by drawTile
// ---------------------------------------------------------------------------

const minimapCanvas = document.createElement("canvas");
minimapCanvas.width = MAP_TILES * 2;
minimapCanvas.height = MAP_TILES;
const minimapCtx = minimapCanvas.getContext("2d");

// grass, field, plowed, seeded, water; ripe crops turn gold (kept a universal
// wheat tone below, unlike the rest of this array — grain looks the same
// color regardless of biome). Plowed is a clearly darker brown than stubble
// so the two read apart at a glance, both here and in the field ledger's
// legend swatches. Derived from the map's palette rather than hand-picked so
// every theme gets a matching minimap.
const MINIMAP_COLORS = [
  tint(PROFILE.palette.grass[1], -0.22),
  stubbleTint(PROFILE.palette.dirt[0]),
  tint(PROFILE.palette.dirt[0], -0.45),
  tint(PROFILE.palette.grass[1], 0.32),
  WATER_COLOR,
];
const MINIMAP_MEADOW = meadowTint(PROFILE.palette.grass[1]);

// The farm marker's footprint in minimap diamond space (matches the fillRect
// below it's drawn with). minimapTile steers clear of these pixels so
// season and field repaints, which restamp random tiles over time, can
// never paint over the marker.
const FARM_MARKER = {
  x0: Math.round((FARM.x - FARM.y) / TILE) + MAP_TILES - 1,
  y0: Math.round((FARM.x + FARM.y) / (2 * TILE)) - 1,
};
FARM_MARKER.x1 = FARM_MARKER.x0 + 2;
FARM_MARKER.y1 = FARM_MARKER.y0 + 2;

// The city marker, same footprint math as the farm's, so minimapTile can
// steer clear of it the same way
const CITY_MARKER = {
  x0: Math.round((CITY.x - CITY.y) / TILE) + MAP_TILES - 1,
  y0: Math.round((CITY.x + CITY.y) / (2 * TILE)) - 1,
};
CITY_MARKER.x1 = CITY_MARKER.x0 + 2;
CITY_MARKER.y1 = CITY_MARKER.y0 + 2;

// Exact minimap pixels a road passes through, keyed "x,y". Built from
// roadSamples once the road network exists, then consulted by minimapTile
// so a road survives every future repaint of the tile underneath it instead
// of only being stamped once at startup.
const roadPixels = new Set();

function minimapTile(tx, ty) {
  const type = tiles[ty][tx];
  let color = MINIMAP_COLORS[type];
  if (type === 0 && forestTiles.has(ty * MAP_TILES + tx)) color = PROFILE.palette.conifer;
  if (type === 0 && meadowTiles.has(ty * MAP_TILES + tx)) color = MINIMAP_MEADOW;
  if (type === 3 && cropStage(growth[ty][tx]) >= 3) color = "#e3c355";
  const px = tx - ty + MAP_TILES - 1;
  const py = (tx + ty) >> 1;
  for (let dx = 0; dx < 2; dx++) {
    const x = px + dx;
    if (x >= FARM_MARKER.x0 && x <= FARM_MARKER.x1 && py >= FARM_MARKER.y0 && py <= FARM_MARKER.y1)
      continue;
    if (x >= CITY_MARKER.x0 && x <= CITY_MARKER.x1 && py >= CITY_MARKER.y0 && py <= CITY_MARKER.y1)
      continue;
    minimapCtx.fillStyle = shade(roadPixels.has(x + "," + py) ? ROAD_COLOR : color, 1);
    minimapCtx.fillRect(x, py, 1, 1);
  }
}

makeMap();

// Now that the road network (and water/terrain generally) exists,
// finalize each paddock's placement. Generate a spread of candidate
// positions all the way around the farm — 3 rings (near-corner distance
// 82/95/108 from FARM.x/y, each far enough out to clear the yard's
// trodden-dirt radius even at its lobed rim's worst case, ≈76.4 units,
// see YARD_RADIUS/YARD_MAX_SCALE further down) × 16 angles — rather than
// just a couple of fixed compass directions, so a farm on a small spit of
// land still has somewhere dry to try. Each candidate is axis-aligned
// (paddocks can't rotate independent of FARM.angle) with its NEAREST
// corner to FARM.x/y sitting exactly on the ring, extending away from the
// farm in whichever quadrant that angle falls in.
{
  const toWorld = (lx, ly) => rotateLocal(FARM.x, FARM.y, FARM.angle, lx, ly);
  const RING_DISTS = [82, 95, 108];
  const ANGLE_STEPS = 16;
  const candidatesFor = (size) => {
    const cands = [];
    for (const nearDist of RING_DISTS)
      for (let i = 0; i < ANGLE_STEPS; i++) {
        const theta = (i / ANGLE_STEPS) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const nx = Math.abs(nearDist * cosT);
        const ny = Math.abs(nearDist * sinT);
        let x0, x1, y0, y1;
        if (cosT >= 0) { x0 = nx; x1 = nx + size.w; } else { x1 = -nx; x0 = -nx - size.w; }
        if (sinT >= 0) { y0 = ny; y1 = ny + size.h; } else { y1 = -ny; y0 = -ny - size.h; }
        cands.push({ x0, x1, y0, y1 });
      }
    return cands;
  };
  // Hard rules first (disqualify outright — no amount of road/water
  // cleanliness makes up for sitting on a building, another paddock, or
  // hanging off the edge of the map), then a soft badness score for
  // whatever's left.
  const MAP_MARGIN = 30;
  const overlapsBox = (p, [bx0, bx1, by0, by1]) =>
    p.x0 < bx1 && p.x1 > bx0 && p.y0 < by1 && p.y1 > by0;
  const disqualified = (p, extraBoxes) => {
    for (const box of FARM_BUILDING_FOOTPRINTS) if (overlapsBox(p, box)) return true;
    for (const box of extraBoxes) if (overlapsBox(p, box)) return true;
    for (const lx of [p.x0, p.x1])
      for (const ly of [p.y0, p.y1]) {
        const w = toWorld(lx, ly);
        if (w.x < MAP_MARGIN || w.x > MAP_SIZE - MAP_MARGIN || w.y < MAP_MARGIN || w.y > MAP_SIZE - MAP_MARGIN)
          return true;
      }
    return false;
  };
  const badness = (p) => {
    let hits = 0;
    // Perimeter, 2 local units apart: any road tile along the fence line
    for (const [ax0, ay0, ax1, ay1] of [
      [p.x0, p.y0, p.x1, p.y0],
      [p.x0, p.y1, p.x1, p.y1],
      [p.x0, p.y0, p.x0, p.y1],
      [p.x1, p.y0, p.x1, p.y1],
    ]) {
      const horizontal = ay0 === ay1;
      const len = horizontal ? ax1 - ax0 : ay1 - ay0;
      const steps = Math.max(1, Math.round(Math.abs(len) / 2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lx = horizontal ? ax0 + (ax1 - ax0) * t : ax0;
        const ly = horizontal ? ay0 : ay0 + (ay1 - ay0) * t;
        const w = toWorld(lx, ly);
        if (roadTiles.has(tileKey(w.x, w.y))) hits++;
      }
    }
    // Interior grid, roughly 4 local units apart: any water anywhere
    // inside the paddock, not just on the fence line itself
    const gx = Math.max(1, Math.round((p.x1 - p.x0) / 4));
    const gy = Math.max(1, Math.round((p.y1 - p.y0) / 4));
    for (let iy = 0; iy <= gy; iy++)
      for (let ix = 0; ix <= gx; ix++) {
        const lx = p.x0 + ((p.x1 - p.x0) * ix) / gx;
        const ly = p.y0 + ((p.y1 - p.y0) * iy) / gy;
        const w = toWorld(lx, ly);
        if (tileTypeAt(w.x, w.y) === 4) hits++;
      }
    return hits;
  };
  PADDOCKS_LOCAL = {};
  // Cow picked first, then excluded as an obstacle for pig's own search
  // (and vice versa were the order reversed) so the two can never overlap.
  for (const species of Object.keys(PADDOCK_SIZE)) {
    const otherRects = Object.values(PADDOCKS_LOCAL).map((p) => [p.x0, p.x1, p.y0, p.y1]);
    let best = null;
    let bestHits = Infinity;
    for (const cand of candidatesFor(PADDOCK_SIZE[species])) {
      if (disqualified(cand, otherRects)) continue;
      const hits = badness(cand);
      if (hits < bestHits) {
        bestHits = hits;
        best = cand;
      }
      if (bestHits === 0) break;
    }
    // Every candidate disqualified (pathological map) — fall back to the
    // innermost, dead-ahead ring rather than leaving the species unpenned.
    PADDOCKS_LOCAL[species] = best || candidatesFor(PADDOCK_SIZE[species])[0];
  }
  PADDOCKS_WORLD = {};
  for (const species of Object.keys(PADDOCKS_LOCAL)) {
    const p = PADDOCKS_LOCAL[species];
    let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
    for (const lx of [p.x0, p.x1])
      for (const ly of [p.y0, p.y1]) {
        const w = toWorld(lx, ly);
        wx0 = Math.min(wx0, w.x); wx1 = Math.max(wx1, w.x);
        wy0 = Math.min(wy0, w.y); wy1 = Math.max(wy1, w.y);
      }
    PADDOCKS_WORLD[species] = { x0: wx0, x1: wx1, y0: wy0, y1: wy1 };
  }
}

// True if (wx,wy) falls inside either finalized paddock — used below to
// keep vegetation planted after this point (lone trees, bushes,
// hedgerows) from ending up fenced in with the stock. Forest stands and
// meadow patches don't need this: they're generated earlier, inside
// makeMap(), and already avoid the whole FARM_PASTURE_RADIUS circle,
// which covers any possible paddock placement by construction.
function insideAnyPaddock(wx, wy) {
  for (const species of Object.keys(PADDOCKS_WORLD)) {
    const p = PADDOCKS_WORLD[species];
    if (wx > p.x0 && wx < p.x1 && wy > p.y0 && wy < p.y1) return true;
  }
  return false;
}

// True if a repainted tile needs its paddock ground restored afterward
// (see paddockDabs below) — anywhere inside a paddock, plus a tile of
// slop so the fence-hugging worn path along the rim doesn't go missing
// when the tile just outside the rail repaints.
function nearAnyPaddock(tx, ty) {
  const wx = (tx + 0.5) * TILE;
  const wy = (ty + 0.5) * TILE;
  for (const species of Object.keys(PADDOCKS_WORLD)) {
    const p = PADDOCKS_WORLD[species];
    if (wx > p.x0 - TILE && wx < p.x1 + TILE && wy > p.y0 - TILE && wy < p.y1 + TILE) return true;
  }
  return false;
}

// Paddock ground: grazed pasture rather than plain untouched grass — a
// uniform "cropped lawn" green fill (PADDOCK_GRASS, a touch darker/flatter
// than GRASS) covering the whole interior, replacing the mottled,
// flower-speckled wild grass that would otherwise be there, plus a thin,
// broken worn-dirt line just inside the fence where real stock paces the
// rail. 18j/18k tried leading with heavy mud dabs instead — it read as
// messy/too-different rather than "grazed field," not what a paddock
// should look like at a glance; the flat, even green fill is what actually
// sells "uniform pasture," and the dirt is now a light accent, not the
// point. Fixed color, not season-reactive — same simplification YARD_DIRT
// already makes ("the farmyard's trodden dirt never turns with the
// seasons").
const PADDOCK_GRASS = tint(GRASS, -0.1);
const PADDOCK_MUD = "#5a4a32";
const PADDOCK_MUD_DARK = "#3d3220";

// The flat fill: one solid screen-projected quad per paddock. Recomputed
// (not cached as a pixel list like paddockDabs below) wherever it's
// painted — it's only 4 mp() calls and a fill, cheaper to redo than store.
function paintPaddockFills() {
  mapCtx.fillStyle = shade(PADDOCK_GRASS, 1);
  for (const species of Object.keys(PADDOCKS_WORLD)) {
    const p = PADDOCKS_WORLD[species];
    const pts = [mp(p.x0, p.y0), mp(p.x1, p.y0), mp(p.x1, p.y1), mp(p.x0, p.y1)];
    mapCtx.beginPath();
    mapCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) mapCtx.lineTo(pts[i].x, pts[i].y);
    mapCtx.closePath();
    mapCtx.fill();
  }
}

// The worn-dirt accent: single-pixel dabs (not the bold 2-3px blocks
// 18k used), broken up with gaps so it reads as a trodden line, not a
// solid dark border. Screen-space (mp-projected), exactly like yardPixels
// above — deterministic, so replaying it after a later repaint (drawTile's
// nearAnyPaddock branch, see there) is a no-op.
const paddockDabs = [];
function stampPaddockGround(p) {
  const inset = 1.6;
  const w = p.x1 - p.x0 - inset * 2;
  const h = p.y1 - p.y0 - inset * 2;
  const perim = 2 * (w + h);
  for (let d = 0; d < perim; d += 1.6) {
    if (rand() < 0.55) continue; // gaps — a broken, worn line, not a solid border
    let wx, wy;
    if (d < w) {
      wx = p.x0 + inset + d;
      wy = p.y0 + inset;
    } else if (d < w + h) {
      const dd = d - w;
      wx = p.x1 - inset;
      wy = p.y0 + inset + dd;
    } else if (d < 2 * w + h) {
      const dd = d - w - h;
      wx = p.x1 - inset - dd;
      wy = p.y1 - inset;
    } else {
      const dd = d - 2 * w - h;
      wx = p.x0 + inset;
      wy = p.y1 - inset - dd;
    }
    const c = mp(wx + (rand() - 0.5) * 1.6, wy + (rand() - 0.5) * 1.6);
    paddockDabs.push({
      x: Math.round(c.x),
      y: Math.round(c.y),
      color: rand() < 0.4 ? PADDOCK_MUD_DARK : PADDOCK_MUD,
    });
  }
}
for (const species of Object.keys(PADDOCKS_WORLD)) stampPaddockGround(PADDOCKS_WORLD[species]);
paintPaddockFills();
for (const d of paddockDabs) {
  mapCtx.fillStyle = shade(d.color, 1);
  mapCtx.fillRect(d.x, d.y, 1, 1);
}
// Re-dither the whole map: makeMap() already did this once, before
// paddock placement was known, so this new fill/dirt hasn't been covered
// yet. A one-time load-time cost, same as makeMap()'s own full-canvas
// pass — cheap enough not to bother computing a tighter bbox.
ditherRegion(mapCtx, 0, 0, mapCanvas.width, mapCanvas.height);

for (const p of roadSamples)
  roadPixels.add(
    Math.round((p.x - p.y) / TILE) + MAP_TILES + "," + Math.round((p.x + p.y) / (2 * TILE))
  );

for (let ty = 0; ty < MAP_TILES; ty++)
  for (let tx = 0; tx < MAP_TILES; tx++) minimapTile(tx, ty);

// Farm marker, at the yard's center (kept clear of tile repaints by
// minimapTile's FARM_MARKER check above)
minimapCtx.fillStyle = "#e04030";
minimapCtx.fillRect(FARM_MARKER.x0, FARM_MARKER.y0, 3, 3);

// City marker, same treatment as the farm's but a deeper red so the two
// stay distinguishable at a glance
minimapCtx.fillStyle = "#c0392b";
minimapCtx.fillRect(CITY_MARKER.x0, CITY_MARKER.y0, 3, 3);

// ---------------------------------------------------------------------------
// Lollipop trees scattered over the meadows
// ---------------------------------------------------------------------------

const TREE_BOXES = [
  { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9, z0: 0.0, z1: 4.5, color: "#8a5a36" }, // trunk
];

// Cloud-shaped canopy: one big blob with two smaller ones tucked against it.
// Spring colors (this map's palette); updateSeason() recolors them through
// summer into autumn and back again.
const TREE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 7.2, r: 4.2, color: PROFILE.palette.canopy[0] },
  { blob: true, x: 1.5, y: -1.5, z: 9.6, r: 2.7, color: tint(PROFILE.palette.canopy[0], 0.1), bias: 0.05 },
  { blob: true, x: -1.3, y: 1.3, z: 10.2, r: 2.1, color: tint(PROFILE.palette.canopy[0], 0.22), bias: 0.1 },
];

// Conifers are evergreen: their colors stay put through the seasons, so
// they're set once from this map's palette rather than going through
// updateSeason(). Spruce: a tall narrow cone of tapering tiers.
const CONIFER_BOXES = [
  { x0: -0.7, x1: 0.7, y0: -0.7, y1: 0.7, z0: 0.0, z1: 2.4, color: "#7a4f30" }, // trunk
];
const SPRUCE_BASE = PROFILE.palette.conifer;
const SPRUCE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 3.0, r: 2.6, color: SPRUCE_BASE },
  { blob: true, x: 0, y: 0, z: 5.6, r: 2.0, color: tint(SPRUCE_BASE, 0.05), bias: 0.05 },
  { blob: true, x: 0, y: 0, z: 7.9, r: 1.5, color: tint(SPRUCE_BASE, 0.1), bias: 0.1 },
  { blob: true, x: 0, y: 0, z: 9.9, r: 1.0, color: tint(SPRUCE_BASE, 0.15), bias: 0.15 },
  { blob: true, x: 0, y: 0, z: 11.4, r: 0.55, color: tint(SPRUCE_BASE, 0.2), bias: 0.2 },
];
// Fir: broader and softer, with a blue-green cast
const FIR_BASE = tint(SPRUCE_BASE, 0.12);
const FIR_BLOBS = [
  { blob: true, x: 0, y: 0, z: 3.0, r: 3.2, color: FIR_BASE },
  { blob: true, x: 0, y: 0, z: 5.8, r: 2.5, color: tint(FIR_BASE, 0.05), bias: 0.05 },
  { blob: true, x: 0, y: 0, z: 8.3, r: 1.8, color: tint(FIR_BASE, 0.1), bias: 0.1 },
  { blob: true, x: 0, y: 0, z: 10.3, r: 1.0, color: tint(FIR_BASE, 0.15), bias: 0.15 },
];

const TREE_KINDS = [
  { boxes: TREE_BOXES, blobs: TREE_BLOBS }, // deciduous, turns with the seasons
  { boxes: CONIFER_BOXES, blobs: SPRUCE_BLOBS },
  { boxes: CONIFER_BOXES, blobs: FIR_BLOBS },
];

const trees = [];

// A map's broadleaf share sets how English-lowland (hedgerow country,
// deciduous-heavy) vs. Scottish-highland/plantation (conifer-heavy) its
// tree cover reads, on top of the fixed spruce:fir split within whatever's
// left over. Lone trees on open grass always skew a bit more deciduous
// than dense forest stands do, same relationship the old fixed odds had.
const DECID_SHARE = clamp(0.25 + PROFILE.broadleaf * 0.6, 0.05, 0.95);
const DECID_SPRUCE_T = DECID_SHARE + (1 - DECID_SHARE) * 0.538;
const LONE_DECID_SHARE = Math.min(0.97, DECID_SHARE + 0.25);
const LONE_SPRUCE_T = LONE_DECID_SHARE + (1 - LONE_DECID_SHARE) * 0.625;

// Dense stands on the forest tiles; roads passing through keep clearings
for (const k of forestTiles) {
  const ftx = k % MAP_TILES;
  const fty = (k / MAP_TILES) | 0;
  const n = 2 + ((rand() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const wx = (ftx + 0.05 + rand() * 0.9) * TILE;
    const wy = (fty + 0.05 + rand() * 0.9) * TILE;
    if (roadTiles.has(tileKey(wx, wy))) continue;
    const r = rand();
    trees.push({
      wx,
      wy,
      angle: rand() * Math.PI * 2,
      kind: r < DECID_SHARE ? 0 : r < DECID_SPRUCE_T ? 1 : 2,
    });
  }
}

// Lone trees scattered over open grass, kept clear of the wildflower
// meadows so those patches read as open ground rather than clearings
const loneTarget = trees.length + 70;
for (let attempts = 0; trees.length < loneTarget && attempts < 5000; attempts++) {
  const wx = 24 + rand() * (MAP_SIZE - 48);
  const wy = 24 + rand() * (MAP_SIZE - 48);
  if (tileTypeAt(wx, wy) !== 0) continue; // grass only, never on a field
  if (forestTiles.has(tileKey(wx, wy))) continue; // stands are planted above
  if (meadowTiles.has(tileKey(wx, wy))) continue; // meadows stay open
  if (roadTiles.has(tileKey(wx, wy))) continue; // and never on a road
  if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_PASTURE_RADIUS) continue;
  if (Math.hypot(wx - CITY.x, wy - CITY.y) < CITY_RADIUS + 30) continue;
  if (insideAnyPaddock(wx, wy)) continue;
  if (trees.some((t) => Math.hypot(t.wx - wx, t.wy - wy) < 20)) continue;
  const r = rand();
  trees.push({
    wx,
    wy,
    angle: rand() * Math.PI * 2,
    kind: r < LONE_DECID_SHARE ? 0 : r < LONE_SPRUCE_T ? 1 : 2,
  });
}

// Trees are solid trunks the tractor collides with. Indexed by tile so a
// stand-dense map (Deep Woods, Wilderness) doesn't force a scan of every
// tree on the map each frame — only the tractor's own tile and its ring of
// neighbors, which always covers TREE_COLLIDE_R since it's under a tile.
const treesByTile = new Map();
for (const t of trees) {
  const key = tileKey(t.wx, t.wy);
  let list = treesByTile.get(key);
  if (!list) treesByTile.set(key, (list = []));
  list.push(t);
}

// ---------------------------------------------------------------------------
// Bushes: little round shrubs on the meadows
// ---------------------------------------------------------------------------

// Each variant is [spring, summer, autumn]
const BUSH_COLORS = [
  ["#5d9b5e", "#51844d", "#917d4a"],
  ["#6caa6a", "#5f945a", "#9e8d51"],
  ["#558f55", "#477945", "#7f6d41"],
];
const bushes = [];
for (let attempts = 0; bushes.length < 110 && attempts < 6000; attempts++) {
  const wx = 20 + rand() * (MAP_SIZE - 40);
  const wy = 20 + rand() * (MAP_SIZE - 40);
  if (tileTypeAt(wx, wy) !== 0) continue;
  if (roadTiles.has(tileKey(wx, wy))) continue;
  if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 12) continue;
  if (Math.hypot(wx - CITY.x, wy - CITY.y) < CITY_RADIUS + 12) continue;
  if (insideAnyPaddock(wx, wy)) continue;
  if (trees.some((t) => Math.hypot(t.wx - wx, t.wy - wy) < 8)) continue;
  if (bushes.some((b) => Math.hypot(b.wx - wx, b.wy - wy) < 10)) continue;
  const r = 1.6 + rand();
  const seasonColors = BUSH_COLORS[(rand() * BUSH_COLORS.length) | 0];
  bushes.push({
    wx,
    wy,
    r,
    seasonColors,
    shapes: [{ blob: true, x: 0, y: 0, z: r * 0.9, r, color: seasonColors[0] }],
  });
}

// Hedgerows: rows of darker shrubs along some field edges. Gaps open up
// wherever a road or driveway passes.
// Each variant is [spring, summer, autumn]
const HEDGE_COLORS = [
  ["#4e7d4c", "#426a40", "#7a673f"],
  ["#578653", "#4c7849", "#877543"],
  ["#477446", "#3a6139", "#705f3a"],
];
for (const p of patches) {
  const x0 = p.px * TILE;
  const x1 = (p.px + p.pw) * TILE;
  const y0 = p.py * TILE;
  const y1 = (p.py + p.ph) * TILE;
  const off = 7;
  for (const [sx, sy, ex, ey] of [
    [x0, y0 - off, x1, y0 - off],
    [x0, y1 + off, x1, y1 + off],
    [x0 - off, y0, x0 - off, y1],
    [x1 + off, y0, x1 + off, y1],
  ]) {
    if (rand() > 0.3) continue; // roughly one side per field
    const len = Math.hypot(ex - sx, ey - sy);
    for (let s = 2; s < len - 1; s += 6.5) {
      const wx = sx + ((ex - sx) * s) / len + (rand() - 0.5) * 1.5;
      const wy = sy + ((ey - sy) * s) / len + (rand() - 0.5) * 1.5;
      if (wx < 16 || wy < 16 || wx > MAP_SIZE - 16 || wy > MAP_SIZE - 16) continue;
      if (tileTypeAt(wx, wy) !== 0) continue; // not on another field
      if (roadTiles.has(tileKey(wx, wy))) continue; // keep the gates open
      if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 12) continue;
      if (Math.hypot(wx - CITY.x, wy - CITY.y) < CITY_RADIUS + 12) continue;
      if (insideAnyPaddock(wx, wy)) continue;
      const r = 1.7 + rand() * 0.8;
      const seasonColors = HEDGE_COLORS[(rand() * HEDGE_COLORS.length) | 0];
      bushes.push({
        wx,
        wy,
        r,
        seasonColors,
        shapes: [{ blob: true, x: 0, y: 0, z: r * 0.9, r, color: seasonColors[0] }],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Animals: cows, sheep, pigs and goats graze in small herds on the meadows,
// horses roam wider, ducks keep to the shoreline, a cat and dog linger
// around the farmyard, and flocks of birds cross the sky.
// ---------------------------------------------------------------------------

// The body is split into adjacent segments instead of overlapping boxes:
// overlapping boxes have near-equal painter's depths, and the sort order
// flips as the cow turns or drapes over a hill, which made them flicker
// Animal parts are listed in paint order (legs under body, head on top):
// each animal is drawn as one unit in this fixed order, because its parts
// are so small and close together that depth-sorting them individually
// lands on near-ties that flip while the animal moves
const COW_BOXES = [
  { x0: -2.0, x1: -1.2, y0: -1.0, y1: 1.0, z0: 0.0, z1: 1.3, color: "#5a534c" }, // hind legs
  { x0: 1.0, x1: 1.8, y0: -1.0, y1: 1.0, z0: 0.0, z1: 1.3, color: "#5a534c" }, // front legs
  { x0: -2.4, x1: -1.7, y0: -1.2, y1: 1.2, z0: 1.3, z1: 3.8, color: "#f0ede2" }, // rump
  { x0: -1.7, x1: 0.4, y0: -1.2, y1: 1.2, z0: 1.3, z1: 3.8, color: "#413c38" }, // dark middle
  { x0: 0.4, x1: 2.0, y0: -1.2, y1: 1.2, z0: 1.3, z1: 3.8, color: "#f0ede2" }, // shoulders
  { x0: 2.0, x1: 2.9, y0: -0.8, y1: 0.8, z0: 2.4, z1: 4.2, color: "#f0ede2" }, // head
  { x0: 2.9, x1: 3.35, y0: -0.7, y1: 0.7, z0: 2.4, z1: 3.4, color: "#d9a3ab" }, // muzzle
];
const SHEEP_BOXES = [
  { x0: 1.4, x1: 2.4, y0: -0.6, y1: 0.6, z0: 1.6, z1: 2.9, color: "#4a4238" }, // head
  { x0: -1.4, x1: -0.6, y0: -0.7, y1: 0.7, z0: 0.0, z1: 1.4, color: "#4a4238" }, // hind legs
  { x0: 0.5, x1: 1.3, y0: -0.7, y1: 0.7, z0: 0.0, z1: 1.4, color: "#4a4238" }, // front legs
];

// Horse: taller and slimmer, with a raised neck, dark mane and a tail.
// Same fixed paint order: legs, body, tail, neck, head, mane.
const HORSE_BOXES = [
  { x0: -1.9, x1: -1.1, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // hind legs
  { x0: 1.0, x1: 1.8, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // front legs
  { x0: -2.3, x1: 2.0, y0: -1.0, y1: 1.0, z0: 1.8, z1: 3.9, color: "#8a5c3a" }, // body
  { x0: -2.9, x1: -2.3, y0: -0.3, y1: 0.3, z0: 2.2, z1: 3.7, color: "#4a3626" }, // tail
  { x0: 1.6, x1: 2.5, y0: -0.55, y1: 0.55, z0: 3.4, z1: 5.6, color: "#8a5c3a" }, // neck
  { x0: 2.2, x1: 3.4, y0: -0.5, y1: 0.5, z0: 4.6, z1: 5.7, color: "#8a5c3a" }, // head
  { x0: 1.5, x1: 2.1, y0: -0.15, y1: 0.15, z0: 4.2, z1: 6.0, color: "#4a3626" }, // mane
];
const SHEEP_SHAPES = [
  { blob: true, x: 0, y: 0, z: 2.1, r: 1.8, color: "#f4f1e6" }, // woolly body
];

// Chicken: a tiny white bird with a red comb and orange beak, drawn in
// fixed paint order like the others (body, tail, head, comb, beak)
const CHICKEN_BOXES = [
  { x0: -0.7, x1: 0.7, y0: -0.5, y1: 0.5, z0: 0.4, z1: 1.6, color: "#f5f1e4" }, // body
  { x0: -1.05, x1: -0.6, y0: -0.25, y1: 0.25, z0: 1.0, z1: 1.9, color: "#f5f1e4" }, // tail
  { x0: 0.5, x1: 0.95, y0: -0.25, y1: 0.25, z0: 1.3, z1: 2.3, color: "#f5f1e4" }, // head
  { x0: 0.6, x1: 0.9, y0: -0.12, y1: 0.12, z0: 2.3, z1: 2.6, color: "#d94a2e" }, // comb
  { x0: 0.95, x1: 1.25, y0: -0.12, y1: 0.12, z0: 1.5, z1: 1.7, color: "#f0a030" }, // beak
];

// Pig: low, round and dusty pink, with a curled tail and a flat snout
const PIG_BOXES = [
  { x0: -1.3, x1: -0.7, y0: -0.6, y1: 0.6, z0: 0.0, z1: 0.9, color: "#c98a94" }, // hind legs
  { x0: 0.6, x1: 1.2, y0: -0.6, y1: 0.6, z0: 0.0, z1: 0.9, color: "#c98a94" }, // front legs
  { x0: -1.6, x1: 1.3, y0: -1.0, y1: 1.0, z0: 0.9, z1: 2.3, color: "#eeb0bb" }, // body
  { x0: -1.9, x1: -1.5, y0: -0.25, y1: 0.25, z0: 1.6, z1: 2.1, color: "#d99aa4" }, // curled tail
  { x0: 1.3, x1: 2.1, y0: -0.55, y1: 0.55, z0: 1.1, z1: 2.1, color: "#eeb0bb" }, // head
  { x0: 2.1, x1: 2.45, y0: -0.4, y1: 0.4, z0: 1.2, z1: 1.7, color: "#c98a94" }, // snout
];

// Goat: leaner than a sheep, short-haired, with a pair of small dark horns
const GOAT_BOXES = [
  { x0: -1.1, x1: -0.5, y0: -0.55, y1: 0.55, z0: 0.0, z1: 1.1, color: "#8f8672" }, // hind legs
  { x0: 0.4, x1: 1.0, y0: -0.55, y1: 0.55, z0: 0.0, z1: 1.1, color: "#8f8672" }, // front legs
  { x0: -1.5, x1: 1.1, y0: -0.7, y1: 0.7, z0: 1.1, z1: 2.3, color: "#c9bfa8" }, // body
  { x0: 1.1, x1: 1.9, y0: -0.5, y1: 0.5, z0: 1.5, z1: 2.5, color: "#c9bfa8" }, // head
  { x0: 1.3, x1: 1.6, y0: -0.15, y1: 0.15, z0: 2.5, z1: 2.9, color: "#4a4238" }, // horns
];

// Duck: small and low to the ground, cream-gray with an orange beak — same
// legless silhouette convention as the chicken
const DUCK_BOXES = [
  { x0: -0.6, x1: 0.6, y0: -0.45, y1: 0.45, z0: 0.3, z1: 1.1, color: "#e3dcc4" }, // body
  { x0: -0.85, x1: -0.55, y0: -0.2, y1: 0.2, z0: 0.6, z1: 1.0, color: "#e3dcc4" }, // tail
  { x0: 0.5, x1: 0.85, y0: -0.22, y1: 0.22, z0: 0.9, z1: 1.5, color: "#e3dcc4" }, // head
  { x0: 0.8, x1: 1.1, y0: -0.12, y1: 0.12, z0: 0.95, z1: 1.15, color: "#e8891f" }, // beak
];

// Farm dog: brown with an up-curled tail and alert ears
const DOG_BOXES = [
  { x0: -0.9, x1: -0.5, y0: -0.4, y1: 0.4, z0: 0.0, z1: 0.9, color: "#8a6a42" }, // hind legs
  { x0: 0.4, x1: 0.8, y0: -0.4, y1: 0.4, z0: 0.0, z1: 0.9, color: "#8a6a42" }, // front legs
  { x0: -1.2, x1: 0.9, y0: -0.55, y1: 0.55, z0: 0.8, z1: 1.7, color: "#8a6a42" }, // body
  { x0: -1.5, x1: -1.15, y0: -0.15, y1: 0.15, z0: 1.1, z1: 1.6, color: "#6a4e30" }, // tail
  { x0: 0.9, x1: 1.5, y0: -0.4, y1: 0.4, z0: 1.1, z1: 1.9, color: "#8a6a42" }, // head
  { x0: 1.5, x1: 1.85, y0: -0.25, y1: 0.25, z0: 1.15, z1: 1.55, color: "#6a4e30" }, // snout
  { x0: 1.05, x1: 1.35, y0: -0.4, y1: -0.15, z0: 1.75, z1: 2.05, color: "#6a4e30" }, // left ear
  { x0: 1.05, x1: 1.35, y0: 0.15, y1: 0.4, z0: 1.75, z1: 2.05, color: "#6a4e30" }, // right ear
];

// Farm cat: small, orange tabby, tail curved up
const CAT_BOXES = [
  { x0: -0.5, x1: -0.2, y0: -0.3, y1: 0.3, z0: 0.0, z1: 0.55, color: "#b57a3f" }, // hind legs
  { x0: 0.15, x1: 0.45, y0: -0.3, y1: 0.3, z0: 0.0, z1: 0.55, color: "#b57a3f" }, // front legs
  { x0: -0.7, x1: 0.5, y0: -0.35, y1: 0.35, z0: 0.5, z1: 1.05, color: "#c98a4a" }, // body
  { x0: -0.95, x1: -0.65, y0: -0.12, y1: 0.12, z0: 0.9, z1: 1.6, color: "#a5713a" }, // tail
  { x0: 0.45, x1: 0.85, y0: -0.28, y1: 0.28, z0: 0.75, z1: 1.15, color: "#c98a4a" }, // head
  { x0: 0.55, x1: 0.7, y0: -0.28, y1: -0.12, z0: 1.15, z1: 1.35, color: "#a5713a" }, // left ear
  { x0: 0.55, x1: 0.7, y0: 0.12, y1: 0.28, z0: 1.15, z1: 1.35, color: "#a5713a" }, // right ear
];

// Per-species behavior: chickens are quick, jerky, peck constantly, keep to
// a small range and may run on roads (the yard is full of them)
// Every species gets clear of the tractor (spook radius + flee speed +
// fleeTurn rate): horses and chickens dash in a panic, while cows and sheep
// — still solid to drive against — just plod calmly out of the way.
const ANIMAL_SPECS = {
  cow: { speed: 2.5, range: 22, sep: 4.5, turn: 1.4, pauseChance: 0.004, pauseDur: [1, 3], shadow: 3.4, spook: 16, flee: 3.5, fleeTurn: 3 },
  sheep: { speed: 2.2, range: 20, sep: 4.5, turn: 1.4, pauseChance: 0.005, pauseDur: [1, 3], shadow: 2.4, spook: 16, flee: 3.8, fleeTurn: 3.5 },
  horse: { speed: 3.2, range: 26, sep: 4.5, turn: 1.4, pauseChance: 0.004, pauseDur: [1, 3], shadow: 3.4, spook: 26, flee: 22, fleeTurn: 8 },
  chicken: { speed: 5, range: 15, sep: 1.6, turn: 4, pauseChance: 0.03, pauseDur: [0.4, 1.2], shadow: 1.0, roads: true, spook: 18, flee: 16, fleeTurn: 8 },
  pig: { speed: 1.8, range: 14, sep: 3.2, turn: 1.3, pauseChance: 0.008, pauseDur: [1, 3], shadow: 2.4, spook: 14, flee: 10, fleeTurn: 5 },
  goat: { speed: 2.8, range: 26, sep: 3.6, turn: 1.6, pauseChance: 0.005, pauseDur: [1, 2.5], shadow: 2.0, spook: 18, flee: 14, fleeTurn: 6 },
  duck: { speed: 1.4, range: 10, sep: 1.4, turn: 3.5, pauseChance: 0.02, pauseDur: [0.3, 1], shadow: 0.8, spook: 10, flee: 9, fleeTurn: 7 },
  dog: { speed: 3.0, range: 12, sep: 2.0, turn: 2.5, pauseChance: 0.02, pauseDur: [0.5, 2], shadow: 1.6, roads: true, spook: 14, flee: 12, fleeTurn: 8 },
  cat: { speed: 2.2, range: 10, sep: 1.6, turn: 3, pauseChance: 0.03, pauseDur: [1, 4], shadow: 1.2, roads: true, spook: 10, flee: 14, fleeTurn: 10 },
};

// Every species draws as one fixed-order box unit except sheep, which pairs
// a woolly blob (SHEEP_SHAPES) with SHEEP_BOXES and is special-cased where
// items get built (see the sheep branch there)
const ANIMAL_BOXES = {
  cow: COW_BOXES,
  horse: HORSE_BOXES,
  chicken: CHICKEN_BOXES,
  pig: PIG_BOXES,
  goat: GOAT_BOXES,
  duck: DUCK_BOXES,
  dog: DOG_BOXES,
  cat: CAT_BOXES,
};

const animals = [];

// Every spawned group is registered as a herd, so routines can send its
// members somewhere together (see updateHerds) by moving their home anchor
const herds = [];

function spawnHerd(species, hx, hy, count) {
  const n = count || 3 + ((rand() * 4) | 0);
  const members = [];
  for (let i = 0; i < n; i++) {
    // Keep trying offsets until the animal actually stands on grass —
    // otherwise it can spawn in the water beside a shoreline home spot
    let wx = hx;
    let wy = hy;
    const pad = PADDOCKS_WORLD[species];
    for (let t = 0; t < 20; t++) {
      let cx = hx + (rand() - 0.5) * 24;
      let cy = hy + (rand() - 0.5) * 24;
      if (pad) {
        cx = clamp(cx, pad.x0 + 0.7, pad.x1 - 0.7);
        cy = clamp(cy, pad.y0 + 0.7, pad.y1 - 0.7);
      } else if (insideAnyPaddock(cx, cy)) {
        // Not this species' own paddock — every other species must never
        // spawn inside either fence, not just its own
        continue;
      }
      if (
        tileTypeAt(cx, cy) === 0 &&
        (ANIMAL_SPECS[species].roads || !roadTiles.has(tileKey(cx, cy)))
      ) {
        wx = cx;
        wy = cy;
        break;
      }
    }
    const a = {
      species,
      hx,
      hy,
      wx,
      wy,
      angle: rand() * Math.PI * 2,
      pause: rand() * 4,
      // Unique depth tiebreak: animals standing at the same depth keep a
      // consistent order instead of interleaving their parts
      tie: animals.length * 0.004,
    };
    animals.push(a);
    members.push(a);
  }
  herds.push({
    species,
    homeX: hx,
    homeY: hy,
    members,
    out: false,
    next: 20 + rand() * 60, // time until the first outing
  });
}

// Grass banks beside water, where the herds can amble down for a drink (and
// where ducks make their home outright) — computed early so the farm and
// wild duck herds below can place themselves on the shore
const shoreSpots = [];
for (let sy = 0; sy < MAP_TILES; sy++)
  for (let sx = 0; sx < MAP_TILES; sx++) {
    if (tiles[sy][sx] !== 0 || roadTiles.has(sy * MAP_TILES + sx)) continue;
    if (isWater(sx + 1, sy) || isWater(sx - 1, sy) || isWater(sx, sy + 1) || isWater(sx, sy - 1))
      shoreSpots.push({ x: (sx + 0.5) * TILE, y: (sy + 0.5) * TILE });
  }

function nearestShoreSpot(x, y) {
  let spot = null;
  let bd = Infinity;
  for (const s of shoreSpots) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) {
      bd = d;
      spot = s;
    }
  }
  return spot && { spot, dist: bd };
}

// The farm always keeps one herd of each grazing species close by. Cows
// and pigs are penned, so their home anchor is just their paddock's
// center — no need to go hunting for open ground for them.
for (const species of ["cow", "sheep", "horse", "pig", "goat"]) {
  if (PADDOCKS_WORLD[species]) {
    const p = PADDOCKS_WORLD[species];
    spawnHerd(species, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2);
    continue;
  }
  let hx = FARM.x;
  let hy = FARM.y;
  for (let tries = 0; tries < 200; tries++) {
    const a = rand() * Math.PI * 2;
    const d = FARM_RADIUS + 30 + rand() * 40;
    const cx = FARM.x + Math.cos(a) * d;
    const cy = FARM.y + Math.sin(a) * d;
    if (cx < 24 || cy < 24 || cx > MAP_SIZE - 24 || cy > MAP_SIZE - 24) continue;
    if (tileTypeAt(cx, cy) !== 0) continue;
    if (forestTiles.has(tileKey(cx, cy)) || roadTiles.has(tileKey(cx, cy))) continue;
    if (insideAnyPaddock(cx, cy)) continue; // not this species' pen to graze in
    hx = cx;
    hy = cy;
    break;
  }
  spawnHerd(species, hx, hy);
}

// ...and a flock of chickens pecking around the yard itself, plus one cat
// and one dog that just linger there rather than wandering as a herd
spawnHerd("chicken", FARM.x, FARM.y, 6 + ((rand() * 4) | 0));
spawnHerd("cat", FARM.x, FARM.y, 1);
spawnHerd("dog", FARM.x, FARM.y, 1);

// A handful of ducks at the waterside nearest the farm, if there's one
// close enough to be plausibly "theirs"
{
  const near = nearestShoreSpot(FARM.x, FARM.y);
  if (near && near.dist < 260) spawnHerd("duck", near.spot.x, near.spot.y);
}

// Plus a few wild-placed herds further out — cows and pigs are excluded
// here, since those two are penned at the farm (see PENNED_SPECIES) and
// have no business grazing loose out in the countryside
for (let placed = 0, tries = 0; placed < 6 && tries < 400; tries++) {
  const hx = 30 + rand() * (MAP_SIZE - 60);
  const hy = 30 + rand() * (MAP_SIZE - 60);
  if (tileTypeAt(hx, hy) !== 0) continue;
  if (forestTiles.has(tileKey(hx, hy)) || roadTiles.has(tileKey(hx, hy))) continue;
  if (Math.hypot(hx - FARM.x, hy - FARM.y) < FARM_RADIUS + 24) continue;
  if (insideAnyPaddock(hx, hy)) continue;
  const r = rand();
  const species = r < 1 / 3 ? "sheep" : r < 2 / 3 ? "horse" : "goat";
  spawnHerd(species, hx, hy);
  placed++;
}

// A couple of wild duck herds at shores further from the farm
for (let placed = 0, tries = 0; placed < 2 && tries < 60 && shoreSpots.length; tries++) {
  const s = shoreSpots[(rand() * shoreSpots.length) | 0];
  if (Math.hypot(s.x - FARM.x, s.y - FARM.y) < FARM_RADIUS + 100) continue;
  spawnHerd("duck", s.x, s.y);
  placed++;
}

// ---------------------------------------------------------------------------
// Signposts: little roadside boards naming the landmarks
// ---------------------------------------------------------------------------

// Tiny 5-row lettering, one string per row, stamped as ink pixels
const SIGN_FONT = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
};

const signs = [];

function addSign(text, wx, wy) {
  let w = -1;
  for (const ch of text) w += SIGN_FONT[ch][0].length + 1;
  signs.push({ text, wx, wy, w });
}

// A post with a cream board, drawn straight to the screen as a billboard.
// It renders into the scene canvas, so the ink pass outlines it like
// everything else and the board needs no frame of its own.
function drawSign(s, x, y) {
  const bw = s.w + 4;
  const bh = 9;
  const bx = x - (bw >> 1);
  const by = y - 6 - bh;
  sceneCtx.fillStyle = shade("#8a5a36", 1);
  sceneCtx.fillRect(x - 1, y - 8, 2, 8);
  sceneCtx.fillStyle = shade("#f2e6cc", 1);
  sceneCtx.fillRect(bx, by, bw, bh);
  sceneCtx.fillStyle = INK;
  let cx = bx + 2;
  for (const ch of s.text) {
    const g = SIGN_FONT[ch];
    for (let r = 0; r < 5; r++)
      for (let cc = 0; cc < g[r].length; cc++)
        if (g[r][cc] === "#") sceneCtx.fillRect(cx + cc, by + 2 + r, 1, 1);
    cx += g[0].length + 1;
  }
}

// Beside a road point, on whichever side is open grass
function placeSignBeside(text, p) {
  for (const side of [1, -1]) {
    const sx = p.x + Math.cos(p.dir + (Math.PI / 2) * side) * 7;
    const sy = p.y + Math.sin(p.dir + (Math.PI / 2) * side) * 7;
    if (tileTypeAt(sx, sy) === 0) {
      addSign(text, sx, sy);
      return true;
    }
  }
  return false;
}

// FARM where the farm's own road leaves the yard
if (roads.length && roads[0].pts.length > 6) placeSignBeside("FARM", roads[0].pts[5]);
else addSign("FARM", FARM.x + 24, FARM.y + 24);

// A BRIDGE sign on the approach, for up to two crossings
{
  let posted = 0;
  for (const r of roads) {
    if (posted >= 2) break;
    if (r.entry) continue;
    for (let i = 4; i < r.pts.length; i++) {
      if (tileTypeAt(r.pts[i].x, r.pts[i].y) !== 4) continue;
      if (tileTypeAt(r.pts[i - 2].x, r.pts[i - 2].y) === 4) continue; // mid-crossing
      if (placeSignBeside("BRIDGE", r.pts[i - 4])) posted++;
      break; // one sign per road
    }
  }
}

// POND at the waterside nearest the farm — where the herds go to drink
{
  const near = nearestShoreSpot(FARM.x, FARM.y);
  if (near && near.dist < 260) {
    const { spot, dist } = near;
    // A step inland, so it stands clear of the bank where the herds crowd
    const nx = spot.x + ((FARM.x - spot.x) / dist) * 8;
    const ny = spot.y + ((FARM.y - spot.y) / dist) * 8;
    if (tileTypeAt(nx, ny) === 0) addSign("POND", nx, ny);
    else addSign("POND", spot.x, spot.y);
  }
}

function updateAnimals(dt) {
  for (const a of animals) {
    const spec = ANIMAL_SPECS[a.species];
    const tractorDist = Math.hypot(a.wx - tractor.x, a.wy - tractor.y);
    const pad = PADDOCKS_WORLD[a.species];
    const walkable = (wx, wy) => {
      if (tileTypeAt(wx, wy) !== 0) return false;
      if (!spec.roads && roadTiles.has(tileKey(wx, wy))) return false;
      // Penned species stop at their fence line — inset half a unit so
      // they turn back before visibly clipping through the rails
      if (pad && (wx < pad.x0 + 0.6 || wx > pad.x1 - 0.6 || wy < pad.y0 + 0.6 || wy > pad.y1 - 0.6))
        return false;
      // The rail itself blocks every species, not just the ones penned
      // inside it — otherwise a wandering sheep or goat walks straight
      // through the line and stands astride it, which is what let animals
      // render in front of a fence they should have been behind
      for (const b of FENCE_SOLID_WORLD) {
        if (wx > b.x0 && wx < b.x1 && wy > b.y0 && wy < b.y1) return false;
      }
      // Never walk into the tractor (moving further away is always allowed)
      const td = Math.hypot(wx - tractor.x, wy - tractor.y);
      return td > 5 || td > tractorDist;
    };
    // Herd spacing: crowding neighbors ease each other apart (also while
    // grazing) so animals never stand inside one another
    for (const b of animals) {
      if (b === a) continue;
      const dx = a.wx - b.wx;
      const dy = a.wy - b.wy;
      const d = Math.hypot(dx, dy);
      if (d < spec.sep && d > 0.001) {
        const nx = a.wx + (dx / d) * (spec.sep - d) * dt * 3;
        const ny = a.wy + (dy / d) * (spec.sep - d) * dt * 3;
        if (walkable(nx, ny)) {
          a.wx = nx;
          a.wy = ny;
        }
      } else if (d <= 0.001) {
        a.wx += rand() - 0.5; // unstick exact overlaps
      }
    }
    // The delivery cart spooks animals just like the tractor does: flee
    // whichever machine is nearer
    let spook = tractor;
    let spookDist = tractorDist;
    let spookSpeed = Math.abs(tractor.speed);
    if (cart.on) {
      const vd = Math.hypot(a.wx - cart.x, a.wy - cart.y);
      if (vd < spookDist) {
        spook = cart;
        spookDist = vd;
        spookSpeed = cart.moving;
      }
    }
    // Spooked animals get clear of the machine — sideways off its path,
    // not down the line of travel — turning at the species' own pace but
    // always smoothly (no snaps)
    if (spec.spook && spookDist < spec.spook) {
      a.pause = 0;
      const tdx = a.wx - spook.x;
      const tdy = a.wy - spook.y;
      const hx = Math.cos(spook.angle);
      const hy = Math.sin(spook.angle);
      const side = tdx * -hy + tdy * hx >= 0 ? 1 : -1;
      const fx = -hy * side + (tdx / (spookDist || 1)) * 0.5;
      const fy = hx * side + (tdy / (spookDist || 1)) * 0.5;
      // Threshold scales with GEAR_SLOW_RATIO like the tractor's own
      // "meaningfully moving" checks — this reads tractor.speed too (or
      // cart.moving, fixed and unrelated to tractor gearing) and was
      // missed by the original tractor-speed rescale
      const want = spookSpeed > 3 * GEAR_SLOW_RATIO ? Math.atan2(fy, fx) : Math.atan2(tdy, tdx);
      const d = Math.atan2(Math.sin(want - a.angle), Math.cos(want - a.angle));
      a.angle += clamp(d, -spec.fleeTurn * dt, spec.fleeTurn * dt);
      const nx = a.wx + Math.cos(a.angle) * spec.flee * dt;
      const ny = a.wy + Math.sin(a.angle) * spec.flee * dt;
      if (walkable(nx, ny)) {
        a.wx = nx;
        a.wy = ny;
      } else {
        a.angle += 3 * dt; // cornered against water or a field: sidle along
      }
      continue; // fleeing overrides grazing and homing
    }
    if (a.pause > 0) {
      a.pause -= dt;
      continue;
    }
    // Amble about, turning back toward the herd's home spot when strayed.
    // Penned species skip this: the fence (via walkable, above) is their
    // real boundary, so they're free to use the whole paddock rather than
    // getting pulled back toward the center once they're spec.range from
    // a home point that's just the paddock's middle.
    a.angle += (rand() - 0.5) * spec.turn * dt;
    if (!pad && Math.hypot(a.wx - a.hx, a.wy - a.hy) > spec.range) {
      const want = Math.atan2(a.hy - a.wy, a.hx - a.wx);
      const d = Math.atan2(Math.sin(want - a.angle), Math.cos(want - a.angle));
      a.angle += clamp(d, -2.5 * dt, 2.5 * dt);
    }
    const nx = a.wx + Math.cos(a.angle) * spec.speed * dt;
    const ny = a.wy + Math.sin(a.angle) * spec.speed * dt;
    if (walkable(nx, ny)) {
      a.wx = nx;
      a.wy = ny;
    } else {
      // Blocked by water, a field or a road: pivot smoothly until a clear
      // direction opens up (an instant turn every frame strobes the model)
      a.angle += 2.5 * dt;
    }
    if (rand() < spec.pauseChance) {
      a.pause = spec.pauseDur[0] + rand() * spec.pauseDur[1];
    }
  }
}

// Herd routines: every so often a grazing herd ambles to the nearest water
// for a drink, lingers on the bank, and heads home again. Only the home
// anchor moves — the members' ordinary wander-and-home behavior walks them
// there at their own pace.
// Species that stay put rather than roaming to water on their own: the
// chicken flock and farm cat/dog keep to the yard, ducks already live at
// the shore, and cows/pigs are fenced into their paddock (PENNED_SPECIES)
// — none of them have anywhere their routine could send them
const STATIONARY_HERDS = new Set(["chicken", "cat", "dog", "duck", ...PENNED_SPECIES]);

function updateHerds(dt) {
  for (const h of herds) {
    if (STATIONARY_HERDS.has(h.species)) continue;
    h.next -= dt;
    if (h.next > 0) continue;
    if (h.out) {
      for (const a of h.members) {
        a.hx = h.homeX;
        a.hy = h.homeY;
      }
      h.out = false;
      h.next = 60 + rand() * 90;
      continue;
    }
    let spot = null;
    let bd = Infinity;
    for (const s of shoreSpots) {
      const d = Math.hypot(s.x - h.homeX, s.y - h.homeY);
      if (d < bd) {
        bd = d;
        spot = s;
      }
    }
    if (!spot || bd > 140 || bd < 20) {
      // No water worth the walk (or they graze on the bank already)
      h.next = 300;
      continue;
    }
    for (const a of h.members) {
      a.hx = spot.x;
      a.hy = spot.y;
    }
    h.out = true;
    h.next = 30 + rand() * 25; // drink and linger, then head back
  }
}

// ---------------------------------------------------------------------------
// The delivery cart: a horse pulling a flat-bed wagon, putters around the
// road network all day, pauses at dead ends to drop something off, and
// waits politely for the tractor to pass. Road points are 3 world units
// apart, so pts index maps to distance.
// ---------------------------------------------------------------------------

const CART_SPEED = 8;

// One rigid body: the horse's silhouette (reusing HORSE_BOXES' proportions,
// shifted forward) harnessed by a shaft to a wooden cart bed behind it —
// legs stand at z0 0, same ground contact as the cart's own wheels.
const CART_BOXES = [
  { x0: -6.0, x1: -0.8, y0: -2.0, y1: 2.0, z0: 1.8, z1: 3.4, color: "#9a7442" }, // wooden cart bed
  { x0: -1.2, x1: -0.8, y0: -2.0, y1: 2.0, z0: 1.8, z1: 4.4, color: "#8a6238" }, // front board / seat back
  { x0: -0.8, x1: 1.6, y0: -0.15, y1: 0.15, z0: 2.2, z1: 2.6, color: "#6b6b6b" }, // shaft, horse to cart
  { x0: 1.6, x1: 2.4, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // horse hind legs
  { x0: 4.5, x1: 5.3, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // horse front legs
  { x0: 1.2, x1: 5.5, y0: -1.0, y1: 1.0, z0: 1.8, z1: 3.9, color: "#8a5c3a" }, // horse body
  { x0: 0.6, x1: 1.2, y0: -0.3, y1: 0.3, z0: 2.2, z1: 3.7, color: "#4a3626" }, // horse tail
  { x0: 5.1, x1: 6.0, y0: -0.55, y1: 0.55, z0: 3.4, z1: 5.6, color: "#8a5c3a" }, // horse neck
  { x0: 5.7, x1: 6.9, y0: -0.5, y1: 0.5, z0: 4.6, z1: 5.7, color: "#8a5c3a" }, // horse head
  { x0: 5.0, x1: 5.6, y0: -0.15, y1: 0.15, z0: 4.2, z1: 6.0, color: "#4a3626" }, // horse mane
];

const CART_WHEELS = [
  { x: -3.4, y0: 1.9, y1: 2.7, z: 1.8, r: 1.8 },
  { x: -3.4, y0: -2.7, y1: -1.9, z: 1.8, r: 1.8 },
];

// The carter sits on the front board, just behind the horse — same seated
// three-blob figure convention as the tractor's own driver
const CART_DRIVER = [
  { blob: true, x: -1.0, y: 0, z: 5.0, r: 0.75, color: "#4a6fa5", bias: 0.5 }, // coat
  { blob: true, x: -1.0, y: 0, z: 6.0, r: 0.55, color: "#f2c091", bias: 0.55 }, // head
  { blob: true, x: -1.0, y: 0, z: 6.55, r: 0.5, color: "#4a4238", bias: 0.6 }, // flat cap
];

const cart = { on: false, x: 0, y: 0, angle: 0, road: null, seg: 0, dir: 1, pause: 0, moving: 0 };

// Start somewhere along the network
{
  const usable = roads.filter((r) => r.pts.length > 4);
  if (usable.length) {
    cart.road = usable[(rand() * usable.length) | 0];
    cart.seg = 1 + ((rand() * (cart.road.pts.length - 2)) | 0);
    cart.dir = rand() < 0.5 ? 1 : -1;
    const p = cart.road.pts[cart.seg];
    cart.x = p.x;
    cart.y = p.y;
    cart.angle = p.dir + (cart.dir < 0 ? Math.PI : 0);
    cart.on = true;
  }
}

function updateCart(dt) {
  if (!cart.on) return;
  if (cart.pause > 0) {
    cart.pause -= dt;
    cart.moving = 0;
    return;
  }
  // Wait for the tractor to pass rather than drive through it
  if (Math.hypot(tractor.x - cart.x, tractor.y - cart.y) < 10) {
    cart.moving = 0;
    return;
  }
  cart.moving = CART_SPEED;
  cart.seg += (cart.dir * CART_SPEED * dt) / 3;
  const pts = cart.road.pts;
  if (cart.seg <= 0 || cart.seg >= pts.length - 1) {
    // Reached an end of this road: make the delivery, then take any road
    // passing the spot — one of them is usually the road back
    cart.seg = clamp(cart.seg, 0, pts.length - 1);
    const end = pts[Math.round(cart.seg)];
    cart.pause = 2.5 + rand() * 3;
    const options = [];
    for (const r of roads) {
      if (r.pts.length < 5) continue;
      // Enter at the road's point nearest the junction, so resuming does
      // not visibly hop, and head into its longer side so the trip amounts
      // to something
      let bi = -1;
      let bd = 25; // squared: consider points within 5 units
      for (let i = 0; i < r.pts.length; i++) {
        const q = r.pts[i];
        const dd = (q.x - end.x) * (q.x - end.x) + (q.y - end.y) * (q.y - end.y);
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      }
      if (bi >= 0) options.push({ road: r, seg: bi, dir: bi < r.pts.length / 2 ? 1 : -1 });
    }
    const pick = options.length
      ? options[(rand() * options.length) | 0]
      : { road: cart.road, seg: Math.round(cart.seg), dir: -cart.dir };
    cart.road = pick.road;
    cart.seg = pick.seg;
    cart.dir = pick.dir;
    return;
  }
  const i = Math.floor(cart.seg);
  const f = cart.seg - i;
  const a = pts[i];
  const b = pts[i + 1];
  cart.x = a.x + (b.x - a.x) * f;
  cart.y = a.y + (b.y - a.y) * f;
  // Ease the heading toward the direction of travel (never snap)
  const want = Math.atan2((b.y - a.y) * cart.dir, (b.x - a.x) * cart.dir);
  const d = Math.atan2(Math.sin(want - cart.angle), Math.cos(want - cart.angle));
  cart.angle += clamp(d, -4 * dt, 4 * dt);
}

const birds = [];
for (let flock = 0; flock < 4; flock++) {
  const fx = rand() * MAP_SIZE;
  const fy = rand() * MAP_SIZE;
  const dir = rand() * Math.PI * 2;
  const n = 3 + ((rand() * 4) | 0);
  for (let i = 0; i < n; i++) {
    birds.push({
      wx: fx + (rand() - 0.5) * 30,
      wy: fy + (rand() - 0.5) * 30,
      alt: 26 + rand() * 12,
      dir: dir + (rand() - 0.5) * 0.3,
      phase: rand() * 10,
    });
  }
}

function updateBirds(dt) {
  for (const b of birds) {
    b.dir += (rand() - 0.5) * 0.5 * dt;
    b.wx += Math.cos(b.dir) * 22 * dt;
    b.wy += Math.sin(b.dir) * 22 * dt;
    if (b.wx < -30) b.wx += MAP_SIZE + 60;
    if (b.wx > MAP_SIZE + 30) b.wx -= MAP_SIZE + 60;
    if (b.wy < -30) b.wy += MAP_SIZE + 60;
    if (b.wy > MAP_SIZE + 30) b.wy -= MAP_SIZE + 60;
  }
}

function drawBirds(camX, camY) {
  ctx.fillStyle = "#2e3138";
  for (const b of birds) {
    const x = Math.round(projX(b.wx, b.wy) - camX);
    const y = Math.round(projY(b.wx, b.wy, terrainHeight(b.wx, b.wy) + b.alt) - camY);
    if (x < -4 || x > VIEW_W + 4 || y < -4 || y > VIEW_H + 4) continue;
    if (Math.sin(worldTime * 9 + b.phase) > 0) {
      ctx.fillRect(x - 2, y - 1, 2, 1); // wings up
      ctx.fillRect(x + 1, y - 1, 2, 1);
      ctx.fillRect(x - 1, y, 1, 1);
    } else {
      ctx.fillRect(x - 2, y, 2, 1); // wings down
      ctx.fillRect(x + 1, y, 2, 1);
      ctx.fillRect(x - 1, y - 1, 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Box models: everything solid is axis-aligned boxes in local space
// (+x = forward, z = up), rotated around z and projected each frame.
// ---------------------------------------------------------------------------

const TIRE = "#33363d";
const HUB = "#a3874f";

// Styled after the old workhorse of the farmyard: dull grey-green
// bodywork riding on flint-gray running gear, a hood tapering into the
// grille, a bare pan seat between flat fenders, and a muffler halfway up
// the stack
const TRACTOR_BODY = "#5c6b4f";

const BOXES = [
  { x0: -7.0, x1: -3.4, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // frame rail, rear run
  { x0: -3.4, x1: -0.6, y0: -1.6, y1: 1.6, z0: 2.5, z1: 5.2, color: "#6e6e6e" }, // gearbox hump amidships, one higher
  { x0: -0.6, x1: 3.0, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // frame rail, front run
  { x0: -7.0, x1: -3.4, y0: -3.0, y1: 3.0, z0: 4.2, z1: 6.0, color: TRACTOR_BODY }, // body platform, rear
  { x0: -3.4, x1: -0.6, y0: -3.0, y1: 3.0, z0: 5.2, z1: 6.0, color: TRACTOR_BODY }, // body platform, thinner over the hump
  { x0: -0.6, x1: 3.0, y0: -3.0, y1: 3.0, z0: 4.2, z1: 6.0, color: TRACTOR_BODY }, // body platform, front
  { x0: -5.0, x1: -4.0, y0: -2.9, y1: 2.9, z0: 2.6, z1: 3.4, color: "#6e6e6e" }, // rear axle out to the big wheels
  { x0: 4.6, x1: 5.4, y0: -2.2, y1: 2.2, z0: 1.4, z1: 2.5, color: "#6e6e6e" }, // front axle under the engine
  { x0: 3.0, x1: 6.2, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // engine block, exposed at the sides
  { x0: 3.0, x1: 4.8, y0: -2.2, y1: 2.2, z0: 4.2, z1: 5.3, color: TRACTOR_BODY }, // hood lid, rear half
  { x0: 4.8, x1: 6.2, y0: -1.9, y1: 1.9, z0: 4.2, z1: 5.1, color: TRACTOR_BODY }, // hood lid tapering toward the front
  { x0: 6.2, x1: 7.0, y0: -1.5, y1: 1.5, z0: 2.5, z1: 4.3, color: "#454a3c" }, // nose, stepped down for a snub front
  { x0: 7.0, x1: 7.4, y0: -1.3, y1: 1.3, z0: 2.6, z1: 4.1, color: "#4a4238" }, // radiator grille
  { x0: -7.9, x1: -7.0, y0: -0.8, y1: 0.8, z0: 2.8, z1: 3.9, color: "#6b6b6b" }, // hitch block; implement drawbars butt against it
  { x0: -6.2, x1: -2.8, y0: 3.0, y1: 5.4, z0: 6.0, z1: 6.7, color: TRACTOR_BODY }, // rear fender L
  { x0: -6.2, x1: -2.8, y0: -5.4, y1: -3.0, z0: 6.0, z1: 6.7, color: TRACTOR_BODY }, // rear fender R
  { x0: -4.5, x1: -3.1, y0: -1.1, y1: 1.1, z0: 6.1, z1: 6.7, color: "#6e6e6e" }, // bare pan seat between the fenders
  { x0: -2.45, x1: -2.05, y0: -0.25, y1: 0.25, z0: 5.2, z1: 7.3, color: "#4c443c" }, // steering column off the gearbox hump
  { x0: 1.5, x1: 2.5, y0: -0.5, y1: 0.5, z0: 5.3, z1: 6.4, color: "#7a7a7a" }, // exhaust riser
  { x0: 1.3, x1: 2.7, y0: -0.7, y1: 0.7, z0: 6.4, z1: 8.2, color: "#8f8f8f" }, // muffler can
  { x0: 1.7, x1: 2.3, y0: -0.35, y1: 0.35, z0: 8.2, z1: 9.7, color: "#7a7a7a" }, // tailpipe
];

// Wheels are round: a disc on each face plus a slim inset box for the tread.
// x/z is the axle center, r the tire radius, y0..y1 the width. The rear
// pair is outsized on purpose — their tops sit level with the chassis top.
const TRACTOR_WHEELS = [
  { x: -4.5, y0: 3.0, y1: 5.3, z: 3.0, r: 3.0 }, // rear L
  { x: -4.5, y0: -5.3, y1: -3.0, z: 3.0, r: 3.0 }, // rear R
  { x: 5.0, y0: 2.3, y1: 3.9, z: 1.6, r: 1.6 }, // front L
  { x: 5.0, y0: -3.9, y1: -2.3, z: 1.6, r: 1.6 }, // front R
];

// Round details: the steering wheel ahead of the seat and two headlamps
// perched on the nose. Their depth against the body swaps naturally with
// the heading — the wheel sits in front of the driver toward the camera and
// hides behind him driving away; the far-side lamp ducks behind the hood.
const TRACTOR_SHAPES = [
  { blob: true, x: -2.2, y: 0, z: 7.5, r: 0.7, color: "#33363d" }, // steering wheel atop its column
  { blob: true, x: 6.6, y: 1.2, z: 4.65, r: 0.45, color: "#ffe66b" }, // headlamp L
  { blob: true, x: 6.6, y: -1.2, z: 4.65, r: 0.45, color: "#ffe66b" }, // headlamp R
];

// The driver: a round little figure out in the open on the seat. All parts
// stack at one local depth center (x -3.7, y 0) with rising z, so their
// paint order — overalls, head, straw hat — holds at every heading.
// `rest` is the seated height; z gets a bounce added per frame.
const DRIVER_SHAPES = [
  { blob: true, x: -3.7, y: 0, rest: 7.3, z: 7.3, r: 1.5, color: "#4a6fa5" }, // overalls
  { blob: true, x: -3.7, y: 0, rest: 8.9, z: 8.9, r: 1.0, color: "#f2c091" }, // head
  { blob: true, x: -3.7, y: 0, rest: 9.65, z: 9.65, r: 0.8, color: "#e8b13d", bias: 0.05 }, // straw hat
];

// Implements hang behind the tractor; liftable ones get a z offset from the
// hydraulic lift so they can be raised for transport and dropped to work.
const IMPLEMENT_LIFT_HEIGHT = 3.5;

const PLOW_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.2, x1: -8.8, y0: -4.6, y1: 4.6, z0: 3.4, z1: 4.6, color: "#7a3226" }, // beam
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  PLOW_BOXES.push({
    x0: -10.6, x1: -9.4, y0: yc - 0.55, y1: yc + 0.55, z0: 0.3, z1: 3.4,
    color: "#54565a", // tine
  });
}

const SEEDER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.4, x1: -8.6, y0: -4.6, y1: 4.6, z0: 3.2, z1: 4.4, color: "#8a6a3a" }, // frame
  { x0: -10.2, x1: -8.8, y0: -3.9, y1: -1.7, z0: 4.4, z1: 6.4, color: "#c9a24a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: -1.1, y1: 1.1, z0: 4.4, z1: 6.4, color: "#c9a24a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: 1.7, y1: 3.9, z0: 4.4, z1: 6.4, color: "#c9a24a" }, // hopper
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  SEEDER_BOXES.push({
    x0: -10.0, x1: -9.2, y0: yc - 0.35, y1: yc + 0.35, z0: 0.6, z1: 3.2,
    color: "#54565a", // coulter disc
  });
}

const HARVESTER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -13.0, x1: -8.6, y0: -4.8, y1: 4.8, z0: 2.2, z1: 8.0, color: "#5a7a4a" }, // body
  { x0: -12.4, x1: -11.2, y0: -4.2, y1: 4.2, z0: 8.0, z1: 9.4, color: "#3f5a38" }, // grain tank
  { x0: -8.6, x1: -7.4, y0: -4.8, y1: 4.8, z0: 0.4, z1: 2.6, color: "#7a3226" }, // header reel
];

const HARVESTER_WHEELS = [
  { x: -11.0, y0: 4.8, y1: 6.0, z: 1.8, r: 1.8 }, // wheel L
  { x: -11.0, y0: -6.0, y1: -4.8, z: 1.8, r: 1.8 }, // wheel R
];

const TRAILER_BOXES = [
  { x0: -11.5, x1: -7.0, y0: -0.7, y1: 0.7, z0: 2.6, z1: 3.6, color: "#6b6b6b" }, // long drawbar
  { x0: -21.0, x1: -11.5, y0: -4.2, y1: 4.2, z0: 3.0, z1: 7.0, color: "#9a7442" }, // wooden bed
];
// Tandem axles: two pairs of wheels under the rear half of the bed
const TRAILER_WHEELS = [];
for (const wx of [-15.2, -18.6]) {
  TRAILER_WHEELS.push(
    { x: wx, y0: 4.2, y1: 5.4, z: 1.7, r: 1.7 }, // wheel L
    { x: wx, y0: -5.4, y1: -4.2, z: 1.7, r: 1.7 } // wheel R
  );
}

// Floor slots for hay bales: one row against the front wall, one against the
// back, ordered so loading starts in the near corner and fills outward along
// that wall before starting the far row.
const BALE_POS = [];
for (const y of [-1.7, 1.7])
  for (const x of [-18.95, -16.25, -13.55]) BALE_POS.push({ x, y });
const BALE_XH = 1.15;
const BALE_YH = 1.5;
const BALE_H = 1.3;
const BALE_LAYER_GAP = 0.15;
const BALE_COLORS = ["#d8ab52", "#c89a44"]; // alternating straw tones so bales read as distinct blocks

function trailerBoxes() {
  if (cargo === 0) return TRAILER_BOXES;
  const full = cargo === TRAILER_CAP;
  const bales = [];
  for (let i = 0; i < cargo; i++) {
    const layer = Math.floor(i / BALE_POS.length);
    const p = BALE_POS[i % BALE_POS.length];
    const z0 = 7.0 + layer * (BALE_H + BALE_LAYER_GAP);
    // Full load sits a shade brighter so it reads as "done" without flashing
    const color = full ? "#f2c46a" : BALE_COLORS[i % BALE_COLORS.length];
    bales.push({
      x0: p.x - BALE_XH, x1: p.x + BALE_XH,
      y0: p.y - BALE_YH, y1: p.y + BALE_YH,
      z0, z1: z0 + BALE_H,
      color,
    });
  }
  return TRAILER_BOXES.concat(bales);
}

// Mounted implements (3-point hitch) turn rigidly with the tractor; towed
// ones ride on their own wheels and pivot at the drawbar pin.
const IMPLEMENTS = {
  plow: { label: "PLOW", liftable: true, boxes: () => PLOW_BOXES, wheels: [] },
  seeder: { label: "SEEDER", liftable: true, boxes: () => SEEDER_BOXES, wheels: [] },
  harvester: { label: "HARVESTER", liftable: true, towed: true, towLength: 4.5, boxes: () => HARVESTER_BOXES, wheels: HARVESTER_WHEELS },
  trailer: { label: "TRAILER", liftable: false, towed: true, towLength: 9.9, boxes: trailerBoxes, wheels: TRAILER_WHEELS },
};

// Farm buildings, local to FARM
// A straight post-and-rail run from (x0,y0) to (x1,y1) — axis-aligned only
// (either x0===x1 or y0===y1), which is all the farmyard's fence lines need.
// Posts every ~3 units; rails are built as one short segment per post
// interval rather than a single box spanning the whole run. Each box's
// world height comes from sampling terrainHeight at its own corners (see
// makeItems' local()), so a single long rail box only samples the run's
// two far ends and draws a dead-straight line between them — over a long
// run on real (unflattened) ground that visibly mismatches the posts,
// which each follow their own local terrain, making the fence look like
// it randomly changes height wherever the two disagree. Short segments
// keep the rail sampling the ground about as often as the posts do, so
// it actually hugs the same contour instead of floating over or sinking
// into it between them.
function addFenceRun(boxes, x0, y0, x1, y1, color) {
  const horizontal = y0 === y1;
  const len = horizontal ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
  const n = Math.max(1, Math.round(len / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    boxes.push({ x0: px - 0.3, x1: px + 0.3, y0: py - 0.3, y1: py + 0.3, z0: 0, z1: 2.6, color });
  }
  for (const [rz0, rz1] of [[1.1, 1.4], [2.0, 2.3]]) {
    for (let i = 0; i < n; i++) {
      const sx0 = x0 + (x1 - x0) * (i / n);
      const sy0 = y0 + (y1 - y0) * (i / n);
      const sx1 = x0 + (x1 - x0) * ((i + 1) / n);
      const sy1 = y0 + (y1 - y0) * ((i + 1) / n);
      boxes.push(
        horizontal
          ? { x0: Math.min(sx0, sx1), x1: Math.max(sx0, sx1), y0: y0 - 0.15, y1: y0 + 0.15, z0: rz0, z1: rz1, color }
          : { x0: x0 - 0.15, x1: x0 + 0.15, y0: Math.min(sy0, sy1), y1: Math.max(sy0, sy1), z0: rz0, z1: rz1, color }
      );
    }
  }
}

// A pitched roof over a wall footprint, built from two stacked tiers — a
// chunky eave course sized just like a plain flat roof, and a narrower
// ridge course riding on top of it. Two tiers rather than a finer taper
// (an earlier version used three, shrinking to a sliver at the top) reads
// as a proper roof at this game's scale; more/thinner tiers just blur
// into an odd lumpy silhouette instead of a crisp ridge line.
// `ridgeAxis` is the axis the ridge runs along (stays at the wall's own
// span, plus overhang); the other axis is the one that steps in for the
// ridge course.
function addGableRoof(boxes, x0, x1, y0, y1, z0, z1, ridgeAxis, color, overhang) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const wallHalfX = (x1 - x0) / 2;
  const wallHalfY = (y1 - y0) / 2;
  const midZ = z0 + (z1 - z0) * 0.55;
  const tiers = [
    { f: 1.0, eave: overhang, tz0: z0, tz1: midZ }, // eave course, same footprint a flat roof would have
    { f: 0.4, eave: 0, tz0: midZ, tz1: z1 }, // ridge course
  ];
  for (const { f, eave, tz0, tz1 } of tiers) {
    if (ridgeAxis === "x") {
      const crossHalf = wallHalfY * f + eave;
      boxes.push({ x0: x0 - overhang, x1: x1 + overhang, y0: cy - crossHalf, y1: cy + crossHalf, z0: tz0, z1: tz1, color });
    } else {
      const crossHalf = wallHalfX * f + eave;
      boxes.push({ x0: cx - crossHalf, x1: cx + crossHalf, y0: y0 - overhang, y1: y1 + overhang, z0: tz0, z1: tz1, color });
    }
  }
}

const FARM_BOXES = [
  { x0: -16.0, x1: 2.0, y0: -12.0, y1: 2.0, z0: 0.0, z1: 9.0, color: "#3d332a" }, // barn, tarred weatherboard
  { x0: -7.5, x1: -3.5, y0: 1.9, y1: 2.3, z0: 0.0, z1: 6.0, color: "#f7e8d8" }, // barn door, whitewashed
  // Farmhouse: pulled in close behind its own garden wall (below) rather
  // than set off across open grass — the wall marks house-from-yard, not
  // raw distance, so the whole place still reads as one farmstead.
  { x0: -13.0, x1: 1.0, y0: -30.0, y1: -16.0, z0: 0.0, z1: 7.0, color: "#9c6b52" }, // farmhouse walls, brick
  { x0: -6.8, x1: -5.3, y0: -29.0, y1: -27.5, z0: 8.5, z1: 13.0, color: "#7a5040" }, // chimney stack
  { x0: -7.0, x1: -5.0, y0: -16.1, y1: -15.7, z0: 0.0, z1: 4.5, color: "#4a3626" }, // farmhouse door
  { x0: -12.0, x1: -10.5, y0: -16.1, y1: -15.7, z0: 2.5, z1: 4.5, color: "#a8c2c9" }, // window
  { x0: -1.5, x1: 0.0, y0: -16.1, y1: -15.7, z0: 2.5, z1: 4.5, color: "#a8c2c9" }, // window
  // Well: stone-lined shaft with a wooden crossbeam and winding roof, in
  // the farmhouse's own garden a few steps from the door — domestic
  // water, kept apart from the stock down in the working yard.
  { x0: -20.0, x1: -16.0, y0: -19.0, y1: -15.0, z0: 0.0, z1: 2.2, color: "#8a8578" }, // well shaft, stone
  { x0: -19.6, x1: -19.0, y0: -18.8, y1: -18.2, z0: 2.2, z1: 6.0, color: "#6b5a42" }, // well post
  { x0: -17.0, x1: -16.4, y0: -15.8, y1: -15.2, z0: 2.2, z1: 6.0, color: "#6b5a42" }, // well post
  { x0: -20.4, x1: -15.6, y0: -19.4, y1: -14.6, z0: 6.0, z1: 7.0, color: "#5c4530" }, // well roof
  { x0: -19.6, x1: -16.4, y0: -17.2, y1: -16.8, z0: 5.6, z1: 6.0, color: "#6b5a42" }, // well crossbeam
  // Hen house: a small whitewashed coop tucked into the working yard's
  // near corner, right by the barn, where the chickens already scratch.
  { x0: -9.0, x1: -4.0, y0: 6.0, y1: 11.0, z0: 0.0, z1: 3.0, color: "#c9b28f" }, // hen house, whitewashed weatherboard
  { x0: -7.0, x1: -6.0, y0: 5.9, y1: 6.1, z0: 0.0, z1: 1.3, color: "#3d332a" }, // pop-hole
  // Granary: on staddle legs as before, closing the yard's north side.
  // Clear of the barn's own roofline, with a cart-width gap on to the
  // cartshed (below) that doubles as the yard's working gate.
  { x0: 6.5, x1: 7.5, y0: -12.5, y1: -11.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 13.5, x1: 14.5, y0: -12.5, y1: -11.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 6.5, x1: 7.5, y0: -5.5, y1: -4.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 13.5, x1: 14.5, y0: -5.5, y1: -4.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 6.0, x1: 15.0, y0: -13.0, y1: -4.0, z0: 1.6, z1: 6.6, color: "#9c7a52" }, // granary body
  // Cartshed: open-fronted, closing the yard's east side — an everyday
  // pole shed for carts and tackle, its whole west face left open onto
  // the yard instead of walled off. Set well out from the barn (below) so
  // there's real room to swing a tractor and implement between the two.
  { x0: 31.7, x1: 32.3, y0: -2.5, y1: -1.9, z0: 0.0, z1: 5.5, color: "#3a2e22" }, // open-front post
  { x0: 31.7, x1: 32.3, y0: 8.1, y1: 8.7, z0: 0.0, z1: 5.5, color: "#3a2e22" }, // open-front post
  { x0: 40.0, x1: 42.0, y0: -3.0, y1: 9.0, z0: 0.0, z1: 5.5, color: "#4a3a2c" }, // cartshed back wall
  { x0: 32.0, x1: 42.0, y0: -3.0, y1: -1.0, z0: 0.0, z1: 5.5, color: "#4a3a2c" }, // cartshed side wall
  { x0: 32.0, x1: 42.0, y0: 7.0, y1: 9.0, z0: 0.0, z1: 5.5, color: "#4a3a2c" }, // cartshed side wall
  // Cowshed: closes the yard's south side, set well down the yard from the
  // barn for the same reason — a plain byre for the house cow, nothing as
  // grand as the barn.
  { x0: -2.0, x1: 10.0, y0: 32.0, y1: 39.0, z0: 0.0, z1: 4.0, color: "#6b5a42" }, // cowshed walls, weatherboard
  { x0: 3.0, x1: 5.0, y0: 31.9, y1: 32.3, z0: 0.0, z1: 3.0, color: "#3d332a" }, // cowshed door
  // Hay rick: a thatched straw stack on stone staddles (its round tapering
  // bulk is built from stacked blobs in FARM_SHAPES, same trick as a tree
  // canopy), tucked past the cartshed in its own small rickyard, backed by
  // a short fence on its two field-facing sides for fire safety.
  { x0: 29.4, x1: 30.2, y0: 14.4, y1: 15.2, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 33.8, x1: 34.6, y0: 14.4, y1: 15.2, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 29.4, x1: 30.2, y0: 18.8, y1: 19.6, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 33.8, x1: 34.6, y0: 18.8, y1: 19.6, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 29.0, x1: 35.0, y0: 14.0, y1: 20.0, z0: 1.4, z1: 2.0, color: "#c9a24a" }, // staging platform
  // Fuel tank: a horizontal cylinder lying along the local y axis, built
  // the same way the tractor's own wheels are (an inscribed box for the
  // silhouette plus a full-radius disc at each end, see FARM_SHAPES) —
  // a true round profile rather than a boxy body with sphere caps.
  {
    x0: FUEL_TANK_LOCAL.x - FUEL_TANK_R * 0.6, x1: FUEL_TANK_LOCAL.x + FUEL_TANK_R * 0.6,
    y0: FUEL_TANK_LOCAL.y - FUEL_TANK_LEN + 0.3, y1: FUEL_TANK_LOCAL.y - FUEL_TANK_LEN + 0.8,
    z0: 0.0, z1: FUEL_TANK_STAND_H, color: "#5a5a5a",
  }, // near leg
  {
    x0: FUEL_TANK_LOCAL.x - FUEL_TANK_R * 0.6, x1: FUEL_TANK_LOCAL.x + FUEL_TANK_R * 0.6,
    y0: FUEL_TANK_LOCAL.y + FUEL_TANK_LEN - 0.8, y1: FUEL_TANK_LOCAL.y + FUEL_TANK_LEN - 0.3,
    z0: 0.0, z1: FUEL_TANK_STAND_H, color: "#5a5a5a",
  }, // far leg
  {
    x0: FUEL_TANK_LOCAL.x - FUEL_TANK_R * 0.72, x1: FUEL_TANK_LOCAL.x + FUEL_TANK_R * 0.72,
    y0: FUEL_TANK_LOCAL.y - FUEL_TANK_LEN, y1: FUEL_TANK_LOCAL.y + FUEL_TANK_LEN,
    z0: FUEL_TANK_STAND_H, z1: FUEL_TANK_STAND_H + FUEL_TANK_R * 1.44,
    color: "#3a4a3a",
  }, // tank body, riveted iron green
  {
    x0: FUEL_TANK_LOCAL.x - 0.3, x1: FUEL_TANK_LOCAL.x + 0.3,
    y0: FUEL_TANK_LOCAL.y - 0.3, y1: FUEL_TANK_LOCAL.y + 0.3,
    z0: FUEL_TANK_STAND_H - 0.8, z1: FUEL_TANK_STAND_H,
    color: "#3a3a3a",
  }, // valve hanging below the tank's midpoint
];
// Garden wall: the farmhouse's one boundary fence, the line between the
// house and the working yard below it.
addFenceRun(FARM_BOXES, -13, -14, 2, -14, "#6b5a42");
// Rickyard fence: backs the hay rick's two field-facing sides only (an
// unbroken ring risks a rail sitting across a road on some maps, and this
// is plenty to read as "fenced off from the stock")
addFenceRun(FARM_BOXES, 27, 12, 38, 12, "#6b5a42");
addFenceRun(FARM_BOXES, 27, 12, 27, 23, "#6b5a42");

// Gabled roofs — pitched, tapering tiers rather than flat slabs, one call
// per building (see addGableRoof above). Ridge axis runs the long way.
// Roofing material varies by building the way a real farmstead's would:
// the house gets the good clay tile, the barn got re-roofed in Welsh
// slate once the railway made it affordable, the lesser outbuildings make
// do with cheap corrugated iron or the barn's old plain tile.
addGableRoof(FARM_BOXES, -16.0, 2.0, -12.0, 2.0, 9.0, 12.0, "x", "#4f5a5e", 1.5); // barn, slate
addGableRoof(FARM_BOXES, -13.0, 1.0, -30.0, -16.0, 7.0, 10.0, "x", "#a8543a", 1.0); // farmhouse, terracotta clay tile
addGableRoof(FARM_BOXES, -9.0, -4.0, 6.0, 11.0, 3.0, 4.4, "x", "#8a929a", 0.6); // hen house, corrugated iron
addGableRoof(FARM_BOXES, 6.0, 15.0, -13.0, -4.0, 6.6, 9.2, "x", "#8a4a34", 0.7); // granary, aged clay tile
addGableRoof(FARM_BOXES, 32.0, 42.0, -3.0, 9.0, 5.5, 7.7, "y", "#8a929a", 1.0); // cartshed, corrugated iron
addGableRoof(FARM_BOXES, -2.0, 10.0, 32.0, 39.0, 4.0, 5.6, "x", "#5c4530", 0.6); // cowshed, plain tile

// Paddock fences and the pig sty: kept in their own array rather than
// pushed into FARM_BOXES, because they now sit far enough out (the
// pastures were pushed well past the yard, see PADDOCKS_LOCAL) that the
// shared farm-model depth base — which stamps every FARM_BOXES item with
// the farm CENTER's terrain height, not its own — drifts enough at this
// distance to sort behind/in front of nearby grazing animals wrong. Drawn
// with a per-box depth override in drawScene (search PADDOCK_BOXES there)
// using each box's own true ground position instead, the same convention
// animals/bushes/signs already use, so the two compare on equal terms.
const PADDOCK_BOXES = [];
// Pig sty: a low lean-to shelter tucked in the pig paddock's near corner,
// out past the yard — kept low and plain, the humblest building here.
// Positioned relative to PADDOCKS_LOCAL.pig (not fixed coordinates) since
// which candidate placement won is only known once makeMap() has run.
const STY = (() => {
  const p = PADDOCKS_LOCAL.pig;
  const x0 = p.x0 + 1, x1 = x0 + 4, y0 = p.y0 + 1, y1 = y0 + 3.5;
  return { x0, x1, y0, y1 };
})();
PADDOCK_BOXES.push(
  { x0: STY.x0, x1: STY.x1, y0: STY.y0, y1: STY.y1, z0: 0.0, z1: 2.2, color: "#8a7355" }, // sty walls, plain boarding
  {
    x0: (STY.x0 + STY.x1) / 2 - 0.6, x1: (STY.x0 + STY.x1) / 2 + 0.6,
    y0: STY.y1 - 0.1, y1: STY.y1 + 0.3, z0: 0.0, z1: 1.5, color: "#3d332a",
  } // sty doorway
);
addGableRoof(PADDOCK_BOXES, STY.x0, STY.x1, STY.y0, STY.y1, 2.2, 3.1, "x", "#8a929a", 0.5); // sty roof, corrugated iron
// Cow and pig paddock fences: always a full, unbroken ring — no gate gaps
// (an open fence reads as unfenced, which defeats the point). Road/water
// clashes are avoided by *placement* instead, via the candidate search
// right after makeMap() above; this just draws whichever rect it picked.
for (const p of Object.values(PADDOCKS_LOCAL)) {
  addFenceRun(PADDOCK_BOXES, p.x0, p.y0, p.x1, p.y0, "#6b5a42"); // north rail
  addFenceRun(PADDOCK_BOXES, p.x0, p.y1, p.x1, p.y1, "#6b5a42"); // south rail
  addFenceRun(PADDOCK_BOXES, p.x0, p.y0, p.x0, p.y1, "#6b5a42"); // west rail
  addFenceRun(PADDOCK_BOXES, p.x1, p.y0, p.x1, p.y1, "#6b5a42"); // east rail
}

// The two end-cap discs that round off the fuel tank's cylinder (same
// box+disc trick as makeWheels: the disc facing the camera reads as the
// tank's round end, the box gives its silhouette everywhere else), the
// well's hanging bucket, the yard's muck midden, and the hay rick's
// tapering thatched bulk (the same stacked-blob trick a tree canopy uses,
// just wider and golden)
const FARM_SHAPES = [
  { blob: true, x: -18.0, y: -17.0, z: 4.0, r: 0.7, color: "#4a4238" }, // well bucket
  { blob: true, x: 16.0, y: 17.0, z: 0.9, r: 2.0, color: "#3a2e22" }, // muck midden
  { blob: true, x: 32.0, y: 17.0, z: 4.0, r: 4.2, color: "#d9b355" }, // rick, main bulk
  { blob: true, x: 32.0, y: 17.0, z: 6.5, r: 3.0, color: "#cfa64a" }, // rick, tapering
  { blob: true, x: 32.0, y: 17.0, z: 8.3, r: 1.8, color: "#c49a3f" }, // rick, tapering
  { blob: true, x: 32.0, y: 17.0, z: 9.4, r: 0.8, color: "#b98f38" }, // rick, thatched cap
];
for (const [ly, n] of [
  [FUEL_TANK_LOCAL.y - FUEL_TANK_LEN, -1],
  [FUEL_TANK_LOCAL.y + FUEL_TANK_LEN, 1],
]) {
  const z = FUEL_TANK_STAND_H + FUEL_TANK_R * 0.72;
  FARM_SHAPES.push(
    { disc: true, x: FUEL_TANK_LOCAL.x, y: ly, z, r: FUEL_TANK_R, n, color: "#3a4a3a" },
    { disc: true, x: FUEL_TANK_LOCAL.x, y: ly, z, r: FUEL_TANK_R * 0.6, n, color: "#28352a", bias: 0.06 }
  );
}

// Buildings block the tractor the same way trees and animals do (see the
// collision check in update()). Only the load-bearing walls/body of each
// building — not roofs, doors, fences or small fixtures — so a door-sized
// gap in a wall box doesn't itself read as solid, and the cartshed's open
// west face (it has no wall box there) stays driveable. Local coordinates,
// turned into world-space boxes once here — FARM.angle only ever lands on
// a 90° step, so this stays a true axis-aligned box in world space too.
const FARM_SOLID_LOCAL = [
  ...FARM_BUILDING_FOOTPRINTS,
  [STY.x0, STY.x1, STY.y0, STY.y1], // pig sty
];
// A rotated local rectangle's corners no longer line up with the world axes
// unless FARM.angle is a 90° step (which it always is), so the world-space
// AABB is just the min/max of all 4 rotated corners.
function localRectToFarmWorldAABB([x0, x1, y0, y1]) {
  let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
  for (const lx of [x0, x1])
    for (const ly of [y0, y1]) {
      const { x: wx, y: wy } = rotateLocal(FARM.x, FARM.y, FARM.angle, lx, ly);
      wx0 = Math.min(wx0, wx); wx1 = Math.max(wx1, wx);
      wy0 = Math.min(wy0, wy); wy1 = Math.max(wy1, wy);
    }
  return { x0: wx0, x1: wx1, y0: wy0, y1: wy1 };
}
const FARM_SOLID_WORLD = FARM_SOLID_LOCAL.map(localRectToFarmWorldAABB);

// Paddock fence rings, as thin collision strips (unlike FARM_SOLID_WORLD's
// buildings, which are solid clean through, a paddock's rectangle is open
// pasture — only the fence line itself should stop the tractor). Always a
// full unbroken ring, matching the visual fence — no gate gaps, same
// reasoning as there. Four strips per paddock, one along each rail, each
// half FENCE_COLLIDE_HALF thick either side of the line.
const FENCE_COLLIDE_HALF = 0.9;
const FENCE_SOLID_LOCAL = [];
for (const p of Object.values(PADDOCKS_LOCAL)) {
  FENCE_SOLID_LOCAL.push(
    [p.x0, p.x1, p.y0 - FENCE_COLLIDE_HALF, p.y0 + FENCE_COLLIDE_HALF], // north rail
    [p.x0, p.x1, p.y1 - FENCE_COLLIDE_HALF, p.y1 + FENCE_COLLIDE_HALF], // south rail
    [p.x0 - FENCE_COLLIDE_HALF, p.x0 + FENCE_COLLIDE_HALF, p.y0, p.y1], // west rail
    [p.x1 - FENCE_COLLIDE_HALF, p.x1 + FENCE_COLLIDE_HALF, p.y0, p.y1] // east rail
  );
}
const FENCE_SOLID_WORLD = FENCE_SOLID_LOCAL.map(localRectToFarmWorldAABB);

// City buildings, local to CITY: a small trading depot where the grain
// actually gets sold. No need for FARM's elaborate trampled yard — the
// depot just needs to read clearly from a distance as a destination.
const CITY_BOXES = [
  { x0: -14.0, x1: 6.0, y0: -9.0, y1: 5.0, z0: 0.0, z1: 8.0, color: "#8a7a68" }, // warehouse
  { x0: -15.5, x1: 7.5, y0: -10.5, y1: 6.5, z0: 8.0, z1: 10.5, color: "#4a3f34" }, // warehouse roof
  { x0: -7.0, x1: -3.0, y0: 4.6, y1: 5.0, z0: 0.0, z1: 6.0, color: "#f7e8d8" }, // loading door
  { x0: 10.0, x1: 20.0, y0: -6.0, y1: 4.0, z0: 0.0, z1: 12.0, color: "#c9b896" }, // office block
  { x0: 9.0, x1: 21.0, y0: -7.0, y1: 5.0, z0: 12.0, z1: 14.0, color: "#6b5a44" }, // office roof
];
const CITY_SHAPES = [
  { blob: true, x: 15.0, y: -1.0, z: 15.5, r: 2.4, color: "#8a4438" }, // roof accent
];

// Grain sacks dropped by the harvester: plump blobs with a tied-off top
const SACK_SHAPES = [
  { blob: true, x: 0, y: 0, z: 1.5, r: 1.6, color: "#f0cf5e" },
  { blob: true, x: 0, y: 0, z: 3.1, r: 0.7, color: "#d9b446", bias: 0.05 },
];

// Faces of a unit box; corner index = xi*4 + yi*2 + zi. Windings are chosen
// so a face's projected signed area is positive exactly when it faces the
// camera, which doubles as backface culling.
const FACES = [
  { n: [0, 0, 1], i: [1, 5, 7, 3] }, // top
  { n: [1, 0, 0], i: [4, 6, 7, 5] },
  { n: [-1, 0, 0], i: [2, 0, 1, 3] },
  { n: [0, 1, 0], i: [6, 2, 3, 7] },
  { n: [0, -1, 0], i: [0, 4, 5, 1] },
];

// Backface test on the UNROUNDED projection (fx/fy): for small thin boxes,
// pixel rounding can flip a near-edge-on face's sign from frame to frame
// while the model moves, making faces pop in and out
function signedArea4(p0, p1, p2, p3) {
  return (
    p0.fx * p1.fy - p1.fx * p0.fy +
    p1.fx * p2.fy - p2.fx * p1.fy +
    p2.fx * p3.fy - p3.fx * p2.fy +
    p3.fx * p0.fy - p0.fx * p3.fy
  );
}

// ---------------------------------------------------------------------------
// Scene rendering: all box sets (tractor, implement, farm, sacks) go into one
// list and are painter-sorted together so occlusion works between them.
// ---------------------------------------------------------------------------

// Each point rides at terrain height under its own footprint, which drapes
// models over slopes so they visibly pitch and roll on hills. Sort depths,
// however, use the terrain height at the model's origin for every box: on a
// steep slope falling away from the camera, per-footprint heights nearly
// cancel the depth differences between a model's parts, and the resulting
// near-ties flip per frame and flicker.
function makeItems(items, boxes, ox, oy, angle, liftZ, camX, camY, baseDepth) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Model-level depth: callers of moving models can pass a smoothed value so
  // frame-to-frame jitter can't flip the draw order against neighbors
  const M = baseDepth !== undefined ? baseDepth : ox + oy + terrainHeight(ox, oy);
  const local = (lx, ly, lz) => {
    const p = rotateXY(cos, sin, lx, ly);
    const wx = ox + p.x;
    const wy = oy + p.y;
    const wz = lz + terrainHeight(wx, wy);
    const fx = projX(wx, wy) - camX;
    const fy = projY(wx, wy, wz) - camY;
    return { x: Math.round(fx), y: Math.round(fy), fx, fy };
  };
  for (const box of boxes) {
    const pts = [];
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++)
          pts.push(
            local(
              xi ? box.x1 : box.x0,
              yi ? box.y1 : box.y0,
              (zi ? box.z1 : box.z0) + liftZ
            )
          );
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const rel = cx * cos - cy * sin + cx * sin + cy * cos;
    const depth = M + rel + (box.z0 + box.z1) / 2 + liftZ;
    items.push({ box, pts, depth, cos, sin });
  }
}

// Round shapes: discs are circles in the local x-z plane (wheel faces),
// blobs are soft spheres drawn as shaded ellipses (canopies, sacks, domes).
function makeRoundItems(items, shapes, ox, oy, angle, liftZ, camX, camY, baseDepth) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const M = baseDepth !== undefined ? baseDepth : ox + oy + terrainHeight(ox, oy);
  const project = (lx, ly, lz) => {
    const p = rotateXY(cos, sin, lx, ly);
    const wx = ox + p.x;
    const wy = oy + p.y;
    const wz = lz + terrainHeight(wx, wy);
    return {
      x: Math.round(projX(wx, wy) - camX),
      y: Math.round(projY(wx, wy, wz) - camY),
    };
  };
  for (const s of shapes) {
    const c = project(s.x, s.y, s.z + liftZ);
    // Depth from the shared model base, like makeItems
    const rel = s.x * cos - s.y * sin + s.x * sin + s.y * cos;
    const depth = M + rel + s.z + liftZ + (s.bias || 0);
    if (s.disc) {
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        pts.push(project(s.x + Math.cos(a) * s.r, s.y, s.z + liftZ + Math.sin(a) * s.r));
      }
      // Lit like a box's side face: normal is the rotated local y axis
      const d = -s.n * sin * LIGHT.x + s.n * cos * LIGHT.y;
      const k = Math.min(1, Math.max(0.3, 0.3 + d));
      items.push({ poly: pts, color: s.color, k, depth });
    } else {
      items.push({
        blob: c,
        rx: s.r * 1.4,
        ry: s.r * 1.2,
        color: s.color,
        k: Math.min(1, 0.35 + LIGHT.z),
        depth,
      });
    }
  }
}

// A wheel is a slim tread box plus a tire disc and hubcap on each face. The
// disc on the camera side always projects nearer than the box center, so the
// painter's sort shows the round face; edge-on, the box gives the silhouette.
function makeWheels(items, wheels, ox, oy, angle, liftZ, camX, camY) {
  const boxes = [];
  const shapes = [];
  for (const w of wheels) {
    boxes.push({
      x0: w.x - w.r * 0.72, x1: w.x + w.r * 0.72,
      y0: w.y0, y1: w.y1,
      z0: w.z - w.r * 0.72, z1: w.z + w.r * 0.72,
      color: TIRE,
    });
    for (const [ly, n] of [[w.y0, -1], [w.y1, 1]]) {
      shapes.push({ disc: true, x: w.x, y: ly, z: w.z, r: w.r, n, color: TIRE });
      shapes.push({ disc: true, x: w.x, y: ly, z: w.z, r: w.r * 0.45, n, color: HUB, bias: 0.06 });
    }
  }
  makeItems(items, boxes, ox, oy, angle, liftZ, camX, camY);
  makeRoundItems(items, shapes, ox, oy, angle, liftZ, camX, camY);
}

// Coarse visibility test for scattered scenery (trees, bushes, sacks)
function onScreen(wx, wy, camX, camY) {
  const x = projX(wx, wy) - camX;
  const y = projY(wx, wy, 0) - camY;
  return x > -40 && x < VIEW_W + 40 && y > -80 && y < VIEW_H + 80;
}

// Scene models render onto their own transparent canvas so an ink pass can
// outline them: the canvas alpha stamped at the four cardinal offsets, minus
// the scene itself, is exactly a one-pixel line around every silhouette.
// Overlapping models merge into one inked shape, so no line ever cuts
// through a correct occlusion, and the draw order stays untouched.
const sceneCanvas = document.createElement("canvas");
sceneCanvas.width = VIEW_W;
sceneCanvas.height = VIEW_H;
const sceneCtx = sceneCanvas.getContext("2d");

const inkCanvas = document.createElement("canvas");
inkCanvas.width = VIEW_W;
inkCanvas.height = VIEW_H;
const inkCtx = inkCanvas.getContext("2d");

function drawScene(camX, camY) {
  const pose = implementPose();

  // Ground shadows: one quad under the tractor, one under the implement
  // (they part ways when a towed implement swings out of line)
  const shadowQuad = (ox, oy, angle, x0, x1, hw) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const shPt = (lx, ly) => {
      const p = rotateXY(cos, sin, lx, ly);
      const wx = ox + p.x;
      const wy = oy + p.y;
      return {
        x: Math.round(projX(wx, wy) - camX),
        y: Math.round(projY(wx, wy, terrainHeight(wx, wy)) - camY),
      };
    };
    const a = shPt(x0, -hw);
    const b = shPt(x1, -hw);
    const c = shPt(x1, hw);
    const d = shPt(x0, hw);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  // One path for both quads so their overlap at the hitch doesn't darken
  const imp = IMPLEMENTS[tractor.implement];
  const impBoxes = imp.boxes();
  const impRear = Math.min(...impBoxes.map((b) => b.x0)) - 0.5;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  shadowQuad(tractor.x, tractor.y, tractor.angle, -6, 8.5, 5.5);
  shadowQuad(pose.x, pose.y, pose.angle, impRear, -6.5, 6);
  if (cart.on && onScreen(cart.x, cart.y, camX, camY))
    shadowQuad(cart.x, cart.y, cart.angle, -6, 6.9, 2.2);
  for (const t of trees) {
    if (!onScreen(t.wx, t.wy, camX, camY)) continue;
    const sx = Math.round(projX(t.wx, t.wy) - camX);
    const sy = Math.round(projY(t.wx, t.wy, terrainHeight(t.wx, t.wy)) - camY);
    ctx.moveTo(sx + 6, sy);
    ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2);
  }
  for (const b of bushes) {
    if (!onScreen(b.wx, b.wy, camX, camY)) continue;
    const sx = Math.round(projX(b.wx, b.wy) - camX);
    const sy = Math.round(projY(b.wx, b.wy, terrainHeight(b.wx, b.wy)) - camY);
    ctx.moveTo(sx + b.r * 1.6, sy);
    ctx.ellipse(sx, sy, b.r * 1.6, b.r * 0.8, 0, 0, Math.PI * 2);
  }
  for (const a of animals) {
    if (!onScreen(a.wx, a.wy, camX, camY)) continue;
    const sx = Math.round(projX(a.wx, a.wy) - camX);
    const sy = Math.round(projY(a.wx, a.wy, terrainHeight(a.wx, a.wy)) - camY);
    const r = ANIMAL_SPECS[a.species].shadow;
    ctx.moveTo(sx + r, sy);
    ctx.ellipse(sx, sy, r, r / 2, 0, 0, Math.PI * 2);
  }
  for (const s of signs) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    const sx = Math.round(projX(s.wx, s.wy) - camX);
    const sy = Math.round(projY(s.wx, s.wy, terrainHeight(s.wx, s.wy)) - camY);
    ctx.moveTo(sx + 3, sy);
    ctx.ellipse(sx, sy, 3, 1.5, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Painter's algorithm: depth along the view axis is wx + wy + wz.
  const items = [];
  const liftZ = imp.liftable ? tractor.implLift * IMPLEMENT_LIFT_HEIGHT : 0;
  makeItems(items, BOXES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeWheels(items, TRACTOR_WHEELS, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeRoundItems(items, TRACTOR_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  // The driver bounces gently in the seat while rolling; the whole stack
  // shares one offset so its internal ordering never changes
  const bob = Math.abs(tractor.speed) > ROLLING_THRESHOLD ? Math.sin(worldTime * 11) * 0.22 : 0;
  for (const s of DRIVER_SHAPES) s.z = s.rest + bob;
  makeRoundItems(items, DRIVER_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeItems(items, impBoxes, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeWheels(items, imp.wheels, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeItems(items, FARM_BOXES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  makeRoundItems(items, FARM_SHAPES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  // Paddock fences and the pig sty get a per-box depth override using
  // their own true world position (same "+2.5" ground convention as
  // animals/bushes/signs below) instead of the farm-wide model depth
  // makeItems just gave them — see the PADDOCK_BOXES comment for why.
  {
    const start = items.length;
    makeItems(items, PADDOCK_BOXES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
    for (let i = start; i < items.length; i++) {
      const b = items[i].box;
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      const { x: wx, y: wy } = rotateLocal(FARM.x, FARM.y, FARM.angle, cx, cy);
      items[i].depth = wx + wy + terrainHeight(wx, wy) + 2.5;
    }
  }
  makeItems(items, CITY_BOXES, CITY.x, CITY.y, CITY.angle, 0, camX, camY);
  makeRoundItems(items, CITY_SHAPES, CITY.x, CITY.y, CITY.angle, 0, camX, camY);
  if (cart.on && onScreen(cart.x, cart.y, camX, camY)) {
    makeItems(items, CART_BOXES, cart.x, cart.y, cart.angle, 0, camX, camY);
    makeWheels(items, CART_WHEELS, cart.x, cart.y, cart.angle, 0, camX, camY);
    makeRoundItems(items, CART_DRIVER, cart.x, cart.y, cart.angle, 0, camX, camY);
  }
  for (const t of trees) {
    if (!onScreen(t.wx, t.wy, camX, camY)) continue;
    const kind = TREE_KINDS[t.kind];
    makeItems(items, kind.boxes, t.wx, t.wy, t.angle, 0, camX, camY);
    makeRoundItems(items, kind.blobs, t.wx, t.wy, t.angle, 0, camX, camY);
  }
  for (const b of bushes) {
    if (!onScreen(b.wx, b.wy, camX, camY)) continue;
    b.shapes[0].color = seasonHex(b.seasonColors);
    makeRoundItems(items, b.shapes, b.wx, b.wy, 0, 0, camX, camY);
    // Anchor the bush to the same ground-based depth formula the animals
    // use, so an animal grazing past swaps order exactly where the ground
    // positions cross — anywhere else and the swap visibly pops
    items[items.length - 1].depth = b.wx + b.wy + terrainHeight(b.wx, b.wy) + 2.5;
  }
  for (const a of animals) {
    if (!onScreen(a.wx, a.wy, camX, camY)) continue;
    // Smooth the animal's base depth so its wandering can't jitter the draw
    // order against herd-mates standing at nearly the same depth
    const target = a.wx + a.wy + terrainHeight(a.wx, a.wy) + a.tie;
    // Hysteresis follower: the sort depth trails the true depth a little and
    // holds still while the animal wanders inside the band, so per-frame
    // jitter can't flip the draw order against neighbors
    if (a.sd === undefined) {
      a.sd = target;
    } else {
      const diff = target - a.sd;
      if (Math.abs(diff) > 0.75) a.sd = target - Math.sign(diff) * 0.75;
    }
    // One unit, fixed internal paint order: overwrite the parts' depths with
    // strictly increasing values around the smoothed base, so the global
    // sort can never reorder them (see COW_BOXES)
    const start = items.length;
    if (a.species === "sheep") {
      makeRoundItems(items, SHEEP_SHAPES, a.wx, a.wy, a.angle, 0, camX, camY);
      makeItems(items, SHEEP_BOXES, a.wx, a.wy, a.angle, 0, camX, camY);
    } else {
      makeItems(items, ANIMAL_BOXES[a.species], a.wx, a.wy, a.angle, 0, camX, camY);
    }
    for (let i = start; i < items.length; i++) {
      items[i].depth = a.sd + 2.5 + (i - start) * 1e-4;
    }
  }
  for (const s of sacks) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    makeRoundItems(items, SACK_SHAPES, s.wx, s.wy, 0, 0, camX, camY);
  }
  for (const s of signs) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    items.push({
      sign: s,
      x: Math.round(projX(s.wx, s.wy) - camX),
      y: Math.round(projY(s.wx, s.wy, terrainHeight(s.wx, s.wy)) - camY),
      // Same ground-based depth convention as the bushes and animals
      depth: s.wx + s.wy + terrainHeight(s.wx, s.wy) + 2.5,
    });
  }
  items.sort((a, b) => a.depth - b.depth);

  sceneCtx.clearRect(0, 0, VIEW_W, VIEW_H);
  for (const item of items) {
    if (item.sign) {
      drawSign(item.sign, item.x, item.y);
      continue;
    }
    if (item.blob) {
      // Soft sphere: base ellipse with a lighter highlight up and to the left
      sceneCtx.fillStyle = shade(item.color, item.k);
      sceneCtx.beginPath();
      sceneCtx.ellipse(item.blob.x, item.blob.y, item.rx, item.ry, 0, 0, Math.PI * 2);
      sceneCtx.fill();
      sceneCtx.fillStyle = shade(item.color, item.k * 1.16);
      sceneCtx.beginPath();
      sceneCtx.ellipse(
        item.blob.x - item.rx * 0.25,
        item.blob.y - item.ry * 0.3,
        item.rx * 0.55,
        item.ry * 0.5,
        0, 0, Math.PI * 2
      );
      sceneCtx.fill();
      continue;
    }
    if (item.poly) {
      sceneCtx.fillStyle = shade(item.color, item.k);
      sceneCtx.beginPath();
      sceneCtx.moveTo(item.poly[0].x, item.poly[0].y);
      for (let i = 1; i < item.poly.length; i++)
        sceneCtx.lineTo(item.poly[i].x, item.poly[i].y);
      sceneCtx.closePath();
      sceneCtx.fill();
      continue;
    }
    for (const face of FACES) {
      const p0 = item.pts[face.i[0]];
      const p1 = item.pts[face.i[1]];
      const p2 = item.pts[face.i[2]];
      const p3 = item.pts[face.i[3]];
      if (signedArea4(p0, p1, p2, p3) <= 0) continue;

      const nx = face.n[0] * item.cos - face.n[1] * item.sin;
      const ny = face.n[0] * item.sin + face.n[1] * item.cos;
      const d = nx * LIGHT.x + ny * LIGHT.y + face.n[2] * LIGHT.z;
      const k = Math.min(1, Math.max(0.3, 0.3 + d));

      sceneCtx.fillStyle = shade(item.box.color, k);
      sceneCtx.beginPath();
      sceneCtx.moveTo(p0.x, p0.y);
      sceneCtx.lineTo(p1.x, p1.y);
      sceneCtx.lineTo(p2.x, p2.y);
      sceneCtx.lineTo(p3.x, p3.y);
      sceneCtx.closePath();
      sceneCtx.fill();
    }
  }

  // Ink pass: dilate the scene's alpha one pixel in each cardinal direction,
  // cut the scene itself back out, and tint the remaining ring
  inkCtx.globalCompositeOperation = "source-over";
  inkCtx.clearRect(0, 0, VIEW_W, VIEW_H);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
    inkCtx.drawImage(sceneCanvas, dx, dy);
  inkCtx.globalCompositeOperation = "destination-out";
  inkCtx.drawImage(sceneCanvas, 0, 0);
  inkCtx.globalCompositeOperation = "source-in";
  inkCtx.fillStyle = INK;
  inkCtx.fillRect(0, 0, VIEW_W, VIEW_H);

  // The line goes under the models: outline first, scene on top
  ctx.drawImage(inkCanvas, 0, 0);
  ctx.drawImage(sceneCanvas, 0, 0);
}

// ---------------------------------------------------------------------------
// Wheel tracks: stamped into the prerendered map canvas while driving over
// unplowed field dirt or the farmyard's trodden yard. Each mark is also
// recorded by tile index so drawTile can stamp it back after a repaint
// (seasons, crop overhangs); working a field tile changes its type, which
// drops the record there — field work wipes tracks (the yard never changes
// type, so its tracks are permanent, same as real trampled dirt).
// ---------------------------------------------------------------------------

const TRACK_WHEELS = [
  { x: -4.5, y: 4.0, w: 2 }, // rear left (wide tire, wide mark)
  { x: -4.5, y: -4.0, w: 2 }, // rear right
  { x: 5.0, y: 3.1, w: 1 }, // front left
  { x: 5.0, y: -3.1, w: 1 }, // front right
];

const TRACK_COLOR = "rgba(94,66,38,0.45)";
// Repeat passes over the same pixel composite darker; past a few the alpha
// saturates, so capping there bounds the record while letting a restamp
// replay the exact darkness
const TRACK_MAX_PASSES = 4;
// Tile index -> Map of packed (px, py, width) -> pass count
const trackMarks = new Map();

const packMark = (px, py, w) => (py * mapCanvas.width + px) * 2 + (w - 1);

let trackDist = 0;

function updateTracks(dt) {
  trackDist += Math.abs(tractor.speed) * dt;
  if (trackDist < 2) return;
  trackDist = 0;

  for (const wheel of TRACK_WHEELS) {
    const { x: wx, y: wy } = rotateLocal(tractor.x, tractor.y, tractor.angle, wheel.x, wheel.y);
    // marks only on unplowed field dirt or the yard's trodden ground
    if (tileTypeAt(wx, wy) !== 1 && !inYard(wx, wy)) continue;
    const px = Math.round(projX(wx, wy) + MAP_OFFSET_X);
    const py = Math.round(projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y);
    const key = tileKey(wx, wy);
    let marks = trackMarks.get(key);
    if (!marks) trackMarks.set(key, (marks = new Map()));
    const mk = packMark(px, py, wheel.w);
    const passes = marks.get(mk) || 0;
    if (passes >= TRACK_MAX_PASSES) continue;
    marks.set(mk, passes + 1);
    mapCtx.fillStyle = TRACK_COLOR;
    mapCtx.fillRect(px - (wheel.w >> 1), py, wheel.w, 1);
  }
}

// Stamp a tile's recorded marks back over a fresh repaint (called by
// drawTile after its re-dither, matching how live marks go down undithered)
function restampTracks(tx, ty) {
  const key = ty * MAP_TILES + tx;
  const marks = trackMarks.get(key);
  if (!marks) return;
  if (tiles[ty][tx] !== 1 && !inYard((tx + 0.5) * TILE, (ty + 0.5) * TILE)) {
    trackMarks.delete(key); // the tile was worked: its marks are gone for good
    return;
  }
  mapCtx.fillStyle = TRACK_COLOR;
  for (const [mk, passes] of marks) {
    const w = (mk % 2) + 1;
    const pos = (mk - (w - 1)) / 2;
    const px = pos % mapCanvas.width;
    const py = (pos / mapCanvas.width) | 0;
    for (let i = 0; i < passes; i++) mapCtx.fillRect(px - (w >> 1), py, w, 1);
  }
}

// ---------------------------------------------------------------------------
// Seasons: the round runs from spring through summer into autumn and back
// into spring again, year-round — nothing ever stops growth. Colors
// interpolate around three keyframes, and the ground takes the new colors
// gradually as a few random tiles repaint every frame.
// ---------------------------------------------------------------------------

// The map's own palette (see MAP_PROFILES) supplies the three season
// keyframes for grass/dirt/sky/canopy; dot speckles, canopy tiers and the
// meadow's warmer take on grass are all derived from those via tint()/
// meadowTint() rather than hand-authored per map, so a new theme only needs
// to specify its handful of base tones.
const GRASS_SEASONS = PROFILE.palette.grass;
// Meadows run warmer/yellower than plain grass and turn properly golden
// (dried hay) in autumn rather than just tanning like the grass does
const MEADOW_SEASONS = GRASS_SEASONS.map(meadowTint);
const DIRT_SEASONS = PROFILE.palette.dirt;
const STUBBLE_SEASONS = DIRT_SEASONS.map(stubbleTint);
const TREE_BLOB_SEASONS = [
  PROFILE.palette.canopy,
  PROFILE.palette.canopy.map((c) => tint(c, 0.1)),
  PROFILE.palette.canopy.map((c) => tint(c, 0.22)),
];
const SKY_TOP_SEASONS = PROFILE.palette.skyTop;
const SKY_BOTTOM_SEASONS = PROFILE.palette.skyBottom;

// The round is presented as a calendar running continuously Jan 1st through
// Dec 31st — one long growing season, with the farm workable every day of
// the year.
const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SEASON_DAYS = 365; // days in the year, Jan 1 through Dec 31
const SEASON_BAR_COLORS = ["#6fce58", "#4fae4a", "#d99a33"];

function seasonHex(colors) {
  const seg = Math.min(2, (seasonQ * 3) | 0);
  return mixHex(colors[seg], colors[(seg + 1) % 3], seasonQ * 3 - seg);
}

function updateSeason() {
  // The color wheel runs 0→1 spring to summer to autumn and wraps back onto
  // spring green over the whole year. It moves continuously every frame; the
  // blends themselves are quantized by mixHex's cache, so trees, bushes and
  // sky glide instead of ticking.
  seasonQ = clamp(1 - timeLeft / ROUND_TIME, 0, 1);
  GRASS = seasonHex(GRASS_SEASONS);
  MEADOW = seasonHex(MEADOW_SEASONS);
  DIRT = seasonHex(DIRT_SEASONS);
  STUBBLE = seasonHex(STUBBLE_SEASONS);
  const gDots = grassDotShades(GRASS);
  for (let i = 0; i < GRASS_DOTS.length; i++) GRASS_DOTS[i] = gDots[i];
  const mDots = grassDotShades(MEADOW);
  for (let i = 0; i < MEADOW_DOTS.length; i++) MEADOW_DOTS[i] = mDots[i];
  const dDots = dirtDotShades(DIRT);
  for (let i = 0; i < DIRT_DOTS.length; i++) DIRT_DOTS[i] = dDots[i];
  const sDots = dirtDotShades(STUBBLE);
  for (let i = 0; i < STUBBLE_DOTS.length; i++) STUBBLE_DOTS[i] = sDots[i];
  for (let i = 0; i < TREE_BLOBS.length; i++)
    TREE_BLOBS[i].color = seasonHex(TREE_BLOB_SEASONS[i]);
  // The sky is a full-canvas dithered repaint, so it only redraws on a
  // step grid — fine enough that each redraw is an invisible nudge
  const step = Math.round(seasonQ * 128);
  if (step !== seasonStep) {
    seasonStep = step;
    paintSky();
  }
  // The ground turns gradually: random tiles repaint each frame with the
  // current colors (wheel marks survive: drawTile restamps them), spread
  // evenly across the whole year.
  const repaints = 8;
  for (let i = 0; i < repaints; i++) {
    drawTile((rand() * MAP_TILES) | 0, (rand() * MAP_TILES) | 0);
  }
}

// ---------------------------------------------------------------------------
// Sky: gradient, a friendly sun, and puffy clouds drifting past the island
// ---------------------------------------------------------------------------

let worldTime = 0;

// How overcast the day is, 0 (clear) to 1 (socked in): two slow sines of
// unrelated periods multiplied together, so it drifts continuously and
// never repeats on a predictable beat or pops between frames — same
// no-per-frame-randomness, no-snapping rule the rest of the weather/season
// system follows.
function mistiness() {
  return 0.5 + 0.5 * Math.sin(worldTime * 0.02) * Math.sin(worldTime * 0.0053 + 1.7);
}

// The sky gradient is prerendered so it can be dithered, and repainted
// whenever the season shifts its colors
const skyCanvas = document.createElement("canvas");
skyCanvas.width = VIEW_W;
skyCanvas.height = VIEW_H;
const skyCtx = skyCanvas.getContext("2d", { willReadFrequently: true });

function paintSky() {
  const g = skyCtx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, shade(seasonHex(SKY_TOP_SEASONS), 1));
  g.addColorStop(1, shade(seasonHex(SKY_BOTTOM_SEASONS), 1));
  skyCtx.fillStyle = g;
  skyCtx.fillRect(0, 0, VIEW_W, VIEW_H);
  ditherRegion(skyCtx, 0, 0, VIEW_W, VIEW_H);
}

paintSky();

function drawSun() {
  ctx.fillStyle = "rgba(255,240,170,0.4)";
  ctx.beginPath();
  ctx.arc(56, 44, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe66b";
  ctx.beginPath();
  ctx.arc(56, 44, 13, 0, Math.PI * 2);
  ctx.fill();
}

const CLOUDS = [];
for (let i = 0; i < 9; i++) {
  CLOUDS.push({
    x: rand() * (VIEW_W + 240),
    y: rand() * (VIEW_H + 200),
    speed: 2 + rand() * 3,
    scale: 0.7 + rand() * 0.9,
    par: 0.15 + rand() * 0.25, // parallax: far clouds track the camera less
  });
}

function drawClouds(camX, camY) {
  const wrapX = VIEW_W + 240;
  const wrapY = VIEW_H + 200;
  // Greyer and a touch more solid on overcast days, paper-white on clear ones
  const m = mistiness();
  const grey = Math.round(252 - 40 * m);
  ctx.fillStyle = `rgba(${grey},${grey - 2},${grey - 8},${(0.8 + 0.15 * m).toFixed(2)})`;
  for (const c of CLOUDS) {
    const sx = ((((c.x + worldTime * c.speed - camX * c.par) % wrapX) + wrapX) % wrapX) - 120;
    const sy = ((((c.y - camY * c.par) % wrapY) + wrapY) % wrapY) - 100;
    const s = c.scale * 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, 7 * s, 0, Math.PI * 2);
    ctx.arc(sx - 8 * s, sy + 2 * s, 5 * s, 0, Math.PI * 2);
    ctx.arc(sx + 8 * s, sy + 2 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Mist: a soft overcast haze that thickens and thins with mistiness(), plus
// a light shower once it's properly socked in. Pure screen-space overlay
// drawn straight to ctx, so it never touches the ink outline pipeline. Rain
// streaks are laid out by golden-ratio hops instead of the seeded RNG, so
// world generation stays byte-identical for a given seed.
// ---------------------------------------------------------------------------

const RAIN_STREAKS = [];
for (let i = 0; i < 70; i++) {
  RAIN_STREAKS.push({
    x: ((i * 0.618034) % 1) * (VIEW_W + 40),
    y: ((i * 0.381966) % 1) * VIEW_H,
    speed: 14 + ((i * 7) % 13),
    sway: (i * 2.399963) % (Math.PI * 2), // golden angle, in radians
    size: i % 3 === 0 ? 2 : 1,
  });
}

function drawMist(camX, camY) {
  const m = mistiness();

  // Haze: a pale gradient, thicker toward the top of the view (distance)
  if (m > 0.02) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, `rgba(206,216,220,${(0.4 * m).toFixed(2)})`);
    g.addColorStop(1, `rgba(206,216,220,${(0.06 * m).toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // Rain only once it's properly overcast
  const rain = Math.max(0, m - 0.55) / 0.45;
  if (rain <= 0) return;
  const n = Math.ceil(RAIN_STREAKS.length * Math.min(1, rain * 1.5));
  ctx.strokeStyle = `rgba(205,218,226,${(0.3 + 0.35 * rain).toFixed(2)})`;
  const wrapX = VIEW_W + 40;
  for (let i = 0; i < n; i++) {
    const f = RAIN_STREAKS[i];
    const sx =
      ((((f.x + Math.sin(worldTime * 2 + f.sway) * 3 - camX * 0.4) % wrapX) +
        wrapX) %
        wrapX) -
      20;
    const sy =
      (((f.y + worldTime * f.speed * 2.4 - camY * 0.4) % VIEW_H) + VIEW_H) % VIEW_H;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 1, sy + 4);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Butterflies fluttering over the meadows
// ---------------------------------------------------------------------------

const BUTTERFLY_COLORS = ["#ff9ed2", "#ffd94f", "#ffffff", "#b8a6ff"];
const butterflies = [];
for (let i = 0; i < 40; i++) {
  butterflies.push({
    wx: rand() * MAP_SIZE,
    wy: rand() * MAP_SIZE,
    a: rand() * Math.PI * 2,
    phase: rand() * 10,
    color: BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length],
  });
}

function updateButterflies(dt) {
  for (const b of butterflies) {
    b.a += (rand() - 0.5) * 4 * dt;
    b.wx += Math.cos(b.a) * 7 * dt;
    b.wy += Math.sin(b.a) * 7 * dt;
    if (b.wx < 16 || b.wx > MAP_SIZE - 16 || b.wy < 16 || b.wy > MAP_SIZE - 16) {
      b.wx = clamp(b.wx, 16, MAP_SIZE - 16);
      b.wy = clamp(b.wy, 16, MAP_SIZE - 16);
      b.a = Math.atan2(MAP_SIZE / 2 - b.wy, MAP_SIZE / 2 - b.wx);
    }
  }
}

function drawButterflies(camX, camY) {
  for (const b of butterflies) {
    const wz = terrainHeight(b.wx, b.wy) + 4 + Math.sin(worldTime * 3 + b.phase) * 1.5;
    const x = Math.round(projX(b.wx, b.wy) - camX);
    const y = Math.round(projY(b.wx, b.wy, wz) - camY);
    if (x < -2 || x > VIEW_W + 2 || y < -2 || y > VIEW_H + 2) continue;
    ctx.fillStyle = b.color;
    if (Math.sin(worldTime * 14 + b.phase) > 0) {
      ctx.fillRect(x - 1, y, 1, 1); // wings spread
      ctx.fillRect(x + 1, y, 1, 1);
    } else {
      ctx.fillRect(x, y - 1, 1, 2); // wings folded
    }
  }
}

// ---------------------------------------------------------------------------
// The ladybug: one tiny critter hides in the grass somewhere. Roll up to it
// slowly and it pays a little luck money, buzzes off, and hides again.
// ---------------------------------------------------------------------------

const LADYBUG_BONUS = 10;

const ladybug = { wx: 0, wy: 0, flee: 0, dir: 0 };
let luckFlash = 0; // makes the CASH readout blink green on a find

function placeLadybug() {
  for (let tries = 0; tries < 200; tries++) {
    const wx = 24 + rand() * (MAP_SIZE - 48);
    const wy = 24 + rand() * (MAP_SIZE - 48);
    if (tileTypeAt(wx, wy) !== 0) continue;
    if (roadTiles.has(tileKey(wx, wy))) continue;
    // Not in the farmyard, where every run starts
    if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 20) continue;
    ladybug.wx = wx;
    ladybug.wy = wy;
    return;
  }
}

placeLadybug();

function updateLadybug(dt) {
  luckFlash = Math.max(0, luckFlash - dt);
  if (ladybug.flee > 0) {
    // Airborne: buzz away from the finder, then hide somewhere fresh
    ladybug.flee -= dt;
    ladybug.wx += Math.cos(ladybug.dir) * 26 * dt;
    ladybug.wy += Math.sin(ladybug.dir) * 26 * dt;
    if (ladybug.flee <= 0) placeLadybug();
    return;
  }
  if (!gameStarted || gameOver) return;
  // Only a slow, deliberate approach counts as finding it — half the
  // work gear's top speed, expressed as such so it stays exactly half no
  // matter how GEAR_SLOW gets retuned
  const d = Math.hypot(tractor.x - ladybug.wx, tractor.y - ladybug.wy);
  if (d < 8 && Math.abs(tractor.speed) < GEAR_SLOW / 2) {
    cash += LADYBUG_BONUS;
    luckFlash = 1.2;
    playPickup();
    ladybug.flee = 1.6;
    ladybug.dir = Math.atan2(ladybug.wy - tractor.y, ladybug.wx - tractor.x);
  }
}

function drawLadybug(camX, camY) {
  const b = ladybug;
  const lift = b.flee > 0 ? (1.6 - b.flee) * 14 : 0;
  const x = Math.round(projX(b.wx, b.wy) - camX);
  const y = Math.round(projY(b.wx, b.wy, terrainHeight(b.wx, b.wy) + 0.6 + lift) - camY);
  if (x < -3 || x > VIEW_W + 3 || y < -3 || y > VIEW_H + 3) return;
  ctx.fillStyle = shade("#d8291f", 1); // wing shells
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(x + 1, y - 1, 1, 2); // head
  ctx.fillRect(x - 1, y - 1, 1, 1); // spot
  if (b.flee > 0 && Math.sin(worldTime * 16) > 0) {
    ctx.fillStyle = "rgba(252,247,235,0.9)"; // wing blur while airborne
    ctx.fillRect(x - 2, y - 2, 1, 1);
    ctx.fillRect(x + 2, y - 2, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Exhaust smoke & chaff particles
// ---------------------------------------------------------------------------

const smoke = [];
let smokeTimer = 0;

function updateSmoke(dt) {
  const onGas =
    keys.ArrowUp || autoThrottling() || (touchDrive.throttleActive && touchDrive.throttle > 0.05);
  if (!gameOver && (onGas || Math.abs(tractor.speed) > 5 * GEAR_FAST_RATIO)) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = onGas ? 0.07 : 0.18;
      const cos = Math.cos(tractor.angle);
      const sin = Math.sin(tractor.angle);
      const wx = tractor.x + 2 * cos;
      const wy = tractor.y + 2 * sin;
      smoke.push({
        wx,
        wy,
        wz: terrainHeight(wx, wy) + 10,
        life: 0.9,
        maxLife: 0.9,
      });
    }
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.life -= dt;
    p.wz += 16 * dt;
    p.wx += (rand() - 0.5) * 8 * dt;
    p.wy += (rand() - 0.5) * 8 * dt;
    if (p.life <= 0) smoke.splice(i, 1);
  }
}

// Golden chaff burst thrown up when a tile is harvested or grain is sold
function spawnChaff(wx, wy) {
  const base = terrainHeight(wx, wy);
  for (let i = 0; i < 8; i++) {
    const life = 0.5 + rand() * 0.4;
    smoke.push({
      wx: wx + (rand() - 0.5) * 10,
      wy: wy + (rand() - 0.5) * 10,
      wz: base + 2 + rand() * 4,
      life,
      maxLife: life,
      gold: true,
    });
  }
}

function drawSmoke(camX, camY) {
  for (const p of smoke) {
    const t = 1 - p.life / p.maxLife;
    const r = 0.8 + t * 2.6;
    ctx.fillStyle = p.gold
      ? `rgba(219,186,84,${(0.8 * (1 - t)).toFixed(2)})`
      : `rgba(235,235,235,${(0.7 * (1 - t)).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(projX(p.wx, p.wy) - camX, projY(p.wx, p.wy, p.wz) - camY, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Tractor state, economy & physics
// ---------------------------------------------------------------------------

const SEED_CAP = 64; // seeder hopper size, refilled at the farm
const TRAILER_CAP = 12; // sacks the trailer can carry
const SEED_PRICE = 2; // £ per seed, bought automatically at the farm
const SACK_PRICE = 10; // £ earned per sack of grain sold

// Fuel: a tank sized so a full one comfortably covers a return trip from
// anywhere on the map, refilled automatically at the farm like seeds
const FUEL_CAP = 100;
const FUEL_PRICE = 1; // £ per unit, bought automatically at the farm

// seconds — one Jan 1 - Dec 31 year, at the same real-seconds-per-day pace
// the old Apr-Oct growing season ran at (300s / 213 days)
const ROUND_TIME = Math.round((300 * SEASON_DAYS) / 213);
let timeLeft = ROUND_TIME;
let gameOver = false;
let bestScores = [];
let finalRank = -1; // this round's place in the best list, -1 if none

// Survival mode: the years keep rolling and every Dec 31 the property tax
// is collected, growing a little each year, income or not. Seeds can go on
// credit down to the debt limit; sink below it and the bank takes the farm.
// The scoreboard is the longest runs in years, kept in localStorage.
const SURVIVAL_START_CASH = 250;
const TAX_BASE = 150; // £ — the first year's property tax
const TAX_STEP = 75; // £ added to the tax each following year
const DEBT_LIMIT = 400; // bankruptcy when cash drops below -this
const SURVIVAL_SCORES_KEY = "traktoripeli.survival";
let year = 1;
let propertyTax = TAX_BASE;
let taxFlash = 0; // seconds left of the "tax paid" banner
let taxPaid = 0; // amount shown in that banner
let taxYear = 0; // the year that amount was billed against, for the banner

// Sandbox mode: the same rolling years, but nothing is ever due and
// nothing ever ends. A fat wallet so seeds are never a worry.
const SANDBOX_START_CASH = 1000;

// Calendar day indices for the year's key dates (Jan 1 = day 0), named so
// every place that needs one of these boundaries — the sandbox pacing
// phases below and currentCalendarDay()'s comment — refers to the same
// source instead of restating the numbers.
const APR1_DAY = 90; // Jan 1 - Mar 31 days, i.e. the day index Apr 1 lands on
const JUN1_DAY = 151;
const SEP1_DAY = 243;
const NOV1_DAY = 304;

// Sandbox season pacing: the calendar crawls through spring planting and
// autumn harvest so there is time to plant every field and haul every sack,
// and runs at full speed the rest of the year — through summer while the
// crops ripen, and again through the quiet stretch from Nov 1 to Mar 31.
// Rates are calendar seconds per real second; the phase boundaries are
// expressed as timeLeft values so the frame loop can compare directly.
const SANDBOX_SPRING_RATE = 0.25; // Apr 1 – May 31: planting
const SANDBOX_SUMMER_RATE = 1; // Jun 1 – Aug 31: growing
const SANDBOX_AUTUMN_RATE = 0.25; // Sep 1 – Oct 31: harvest and hauling
const SPRING_START_LEFT = ROUND_TIME * (1 - APR1_DAY / SEASON_DAYS);
const SUMMER_START_LEFT = ROUND_TIME * (1 - JUN1_DAY / SEASON_DAYS);
const AUTUMN_START_LEFT = ROUND_TIME * (1 - SEP1_DAY / SEASON_DAYS);
const OFFSEASON_START_LEFT = ROUND_TIME * (1 - NOV1_DAY / SEASON_DAYS);

// In sandbox crops grow on the calendar instead of the wall clock: seed to
// mature spans this many calendar days, so a spring planting sprouts slowly,
// shoots up over summer and stands golden by September whatever the
// real-time pace of each phase.
const SANDBOX_GROW_DAYS = 90;
const SANDBOX_GROW_FACTOR =
  CROP_STAGES[2] / ((SANDBOX_GROW_DAYS * ROUND_TIME) / SEASON_DAYS);

// The sandbox pacing phases, in the order they're tested as the calendar
// counts down from ROUND_TIME to 0: the first entry whose boundary timeLeft
// is still ahead is the current phase. One table instead of two separate
// rate/floor cascades, so a boundary change only has to be made once.
const SANDBOX_PHASES = [
  { boundary: SPRING_START_LEFT, rate: 1 }, // Jan 1 - Mar 31: quiet stretch
  { boundary: SUMMER_START_LEFT, rate: SANDBOX_SPRING_RATE }, // Apr 1 - May 31: planting
  { boundary: AUTUMN_START_LEFT, rate: SANDBOX_SUMMER_RATE }, // Jun 1 - Aug 31: growing
  { boundary: OFFSEASON_START_LEFT, rate: SANDBOX_AUTUMN_RATE }, // Sep 1 - Oct 31: harvest and hauling
  { boundary: 0, rate: 1 }, // Nov 1 - Dec 31: quiet stretch
];

function sandboxPhase() {
  for (const p of SANDBOX_PHASES) {
    if (timeLeft > p.boundary) return p;
  }
  return SANDBOX_PHASES[SANDBOX_PHASES.length - 1];
}

function sandboxClockRate() {
  return sandboxPhase().rate;
}

// The timeLeft value where the current phase's rate stops applying
function sandboxPhaseFloor() {
  return sandboxPhase().boundary;
}

function modeStartCash(m) {
  return m === "sandbox" ? SANDBOX_START_CASH : SURVIVAL_START_CASH;
}

function startGame(m) {
  mode = m;
  cash = modeStartCash(m);
  gameStarted = true;
  menuOpen = false;
  paused = false;
}

// Dec 31: the tax collector comes around. Returns false when the bill
// bankrupts the farm and the run is over.
function collectTax() {
  cash -= propertyTax;
  taxPaid = propertyTax;
  taxYear = year; // the year that's ending, before the caller rolls it over
  taxFlash = 4;
  playTax();
  if (cash < -DEBT_LIMIT) {
    endSurvival();
    return false;
  }
  propertyTax += TAX_STEP;
  return true;
}

// Dec 31 -> Jan 1: the year turns over and the calendar starts again from
// the top. Shared by the live per-frame update and the offline catch-up
// loop so this crossing only lives in one place.
function rollOverYear() {
  year++;
  timeLeft = ROUND_TIME;
}

// Away-clock catch-up: time the frame loop never saw (rAF stops in a
// hidden tab) is applied in one step. Crops grow and the calendar keeps
// turning — year by year in survival, taxes and all.
function advanceTime(sec) {
  // Paused means paused: time away from the tab stays off the books too
  if (!gameStarted || gameOver || paused) return;
  worldTime += sec;
  while (sec > 0 && !gameOver) {
    if (mode === "sandbox") {
      // The calendar runs at a phase-dependent speed and the crops grow on
      // the calendar, so the catch-up walks phase by phase: each step spends
      // the real seconds the current phase's remainder costs at its rate.
      const rate = sandboxClockRate();
      const floor = sandboxPhaseFloor();
      const span = timeLeft - floor; // calendar seconds left in this phase
      if (sec * rate >= span) {
        updateCrops(span * SANDBOX_GROW_FACTOR);
        sec -= span / rate;
        timeLeft = floor;
        if (floor === 0) rollOverYear();
      } else {
        updateCrops(sec * rate * SANDBOX_GROW_FACTOR);
        timeLeft -= sec * rate;
        sec = 0;
      }
      continue;
    }
    // Survival runs on the wall clock
    if (timeLeft > sec) {
      updateCrops(sec);
      timeLeft -= sec;
      sec = 0;
    } else {
      updateCrops(timeLeft);
      sec -= timeLeft;
      timeLeft = 0;
      if (!collectTax()) return;
      rollOverYear();
    }
  }
}

// Where the calendar stands as a day index of the game year: Jan 1 = 0,
// Mar 31 = APR1_DAY - 1, Apr 1 = APR1_DAY, Nov 1 = NOV1_DAY,
// Dec 31 = SEASON_DAYS - 1. Mirrors the HUD's date arithmetic exactly, so a
// jump lands on the date the player reads.
function currentCalendarDay() {
  const p = 1 - timeLeft / ROUND_TIME;
  return Math.min(SEASON_DAYS - 1, Math.floor(p * SEASON_DAYS));
}

// Enter in the date-jump field: parse the typed MMDD and fast-forward the
// calendar to that date's next occurrence. The world advances in small
// real-time steps through advanceTime, so crops grow and taxes fall due
// exactly as if the time had really been played.
function tryDateJump() {
  if (dateJump.length !== 4) {
    dateJumpError = true;
    return;
  }
  const mm = +dateJump.slice(0, 2);
  const dd = +dateJump.slice(2);
  // A fixed non-leap reference year, just to validate the typed date
  const y = 2001;
  if (
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    new Date(Date.UTC(y, mm - 1, dd)).getUTCDate() !== dd
  ) {
    dateJumpError = true;
    return;
  }
  const target = (Date.UTC(y, mm - 1, dd) - Date.UTC(y, 0, 1)) / 86400000;
  // Always at least one step forward: jumping to today's date rolls a
  // whole year around in the cyclical modes. The guard comfortably covers
  // the longest year (sandbox's slow spring and autumn phases) and the loop
  // stops early if the jump itself ends the run (a tax it can't cover).
  for (let guard = 0; guard < 12000 && !gameOver; guard++) {
    advanceTime(0.2);
    if (currentCalendarDay() === target) break;
  }
  dateJump = null;
}

// ---------------------------------------------------------------------------
// Save games: the whole mutable state autosaves to localStorage, so a reload
// (or updating the game) resumes the run. Terrain, roads, water and scenery
// all regenerate deterministically from the seed and aren't saved; only the
// tile arrays and the player's numbers are.
// ---------------------------------------------------------------------------

const SAVE_KEY = "traktoripeli.save";
const SAVE_VERSION = 4; // bump when map generation or calendar meaning changes: stale saves drop
let saveTimer = 0;
let savingDisabled = false; // set when navigating away from a discarded run

function saveGame() {
  if (!gameStarted || gameOver || savingDisabled) return;
  const data = {
    v: SAVE_VERSION,
    map: MAP_INDEX,
    mode,
    tiles,
    dirs,
    growth: growth.map((row) => row.map((g) => Math.round(g * 10) / 10)),
    sacks,
    cash,
    seeds,
    cargo,
    sold,
    fuel,
    year,
    propertyTax,
    timeLeft: Math.round(timeLeft * 10) / 10,
    tractor: {
      x: tractor.x,
      y: tractor.y,
      angle: tractor.angle,
      fastGear: tractor.fastGear,
      implement: tractor.implement,
      implAngle: tractor.implAngle,
      implDown: tractor.implDown,
      implLift: tractor.implLift,
    },
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // private browsing etc: the run just isn't saved
  }
}

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === SAVE_VERSION && s.tiles && s.tiles.length === MAP_TILES
      ? s
      : null;
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // nothing to do
  }
}

// Save on the way out (tab closed, hidden or navigated away), on top of
// the periodic autosave from update()
window.addEventListener("pagehide", saveGame);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveGame();
});

// Bankruptcy ends a survival run; the score is how many years the farm held
// out, with the closing balance as the tiebreak
function endSurvival() {
  gameOver = true;
  tractor.speed = 0;
  tractor.angVel = 0;
  clearSave(); // a finished run must not resurrect on reload
  const entry = { years: year, cash, map: MAP_INDEX, date: Date.now() };
  let scores;
  try {
    scores = JSON.parse(localStorage.getItem(SURVIVAL_SCORES_KEY)) || [];
  } catch {
    scores = [];
  }
  scores.push(entry);
  scores.sort((a, b) => b.years - a.years || b.cash - a.cash);
  bestScores = scores.slice(0, 5);
  finalRank = bestScores.indexOf(entry);
  try {
    localStorage.setItem(SURVIVAL_SCORES_KEY, JSON.stringify(bestScores));
  } catch {
    // private browsing etc: scores just aren't persisted
  }
}

// Offered on the bankruptcy screen: rather than starting over, the same
// farm — tractor, fields, calendar — carries on in sandbox mode, debt
// forgiven and no tax ever falling due again.
function continueInSandbox() {
  mode = "sandbox";
  cash = SANDBOX_START_CASH;
  gameOver = false;
  taxFlash = 0;
  saveGame();
}

// Starting capital by mode: survival a buffer against the first tax bill,
// sandbox plenty
let cash = modeStartCash(mode);
let seeds = 0; // start empty: buy seeds at the farm
let cargo = 0; // sacks on the trailer
let sold = 0; // total sacks delivered to the city
let fuel = FUEL_CAP; // start full
// Set once per frame in update(dt) and read again by the HUD in draw(), so
// each proximity check only runs its Math.hypot once a frame instead of once
// per reader
let atFuelTank = false;
let atCity = false;
const sacks = []; // grain sacks lying on the fields

const tractor = {
  x: FARM.x + 34,
  y: FARM.y + 10,
  angle: -2.4, // facing up-left, toward the middle of the map
  speed: 0, // world units/s, positive = forward
  angVel: 0, // rad/s, ramps toward the steering target instead of snapping to it
  fastGear: true, // Space toggles road mode (fast, lifted) vs work mode (slow, lowered)
  implement: "plow", // current implement: plow / seeder / harvester / trailer
  implAngle: -2.4, // world heading of a towed implement (trails the hitch)
  implDown: false, // lowered together with the work gear (part of the mode toggle)
  implLift: 1, // animated: 0 = working the ground, 1 = fully raised
  implBounce: 0, // seconds left of the refused-lower dip animation
  implFlash: 0, // seconds left of the red HUD flash (implement complaint)
  workLane: null, // tile row/column the current pass is locked to (see field work)
};

// Top speeds lean toward history without fully committing to it: true
// pre-WW2 British tractor speeds (Ivel/Saunderson ~2-4mph in the field,
// even a late-1930s Fordson N's top road gear only ~8mph) played too
// slow to be fun once tried. These split the difference, about 2/3 of
// the way back from that historical pace toward the original arcade-y
// numbers (GEAR_FAST 42, GEAR_SLOW 16) — still noticeably more sedate
// than a modern tractor, just not a literal simulation. World-unit/mph
// conversion (for whoever retunes this again): derived from the tractor
// model's own proportions (TRACTOR_WHEELS' 3.0-unit rear wheel radius vs
// a real period wheel's ~0.68m, and the 9.5-unit wheelbase vs a real
// Fordson's ~2.03m, both agreeing on ~0.23m/unit, i.e. ~1.96 world
// units/s per mph) — so GEAR_FAST≈28 is ~14mph; GEAR_SLOW≈14 is ~7mph
// (nudged up from an initial ~5mph — felt too slow for fieldwork even
// after the road gear was judged right), both above the historical
// figures on purpose.
const GEAR_FAST = 28; // ~14mph, top (road) gear
const GEAR_SLOW = 14; // ~7mph, working (plow) gear
// Every other speed-coupled constant below (and in update()) is an
// expression in one of these two ratios, not a hand-rounded literal —
// ACCEL/BRAKE/FRICTION/accelRate/the slope-gravity coefficient/the
// exhaust-smoke threshold move with GEAR_FAST_RATIO; MOVING_THRESHOLD/
// the bogged-down cap/the crawl-stop threshold/the ladybug threshold/the
// animal spook-flee threshold move with GEAR_SLOW_RATIO. That way a
// future GEAR_FAST/GEAR_SLOW retune (this session did it three times)
// carries all of them along automatically instead of needing each one
// hand-recomputed and its "scaled by such-and-such ratio" comment
// re-verified — which is exactly how one of these already drifted once:
// an earlier pass's crawl-stop comment claimed an exact ratio that its
// hardcoded literal didn't actually match.
const GEAR_FAST_RATIO = GEAR_FAST / 42; // 42 was the original GEAR_FAST
const GEAR_SLOW_RATIO = GEAR_SLOW / 16; // 16 was the original GEAR_SLOW
const ACCEL = 55 * GEAR_FAST_RATIO;
const BRAKE = 80 * GEAR_FAST_RATIO;
const FRICTION = 28 * GEAR_FAST_RATIO;
const MAX_REVERSE = -GEAR_SLOW; // backing up is never faster than the work gear
// Shared "is the tractor meaningfully moving" gate — field work, the
// ground-work engine noise, and a couple of HUD warnings all use this
// rather than a bare 0 so a stopped-but-twitching tractor doesn't flicker
// them on and off. Gear-gated (all four call sites only apply while a
// lowered implement is engaged in work gear), so this tracks GEAR_SLOW —
// see ROLLING_THRESHOLD below for the one gear-agnostic "is it rolling at
// all" case that doesn't belong on this constant.
const MOVING_THRESHOLD = 2 * GEAR_SLOW_RATIO;
// The driver's seat-bounce animation: unlike MOVING_THRESHOLD's four
// sites, this one isn't gated to work gear — it fires at any speed in
// either gear — so it tracks the gear-agnostic GEAR_FAST_RATIO instead of
// being lumped in with MOVING_THRESHOLD just because the two started out
// as the same bare number.
const ROLLING_THRESHOLD = 2 * GEAR_FAST_RATIO;
// Fuel burn only applies while actually on the gas; coasting or sitting
// still is free. Road gear burns faster than a work-gear pass, giving the
// work-mode auto-throttle choice real stakes.
const FUEL_BURN_WORK = 0.5; // fuel/s, work gear on the gas
const FUEL_BURN_ROAD = 1.1; // fuel/s, road gear on the gas
// An empty tank never fully strands the tractor — it limps home at a
// fraction of its usual top speed instead of stopping dead. Left at its
// original (pre-rescale) value rather than scaled down with the gears —
// scaling it along with GEAR_SLOW made the limp speed feel painfully
// slow, and unlike normal driving there's no "it should feel heavy"
// case for it: running dry is already a punishing enough state on its
// own without also crawling.
const FUEL_EMPTY_LIMP = 4;
// Fixed steering geometry: turn rate scales with speed, so the turning
// radius stays ~TURN_RADIUS at working speeds — tight enough to U-turn
// into the adjacent row (one tile = 16 units away).
const TURN_RADIUS = 7; // world units
const MAX_TURN_RATE = 2.5; // rad/s cap so the fast gear doesn't spin wildly
// Steering doesn't snap to its target rate — it ramps there at this
// angular acceleration instead, so turning in feels like leaning a heavy
// machine into a corner rather than an instant twitch. This only softens
// the *approach* to a turn; once angVel catches up to the target it holds
// steady there, so the sustained-turn radius stays ~TURN_RADIUS exactly
// as before (see steering below, in update()) — only the entry/exit of a
// turn gets slower, not the circle itself. Expressed as "reach full lock
// in about half a second" rather than a bare rad/s² figure so it stays
// sensible on its own if MAX_TURN_RATE (the ceiling it's ramping toward)
// ever changes — unlike the constants above, this one was never tied to
// GEAR_FAST/GEAR_SLOW in the first place, so it doesn't move with them.
const STEER_RESPONSE = MAX_TURN_RATE / 0.5; // rad/s²

// Towed implements pivot at the drawbar pin and trail behind the tractor
const HITCH_X = -7; // hitch pin position in tractor-local coords
const MAX_HITCH_ANGLE = 1.6; // jackknife limit: the drawbar hits the wheel

// Frame the implement actually occupies: mounted implements share the
// tractor's frame; towed ones swing around the hitch with their own heading.
// The origin is placed so local (HITCH_X, 0) lands exactly on the hitch pin.
function implementPose() {
  if (!IMPLEMENTS[tractor.implement].towed)
    return { x: tractor.x, y: tractor.y, angle: tractor.angle };
  const a = tractor.implAngle;
  const hx = tractor.x + HITCH_X * Math.cos(tractor.angle);
  const hy = tractor.y + HITCH_X * Math.sin(tractor.angle);
  return { x: hx - HITCH_X * Math.cos(a), y: hy - HITCH_X * Math.sin(a), angle: a };
}

// True when any part of the implement's working width is over field dirt.
// Deliberately generous — samples across the blades and a bit ahead of
// them — so working the edge rows of a field isn't fiddly.
function implementOverField() {
  const pose = implementPose();
  const points = [
    [-9.8, -4],
    [-9.8, 0],
    [-9.8, 4],
    [-6, 0],
  ];
  for (const [lx, ly] of points) {
    const { x: wx, y: wy } = rotateLocal(pose.x, pose.y, pose.angle, lx, ly);
    const tt = tileTypeAt(wx, wy);
    if (tt >= 1 && tt <= 3) return true;
  }
  return false;
}

// Work mode drives itself at a steady crawl so both hands (or the one
// thumb steering on touch) are free to just steer the implement straight,
// instead of also holding the accelerator down the whole pass. The brake
// still overrides it. Road mode stays fully manual. Shared by the physics,
// engine sound and exhaust smoke so they all agree on when the tractor is
// "on the gas".
function autoThrottling() {
  return (
    autoThrottleOn &&
    !tractor.fastGear &&
    !keys.ArrowDown &&
    !(touchDrive.throttleActive && touchDrive.throttle < -0.05)
  );
}

// Moves `current` toward `target`, capped at `maxDelta` per call — the
// "ramp toward a limit instead of snapping to it" shape both the tractor's
// speed-vs-gear-ceiling clamp and its steering ramp need (see update()).
// One expression handles both directions, so there's no if/else pair per
// call site that could drift out of sync with each other.
function approach(current, target, maxDelta) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function update(dt) {
  if (paused) return;
  // Ambient life keeps moving even after the round ends
  worldTime += dt;
  updateSmoke(dt);
  updateButterflies(dt);
  updateAnimals(dt);
  updateHerds(dt);
  updateCart(dt);
  updateBirds(dt);
  updateLadybug(dt);
  updateSeason();
  if (!gameStarted || gameOver) return;

  // The year turns over at Dec 31 -> Jan 1
  timeLeft = Math.max(
    0,
    timeLeft - dt * (mode === "sandbox" ? sandboxClockRate() : 1)
  );
  if (timeLeft === 0) {
    if (mode === "survival" && !collectTax()) return;
    rollOverYear();
  }
  taxFlash = Math.max(0, taxFlash - dt);

  const imp = IMPLEMENTS[tractor.implement];

  // Throttle / brake (touch uses proportional input, keyboard stays digital)
  const touchThrottle = touchDrive.throttleActive ? touchDrive.throttle : 0;
  const throttleInput = Math.max(
    keys.ArrowUp ? 1 : 0,
    touchThrottle > 0 ? touchThrottle : 0,
    autoThrottling() ? 1 : 0
  );
  const brakeInput = Math.max(keys.ArrowDown ? 1 : 0, touchThrottle < 0 ? -touchThrottle : 0);
  if (throttleInput > 0) {
    tractor.speed += ACCEL * throttleInput * dt;
  } else if (brakeInput > 0) {
    tractor.speed -= BRAKE * brakeInput * dt;
  } else {
    // Roll to a stop
    if (tractor.speed > 0) tractor.speed = Math.max(0, tractor.speed - FRICTION * dt);
    else tractor.speed = Math.min(0, tractor.speed + FRICTION * dt);
  }
  // Gravity along the slope: uphill fights the engine, downhill helps.
  // Scaled with ACCEL/BRAKE/FRICTION (was a bare 60) — left at its old
  // strength it would now overpower the much weaker period engine on any
  // real hill, instead of just leaning on it the way it used to.
  const cos = Math.cos(tractor.angle);
  const sin = Math.sin(tractor.angle);
  const grade =
    (terrainHeight(tractor.x + cos * 4, tractor.y + sin * 4) -
      terrainHeight(tractor.x - cos * 4, tractor.y - sin * 4)) /
    8;
  tractor.speed -= grade * 60 * GEAR_FAST_RATIO * dt;

  // At a crawl with no throttle the tractor simply stops — otherwise slope
  // gravity keeps it creeping forever and the camera never settles
  if (throttleInput === 0 && brakeInput === 0 && Math.abs(tractor.speed) < 1.5 * GEAR_SLOW_RATIO) {
    tractor.speed = 0;
  }

  // Burn fuel only while actually powering the wheels
  if (throttleInput > 0) {
    fuel = Math.max(
      0,
      fuel - (tractor.fastGear ? FUEL_BURN_ROAD : FUEL_BURN_WORK) * throttleInput * dt
    );
  }

  // Top speed from the gear, further reduced by drag when working the ground
  let maxForward =
    (tractor.fastGear ? GEAR_FAST : GEAR_SLOW) *
    (imp.liftable ? 1 - 0.35 * (1 - tractor.implLift) : 1);
  let maxReverse = MAX_REVERSE;

  // Running dry doesn't strand the tractor, just slows it to a limp
  if (fuel <= 0) {
    maxForward = Math.min(maxForward, FUEL_EMPTY_LIMP);
    maxReverse = Math.max(maxReverse, -FUEL_EMPTY_LIMP);
  }

  // Packed dirt roads are ~30% faster than driving across the meadows
  if (roadTiles.has(tileKey(tractor.x, tractor.y))) maxForward *= 1.3;

  const accelRate = 120 * GEAR_FAST_RATIO;

  // A lowered implement digging into unbroken ground bogs the tractor down
  if (imp.liftable && tractor.implLift < 0.5 && !implementOverField()) {
    maxForward = 3 * GEAR_SLOW_RATIO;
    maxReverse = -3 * GEAR_SLOW_RATIO;
  }

  if (tractor.speed > maxForward) tractor.speed = approach(tractor.speed, maxForward, accelRate * dt);
  if (tractor.speed < maxReverse) tractor.speed = approach(tractor.speed, maxReverse, accelRate * dt);

  // Steering only has effect while moving; reversing flips it like a real vehicle
  const turnRate =
    Math.min(Math.abs(tractor.speed) / TURN_RADIUS, MAX_TURN_RATE) *
    Math.sign(tractor.speed);
  const steeringInput = touchDrive.steeringActive
    ? touchDrive.steering
    : (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  // Ramp toward the target rate rather than snapping to it (see
  // STEER_RESPONSE) — the sustained-turn radius is unchanged, only how
  // briskly the tractor winds up to and out of it.
  const targetAngVel = turnRate * steeringInput;
  tractor.angVel = approach(tractor.angVel, targetAngVel, STEER_RESPONSE * dt);
  tractor.angle += tractor.angVel * dt;

  // Move on the ground plane
  const prevX = tractor.x;
  const prevY = tractor.y;
  tractor.x += cos * tractor.speed * dt;
  tractor.y += sin * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = clamp(tractor.x, margin, MAP_SIZE - margin);
  tractor.y = clamp(tractor.y, margin, MAP_SIZE - margin);

  // Water blocks the tractor, except where a road bridges it
  if (
    tileTypeAt(tractor.x, tractor.y) === 4 &&
    !roadTiles.has(tileKey(tractor.x, tractor.y))
  ) {
    tractor.x = prevX;
    tractor.y = prevY;
    tractor.speed = 0;
    tractor.angVel = 0; // a hard stop, not a coast — don't leave it spinning in place
  }

  // Trees are solid trunks: driving into one stops the tractor dead, same
  // as water. Only the tractor's own tile and its ring of neighbors are
  // checked (TREE_COLLIDE_R never reaches a second tile out).
  const TREE_COLLIDE_R = 4.5;
  const ttx = (tractor.x / TILE) | 0;
  const tty = (tractor.y / TILE) | 0;
  outer: for (let ny = Math.max(0, tty - 1); ny <= Math.min(MAP_TILES - 1, tty + 1); ny++)
    for (let nx = Math.max(0, ttx - 1); nx <= Math.min(MAP_TILES - 1, ttx + 1); nx++) {
      const list = treesByTile.get(ny * MAP_TILES + nx);
      if (!list) continue;
      for (const t of list) {
        if (Math.hypot(t.wx - tractor.x, t.wy - tractor.y) < TREE_COLLIDE_R) {
          tractor.x = prevX;
          tractor.y = prevY;
          tractor.speed = 0;
          tractor.angVel = 0;
          break outer;
        }
      }
    }

  // Farm buildings are solid too: driving into a wall stops the tractor
  // dead, same as a tree. FARM_SOLID_WORLD (see its definition) covers just
  // the load-bearing walls, expanded by a small margin so the tractor can't
  // clip in right up to the very wall line before stopping.
  const BUILDING_COLLIDE_MARGIN = 2;
  for (const b of FARM_SOLID_WORLD) {
    if (
      tractor.x > b.x0 - BUILDING_COLLIDE_MARGIN &&
      tractor.x < b.x1 + BUILDING_COLLIDE_MARGIN &&
      tractor.y > b.y0 - BUILDING_COLLIDE_MARGIN &&
      tractor.y < b.y1 + BUILDING_COLLIDE_MARGIN
    ) {
      tractor.x = prevX;
      tractor.y = prevY;
      tractor.speed = 0;
      tractor.angVel = 0;
      break;
    }
  }

  // Paddock fences stop the tractor too, but only the rail line itself —
  // FENCE_SOLID_WORLD is a ring of thin strips, not a solid block, so the
  // pasture inside stays open ground the tractor just can't reach.
  for (const b of FENCE_SOLID_WORLD) {
    if (tractor.x > b.x0 && tractor.x < b.x1 && tractor.y > b.y0 && tractor.y < b.y1) {
      tractor.x = prevX;
      tractor.y = prevY;
      tractor.speed = 0;
      tractor.angVel = 0;
      break;
    }
  }

  // Cows, sheep and pigs are solid: drive into one and the tractor stops
  // until it has plodded aside (they walk clear of a nearby tractor on
  // their own). Only blocked while closing in, so backing away always works.
  for (const an of animals) {
    if (an.species !== "cow" && an.species !== "sheep" && an.species !== "pig") continue;
    const dNew = Math.hypot(an.wx - tractor.x, an.wy - tractor.y);
    if (dNew < 6.5 && dNew < Math.hypot(an.wx - prevX, an.wy - prevY)) {
      tractor.x = prevX;
      tractor.y = prevY;
      tractor.speed = 0;
      tractor.angVel = 0;
      break;
    }
  }

  // A towed implement's wheels roll rather than skid, so the hitch's
  // sideways motion swings its heading toward the tractor's over time
  if (imp.towed) {
    let rel = tractor.angle - tractor.implAngle;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // wrap to (-pi, pi]
    rel -=
      ((tractor.speed * Math.sin(rel) + HITCH_X * tractor.angVel * Math.cos(rel)) /
        imp.towLength) *
      dt;
    rel = clamp(rel, -MAX_HITCH_ANGLE, MAX_HITCH_ANGLE);
    tractor.implAngle = tractor.angle - rel;
  } else {
    tractor.implAngle = tractor.angle;
  }

  // Hydraulic lift eases the implement up or down
  let liftTarget = tractor.implDown ? 0 : 1;
  if (tractor.implBounce > 0) {
    tractor.implBounce = Math.max(0, tractor.implBounce - dt);
    // Half-sine dip: drops partway, then springs back up
    liftTarget = 1 - 0.5 * Math.sin((Math.PI * (0.6 - tractor.implBounce)) / 0.6);
  }
  tractor.implLift += (liftTarget - tractor.implLift) * Math.min(1, dt * 5);
  tractor.implFlash = Math.max(0, tractor.implFlash - dt);

  // Field work under the implement while it's down and moving. A pass is
  // locked to a single row of tiles: the lane is picked where work starts,
  // and the lock gates the work — wobbling over a tile boundary works
  // nothing (never the neighboring row, and never the locked row from a
  // distance, which would let a zigzag cover two rows in one pass). The
  // lock moves once the centerline is well inside a neighboring row, or
  // when the travel axis flips. Raising the implement ends the pass.
  if (imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > MOVING_THRESHOLD) {
    const pose = implementPose();
    const pcos = Math.cos(pose.angle);
    const psin = Math.sin(pose.angle);
    const alongX = Math.abs(pcos) > Math.abs(psin);
    const wx = pose.x - 9.8 * pcos;
    const wy = pose.y - 9.8 * psin;
    const perp = alongX ? wy : wx;
    const lane = (perp / TILE) | 0;
    const lock = tractor.workLane;
    if (!lock || lock.alongX !== alongX) {
      tractor.workLane = { alongX, lane };
    } else if (lane !== lock.lane) {
      const past =
        lane > lock.lane ? perp - (lock.lane + 1) * TILE : lock.lane * TILE - perp;
      // The lock moves sooner the straighter the heading: a calm drift into
      // the next row is deliberate, while a swinging heading is a zigzag
      // trying to stitch two rows and gets the full stickiness.
      const sway = Math.abs(alongX ? psin : pcos);
      if (past > 1.5 + Math.min(20 * sway, 8)) tractor.workLane = { alongX, lane };
    }
    if (tractor.workLane.lane === lane) {
      if (tractor.implement === "plow") plowTileAt(wx, wy, alongX);
      else if (tractor.implement === "seeder") seedTileAt(wx, wy);
      else if (tractor.implement === "harvester") harvestTileAt(wx, wy);
    }
  } else if (tractor.implLift >= 0.3) {
    tractor.workLane = null;
  }

  // The trailer scoops up grain sacks it passes over — only in work mode,
  // same as the other implements needing their gear down to do their job.
  // The trailer has no lift of its own to gate this on (it's not
  // liftable), so without this it would scoop just as well at road-gear
  // speed, sacks flying into the bed at 40+.
  if (tractor.implement === "trailer" && !tractor.fastGear) {
    const pose = implementPose();
    const bx = pose.x - 16 * Math.cos(pose.angle);
    const by = pose.y - 16 * Math.sin(pose.angle);
    for (let i = sacks.length - 1; i >= 0 && cargo < TRAILER_CAP; i--) {
      if (Math.hypot(sacks[i].wx - bx, sacks[i].wy - by) < 9) {
        sacks.splice(i, 1);
        cargo++;
        playPickup();
      }
    }
  }

  atFuelTank = nearFuelTank();
  atCity = nearCity();

  // Refueling happens only at the fuel tank, off in its own corner of the
  // yard, rather than anywhere in the broader farm radius — refueling costs
  // cash, so it shouldn't happen incidentally every time the player is at
  // the farm to sell grain or buy seed.
  if (atFuelTank && fuel < FUEL_CAP) {
    // Top up the tank with as many whole units as the cash covers (fuel
    // itself drains fractionally, cash never should); in survival the
    // farm sells fuel on credit down to the debt limit, same as seeds
    const budget = mode === "survival" ? cash + DEBT_LIMIT : cash;
    const bought = Math.min(Math.ceil(FUEL_CAP - fuel), Math.floor(budget / FUEL_PRICE));
    if (bought > 0) {
      fuel = Math.min(FUEL_CAP, fuel + bought);
      cash -= bought * FUEL_PRICE;
    }
  }

  // Farmyard services: seed purchase only — grain is sold at the city now,
  // not handed over on the spot where it was grown
  if (nearFarm()) {
    if (tractor.implement === "seeder" && seeds < SEED_CAP) {
      // Top up the hopper with as many seeds as the cash covers; in
      // survival the farm buys on credit down to the debt limit
      const budget = mode === "survival" ? cash + DEBT_LIMIT : cash;
      const bought = Math.min(SEED_CAP - seeds, Math.floor(budget / SEED_PRICE));
      if (bought > 0) {
        seeds += bought;
        cash -= bought * SEED_PRICE;
      }
    }
  }

  // City services: the depot pays out for a loaded trailer. The farm only
  // stores and dispatches grain now — the payoff is hauling it to market.
  if (atCity && tractor.implement === "trailer" && cargo > 0) {
    cash += cargo * SACK_PRICE;
    sold += cargo;
    cargo = 0;
    const pose = implementPose();
    spawnChaff(pose.x - 16 * Math.cos(pose.angle), pose.y - 16 * Math.sin(pose.angle));
    playSell();
  }

  updateTracks(dt);
  updateCrops(
    mode === "sandbox" ? dt * sandboxClockRate() * SANDBOX_GROW_FACTOR : dt
  );

  // Periodic autosave so even a crash or hard reload loses only moments
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    saveGame();
  }
}

// ---------------------------------------------------------------------------
// Camera (follows the tractor)
// ---------------------------------------------------------------------------

const cam = {
  x: projX(tractor.x, tractor.y) - VIEW_W / 2,
  y: projY(tractor.x, tractor.y, terrainHeight(tractor.x, tractor.y)) - VIEW_H / 2,
};

function updateCamera(dt) {
  const tx = projX(tractor.x, tractor.y) - VIEW_W / 2;
  const ty = projY(tractor.x, tractor.y, terrainHeight(tractor.x, tractor.y)) - VIEW_H / 2;
  const k = Math.min(1, dt * 4);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Wood grain for the HUD carpentry: thin streaks with the occasional knot.
// Seeded from the region so the pattern is identical every frame — drawing
// fresh random streaks each frame would shimmer.
function drawWoodGrain(c2d, x, y, w, h) {
  let s = ((x * 73856093) ^ (y * 19349663) ^ (w * 83492791) ^ h) | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = (w * h) / 220; // streak density scales with the area
  for (let i = 0; i < n; i++) {
    const gx = Math.round(x + rnd() * w);
    const gy = Math.round(y + 2 + rnd() * (h - 4));
    const len = 8 + rnd() * 36;
    c2d.fillStyle =
      rnd() < 0.7 ? "rgba(40,24,12,0.18)" : "rgba(255,235,200,0.10)";
    // Two offset segments so it reads as grain, not pinstripes
    const seg1 = Math.round(len * (0.3 + rnd() * 0.5));
    c2d.fillRect(gx, gy, clamp(seg1, 0, x + w - gx), 1);
    c2d.fillRect(
      gx + seg1,
      gy + (rnd() < 0.5 ? 1 : -1),
      clamp(len - seg1, 0, x + w - gx - seg1),
      1
    );
    if (rnd() < 0.06) {
      // a knot in the plank
      c2d.fillStyle = "rgba(40,24,12,0.22)";
      c2d.fillRect(gx, gy - 1, 2, 3);
      c2d.fillRect(gx - 1, gy, 4, 1);
    }
  }
}

// The HUD's wooden chrome never changes, so the plank bars and the minimap's
// panel are prerendered once and blitted per frame instead of rebuilding
// their fills and grain streaks. Each prerender keeps its on-screen
// coordinates via translate, so the grain (seeded from x/y/w/h) stays put.
const topH = 28; // top bar height, shared by the layout below
const barY = screenCanvas.height - 28; // bottom bar top edge

const mmScale = 2;
const mmW = minimapCanvas.width * mmScale;
const mmH = minimapCanvas.height * mmScale;
const mmX = screenCanvas.width - mmW - 8;
const mmY = topH + 8;

function prerenderPanel(x, y, w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const p = c.getContext("2d");
  p.translate(-x, -y);
  paint(p);
  return c;
}

const hudTopCanvas = prerenderPanel(0, 0, screenCanvas.width, topH + 3, (p) => {
  p.fillStyle = "#7a4f2d";
  p.fillRect(0, 0, screenCanvas.width, topH);
  p.fillStyle = "#4a2f1a";
  p.fillRect(0, topH, screenCanvas.width, 3);
  p.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
  for (let px = 40; px < screenCanvas.width; px += 80) p.fillRect(px, 0, 1, topH);
  drawWoodGrain(p, 0, 0, screenCanvas.width, topH);
  p.fillStyle = "rgba(255,240,200,0.15)"; // sun-bleached lower edge
  p.fillRect(0, topH - 1, screenCanvas.width, 1);
});

const hudBottomCanvas = prerenderPanel(0, barY - 3, screenCanvas.width, 31, (p) => {
  p.fillStyle = "#4a2f1a";
  p.fillRect(0, barY - 3, screenCanvas.width, 3);
  p.fillStyle = "#7a4f2d";
  p.fillRect(0, barY, screenCanvas.width, 28);
  p.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
  for (let px = 40; px < screenCanvas.width; px += 80) p.fillRect(px, barY, 1, 28);
  drawWoodGrain(p, 0, barY, screenCanvas.width, 28);
  p.fillStyle = "rgba(255,240,200,0.15)"; // sun-bleached top edge
  p.fillRect(0, barY, screenCanvas.width, 1);
});

const minimapPanelCanvas = prerenderPanel(mmX - 8, topH, mmW + 16, mmH + 16, (p) => {
  p.fillStyle = "#4a2f1a"; // rim, continuous with the bar trim
  p.fillRect(mmX - 8, topH, mmW + 16, mmH + 16);
  p.fillStyle = "rgba(122,79,45,0.95)"; // plank fill
  p.fillRect(mmX - 5, topH + 3, mmW + 10, mmH + 10);
  drawWoodGrain(p, mmX - 5, topH + 3, mmW + 10, mmH + 10);
});

// The field ledger strip hangs flush under the minimap panel; its plank
// starts right at the joint so the minimap's bottom rim reads as the
// seam between the two pieces.
const tallyY = topH + mmH + 16;
const tallyH = 20;
const fieldTallyPanelCanvas = prerenderPanel(mmX - 8, tallyY, mmW + 16, tallyH, (p) => {
  p.fillStyle = "#4a2f1a"; // rim
  p.fillRect(mmX - 8, tallyY, mmW + 16, tallyH);
  p.fillStyle = "rgba(122,79,45,0.95)"; // plank fill
  p.fillRect(mmX - 5, tallyY, mmW + 10, tallyH - 3);
  drawWoodGrain(p, mmX - 5, tallyY, mmW + 10, tallyH - 3);
});

// Tiny pixel icons for the top bar: a note for the music, a speaker for the
// sound effects. Muted draws dim with a red strike across.
function iconStrike(x, y) {
  screenCtx.fillStyle = "#ff5040";
  for (let i = 0; i < 6; i++) screenCtx.fillRect(x + i * 2, y + 10 - i * 2, 2, 2);
}

function drawNoteIcon(x, y, on) {
  screenCtx.fillStyle = on ? "#f5e9c8" : "#4a2f1a";
  screenCtx.fillRect(x + 3, y + 1, 7, 2); // beam
  screenCtx.fillRect(x + 3, y + 1, 2, 8); // stems
  screenCtx.fillRect(x + 8, y + 1, 2, 8);
  screenCtx.fillRect(x + 1, y + 8, 4, 3); // note heads
  screenCtx.fillRect(x + 6, y + 8, 4, 3);
  if (!on) iconStrike(x, y);
}

function drawSpeakerIcon(x, y, on) {
  screenCtx.fillStyle = on ? "#f5e9c8" : "#4a2f1a";
  screenCtx.fillRect(x, y + 4, 3, 4); // box
  screenCtx.beginPath(); // cone
  screenCtx.moveTo(x + 3, y + 6);
  screenCtx.lineTo(x + 7, y + 2);
  screenCtx.lineTo(x + 7, y + 10);
  screenCtx.closePath();
  screenCtx.fill();
  if (on) {
    screenCtx.strokeStyle = "#f5e9c8"; // sound waves
    screenCtx.lineWidth = 1;
    screenCtx.beginPath();
    screenCtx.arc(x + 7, y + 6, 3, -0.8, 0.8);
    screenCtx.stroke();
    screenCtx.beginPath();
    screenCtx.arc(x + 7, y + 6, 5.5, -0.8, 0.8);
    screenCtx.stroke();
  } else {
    iconStrike(x, y);
  }
}

function draw() {
  const camX = Math.round(cam.x);
  const camY = Math.round(cam.y);

  // Sky beyond the map edges: the farm floats like a little island
  ctx.drawImage(skyCanvas, 0, 0);
  drawSun();
  drawClouds(camX, camY);

  ctx.drawImage(mapCanvas, -MAP_OFFSET_X - camX, -MAP_OFFSET_Y - camY);
  drawScene(camX, camY);
  drawSmoke(camX, camY);
  drawButterflies(camX, camY);
  drawLadybug(camX, camY);
  drawBirds(camX, camY);
  drawMist(camX, camY);

  screenCtx.drawImage(view, 0, 0, screenCanvas.width, screenCanvas.height);

  // HUD: a worn wooden plank bar along the bottom (prerendered)
  const imp = IMPLEMENTS[tractor.implement];
  screenCtx.drawImage(hudBottomCanvas, 0, barY - 3);

  // Text is stamped: a dark offset shadow under warm cream
  const label = (str, x, y, color) => {
    screenCtx.fillStyle = "rgba(40,24,12,0.9)";
    screenCtx.fillText(str, x + 1, y + 1);
    screenCtx.fillStyle = color;
    screenCtx.fillText(str, x, y);
  };

  screenCtx.font = "bold 13px monospace";
  const hudY = screenCanvas.height - 10;
  let hudX = 12;
  const seg = (text, color) => {
    label(text, hudX, hudY, color || "#f5e9c8");
    hudX += screenCtx.measureText(text).width;
  };
  const RED = "#ff5040";
  const flashImpl = tractor.implFlash > 0 && ((tractor.implFlash * 8) | 0) % 2 === 0;
  // Gear and implement move as one: road mode is fast with the implement
  // raised, work mode slow with it lowered — the lift state is still shown,
  // for the bounce when there's no field dirt to drop into. The attached
  // implement is named by the highlight in the farm list.
  const state =
    (imp.liftable ? (tractor.implDown ? ", IMPLEMENT DOWN" : ", IMPLEMENT UP") : "") +
    (autoThrottleOn ? "" : ", AUTO OFF");
  seg(`MODE: ${tractor.fastGear ? "ROAD" : "WORK"}${state} [Space][A]   `, flashImpl ? RED : null);
  if (tractor.implement === "seeder") {
    // Solid red when the hopper is empty; flashing when it's empty AND the
    // seeder is down working a field — driving along planting nothing
    const dryRun =
      seeds === 0 &&
      tractor.implLift < 0.3 &&
      Math.abs(tractor.speed) > MOVING_THRESHOLD &&
      implementOverField();
    const seedColor = dryRun
      ? ((worldTime * 6) | 0) % 2 === 0
        ? RED
        : null
      : seeds === 0
        ? RED
        : null;
    seg(`SEEDS: ${seeds}   `, seedColor);
  }
  if (tractor.implement === "trailer") {
    // Flash when the trailer is full while rolling over a field — passing
    // by grain sacks it has no room to pick up
    const fullRun =
      cargo === TRAILER_CAP &&
      Math.abs(tractor.speed) > MOVING_THRESHOLD &&
      implementOverField();
    const cargoColor = fullRun && ((worldTime * 6) | 0) % 2 === 0 ? RED : null;
    seg(`CARGO: ${cargo}/${TRAILER_CAP}${atCity ? " @TOWN" : ""}   `, cargoColor);
  }
  const lucky = luckFlash > 0 && ((luckFlash * 8) | 0) % 2 === 0;
  seg(`CASH: £${cash}   `, lucky ? "#c9e6a8" : cash < SEED_PRICE ? RED : "#ffd94f");
  seg(`SOLD: ${sold}   `);
  const fuelPct = Math.round((fuel / FUEL_CAP) * 100);
  seg(
    `FUEL: ${fuelPct}%${atFuelTank ? " @TANK" : ""}   `,
    fuelPct <= 20 ? RED : null
  );
  // The implement list at the farm, with the attached one lit up
  seg(`@FARM `, "#d8c49a");
  const IMPLEMENT_HINTS = { plow: "PLOW", seeder: "SEED", harvester: "HARVEST", trailer: "TRAILER" };
  for (const [key, impName] of Object.entries(IMPLEMENT_KEYS)) {
    seg(
      `${key}:${IMPLEMENT_HINTS[impName]} `,
      tractor.implement === impName ? "#ffd94f" : "#d8c49a"
    );
  }

  // The top HUD is a single-line plank bar matching the bottom one, trim
  // mirrored: mode, map and the pause/menu hint on the left, the season
  // calendar in the middle with the year folded into its date label, and
  // the mute icons and FPS on the right
  screenCtx.drawImage(hudTopCanvas, 0, 0);

  screenCtx.font = "11px monospace";
  const topY = 18; // shared text baseline in the bar

  // Left: mode, map, and the pause/menu hint
  let topX = 12;
  const topSeg = (text, color) => {
    label(text, topX, topY, color || "#f5e9c8");
    topX += screenCtx.measureText(text).width;
  };
  topSeg(`#${MAP_INDEX} ${PROFILE.name.toUpperCase()}  `);
  topSeg(`${mode.toUpperCase()}   `, "#ffd94f");

  // Season calendar instead of a clock: the year and date count continuously
  // Jan 1 through Dec 31 along a wooden trough; in survival the tax bill
  // comes due at Dec 31, flashing red for the last 30 seconds before it.
  const day = currentCalendarDay();
  const progress = day / 365;
  const date = new Date(2001, 0, 1 + day);
  const barW = 140;
  const barH = 8;
  const bx = (screenCanvas.width - barW) / 2;
  const by = 10;
  // Nothing is due at year's end in sandbox, so no red urgency flash there
  const flash =
    mode !== "sandbox" && timeLeft < 30 && ((timeLeft * 2) | 0) % 2 === 0;
  const taxJustPaid = mode === "survival" && taxFlash > 0 && !gameOver;
  // The banner shows the year the bill was actually for — the year counter
  // itself has already rolled over to the new year by the time it's shown
  const yearShown = taxJustPaid ? taxYear : year;
  screenCtx.textAlign = "right";
  label(
    `Y${yearShown} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`,
    bx - 8,
    topY,
    flash ? "#ff5040" : "#f5e9c8"
  );
  screenCtx.textAlign = "left";
  const endLabel = taxJustPaid
    ? `-£${taxPaid} PAID`
    : mode === "survival"
      ? `TAX £${propertyTax}`
      : "DEC 31";
  label(endLabel, bx + barW + 8, topY, taxJustPaid ? "#ff5040" : "#d8c49a");
  // The season grows along a wooden trough
  screenCtx.fillStyle = "#4a2f1a";
  screenCtx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
  screenCtx.fillStyle = "#2e1d10";
  screenCtx.fillRect(bx, by, barW, barH);
  screenCtx.fillStyle = flash ? "#ff5040" : seasonHex(SEASON_BAR_COLORS);
  screenCtx.fillRect(bx, by, Math.round(barW * progress), barH);

  // Right: the pause/menu hint, then the music & sound icons
  let rx = screenCanvas.width - 12;
  drawSpeakerIcon(rx - 13, 8, !soundMuted);
  rx -= 13 + 10;
  drawNoteIcon(rx - 12, 8, !musicMuted);
  rx -= 12 + 14;
  screenCtx.textAlign = "right";
  label(`[P] PAUSE  [F1] MENU`, rx, topY, "#d8c49a");
  screenCtx.textAlign = "left";

  // Game over: final score and the all-time best list
  if (gameOver) {
    const w = 460;
    const h = 260;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    // Dusk settles over the farm
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A big wooden signboard
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
    for (let py = y + 52; py < y + h; py += 52) screenCtx.fillRect(x, py, w, 1);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 24px monospace";
    label("BANKRUPT — THE FARM IS LOST", cx, y + 40, "#ff7a5c");
    screenCtx.font = "bold 18px monospace";
    label(
      `SURVIVED ${year} YEAR${year === 1 ? "" : "S"}   (£${cash})`,
      cx,
      y + 74,
      "#f5e9c8"
    );
    screenCtx.font = "13px monospace";
    bestScores.forEach((entry, i) => {
      label(
        `${i + 1}.  ${entry.years} YEAR${entry.years === 1 ? " " : "S"}   £${entry.cash}   (map ${entry.map ?? entry.seed ?? "?"})`,
        cx,
        y + 106 + i * 20,
        i === finalRank ? "#ffd94f" : "#e0d0a8"
      );
    });
    label(
      "[S] SWITCH TO SANDBOX, KEEP FARMING   [F1] MENU — NEW GAME",
      cx,
      y + h - 18,
      "#c9e6a8"
    );
    screenCtx.textAlign = "left";
  }

  // Minimap: a wooden panel hanging off the right end of the top bar,
  // flush with the screen edge. Its dark rim starts at the bar's trim in
  // the same color, so the two read as one piece of carpentry.
  screenCtx.drawImage(minimapPanelCanvas, mmX - 8, topH);
  screenCtx.drawImage(minimapCanvas, mmX, mmY, mmW, mmH);
  screenCtx.save();
  screenCtx.beginPath();
  screenCtx.rect(mmX, mmY, mmW, mmH);
  screenCtx.clip();
  // Camera viewport (the minimap shares the iso projection, minus heights,
  // so the projected view rectangle maps straight onto it)
  screenCtx.strokeStyle = "rgba(255,255,255,0.8)";
  screenCtx.lineWidth = 1;
  screenCtx.strokeRect(
    mmX + ((cam.x + MAP_SIZE) / TILE) * mmScale,
    mmY + (cam.y / TILE) * mmScale,
    (VIEW_W / TILE) * mmScale,
    (VIEW_H / TILE) * mmScale
  );
  // Tractor
  const tmx = mmX + ((tractor.x - tractor.y) / TILE + MAP_TILES) * mmScale;
  const tmy = mmY + ((tractor.x + tractor.y) / (2 * TILE)) * mmScale;
  screenCtx.fillStyle = "#ffffff";
  screenCtx.fillRect(tmx - 2, tmy - 2, 4, 4);
  screenCtx.fillStyle = TRACTOR_BODY;
  screenCtx.fillRect(tmx - 1, tmy - 1, 2, 2);
  screenCtx.restore();

  // Field ledger strip under the minimap: a count per working state
  // (stubble, plowed, sown, ripe) with the total at the right end. Each
  // swatch is the state's minimap tile color, so the strip doubles as the
  // minimap's legend.
  screenCtx.drawImage(fieldTallyPanelCanvas, mmX - 8, tallyY);
  const tally = countFieldTiles();
  screenCtx.font = "11px monospace";
  let tallyX = mmX;
  for (const [count, color] of [
    [tally.stubble, MINIMAP_COLORS[1]],
    [tally.plowed, MINIMAP_COLORS[2]],
    [tally.sown, MINIMAP_COLORS[3]],
    [tally.ripe, "#e3c355"],
  ]) {
    screenCtx.fillStyle = "rgba(40,24,12,0.9)"; // swatch backing, like the text shadow
    screenCtx.fillRect(tallyX, tallyY + 5, 8, 8);
    screenCtx.fillStyle = color;
    screenCtx.fillRect(tallyX + 1, tallyY + 6, 6, 6);
    label(String(count), tallyX + 11, tallyY + 13, "#f5e9c8");
    tallyX += 11 + screenCtx.measureText(String(count)).width + 8;
  }
  screenCtx.textAlign = "right";
  label(
    `=${tally.stubble + tally.plowed + tally.sown + tally.ripe}`,
    mmX + mmW,
    tallyY + 13,
    "#ffd94f"
  );
  screenCtx.textAlign = "left";

  // Paused: dusk settles over the farm and a small sign waits for P.
  // The F1 menu draws after this, so it stays readable on top.
  if (paused && !menuOpen) {
    const w = 260;
    const h = 74;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A little wooden sign matching the menu's carpentry
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 24px monospace";
    label("PAUSED", cx, y + 34, "#ffd94f");
    screenCtx.font = "13px monospace";
    label("[P] RESUME", cx, y + 58, "#c9e6a8");
    screenCtx.textAlign = "left";
    screenCtx.font = "11px monospace";
  }

  // Date-jump field: shows the typed digits in an MM-DD mask; Enter
  // fast-forwards the calendar to that date. Red digits mean the last
  // attempt didn't parse as a reachable date.
  if (dateJump !== null && !menuOpen) {
    const w = 280;
    const h = 96;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A little wooden sign matching the menu's carpentry
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 16px monospace";
    label("JUMP TO DATE", cx, y + 26, "#ffd94f");
    const digitAt = (i) => dateJump[i] || "_";
    screenCtx.font = "bold 24px monospace";
    label(
      `${digitAt(0)}${digitAt(1)}-${digitAt(2)}${digitAt(3)}`,
      cx,
      y + 56,
      dateJumpError ? "#ff5040" : "#f5e9c8"
    );
    screenCtx.font = "11px monospace";
    label("[0-9] MONTH-DAY   [ENTER] GO   [ESC] CANCEL", cx, y + 80, "#c9e6a8");
    screenCtx.textAlign = "left";
    screenCtx.font = "11px monospace";
  }

  // Start / F1 menu: map and mode on a little wooden sign. A fresh visit
  // opens it before the clock starts; F1 brings it back later.
  if (menuOpen) {
    const w = 420;
    const h = 256;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 16px monospace";
    label(gameStarted ? "MENU" : "THE HOME FARM", cx, y + 26, "#ffd94f");

    screenCtx.font = "11px monospace";
    label("MAP", cx, y + 46, "#d8c49a");
    screenCtx.fillStyle = "#2e1d10";
    screenCtx.fillRect(x + 90, y + 52, w - 180, 24);
    screenCtx.font = "bold 14px monospace";
    label(
      `« ${menuMap} — ${MAP_PROFILES[menuMap - 1].name.toUpperCase()} »`,
      cx,
      y + 69,
      "#f5e9c8"
    );

    screenCtx.font = "bold 12px monospace";
    const modeRows = [
      ["survival", "SURVIVAL — PAY THE YEARLY TAX, SURVIVE"],
      ["sandbox", "SANDBOX  — NO CLOCK PRESSURE, JUST ROAM"],
    ];
    modeRows.forEach(([m, text], i) => {
      const sel = menuMode === m;
      label((sel ? "» " : "  ") + text, cx, y + 104 + i * 20, sel ? "#ffd94f" : "#e0d0a8");
    });

    screenCtx.font = "11px monospace";
    label(
      `[T] AWAY CLOCK: ${awayClock ? "ON " : "OFF"} — TIME PASSES WHILE THE TAB IS HIDDEN`,
      cx,
      y + 172,
      awayClock ? "#c9e6a8" : "#d8c49a"
    );
    label(
      `[M] MUSIC: ${musicMuted ? "OFF" : "ON "}      [Q] SOUND: ${soundMuted ? "OFF" : "ON "}`,
      cx,
      y + 192,
      "#d8c49a"
    );
    if (menuSaveInfo) {
      label(
        `[C] CONTINUE — ${menuSaveInfo.mode.toUpperCase()}, MAP ${menuSaveInfo.map}, YEAR ${menuSaveInfo.year}`,
        cx,
        y + 212,
        "#c9e6a8"
      );
    }
    label(
      "[←→] MAP   [↑↓] MODE   [R] RANDOM MAP   [ENTER] START" +
        (gameStarted ? "   [ESC] CLOSE" : ""),
      cx,
      y + h - 14,
      "#c9e6a8"
    );
    screenCtx.textAlign = "left";
  }

  if (fpsShown) {
    // Debug readout sits over the open world, so it gets its own dark
    // plate for contrast instead of relying on the stamped shadow alone
    screenCtx.font = "bold 11px monospace";
    screenCtx.textAlign = "left";
    const simRate = mode === "sandbox" ? sandboxClockRate() : 1;
    const text = `${fpsValue} FPS  ${simRate}× SIM`;
    const textW = screenCtx.measureText(text).width;
    screenCtx.fillStyle = "rgba(40,24,12,0.8)";
    screenCtx.fillRect(4, topH + 6, textW + 9, 15);
    label(text, 8, topH + 17, "#ffe89a");
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

// Resume an autosaved run when the URL points at its map and mode. The
// world has just been generated fresh from the seed, so only the tiles the
// player changed need repainting; the season's colors then catch up through
// the usual gradual background repaint.
// A fresh visit opens the start menu: let it offer the autosaved run
if (menuOpen) menuSaveInfo = loadSave();

{
  const s = gameStarted ? loadSave() : null;
  if (s && s.map === MAP_INDEX && s.mode === mode) {
    const dirty = [];
    for (let ty = 0; ty < MAP_TILES; ty++)
      for (let tx = 0; tx < MAP_TILES; tx++)
        if (tiles[ty][tx] !== s.tiles[ty][tx]) dirty.push([tx, ty]);
    for (let ty = 0; ty < MAP_TILES; ty++) {
      tiles[ty] = s.tiles[ty];
      dirs[ty] = s.dirs[ty];
      growth[ty] = s.growth[ty];
    }
    sacks.push(...s.sacks);
    cash = s.cash;
    seeds = s.seeds;
    cargo = s.cargo;
    sold = s.sold;
    fuel = s.fuel === undefined ? FUEL_CAP : s.fuel; // saves from before fuel existed: start full
    year = s.year;
    propertyTax = s.propertyTax;
    timeLeft = s.timeLeft;
    Object.assign(tractor, s.tractor);
    cam.x = projX(tractor.x, tractor.y) - VIEW_W / 2;
    cam.y =
      projY(tractor.x, tractor.y, terrainHeight(tractor.x, tractor.y)) - VIEW_H / 2;
    for (const [tx, ty] of dirty) drawTile(tx, ty);
  }
}

let lastTime = performance.now();
let awayPool = 0; // time the dt cap discarded, waiting to be applied

// FPS readout (Shift+F): frames averaged over half-second windows
let fpsShown = false;
let fpsFrames = 0;
let fpsMs = 0;
let fpsValue = 0;

function loop(now) {
  const frameMs = now - lastTime;
  const dt = Math.min(frameMs / 1000, 0.05);
  lastTime = now;
  fpsFrames++;
  fpsMs += frameMs;
  if (fpsMs >= 500) {
    fpsValue = Math.round((fpsFrames * 1000) / fpsMs);
    fpsFrames = 0;
    fpsMs = 0;
  }
  // The dt cap normally discards time lost to a hidden tab (one big gap on
  // return) or a throttled one (a trickle of ~1s frames); with the away
  // clock on it pools up and is applied to the game clock instead
  awayPool += frameMs / 1000 - dt;
  if (awayClock && awayPool > 0.5) {
    advanceTime(awayPool);
    awayPool = 0;
  } else if (!awayClock) {
    awayPool = 0;
  }
  update(dt);
  updateAudio();
  updateCamera(dt);
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
