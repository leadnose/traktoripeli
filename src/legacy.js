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
import { TILE, MAP_TILES, MAP_SIZE, projX, projY, rotateXY, rotateLocal } from "./projection.js";
import {
  LIGHT,
  INK,
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
import { CITY, CITY_RADIUS, nearCity } from "./city.js";
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
import { TREE_BLOBS, TREE_KINDS, trees, treesByTile, initTrees } from "./trees.js";
import { bushes, initBushes } from "./bushes.js";
import {
  ANIMAL_SPECS,
  ANIMAL_BOXES,
  SHEEP_BOXES,
  SHEEP_SHAPES,
  animals,
  initAnimals,
  updateAnimals,
  updateHerds,
  initBirds,
  updateBirds,
  drawBirds,
} from "./animals.js";
import { signs, drawSign, initSignposts } from "./signposts.js";
import { CART_BOXES, CART_WHEELS, CART_DRIVER, cart, initCart, updateCart } from "./cart.js";
import {
  TIRE,
  HUB,
  TRACTOR_BODY,
  BOXES,
  TRACTOR_WHEELS,
  TRACTOR_SHAPES,
  DRIVER_SHAPES,
  IMPLEMENT_LIFT_HEIGHT,
  IMPLEMENTS,
  FARM_BOXES,
  PADDOCK_BOXES,
  FARM_SHAPES,
  FARM_SOLID_WORLD,
  FENCE_SOLID_WORLD,
  CITY_BOXES,
  CITY_SHAPES,
  SACK_SHAPES,
  FACES,
  signedArea4,
  initBoxModels,
} from "./box-models.js";
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
      const k = clamp(AMBIENT_FLOOR + d, AMBIENT_FLOOR, 1);
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
export const sceneCtx = sceneCanvas.getContext("2d");

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
      const k = clamp(AMBIENT_FLOOR + d, AMBIENT_FLOOR, 1);

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
// Sky: gradient, a friendly sun, and puffy clouds drifting past the island
// ---------------------------------------------------------------------------

export let worldTime = 0;

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

export function paintSky() {
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
export function spawnChaff(wx, wy) {
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
export const ROUND_TIME = Math.round((300 * SEASON_DAYS) / 213);
export let timeLeft = ROUND_TIME;
export let gameOver = false;
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

export function startGame(m) {
  setMode(m);
  cash = modeStartCash(m);
  setGameStarted(true);
  setMenuOpen(false);
  setPaused(false);
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
export function tryDateJump() {
  if (dateJump.length !== 4) {
    setDateJumpError(true);
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
    setDateJumpError(true);
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
  setDateJump(null);
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
export let savingDisabled = false; // set when navigating away from a discarded run
// Only this module may reassign savingDisabled (ESM imports are read-only
// bindings) - input.js's handleMenuKey() calls this instead.
export function setSavingDisabled(v) {
  savingDisabled = v;
}

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

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === SAVE_VERSION && s.tiles && s.tiles.length === MAP_TILES
      ? s
      : null;
  } catch {
    return null;
  }
}

export function clearSave() {
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
export function continueInSandbox() {
  setMode("sandbox");
  cash = SANDBOX_START_CASH;
  gameOver = false;
  taxFlash = 0;
  saveGame();
}

// Starting capital by mode: survival a buffer against the first tax bill,
// sandbox plenty
let cash = modeStartCash(mode);
export let seeds = 0; // start empty: buy seeds at the farm
let cargo = 0; // sacks on the trailer
let sold = 0; // total sacks delivered to the city
let fuel = FUEL_CAP; // start full
// Set once per frame in update(dt) and read again by the HUD in draw(), so
// each proximity check only runs its Math.hypot once a frame instead of once
// per reader
let atFuelTank = false;
let atCity = false;
export const sacks = []; // grain sacks lying on the fields

// Only this module may reassign `seeds` (ESM imports are read-only
// bindings) — ground.js's seedTileAt() calls this instead of `seeds--`.
export function consumeSeed() {
  seeds--;
}

export const tractor = {
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
export const GEAR_SLOW_RATIO = GEAR_SLOW / 16; // 16 was the original GEAR_SLOW
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
export function implementOverField() {
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

// Undo the tractor's move for this frame and bring it to a hard stop —
// shared by every solid-obstacle collision check below (water, trees,
// buildings, fences, animals). A hard stop, not a coast: angVel is zeroed
// too so the tractor doesn't sit there spinning in place against the wall.
function stopTractor(prevX, prevY) {
  tractor.x = prevX;
  tractor.y = prevY;
  tractor.speed = 0;
  tractor.angVel = 0;
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

  // Shared across the phases below: applyThrottleAndGravity fills
  // cos/sin/throttleInput/brakeInput in, each read again by a later phase
  // (burnFuel's throttle check, moveTractor's cos/sin, checkCollisions'
  // prevX/prevY set by moveTractor).
  let cos, sin, throttleInput, brakeInput, prevX, prevY;

  // Throttle / brake (touch uses proportional input, keyboard stays digital)
  function applyThrottleAndGravity() {
  const touchThrottle = touchDrive.throttleActive ? touchDrive.throttle : 0;
  throttleInput = Math.max(
    keys.ArrowUp ? 1 : 0,
    touchThrottle > 0 ? touchThrottle : 0,
    autoThrottling() ? 1 : 0
  );
  brakeInput = Math.max(keys.ArrowDown ? 1 : 0, touchThrottle < 0 ? -touchThrottle : 0);
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
  cos = Math.cos(tractor.angle);
  sin = Math.sin(tractor.angle);
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
  }
  applyThrottleAndGravity();

  // Burn fuel only while actually powering the wheels
  function burnFuel() {
  if (throttleInput > 0) {
    fuel = Math.max(
      0,
      fuel - (tractor.fastGear ? FUEL_BURN_ROAD : FUEL_BURN_WORK) * throttleInput * dt
    );
  }
  }
  burnFuel();

  // Top speed from the gear, further reduced by drag when working the ground
  function limitGearSpeed() {
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
  }
  limitGearSpeed();

  // Steering only has effect while moving; reversing flips it like a real vehicle
  function applySteering() {
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
  }
  applySteering();

  // Move on the ground plane
  function moveTractor() {
  prevX = tractor.x;
  prevY = tractor.y;
  tractor.x += cos * tractor.speed * dt;
  tractor.y += sin * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = clamp(tractor.x, margin, MAP_SIZE - margin);
  tractor.y = clamp(tractor.y, margin, MAP_SIZE - margin);
  }
  moveTractor();

  function checkCollisions() {
  // Water blocks the tractor, except where a road bridges it
  if (
    tileTypeAt(tractor.x, tractor.y) === 4 &&
    !roadTiles.has(tileKey(tractor.x, tractor.y))
  ) {
    stopTractor(prevX, prevY);
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
          stopTractor(prevX, prevY);
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
      stopTractor(prevX, prevY);
      break;
    }
  }

  // Paddock fences stop the tractor too, but only the rail line itself —
  // FENCE_SOLID_WORLD is a ring of thin strips, not a solid block, so the
  // pasture inside stays open ground the tractor just can't reach.
  for (const b of FENCE_SOLID_WORLD) {
    if (tractor.x > b.x0 && tractor.x < b.x1 && tractor.y > b.y0 && tractor.y < b.y1) {
      stopTractor(prevX, prevY);
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
      stopTractor(prevX, prevY);
      break;
    }
  }
  }
  checkCollisions();

  // A towed implement's wheels roll rather than skid, so the hitch's
  // sideways motion swings its heading toward the tractor's over time
  function updateHitchAndLift() {
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
  }
  updateHitchAndLift();

  // Field work under the implement while it's down and moving. A pass is
  // locked to a single row of tiles: the lane is picked where work starts,
  // and the lock gates the work — wobbling over a tile boundary works
  // nothing (never the neighboring row, and never the locked row from a
  // distance, which would let a zigzag cover two rows in one pass). The
  // lock moves once the centerline is well inside a neighboring row, or
  // when the travel axis flips. Raising the implement ends the pass.
  function doFieldWork() {
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
  }
  doFieldWork();

  // The trailer scoops up grain sacks it passes over — only in work mode,
  // same as the other implements needing their gear down to do their job.
  // The trailer has no lift of its own to gate this on (it's not
  // liftable), so without this it would scoop just as well at road-gear
  // speed, sacks flying into the bed at 40+.
  function pickUpTrailerSacks() {
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
  }
  pickUpTrailerSacks();

  function handleRefuelAndTrading() {
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
  }
  handleRefuelAndTrading();

  updateTracks(dt);
  updateCrops(
    mode === "sandbox" ? dt * sandboxClockRate() * SANDBOX_GROW_FACTOR : dt
  );

  // Periodic autosave so even a crash or hard reload loses only moments
  function triggerAutosave() {
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    saveGame();
  }
  }
  triggerAutosave();
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
