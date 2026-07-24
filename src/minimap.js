
// ---------------------------------------------------------------------------
// Minimap: one 2x1-pixel tile diamond, kept up to date by drawTile
// ---------------------------------------------------------------------------

const minimapCanvas = document.createElement("canvas");
minimapCanvas.width = MAP_TILES * 2;
minimapCanvas.height = MAP_TILES;
const minimapCtx = minimapCanvas.getContext("2d");

// grass, field, plowed, seeded, water; ripe crops turn gold (kept a universal
// wheat tone below, unlike the rest of this array — grain looks the same
// color regardless of biome). Plowed is a clearly darker brown than stubble
// so the two read apart at a glance, both here and in the field ledger's
// legend swatches. Derived from the map's palette rather than hand-picked so
// every theme gets a matching minimap.
const MINIMAP_COLORS = [
  tint(PROFILE.palette.grass[1], -0.22),
  stubbleTint(PROFILE.palette.dirt[0]),
  tint(PROFILE.palette.dirt[0], -0.45),
  tint(PROFILE.palette.grass[1], 0.32),
  WATER_COLOR,
];
const MINIMAP_MEADOW = meadowTint(PROFILE.palette.grass[1]);

// The farm marker's footprint in minimap diamond space (matches the fillRect
// below it's drawn with). minimapTile steers clear of these pixels so
// season and field repaints, which restamp random tiles over time, can
// never paint over the marker.
const FARM_MARKER = {
  x0: Math.round((FARM.x - FARM.y) / TILE) + MAP_TILES - 1,
  y0: Math.round((FARM.x + FARM.y) / (2 * TILE)) - 1,
};
FARM_MARKER.x1 = FARM_MARKER.x0 + 2;
FARM_MARKER.y1 = FARM_MARKER.y0 + 2;

// The city marker, same footprint math as the farm's, so minimapTile can
// steer clear of it the same way
const CITY_MARKER = {
  x0: Math.round((CITY.x - CITY.y) / TILE) + MAP_TILES - 1,
  y0: Math.round((CITY.x + CITY.y) / (2 * TILE)) - 1,
};
CITY_MARKER.x1 = CITY_MARKER.x0 + 2;
CITY_MARKER.y1 = CITY_MARKER.y0 + 2;

// Exact minimap pixels a road passes through, keyed "x,y". Built from
// roadSamples once the road network exists, then consulted by minimapTile
// so a road survives every future repaint of the tile underneath it instead
// of only being stamped once at startup.
const roadPixels = new Set();

function minimapTile(tx, ty) {
  const type = tiles[ty][tx];
  let color = MINIMAP_COLORS[type];
  if (type === 0 && forestTiles.has(ty * MAP_TILES + tx)) color = PROFILE.palette.conifer;
  if (type === 0 && meadowTiles.has(ty * MAP_TILES + tx)) color = MINIMAP_MEADOW;
  if (type === 3 && cropStage(growth[ty][tx]) >= 3) color = "#e3c355";
  const px = tx - ty + MAP_TILES - 1;
  const py = (tx + ty) >> 1;
  for (let dx = 0; dx < 2; dx++) {
    const x = px + dx;
    if (x >= FARM_MARKER.x0 && x <= FARM_MARKER.x1 && py >= FARM_MARKER.y0 && py <= FARM_MARKER.y1)
      continue;
    if (x >= CITY_MARKER.x0 && x <= CITY_MARKER.x1 && py >= CITY_MARKER.y0 && py <= CITY_MARKER.y1)
      continue;
    minimapCtx.fillStyle = shade(roadPixels.has(x + "," + py) ? ROAD_COLOR : color, 1);
    minimapCtx.fillRect(x, py, 1, 1);
  }
}
