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
// Seeded RNG: the whole world is generated through rand(), so the same seed
// always produces the same map. The seed is a plain integer, set from the
// F1 menu (or ?seed= in the URL); anything non-numeric gets replaced.
// ---------------------------------------------------------------------------

const urlParams = new URLSearchParams(location.search);
const seedParam = parseInt(urlParams.get("seed"), 10);
const SEED = Number.isFinite(seedParam) ? seedParam : (Math.random() * 1e9) | 0;

// Game mode: "classic" is the timed one-season round, "survival" rolls year
// after year with a property tax due every Oct 31. Chosen in the start menu;
// reloads carry the mode in the URL next to the seed, and a fresh visit
// (no mode in the URL) opens the start menu before anything moves.
let mode = urlParams.get("mode") === "survival" ? "survival" : "classic";
let gameStarted = urlParams.has("mode");

const rand = (function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(SEED >>> 0);

console.log(`map seed: ${SEED} — reload with ?seed=${SEED} to reproduce`);

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
// into the familiar lazy progression, autumn slows down and turns minor
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
      audio.musicSeason = MUSIC_SEASONS[seasonQ < 0.33 ? 0 : seasonQ < 0.72 ? 1 : 2];
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
  const throttle = !gameOver && (keys.ArrowUp || keys.ArrowDown) ? 1 : 0;
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

// F1 opens the menu, the only place the seed and mode can be picked. It is
// also the start menu: a fresh visit begins with it open and the clock held.
let menuOpen = !gameStarted;
let menuSeed = String(SEED);
let menuMode = mode;

window.addEventListener("keydown", (e) => {
  // Browsers only allow audio after a user gesture
  initAudio();
  if (audio.ac.state === "suspended") audio.ac.resume();
  if (e.key === "F1" && !e.repeat) {
    e.preventDefault();
    if (!gameStarted) return; // the start menu stays until a mode is picked
    menuOpen = !menuOpen;
    menuSeed = String(SEED);
    menuMode = mode;
    return;
  }
  if (menuOpen) {
    // The menu swallows all input: type a seed, arrows pick the mode, Enter
    // starts, N rolls a random map, Esc closes (once a game is running)
    e.preventDefault();
    if (e.key === "Enter") {
      const n = parseInt(menuSeed, 10);
      if (Number.isFinite(n)) {
        if (!gameStarted && n === SEED) {
          // Same map as the one already generated: start without a reload
          startGame(menuMode);
        } else {
          location.search = `?seed=${n}&mode=${menuMode}`;
        }
      }
    } else if (e.key === "n" || e.key === "N") {
      location.search = `?seed=${(Math.random() * 1e9) | 0}&mode=${menuMode}`;
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      menuMode = menuMode === "classic" ? "survival" : "classic";
    } else if (e.key === "Escape") {
      if (gameStarted) menuOpen = false;
    } else if (e.key === "Backspace") {
      menuSeed = menuSeed.slice(0, -1);
    } else if (/^[0-9]$/.test(e.key) && menuSeed.length < 10) {
      menuSeed += e.key;
    } else if (e.key === "-" && menuSeed === "") {
      menuSeed = "-";
    }
    return;
  }
  if (e.key.startsWith("Arrow")) e.preventDefault();
  keys[e.key] = true;
  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    const imp = IMPLEMENTS[tractor.implement];
    // Raising is always allowed; lowering needs the work gear and field dirt
    if (!imp.liftable) {
      tractor.implFlash = 0.9; // the trailer has no lift
    } else if (tractor.implDown) {
      tractor.implDown = false;
      playHydraulic(false);
    } else if (tractor.fastGear) {
      tractor.gearFlash = 0.9; // refused: too fast — flash the HUD, no movement
    } else if (!implementOverField()) {
      tractor.implBounce = 0.6; // it tries, catches, and springs back up
      playHydraulic(true);
    } else {
      tractor.implDown = true;
      tractor.implBounce = 0;
      playHydraulic(true);
    }
  }
  if ((e.key === "m" || e.key === "M") && !e.repeat) {
    musicMuted = !musicMuted;
    audio.musicGain.gain.setTargetAtTime(musicMuted ? 0 : 1, audio.ac.currentTime, 0.02);
  }
  if ((e.key === "q" || e.key === "Q") && !e.repeat) {
    soundMuted = !soundMuted;
    audio.master.gain.setTargetAtTime(soundMuted ? 0 : 0.5, audio.ac.currentTime, 0.02);
  }
  if (e.key === "Shift" && !e.repeat) {
    tractor.fastGear = !tractor.fastGear;
    if (tractor.fastGear) tractor.implDown = false; // lift before shifting up
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

// ---------------------------------------------------------------------------
// Terrain: smooth rolling hills from summed cosine bumps, fading to flat
// near the map edges so the dirt cliffs stay level.
// ---------------------------------------------------------------------------

const HILLS = [];
for (let i = 0; i < 40; i++) {
  HILLS.push({
    cx: MAP_SIZE * (0.1 + rand() * 0.8),
    cy: MAP_SIZE * (0.1 + rand() * 0.8),
    r: 60 + rand() * 100,
    h: 10 + rand() * 16,
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

const shadeCache = {};
function shade(color, k) {
  const key = color + "|" + k.toFixed(2);
  if (shadeCache[key]) return shadeCache[key];
  const r = Math.min(255, Math.round(parseInt(color.slice(1, 3), 16) * k));
  const g = Math.min(255, Math.round(parseInt(color.slice(3, 5), 16) * k));
  const b = Math.min(255, Math.round(parseInt(color.slice(5, 7), 16) * k));
  return (shadeCache[key] = `rgb(${r},${g},${b})`);
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

const mapCtx = mapCanvas.getContext("2d");

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
const DIRT = "#a87e50";
const DIRT_DOTS = ["#8f6940", "#bb9264"];
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

// Corners of a tile that are outer corners of its patch (nothing of the same
// kind around them); those corners get rounded off. Works for both field
// patches and water bodies via the `same` predicate.
function tileGeometry(tx, ty, same) {
  const P = [
    mp(tx * TILE, ty * TILE),
    mp((tx + 1) * TILE, ty * TILE),
    mp((tx + 1) * TILE, (ty + 1) * TILE),
    mp(tx * TILE, (ty + 1) * TILE),
  ];
  const other = (ax, ay) => !same(ax, ay);
  const rounded = [
    other(tx, ty - 1) && other(tx - 1, ty) && other(tx - 1, ty - 1),
    other(tx, ty - 1) && other(tx + 1, ty) && other(tx + 1, ty - 1),
    other(tx + 1, ty) && other(tx, ty + 1) && other(tx + 1, ty + 1),
    other(tx - 1, ty) && other(tx, ty + 1) && other(tx - 1, ty + 1),
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

  // Restore any road surface crossing this tile: roads live on top of the
  // tiles, so the repaint just erased them here
  const stamps = roadStamps.get(ty * MAP_TILES + tx);
  if (stamps) {
    mapCtx.save();
    mapCtx.beginPath();
    for (const [ex, ey] of [[0, 0], [MAP_SIZE, 0], [MAP_SIZE, MAP_SIZE], [0, MAP_SIZE]]) {
      const c = mp(ex, ey);
      if (ex === 0 && ey === 0) mapCtx.moveTo(c.x, c.y);
      else mapCtx.lineTo(c.x, c.y);
    }
    mapCtx.closePath();
    mapCtx.clip();
    for (const s of stamps) {
      const c = mp(s.x, s.y);
      mapCtx.fillStyle = shade(s.color, groundShade(s.x, s.y));
      mapCtx.beginPath();
      mapCtx.ellipse(c.x, c.y, s.r * 1.5, s.r * 0.75, 0, 0, Math.PI * 2);
      mapCtx.fill();
    }
    mapCtx.restore();
  }

  // Restore the farmyard's trodden dirt if this tile is anywhere near it.
  // The whole yard is repainted unclipped — its pixels are deterministic, so
  // overpainting neighbors is a no-op, and clipping to the tile would leave
  // antialiasing seams across the yard.
  const nearYard =
    Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) <
    FARM_RADIUS * 2.2;
  const fc = mp(FARM.x, FARM.y);
  if (nearYard) {
    mapCtx.fillStyle = "#a87e50";
    mapCtx.beginPath();
    mapCtx.ellipse(fc.x, fc.y, FARM_RADIUS * 1.8, FARM_RADIUS * 0.9, 0, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = "#8f6940";
    for (const p of yardPixels) mapCtx.fillRect(p.x, p.y, 1, 1);
  }

  // Re-dither everything that was repainted: the 2x2 block covering this
  // tile and the front neighbors whose crops were redrawn, with a margin for
  // road stamps that stick out, plus the yard when it was redrawn
  const c = [
    mp(tx * TILE, ty * TILE),
    mp((tx + 2) * TILE, ty * TILE),
    mp((tx + 2) * TILE, (ty + 2) * TILE),
    mp(tx * TILE, (ty + 2) * TILE),
  ];
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  let x0 = Math.min(...xs) - 8;
  let y0 = Math.min(...ys) - 10; // crops draw a few pixels above the ground
  let x1 = Math.max(...xs) + 8;
  let y1 = Math.max(...ys) + 8;
  if (nearYard) {
    x0 = Math.min(x0, fc.x - FARM_RADIUS * 1.8 - 2);
    x1 = Math.max(x1, fc.x + FARM_RADIUS * 1.8 + 2);
    y0 = Math.min(y0, fc.y - FARM_RADIUS * 0.9 - 2);
    y1 = Math.max(y1, fc.y + FARM_RADIUS * 0.9 + 2);
  }
  ditherRegion(mapCtx, x0, y0, x1 - x0, y1 - y0);
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
    // keep their floor bare
    if (!forestTiles.has(ty * MAP_TILES + tx) && tr() < 0.5) {
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
    mapCtx.fillStyle = "#3d7dc4";
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

    mapCtx.fillStyle = "#6fa9dd"; // ripples
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

// Roads are generated inside makeMap; the samples and covered tiles are kept
// so field patches, trees and bushes can stay off them. The field patch
// rectangles are kept for the hedgerows planted along their edges.
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
  const touched = new Set();
  for (const dx of [-r, r])
    for (const dy of [-r, r]) touched.add(tileKey(x + dx, y + dy));
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
  // How watery this map is varies per seed, anywhere up to ~60%
  const waterTarget = MAP_TILES * MAP_TILES * (0.05 + rand() * 0.55);

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
  // How much of the dry land is farmed varies per seed; the farm clearing
  // and road carving eat a little of it back.
  const targetFieldTiles = (MAP_TILES * MAP_TILES - waterTiles) * (0.2 + rand() * 0.45);
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
  const roads = [];
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

  // Forest stands: how much of the land is forested varies per seed. Blobs
  // grow on free grass; only the tiles are marked here (darker floor and
  // minimap color) — the trees themselves are planted after the map exists.
  const forestTarget = (MAP_TILES * MAP_TILES - waterTiles) * (0.08 + rand() * 0.35);
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
  mapCtx.beginPath();
  for (const [ex, ey] of [[0, 0], [MAP_SIZE, 0], [MAP_SIZE, MAP_SIZE], [0, MAP_SIZE]]) {
    const c = mp(ex, ey);
    if (ex === 0 && ey === 0) mapCtx.moveTo(c.x, c.y);
    else mapCtx.lineTo(c.x, c.y);
  }
  mapCtx.closePath();
  mapCtx.clip();
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
    mapCtx.fillStyle = "#a37e4e";
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
  mapCtx.fillStyle = "#a87e50";
  mapCtx.beginPath();
  mapCtx.ellipse(fc.x, fc.y, FARM_RADIUS * 1.8, FARM_RADIUS * 0.9, 0, 0, Math.PI * 2);
  mapCtx.fill();
  mapCtx.fillStyle = "#8f6940";
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const px = Math.round(fc.x + Math.cos(a) * r * FARM_RADIUS * 1.7);
    const py = Math.round(fc.y + Math.sin(a) * r * FARM_RADIUS * 0.85);
    yardPixels.push({ x: px, y: py });
    mapCtx.fillRect(px, py, 1, 1);
  }

  // Dirt cliffs along the two near (bottom) edges of the map diamond
  const east = mp(MAP_SIZE, 0);
  const south = mp(MAP_SIZE, MAP_SIZE);
  const west = mp(0, MAP_SIZE);
  for (const [a, b, color] of [
    [east, south, "#8a6540"],
    [south, west, "#6f4d2c"],
  ]) {
    mapCtx.fillStyle = color;
    mapCtx.beginPath();
    mapCtx.moveTo(a.x, a.y);
    mapCtx.lineTo(b.x, b.y);
    mapCtx.lineTo(b.x, b.y + EDGE_DEPTH);
    mapCtx.lineTo(a.x, a.y + EDGE_DEPTH);
    mapCtx.closePath();
    mapCtx.fill();
  }

  // Dither everything painted after the tiles (yard, cliffs); tiles are
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

// grass, field, plowed, seeded, water; ripe crops turn gold
const MINIMAP_COLORS = ["#4fa83e", "#a87e50", "#8a6540", "#90c83c", "#3d7dc4"];

function minimapTile(tx, ty) {
  const type = tiles[ty][tx];
  let color = MINIMAP_COLORS[type];
  if (type === 0 && forestTiles.has(ty * MAP_TILES + tx)) color = "#2f7a2c";
  if (type === 3 && cropStage(growth[ty][tx]) >= 3) color = "#e3c355";
  minimapCtx.fillStyle = color;
  minimapCtx.fillRect(tx - ty + MAP_TILES - 1, (tx + ty) >> 1, 2, 1);
}

makeMap();

for (let ty = 0; ty < MAP_TILES; ty++)
  for (let tx = 0; tx < MAP_TILES; tx++) minimapTile(tx, ty);

// Roads (never under field tiles, so tile updates can't erase them)
minimapCtx.fillStyle = "#c09a66";
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
// Spring colors; updateSeason() recolors them through summer into autumn.
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

// ---------------------------------------------------------------------------
// Bushes: little round shrubs on the meadows
// ---------------------------------------------------------------------------

// Each variant is [spring, summer, autumn]
const BUSH_COLORS = [
  ["#4db554", "#3f9e3e", "#b07a35"],
  ["#5cc25f", "#4fae4a", "#c08d3a"],
  ["#45a94b", "#379139", "#9c6a2e"],
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
// Each variant is [spring, summer, autumn]
const HEDGE_COLORS = [
  ["#3f9440", "#357f36", "#96612d"],
  ["#489e45", "#3d8f3c", "#a5722f"],
  ["#3a8a3c", "#2f7531", "#8a5c2a"],
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
// Animals: cows and sheep graze in small herds on the meadows, and flocks
// of birds cross the sky.
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
};

const animals = [];

function spawnHerd(species, hx, hy, count) {
  const n = count || 3 + ((rand() * 4) | 0);
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
    animals.push({
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
    });
  }
}

// The farm always keeps one herd of each species grazing close by
for (const species of ["cow", "sheep", "horse"]) {
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

// ...and a flock of chickens pecking around the yard itself
spawnHerd("chicken", FARM.x, FARM.y, 6 + ((rand() * 4) | 0));

// Plus a few wild-placed herds further out
for (let herds = 0, tries = 0; herds < 4 && tries < 400; tries++) {
  const hx = 30 + rand() * (MAP_SIZE - 60);
  const hy = 30 + rand() * (MAP_SIZE - 60);
  if (tileTypeAt(hx, hy) !== 0) continue;
  if (forestTiles.has(tileKey(hx, hy)) || roadTiles.has(tileKey(hx, hy))) continue;
  if (Math.hypot(hx - FARM.x, hy - FARM.y) < FARM_RADIUS + 24) continue;
  const r = rand();
  spawnHerd(r < 0.4 ? "cow" : r < 0.75 ? "sheep" : "horse", hx, hy);
  herds++;
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
    // Spooked animals get clear of the tractor — sideways off its path,
    // not down the line of travel — turning at the species' own pace but
    // always smoothly (no snaps)
    if (spec.spook && tractorDist < spec.spook) {
      a.pause = 0;
      const tdx = a.wx - tractor.x;
      const tdy = a.wy - tractor.y;
      const hx = Math.cos(tractor.angle);
      const hy = Math.sin(tractor.angle);
      const side = tdx * -hy + tdy * hx >= 0 ? 1 : -1;
      const fx = -hy * side + (tdx / (tractorDist || 1)) * 0.5;
      const fy = hx * side + (tdy / (tractorDist || 1)) * 0.5;
      const want =
        Math.abs(tractor.speed) > 3 ? Math.atan2(fy, fx) : Math.atan2(tdy, tdx);
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

const BOXES = [
  { x0: -7.0, x1: 3.0, y0: -3.0, y1: 3.0, z0: 2.5, z1: 6.0, color: "#f25c3f" }, // chassis
  { x0: 3.0, x1: 7.0, y0: -2.2, y1: 2.2, z0: 2.5, z1: 5.5, color: "#f25c3f" }, // hood
  { x0: -6.5, x1: -1.0, y0: -2.6, y1: 2.6, z0: 6.0, z1: 10.0, color: "#bfeaf5" }, // cab glass
  { x0: -7.0, x1: -0.5, y0: -3.0, y1: 3.0, z0: 10.0, z1: 11.0, color: "#d94a2e" }, // roof
  { x0: 1.5, x1: 2.5, y0: -0.5, y1: 0.5, z0: 5.5, z1: 9.5, color: "#7a7a7a" }, // exhaust
];

// Wheels are round: a disc on each face plus a slim inset box for the tread.
// x/z is the axle center, r the tire radius, y0..y1 the width.
const TRACTOR_WHEELS = [
  { x: -4.5, y0: 3.0, y1: 5.0, z: 2.5, r: 2.5 }, // rear L
  { x: -4.5, y0: -5.0, y1: -3.0, z: 2.5, r: 2.5 }, // rear R
  { x: 5.0, y0: 2.3, y1: 3.9, z: 1.6, r: 1.6 }, // front L
  { x: 5.0, y0: -3.9, y1: -2.3, z: 1.6, r: 1.6 }, // front R
];

// Round beacon light on the cab roof
const TRACTOR_SHAPES = [{ blob: true, x: -4.9, y: 0, z: 11.6, r: 0.8, color: "#ffb433" }];

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

function trailerBoxes() {
  if (cargo === 0) return TRAILER_BOXES;
  // Grain heap grows with the load
  const h = 0.8 + 2.4 * (cargo / TRAILER_CAP);
  return TRAILER_BOXES.concat([
    { x0: -20.5, x1: -12.0, y0: -3.6, y1: 3.6, z0: 7.0, z1: 7.0 + h, color: "#f0cf5e" },
  ]);
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
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.fx * q.fy - q.fx * p.fy;
  }
  return a;
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
    const sh = [shPt(x0, -hw), shPt(x1, -hw), shPt(x1, hw), shPt(x0, hw)];
    ctx.moveTo(sh[0].x, sh[0].y);
    for (const p of sh.slice(1)) ctx.lineTo(p.x, p.y);
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
  ctx.fill();

  // Painter's algorithm: depth along the view axis is wx + wy + wz.
  const items = [];
  const liftZ = imp.liftable ? tractor.implLift * IMPLEMENT_LIFT_HEIGHT : 0;
  makeItems(items, BOXES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeWheels(items, TRACTOR_WHEELS, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeRoundItems(items, TRACTOR_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeItems(items, impBoxes, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeWheels(items, imp.wheels, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeItems(items, FARM_BOXES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  makeRoundItems(items, FARM_SHAPES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
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
      const boxes =
        a.species === "cow" ? COW_BOXES : a.species === "horse" ? HORSE_BOXES : CHICKEN_BOXES;
      makeItems(items, boxes, a.wx, a.wy, a.angle, 0, camX, camY);
    }
    for (let i = start; i < items.length; i++) {
      items[i].depth = a.sd + 2.5 + (i - start) * 1e-4;
    }
  }
  for (const s of sacks) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    makeRoundItems(items, SACK_SHAPES, s.wx, s.wy, 0, 0, camX, camY);
  }
  items.sort((a, b) => a.depth - b.depth);

  for (const item of items) {
    if (item.blob) {
      // Soft sphere: base ellipse with a lighter highlight up and to the left
      ctx.fillStyle = shade(item.color, item.k);
      ctx.beginPath();
      ctx.ellipse(item.blob.x, item.blob.y, item.rx, item.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(item.color, item.k * 1.16);
      ctx.beginPath();
      ctx.ellipse(
        item.blob.x - item.rx * 0.25,
        item.blob.y - item.ry * 0.3,
        item.rx * 0.55,
        item.ry * 0.5,
        0, 0, Math.PI * 2
      );
      ctx.fill();
      continue;
    }
    if (item.poly) {
      ctx.fillStyle = shade(item.color, item.k);
      ctx.beginPath();
      ctx.moveTo(item.poly[0].x, item.poly[0].y);
      for (const p of item.poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    for (const face of FACES) {
      const pts = face.i.map((i) => item.pts[i]);
      if (signedArea(pts) <= 0) continue;

      const nx = face.n[0] * item.cos - face.n[1] * item.sin;
      const ny = face.n[0] * item.sin + face.n[1] * item.cos;
      const d = nx * LIGHT.x + ny * LIGHT.y + face.n[2] * LIGHT.z;
      const k = Math.min(1, Math.max(0.3, 0.3 + d));

      ctx.fillStyle = shade(item.box.color, k);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Wheel tracks: stamped permanently into the prerendered map canvas while
// driving over unplowed field dirt (working a tile repaints it clean).
// ---------------------------------------------------------------------------

const TRACK_WHEELS = [
  { x: -4.5, y: 4.0, w: 2 }, // rear left (wide tire, wide mark)
  { x: -4.5, y: -4.0, w: 2 }, // rear right
  { x: 5.0, y: 3.1, w: 1 }, // front left
  { x: 5.0, y: -3.1, w: 1 }, // front right
];

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
    if (tileTypeAt(wx, wy) !== 1) continue; // marks only on unplowed field dirt
    const px = Math.round(projX(wx, wy) + MAP_OFFSET_X);
    const py = Math.round(projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y);
    mapCtx.fillStyle = "rgba(94,66,38,0.45)";
    mapCtx.fillRect(px - (wheel.w >> 1), py, wheel.w, 1);
  }
}

// ---------------------------------------------------------------------------
// Seasons: the round runs from spring through summer into autumn. Colors
// interpolate through three keyframes, and the ground takes the new colors
// gradually as a few random tiles repaint every frame.
// ---------------------------------------------------------------------------

const GRASS_SEASONS = ["#72ca55", "#55b043", "#bda355"];
const GRASS_DOT_SEASONS = [
  ["#5fb944", "#47a136", "#a89043"],
  ["#8adf70", "#6cc957", "#cdb45e"],
  ["#97e87e", "#78d364", "#d9c06a"],
  ["#52a63f", "#3f8f31", "#96813c"],
];
const TREE_BLOB_SEASONS = [
  ["#57b754", "#4fae4a", "#c67b2e"],
  ["#68c765", "#5fc257", "#d99a33"],
  ["#7cd678", "#72d367", "#e8b84a"],
];
const SKY_TOP_SEASONS = ["#7ac9ef", "#6fc3e8", "#8fb8d8"];
const SKY_BOTTOM_SEASONS = ["#c8ecf8", "#c2e8f2", "#ecdcc0"];

let seasonQ = 0; // 0 = spring, 0.5 = summer, 1 = autumn (quantized)
let seasonStep = -1;

// The round is presented as a calendar: April 1st through October 31st
const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SEASON_DAYS = 213; // days from Apr 1 to Oct 31
const SEASON_BAR_COLORS = ["#6fce58", "#4fae4a", "#d99a33"];

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

function seasonHex(triple) {
  return seasonQ < 0.5
    ? mixHex(triple[0], triple[1], seasonQ * 2)
    : mixHex(triple[1], triple[2], (seasonQ - 0.5) * 2);
}

function updateSeason() {
  const t = Math.min(1, Math.max(0, 1 - timeLeft / ROUND_TIME));
  const step = Math.min(32, (t * 33) | 0);
  if (step !== seasonStep) {
    seasonStep = step;
    seasonQ = step / 32;
    GRASS = seasonHex(GRASS_SEASONS);
    for (let i = 0; i < GRASS_DOTS.length; i++)
      GRASS_DOTS[i] = seasonHex(GRASS_DOT_SEASONS[i]);
    for (let i = 0; i < TREE_BLOBS.length; i++)
      TREE_BLOBS[i].color = seasonHex(TREE_BLOB_SEASONS[i]);
    paintSky();
  }
  // The ground turns gradually: a few random tiles repaint per frame with
  // the current colors (as a side effect, old wheel tracks slowly fade)
  for (let i = 0; i < 8; i++) {
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
const skyCtx = skyCanvas.getContext("2d");

function paintSky() {
  const g = skyCtx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, seasonHex(SKY_TOP_SEASONS));
  g.addColorStop(1, seasonHex(SKY_BOTTOM_SEASONS));
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
  ctx.fillStyle = "rgba(255,255,255,0.92)";
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
// Exhaust smoke & chaff particles
// ---------------------------------------------------------------------------

const smoke = [];
let smokeTimer = 0;

function updateSmoke(dt) {
  if (!gameOver && (keys.ArrowUp || Math.abs(tractor.speed) > 5)) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = keys.ArrowUp ? 0.07 : 0.18;
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

// Classic rounds are timed; the score is the profit made before time runs
// out. The five best scores are kept in localStorage.
const ROUND_TIME = 300; // seconds — one Apr 1 – Oct 31 season in either mode
const START_CASH = 100;
const SCORES_KEY = "traktoripeli.best";
let timeLeft = ROUND_TIME;
let gameOver = false;
let bestScores = [];
let finalRank = -1; // this round's place in the best list, -1 if none

// Survival mode: the years keep rolling and every Oct 31 the property tax
// is collected, growing a little each year, income or not. Seeds can go on
// credit down to the debt limit; sink below it and the bank takes the farm.
// Its scoreboard is the longest runs in years, kept apart from the classic.
const SURVIVAL_START_CASH = 250;
const TAX_BASE = 150; // € — the first year's property tax
const TAX_STEP = 75; // € added to the tax each following year
const DEBT_LIMIT = 400; // bankruptcy when cash drops below -this
const SURVIVAL_SCORES_KEY = "traktoripeli.survival";
let year = 1;
let propertyTax = TAX_BASE;
let taxFlash = 0; // seconds left of the "tax paid" banner
let taxPaid = 0; // amount shown in that banner

function startGame(m) {
  mode = m;
  cash = m === "survival" ? SURVIVAL_START_CASH : START_CASH;
  gameStarted = true;
  menuOpen = false;
}

function endRound() {
  gameOver = true;
  tractor.speed = 0;
  const entry = { score: cash - START_CASH, seed: SEED, date: Date.now() };
  let scores;
  try {
    scores = JSON.parse(localStorage.getItem(SCORES_KEY)) || [];
  } catch {
    scores = [];
  }
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  bestScores = scores.slice(0, 5);
  finalRank = bestScores.indexOf(entry);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(bestScores));
  } catch {
    // private browsing etc: scores just aren't persisted
  }
}

// Bankruptcy ends a survival run; the score is how many years the farm held
// out, with the closing balance as the tiebreak
function endSurvival() {
  gameOver = true;
  tractor.speed = 0;
  const entry = { years: year, cash, seed: SEED, date: Date.now() };
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

// € — enough starting capital for the first bag of seeds; survival starts
// with a bit more as a buffer against the first tax bill
let cash = mode === "survival" ? SURVIVAL_START_CASH : START_CASH;
let seeds = 0; // start empty: buy seeds at the farm
let cargo = 0; // sacks on the trailer
let sold = 0; // total sacks delivered to the farm
const sacks = []; // grain sacks lying on the fields

const tractor = {
  x: FARM.x + 34,
  y: FARM.y + 10,
  angle: -2.4, // facing up-left, toward the middle of the map
  speed: 0, // world units/s, positive = forward
  fastGear: true, // Shift toggles between road and work gear
  implement: "plow", // current implement: plow / seeder / harvester / trailer
  implAngle: -2.4, // world heading of a towed implement (trails the hitch)
  implDown: false, // Space toggles the implement
  implLift: 1, // animated: 0 = working the ground, 1 = fully raised
  implBounce: 0, // seconds left of the refused-lower dip animation
  gearFlash: 0, // seconds left of the red HUD flash (refused: gear too fast)
  implFlash: 0, // seconds left of the red HUD flash (implement complaint)
};

const ACCEL = 55;
const BRAKE = 80;
const FRICTION = 28;
const GEAR_FAST = 42;
const GEAR_SLOW = 16;
const MAX_REVERSE = -20;
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

function update(dt) {
  // Ambient life keeps moving even after the round ends
  worldTime += dt;
  updateSmoke(dt);
  updateButterflies(dt);
  updateAnimals(dt);
  updateBirds(dt);
  updateSeason();
  if (!gameStarted || gameOver) return;

  timeLeft = Math.max(0, timeLeft - dt);
  if (timeLeft === 0) {
    if (mode === "survival") {
      // Oct 31: the tax collector comes around, then a new year begins
      cash -= propertyTax;
      taxPaid = propertyTax;
      taxFlash = 4;
      playTax();
      if (cash < -DEBT_LIMIT) {
        endSurvival();
        return;
      }
      year++;
      propertyTax += TAX_STEP;
      timeLeft = ROUND_TIME;
    } else {
      endRound();
      return;
    }
  }
  taxFlash = Math.max(0, taxFlash - dt);

  const imp = IMPLEMENTS[tractor.implement];

  // Throttle / brake
  if (keys.ArrowUp) {
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
  if (!keys.ArrowUp && !keys.ArrowDown && Math.abs(tractor.speed) < 1.5) {
    tractor.speed = 0;
  }

  // Top speed from the gear, further reduced by drag when working the ground
  let maxForward =
    (tractor.fastGear ? GEAR_FAST : GEAR_SLOW) *
    (imp.liftable ? 1 - 0.35 * (1 - tractor.implLift) : 1);
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

  // Cows and sheep are solid: drive into one and the tractor stops until
  // it has plodded aside (they walk clear of a nearby tractor on their
  // own). Only blocked while closing in, so backing away always works.
  for (const an of animals) {
    if (an.species !== "cow" && an.species !== "sheep") continue;
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
  tractor.gearFlash = Math.max(0, tractor.gearFlash - dt);
  tractor.implFlash = Math.max(0, tractor.implFlash - dt);

  // Field work under the implement while it's down and moving
  if (imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > 2) {
    const pose = implementPose();
    const pcos = Math.cos(pose.angle);
    const psin = Math.sin(pose.angle);
    const alongX = Math.abs(pcos) > Math.abs(psin);
    for (const oy of [-3.5, 0, 3.5]) {
      const wx = pose.x - 9.8 * pcos - oy * psin;
      const wy = pose.y - 9.8 * psin + oy * pcos;
      if (tractor.implement === "plow") plowTileAt(wx, wy, alongX);
      else if (tractor.implement === "seeder") seedTileAt(wx, wy);
      else if (tractor.implement === "harvester") harvestTileAt(wx, wy);
    }
  }

  // The trailer scoops up grain sacks it passes over
  if (tractor.implement === "trailer") {
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
  updateCrops(dt);
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
  drawBirds(camX, camY);

  screenCtx.drawImage(view, 0, 0, screenCanvas.width, screenCanvas.height);

  // HUD: a worn wooden plank bar along the bottom
  const imp = IMPLEMENTS[tractor.implement];
  const barY = screenCanvas.height - 28;
  screenCtx.fillStyle = "#4a2f1a";
  screenCtx.fillRect(0, barY - 3, screenCanvas.width, 3);
  screenCtx.fillStyle = "#7a4f2d";
  screenCtx.fillRect(0, barY, screenCanvas.width, 28);
  screenCtx.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
  for (let px = 40; px < screenCanvas.width; px += 80) screenCtx.fillRect(px, barY, 1, 28);
  screenCtx.fillStyle = "rgba(255,240,200,0.15)"; // sun-bleached top edge
  screenCtx.fillRect(0, barY, screenCanvas.width, 1);

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
  const flashGear = tractor.gearFlash > 0 && ((tractor.gearFlash * 8) | 0) % 2 === 0;
  const flashImpl = tractor.implFlash > 0 && ((tractor.implFlash * 8) | 0) % 2 === 0;
  // One world unit is ~0.3 m, so units/s * 3.6 * 0.3 gives km/h
  const kmh = Math.abs(tractor.speed) * 1.08;
  seg(`${kmh.toFixed(0).padStart(2)} KM/H   `);
  seg(`GEAR: ${tractor.fastGear ? "FAST" : "SLOW"} [Shift]   `, flashGear ? RED : null);
  const state = imp.liftable ? (tractor.implDown ? " DOWN" : " UP") : "";
  seg(`${imp.label}${state} [Space]   `, flashImpl ? RED : null);
  if (tractor.implement === "seeder") seg(`SEEDS: ${seeds}   `, seeds === 0 ? RED : null);
  if (tractor.implement === "trailer") seg(`CARGO: ${cargo}/${TRAILER_CAP}   `);
  seg(`CASH: €${cash}   `, cash < SEED_PRICE ? RED : "#ffd94f");
  seg(`SOLD: ${sold}   `);
  seg(`@FARM 1:PLOW 2:SEED 3:HARVEST 4:TRAILER`, "#d8c49a");

  // Seed readout on a little leather tag, so a nice map can be shared
  screenCtx.font = "11px monospace";
  const infoText =
    `SEED ${SEED}   [F1] MENU  ` +
    `[M] MUSIC ${musicMuted ? "OFF" : "ON"}  [Q] SOUND ${soundMuted ? "OFF" : "ON"}`;
  screenCtx.fillStyle = "rgba(58,40,24,0.55)";
  screenCtx.fillRect(6, 6, screenCtx.measureText(infoText).width + 12, 36);
  label(infoText, 12, 20, "#f5e9c8");
  label(`${fps.toFixed(0)} FPS`, 12, 36, "#d8c49a");

  // Season calendar instead of a clock: the current date counts from spring
  // toward the end date, with a progress bar in between. Flashes red for
  // the last 30 seconds of the round.
  const progress = 1 - timeLeft / ROUND_TIME;
  const date = new Date(
    2000, 3, 1 + Math.min(SEASON_DAYS, Math.floor(progress * (SEASON_DAYS + 1)))
  );
  const barW = 170;
  const barH = 8;
  const bx = (screenCanvas.width - barW) / 2;
  const by = 14;
  const flash = timeLeft < 30 && ((timeLeft * 2) | 0) % 2 === 0;
  screenCtx.font = "bold 13px monospace";
  screenCtx.textAlign = "right";
  label(
    `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`,
    bx - 10,
    by + barH,
    flash ? "#ff5040" : "#f5e9c8"
  );
  screenCtx.textAlign = "left";
  label("OCT 31", bx + barW + 10, by + barH, "#d8c49a");
  // The season grows along a wooden trough
  screenCtx.fillStyle = "#4a2f1a";
  screenCtx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
  screenCtx.fillStyle = "#2e1d10";
  screenCtx.fillRect(bx, by, barW, barH);
  screenCtx.fillStyle = flash ? "#ff5040" : seasonHex(SEASON_BAR_COLORS);
  screenCtx.fillRect(bx, by, Math.round(barW * progress), barH);

  // Survival: the year and the tax bill waiting at the end of it, swapped
  // for a red receipt banner for a few seconds after the tax is collected
  if (mode === "survival") {
    screenCtx.font = "bold 11px monospace";
    screenCtx.textAlign = "center";
    if (taxFlash > 0 && !gameOver) {
      label(`PROPERTY TAX PAID: -€${taxPaid}`, bx + barW / 2, by + barH + 16, "#ff5040");
    } else {
      label(
        `YEAR ${year} — TAX DUE OCT 31: €${propertyTax}`,
        bx + barW / 2,
        by + barH + 16,
        "#f5e9c8"
      );
    }
    screenCtx.textAlign = "left";
  }

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
    if (mode === "survival") {
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
          `${i + 1}.  ${entry.years} YEAR${entry.years === 1 ? " " : "S"}   €${entry.cash}   (seed ${entry.seed})`,
          cx,
          y + 106 + i * 20,
          i === finalRank ? "#ffd94f" : "#e0d0a8"
        );
      });
    } else {
      label("OCT 31 — SEASON'S END", cx, y + 40, "#ffd94f");
      screenCtx.font = "bold 18px monospace";
      label(`PROFIT: €${cash - START_CASH}`, cx, y + 74, "#f5e9c8");
      screenCtx.font = "13px monospace";
      bestScores.forEach((entry, i) => {
        label(
          `${i + 1}.  €${entry.score}   (seed ${entry.seed})`,
          cx,
          y + 106 + i * 20,
          i === finalRank ? "#ffd94f" : "#e0d0a8"
        );
      });
    }
    label("[F1] MENU — NEW GAME, MAP OR MODE", cx, y + h - 18, "#c9e6a8");
    screenCtx.textAlign = "left";
  }

  // Minimap panel in the top-right corner
  const mmScale = 2;
  const mmW = minimapCanvas.width * mmScale;
  const mmH = minimapCanvas.height * mmScale;
  const mmX = screenCanvas.width - mmW - 12;
  const mmY = 12;
  // Wooden picture frame around the map
  screenCtx.fillStyle = "#4a2f1a";
  screenCtx.fillRect(mmX - 8, mmY - 8, mmW + 16, mmH + 16);
  screenCtx.fillStyle = "rgba(122,79,45,0.95)";
  screenCtx.fillRect(mmX - 5, mmY - 5, mmW + 10, mmH + 10);
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
  screenCtx.fillStyle = "#f25c3f";
  screenCtx.fillRect(tmx - 1, tmy - 1, 2, 2);
  screenCtx.restore();

  // Start / F1 menu: seed and mode on a little wooden sign. A fresh visit
  // opens it before the clock starts; F1 brings it back later.
  if (menuOpen) {
    const w = 420;
    const h = 192;
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
    label("MAP SEED", cx, y + 46, "#d8c49a");
    screenCtx.fillStyle = "#2e1d10";
    screenCtx.fillRect(x + 90, y + 52, w - 180, 24);
    screenCtx.font = "bold 14px monospace";
    const caret = ((worldTime * 2) | 0) % 2 === 0 ? "_" : " ";
    label(menuSeed + caret, cx, y + 69, "#f5e9c8");

    screenCtx.font = "bold 12px monospace";
    const modeRows = [
      ["classic", "CLASSIC  — ONE SEASON, RACE FOR PROFIT"],
      ["survival", "SURVIVAL — PAY THE YEARLY TAX, SURVIVE"],
    ];
    modeRows.forEach(([m, text], i) => {
      const sel = menuMode === m;
      label((sel ? "» " : "  ") + text, cx, y + 104 + i * 20, sel ? "#ffd94f" : "#e0d0a8");
    });

    screenCtx.font = "11px monospace";
    label(
      "[↑↓] MODE   [ENTER] START   [N] NEW MAP" +
        (gameStarted ? "   [ESC] CLOSE" : ""),
      cx,
      y + h - 14,
      "#c9e6a8"
    );
    screenCtx.textAlign = "left";
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = performance.now();
let fps = 0;

function loop(now) {
  const frameMs = now - lastTime;
  const dt = Math.min(frameMs / 1000, 0.05);
  lastTime = now;
  // Smoothed over ~20 frames so the readout doesn't flicker
  if (frameMs > 0) fps += (1000 / frameMs - fps) * 0.05;
  update(dt);
  updateAudio();
  updateCamera(dt);
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
