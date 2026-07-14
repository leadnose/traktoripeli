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
// hilliness is a multiplier on the hill generator's stock count/height.
// ---------------------------------------------------------------------------

const MAP_PROFILES = [
  { name: "Homestead Plains", seed: 1137, water: [0.03, 0.10], field: [0.45, 0.65], forest: [0.10, 0.25], hilliness: [0.4, 0.6] },
  { name: "River Valley", seed: 1274, water: [0.35, 0.50], field: [0.20, 0.35], forest: [0.15, 0.30], hilliness: [0.8, 1.2] },
  { name: "Highlands", seed: 1411, water: [0.10, 0.20], field: [0.15, 0.30], forest: [0.30, 0.50], hilliness: [1.7, 2.2] },
  { name: "Deep Woods", seed: 1548, water: [0.20, 0.35], field: [0.05, 0.15], forest: [0.85, 1.00], hilliness: [0.8, 1.2] },
  { name: "Patchwork Farm", seed: 1685, water: [0.03, 0.10], field: [0.55, 0.72], forest: [0.00, 0.08], hilliness: [0.4, 0.6] },
  { name: "Lake District", seed: 1822, water: [0.45, 0.60], field: [0.10, 0.20], forest: [0.10, 0.25], hilliness: [0.4, 0.6] },
  { name: "Rolling Hills", seed: 1959, water: [0.10, 0.20], field: [0.30, 0.45], forest: [0.30, 0.50], hilliness: [1.3, 1.7] },
  { name: "Wetlands", seed: 2096, water: [0.35, 0.50], field: [0.05, 0.15], forest: [0.60, 0.80], hilliness: [0.4, 0.6] },
  { name: "Frontier", seed: 2233, water: [0.03, 0.10], field: [0.05, 0.15], forest: [0.00, 0.08], hilliness: [0.8, 1.2] },
  { name: "Wilderness", seed: 2370, water: [0.10, 0.20], field: [0.05, 0.15], forest: [0.85, 1.00], hilliness: [1.7, 2.2] },
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

// Game mode: "survival" rolls year after year — each turning through a
// short snowed-in winter — with a property tax due every Oct 31, and
// "sandbox" rolls the same wintered years with no taxes, no failure and
// no end — just roaming. Chosen in the start menu; reloads carry the mode
// in the URL next to the map number, and a fresh visit (no mode in the URL)
// opens the start menu before anything moves.
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
// into the familiar lazy progression, autumn slows down and turns minor,
// and winter is slower still — sparse, hushed notes over the snow
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
  {
    bpm: 66,
    dur: 1.1,
    chords: [
      { root: 2, minor: true }, // Bm
      { root: -3, minor: true }, // F#m
      { root: -7, minor: false }, // D
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
        MUSIC_SEASONS[seasonQ < 0.33 ? 0 : seasonQ < 0.72 ? 1 : seasonQ <= 1 ? 2 : 3];
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
    !gameOver && !paused && (keys.ArrowUp || keys.ArrowDown || autoThrottling()) ? 1 : 0;
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
    !gameOver && imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > 2;
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
// calendar to that date — through winter into next year in the cyclical
// modes — growing crops and collecting taxes on the way, exactly like the
// away clock would.
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

  // Drive joystick: a single drag reads as two independent axes (throttle
  // and steering) so pushing the knob up-and-left, say, holds ArrowUp and
  // ArrowLeft together — one thumb can accelerate and turn at the same
  // time instead of needing to reach two separate buttons.
  (function setupJoystick() {
    const base = document.getElementById("td-joystick");
    const knob = document.getElementById("td-joystick-knob");
    if (!base || !knob) return;
    const RADIUS = 40; // px the knob can travel from center
    const DEADZONE = 0.35; // fraction of RADIUS before an axis engages
    let pointerId = null;
    const dir = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

    function setDir(key, on) {
      if (dir[key] === on) return;
      dir[key] = on;
      fireKey(on ? "keydown" : "keyup", key);
    }

    function resetAll() {
      for (const key of Object.keys(dir)) setDir(key, false);
      knob.style.transform = "translate(0, 0)";
    }

    function handleMove(e) {
      const rect = base.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(dist, RADIUS);
      const angle = Math.atan2(dy, dx);
      knob.style.transform = `translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;

      const nx = dx / RADIUS;
      const ny = dy / RADIUS;
      setDir("ArrowUp", ny < -DEADZONE);
      setDir("ArrowDown", ny > DEADZONE);
      setDir("ArrowLeft", nx < -DEADZONE);
      setDir("ArrowRight", nx > DEADZONE);
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

// ---------------------------------------------------------------------------
// Farmyard location (needed by the terrain: the yard sits on a flat pad)
// ---------------------------------------------------------------------------

// The farmyard lands somewhere different on every map, kept well away from
// the edges, and the buildings face a random way
const FARM = {
  x: MAP_SIZE * (0.2 + rand() * 0.6),
  y: MAP_SIZE * (0.2 + rand() * 0.6),
  angle: rand() * Math.PI * 2,
};
const FARM_RADIUS = 40; // within this distance farm services are available

function nearFarm() {
  return Math.hypot(tractor.x - FARM.x, tractor.y - FARM.y) < FARM_RADIUS;
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
    cx: MAP_SIZE * (0.1 + rand() * 0.8),
    cy: MAP_SIZE * (0.1 + rand() * 0.8),
    r: 60 + rand() * 100,
    h: (10 + rand() * 16) * HILLINESS,
  });
}

// No flattening under the farmyard: the buildings drape over the natural
// terrain like everything else
function terrainHeight(wx, wy) {
  let h = 0;
  for (const hill of HILLS) {
    const d = Math.hypot(wx - hill.cx, wy - hill.cy);
    if (d < hill.r) h += hill.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / hill.r));
  }
  h = 40 * Math.tanh(h / 40); // soft cap where hills stack
  const m = Math.min(wx, wy, MAP_SIZE - wx, MAP_SIZE - wy);
  const t = Math.max(0, Math.min(1, m / 40));
  return h * t * t * (3 - 2 * t);
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

const EDGE_DEPTH = 10; // thickness of the dirt "cliff" at the map's near edges
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

// Ground colors are seasonal: these are the spring values, and
// updateSeason() rewrites them as the round progresses
let GRASS = "#72ca55";
const GRASS_DOTS = ["#5fb944", "#8adf70", "#97e87e", "#52a63f"];
let DIRT = "#a87e50";
const DIRT_DOTS = ["#8f6940", "#bb9264"];

// The season color wheel, declared here because the initial map paint
// already reads it (through winterDepth): 0 = spring, 0.5 = summer,
// 1 = autumn, 1.5 = midwinter; 2 wraps back onto spring. Continuous —
// mixHex quantizes the blends, so colors still move in tiny ticks.
let seasonQ = 0;
let seasonStep = -1; // sky repaint trigger, on a fine grid of seasonQ
const FLOWER_COLORS = ["#ff9ed2", "#ffffff", "#c9a6ff", "#ffb27d"];

const mp = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y,
});

// Brightness at a world point from the terrain normal against the light
function groundShade(wx, wy) {
  const d = 4;
  const dzdx = (terrainHeight(wx + d, wy) - terrainHeight(wx - d, wy)) / (2 * d);
  const dzdy = (terrainHeight(wx, wy + d) - terrainHeight(wx, wy - d)) / (2 * d);
  const len = Math.hypot(dzdx, dzdy, 1);
  const dot = (-dzdx * LIGHT.x - dzdy * LIGHT.y + LIGHT.z) / len;
  return Math.max(0.4, Math.min(1.25, 0.3 + dot));
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

// Clip the map context to the ground diamond (caller does save/restore)
function clipMapDiamond() {
  mapCtx.beginPath();
  for (const [ex, ey] of [[0, 0], [MAP_SIZE, 0], [MAP_SIZE, MAP_SIZE], [0, MAP_SIZE]]) {
    const c = mp(ex, ey);
    if (ex === 0 && ey === 0) mapCtx.moveTo(c.x, c.y);
    else mapCtx.lineTo(c.x, c.y);
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
    mapCtx.fillStyle = shade("#a87e50", 1);
    farmYardPath(fc);
    mapCtx.fill();
    mapCtx.strokeStyle = MAP_INK;
    mapCtx.lineWidth = 1;
    mapCtx.stroke();
    mapCtx.fillStyle = shade("#8f6940", 1);
    for (const p of yardPixels) mapCtx.fillRect(p.x, p.y, 1, 1);
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
    subQuads(GRASS);

    // Speckles: grass tufts
    for (let i = 0; i < 8; i++) {
      const p = mp((tx + tr()) * TILE, (ty + tr()) * TILE);
      mapCtx.fillStyle = shade(GRASS_DOTS[(tr() * GRASS_DOTS.length) | 0], kc);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    // Little meadow flowers: four petals around a yellow heart; forests
    // keep their floor bare, and deep winter buries the meadows' too
    if (!forestTiles.has(ty * MAP_TILES + tx) && tr() < 0.5 && winterDepth() < 0.4) {
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
        mapCtx.fillStyle = shade("#3d7dc4", 1); // matches the water fill
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
    mapCtx.fillStyle = shade("#3d7dc4", 1);
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

    mapCtx.fillStyle = shade("#6fa9dd", 1); // ripples
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
  // dirt tiles thanks to the sub-quads' own outline overdraw
  subQuads(DIRT);

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
    mapCtx.strokeStyle = shade("#8a6540", kc);
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
    // Speckles: dirt clods
    for (let i = 0; i < 8; i++) {
      const p = mp((tx + tr()) * TILE, (ty + tr()) * TILE);
      mapCtx.fillStyle = shade(DIRT_DOTS[(tr() * DIRT_DOTS.length) | 0], kc);
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
// themselves (point sequences) so the delivery van can drive the network.
// The field patch rectangles are kept for the hedgerows planted along their
// edges.
const roads = [];
const roadSamples = [];
const roadTiles = new Set();
const patches = [];
const forestTiles = new Set(); // tile indexes under forest stands
const tileKey = (wx, wy) => ((wy / TILE) | 0) * MAP_TILES + ((wx / TILE) | 0);
const ROAD_COLOR = "#c09a66";
const BRIDGE_COLOR = "#9a7442"; // road surface where it crosses water
const DITCH_COLOR = "#3a6ea8"; // water-filled drainage ditches
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
  let waterTiles = 0;
  const setWater = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return;
    if (!awayFromFarm(tx, ty)) return;
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
      dir += Math.max(-0.12, Math.min(0.12, bestDir - dir));
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
  // from the nearest existing road to each field. Roads run octilinearly —
  // one 45-degree diagonal leg and one axis-aligned leg, in either order —
  // like grid-country farm roads.
  const net = [{ x: FARM.x, y: FARM.y }];

  const traceRoad = (from, tx, ty, r) => {
    const dx = tx - from.x;
    const dy = ty - from.y;
    const diag = Math.min(Math.abs(dx), Math.abs(dy));
    const legs = [
      {
        ux: Math.sign(dx) * Math.SQRT1_2,
        uy: Math.sign(dy) * Math.SQRT1_2,
        len: diag * Math.SQRT2,
      },
      Math.abs(dx) > Math.abs(dy)
        ? { ux: Math.sign(dx), uy: 0, len: Math.abs(dx) - diag }
        : { ux: 0, uy: Math.sign(dy), len: Math.abs(dy) - diag },
    ];
    if (rand() < 0.5) legs.reverse(); // bend early or bend late
    const pts = [];
    let x = from.x;
    let y = from.y;
    outer: for (const leg of legs) {
      if (leg.len < 1) continue;
      const dir = Math.atan2(leg.uy, leg.ux);
      for (let done = 0; done < leg.len; ) {
        const step = Math.min(3, leg.len - done);
        done += step;
        x += leg.ux * step;
        y += leg.uy * step;
        // Roads may run a little past the map edge; painting clips them there
        if (x < -24 || x > MAP_SIZE + 24 || y < -24 || y > MAP_SIZE + 24) break outer;
        pts.push({ x, y, dir });
      }
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
    const ax = Math.max(p.px * TILE - 14, Math.min((p.px + p.pw) * TILE + 14, from.x));
    const ay = Math.max(p.py * TILE - 14, Math.min((p.py + p.ph) * TILE + 14, from.y));
    if (Math.hypot(ax - from.x, ay - from.y) >= 10) traceRoad(from, ax, ay, 2.0);

    // Short straight entry path from the road up to the field's edge
    const gate = nearestRoadPoint(c.x, c.y);
    const bx = Math.max(p.px * TILE, Math.min((p.px + p.pw) * TILE, gate.x));
    const by = Math.max(p.py * TILE, Math.min((p.py + p.ph) * TILE, gate.y));
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

  // Keep the farmyard clear of fields
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const d = Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y);
      if (d < FARM_RADIUS + 24 && tiles[ty][tx] !== 4) tiles[ty][tx] = 0;
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
    if (Math.hypot((cx + 0.5) * TILE - FARM.x, (cy + 0.5) * TILE - FARM.y) < FARM_RADIUS + 40)
      continue;
    const r = 2.5 + rand() * 4;
    for (let ty = Math.max(0, Math.floor(cy - r)); ty <= Math.min(MAP_TILES - 1, Math.ceil(cy + r)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - r)); tx <= Math.min(MAP_TILES - 1, Math.ceil(cx + r)); tx++)
        if (
          tiles[ty][tx] === 0 &&
          Math.hypot(tx - cx, ty - cy) < r * (0.7 + rand() * 0.6) &&
          Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) > FARM_RADIUS + 40
        )
          forestTiles.add(ty * MAP_TILES + tx);
  }

  // Back-to-front so nearer hills paint over the ones behind them. paintTile
  // skips the per-tile dithering: the whole canvas gets one pass at the end.
  for (let s = 0; s <= 2 * (MAP_TILES - 1); s++) {
    for (let ty = Math.max(0, s - MAP_TILES + 1); ty <= Math.min(MAP_TILES - 1, s); ty++) {
      paintTile(s - ty, ty);
    }
  }

  // Dirt cliffs along the two near (bottom) edges of the map diamond. They
  // go down before the ink so a border tile's repaint reproduces the same
  // layering: cliff below, its boundary line on top.
  const east = mp(MAP_SIZE, 0);
  const south = mp(MAP_SIZE, MAP_SIZE);
  const west = mp(0, MAP_SIZE);
  for (const [a, b, color] of [
    [east, south, "#8a6540"],
    [south, west, "#6f4d2c"],
  ]) {
    mapCtx.fillStyle = shade(color, 1);
    mapCtx.beginPath();
    mapCtx.moveTo(a.x, a.y);
    mapCtx.lineTo(b.x, b.y);
    mapCtx.lineTo(b.x, b.y + EDGE_DEPTH);
    mapCtx.lineTo(a.x, a.y + EDGE_DEPTH);
    mapCtx.closePath();
    mapCtx.fill();
  }

  // Close the island's ink silhouette under the cliffs; their top edge is
  // drawn by the border tiles' own boundary lines
  mapCtx.strokeStyle = INK;
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  mapCtx.moveTo(east.x, east.y);
  mapCtx.lineTo(east.x, east.y + EDGE_DEPTH);
  mapCtx.lineTo(south.x, south.y + EDGE_DEPTH);
  mapCtx.lineTo(west.x, west.y + EDGE_DEPTH);
  mapCtx.lineTo(west.x, west.y);
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
    mapCtx.fillStyle = shade("#a37e4e", 1);
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
  mapCtx.fillStyle = shade("#a87e50", 1);
  farmYardPath(fc);
  mapCtx.fill();
  mapCtx.strokeStyle = MAP_INK;
  mapCtx.lineWidth = 1;
  mapCtx.stroke();
  mapCtx.fillStyle = shade("#8f6940", 1);
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

// grass, field, plowed, seeded, water; ripe crops turn gold. Plowed is a
// clearly darker brown than stubble so the two read apart at a glance,
// both here and in the field ledger's legend swatches.
const MINIMAP_COLORS = ["#4fa83e", "#a87e50", "#6b4526", "#90c83c", "#3d7dc4"];

function minimapTile(tx, ty) {
  const type = tiles[ty][tx];
  let color = MINIMAP_COLORS[type];
  if (type === 0 && forestTiles.has(ty * MAP_TILES + tx)) color = "#2f7a2c";
  if (type === 3 && cropStage(growth[ty][tx]) >= 3) color = "#e3c355";
  minimapCtx.fillStyle = shade(color, 1);
  minimapCtx.fillRect(tx - ty + MAP_TILES - 1, (tx + ty) >> 1, 2, 1);
}

makeMap();

for (let ty = 0; ty < MAP_TILES; ty++)
  for (let tx = 0; tx < MAP_TILES; tx++) minimapTile(tx, ty);

// Roads (never under field tiles, so tile updates can't erase them)
minimapCtx.fillStyle = shade("#c09a66", 1);
for (const p of roadSamples)
  minimapCtx.fillRect(
    Math.round((p.x - p.y) / TILE) + MAP_TILES,
    Math.round((p.x + p.y) / (2 * TILE)),
    1,
    1
  );

// Farm marker
minimapCtx.fillStyle = "#e04030";
minimapCtx.fillRect(
  Math.round((FARM.x - FARM.y) / TILE) + MAP_TILES - 1,
  Math.round((FARM.x + FARM.y) / (2 * TILE)) - 1,
  3,
  3
);

// ---------------------------------------------------------------------------
// Lollipop trees scattered over the meadows
// ---------------------------------------------------------------------------

const TREE_BOXES = [
  { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9, z0: 0.0, z1: 4.5, color: "#8a5a36" }, // trunk
];

// Cloud-shaped canopy: one big blob with two smaller ones tucked against it.
// Spring colors; updateSeason() recolors them through summer into autumn,
// and in the cyclical modes on under a cap of winter snow.
const TREE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 7.2, r: 4.2, color: "#57b754" },
  { blob: true, x: 1.5, y: -1.5, z: 9.6, r: 2.7, color: "#68c765", bias: 0.05 },
  { blob: true, x: -1.3, y: 1.3, z: 10.2, r: 2.1, color: "#7cd678", bias: 0.1 },
];

// Conifers are evergreen: their colors stay put through the seasons.
// Spruce: a tall narrow cone of tapering tiers.
const CONIFER_BOXES = [
  { x0: -0.7, x1: 0.7, y0: -0.7, y1: 0.7, z0: 0.0, z1: 2.4, color: "#7a4f30" }, // trunk
];
const SPRUCE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 3.0, r: 2.6, color: "#2c6330" },
  { blob: true, x: 0, y: 0, z: 5.6, r: 2.0, color: "#316936", bias: 0.05 },
  { blob: true, x: 0, y: 0, z: 7.9, r: 1.5, color: "#376f3a", bias: 0.1 },
  { blob: true, x: 0, y: 0, z: 9.9, r: 1.0, color: "#3d753e", bias: 0.15 },
  { blob: true, x: 0, y: 0, z: 11.4, r: 0.55, color: "#427a42", bias: 0.2 },
];
// Fir: broader and softer, with a blue-green cast
const FIR_BLOBS = [
  { blob: true, x: 0, y: 0, z: 3.0, r: 3.2, color: "#35714b" },
  { blob: true, x: 0, y: 0, z: 5.8, r: 2.5, color: "#3a7850", bias: 0.05 },
  { blob: true, x: 0, y: 0, z: 8.3, r: 1.8, color: "#407e54", bias: 0.1 },
  { blob: true, x: 0, y: 0, z: 10.3, r: 1.0, color: "#468457", bias: 0.15 },
];

const TREE_KINDS = [
  { boxes: TREE_BOXES, blobs: TREE_BLOBS }, // deciduous, turns with the seasons
  { boxes: CONIFER_BOXES, blobs: SPRUCE_BLOBS },
  { boxes: CONIFER_BOXES, blobs: FIR_BLOBS },
];

const trees = [];

// Dense stands on the forest tiles; roads passing through keep clearings
for (const k of forestTiles) {
  const ftx = k % MAP_TILES;
  const fty = (k / MAP_TILES) | 0;
  const n = 2 + ((rand() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const wx = (ftx + 0.05 + rand() * 0.9) * TILE;
    const wy = (fty + 0.05 + rand() * 0.9) * TILE;
    if (roadTiles.has(tileKey(wx, wy))) continue;
    // Forests are conifer-heavy: birches among the spruce and fir
    const r = rand();
    trees.push({
      wx,
      wy,
      angle: rand() * Math.PI * 2,
      kind: r < 0.35 ? 0 : r < 0.7 ? 1 : 2,
    });
  }
}

// Lone trees scattered over the open meadows
const loneTarget = trees.length + 70;
for (let attempts = 0; trees.length < loneTarget && attempts < 5000; attempts++) {
  const wx = 24 + rand() * (MAP_SIZE - 48);
  const wy = 24 + rand() * (MAP_SIZE - 48);
  if (tileTypeAt(wx, wy) !== 0) continue; // grass only, never on a field
  if (forestTiles.has(tileKey(wx, wy))) continue; // stands are planted above
  if (roadTiles.has(tileKey(wx, wy))) continue; // and never on a road
  if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 30) continue;
  if (trees.some((t) => Math.hypot(t.wx - wx, t.wy - wy) < 20)) continue;
  // Open meadows favor lone deciduous trees, with the odd conifer
  const r = rand();
  trees.push({
    wx,
    wy,
    angle: rand() * Math.PI * 2,
    kind: r < 0.6 ? 0 : r < 0.85 ? 1 : 2,
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

// Each variant is [spring, summer, autumn, winter]
const BUSH_COLORS = [
  ["#4db554", "#3f9e3e", "#b07a35", "#dfe9ee"],
  ["#5cc25f", "#4fae4a", "#c08d3a", "#e7eff3"],
  ["#45a94b", "#379139", "#9c6a2e", "#d6e2e9"],
];
const bushes = [];
for (let attempts = 0; bushes.length < 110 && attempts < 6000; attempts++) {
  const wx = 20 + rand() * (MAP_SIZE - 40);
  const wy = 20 + rand() * (MAP_SIZE - 40);
  if (tileTypeAt(wx, wy) !== 0) continue;
  if (roadTiles.has(tileKey(wx, wy))) continue;
  if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 12) continue;
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
// Each variant is [spring, summer, autumn, winter]
const HEDGE_COLORS = [
  ["#3f9440", "#357f36", "#96612d", "#cfdde5"],
  ["#489e45", "#3d8f3c", "#a5722f", "#d7e3ea"],
  ["#3a8a3c", "#2f7531", "#8a5c2a", "#c7d6df"],
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
    for (let t = 0; t < 20; t++) {
      const cx = hx + (rand() - 0.5) * 24;
      const cy = hy + (rand() - 0.5) * 24;
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

// The farm always keeps one herd of each grazing species close by
for (const species of ["cow", "sheep", "horse", "pig", "goat"]) {
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

// Plus a few wild-placed herds further out
for (let placed = 0, tries = 0; placed < 6 && tries < 400; tries++) {
  const hx = 30 + rand() * (MAP_SIZE - 60);
  const hy = 30 + rand() * (MAP_SIZE - 60);
  if (tileTypeAt(hx, hy) !== 0) continue;
  if (forestTiles.has(tileKey(hx, hy)) || roadTiles.has(tileKey(hx, hy))) continue;
  if (Math.hypot(hx - FARM.x, hy - FARM.y) < FARM_RADIUS + 24) continue;
  const r = rand();
  const species =
    r < 0.2 ? "cow" : r < 0.4 ? "sheep" : r < 0.6 ? "horse" : r < 0.8 ? "pig" : "goat";
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
  I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  P: ["##.", "#.#", "##.", "#..", "#.."],
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

// MAATILA where the farm's own road leaves the yard
if (roads.length && roads[0].pts.length > 6) placeSignBeside("MAATILA", roads[0].pts[5]);
else addSign("MAATILA", FARM.x + 24, FARM.y + 24);

// SILTA on the approach to a bridge, for up to two crossings
{
  let posted = 0;
  for (const r of roads) {
    if (posted >= 2) break;
    if (r.entry) continue;
    for (let i = 4; i < r.pts.length; i++) {
      if (tileTypeAt(r.pts[i].x, r.pts[i].y) !== 4) continue;
      if (tileTypeAt(r.pts[i - 2].x, r.pts[i - 2].y) === 4) continue; // mid-crossing
      if (placeSignBeside("SILTA", r.pts[i - 4])) posted++;
      break; // one sign per road
    }
  }
}

// LAMPI at the waterside nearest the farm — where the herds go to drink
{
  const near = nearestShoreSpot(FARM.x, FARM.y);
  if (near && near.dist < 260) {
    const { spot, dist } = near;
    // A step inland, so it stands clear of the bank where the herds crowd
    const nx = spot.x + ((FARM.x - spot.x) / dist) * 8;
    const ny = spot.y + ((FARM.y - spot.y) / dist) * 8;
    if (tileTypeAt(nx, ny) === 0) addSign("LAMPI", nx, ny);
    else addSign("LAMPI", spot.x, spot.y);
  }
}

function updateAnimals(dt) {
  for (const a of animals) {
    const spec = ANIMAL_SPECS[a.species];
    const tractorDist = Math.hypot(a.wx - tractor.x, a.wy - tractor.y);
    const walkable = (wx, wy) => {
      if (tileTypeAt(wx, wy) !== 0) return false;
      if (!spec.roads && roadTiles.has(tileKey(wx, wy))) return false;
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
    // The delivery van spooks animals just like the tractor does: flee
    // whichever machine is nearer
    let spook = tractor;
    let spookDist = tractorDist;
    let spookSpeed = Math.abs(tractor.speed);
    if (van.on) {
      const vd = Math.hypot(a.wx - van.x, a.wy - van.y);
      if (vd < spookDist) {
        spook = van;
        spookDist = vd;
        spookSpeed = van.moving;
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
      const want = spookSpeed > 3 ? Math.atan2(fy, fx) : Math.atan2(tdy, tdx);
      const d = Math.atan2(Math.sin(want - a.angle), Math.cos(want - a.angle));
      a.angle += Math.max(-spec.fleeTurn * dt, Math.min(spec.fleeTurn * dt, d));
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
    // Amble about, turning back toward the herd's home spot when strayed
    a.angle += (rand() - 0.5) * spec.turn * dt;
    if (Math.hypot(a.wx - a.hx, a.wy - a.hy) > spec.range) {
      const want = Math.atan2(a.hy - a.wy, a.hx - a.wx);
      const d = Math.atan2(Math.sin(want - a.angle), Math.cos(want - a.angle));
      a.angle += Math.max(-2.5 * dt, Math.min(2.5 * dt, d));
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
// chicken flock and farm cat/dog keep to the yard, and ducks already live
// at the shore, so there's nowhere for their routine to send them
const STATIONARY_HERDS = new Set(["chicken", "cat", "dog", "duck"]);

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
// The delivery van: putters around the road network all day, pauses at dead
// ends to drop something off, and waits politely for the tractor to pass.
// Road points are 3 world units apart, so pts index maps to distance.
// ---------------------------------------------------------------------------

const VAN_SPEED = 13;

const VAN_BOXES = [
  { x0: -3.6, x1: 0.6, y0: -2.0, y1: 2.0, z0: 1.3, z1: 5.6, color: "#e8a92e" }, // cargo box
  { x0: 0.6, x1: 3.4, y0: -1.8, y1: 1.8, z0: 1.3, z1: 3.4, color: "#e8a92e" }, // hood
  { x0: 0.6, x1: 2.4, y0: -1.6, y1: 1.6, z0: 3.4, z1: 4.9, color: "#bfeaf5" }, // cab glass
  { x0: 0.4, x1: 2.6, y0: -1.8, y1: 1.8, z0: 4.9, z1: 5.5, color: "#f2e6cc" }, // cab roof
];

const VAN_WHEELS = [
  { x: -2.3, y0: 2.0, y1: 2.8, z: 1.0, r: 1.0 },
  { x: -2.3, y0: -2.8, y1: -2.0, z: 1.0, r: 1.0 },
  { x: 2.3, y0: 1.8, y1: 2.6, z: 1.0, r: 1.0 },
  { x: 2.3, y0: -2.6, y1: -1.8, z: 1.0, r: 1.0 },
];

// The van's driver sits at the cab glass box's local depth center (x 1.5)
// with small biases, so the painter's sort always puts him just in front
// of the glass (depth 4.15) and behind the roof (5.2) at every heading
const VAN_DRIVER = [
  { blob: true, x: 1.5, y: 0, z: 3.9, r: 0.7, color: "#f2c091", bias: 0.5 }, // head
  { blob: true, x: 1.5, y: 0, z: 4.5, r: 0.55, color: "#4a6fa5", bias: 0.55 }, // cap
];

const van = { on: false, x: 0, y: 0, angle: 0, road: null, seg: 0, dir: 1, pause: 0, moving: 0 };

// Start somewhere along the network
{
  const usable = roads.filter((r) => r.pts.length > 4);
  if (usable.length) {
    van.road = usable[(rand() * usable.length) | 0];
    van.seg = 1 + ((rand() * (van.road.pts.length - 2)) | 0);
    van.dir = rand() < 0.5 ? 1 : -1;
    const p = van.road.pts[van.seg];
    van.x = p.x;
    van.y = p.y;
    van.angle = p.dir + (van.dir < 0 ? Math.PI : 0);
    van.on = true;
  }
}

function updateVan(dt) {
  if (!van.on) return;
  if (van.pause > 0) {
    van.pause -= dt;
    van.moving = 0;
    return;
  }
  // Wait for the tractor to pass rather than drive through it
  if (Math.hypot(tractor.x - van.x, tractor.y - van.y) < 10) {
    van.moving = 0;
    return;
  }
  van.moving = VAN_SPEED;
  van.seg += (van.dir * VAN_SPEED * dt) / 3;
  const pts = van.road.pts;
  if (van.seg <= 0 || van.seg >= pts.length - 1) {
    // Reached an end of this road: make the delivery, then take any road
    // passing the spot — one of them is usually the road back
    van.seg = Math.max(0, Math.min(pts.length - 1, van.seg));
    const end = pts[Math.round(van.seg)];
    van.pause = 2.5 + rand() * 3;
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
      : { road: van.road, seg: Math.round(van.seg), dir: -van.dir };
    van.road = pick.road;
    van.seg = pick.seg;
    van.dir = pick.dir;
    return;
  }
  const i = Math.floor(van.seg);
  const f = van.seg - i;
  const a = pts[i];
  const b = pts[i + 1];
  van.x = a.x + (b.x - a.x) * f;
  van.y = a.y + (b.y - a.y) * f;
  // Ease the heading toward the direction of travel (never snap)
  const want = Math.atan2((b.y - a.y) * van.dir, (b.x - a.x) * van.dir);
  const d = Math.atan2(Math.sin(want - van.angle), Math.cos(want - van.angle));
  van.angle += Math.max(-4 * dt, Math.min(4 * dt, d));
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
const HUB = "#f7e8b8";

// Styled after the old workhorse of Nordic farmyards: deep red bodywork
// riding on flint-gray running gear, a hood tapering into the grille, a
// bare pan seat between flat fenders, and a muffler halfway up the stack
const TRACTOR_RED = "#d64535";

const BOXES = [
  { x0: -7.0, x1: -3.4, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // frame rail, rear run
  { x0: -3.4, x1: -0.6, y0: -1.6, y1: 1.6, z0: 2.5, z1: 5.2, color: "#6e6e6e" }, // gearbox hump amidships, one higher
  { x0: -0.6, x1: 3.0, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // frame rail, front run
  { x0: -7.0, x1: -3.4, y0: -3.0, y1: 3.0, z0: 4.2, z1: 6.0, color: TRACTOR_RED }, // body platform, rear
  { x0: -3.4, x1: -0.6, y0: -3.0, y1: 3.0, z0: 5.2, z1: 6.0, color: TRACTOR_RED }, // body platform, thinner over the hump
  { x0: -0.6, x1: 3.0, y0: -3.0, y1: 3.0, z0: 4.2, z1: 6.0, color: TRACTOR_RED }, // body platform, front
  { x0: -5.0, x1: -4.0, y0: -2.9, y1: 2.9, z0: 2.6, z1: 3.4, color: "#6e6e6e" }, // rear axle out to the big wheels
  { x0: 4.6, x1: 5.4, y0: -2.2, y1: 2.2, z0: 1.4, z1: 2.5, color: "#6e6e6e" }, // front axle under the engine
  { x0: 3.0, x1: 6.2, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // engine block, exposed at the sides
  { x0: 3.0, x1: 4.8, y0: -2.2, y1: 2.2, z0: 4.2, z1: 5.3, color: TRACTOR_RED }, // hood lid, rear half
  { x0: 4.8, x1: 6.2, y0: -1.9, y1: 1.9, z0: 4.2, z1: 5.1, color: TRACTOR_RED }, // hood lid tapering toward the front
  { x0: 6.2, x1: 7.0, y0: -1.5, y1: 1.5, z0: 2.5, z1: 4.3, color: "#c03a2c" }, // nose, stepped down for a snub front
  { x0: 7.0, x1: 7.4, y0: -1.3, y1: 1.3, z0: 2.6, z1: 4.1, color: "#5a5148" }, // radiator grille
  { x0: -7.9, x1: -7.0, y0: -0.8, y1: 0.8, z0: 2.8, z1: 3.9, color: "#6b6b6b" }, // hitch block; implement drawbars butt against it
  { x0: -6.2, x1: -2.8, y0: 3.0, y1: 5.4, z0: 6.0, z1: 6.7, color: TRACTOR_RED }, // rear fender L
  { x0: -6.2, x1: -2.8, y0: -5.4, y1: -3.0, z0: 6.0, z1: 6.7, color: TRACTOR_RED }, // rear fender R
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
  { x0: -10.2, x1: -8.8, y0: -4.6, y1: 4.6, z0: 3.4, z1: 4.6, color: "#d94a2e" }, // beam
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  PLOW_BOXES.push({
    x0: -10.6, x1: -9.4, y0: yc - 0.55, y1: yc + 0.55, z0: 0.3, z1: 3.4,
    color: "#54565a", // tine
  });
}

const SEEDER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.4, x1: -8.6, y0: -4.6, y1: 4.6, z0: 3.2, z1: 4.4, color: "#f0b322" }, // frame
  { x0: -10.2, x1: -8.8, y0: -3.9, y1: -1.7, z0: 4.4, z1: 6.4, color: "#ffd04a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: -1.1, y1: 1.1, z0: 4.4, z1: 6.4, color: "#ffd04a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: 1.7, y1: 3.9, z0: 4.4, z1: 6.4, color: "#ffd04a" }, // hopper
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  SEEDER_BOXES.push({
    x0: -10.0, x1: -9.2, y0: yc - 0.35, y1: yc + 0.35, z0: 0.6, z1: 3.2,
    color: "#54565a", // coulter disc
  });
}

const HARVESTER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -13.0, x1: -8.6, y0: -4.8, y1: 4.8, z0: 2.2, z1: 8.0, color: "#4cae4f" }, // body
  { x0: -12.4, x1: -11.2, y0: -4.2, y1: 4.2, z0: 8.0, z1: 9.4, color: "#3c8c40" }, // grain tank
  { x0: -8.6, x1: -7.4, y0: -4.8, y1: 4.8, z0: 0.4, z1: 2.6, color: "#d94a2e" }, // header reel
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
const FARM_BOXES = [
  { x0: -16.0, x1: 2.0, y0: -12.0, y1: 2.0, z0: 0.0, z1: 9.0, color: "#d15845" }, // barn
  { x0: -17.5, x1: 3.5, y0: -13.5, y1: 3.5, z0: 9.0, z1: 12.0, color: "#7a4a32" }, // barn roof
  { x0: -7.5, x1: -3.5, y0: 1.9, y1: 2.3, z0: 0.0, z1: 6.0, color: "#f7e8d8" }, // barn door
  { x0: 8.0, x1: 17.0, y0: -9.0, y1: 0.0, z0: 0.0, z1: 20.0, color: "#c6ced6" }, // silo
];

// Round red dome on the silo
const FARM_SHAPES = [{ blob: true, x: 12.5, y: -4.5, z: 20.0, r: 4.0, color: "#d94a2e" }];

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
    const wx = ox + lx * cos - ly * sin;
    const wy = oy + lx * sin + ly * cos;
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
    const wx = ox + lx * cos - ly * sin;
    const wy = oy + lx * sin + ly * cos;
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
      const wx = ox + lx * cos - ly * sin;
      const wy = oy + lx * sin + ly * cos;
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
  if (van.on && onScreen(van.x, van.y, camX, camY))
    shadowQuad(van.x, van.y, van.angle, -4, 4, 2.8);
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
  const bob = Math.abs(tractor.speed) > 2 ? Math.sin(worldTime * 11) * 0.22 : 0;
  for (const s of DRIVER_SHAPES) s.z = s.rest + bob;
  makeRoundItems(items, DRIVER_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeItems(items, impBoxes, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeWheels(items, imp.wheels, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeItems(items, FARM_BOXES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  makeRoundItems(items, FARM_SHAPES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  if (van.on && onScreen(van.x, van.y, camX, camY)) {
    makeItems(items, VAN_BOXES, van.x, van.y, van.angle, 0, camX, camY);
    makeWheels(items, VAN_WHEELS, van.x, van.y, van.angle, 0, camX, camY);
    makeRoundItems(items, VAN_DRIVER, van.x, van.y, van.angle, 0, camX, camY);
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

  const cos = Math.cos(tractor.angle);
  const sin = Math.sin(tractor.angle);
  for (const wheel of TRACK_WHEELS) {
    const wx = tractor.x + wheel.x * cos - wheel.y * sin;
    const wy = tractor.y + wheel.x * sin + wheel.y * cos;
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
// Seasons: the round runs from spring through summer into autumn, and the
// cyclical modes keep going through a snowy winter that melts back into
// spring. Colors interpolate around four keyframes, and the ground takes
// the new colors gradually as a few random tiles repaint every frame.
// ---------------------------------------------------------------------------

const GRASS_SEASONS = ["#72ca55", "#55b043", "#bda355", "#e9f1f5"];
const GRASS_DOT_SEASONS = [
  ["#5fb944", "#47a136", "#a89043", "#d8e5ec"],
  ["#8adf70", "#6cc957", "#cdb45e", "#f6fafc"],
  ["#97e87e", "#78d364", "#d9c06a", "#ffffff"],
  ["#52a63f", "#3f8f31", "#96813c", "#cfdfe8"],
];
// Bare fields stay brown until the snow settles on them
const DIRT_SEASONS = ["#a87e50", "#a87e50", "#a87e50", "#e2eaee"];
const DIRT_DOT_SEASONS = [
  ["#8f6940", "#8f6940", "#8f6940", "#c9d8e0"],
  ["#bb9264", "#bb9264", "#bb9264", "#f2f7fa"],
];
const TREE_BLOB_SEASONS = [
  ["#57b754", "#4fae4a", "#c67b2e", "#dde9ee"],
  ["#68c765", "#5fc257", "#d99a33", "#eaf2f5"],
  ["#7cd678", "#72d367", "#e8b84a", "#f6fafc"],
];
const SKY_TOP_SEASONS = ["#7ac9ef", "#6fc3e8", "#8fb8d8", "#9db9cf"];
const SKY_BOTTOM_SEASONS = ["#c8ecf8", "#c2e8f2", "#ecdcc0", "#e9eef2"];

// The round is presented as a calendar: April 1st through October 31st,
// and in the cyclical modes the winter break carries it on to March 31st
const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SEASON_DAYS = 213; // days from Apr 1 to Oct 31
const WINTER_DAYS = 150; // days from Nov 1 to Mar 31
const SEASON_BAR_COLORS = ["#6fce58", "#4fae4a", "#d99a33", "#eef4f7"];

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

function seasonHex(colors) {
  const seg = Math.min(3, (seasonQ * 2) | 0);
  return mixHex(colors[seg], colors[(seg + 1) % 4], seasonQ * 2 - seg);
}

// How deep in the snow the world is: 0 outside winter, 1 at midwinter
function winterDepth() {
  return seasonQ <= 1 ? 0 : Math.max(0, 1 - Math.abs(seasonQ - 1.5) * 2);
}

function updateSeason() {
  // The color wheel runs 0→1 spring to autumn over the round, then 1→2
  // through the winter break and wraps back onto spring green. It moves
  // continuously every frame; the blends themselves are quantized by
  // mixHex's cache, so trees, bushes and sky glide instead of ticking.
  seasonQ =
    winterLeft > 0
      ? 1 + Math.min(1, Math.max(0, 1 - winterLeft / WINTER_TIME))
      : Math.min(1, Math.max(0, 1 - timeLeft / ROUND_TIME));
  GRASS = seasonHex(GRASS_SEASONS);
  DIRT = seasonHex(DIRT_SEASONS);
  for (let i = 0; i < GRASS_DOTS.length; i++)
    GRASS_DOTS[i] = seasonHex(GRASS_DOT_SEASONS[i]);
  for (let i = 0; i < DIRT_DOTS.length; i++)
    DIRT_DOTS[i] = seasonHex(DIRT_DOT_SEASONS[i]);
  for (let i = 0; i < TREE_BLOBS.length; i++)
    TREE_BLOBS[i].color = seasonHex(TREE_BLOB_SEASONS[i]);
  // The sky is a full-canvas dithered repaint, so it only redraws on a
  // step grid — fine enough that each redraw is an invisible nudge even
  // at winter's pace
  const step = Math.round(seasonQ * 128);
  if (step !== seasonStep) {
    seasonStep = step;
    paintSky();
  }
  // The ground turns gradually: random tiles repaint each frame with the
  // current colors (wheel marks survive: drawTile restamps them). Winter
  // moves the colors ~7x faster than the round does, so it churns more
  // tiles per frame to keep the patchwork spread just as tight.
  const repaints = winterLeft > 0 ? 24 : 8;
  for (let i = 0; i < repaints; i++) {
    drawTile((rand() * MAP_TILES) | 0, (rand() * MAP_TILES) | 0);
  }
}

// ---------------------------------------------------------------------------
// Sky: gradient, a friendly sun, and puffy clouds drifting past the island
// ---------------------------------------------------------------------------

let worldTime = 0;

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
  ctx.fillStyle = "rgba(252,247,235,0.92)"; // paper-white, matching the palette
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
// Snowfall: a light screen-space flurry while winter holds the farm. The
// flakes are laid out by golden-ratio hops instead of the seeded RNG, so
// world generation stays byte-identical for a given seed.
// ---------------------------------------------------------------------------

const SNOWFLAKES = [];
for (let i = 0; i < 70; i++) {
  SNOWFLAKES.push({
    x: ((i * 0.618034) % 1) * (VIEW_W + 40),
    y: ((i * 0.381966) % 1) * VIEW_H,
    speed: 14 + ((i * 7) % 13),
    sway: (i * 2.399963) % (Math.PI * 2), // golden angle, in radians
    size: i % 3 === 0 ? 2 : 1,
  });
}

function drawSnow(camX, camY) {
  const depth = winterDepth();
  if (depth <= 0) return;
  // The flurry builds as the snow settles and thins away through the melt
  const n = Math.ceil(SNOWFLAKES.length * Math.min(1, depth * 2));
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.5 + 0.4 * depth;
  const wrapX = VIEW_W + 40;
  for (let i = 0; i < n; i++) {
    const f = SNOWFLAKES[i];
    const sx =
      ((((f.x + Math.sin(worldTime * 0.8 + f.sway) * 14 - camX * 0.4) % wrapX) +
        wrapX) %
        wrapX) -
      20;
    const sy =
      (((f.y + worldTime * f.speed - camY * 0.4) % VIEW_H) + VIEW_H) % VIEW_H;
    ctx.fillRect(sx | 0, sy | 0, f.size, f.size);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Weather: on top of the season cycle, the growing season occasionally turns
// to a rainy spell or a dry one. Rain washes the view a little grey and
// streaks past in screen space like the snow does, and softens the ground
// underfoot (a mild tractor speed cap, slower crop growth); drought is the
// same slow-growth spell with no rain and a parched tint instead — never a
// hard stop, just an occasional stretch that asks for a little patience.
// Spells are timed and typed by the shared seeded rand(), so a map's weather
// replays the same way on reload but differs map to map, same as its terrain.
// ---------------------------------------------------------------------------

const WEATHER_GAP_MIN = 60; // real seconds of clear weather between spells, minimum
const WEATHER_GAP_MAX = 110; // ...maximum — the spread keeps it from feeling metronomic
const WEATHER_DURATION = 24; // real seconds a rain or drought spell lasts
const WEATHER_FADE = 4; // seconds to ease a spell in and out at each end
const WEATHER_RAIN_CHANCE = 0.65; // rain is the common case; drought is the rarer extreme

let weatherType = "clear"; // "clear" | "rain" | "drought"
let weatherTimer = WEATHER_GAP_MIN + rand() * (WEATHER_GAP_MAX - WEATHER_GAP_MIN);
let weatherT = 0; // eased 0..1 intensity of the current spell, ramps at both ends

function updateWeather(dt) {
  if (winterLeft > 0) {
    // Nothing grows under snow anyway; the slate is clear again by spring
    weatherType = "clear";
    weatherT = 0;
    return;
  }
  weatherTimer -= dt;
  if (weatherTimer <= 0) {
    if (weatherType === "clear") {
      weatherType = rand() < WEATHER_RAIN_CHANCE ? "rain" : "drought";
      weatherTimer = WEATHER_DURATION;
    } else {
      weatherType = "clear";
      weatherTimer = WEATHER_GAP_MIN + rand() * (WEATHER_GAP_MAX - WEATHER_GAP_MIN);
    }
  }
  weatherT =
    weatherType === "clear"
      ? 0
      : Math.min(1, Math.min(WEATHER_DURATION - weatherTimer, weatherTimer) / WEATHER_FADE);
}

// Mud and mist take a mild bite out of top speed while it rains — a cap,
// never a stall, and it composes with the gear/road/implement caps already
// in play rather than fighting them
function weatherSpeedMult() {
  return weatherType === "rain" ? 1 - 0.2 * weatherT : 1;
}

// Overcast rain or a dry spell both slow growth the same amount — drought is
// the same mechanic as rain, just without the rain
function weatherGrowthMult() {
  return weatherType === "clear" ? 1 : 1 - 0.3 * weatherT;
}

const RAINDROPS = [];
for (let i = 0; i < 60; i++) {
  RAINDROPS.push({
    x: ((i * 0.618034) % 1) * (VIEW_W + 40),
    y: ((i * 0.381966) % 1) * VIEW_H,
    speed: 90 + ((i * 11) % 40),
    len: i % 3 === 0 ? 6 : 4,
  });
}

function drawWeather(camX, camY) {
  if (weatherT <= 0) return;
  if (weatherType === "drought") {
    ctx.fillStyle = `rgba(196,164,96,${(0.14 * weatherT).toFixed(2)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    return;
  }
  ctx.fillStyle = `rgba(90,105,120,${(0.16 * weatherT).toFixed(2)})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.strokeStyle = `rgba(210,224,235,${(0.55 * weatherT).toFixed(2)})`;
  ctx.lineWidth = 1;
  const wrapX = VIEW_W + 40;
  for (const d of RAINDROPS) {
    const sx = ((((d.x - camX * 0.5) % wrapX) + wrapX) % wrapX) - 20;
    const sy = (((d.y + worldTime * d.speed - camY * 0.5) % VIEW_H) + VIEW_H) % VIEW_H;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 2, sy + d.len);
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
      b.wx = Math.max(16, Math.min(MAP_SIZE - 16, b.wx));
      b.wy = Math.max(16, Math.min(MAP_SIZE - 16, b.wy));
      b.a = Math.atan2(MAP_SIZE / 2 - b.wy, MAP_SIZE / 2 - b.wx);
    }
  }
}

function drawButterflies(camX, camY) {
  // The meadows empty as the snow deepens: fewer and fewer butterflies
  // brave the cold, and midwinter grounds them all
  const n = Math.round(butterflies.length * (1 - winterDepth()));
  for (let i = 0; i < n; i++) {
    const b = butterflies[i];
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
  // Only a slow, deliberate approach counts as finding it
  const d = Math.hypot(tractor.x - ladybug.wx, tractor.y - ladybug.wy);
  if (d < 8 && Math.abs(tractor.speed) < 8) {
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
  const onGas = keys.ArrowUp || autoThrottling();
  if (!gameOver && (onGas || Math.abs(tractor.speed) > 5)) {
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
const SEED_PRICE = 2; // € per seed, bought automatically at the farm
const SACK_PRICE = 10; // € earned per sack of grain sold

const ROUND_TIME = 300; // seconds — one Apr 1 – Oct 31 season in either mode
let timeLeft = ROUND_TIME;
let gameOver = false;
let bestScores = [];
let finalRank = -1; // this round's place in the best list, -1 if none

// Survival mode: the years keep rolling and every Oct 31 the property tax
// is collected, growing a little each year, income or not. Seeds can go on
// credit down to the debt limit; sink below it and the bank takes the farm.
// The scoreboard is the longest runs in years, kept in localStorage.
const SURVIVAL_START_CASH = 250;
const TAX_BASE = 150; // € — the first year's property tax
const TAX_STEP = 75; // € added to the tax each following year
const DEBT_LIMIT = 400; // bankruptcy when cash drops below -this
const SURVIVAL_SCORES_KEY = "traktoripeli.survival";
let year = 1;
let propertyTax = TAX_BASE;
let taxFlash = 0; // seconds left of the "tax paid" banner
let taxPaid = 0; // amount shown in that banner

// Sandbox mode: the same rolling years, but nothing is ever due and
// nothing ever ends. A fat wallet so seeds are never a worry.
const SANDBOX_START_CASH = 1000;

// Sandbox season pacing: the calendar crawls through spring and autumn so
// there is time to plant every field and haul every sack, and runs at full
// speed through the summer while the crops ripen. Rates are calendar
// seconds per real second; the phase boundaries are Jun 1 and Sep 1,
// expressed as timeLeft values so the frame loop can compare directly.
const SANDBOX_SPRING_RATE = 0.25; // Apr 1 – May 31: planting
const SANDBOX_SUMMER_RATE = 1; // Jun 1 – Aug 31: growing
const SANDBOX_AUTUMN_RATE = 0.25; // Sep 1 – Oct 31: harvest and hauling
const SUMMER_START_LEFT = ROUND_TIME * (1 - 61 / SEASON_DAYS);
const AUTUMN_START_LEFT = ROUND_TIME * (1 - 153 / SEASON_DAYS);

// In sandbox crops grow on the calendar instead of the wall clock: seed to
// mature spans this many calendar days, so a spring planting sprouts slowly,
// shoots up over summer and stands golden by September whatever the
// real-time pace of each phase.
const SANDBOX_GROW_DAYS = 90;
const SANDBOX_GROW_FACTOR =
  CROP_STAGES[2] / ((SANDBOX_GROW_DAYS * ROUND_TIME) / SEASON_DAYS);

// Winter: the year doesn't jump from Oct 31 straight back to spring — a
// snowed-in Nov 1 – Mar 31 passes first. It runs on the wall clock in both
// modes: nothing grows and nothing falls due, the world just whitens,
// rests, and melts back to green.
const WINTER_TIME = 45; // real seconds from Nov 1 to Mar 31
let winterLeft = 0; // counts down while winter is running

function sandboxClockRate() {
  return timeLeft > SUMMER_START_LEFT
    ? SANDBOX_SPRING_RATE
    : timeLeft > AUTUMN_START_LEFT
      ? SANDBOX_SUMMER_RATE
      : SANDBOX_AUTUMN_RATE;
}

// The timeLeft value where the current phase's rate stops applying
function sandboxPhaseFloor() {
  return timeLeft > SUMMER_START_LEFT
    ? SUMMER_START_LEFT
    : timeLeft > AUTUMN_START_LEFT
      ? AUTUMN_START_LEFT
      : 0;
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

// Oct 31: the tax collector comes around, then winter settles in.
// Returns false when the bill bankrupts the farm and the run is over.
function collectTax() {
  cash -= propertyTax;
  taxPaid = propertyTax;
  taxFlash = 4;
  playTax();
  if (cash < -DEBT_LIMIT) {
    endSurvival();
    return false;
  }
  propertyTax += TAX_STEP;
  winterLeft = WINTER_TIME;
  return true;
}

// Mar 31: the snow is gone and a new year begins
function startSpring() {
  year++;
  timeLeft = ROUND_TIME;
}

// Away-clock catch-up: time the frame loop never saw (rAF stops in a
// hidden tab) is applied in one step. Crops grow and the calendar keeps
// turning — year by year in survival, taxes, winters and all.
function advanceTime(sec) {
  // Paused means paused: time away from the tab stays off the books too
  if (!gameStarted || gameOver || paused) return;
  worldTime += sec;
  while (sec > 0 && !gameOver) {
    // Winter runs on the wall clock in both cyclical modes; crops sleep
    if (winterLeft > 0) {
      const used = Math.min(sec, winterLeft);
      winterLeft -= used;
      sec -= used;
      if (winterLeft === 0) startSpring();
      continue;
    }
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
        if (floor === 0) winterLeft = WINTER_TIME;
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
    }
  }
}

// Where the calendar stands as a day index of the game year: Apr 1 = 0,
// Oct 31 = 213 (SEASON_DAYS), Nov 1 = 214, Mar 31 = 364. Mirrors the HUD's
// date arithmetic exactly, so a jump lands on the date the player reads.
function currentCalendarDay() {
  if (winterLeft > 0) {
    const p = 1 - winterLeft / WINTER_TIME;
    return SEASON_DAYS + 1 + Math.min(WINTER_DAYS, Math.floor(p * (WINTER_DAYS + 1)));
  }
  const p = 1 - timeLeft / ROUND_TIME;
  return Math.min(SEASON_DAYS, Math.floor(p * (SEASON_DAYS + 1)));
}

// Enter in the date-jump field: parse the typed MMDD and fast-forward the
// calendar to that date's next occurrence. The world advances in small
// real-time steps through advanceTime, so crops grow, winters pass and
// taxes fall due exactly as if the time had really been played.
function tryDateJump() {
  if (dateJump.length !== 4) {
    dateJumpError = true;
    return;
  }
  const mm = +dateJump.slice(0, 2);
  const dd = +dateJump.slice(2);
  // The game year runs Apr 2000 – Mar 2001 (not a leap February)
  const y = mm >= 4 ? 2000 : 2001;
  if (
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    new Date(Date.UTC(y, mm - 1, dd)).getUTCDate() !== dd
  ) {
    dateJumpError = true;
    return;
  }
  const target = (Date.UTC(y, mm - 1, dd) - Date.UTC(2000, 3, 1)) / 86400000;
  // Always at least one step forward: jumping to today's date rolls a
  // whole year around in the cyclical modes. The guard comfortably covers
  // the longest year (sandbox's slow phases plus a winter) and the loop
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
const SAVE_VERSION = 2; // bump when map generation changes: stale saves drop
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
    year,
    propertyTax,
    timeLeft: Math.round(timeLeft * 10) / 10,
    winterLeft: Math.round(winterLeft * 10) / 10,
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

// Starting capital by mode: survival a buffer against the first tax bill,
// sandbox plenty
let cash = modeStartCash(mode);
let seeds = 0; // start empty: buy seeds at the farm
let cargo = 0; // sacks on the trailer
let sold = 0; // total sacks delivered to the farm
const sacks = []; // grain sacks lying on the fields

const tractor = {
  x: FARM.x + 34,
  y: FARM.y + 10,
  angle: -2.4, // facing up-left, toward the middle of the map
  speed: 0, // world units/s, positive = forward
  fastGear: true, // Space toggles road mode (fast, lifted) vs work mode (slow, lowered)
  implement: "plow", // current implement: plow / seeder / harvester / trailer
  implAngle: -2.4, // world heading of a towed implement (trails the hitch)
  implDown: false, // lowered together with the work gear (part of the mode toggle)
  implLift: 1, // animated: 0 = working the ground, 1 = fully raised
  implBounce: 0, // seconds left of the refused-lower dip animation
  implFlash: 0, // seconds left of the red HUD flash (implement complaint)
  workLane: null, // tile row/column the current pass is locked to (see field work)
};

const ACCEL = 55;
const BRAKE = 80;
const FRICTION = 28;
const GEAR_FAST = 42;
const GEAR_SLOW = 16;
const MAX_REVERSE = -GEAR_SLOW; // backing up is never faster than the work gear
// Fixed steering geometry: turn rate scales with speed, so the turning
// radius stays ~TURN_RADIUS at working speeds — tight enough to U-turn
// into the adjacent row (one tile = 16 units away).
const TURN_RADIUS = 7; // world units
const MAX_TURN_RATE = 2.5; // rad/s cap so the fast gear doesn't spin wildly

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
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const points = [
    [-9.8, -4],
    [-9.8, 0],
    [-9.8, 4],
    [-6, 0],
  ];
  for (const [lx, ly] of points) {
    const wx = pose.x + lx * cos - ly * sin;
    const wy = pose.y + lx * sin + ly * cos;
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
  return autoThrottleOn && !tractor.fastGear && !keys.ArrowDown;
}

function update(dt) {
  if (paused) return;
  // Ambient life keeps moving even after the round ends
  worldTime += dt;
  updateSmoke(dt);
  updateButterflies(dt);
  updateAnimals(dt);
  updateHerds(dt);
  updateVan(dt);
  updateBirds(dt);
  updateLadybug(dt);
  updateSeason();
  updateWeather(dt);
  if (!gameStarted || gameOver) return;

  // Winter runs on the wall clock; when the snow melts a new year begins
  if (winterLeft > 0) {
    winterLeft = Math.max(0, winterLeft - dt);
    if (winterLeft === 0) startSpring();
  } else {
    timeLeft = Math.max(
      0,
      timeLeft - dt * (mode === "sandbox" ? sandboxClockRate() : 1)
    );
    if (timeLeft === 0) {
      if (mode === "survival") {
        if (!collectTax()) return;
      } else {
        winterLeft = WINTER_TIME;
      }
    }
  }
  taxFlash = Math.max(0, taxFlash - dt);

  const imp = IMPLEMENTS[tractor.implement];

  // Throttle / brake
  const throttling = keys.ArrowUp || autoThrottling();
  if (throttling) {
    tractor.speed += ACCEL * dt;
  } else if (keys.ArrowDown) {
    tractor.speed -= BRAKE * dt;
  } else {
    // Roll to a stop
    if (tractor.speed > 0) tractor.speed = Math.max(0, tractor.speed - FRICTION * dt);
    else tractor.speed = Math.min(0, tractor.speed + FRICTION * dt);
  }
  // Gravity along the slope: uphill fights the engine, downhill helps
  const cos = Math.cos(tractor.angle);
  const sin = Math.sin(tractor.angle);
  const grade =
    (terrainHeight(tractor.x + cos * 4, tractor.y + sin * 4) -
      terrainHeight(tractor.x - cos * 4, tractor.y - sin * 4)) /
    8;
  tractor.speed -= grade * 60 * dt;

  // At a crawl with no throttle the tractor simply stops — otherwise slope
  // gravity keeps it creeping forever and the camera never settles
  if (!throttling && !keys.ArrowDown && Math.abs(tractor.speed) < 1.5) {
    tractor.speed = 0;
  }

  // Top speed from the gear, further reduced by drag when working the ground
  let maxForward =
    (tractor.fastGear ? GEAR_FAST : GEAR_SLOW) *
    (imp.liftable ? 1 - 0.35 * (1 - tractor.implLift) : 1) *
    weatherSpeedMult();
  let maxReverse = MAX_REVERSE;

  // Packed dirt roads are ~30% faster than driving across the meadows
  if (roadTiles.has(tileKey(tractor.x, tractor.y))) maxForward *= 1.3;

  // A lowered implement digging into unbroken ground bogs the tractor down
  if (imp.liftable && tractor.implLift < 0.5 && !implementOverField()) {
    maxForward = 3;
    maxReverse = -3;
  }

  if (tractor.speed > maxForward)
    tractor.speed = Math.max(maxForward, tractor.speed - 120 * dt);
  if (tractor.speed < maxReverse)
    tractor.speed = Math.min(maxReverse, tractor.speed + 120 * dt);

  // Steering only has effect while moving; reversing flips it like a real vehicle
  const turnRate =
    Math.min(Math.abs(tractor.speed) / TURN_RADIUS, MAX_TURN_RATE) *
    Math.sign(tractor.speed);
  let angVel = 0;
  if (keys.ArrowLeft) angVel -= turnRate;
  if (keys.ArrowRight) angVel += turnRate;
  tractor.angle += angVel * dt;

  // Move on the ground plane
  const prevX = tractor.x;
  const prevY = tractor.y;
  tractor.x += cos * tractor.speed * dt;
  tractor.y += sin * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.x));
  tractor.y = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.y));

  // Water blocks the tractor, except where a road bridges it
  if (
    tileTypeAt(tractor.x, tractor.y) === 4 &&
    !roadTiles.has(tileKey(tractor.x, tractor.y))
  ) {
    tractor.x = prevX;
    tractor.y = prevY;
    tractor.speed = 0;
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
          break outer;
        }
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
      break;
    }
  }

  // A towed implement's wheels roll rather than skid, so the hitch's
  // sideways motion swings its heading toward the tractor's over time
  if (imp.towed) {
    let rel = tractor.angle - tractor.implAngle;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // wrap to (-pi, pi]
    rel -=
      ((tractor.speed * Math.sin(rel) + HITCH_X * angVel * Math.cos(rel)) /
        imp.towLength) *
      dt;
    rel = Math.max(-MAX_HITCH_ANGLE, Math.min(MAX_HITCH_ANGLE, rel));
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
  if (imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > 2) {
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

  // Farmyard services: seed purchase and grain delivery
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
    if (tractor.implement === "trailer" && cargo > 0) {
      cash += cargo * SACK_PRICE;
      sold += cargo;
      cargo = 0;
      const pose = implementPose();
      spawnChaff(pose.x - 16 * Math.cos(pose.angle), pose.y - 16 * Math.sin(pose.angle));
      playSell();
    }
  }

  updateTracks(dt);
  // Nothing grows under the snow: winter freezes the crops where they stand
  if (winterLeft === 0)
    updateCrops(
      (mode === "sandbox" ? dt * sandboxClockRate() * SANDBOX_GROW_FACTOR : dt) *
        weatherGrowthMult()
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
    c2d.fillRect(gx, gy, Math.max(0, Math.min(seg1, x + w - gx)), 1);
    c2d.fillRect(
      gx + seg1,
      gy + (rnd() < 0.5 ? 1 : -1),
      Math.max(0, Math.min(len - seg1, x + w - gx - seg1)),
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
  drawSnow(camX, camY);
  drawWeather(camX, camY);

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
      Math.abs(tractor.speed) > 2 &&
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
      Math.abs(tractor.speed) > 2 &&
      implementOverField();
    const cargoColor = fullRun && ((worldTime * 6) | 0) % 2 === 0 ? RED : null;
    seg(`CARGO: ${cargo}/${TRAILER_CAP}   `, cargoColor);
  }
  const lucky = luckFlash > 0 && ((luckFlash * 8) | 0) % 2 === 0;
  seg(`CASH: €${cash}   `, lucky ? "#c9e6a8" : cash < SEED_PRICE ? RED : "#ffd94f");
  seg(`SOLD: ${sold}   `);
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
  topSeg(`${mode.toUpperCase()}  `, "#ffd94f");
  topSeg(`MAP ${MAP_INDEX}   `);
  topSeg(`[P] PAUSE  [F1] MENU`, "#d8c49a");
  if (weatherType === "rain") topSeg(`   RAIN`, "#9fd0ff");
  else if (weatherType === "drought") topSeg(`   DROUGHT`, "#d9b871");

  // Season calendar instead of a clock: the year and date count from spring
  // toward Oct 31 along a wooden trough; in survival the tax bill waits at
  // the far end of it. Flashes red for the last 30 seconds before the bill.
  // The cyclical modes carry on through the winter toward Mar 31.
  const winter = winterLeft > 0;
  const progress = winter
    ? 1 - winterLeft / WINTER_TIME
    : 1 - timeLeft / ROUND_TIME;
  const date = winter
    ? new Date(
        2000, 10, 1 + Math.min(WINTER_DAYS, Math.floor(progress * (WINTER_DAYS + 1)))
      )
    : new Date(
        2000, 3, 1 + Math.min(SEASON_DAYS, Math.floor(progress * (SEASON_DAYS + 1)))
      );
  const barW = 140;
  const barH = 8;
  const bx = (screenCanvas.width - barW) / 2;
  const by = 10;
  // Nothing is due at year's end in sandbox, so no red urgency flash there;
  // nothing is due in winter either, in any mode
  const flash =
    mode !== "sandbox" && !winter && timeLeft < 30 && ((timeLeft * 2) | 0) % 2 === 0;
  const taxJustPaid = mode === "survival" && taxFlash > 0 && !gameOver;
  screenCtx.textAlign = "right";
  label(
    `Y${year} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`,
    bx - 8,
    topY,
    flash ? "#ff5040" : "#f5e9c8"
  );
  screenCtx.textAlign = "left";
  const endLabel = taxJustPaid
    ? `-€${taxPaid} PAID`
    : winter
      ? "MAR 31"
      : mode === "survival"
        ? `TAX €${propertyTax}`
        : "OCT 31";
  label(endLabel, bx + barW + 8, topY, taxJustPaid ? "#ff5040" : "#d8c49a");
  // The season grows along a wooden trough
  screenCtx.fillStyle = "#4a2f1a";
  screenCtx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
  screenCtx.fillStyle = "#2e1d10";
  screenCtx.fillRect(bx, by, barW, barH);
  screenCtx.fillStyle = flash ? "#ff5040" : seasonHex(SEASON_BAR_COLORS);
  screenCtx.fillRect(bx, by, Math.round(barW * progress), barH);

  // Right: the music & sound icons
  let rx = screenCanvas.width - 12;
  drawSpeakerIcon(rx - 13, 8, !soundMuted);
  rx -= 13 + 10;
  drawNoteIcon(rx - 12, 8, !musicMuted);

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
      `SURVIVED ${year} YEAR${year === 1 ? "" : "S"}   (€${cash})`,
      cx,
      y + 74,
      "#f5e9c8"
    );
    screenCtx.font = "13px monospace";
    bestScores.forEach((entry, i) => {
      label(
        `${i + 1}.  ${entry.years} YEAR${entry.years === 1 ? " " : "S"}   €${entry.cash}   (map ${entry.map ?? entry.seed ?? "?"})`,
        cx,
        y + 106 + i * 20,
        i === finalRank ? "#ffd94f" : "#e0d0a8"
      );
    });
    label("[F1] MENU — NEW GAME, MAP OR MODE", cx, y + h - 18, "#c9e6a8");
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
  screenCtx.fillStyle = TRACTOR_RED;
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
    label(gameStarted ? "MENU" : "TRAKTORIPELI", cx, y + 26, "#ffd94f");

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
    year = s.year;
    propertyTax = s.propertyTax;
    timeLeft = s.timeLeft;
    winterLeft = s.winterLeft || 0; // saves from before winter existed: spring–autumn
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
