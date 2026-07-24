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

// Never let a lit box/disc face go darker than 30% of its base color, no
// matter how steep the angle away from the light — used by makeRoundItems'
// disc shading and drawScene's box-face shading (a distinct constant from
// groundShade()'s own 0.4/1.25 terrain-lighting clamp, which models a
// different surface and isn't meant to track this one).
const AMBIENT_FLOOR = 0.3;
