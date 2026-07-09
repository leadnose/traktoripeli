"use strict";

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

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = {};
const IMPLEMENT_KEYS = { 1: "plow", 2: "seeder", 3: "harvester", 4: "trailer" };

window.addEventListener("keydown", (e) => {
  if (e.key.startsWith("Arrow")) e.preventDefault();
  keys[e.key] = true;
  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    const imp = IMPLEMENTS[tractor.implement];
    // Raising is always allowed; lowering needs the work gear and field dirt
    if (!imp.liftable) {
      tractor.implFlash = 0.9; // the trailer has no lift
    } else if (tractor.implDown) {
      tractor.implDown = false;
    } else if (tractor.fastGear) {
      tractor.gearFlash = 0.9; // refused: too fast — flash the HUD, no movement
    } else if (!implementOverField()) {
      tractor.implBounce = 0.6; // it tries, catches, and springs back up
    } else {
      tractor.implDown = true;
      tractor.implBounce = 0;
    }
  }
  if (e.key === "Shift" && !e.repeat) {
    tractor.fastGear = !tractor.fastGear;
    if (tractor.fastGear) tractor.implDown = false; // lift before shifting up
  }
  if (IMPLEMENT_KEYS[e.key] && !e.repeat) {
    // Implements are swapped at the farmyard
    if (nearFarm()) {
      if (tractor.implement !== IMPLEMENT_KEYS[e.key]) {
        tractor.implement = IMPLEMENT_KEYS[e.key];
        tractor.implDown = false;
        tractor.implLift = 1;
      }
    } else {
      tractor.implFlash = 0.9;
    }
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

// ---------------------------------------------------------------------------
// Isometric projection (2:1, SimCity 2000 style)
// ---------------------------------------------------------------------------

// World: x/y on the ground plane, z up. One tile is TILE x TILE world units
// and projects to a 2*TILE wide, TILE tall diamond on screen.
const TILE = 16;
const MAP_TILES = 24;
const MAP_SIZE = MAP_TILES * TILE;

function projX(wx, wy) {
  return wx - wy;
}

function projY(wx, wy, wz) {
  return (wx + wy) / 2 - (wz || 0);
}

// ---------------------------------------------------------------------------
// Farmyard location (needed by the terrain: the yard sits on a flat pad)
// ---------------------------------------------------------------------------

const FARM = { x: MAP_SIZE / 2, y: MAP_SIZE - 72 };
const FARM_RADIUS = 40; // within this distance farm services are available

function nearFarm() {
  return Math.hypot(tractor.x - FARM.x, tractor.y - FARM.y) < FARM_RADIUS;
}

// ---------------------------------------------------------------------------
// Terrain: smooth rolling hills from summed cosine bumps, fading to flat
// near the map edges so the dirt cliffs stay level.
// ---------------------------------------------------------------------------

const HILLS = [];
for (let i = 0; i < 7; i++) {
  HILLS.push({
    cx: MAP_SIZE * (0.1 + Math.random() * 0.8),
    cy: MAP_SIZE * (0.1 + Math.random() * 0.8),
    r: 60 + Math.random() * 60,
    h: 10 + Math.random() * 16,
  });
}

function terrainHeight(wx, wy) {
  let h = 0;
  for (const hill of HILLS) {
    const d = Math.hypot(wx - hill.cx, wy - hill.cy);
    if (d < hill.r) h += hill.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / hill.r));
  }
  h = 40 * Math.tanh(h / 40); // soft cap where hills stack
  const m = Math.min(wx, wy, MAP_SIZE - wx, MAP_SIZE - wy);
  const t = Math.max(0, Math.min(1, m / 40));
  // Flat pad under the farmyard so the buildings sit level
  const df = Math.hypot(wx - FARM.x, wy - FARM.y);
  const tf = Math.max(0, Math.min(1, (df - FARM_RADIUS - 8) / 30));
  return h * t * t * (3 - 2 * t) * tf * tf * (3 - 2 * tf);
}

// ---------------------------------------------------------------------------
// Shared lighting helpers
// ---------------------------------------------------------------------------

const LIGHT = { x: 0.35, y: 0.6, z: 0.71 };

const shadeCache = {};
function shade(color, k) {
  const key = color + "|" + k.toFixed(2);
  if (shadeCache[key]) return shadeCache[key];
  const r = Math.min(255, Math.round(parseInt(color.slice(1, 3), 16) * k));
  const g = Math.min(255, Math.round(parseInt(color.slice(3, 5), 16) * k));
  const b = Math.min(255, Math.round(parseInt(color.slice(5, 7), 16) * k));
  return (shadeCache[key] = `rgb(${r},${g},${b})`);
}

// ---------------------------------------------------------------------------
// Ground map (prerendered once)
// ---------------------------------------------------------------------------

const EDGE_DEPTH = 10; // thickness of the dirt "cliff" at the map's near edges
const MAP_OFFSET_X = MAP_SIZE; // shift so projX is never negative
const MAP_OFFSET_Y = 64; // headroom for hilltops that project above y = 0

const mapCanvas = document.createElement("canvas");
mapCanvas.width = MAP_SIZE * 2;
mapCanvas.height = MAP_SIZE + EDGE_DEPTH + MAP_OFFSET_Y;

const mapCtx = mapCanvas.getContext("2d");

// Tile types: 0 = grass, 1 = field (unplowed / stubble), 2 = plowed, 3 = seeded.
// dirs holds the furrow direction (0 = along world y, 1 = along world x) and
// growth the seconds since seeding, which drives the crop stages.
const tiles = [];
const dirs = [];
const growth = [];
const CROP_STAGES = [8, 18, 32]; // seconds to reach sprout / young / mature

function cropStage(g) {
  let s = 0;
  for (const t of CROP_STAGES) if (g >= t) s++;
  return s;
}

function tileTypeAt(wx, wy) {
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return -1;
  return tiles[ty][tx];
}

const GRASS = "#65bd4c";
const GRASS_DOTS = ["#55ab3e", "#7dd463", "#8adf70", "#48993a"];
const DIRT = "#a87e50";
const DIRT_DOTS = ["#8f6940", "#bb9264"];
const FLOWER_COLORS = ["#ff9ed2", "#ffffff", "#c9a6ff", "#ffb27d"];

const mp = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y,
});

// Brightness at a world point from the terrain normal against the light
function groundShade(wx, wy) {
  const d = 4;
  const dzdx = (terrainHeight(wx + d, wy) - terrainHeight(wx - d, wy)) / (2 * d);
  const dzdy = (terrainHeight(wx, wy + d) - terrainHeight(wx, wy - d)) / (2 * d);
  const len = Math.hypot(dzdx, dzdy, 1);
  const dot = (-dzdx * LIGHT.x - dzdy * LIGHT.y + LIGHT.z) / len;
  return Math.max(0.4, Math.min(1.25, 0.3 + dot));
}

function isField(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
  return tiles[ty][tx] >= 1;
}

// Dirt outline of a field tile: where the tile is an outer corner of the
// patch, the corner curves inward so the fields get soft rounded edges.
function fieldPath(tx, ty) {
  const P = [
    mp(tx * TILE, ty * TILE),
    mp((tx + 1) * TILE, ty * TILE),
    mp((tx + 1) * TILE, (ty + 1) * TILE),
    mp(tx * TILE, (ty + 1) * TILE),
  ];
  const grass = (ax, ay) => !isField(ax, ay);
  // A corner is rounded when everything around it (sides and diagonal) is grass
  const rounded = [
    grass(tx, ty - 1) && grass(tx - 1, ty) && grass(tx - 1, ty - 1),
    grass(tx, ty - 1) && grass(tx + 1, ty) && grass(tx + 1, ty - 1),
    grass(tx + 1, ty) && grass(tx, ty + 1) && grass(tx + 1, ty + 1),
    grass(tx - 1, ty) && grass(tx, ty + 1) && grass(tx - 1, ty + 1),
  ];
  const t = 0.45;
  const path = new Path2D();
  let started = false;
  for (let i = 0; i < 4; i++) {
    const cur = P[i];
    const prev = P[(i + 3) % 4];
    const next = P[(i + 1) % 4];
    if (rounded[i]) {
      const ax = cur.x + (prev.x - cur.x) * t;
      const ay = cur.y + (prev.y - cur.y) * t;
      const bx = cur.x + (next.x - cur.x) * t;
      const by = cur.y + (next.y - cur.y) * t;
      if (started) path.lineTo(ax, ay);
      else path.moveTo(ax, ay);
      path.quadraticCurveTo(cur.x, cur.y, bx, by);
    } else if (started) {
      path.lineTo(cur.x, cur.y);
    } else {
      path.moveTo(cur.x, cur.y);
    }
    started = true;
  }
  path.closePath();
  return path;
}

function drawTile(tx, ty) {
  const type = tiles[ty][tx];
  const kc = groundShade((tx + 0.5) * TILE, (ty + 0.5) * TILE);

  // Ground in sub-quads, each shaded from its own terrain normal, so slope
  // shading varies inside a tile instead of stepping at tile borders. Each
  // quad overdraws its outline in its own color: antialiasing otherwise
  // leaves hairline seams that read as a grid over the terrain.
  const SUB = 3;
  const subQuads = (color) => {
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        const x0 = (tx + sx / SUB) * TILE;
        const y0 = (ty + sy / SUB) * TILE;
        const x1 = (tx + (sx + 1) / SUB) * TILE;
        const y1 = (ty + (sy + 1) / SUB) * TILE;
        const a = mp(x0, y0);
        const b = mp(x1, y0);
        const c = mp(x1, y1);
        const d = mp(x0, y1);
        mapCtx.fillStyle = shade(color, groundShade((x0 + x1) / 2, (y0 + y1) / 2));
        mapCtx.beginPath();
        mapCtx.moveTo(a.x, a.y);
        mapCtx.lineTo(b.x, b.y);
        mapCtx.lineTo(c.x, c.y);
        mapCtx.lineTo(d.x, d.y);
        mapCtx.closePath();
        mapCtx.fill();
        mapCtx.strokeStyle = mapCtx.fillStyle;
        mapCtx.lineWidth = 1;
        mapCtx.stroke();
      }
    }
  };

  // Grass everywhere; field dirt is layered on top with rounded corners
  subQuads(GRASS);

  if (type === 0) {
    // Speckles: grass tufts
    for (let i = 0; i < 8; i++) {
      const p = mp((tx + Math.random()) * TILE, (ty + Math.random()) * TILE);
      mapCtx.fillStyle = shade(GRASS_DOTS[(Math.random() * GRASS_DOTS.length) | 0], kc);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    // Little meadow flowers: four petals around a yellow heart
    if (Math.random() < 0.5) {
      const p = mp(
        (tx + 0.2 + Math.random() * 0.6) * TILE,
        (ty + 0.2 + Math.random() * 0.6) * TILE
      );
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      mapCtx.fillStyle = shade(FLOWER_COLORS[(Math.random() * FLOWER_COLORS.length) | 0], kc);
      mapCtx.fillRect(x - 1, y, 1, 1);
      mapCtx.fillRect(x + 1, y, 1, 1);
      mapCtx.fillRect(x, y - 1, 1, 1);
      mapCtx.fillRect(x, y + 1, 1, 1);
      mapCtx.fillStyle = shade("#ffd94f", kc);
      mapCtx.fillRect(x, y, 1, 1);
    }
    return;
  }

  // Field dirt and everything drawn on it stay inside the rounded outline
  const path = fieldPath(tx, ty);
  mapCtx.save();
  mapCtx.clip(path);
  subQuads(DIRT);

  if (type >= 2) {
    // Furrow lines parallel to the direction the tile was plowed in
    const alongX = dirs[ty][tx] === 1;
    mapCtx.strokeStyle = shade("#8a6540", kc);
    mapCtx.lineWidth = 1;
    for (const s of [0.25, 0.5, 0.75]) {
      const a = alongX
        ? mp(tx * TILE, (ty + s) * TILE)
        : mp((tx + s) * TILE, ty * TILE);
      const b = alongX
        ? mp((tx + 1) * TILE, (ty + s) * TILE)
        : mp((tx + s) * TILE, (ty + 1) * TILE);
      mapCtx.beginPath();
      mapCtx.moveTo(a.x, a.y);
      mapCtx.lineTo(b.x, b.y);
      mapCtx.stroke();
    }

    // Seeds / crops in rows along the furrows
    if (type === 3) {
      const stage = cropStage(growth[ty][tx]);
      for (const s of [0.25, 0.5, 0.75]) {
        for (const t of [0.15, 0.38, 0.62, 0.85]) {
          const p = alongX
            ? mp((tx + t) * TILE, (ty + s) * TILE)
            : mp((tx + s) * TILE, (ty + t) * TILE);
          const x = Math.round(p.x);
          const y = Math.round(p.y);
          if (stage === 0) {
            mapCtx.fillStyle = shade("#6b5228", kc); // seed spot
            mapCtx.fillRect(x, y, 1, 1);
          } else if (stage === 1) {
            mapCtx.fillStyle = shade("#8ee06a", kc); // sprout
            mapCtx.fillRect(x, y - 2, 1, 2);
          } else if (stage === 2) {
            mapCtx.fillStyle = shade("#5cbf47", kc); // young plant
            mapCtx.fillRect(x, y - 3, 1, 3);
          } else {
            mapCtx.fillStyle = shade("#c2a044", kc); // mature stalk
            mapCtx.fillRect(x, y - 3, 1, 3);
            mapCtx.fillStyle = shade("#f5d96b", kc); // grain head
            mapCtx.fillRect(x, y - 5, 1, 2);
          }
        }
      }
    }
  } else {
    // Speckles: dirt clods
    for (let i = 0; i < 8; i++) {
      const p = mp((tx + Math.random()) * TILE, (ty + Math.random()) * TILE);
      mapCtx.fillStyle = shade(DIRT_DOTS[(Math.random() * DIRT_DOTS.length) | 0], kc);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
  }
  mapCtx.restore();

  // Trace the outline in dirt: smooths the rounded edge and covers the
  // antialiasing seams against neighboring field tiles
  mapCtx.strokeStyle = shade(DIRT, kc);
  mapCtx.lineWidth = 1;
  mapCtx.stroke(path);
}

// --- Field work, one function per implement ---------------------------------

// Plow: turn unplowed field into furrows along the travel direction
function plowTileAt(wx, wy, alongX) {
  if (tileTypeAt(wx, wy) !== 1) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = 2;
  dirs[ty][tx] = alongX ? 1 : 0;
  drawTile(tx, ty);
}

// Seeder: plant a plowed tile, consuming one seed
function seedTileAt(wx, wy) {
  if (seeds <= 0 || tileTypeAt(wx, wy) !== 2) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = 3;
  growth[ty][tx] = 0;
  seeds--;
  drawTile(tx, ty);
}

// Harvester: cut a mature crop, leaving a grain sack and stubble behind
function harvestTileAt(wx, wy) {
  if (tileTypeAt(wx, wy) !== 3) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  if (cropStage(growth[ty][tx]) < 3) return;
  tiles[ty][tx] = 1;
  growth[ty][tx] = 0;
  drawTile(tx, ty);
  const cx = (tx + 0.5) * TILE;
  const cy = (ty + 0.5) * TILE;
  sacks.push({ wx: cx, wy: cy });
  spawnChaff(cx, cy);
}

// Advance crop growth on seeded tiles, repainting when a stage is reached
function updateCrops(dt) {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      if (tiles[ty][tx] !== 3) continue;
      const g = growth[ty][tx];
      growth[ty][tx] = g + dt;
      if (cropStage(g + dt) !== cropStage(g)) drawTile(tx, ty);
    }
  }
}

function makeMap() {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    tiles.push(new Array(MAP_TILES).fill(0));
    dirs.push(new Array(MAP_TILES).fill(0));
    growth.push(new Array(MAP_TILES).fill(0));
  }
  for (let i = 0; i < 6; i++) {
    const px = 1 + ((Math.random() * (MAP_TILES - 6)) | 0);
    const py = 1 + ((Math.random() * (MAP_TILES - 6)) | 0);
    const pw = 2 + ((Math.random() * 3) | 0);
    const ph = 2 + ((Math.random() * 3) | 0);
    for (let ty = py; ty < py + ph; ty++)
      for (let tx = px; tx < px + pw; tx++) tiles[ty][tx] = 1;
  }

  // Keep the farmyard clear of fields
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const d = Math.hypot((tx + 0.5) * TILE - FARM.x, (ty + 0.5) * TILE - FARM.y);
      if (d < FARM_RADIUS + 24) tiles[ty][tx] = 0;
    }
  }

  // Back-to-front so nearer hills paint over the ones behind them
  for (let s = 0; s <= 2 * (MAP_TILES - 1); s++) {
    for (let ty = Math.max(0, s - MAP_TILES + 1); ty <= Math.min(MAP_TILES - 1, s); ty++) {
      drawTile(s - ty, ty);
    }
  }

  // Trodden dirt yard around the farm buildings
  const fc = mp(FARM.x, FARM.y);
  mapCtx.fillStyle = "#a87e50";
  mapCtx.beginPath();
  mapCtx.ellipse(fc.x, fc.y, FARM_RADIUS * 1.8, FARM_RADIUS * 0.9, 0, 0, Math.PI * 2);
  mapCtx.fill();
  mapCtx.fillStyle = "#8f6940";
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    mapCtx.fillRect(
      Math.round(fc.x + Math.cos(a) * r * FARM_RADIUS * 1.7),
      Math.round(fc.y + Math.sin(a) * r * FARM_RADIUS * 0.85),
      1,
      1
    );
  }

  // Dirt cliffs along the two near (bottom) edges of the map diamond
  const east = mp(MAP_SIZE, 0);
  const south = mp(MAP_SIZE, MAP_SIZE);
  const west = mp(0, MAP_SIZE);
  for (const [a, b, color] of [
    [east, south, "#8a6540"],
    [south, west, "#6f4d2c"],
  ]) {
    mapCtx.fillStyle = color;
    mapCtx.beginPath();
    mapCtx.moveTo(a.x, a.y);
    mapCtx.lineTo(b.x, b.y);
    mapCtx.lineTo(b.x, b.y + EDGE_DEPTH);
    mapCtx.lineTo(a.x, a.y + EDGE_DEPTH);
    mapCtx.closePath();
    mapCtx.fill();
  }
}

makeMap();

// ---------------------------------------------------------------------------
// Lollipop trees scattered over the meadows
// ---------------------------------------------------------------------------

const TREE_BOXES = [
  { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9, z0: 0.0, z1: 4.5, color: "#8a5a36" }, // trunk
];

// Cloud-shaped canopy: one big blob with two smaller ones tucked against it
const TREE_BLOBS = [
  { blob: true, x: 0, y: 0, z: 7.2, r: 4.2, color: "#4fae4a" },
  { blob: true, x: 1.5, y: -1.5, z: 9.6, r: 2.7, color: "#5fc257", bias: 0.05 },
  { blob: true, x: -1.3, y: 1.3, z: 10.2, r: 2.1, color: "#72d367", bias: 0.1 },
];

const trees = [];
for (let attempts = 0; trees.length < 12 && attempts < 400; attempts++) {
  const wx = 24 + Math.random() * (MAP_SIZE - 48);
  const wy = 24 + Math.random() * (MAP_SIZE - 48);
  if (tileTypeAt(wx, wy) !== 0) continue; // grass only, never on a field
  if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 30) continue;
  if (trees.some((t) => Math.hypot(t.wx - wx, t.wy - wy) < 30)) continue;
  trees.push({ wx, wy, angle: Math.random() * Math.PI * 2 });
}

// ---------------------------------------------------------------------------
// Box models: everything solid is axis-aligned boxes in local space
// (+x = forward, z = up), rotated around z and projected each frame.
// ---------------------------------------------------------------------------

const TIRE = "#33363d";
const HUB = "#f7e8b8";

const BOXES = [
  { x0: -7.0, x1: 3.0, y0: -3.0, y1: 3.0, z0: 2.5, z1: 6.0, color: "#f25c3f" }, // chassis
  { x0: 3.0, x1: 7.0, y0: -2.2, y1: 2.2, z0: 2.5, z1: 5.5, color: "#f25c3f" }, // hood
  { x0: -6.5, x1: -1.0, y0: -2.6, y1: 2.6, z0: 6.0, z1: 10.0, color: "#bfeaf5" }, // cab glass
  { x0: -7.0, x1: -0.5, y0: -3.0, y1: 3.0, z0: 10.0, z1: 11.0, color: "#d94a2e" }, // roof
  { x0: 1.5, x1: 2.5, y0: -0.5, y1: 0.5, z0: 5.5, z1: 9.5, color: "#7a7a7a" }, // exhaust
];

// Wheels are round: a disc on each face plus a slim inset box for the tread.
// x/z is the axle center, r the tire radius, y0..y1 the width.
const TRACTOR_WHEELS = [
  { x: -4.5, y0: 3.0, y1: 5.0, z: 2.5, r: 2.5 }, // rear L
  { x: -4.5, y0: -5.0, y1: -3.0, z: 2.5, r: 2.5 }, // rear R
  { x: 5.0, y0: 2.3, y1: 3.9, z: 1.6, r: 1.6 }, // front L
  { x: 5.0, y0: -3.9, y1: -2.3, z: 1.6, r: 1.6 }, // front R
];

// Round beacon light on the cab roof
const TRACTOR_SHAPES = [{ blob: true, x: -4.9, y: 0, z: 11.6, r: 0.8, color: "#ffb433" }];

// Implements hang behind the tractor; liftable ones get a z offset from the
// hydraulic lift so they can be raised for transport and dropped to work.
const IMPLEMENT_LIFT_HEIGHT = 3.5;

const PLOW_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.2, x1: -8.8, y0: -4.6, y1: 4.6, z0: 3.4, z1: 4.6, color: "#d94a2e" }, // beam
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  PLOW_BOXES.push({
    x0: -10.6, x1: -9.4, y0: yc - 0.55, y1: yc + 0.55, z0: 0.3, z1: 3.4,
    color: "#54565a", // tine
  });
}

const SEEDER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.4, x1: -8.6, y0: -4.6, y1: 4.6, z0: 3.2, z1: 4.4, color: "#f0b322" }, // frame
  { x0: -10.2, x1: -8.8, y0: -3.9, y1: -1.7, z0: 4.4, z1: 6.4, color: "#ffd04a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: -1.1, y1: 1.1, z0: 4.4, z1: 6.4, color: "#ffd04a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: 1.7, y1: 3.9, z0: 4.4, z1: 6.4, color: "#ffd04a" }, // hopper
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  SEEDER_BOXES.push({
    x0: -10.0, x1: -9.2, y0: yc - 0.35, y1: yc + 0.35, z0: 0.6, z1: 3.2,
    color: "#54565a", // coulter disc
  });
}

const HARVESTER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -13.0, x1: -8.6, y0: -4.8, y1: 4.8, z0: 2.2, z1: 8.0, color: "#4cae4f" }, // body
  { x0: -12.4, x1: -11.2, y0: -4.2, y1: 4.2, z0: 8.0, z1: 9.4, color: "#3c8c40" }, // grain tank
  { x0: -8.6, x1: -7.4, y0: -4.8, y1: 4.8, z0: 0.4, z1: 2.6, color: "#d94a2e" }, // header reel
];

const HARVESTER_WHEELS = [
  { x: -11.0, y0: 4.8, y1: 6.0, z: 1.8, r: 1.8 }, // wheel L
  { x: -11.0, y0: -6.0, y1: -4.8, z: 1.8, r: 1.8 }, // wheel R
];

const TRAILER_BOXES = [
  { x0: -11.5, x1: -7.0, y0: -0.7, y1: 0.7, z0: 2.6, z1: 3.6, color: "#6b6b6b" }, // long drawbar
  { x0: -21.0, x1: -11.5, y0: -4.2, y1: 4.2, z0: 3.0, z1: 7.0, color: "#9a7442" }, // wooden bed
];
// Tandem axles: two pairs of wheels under the rear half of the bed
const TRAILER_WHEELS = [];
for (const wx of [-15.2, -18.6]) {
  TRAILER_WHEELS.push(
    { x: wx, y0: 4.2, y1: 5.4, z: 1.7, r: 1.7 }, // wheel L
    { x: wx, y0: -5.4, y1: -4.2, z: 1.7, r: 1.7 } // wheel R
  );
}

function trailerBoxes() {
  if (cargo === 0) return TRAILER_BOXES;
  // Grain heap grows with the load
  const h = 0.8 + 2.4 * (cargo / TRAILER_CAP);
  return TRAILER_BOXES.concat([
    { x0: -20.5, x1: -12.0, y0: -3.6, y1: 3.6, z0: 7.0, z1: 7.0 + h, color: "#f0cf5e" },
  ]);
}

// Mounted implements (3-point hitch) turn rigidly with the tractor; towed
// ones ride on their own wheels and pivot at the drawbar pin.
const IMPLEMENTS = {
  plow: { label: "PLOW", liftable: true, boxes: () => PLOW_BOXES, wheels: [] },
  seeder: { label: "SEEDER", liftable: true, boxes: () => SEEDER_BOXES, wheels: [] },
  harvester: { label: "HARVESTER", liftable: true, towed: true, towLength: 4.5, boxes: () => HARVESTER_BOXES, wheels: HARVESTER_WHEELS },
  trailer: { label: "TRAILER", liftable: false, towed: true, towLength: 9.9, boxes: trailerBoxes, wheels: TRAILER_WHEELS },
};

// Farm buildings, local to FARM
const FARM_BOXES = [
  { x0: -16.0, x1: 2.0, y0: -12.0, y1: 2.0, z0: 0.0, z1: 9.0, color: "#d15845" }, // barn
  { x0: -17.5, x1: 3.5, y0: -13.5, y1: 3.5, z0: 9.0, z1: 12.0, color: "#7a4a32" }, // barn roof
  { x0: -7.5, x1: -3.5, y0: 1.9, y1: 2.3, z0: 0.0, z1: 6.0, color: "#f7e8d8" }, // barn door
  { x0: 8.0, x1: 17.0, y0: -9.0, y1: 0.0, z0: 0.0, z1: 20.0, color: "#c6ced6" }, // silo
];

// Round red dome on the silo
const FARM_SHAPES = [{ blob: true, x: 12.5, y: -4.5, z: 20.0, r: 4.0, color: "#d94a2e" }];

// Grain sacks dropped by the harvester: plump blobs with a tied-off top
const SACK_SHAPES = [
  { blob: true, x: 0, y: 0, z: 1.5, r: 1.6, color: "#f0cf5e" },
  { blob: true, x: 0, y: 0, z: 3.1, r: 0.7, color: "#d9b446", bias: 0.05 },
];

// Faces of a unit box; corner index = xi*4 + yi*2 + zi. Windings are chosen
// so a face's projected signed area is positive exactly when it faces the
// camera, which doubles as backface culling.
const FACES = [
  { n: [0, 0, 1], i: [1, 5, 7, 3] }, // top
  { n: [1, 0, 0], i: [4, 6, 7, 5] },
  { n: [-1, 0, 0], i: [2, 0, 1, 3] },
  { n: [0, 1, 0], i: [6, 2, 3, 7] },
  { n: [0, -1, 0], i: [0, 4, 5, 1] },
];

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Scene rendering: all box sets (tractor, implement, farm, sacks) go into one
// list and are painter-sorted together so occlusion works between them.
// ---------------------------------------------------------------------------

// Each point rides at terrain height under its own footprint, which drapes
// models over slopes so they visibly pitch and roll on hills.
function makeItems(items, boxes, ox, oy, angle, liftZ, camX, camY) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = (lx, ly, lz) => {
    const wx = ox + lx * cos - ly * sin;
    const wy = oy + lx * sin + ly * cos;
    const wz = lz + terrainHeight(wx, wy);
    return {
      x: Math.round(projX(wx, wy) - camX),
      y: Math.round(projY(wx, wy, wz) - camY),
      depth: wx + wy + wz,
    };
  };
  for (const box of boxes) {
    const pts = [];
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++)
          pts.push(
            local(
              xi ? box.x1 : box.x0,
              yi ? box.y1 : box.y0,
              (zi ? box.z1 : box.z0) + liftZ
            )
          );
    const center = local(
      (box.x0 + box.x1) / 2,
      (box.y0 + box.y1) / 2,
      (box.z0 + box.z1) / 2 + liftZ
    );
    items.push({ box, pts, depth: center.depth, cos, sin });
  }
}

// Round shapes: discs are circles in the local x-z plane (wheel faces),
// blobs are soft spheres drawn as shaded ellipses (canopies, sacks, domes).
function makeRoundItems(items, shapes, ox, oy, angle, liftZ, camX, camY) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const project = (lx, ly, lz) => {
    const wx = ox + lx * cos - ly * sin;
    const wy = oy + lx * sin + ly * cos;
    const wz = lz + terrainHeight(wx, wy);
    return {
      x: Math.round(projX(wx, wy) - camX),
      y: Math.round(projY(wx, wy, wz) - camY),
      depth: wx + wy + wz,
    };
  };
  for (const s of shapes) {
    const c = project(s.x, s.y, s.z + liftZ);
    if (s.disc) {
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        pts.push(project(s.x + Math.cos(a) * s.r, s.y, s.z + liftZ + Math.sin(a) * s.r));
      }
      // Lit like a box's side face: normal is the rotated local y axis
      const d = -s.n * sin * LIGHT.x + s.n * cos * LIGHT.y;
      const k = Math.min(1, Math.max(0.3, 0.3 + d));
      items.push({ poly: pts, color: s.color, k, depth: c.depth + (s.bias || 0) });
    } else {
      items.push({
        blob: c,
        rx: s.r * 1.4,
        ry: s.r * 1.2,
        color: s.color,
        k: Math.min(1, 0.35 + LIGHT.z),
        depth: c.depth + (s.bias || 0),
      });
    }
  }
}

// A wheel is a slim tread box plus a tire disc and hubcap on each face. The
// disc on the camera side always projects nearer than the box center, so the
// painter's sort shows the round face; edge-on, the box gives the silhouette.
function makeWheels(items, wheels, ox, oy, angle, liftZ, camX, camY) {
  const boxes = [];
  const shapes = [];
  for (const w of wheels) {
    boxes.push({
      x0: w.x - w.r * 0.72, x1: w.x + w.r * 0.72,
      y0: w.y0, y1: w.y1,
      z0: w.z - w.r * 0.72, z1: w.z + w.r * 0.72,
      color: TIRE,
    });
    for (const [ly, n] of [[w.y0, -1], [w.y1, 1]]) {
      shapes.push({ disc: true, x: w.x, y: ly, z: w.z, r: w.r, n, color: TIRE });
      shapes.push({ disc: true, x: w.x, y: ly, z: w.z, r: w.r * 0.45, n, color: HUB, bias: 0.06 });
    }
  }
  makeItems(items, boxes, ox, oy, angle, liftZ, camX, camY);
  makeRoundItems(items, shapes, ox, oy, angle, liftZ, camX, camY);
}

function drawScene(camX, camY) {
  const pose = implementPose();

  // Ground shadows: one quad under the tractor, one under the implement
  // (they part ways when a towed implement swings out of line)
  const shadowQuad = (ox, oy, angle, x0, x1, hw) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const shPt = (lx, ly) => {
      const wx = ox + lx * cos - ly * sin;
      const wy = oy + lx * sin + ly * cos;
      return {
        x: Math.round(projX(wx, wy) - camX),
        y: Math.round(projY(wx, wy, terrainHeight(wx, wy)) - camY),
      };
    };
    const sh = [shPt(x0, -hw), shPt(x1, -hw), shPt(x1, hw), shPt(x0, hw)];
    ctx.moveTo(sh[0].x, sh[0].y);
    for (const p of sh.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  };
  // One path for both quads so their overlap at the hitch doesn't darken
  const imp = IMPLEMENTS[tractor.implement];
  const impBoxes = imp.boxes();
  const impRear = Math.min(...impBoxes.map((b) => b.x0)) - 0.5;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  shadowQuad(tractor.x, tractor.y, tractor.angle, -6, 8.5, 5.5);
  shadowQuad(pose.x, pose.y, pose.angle, impRear, -6.5, 6);
  for (const t of trees) {
    const sx = Math.round(projX(t.wx, t.wy) - camX);
    const sy = Math.round(projY(t.wx, t.wy, terrainHeight(t.wx, t.wy)) - camY);
    ctx.moveTo(sx + 6, sy);
    ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Painter's algorithm: depth along the view axis is wx + wy + wz.
  const items = [];
  const liftZ = imp.liftable ? tractor.implLift * IMPLEMENT_LIFT_HEIGHT : 0;
  makeItems(items, BOXES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeWheels(items, TRACTOR_WHEELS, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeRoundItems(items, TRACTOR_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeItems(items, impBoxes, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeWheels(items, imp.wheels, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeItems(items, FARM_BOXES, FARM.x, FARM.y, 0, 0, camX, camY);
  makeRoundItems(items, FARM_SHAPES, FARM.x, FARM.y, 0, 0, camX, camY);
  for (const t of trees) {
    makeItems(items, TREE_BOXES, t.wx, t.wy, t.angle, 0, camX, camY);
    makeRoundItems(items, TREE_BLOBS, t.wx, t.wy, t.angle, 0, camX, camY);
  }
  for (const s of sacks) makeRoundItems(items, SACK_SHAPES, s.wx, s.wy, 0, 0, camX, camY);
  items.sort((a, b) => a.depth - b.depth);

  for (const item of items) {
    if (item.blob) {
      // Soft sphere: base ellipse with a lighter highlight up and to the left
      ctx.fillStyle = shade(item.color, item.k);
      ctx.beginPath();
      ctx.ellipse(item.blob.x, item.blob.y, item.rx, item.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(item.color, item.k * 1.16);
      ctx.beginPath();
      ctx.ellipse(
        item.blob.x - item.rx * 0.25,
        item.blob.y - item.ry * 0.3,
        item.rx * 0.55,
        item.ry * 0.5,
        0, 0, Math.PI * 2
      );
      ctx.fill();
      continue;
    }
    if (item.poly) {
      ctx.fillStyle = shade(item.color, item.k);
      ctx.beginPath();
      ctx.moveTo(item.poly[0].x, item.poly[0].y);
      for (const p of item.poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    for (const face of FACES) {
      const pts = face.i.map((i) => item.pts[i]);
      if (signedArea(pts) <= 0) continue;

      const nx = face.n[0] * item.cos - face.n[1] * item.sin;
      const ny = face.n[0] * item.sin + face.n[1] * item.cos;
      const d = nx * LIGHT.x + ny * LIGHT.y + face.n[2] * LIGHT.z;
      const k = Math.min(1, Math.max(0.3, 0.3 + d));

      ctx.fillStyle = shade(item.box.color, k);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Wheel tracks: stamped permanently into the prerendered map canvas while
// driving over unplowed field dirt (working a tile repaints it clean).
// ---------------------------------------------------------------------------

const TRACK_WHEELS = [
  { x: -4.5, y: 4.0, w: 2 }, // rear left (wide tire, wide mark)
  { x: -4.5, y: -4.0, w: 2 }, // rear right
  { x: 5.0, y: 3.1, w: 1 }, // front left
  { x: 5.0, y: -3.1, w: 1 }, // front right
];

let trackDist = 0;

function updateTracks(dt) {
  trackDist += Math.abs(tractor.speed) * dt;
  if (trackDist < 2) return;
  trackDist = 0;

  const cos = Math.cos(tractor.angle);
  const sin = Math.sin(tractor.angle);
  for (const wheel of TRACK_WHEELS) {
    const wx = tractor.x + wheel.x * cos - wheel.y * sin;
    const wy = tractor.y + wheel.x * sin + wheel.y * cos;
    if (tileTypeAt(wx, wy) !== 1) continue; // marks only on unplowed field dirt
    const px = Math.round(projX(wx, wy) + MAP_OFFSET_X);
    const py = Math.round(projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y);
    mapCtx.fillStyle = "rgba(94,66,38,0.45)";
    mapCtx.fillRect(px - (wheel.w >> 1), py, wheel.w, 1);
  }
}

// ---------------------------------------------------------------------------
// Sky: gradient, a friendly sun, and puffy clouds drifting past the island
// ---------------------------------------------------------------------------

let worldTime = 0;

const SKY = ctx.createLinearGradient(0, 0, 0, VIEW_H);
SKY.addColorStop(0, "#7ac9ef");
SKY.addColorStop(1, "#c8ecf8");

function drawSun() {
  ctx.fillStyle = "rgba(255,240,170,0.4)";
  ctx.beginPath();
  ctx.arc(56, 44, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe66b";
  ctx.beginPath();
  ctx.arc(56, 44, 13, 0, Math.PI * 2);
  ctx.fill();
}

const CLOUDS = [];
for (let i = 0; i < 9; i++) {
  CLOUDS.push({
    x: Math.random() * (VIEW_W + 240),
    y: Math.random() * (VIEW_H + 200),
    speed: 2 + Math.random() * 3,
    scale: 0.7 + Math.random() * 0.9,
    par: 0.15 + Math.random() * 0.25, // parallax: far clouds track the camera less
  });
}

function drawClouds(camX, camY) {
  const wrapX = VIEW_W + 240;
  const wrapY = VIEW_H + 200;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  for (const c of CLOUDS) {
    const sx = ((((c.x + worldTime * c.speed - camX * c.par) % wrapX) + wrapX) % wrapX) - 120;
    const sy = ((((c.y - camY * c.par) % wrapY) + wrapY) % wrapY) - 100;
    const s = c.scale * 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, 7 * s, 0, Math.PI * 2);
    ctx.arc(sx - 8 * s, sy + 2 * s, 5 * s, 0, Math.PI * 2);
    ctx.arc(sx + 8 * s, sy + 2 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Butterflies fluttering over the meadows
// ---------------------------------------------------------------------------

const BUTTERFLY_COLORS = ["#ff9ed2", "#ffd94f", "#ffffff", "#b8a6ff"];
const butterflies = [];
for (let i = 0; i < 14; i++) {
  butterflies.push({
    wx: Math.random() * MAP_SIZE,
    wy: Math.random() * MAP_SIZE,
    a: Math.random() * Math.PI * 2,
    phase: Math.random() * 10,
    color: BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length],
  });
}

function updateButterflies(dt) {
  for (const b of butterflies) {
    b.a += (Math.random() - 0.5) * 4 * dt;
    b.wx += Math.cos(b.a) * 7 * dt;
    b.wy += Math.sin(b.a) * 7 * dt;
    if (b.wx < 16 || b.wx > MAP_SIZE - 16 || b.wy < 16 || b.wy > MAP_SIZE - 16) {
      b.wx = Math.max(16, Math.min(MAP_SIZE - 16, b.wx));
      b.wy = Math.max(16, Math.min(MAP_SIZE - 16, b.wy));
      b.a = Math.atan2(MAP_SIZE / 2 - b.wy, MAP_SIZE / 2 - b.wx);
    }
  }
}

function drawButterflies(camX, camY) {
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

// ---------------------------------------------------------------------------
// Exhaust smoke & chaff particles
// ---------------------------------------------------------------------------

const smoke = [];
let smokeTimer = 0;

function updateSmoke(dt) {
  if (keys.ArrowUp || Math.abs(tractor.speed) > 5) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = keys.ArrowUp ? 0.07 : 0.18;
      const cos = Math.cos(tractor.angle);
      const sin = Math.sin(tractor.angle);
      const wx = tractor.x + 2 * cos;
      const wy = tractor.y + 2 * sin;
      smoke.push({
        wx,
        wy,
        wz: terrainHeight(wx, wy) + 10,
        life: 0.9,
        maxLife: 0.9,
      });
    }
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.life -= dt;
    p.wz += 16 * dt;
    p.wx += (Math.random() - 0.5) * 8 * dt;
    p.wy += (Math.random() - 0.5) * 8 * dt;
    if (p.life <= 0) smoke.splice(i, 1);
  }
}

// Golden chaff burst thrown up when a tile is harvested or grain is sold
function spawnChaff(wx, wy) {
  const base = terrainHeight(wx, wy);
  for (let i = 0; i < 8; i++) {
    const life = 0.5 + Math.random() * 0.4;
    smoke.push({
      wx: wx + (Math.random() - 0.5) * 10,
      wy: wy + (Math.random() - 0.5) * 10,
      wz: base + 2 + Math.random() * 4,
      life,
      maxLife: life,
      gold: true,
    });
  }
}

function drawSmoke(camX, camY) {
  for (const p of smoke) {
    const t = 1 - p.life / p.maxLife;
    const r = 0.8 + t * 2.6;
    ctx.fillStyle = p.gold
      ? `rgba(219,186,84,${(0.8 * (1 - t)).toFixed(2)})`
      : `rgba(235,235,235,${(0.7 * (1 - t)).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(projX(p.wx, p.wy) - camX, projY(p.wx, p.wy, p.wz) - camY, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Tractor state, economy & physics
// ---------------------------------------------------------------------------

const SEED_CAP = 64; // seeder hopper size, refilled at the farm
const TRAILER_CAP = 12; // sacks the trailer can carry
const SEED_PRICE = 2; // € per seed, bought automatically at the farm
const SACK_PRICE = 10; // € earned per sack of grain sold

let cash = 100; // € — enough starting capital for the first bag of seeds
let seeds = 0; // start empty: buy seeds at the farm
let cargo = 0; // sacks on the trailer
let sold = 0; // total sacks delivered to the farm
const sacks = []; // grain sacks lying on the fields

const tractor = {
  x: FARM.x + 34,
  y: FARM.y + 10,
  angle: -2.4, // facing up-left, toward the middle of the map
  speed: 0, // world units/s, positive = forward
  fastGear: true, // Shift toggles between road and work gear
  implement: "plow", // current implement: plow / seeder / harvester / trailer
  implAngle: -2.4, // world heading of a towed implement (trails the hitch)
  implDown: false, // Space toggles the implement
  implLift: 1, // animated: 0 = working the ground, 1 = fully raised
  implBounce: 0, // seconds left of the refused-lower dip animation
  gearFlash: 0, // seconds left of the red HUD flash (refused: gear too fast)
  implFlash: 0, // seconds left of the red HUD flash (implement complaint)
};

const ACCEL = 55;
const BRAKE = 80;
const FRICTION = 28;
const GEAR_FAST = 42;
const GEAR_SLOW = 16;
const MAX_REVERSE = -20;
// Fixed steering geometry: turn rate scales with speed, so the turning
// radius stays ~TURN_RADIUS at working speeds — tight enough to U-turn
// into the adjacent row (one tile = 16 units away).
const TURN_RADIUS = 7; // world units
const MAX_TURN_RATE = 2.5; // rad/s cap so the fast gear doesn't spin wildly

// Towed implements pivot at the drawbar pin and trail behind the tractor
const HITCH_X = -7; // hitch pin position in tractor-local coords
const MAX_HITCH_ANGLE = 1.6; // jackknife limit: the drawbar hits the wheel

// Frame the implement actually occupies: mounted implements share the
// tractor's frame; towed ones swing around the hitch with their own heading.
// The origin is placed so local (HITCH_X, 0) lands exactly on the hitch pin.
function implementPose() {
  if (!IMPLEMENTS[tractor.implement].towed)
    return { x: tractor.x, y: tractor.y, angle: tractor.angle };
  const a = tractor.implAngle;
  const hx = tractor.x + HITCH_X * Math.cos(tractor.angle);
  const hy = tractor.y + HITCH_X * Math.sin(tractor.angle);
  return { x: hx - HITCH_X * Math.cos(a), y: hy - HITCH_X * Math.sin(a), angle: a };
}

// True when any part of the implement's working width is over field dirt.
// Deliberately generous — samples across the blades and a bit ahead of
// them — so working the edge rows of a field isn't fiddly.
function implementOverField() {
  const pose = implementPose();
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const points = [
    [-9.8, -4],
    [-9.8, 0],
    [-9.8, 4],
    [-6, 0],
  ];
  for (const [lx, ly] of points) {
    const wx = pose.x + lx * cos - ly * sin;
    const wy = pose.y + lx * sin + ly * cos;
    if (tileTypeAt(wx, wy) >= 1) return true;
  }
  return false;
}

function update(dt) {
  const imp = IMPLEMENTS[tractor.implement];

  // Throttle / brake
  if (keys.ArrowUp) {
    tractor.speed += ACCEL * dt;
  } else if (keys.ArrowDown) {
    tractor.speed -= BRAKE * dt;
  } else {
    // Roll to a stop
    if (tractor.speed > 0) tractor.speed = Math.max(0, tractor.speed - FRICTION * dt);
    else tractor.speed = Math.min(0, tractor.speed + FRICTION * dt);
  }
  // Gravity along the slope: uphill fights the engine, downhill helps
  const cos = Math.cos(tractor.angle);
  const sin = Math.sin(tractor.angle);
  const grade =
    (terrainHeight(tractor.x + cos * 4, tractor.y + sin * 4) -
      terrainHeight(tractor.x - cos * 4, tractor.y - sin * 4)) /
    8;
  tractor.speed -= grade * 60 * dt;

  // Top speed from the gear, further reduced by drag when working the ground
  let maxForward =
    (tractor.fastGear ? GEAR_FAST : GEAR_SLOW) *
    (imp.liftable ? 1 - 0.35 * (1 - tractor.implLift) : 1);
  let maxReverse = MAX_REVERSE;

  // A lowered implement digging into unbroken ground bogs the tractor down
  if (imp.liftable && tractor.implLift < 0.5 && !implementOverField()) {
    maxForward = 3;
    maxReverse = -3;
  }

  if (tractor.speed > maxForward)
    tractor.speed = Math.max(maxForward, tractor.speed - 120 * dt);
  if (tractor.speed < maxReverse)
    tractor.speed = Math.min(maxReverse, tractor.speed + 120 * dt);

  // Steering only has effect while moving; reversing flips it like a real vehicle
  const turnRate =
    Math.min(Math.abs(tractor.speed) / TURN_RADIUS, MAX_TURN_RATE) *
    Math.sign(tractor.speed);
  let angVel = 0;
  if (keys.ArrowLeft) angVel -= turnRate;
  if (keys.ArrowRight) angVel += turnRate;
  tractor.angle += angVel * dt;

  // Move on the ground plane
  tractor.x += cos * tractor.speed * dt;
  tractor.y += sin * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.x));
  tractor.y = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.y));

  // A towed implement's wheels roll rather than skid, so the hitch's
  // sideways motion swings its heading toward the tractor's over time
  if (imp.towed) {
    let rel = tractor.angle - tractor.implAngle;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // wrap to (-pi, pi]
    rel -=
      ((tractor.speed * Math.sin(rel) + HITCH_X * angVel * Math.cos(rel)) /
        imp.towLength) *
      dt;
    rel = Math.max(-MAX_HITCH_ANGLE, Math.min(MAX_HITCH_ANGLE, rel));
    tractor.implAngle = tractor.angle - rel;
  } else {
    tractor.implAngle = tractor.angle;
  }

  // Hydraulic lift eases the implement up or down
  let liftTarget = tractor.implDown ? 0 : 1;
  if (tractor.implBounce > 0) {
    tractor.implBounce = Math.max(0, tractor.implBounce - dt);
    // Half-sine dip: drops partway, then springs back up
    liftTarget = 1 - 0.5 * Math.sin((Math.PI * (0.6 - tractor.implBounce)) / 0.6);
  }
  tractor.implLift += (liftTarget - tractor.implLift) * Math.min(1, dt * 5);
  tractor.gearFlash = Math.max(0, tractor.gearFlash - dt);
  tractor.implFlash = Math.max(0, tractor.implFlash - dt);

  // Field work under the implement while it's down and moving
  if (imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > 2) {
    const pose = implementPose();
    const pcos = Math.cos(pose.angle);
    const psin = Math.sin(pose.angle);
    const alongX = Math.abs(pcos) > Math.abs(psin);
    for (const oy of [-3.5, 0, 3.5]) {
      const wx = pose.x - 9.8 * pcos - oy * psin;
      const wy = pose.y - 9.8 * psin + oy * pcos;
      if (tractor.implement === "plow") plowTileAt(wx, wy, alongX);
      else if (tractor.implement === "seeder") seedTileAt(wx, wy);
      else if (tractor.implement === "harvester") harvestTileAt(wx, wy);
    }
  }

  // The trailer scoops up grain sacks it passes over
  if (tractor.implement === "trailer") {
    const pose = implementPose();
    const bx = pose.x - 16 * Math.cos(pose.angle);
    const by = pose.y - 16 * Math.sin(pose.angle);
    for (let i = sacks.length - 1; i >= 0 && cargo < TRAILER_CAP; i--) {
      if (Math.hypot(sacks[i].wx - bx, sacks[i].wy - by) < 9) {
        sacks.splice(i, 1);
        cargo++;
      }
    }
  }

  // Farmyard services: seed purchase and grain delivery
  if (nearFarm()) {
    if (tractor.implement === "seeder" && seeds < SEED_CAP) {
      // Top up the hopper with as many seeds as the cash covers
      const bought = Math.min(SEED_CAP - seeds, Math.floor(cash / SEED_PRICE));
      if (bought > 0) {
        seeds += bought;
        cash -= bought * SEED_PRICE;
      }
    }
    if (tractor.implement === "trailer" && cargo > 0) {
      cash += cargo * SACK_PRICE;
      sold += cargo;
      cargo = 0;
      const pose = implementPose();
      spawnChaff(pose.x - 16 * Math.cos(pose.angle), pose.y - 16 * Math.sin(pose.angle));
    }
  }

  worldTime += dt;
  updateTracks(dt);
  updateSmoke(dt);
  updateButterflies(dt);
  updateCrops(dt);
}

// ---------------------------------------------------------------------------
// Camera (follows the tractor)
// ---------------------------------------------------------------------------

const cam = {
  x: projX(tractor.x, tractor.y) - VIEW_W / 2,
  y: projY(tractor.x, tractor.y, terrainHeight(tractor.x, tractor.y)) - VIEW_H / 2,
};

function updateCamera(dt) {
  const tx = projX(tractor.x, tractor.y) - VIEW_W / 2;
  const ty = projY(tractor.x, tractor.y, terrainHeight(tractor.x, tractor.y)) - VIEW_H / 2;
  const k = Math.min(1, dt * 4);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
  const camX = Math.round(cam.x);
  const camY = Math.round(cam.y);

  // Sky beyond the map edges: the farm floats like a little island
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawSun();
  drawClouds(camX, camY);

  ctx.drawImage(mapCanvas, -MAP_OFFSET_X - camX, -MAP_OFFSET_Y - camY);
  drawScene(camX, camY);
  drawSmoke(camX, camY);
  drawButterflies(camX, camY);

  screenCtx.drawImage(view, 0, 0, screenCanvas.width, screenCanvas.height);

  // HUD
  const imp = IMPLEMENTS[tractor.implement];
  screenCtx.fillStyle = "rgba(0,0,0,0.45)";
  screenCtx.fillRect(0, screenCanvas.height - 26, screenCanvas.width, 26);
  screenCtx.font = "bold 13px monospace";
  const hudY = screenCanvas.height - 8;
  let hudX = 12;
  const seg = (text, color) => {
    screenCtx.fillStyle = color || "#e8e8d8";
    screenCtx.fillText(text, hudX, hudY);
    hudX += screenCtx.measureText(text).width;
  };
  const RED = "#ff5040";
  const flashGear = tractor.gearFlash > 0 && ((tractor.gearFlash * 8) | 0) % 2 === 0;
  const flashImpl = tractor.implFlash > 0 && ((tractor.implFlash * 8) | 0) % 2 === 0;
  seg(`GEAR: ${tractor.fastGear ? "FAST" : "SLOW"} [Shift]   `, flashGear ? RED : null);
  const state = imp.liftable ? (tractor.implDown ? " DOWN" : " UP") : "";
  seg(`${imp.label}${state} [Space]   `, flashImpl ? RED : null);
  if (tractor.implement === "seeder") seg(`SEEDS: ${seeds}   `, seeds === 0 ? RED : null);
  if (tractor.implement === "trailer") seg(`CARGO: ${cargo}/${TRAILER_CAP}   `);
  seg(`CASH: €${cash}   `, cash < SEED_PRICE ? RED : null);
  seg(`SOLD: ${sold}   `);
  seg(`@FARM 1:PLOW 2:SEED 3:HARVEST 4:TRAILER`, "#a8a898");
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  updateCamera(dt);
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
