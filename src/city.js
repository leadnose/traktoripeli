import { SEED } from "./rng.js";
import { MAP_SIZE } from "./projection.js";
import { nearPoint } from "./setup.js";
import { FARM } from "./farmyard.js";
import { tractor } from "./tractor.js";

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
export const CITY = { ...pickCityPos(), angle: cityHash(500) * Math.PI * 2 };
export const CITY_RADIUS = 30; // within this distance the depot buys grain

export function nearCity() {
  return nearPoint(tractor.x, tractor.y, CITY.x, CITY.y, CITY_RADIUS);
}
