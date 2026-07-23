import { rand } from "./rng.js";
import { TILE, MAP_SIZE } from "./projection.js";
import { FARM, FARM_RADIUS, insideAnyPaddock } from "./farmyard.js";
import { CITY, CITY_RADIUS } from "./city.js";
import { tileTypeAt, roadTiles, tileKey, patches } from "./ground.js";
import { trees } from "./trees.js";

// ---------------------------------------------------------------------------
// Bushes: little round shrubs on the meadows
// ---------------------------------------------------------------------------

// Each variant is [spring, summer, autumn]
const BUSH_COLORS = [
  ["#5d9b5e", "#51844d", "#917d4a"],
  ["#6caa6a", "#5f945a", "#9e8d51"],
  ["#558f55", "#477945", "#7f6d41"],
];
export const bushes = [];

// Bushes need roads/patches (ground.js) and trees (for clearance) to
// already exist, and its rand() calls have a fixed position in the
// world-gen sequence - like initTerrain()/initTrees(), an explicit init
// call rather than module-load-order top-level code.
export function initBushes() {
  for (let attempts = 0; bushes.length < 110 && attempts < 6000; attempts++) {
    const wx = 20 + rand() * (MAP_SIZE - 40);
    const wy = 20 + rand() * (MAP_SIZE - 40);
    if (tileTypeAt(wx, wy) !== 0) continue;
    if (roadTiles.has(tileKey(wx, wy))) continue;
    if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 12) continue;
    if (Math.hypot(wx - CITY.x, wy - CITY.y) < CITY_RADIUS + 12) continue;
    if (insideAnyPaddock(wx, wy)) continue;
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
    ["#4e7d4c", "#426a40", "#7a673f"],
    ["#578653", "#4c7849", "#877543"],
    ["#477446", "#3a6139", "#705f3a"],
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
        if (Math.hypot(wx - CITY.x, wy - CITY.y) < CITY_RADIUS + 12) continue;
        if (insideAnyPaddock(wx, wy)) continue;
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
}
