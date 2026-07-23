import {
  screenCanvas,
  screenCtx,
  VIEW_W,
  VIEW_H,
  view,
  ctx,
  clamp,
  nearPoint,
  AMBIENT_FLOOR,
} from "./setup.js";
import { MAP_PROFILES } from "./map-profiles.js";
import {
  MAP_INDEX,
  PROFILE,
  SEED,
  MODES,
  mode,
  gameStarted,
  setMode,
  setGameStarted,
  rand,
  rollBand,
} from "./rng.js";
import { TILE, MAP_TILES, MAP_SIZE, projX, projY, rotateLocal } from "./projection.js";
import {
  MAP_INK,
  ROAD_INK,
  shade,
  mixHex,
  tint,
  grassDotShades,
  dirtDotShades,
  meadowTint,
  stubbleTint,
} from "./lighting.js";
import { ditherRegion } from "./dithering.js";
import {
  audio,
  soundMuted,
  musicMuted,
  initAudio,
  playHydraulic,
  playClunk,
  playPickup,
  playSell,
  playTax,
  toggleMusic,
  toggleSound,
} from "./sound.js";
import { scheduleMusic } from "./music.js";
import { initTerrain, terrainHeight } from "./terrain.js";
import {
  FARM,
  FARM_RADIUS,
  nearFarm,
  PADDOCK_SIZE,
  PENNED_SPECIES,
  PADDOCKS_LOCAL,
  PADDOCKS_WORLD,
  setPaddocksLocal,
  setPaddocksWorld,
  insideAnyPaddock,
  nearAnyPaddock,
  FARM_BUILDING_FOOTPRINTS,
  FARM_PASTURE_RADIUS,
  FUEL_TANK_LOCAL,
  FUEL_TANK_LEN,
  FUEL_TANK_R,
  FUEL_TANK_STAND_H,
  nearFuelTank,
  yardScaleAt,
  YARD_MAX_SCALE,
  YARD_RADIUS,
  inYard,
  farmYardPath,
} from "./farmyard.js";
import {
  MAP_OFFSET_X,
  MAP_OFFSET_Y,
  mapCanvas,
  mapCtx,
  tiles,
  dirs,
  growth,
  CROP_STAGES,
  cropStage,
  tileTypeAt,
  GRASS,
  GRASS_DOTS,
  MEADOW,
  MEADOW_DOTS,
  DIRT,
  DIRT_DOTS,
  STUBBLE,
  STUBBLE_DOTS,
  setGrass,
  setMeadow,
  setDirt,
  setStubble,
  seasonStep,
  setSeasonStep,
  WATER_COLOR,
  YARD_DIRT,
  mp,
  isWater,
  drawTile,
  plowTileAt,
  seedTileAt,
  harvestTileAt,
  updateCrops,
  countFieldTiles,
  roads,
  roadSamples,
  roadTiles,
  patches,
  forestTiles,
  meadowTiles,
  tileKey,
  ROAD_COLOR,
  yardPixels,
  makeMap,
} from "./ground.js";
import {
  minimapCanvas,
  minimapCtx,
  MINIMAP_COLORS,
  FARM_MARKER,
  CITY_MARKER,
  roadPixels,
  minimapTile,
} from "./minimap.js";
import { initTrees } from "./trees.js";
import { initBushes } from "./bushes.js";
import { initAnimals, initBirds, drawBirds } from "./animals.js";
import { signs, drawSign, initSignposts } from "./signposts.js";
import { initCart } from "./cart.js";
import { TRACTOR_BODY, IMPLEMENTS, initBoxModels } from "./box-models.js";
import { drawScene } from "./scene-rendering.js";
import {
  keys,
  IMPLEMENT_KEYS,
  menuOpen,
  paused,
  autoThrottleOn,
  dateJump,
  dateJumpError,
  menuMap,
  menuMode,
  menuSaveInfo,
  refreshMenuSaveInfo,
  awayClock,
  setMenuOpen,
  setPaused,
  setDateJump,
  setDateJumpError,
} from "./input.js";
import { touchDrive } from "./touch.js";
import { updateTracks } from "./wheel-tracks.js";
import {
  GRASS,
  MEADOW,
  DIRT,
  STUBBLE,
  MONTH_NAMES,
  SEASON_DAYS,
  SEASON_BAR_COLORS,
  SKY_TOP_SEASONS,
  SKY_BOTTOM_SEASONS,
  seasonHex,
  updateSeason,
} from "./seasons.js";
import { skyCanvas, drawSun, drawClouds, initSky } from "./sky.js";
import { drawMist } from "./mist.js";
import { butterflies, initButterflies, updateButterflies, drawButterflies } from "./butterflies.js";
import { ladybug, luckFlash, placeLadybug, updateLadybug, drawLadybug } from "./ladybug.js";
import { updateSmoke, spawnChaff, drawSmoke } from "./smoke.js";
import {
  worldTime,
  tractor,
  cash,
  seeds,
  cargo,
  sold,
  fuel,
  atFuelTank,
  atCity,
  sacks,
  year,
  propertyTax,
  timeLeft,
  gameOver,
  bestScores,
  finalRank,
  taxFlash,
  taxPaid,
  taxYear,
  GEAR_FAST,
  SEED_PRICE,
  FUEL_CAP,
  TRAILER_CAP,
  autoThrottling,
  implementOverField,
  update,
  sandboxClockRate,
  currentCalendarDay,
} from "./tractor.js";
import { loadSave } from "./save.js";
import { cam, updateCamera } from "./camera.js";

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



initTerrain();


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
  setPaddocksLocal({});
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
  setPaddocksWorld({});
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
export function paintPaddockFills() {
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
export const paddockDabs = [];
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

initTrees();
initBushes();
initAnimals();
initSignposts();
initCart();
initBirds();
initBoxModels();
initSky();
initButterflies();
placeLadybug();

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
  // Scene, sky and weather compositing: everything that isn't HUD/overlay
  function drawWorldAndWeather() {
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
  }
  drawWorldAndWeather();

  // Text is stamped: a dark offset shadow under warm cream
  const label = (str, x, y, color) => {
    screenCtx.fillStyle = "rgba(40,24,12,0.9)";
    screenCtx.fillText(str, x + 1, y + 1);
    screenCtx.fillStyle = color;
    screenCtx.fillText(str, x, y);
  };

  // A HUD line writer: stamps left-to-right along one baseline, advancing
  // its own cursor past each segment's measured width. Bottom and top bars
  // each get one, independent cursors starting at the same left margin.
  const makeSegWriter = (y, startX) => {
    let x = startX;
    return (text, color) => {
      label(text, x, y, color || "#f5e9c8");
      x += screenCtx.measureText(text).width;
    };
  };

  // HUD: a worn wooden plank bar along the bottom (prerendered)
  function drawBottomHud() {
  const imp = IMPLEMENTS[tractor.implement];
  screenCtx.drawImage(hudBottomCanvas, 0, barY - 3);
  screenCtx.font = "bold 13px monospace";
  const hudY = screenCanvas.height - 10;
  const seg = makeSegWriter(hudY, 12);
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
  }
  drawBottomHud();

  // The top HUD is a single-line plank bar matching the bottom one, trim
  // mirrored: mode, map and the pause/menu hint on the left, the season
  // calendar in the middle with the year folded into its date label, and
  // the mute icons and FPS on the right
  function drawTopHud() {
  screenCtx.drawImage(hudTopCanvas, 0, 0);

  screenCtx.font = "11px monospace";
  const topY = 18; // shared text baseline in the bar

  // Left: mode, map, and the pause/menu hint
  const topSeg = makeSegWriter(topY, 12);
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
  }
  drawTopHud();

  // Game over: final score and the all-time best list
  function drawGameOverOverlay() {
  if (!gameOver) return;
  {
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
  }
  drawGameOverOverlay();

  // Minimap: a wooden panel hanging off the right end of the top bar,
  // flush with the screen edge. Its dark rim starts at the bar's trim in
  // the same color, so the two read as one piece of carpentry.
  function drawMinimapPanel() {
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
  }
  drawMinimapPanel();

  // Field ledger strip under the minimap: a count per working state
  // (stubble, plowed, sown, ripe) with the total at the right end. Each
  // swatch is the state's minimap tile color, so the strip doubles as the
  // minimap's legend.
  function drawFieldLedger() {
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
  }
  drawFieldLedger();

  // Paused: dusk settles over the farm and a small sign waits for P.
  // The F1 menu draws after this, so it stays readable on top.
  function drawPauseOverlay() {
  if (!paused || menuOpen) return;
  {
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
  }
  drawPauseOverlay();

  // Date-jump field: shows the typed digits in an MM-DD mask; Enter
  // fast-forwards the calendar to that date. Red digits mean the last
  // attempt didn't parse as a reachable date.
  function drawDateJumpOverlay() {
  if (dateJump === null || menuOpen) return;
  {
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
  }
  drawDateJumpOverlay();

  // Start / F1 menu: map and mode on a little wooden sign. A fresh visit
  // opens it before the clock starts; F1 brings it back later.
  function drawStartMenuOverlay() {
  if (!menuOpen) return;
  {
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
  }
  drawStartMenuOverlay();

  function drawFpsReadout() {
  if (!fpsShown) return;
  {
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
  drawFpsReadout();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

// Resume an autosaved run when the URL points at its map and mode. The
// world has just been generated fresh from the seed, so only the tiles the
// player changed need repainting; the season's colors then catch up through
// the usual gradual background repaint.
// A fresh visit opens the start menu: let it offer the autosaved run
refreshMenuSaveInfo();

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
export let fpsShown = false;
// Only this module may reassign fpsShown (ESM imports are read-only
// bindings) - input.js's handleGameplayKey() calls this instead.
export function setFpsShown(v) {
  fpsShown = v;
}
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
