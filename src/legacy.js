import { VIEW_W, VIEW_H } from "./setup.js";
import { MAP_INDEX, mode, gameStarted, rand } from "./rng.js";
import { TILE, MAP_TILES, MAP_SIZE, projX, projY, rotateLocal } from "./projection.js";
import { shade, tint } from "./lighting.js";
import { ditherRegion } from "./dithering.js";
import { audio } from "./sound.js";
import { scheduleMusic } from "./music.js";
import { initTerrain, terrainHeight } from "./terrain.js";
import {
  FARM,
  PADDOCK_SIZE,
  PADDOCKS_LOCAL,
  PADDOCKS_WORLD,
  setPaddocksLocal,
  setPaddocksWorld,
  FARM_BUILDING_FOOTPRINTS,
} from "./farmyard.js";
import {
  mapCanvas,
  mapCtx,
  tiles,
  dirs,
  growth,
  tileTypeAt,
  mp,
  drawTile,
  roadSamples,
  roadTiles,
  tileKey,
  makeMap,
} from "./ground.js";
import { minimapCtx, FARM_MARKER, CITY_MARKER, roadPixels, minimapTile } from "./minimap.js";
import { initTrees } from "./trees.js";
import { initBushes } from "./bushes.js";
import { initAnimals, initBirds } from "./animals.js";
import { initSignposts } from "./signposts.js";
import { initCart } from "./cart.js";
import { IMPLEMENTS, initBoxModels } from "./box-models.js";
import { draw } from "./hud-and-overlays.js";
import { keys, paused, refreshMenuSaveInfo, awayClock } from "./input.js";
import { updateFps } from "./fps.js";
import { touchDrive } from "./touch.js";
import { GRASS } from "./seasons.js";
import { initSky } from "./sky.js";
import { initButterflies } from "./butterflies.js";
import { placeLadybug } from "./ladybug.js";
import {
  tractor,
  gameOver,
  GEAR_FAST,
  autoThrottling,
  update,
  advanceTime,
  loadSavedRun,
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
    loadSavedRun(s);
    cam.x = projX(tractor.x, tractor.y) - VIEW_W / 2;
    cam.y =
      projY(tractor.x, tractor.y, terrainHeight(tractor.x, tractor.y)) - VIEW_H / 2;
    for (const [tx, ty] of dirty) drawTile(tx, ty);
  }
}

let lastTime = performance.now();
let awayPool = 0; // time the dt cap discarded, waiting to be applied

function loop(now) {
  const frameMs = now - lastTime;
  const dt = Math.min(frameMs / 1000, 0.05);
  lastTime = now;
  updateFps(frameMs);
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
