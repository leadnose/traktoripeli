import { INK, shade } from "./lighting.js";
import { FARM } from "./farmyard.js";
import { tileTypeAt, roads } from "./ground.js";
import { nearestShoreSpot } from "./animals.js";
// sceneCtx isn't split out yet (Scene rendering section) - a genuine
// circular import, safe because drawSign() only reads it when called at
// runtime, never at this module's own top level.
import { sceneCtx } from "./legacy.js";

// ---------------------------------------------------------------------------
// Signposts: little roadside boards naming the landmarks
// ---------------------------------------------------------------------------

// Tiny 5-row lettering, one string per row, stamped as ink pixels
const SIGN_FONT = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
};

export const signs = [];

export function addSign(text, wx, wy) {
  let w = -1;
  for (const ch of text) w += SIGN_FONT[ch][0].length + 1;
  signs.push({ text, wx, wy, w });
}

// A post with a cream board, drawn straight to the screen as a billboard.
// It renders into the scene canvas, so the ink pass outlines it like
// everything else and the board needs no frame of its own.
export function drawSign(s, x, y) {
  const bw = s.w + 4;
  const bh = 9;
  const bx = x - (bw >> 1);
  const by = y - 6 - bh;
  sceneCtx.fillStyle = shade("#8a5a36", 1);
  sceneCtx.fillRect(x - 1, y - 8, 2, 8);
  sceneCtx.fillStyle = shade("#f2e6cc", 1);
  sceneCtx.fillRect(bx, by, bw, bh);
  sceneCtx.fillStyle = INK;
  let cx = bx + 2;
  for (const ch of s.text) {
    const g = SIGN_FONT[ch];
    for (let r = 0; r < 5; r++)
      for (let cc = 0; cc < g[r].length; cc++)
        if (g[r][cc] === "#") sceneCtx.fillRect(cx + cc, by + 2 + r, 1, 1);
    cx += g[0].length + 1;
  }
}

// Beside a road point, on whichever side is open grass
export function placeSignBeside(text, p) {
  for (const side of [1, -1]) {
    const sx = p.x + Math.cos(p.dir + (Math.PI / 2) * side) * 7;
    const sy = p.y + Math.sin(p.dir + (Math.PI / 2) * side) * 7;
    if (tileTypeAt(sx, sy) === 0) {
      addSign(text, sx, sy);
      return true;
    }
  }
  return false;
}

// Placement needs the road network (ground.js) and the shore spots
// (animals.js's initAnimals()) to already exist. Consumes zero rand()
// calls, so unlike initTerrain()/initTrees() its position in the
// world-gen sequence only needs to come after those, not at any
// RNG-precise slot.
export function initSignposts() {
  // FARM where the farm's own road leaves the yard
  if (roads.length && roads[0].pts.length > 6) placeSignBeside("FARM", roads[0].pts[5]);
  else addSign("FARM", FARM.x + 24, FARM.y + 24);

  // A BRIDGE sign on the approach, for up to two crossings
  {
    let posted = 0;
    for (const r of roads) {
      if (posted >= 2) break;
      if (r.entry) continue;
      for (let i = 4; i < r.pts.length; i++) {
        if (tileTypeAt(r.pts[i].x, r.pts[i].y) !== 4) continue;
        if (tileTypeAt(r.pts[i - 2].x, r.pts[i - 2].y) === 4) continue; // mid-crossing
        if (placeSignBeside("BRIDGE", r.pts[i - 4])) posted++;
        break; // one sign per road
      }
    }
  }

  // POND at the waterside nearest the farm — where the herds go to drink
  {
    const near = nearestShoreSpot(FARM.x, FARM.y);
    if (near && near.dist < 260) {
      const { spot, dist } = near;
      // A step inland, so it stands clear of the bank where the herds crowd
      const nx = spot.x + ((FARM.x - spot.x) / dist) * 8;
      const ny = spot.y + ((FARM.y - spot.y) / dist) * 8;
      if (tileTypeAt(nx, ny) === 0) addSign("POND", nx, ny);
      else addSign("POND", spot.x, spot.y);
    }
  }
}
