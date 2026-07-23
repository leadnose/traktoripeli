import { rotateLocal, projX, projY, TILE, MAP_TILES } from "./projection.js";
import { terrainHeight } from "./terrain.js";
import { inYard } from "./farmyard.js";
import { tileTypeAt, tiles, tileKey, mapCanvas, mapCtx, MAP_OFFSET_X, MAP_OFFSET_Y } from "./ground.js";
// tractor isn't split out yet (Tractor section) - a genuine circular
// import, safe because updateTracks() only reads tractor.x/y/angle/speed
// at runtime, never at this module's own top level.
import { tractor } from "./tractor.js";

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

export function updateTracks(dt) {
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
export function restampTracks(tx, ty) {
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
