import { clamp } from "./setup.js";
import { PROFILE, rand, rollBand } from "./rng.js";
import { TILE, MAP_TILES, MAP_SIZE, projX, projY } from "./projection.js";
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
import { terrainHeight } from "./terrain.js";
import { FARM, FARM_RADIUS, FARM_PASTURE_RADIUS, nearAnyPaddock, farmYardPath, yardScaleAt } from "./farmyard.js";
import { CITY, CITY_RADIUS } from "./city.js";
// Still only defined in legacy.js at this point in the module split -
// minimapTile/paintPaddockFills/paddockDabs (Minimap section),
// restampTracks (Wheel tracks section), spawnChaff (Smoke section), and
// the seed/sack economy state (Tractor section). Genuine circular imports,
// safe because every one is only read inside a function body called at
// runtime, never during either module's own top-level evaluation.
import { minimapTile, paintPaddockFills, paddockDabs, restampTracks, spawnChaff, seeds, consumeSeed, sacks } from "./legacy.js";

// ---------------------------------------------------------------------------
// Ground map (prerendered once)
// ---------------------------------------------------------------------------

export const EDGE_DEPTH = 36; // thickness of the dirt "cliff" at the map's near edges
export const MAP_OFFSET_X = MAP_SIZE; // shift so projX is never negative
export const MAP_OFFSET_Y = 64; // headroom for hilltops that project above y = 0

export const mapCanvas = document.createElement("canvas");
mapCanvas.width = MAP_SIZE * 2;
mapCanvas.height = MAP_SIZE + EDGE_DEPTH + MAP_OFFSET_Y;

// willReadFrequently keeps the canvas CPU-side: the constant background
// repaints re-dither through getImageData, and on a GPU-backed canvas every
// one of those is a pipeline-stalling readback
export const mapCtx = mapCanvas.getContext("2d", { willReadFrequently: true });

// Tile types: 0 = grass, 1 = field (unplowed / stubble), 2 = plowed, 3 = seeded.
// dirs holds the furrow direction (0 = along world y, 1 = along world x) and
// growth the seconds since seeding, which drives the crop stages.
export const tiles = [];
export const dirs = [];
export const growth = [];
export const CROP_STAGES = [8, 18, 32]; // seconds to reach sprout / young / mature

export function cropStage(g) {
  let s = 0;
  for (const t of CROP_STAGES) if (g >= t) s++;
  return s;
}

export function tileTypeAt(wx, wy) {
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return -1;
  return tiles[ty][tx];
}

// Ground colors are seasonal: these are the spring values (from this map's
// own palette), and updateSeason() rewrites them as the round progresses
export let GRASS = PROFILE.palette.grass[0];
export const GRASS_DOTS = grassDotShades(GRASS);
// Meadow is warmer/yellower than plain grass — a wildflower patch — derived
// from the map's own grass tone rather than a separate authored color
export let MEADOW = meadowTint(GRASS);
export const MEADOW_DOTS = grassDotShades(MEADOW);
export let DIRT = PROFILE.palette.dirt[0];
export const DIRT_DOTS = dirtDotShades(DIRT);
// Stubble — a harvested field before it's plowed — reads as dried pale
// straw rather than bare soil
export let STUBBLE = stubbleTint(DIRT);
export const STUBBLE_DOTS = dirtDotShades(STUBBLE);

// Only this module may reassign GRASS/MEADOW/DIRT/STUBBLE (ESM imports are
// read-only bindings) — updateSeason() (still in legacy.js until seasons.js
// exists, its real destined home since it's their sole writer) calls these
// instead of assigning directly.
export function setGrass(v) {
  GRASS = v;
}
export function setMeadow(v) {
  MEADOW = v;
}
export function setDirt(v) {
  DIRT = v;
}
export function setStubble(v) {
  STUBBLE = v;
}

// The season color wheel, declared here because the initial map paint
// already reads it (through seasonHex): 0 = spring, 1/3 = summer,
// 2/3 = autumn; 1 wraps back onto spring. Continuous — mixHex quantizes
// the blends, so colors still move in tiny ticks.
export let seasonQ = 0;
export let seasonStep = -1; // sky repaint trigger, on a fine grid of seasonQ
// Only this module may reassign seasonStep (ESM imports are read-only
// bindings) — updateSeason() (still in legacy.js) calls this instead.
export function setSeasonStep(v) {
  seasonStep = v;
}
export const FLOWER_COLORS = PROFILE.palette.flowers || ["#ff9ed2", "#ffffff", "#c9a6ff", "#ffb27d"];

// The map's own water tone, and the drainage-ditch and ripple shades derived
// from it
export const WATER_COLOR = PROFILE.palette.water;
export const WATER_RIPPLE = tint(WATER_COLOR, 0.25);
export const DITCH_COLOR = tint(WATER_COLOR, -0.12); // water-filled drainage ditches

// The farmyard's trodden dirt never turns with the seasons (unlike field
// dirt), so it's pinned to the map's base dirt tone rather than the mutable
// DIRT variable
export const YARD_DIRT = PROFILE.palette.dirt[0];
export const YARD_DIRT_DARK = tint(YARD_DIRT, -0.16);

export const mp = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y,
});

// Flat (height-0) projection: used only for the cliffs' straight bottom rim,
// which sits level regardless of how the terrain above it undulates.
export const mp0 = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, 0) + MAP_OFFSET_Y,
});

// Brightness at a world point from the terrain normal against the light
export function groundShade(wx, wy) {
  const d = 4;
  const dzdx = (terrainHeight(wx + d, wy) - terrainHeight(wx - d, wy)) / (2 * d);
  const dzdy = (terrainHeight(wx, wy + d) - terrainHeight(wx, wy - d)) / (2 * d);
  const len = Math.hypot(dzdx, dzdy, 1);
  const dot = (-dzdx * LIGHT.x - dzdy * LIGHT.y + LIGHT.z) / len;
  return clamp(0.3 + dot, 0.4, 1.25);
}

export function isField(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
  const t = tiles[ty][tx];
  return t >= 1 && t <= 3;
}

export function isWater(tx, ty) {
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
export function tileGeometry(tx, ty, same) {
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

export const CORNER_T = 0.45; // how far along the tile edges the rounding cuts in

// Dirt outline of a field tile with the rounded corners curved inward
export function fieldPath(P, rounded) {
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
export function mapEdge(fromX, fromY, toX, toY, project = mp) {
  const pts = [];
  for (let i = 0; i <= MAP_TILES; i++) {
    const t = i / MAP_TILES;
    pts.push(project(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t));
  }
  return pts;
}

// Clip the map context to the ground diamond (caller does save/restore)
export function clipMapDiamond() {
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
export const EDGE_NEIGHBOR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function tileInk(tx, ty) {
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
export function drawCropsOn(tx, ty, kc) {
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
export function drawTile(tx, ty) {
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
    farmYardPath(mapCtx, fc);
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
export function tileRand(tx, ty) {
  let s = (SEED ^ Math.imul(tx + 1, 374761393) ^ Math.imul(ty + 1, 668265263)) | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Round the corners of the tile at (tx, ty) that face a differently-typed
// neighbor (per sameFn, passed straight through to tileGeometry) by cutting
// a crescent back to colorFn(i)'s color for that corner index — the shared
// quadratic-curve crescent trick used to soften every grass/water/field
// boundary instead of leaving a hard tile-grid edge. Returns tileGeometry's
// {P, rounded} since the field-tile caller needs them again afterward to
// clip furrows/crops to the same rounded outline.
export function paintCornerCrescents(tx, ty, sameFn, colorFn) {
  const { P, rounded } = tileGeometry(tx, ty, sameFn);
  for (let i = 0; i < 4; i++) {
    if (!rounded[i]) continue;
    const cur = P[i];
    const prev = P[(i + 3) % 4];
    const next = P[(i + 1) % 4];
    const ax = cur.x + (prev.x - cur.x) * CORNER_T;
    const ay = cur.y + (prev.y - cur.y) * CORNER_T;
    const bx = cur.x + (next.x - cur.x) * CORNER_T;
    const by = cur.y + (next.y - cur.y) * CORNER_T;
    mapCtx.fillStyle = colorFn(i);
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
  return { P, rounded };
}

// The color a rounded corner cuts back to when the neighboring tile is
// grass: shaded per-corner from that corner's own terrain normal, since a
// crescent can span a slope where shading legitimately differs corner to
// corner.
export function grassCornerColor(tx, ty) {
  const cornerTile = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]];
  return (i) => shade(GRASS, groundShade(cornerTile[i][0] * TILE, cornerTile[i][1] * TILE));
}

export function paintTile(tx, ty) {
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
    paintCornerCrescents(tx, ty, (ax, ay) => !isWater(ax, ay), () => shade(WATER_COLOR, 1));
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

    paintCornerCrescents(tx, ty, isWater, grassCornerColor(tx, ty));
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
  const { P, rounded } = paintCornerCrescents(tx, ty, isField, grassCornerColor(tx, ty));

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
export function plowTileAt(wx, wy, alongX) {
  if (tileTypeAt(wx, wy) !== 1) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = 2;
  dirs[ty][tx] = alongX ? 1 : 0;
  drawTile(tx, ty);
}

// Seeder: plant a plowed tile, consuming one seed
export function seedTileAt(wx, wy) {
  if (seeds <= 0 || tileTypeAt(wx, wy) !== 2) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = 3;
  growth[ty][tx] = 0;
  consumeSeed();
  drawTile(tx, ty);
}

// Harvester: cut a mature crop, leaving a grain sack and stubble behind
export function harvestTileAt(wx, wy) {
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
export function updateCrops(dt) {
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
export function countFieldTiles() {
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
export const roads = [];
export const roadSamples = [];
export const roadTiles = new Set();
export const patches = [];
export const forestTiles = new Set(); // tile indexes under forest stands
export const meadowTiles = new Set(); // tile indexes under wildflower meadow patches
export const tileKey = (wx, wy) => ((wy / TILE) | 0) * MAP_TILES + ((wx / TILE) | 0);
export const ROAD_COLOR = PROFILE.palette.road;
export const BRIDGE_COLOR = tint(ROAD_COLOR, -0.2); // road surface where it crosses water
export const ROAD_SPECKLE = tint(ROAD_COLOR, -0.15); // wheel-worn speckles along the middle
// Stamps by tile index: roads and ditches are painted over the tiles, so
// whenever a tile repaints (field work, seasons) they must be restored
export const roadStamps = new Map();

export function addStamp(x, y, r, color) {
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
export const yardPixels = [];

// Blob-edge irregularity: a tile counts as "in the blob" only inside a
// random fraction of the nominal radius (70%-130%), so lakes, forest
// stands and meadow patches all come out ragged rather than as perfect
// circles. Shared by every blob-growth loop in makeMap() below.
export const BLOB_EDGE_MIN = 0.7;
export const BLOB_EDGE_SPREAD = 0.6;

// Grow ragged blobs of tiles into targetSet (forest stands, meadow
// patches) until it holds targetCount tiles or too many attempts fail:
// pick an open-ground center clear of the farm/city, then flood a
// random-radius disc of tiles around it using the blob-edge formula
// above. extraExclude(tx, ty), if given, is checked before the random
// blob-edge roll (same as the built-in `tiles[ty][tx] === 0` check) so it
// never perturbs the rand() call sequence — e.g. meadow patches use it to
// dodge tiles forest already claimed, without forest needing to know
// meadow exists.
export function growPatch(targetSet, targetCount, extraExclude) {
  for (let tries = 0; targetSet.size < targetCount && tries < 600; tries++) {
    const cx = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    const cy = 2 + ((rand() * (MAP_TILES - 4)) | 0);
    if (tiles[cy][cx] !== 0 || (extraExclude && extraExclude(cx, cy))) continue;
    if (Math.hypot((cx + 0.5) * TILE - FARM.x, (cy + 0.5) * TILE - FARM.y) < FARM_PASTURE_RADIUS)
      continue;
    if (Math.hypot((cx + 0.5) * TILE - CITY.x, (cy + 0.5) * TILE - CITY.y) < CITY_RADIUS + 40)
      continue;
    const r = 2.5 + rand() * 4;
    for (let ty = Math.max(0, Math.floor(cy - r)); ty <= Math.min(MAP_TILES - 1, Math.ceil(cy + r)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - r)); tx <= Math.min(MAP_TILES - 1, Math.ceil(cx + r)); tx++)
        if (
          tiles[ty][tx] === 0 &&
          !(extraExclude && extraExclude(tx, ty)) &&
          Math.hypot(tx - cx, ty - cy) < r * (BLOB_EDGE_MIN + rand() * BLOB_EDGE_SPREAD) &&
          Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) > FARM_PASTURE_RADIUS &&
          Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y) > CITY_RADIUS + 40
        )
          targetSet.add(ty * MAP_TILES + tx);
  }
}

export function makeMap() {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    tiles.push(new Array(MAP_TILES).fill(0));
    dirs.push(new Array(MAP_TILES).fill(0));
    growth.push(new Array(MAP_TILES).fill(0));
  }

  // Shared across phases below: genWater fills waterTiles in, genFieldPatches
  // fills fieldTiles in, genDrainageDitches fills ditchSamples in — each read
  // again by a later phase (openLand's tile count, paintMapEdges' culverts).
  let waterTiles = 0;
  let fieldTiles = 0;
  const ditchSamples = [];

  // Water first: seas flood low corners, lakes and ponds sit in hollows,
  // and rivers wander across following the low ground
  function genWater() {
  const lowEnough = (tx, ty, limit = 3.5) =>
    terrainHeight((tx + 0.5) * TILE, (ty + 0.5) * TILE) < limit;
  const awayFromFarm = (tx, ty) =>
    Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y) >
    FARM_RADIUS + 48;
  const awayFromCity = (tx, ty) =>
    Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y) >
    CITY_RADIUS + 48;
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
          if (Math.hypot(tx - bx, ty - by) < r * (BLOB_EDGE_MIN + rand() * BLOB_EDGE_SPREAD) && lowEnough(tx, ty))
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
        if (Math.hypot(tx - cx, ty - cy) < r * (BLOB_EDGE_MIN + rand() * BLOB_EDGE_SPREAD) && lowEnough(tx, ty, limit))
          setWater(tx, ty);
  }
  }
  genWater();

  // Field patches next: the road network is routed to them afterwards.
  // How much of the dry land is farmed comes from this map's profile; the
  // farm clearing and road carving eat a little of it back.
  function genFieldPatches() {
  const targetFieldTiles = (MAP_TILES * MAP_TILES - waterTiles) * rollBand(PROFILE.field);
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
  }
  genFieldPatches();

  // Water-filled drainage ditches along some field edges; roads painted
  // over them later read as culverts. Registered as stamps so tile
  // repaints restore them.
  function genDrainageDitches() {
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
  }
  genDrainageDitches();

  // Road network: main roads from the farm out to the map edges, then a spur
  // from the nearest existing road to each field. Each road is a fractal
  // midpoint-displacement curve from its start to its end: the straight line
  // is bent at its midpoint by a random sideways nudge, then both halves are
  // bent again with a smaller nudge, recursively — the same self-similar
  // construction used for generating natural coastlines and rivers — so
  // roads wander like real ones instead of running dead straight.
  function genRoadNetwork() {
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
  }
  genRoadNetwork();

  // Keep the farmyard and the city clear of fields
  function clearFarmAndCity() {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const df = Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y);
      const dc = Math.hypot((tx + 0.5) * TILE - CITY.x, (ty + 0.5) * TILE - CITY.y);
      if ((df < FARM_PASTURE_RADIUS || dc < CITY_RADIUS + 24) && tiles[ty][tx] !== 4)
        tiles[ty][tx] = 0;
    }
  }
  }
  clearFarmAndCity();

  // Forest stands: how much of the leftover, unfarmed land is forested (as
  // opposed to open free grass) comes from this map's profile — a share of
  // what's left after water and field, so 0 means none of it wooded and 1
  // means all of it. Blobs grow on free grass; only the tiles are marked
  // here (darker floor and minimap color) — the trees themselves are
  // planted after the map exists.
  const openLand = MAP_TILES * MAP_TILES - waterTiles - fieldTiles;
  function genForest() {
  const forestTarget = openLand * rollBand(PROFILE.forest);
  growPatch(forestTiles, forestTarget);
  }
  genForest();

  // Meadow patches: grown the same way as forest stands, but over whatever
  // free grass forest left behind — bright open wildflower ground instead
  // of tree cover. Share is of that remaining free land, from the profile.
  function genMeadow() {
  const meadowTarget = (openLand - forestTiles.size) * rollBand(PROFILE.meadow);
  growPatch(meadowTiles, meadowTarget, (tx, ty) => forestTiles.has(ty * MAP_TILES + tx));
  }
  genMeadow();

  // Back-to-front so nearer hills paint over the ones behind them. paintTile
  // skips the per-tile dithering: the whole canvas gets one pass at the end.
  function paintHills() {
  for (let s = 0; s <= 2 * (MAP_TILES - 1); s++) {
    for (let ty = Math.max(0, s - MAP_TILES + 1); ty <= Math.min(MAP_TILES - 1, s); ty++) {
      paintTile(s - ty, ty);
    }
  }
  }
  paintHills();

  function paintMapEdges() {
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
  farmYardPath(mapCtx, fc);
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
  paintMapEdges();
}

