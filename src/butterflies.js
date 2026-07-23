import { clamp, VIEW_W, VIEW_H, ctx } from "./setup.js";
import { rand } from "./rng.js";
import { MAP_SIZE, projX, projY } from "./projection.js";
import { terrainHeight } from "./terrain.js";
// worldTime isn't split out yet (Tractor section) - a genuine circular
// import, safe because drawButterflies() only reads it at runtime.
import { worldTime } from "./tractor.js";

// ---------------------------------------------------------------------------
// Butterflies fluttering over the meadows
// ---------------------------------------------------------------------------

const BUTTERFLY_COLORS = ["#ff9ed2", "#ffd94f", "#ffffff", "#b8a6ff"];
export const butterflies = [];

// Placement is order-sensitive (rand()-consuming), so - like
// initTerrain()/initTrees() - this is an explicit init call rather than
// module-load-order top-level code.
export function initButterflies() {
  for (let i = 0; i < 40; i++) {
    butterflies.push({
      wx: rand() * MAP_SIZE,
      wy: rand() * MAP_SIZE,
      a: rand() * Math.PI * 2,
      phase: rand() * 10,
      color: BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length],
    });
  }
}

export function updateButterflies(dt) {
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

export function drawButterflies(camX, camY) {
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
