import { rand, SEED } from "./rng.js";
import { MAP_SIZE, TILE, rotateLocal } from "./projection.js";
import { nearPoint } from "./setup.js";

// ---------------------------------------------------------------------------
// Farmyard location (needed by the terrain: the yard sits on a flat pad)
// ---------------------------------------------------------------------------

// The farmyard lands somewhere different on every map, kept well away from
// the edges. The buildings are square-cornered boxes on an isometric grid,
// so they only ever face one of the 4 cardinal ways — anything in between
// reads as buildings sitting crooked, off the grid.
export const FARM = {
  x: MAP_SIZE * (0.2 + rand() * 0.6),
  y: MAP_SIZE * (0.2 + rand() * 0.6),
  angle: (Math.floor(rand() * 4) * Math.PI) / 2,
};
export const FARM_RADIUS = 50; // within this distance farm services are available

export function nearFarm(tx, ty) {
  return nearPoint(tx, ty, FARM.x, FARM.y, FARM_RADIUS);
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
export const PADDOCK_SIZE = {
  cow: { w: 70, h: 32 },
  pig: { w: 36, h: 30 },
};
export const PENNED_SPECIES = new Set(Object.keys(PADDOCK_SIZE));
export let PADDOCKS_LOCAL = null;
export let PADDOCKS_WORLD = null;
// Only this module may reassign PADDOCKS_LOCAL/PADDOCKS_WORLD (ESM imports
// are read-only bindings) — main.js's paddock-finalization code calls
// these instead.
export function setPaddocksLocal(v) {
  PADDOCKS_LOCAL = v;
}
export function setPaddocksWorld(v) {
  PADDOCKS_WORLD = v;
}

// Is world point (wx, wy) within margin of any paddock's rectangle? Used
// below to keep vegetation planted after paddock placement (lone trees,
// bushes, hedgerows) from ending up fenced in with the stock.
export function paddockHit(wx, wy, margin) {
  for (const species of Object.keys(PADDOCKS_WORLD)) {
    const p = PADDOCKS_WORLD[species];
    if (wx > p.x0 - margin && wx < p.x1 + margin && wy > p.y0 - margin && wy < p.y1 + margin)
      return true;
  }
  return false;
}

export function insideAnyPaddock(wx, wy) {
  return paddockHit(wx, wy, 0);
}

// True if a repainted tile needs its paddock ground restored afterward —
// anywhere inside a paddock, plus a tile of slop so the fence-hugging worn
// path along the rim doesn't go missing when the tile just outside the
// rail repaints.
export function nearAnyPaddock(tx, ty) {
  return paddockHit((tx + 0.5) * TILE, (ty + 0.5) * TILE, TILE);
}

// Building footprints a paddock candidate must never cover — the same
// list FARM_SOLID_LOCAL (tractor collision, further down) builds from,
// minus the pig sty, which isn't a fixed obstacle: it gets carved out of
// whichever pig candidate wins, not placed independently of it.
export const FARM_BUILDING_FOOTPRINTS = [
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
export const FARM_PASTURE_RADIUS = 205;

// The fuel tank sits out near the rim of the trampled yard (YARD_RADIUS
// is ~64 units; this is ~90% of that, clear of the barn/yard cluster
// near the center) rather than anywhere within FARM_RADIUS, so refueling
// (which costs cash) only happens when the player deliberately drives
// out to it, instead of automatically every time they're at the farm
// for seed or grain.
export const FUEL_TANK_LOCAL = { x: -8, y: 57 };
export const FUEL_TANK_RADIUS = 16;
// Shape of the tank itself: a long horizontal cylinder up on legs,
// see the FARM_BOXES/FARM_SHAPES entries built from these.
export const FUEL_TANK_LEN = 5.0; // half-length of the cylinder
export const FUEL_TANK_R = 2.2; // cylinder radius
export const FUEL_TANK_STAND_H = 2.4; // leg height under the tank
export function fuelTankPos() {
  return rotateLocal(FARM.x, FARM.y, FARM.angle, FUEL_TANK_LOCAL.x, FUEL_TANK_LOCAL.y);
}
export function nearFuelTank(tx, ty) {
  const p = fuelTankPos();
  return nearPoint(tx, ty, p.x, p.y, FUEL_TANK_RADIUS);
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
export function yardScaleAt(angle) {
  const t = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * YARD_LOBES;
  const i0 = Math.floor(t) % YARD_LOBES;
  const i1 = (i0 + 1) % YARD_LOBES;
  const f = t - Math.floor(t);
  return YARD_SHAPE[i0] * (1 - f) + YARD_SHAPE[i1] * f;
}
export const YARD_MAX_SCALE = Math.max(...YARD_SHAPE);

// A world-space circle matching the yard's screen ellipse (screen ellipse
// radii are the true isometric projection of a world circle: projX has
// amplitude r*sqrt(2), projY has amplitude r/sqrt(2), a 2:1 ratio — exactly
// the ellipse's 1.8/0.9 radii). Used to gate tire tracks on the yard dirt,
// which otherwise only marks the unplowed-field tile type.
export const YARD_RADIUS = (FARM_RADIUS * 1.8) / Math.SQRT2;
export function inYard(wx, wy) {
  return Math.hypot(wx - FARM.x, wy - FARM.y) < YARD_RADIUS;
}

// Traces the yard's smoothed, lobed outline onto mapCtx around screen point
// fc (as returned by mp()); caller fills/strokes/clips as needed. Points sit
// at YARD_SHAPE's radii and the path threads their midpoints with quadratic
// curves, the standard canvas trick for a smooth closed blob through a fixed
// ring of control points.
export function farmYardPath(mapCtx, fc) {
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
