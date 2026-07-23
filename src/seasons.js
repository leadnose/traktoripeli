import { clamp } from "./setup.js";
import { PROFILE, rand } from "./rng.js";
import { MAP_TILES } from "./projection.js";
import { mixHex, tint, meadowTint, stubbleTint, grassDotShades, dirtDotShades } from "./lighting.js";
import { GRASS_DOTS, MEADOW_DOTS, DIRT_DOTS, STUBBLE_DOTS, drawTile } from "./ground.js";
import { TREE_BLOBS } from "./trees.js";
import { paintSky } from "./sky.js";
// timeLeft/ROUND_TIME aren't split out yet (Tractor section) - a genuine
// circular import, safe because they're only read inside updateSeason(),
// never at this module's own top level.
import { timeLeft, ROUND_TIME } from "./legacy.js";

// ---------------------------------------------------------------------------
// Seasons: the round runs from spring through summer into autumn and back
// into spring again, year-round — nothing ever stops growth. Colors
// interpolate around three keyframes, and the ground takes the new colors
// gradually as a few random tiles repaint every frame.
// ---------------------------------------------------------------------------

// Ground colors are seasonal: these are the spring values (from this map's
// own palette), and updateSeason() rewrites them as the round progresses
export let GRASS = PROFILE.palette.grass[0];
// Meadow is warmer/yellower than plain grass — a wildflower patch — derived
// from the map's own grass tone rather than a separate authored color
export let MEADOW = meadowTint(GRASS);
export let DIRT = PROFILE.palette.dirt[0];
// Stubble — a harvested field before it's plowed — reads as dried pale
// straw rather than bare soil
export let STUBBLE = stubbleTint(DIRT);

// The season color wheel: 0 = spring, 1/3 = summer, 2/3 = autumn; 1 wraps
// back onto spring. Continuous — mixHex quantizes the blends, so colors
// still move in tiny ticks.
export let seasonQ = 0;
let seasonStep = -1; // sky repaint trigger, on a fine grid of seasonQ

// The map's own palette (see MAP_PROFILES) supplies the three season
// keyframes for grass/dirt/sky/canopy; dot speckles, canopy tiers and the
// meadow's warmer take on grass are all derived from those via tint()/
// meadowTint() rather than hand-authored per map, so a new theme only needs
// to specify its handful of base tones.
const GRASS_SEASONS = PROFILE.palette.grass;
// Meadows run warmer/yellower than plain grass and turn properly golden
// (dried hay) in autumn rather than just tanning like the grass does
const MEADOW_SEASONS = GRASS_SEASONS.map(meadowTint);
const DIRT_SEASONS = PROFILE.palette.dirt;
const STUBBLE_SEASONS = DIRT_SEASONS.map(stubbleTint);
const TREE_BLOB_SEASONS = [
  PROFILE.palette.canopy,
  PROFILE.palette.canopy.map((c) => tint(c, 0.1)),
  PROFILE.palette.canopy.map((c) => tint(c, 0.22)),
];
export const SKY_TOP_SEASONS = PROFILE.palette.skyTop;
export const SKY_BOTTOM_SEASONS = PROFILE.palette.skyBottom;

// The round is presented as a calendar running continuously Jan 1st through
// Dec 31st — one long growing season, with the farm workable every day of
// the year.
export const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const SEASON_DAYS = 365; // days in the year, Jan 1 through Dec 31
export const SEASON_BAR_COLORS = ["#6fce58", "#4fae4a", "#d99a33"];

export function seasonHex(colors) {
  const seg = Math.min(2, (seasonQ * 3) | 0);
  return mixHex(colors[seg], colors[(seg + 1) % 3], seasonQ * 3 - seg);
}

export function updateSeason() {
  // The color wheel runs 0→1 spring to summer to autumn and wraps back onto
  // spring green over the whole year. It moves continuously every frame; the
  // blends themselves are quantized by mixHex's cache, so trees, bushes and
  // sky glide instead of ticking.
  seasonQ = clamp(1 - timeLeft / ROUND_TIME, 0, 1);
  GRASS = seasonHex(GRASS_SEASONS);
  MEADOW = seasonHex(MEADOW_SEASONS);
  DIRT = seasonHex(DIRT_SEASONS);
  STUBBLE = seasonHex(STUBBLE_SEASONS);
  // Dot-shade arrays are const, so each season's colors are copied into
  // the existing array in place rather than the binding being reassigned
  for (const [dest, src] of [
    [GRASS_DOTS, grassDotShades(GRASS)],
    [MEADOW_DOTS, grassDotShades(MEADOW)],
    [DIRT_DOTS, dirtDotShades(DIRT)],
    [STUBBLE_DOTS, dirtDotShades(STUBBLE)],
  ])
    for (let i = 0; i < dest.length; i++) dest[i] = src[i];
  for (let i = 0; i < TREE_BLOBS.length; i++)
    TREE_BLOBS[i].color = seasonHex(TREE_BLOB_SEASONS[i]);
  // The sky is a full-canvas dithered repaint, so it only redraws on a
  // step grid — fine enough that each redraw is an invisible nudge
  const step = Math.round(seasonQ * 128);
  if (step !== seasonStep) {
    seasonStep = step;
    paintSky();
  }
  // The ground turns gradually: random tiles repaint each frame with the
  // current colors (wheel marks survive: drawTile restamps them), spread
  // evenly across the whole year.
  const repaints = 8;
  for (let i = 0; i < repaints; i++) {
    drawTile((rand() * MAP_TILES) | 0, (rand() * MAP_TILES) | 0);
  }
}
