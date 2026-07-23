import { clamp } from "./setup.js";
import { PROFILE, rand } from "./rng.js";
import { TILE, MAP_TILES, MAP_SIZE } from "./projection.js";
import { tint } from "./lighting.js";
import { FARM, FARM_PASTURE_RADIUS, insideAnyPaddock } from "./farmyard.js";
import { CITY, CITY_RADIUS } from "./city.js";
import { tileTypeAt, roadTiles, forestTiles, meadowTiles, tileKey } from "./ground.js";

// ---------------------------------------------------------------------------
// Lollipop trees scattered over the meadows
// ---------------------------------------------------------------------------

const TREE_BOXES = [
  { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9, z0: 0.0, z1: 4.5, color: "#8a5a36" }, // trunk
];

// Cloud-shaped canopy: one big blob with two smaller ones tucked against it.
// Spring colors (this map's palette); updateSeason() recolors them through
// summer into autumn and back again.
export const TREE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 7.2, r: 4.2, color: PROFILE.palette.canopy[0] },
  { blob: true, x: 1.5, y: -1.5, z: 9.6, r: 2.7, color: tint(PROFILE.palette.canopy[0], 0.1), bias: 0.05 },
  { blob: true, x: -1.3, y: 1.3, z: 10.2, r: 2.1, color: tint(PROFILE.palette.canopy[0], 0.22), bias: 0.1 },
];

// Conifers are evergreen: their colors stay put through the seasons, so
// they're set once from this map's palette rather than going through
// updateSeason(). Spruce: a tall narrow cone of tapering tiers.
const CONIFER_BOXES = [
  { x0: -0.7, x1: 0.7, y0: -0.7, y1: 0.7, z0: 0.0, z1: 2.4, color: "#7a4f30" }, // trunk
];
const SPRUCE_BASE = PROFILE.palette.conifer;
const SPRUCE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 3.0, r: 2.6, color: SPRUCE_BASE },
  { blob: true, x: 0, y: 0, z: 5.6, r: 2.0, color: tint(SPRUCE_BASE, 0.05), bias: 0.05 },
  { blob: true, x: 0, y: 0, z: 7.9, r: 1.5, color: tint(SPRUCE_BASE, 0.1), bias: 0.1 },
  { blob: true, x: 0, y: 0, z: 9.9, r: 1.0, color: tint(SPRUCE_BASE, 0.15), bias: 0.15 },
  { blob: true, x: 0, y: 0, z: 11.4, r: 0.55, color: tint(SPRUCE_BASE, 0.2), bias: 0.2 },
];
// Fir: broader and softer, with a blue-green cast
const FIR_BASE = tint(SPRUCE_BASE, 0.12);
const FIR_BLOBS = [
  { blob: true, x: 0, y: 0, z: 3.0, r: 3.2, color: FIR_BASE },
  { blob: true, x: 0, y: 0, z: 5.8, r: 2.5, color: tint(FIR_BASE, 0.05), bias: 0.05 },
  { blob: true, x: 0, y: 0, z: 8.3, r: 1.8, color: tint(FIR_BASE, 0.1), bias: 0.1 },
  { blob: true, x: 0, y: 0, z: 10.3, r: 1.0, color: tint(FIR_BASE, 0.15), bias: 0.15 },
];

export const TREE_KINDS = [
  { boxes: TREE_BOXES, blobs: TREE_BLOBS }, // deciduous, turns with the seasons
  { boxes: CONIFER_BOXES, blobs: SPRUCE_BLOBS },
  { boxes: CONIFER_BOXES, blobs: FIR_BLOBS },
];

export const trees = [];
export const treesByTile = new Map();

// Placing trees needs the road network, forest/meadow tile sets and the
// finalized paddocks to already exist, and its rand() calls have to land in
// their original position in the world-gen sequence - so, like
// terrain.js's initTerrain(), this is an explicit init call rather than
// module-load-order top-level code.
export function initTrees() {
  // A map's broadleaf share sets how English-lowland (hedgerow country,
  // deciduous-heavy) vs. Scottish-highland/plantation (conifer-heavy) its
  // tree cover reads, on top of the fixed spruce:fir split within whatever's
  // left over. Lone trees on open grass always skew a bit more deciduous
  // than dense forest stands do, same relationship the old fixed odds had.
  const DECID_SHARE = clamp(0.25 + PROFILE.broadleaf * 0.6, 0.05, 0.95);
  const DECID_SPRUCE_T = DECID_SHARE + (1 - DECID_SHARE) * 0.538;
  const LONE_DECID_SHARE = Math.min(0.97, DECID_SHARE + 0.25);
  const LONE_SPRUCE_T = LONE_DECID_SHARE + (1 - LONE_DECID_SHARE) * 0.625;

  // Dense stands on the forest tiles; roads passing through keep clearings
  for (const k of forestTiles) {
    const ftx = k % MAP_TILES;
    const fty = (k / MAP_TILES) | 0;
    const n = 2 + ((rand() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const wx = (ftx + 0.05 + rand() * 0.9) * TILE;
      const wy = (fty + 0.05 + rand() * 0.9) * TILE;
      if (roadTiles.has(tileKey(wx, wy))) continue;
      const r = rand();
      trees.push({
        wx,
        wy,
        angle: rand() * Math.PI * 2,
        kind: r < DECID_SHARE ? 0 : r < DECID_SPRUCE_T ? 1 : 2,
      });
    }
  }

  // Lone trees scattered over open grass, kept clear of the wildflower
  // meadows so those patches read as open ground rather than clearings
  const loneTarget = trees.length + 70;
  for (let attempts = 0; trees.length < loneTarget && attempts < 5000; attempts++) {
    const wx = 24 + rand() * (MAP_SIZE - 48);
    const wy = 24 + rand() * (MAP_SIZE - 48);
    if (tileTypeAt(wx, wy) !== 0) continue; // grass only, never on a field
    if (forestTiles.has(tileKey(wx, wy))) continue; // stands are planted above
    if (meadowTiles.has(tileKey(wx, wy))) continue; // meadows stay open
    if (roadTiles.has(tileKey(wx, wy))) continue; // and never on a road
    if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_PASTURE_RADIUS) continue;
    if (Math.hypot(wx - CITY.x, wy - CITY.y) < CITY_RADIUS + 30) continue;
    if (insideAnyPaddock(wx, wy)) continue;
    if (trees.some((t) => Math.hypot(t.wx - wx, t.wy - wy) < 20)) continue;
    const r = rand();
    trees.push({
      wx,
      wy,
      angle: rand() * Math.PI * 2,
      kind: r < LONE_DECID_SHARE ? 0 : r < LONE_SPRUCE_T ? 1 : 2,
    });
  }

  // Trees are solid trunks the tractor collides with. Indexed by tile so a
  // stand-dense map (Deep Woods, Wilderness) doesn't force a scan of every
  // tree on the map each frame — only the tractor's own tile and its ring of
  // neighbors, which always covers TREE_COLLIDE_R since it's under a tile.
  for (const t of trees) {
    const key = tileKey(t.wx, t.wy);
    let list = treesByTile.get(key);
    if (!list) treesByTile.set(key, (list = []));
    list.push(t);
  }
}
