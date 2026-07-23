import { PROFILE, rand, rollBand } from "./rng.js";
import { MAP_SIZE } from "./projection.js";

// ---------------------------------------------------------------------------
// Terrain: smooth rolling hills from summed cosine bumps, fading to flat
// near the map edges so the dirt cliffs stay level.
// ---------------------------------------------------------------------------

export const HILLS = [];

// Builds the hill field. This is a one-time, rand()-consuming step whose
// position in the overall world-gen sequence matters for map reproducibility
// (see main.js), so it's an explicit init call rather than module-load-order
// top-level code — merely importing this module must not roll any dice.
export function initTerrain() {
  // This map's hilliness: a multiplier on both how many hills stack up and
  // how tall each one is, rolled from the profile's band.
  const HILLINESS = rollBand(PROFILE.hilliness);
  for (let i = 0; i < Math.round(40 * HILLINESS); i++) {
    HILLS.push({
      cx: MAP_SIZE * rand(),
      cy: MAP_SIZE * rand(),
      r: 60 + rand() * 100,
      h: (10 + rand() * 16) * HILLINESS,
    });
  }
}

// No flattening under the farmyard: the buildings drape over the natural
// terrain like everything else. No flattening at the map edges either —
// hills run right up to (and are sliced by) the boundary; the cliff and
// clip both trace the real per-point height so there's nothing to keep flat.
export function terrainHeight(wx, wy) {
  let h = 0;
  for (const hill of HILLS) {
    const d = Math.hypot(wx - hill.cx, wy - hill.cy);
    if (d < hill.r) h += hill.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / hill.r));
  }
  return 40 * Math.tanh(h / 40); // soft cap where hills stack
}
