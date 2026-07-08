"use strict";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const screenCanvas = document.getElementById("game");
const screenCtx = screenCanvas.getContext("2d");
screenCtx.imageSmoothingEnabled = false;

// Everything is drawn to a low-res buffer and scaled up, so polygons come out
// as chunky pixels instead of smooth edges.
const PIXEL = 3;
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

window.addEventListener("keydown", (e) => {
  if (e.key.startsWith("Arrow")) e.preventDefault();
  keys[e.key] = true;
  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    tractor.plowDown = !tractor.plowDown;
  }
  if (e.key === "Shift" && !e.repeat) {
    tractor.fastGear = !tractor.fastGear;
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
  return h * t * t * (3 - 2 * t);
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

// Tile types: 0 = grass, 1 = field (unplowed),
// 2 = plowed with furrows along world y, 3 = plowed with furrows along world x
const tiles = [];

function tileTypeAt(wx, wy) {
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return -1;
  return tiles[ty][tx];
}

const GRASS = ["#4a8f3c", "#478a39", "#4d9340", "#458738"];
const GRASS_DOTS = ["#3f7d33", "#55a046", "#5aab4b", "#2f6427"];
const DIRT = ["#8a6b42", "#84663e", "#8f7046"];
const DIRT_DOTS = ["#755833", "#96774d"];

const mp = (wx, wy) => ({
  x: projX(wx, wy) + MAP_OFFSET_X,
  y: projY(wx, wy, terrainHeight(wx, wy)) + MAP_OFFSET_Y,
});

function drawTile(tx, ty) {
  const type = tiles[ty][tx];
  const c0 = mp(tx * TILE, ty * TILE);
  const c1 = mp((tx + 1) * TILE, ty * TILE);
  const c2 = mp((tx + 1) * TILE, (ty + 1) * TILE);
  const c3 = mp(tx * TILE, (ty + 1) * TILE);

  // Slope shading: brightness from the tile normal against the light
  const h00 = terrainHeight(tx * TILE, ty * TILE);
  const h10 = terrainHeight((tx + 1) * TILE, ty * TILE);
  const h11 = terrainHeight((tx + 1) * TILE, (ty + 1) * TILE);
  const h01 = terrainHeight(tx * TILE, (ty + 1) * TILE);
  const dzdx = (h10 + h11 - h00 - h01) / (2 * TILE);
  const dzdy = (h01 + h11 - h00 - h10) / (2 * TILE);
  const len = Math.hypot(dzdx, dzdy, 1);
  const dot = (-dzdx * LIGHT.x - dzdy * LIGHT.y + LIGHT.z) / len;
  const k = Math.max(0.4, Math.min(1.25, 0.3 + dot));

  const base = type === 0 ? GRASS : DIRT;
  mapCtx.fillStyle = shade(base[(Math.random() * base.length) | 0], k);
  mapCtx.beginPath();
  mapCtx.moveTo(c0.x, c0.y);
  mapCtx.lineTo(c1.x, c1.y);
  mapCtx.lineTo(c2.x, c2.y);
  mapCtx.lineTo(c3.x, c3.y);
  mapCtx.closePath();
  mapCtx.fill();

  if (type >= 2) {
    // Furrow lines parallel to the direction the tile was plowed in
    const alongX = type === 3;
    mapCtx.strokeStyle = shade("#6d5230", k);
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
  } else {
    // Speckles: dirt clods on unplowed fields, grass tufts elsewhere
    const dots = type === 1 ? DIRT_DOTS : GRASS_DOTS;
    for (let i = 0; i < 5; i++) {
      const p = mp((tx + Math.random()) * TILE, (ty + Math.random()) * TILE);
      mapCtx.fillStyle = shade(dots[(Math.random() * dots.length) | 0], k);
      mapCtx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
  }
}

// Turn an unplowed field tile into a plowed one under the world point,
// with furrows along the axis closest to the travel direction
function plowTileAt(wx, wy, alongX) {
  if (tileTypeAt(wx, wy) !== 1) return;
  const tx = (wx / TILE) | 0;
  const ty = (wy / TILE) | 0;
  tiles[ty][tx] = alongX ? 3 : 2;
  drawTile(tx, ty);
}

function makeMap() {
  for (let ty = 0; ty < MAP_TILES; ty++) tiles.push(new Array(MAP_TILES).fill(0));
  for (let i = 0; i < 6; i++) {
    const px = 1 + ((Math.random() * (MAP_TILES - 6)) | 0);
    const py = 1 + ((Math.random() * (MAP_TILES - 6)) | 0);
    const pw = 2 + ((Math.random() * 3) | 0);
    const ph = 2 + ((Math.random() * 3) | 0);
    for (let ty = py; ty < py + ph; ty++)
      for (let tx = px; tx < px + pw; tx++) tiles[ty][tx] = 1;
  }

  // Back-to-front so nearer hills paint over the ones behind them
  for (let s = 0; s <= 2 * (MAP_TILES - 1); s++) {
    for (let ty = Math.max(0, s - MAP_TILES + 1); ty <= Math.min(MAP_TILES - 1, s); ty++) {
      drawTile(s - ty, ty);
    }
  }

  // Dirt cliffs along the two near (bottom) edges of the map diamond
  const east = mp(MAP_SIZE, 0);
  const south = mp(MAP_SIZE, MAP_SIZE);
  const west = mp(0, MAP_SIZE);
  for (const [a, b, color] of [
    [east, south, "#6b4f2e"],
    [south, west, "#57401f"],
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
// Tractor model: axis-aligned boxes in local space (+x = forward, z = up),
// rotated around z and projected each frame. Faces are shaded by a fixed
// light so the tractor reads as 3D from every direction.
// ---------------------------------------------------------------------------

const BOXES = [
  { x0: -7.0, x1: 3.0, y0: -3.0, y1: 3.0, z0: 2.5, z1: 6.0, color: "#c8402a" }, // chassis
  { x0: 3.0, x1: 7.0, y0: -2.2, y1: 2.2, z0: 2.5, z1: 5.5, color: "#c8402a" }, // hood
  { x0: -6.5, x1: -1.0, y0: -2.6, y1: 2.6, z0: 6.0, z1: 10.0, color: "#9ad1e0" }, // cab glass
  { x0: -7.0, x1: -0.5, y0: -3.0, y1: 3.0, z0: 10.0, z1: 11.0, color: "#a32f1e" }, // roof
  { x0: 1.5, x1: 2.5, y0: -0.5, y1: 0.5, z0: 5.5, z1: 9.5, color: "#6b6b6b" }, // exhaust
  { x0: -7.0, x1: -2.0, y0: 3.0, y1: 5.0, z0: 0.0, z1: 5.0, color: "#2b2b2b" }, // rear wheel L
  { x0: -7.0, x1: -2.0, y0: -5.0, y1: -3.0, z0: 0.0, z1: 5.0, color: "#2b2b2b" }, // rear wheel R
  { x0: 3.5, x1: 6.5, y0: 2.3, y1: 3.9, z0: 0.0, z1: 3.2, color: "#2b2b2b" }, // front wheel L
  { x0: 3.5, x1: 6.5, y0: -3.9, y1: -2.3, z0: 0.0, z1: 3.2, color: "#2b2b2b" }, // front wheel R
];

// Plow implement behind the tractor; its boxes get a z offset from the
// hydraulic lift so it can be raised for transport and dropped to till.
const PLOW_LIFT_HEIGHT = 3.5;
const PLOW_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.2, x1: -8.8, y0: -4.6, y1: 4.6, z0: 3.4, z1: 4.6, color: "#a32f1e" }, // beam
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  PLOW_BOXES.push({
    x0: -10.6, x1: -9.4, y0: yc - 0.55, y1: yc + 0.55, z0: 0.3, z1: 3.4,
    color: "#54565a", // tine
  });
}

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

function drawTractor(camX, camY) {
  const cos = Math.cos(tractor.angle);
  const sin = Math.sin(tractor.angle);

  // Each point rides at terrain height under its own footprint, which drapes
  // the model over slopes so the tractor visibly pitches and rolls on hills.
  const local = (lx, ly, lz) => {
    const wx = tractor.x + lx * cos - ly * sin;
    const wy = tractor.y + lx * sin + ly * cos;
    const wz = lz + terrainHeight(wx, wy);
    return {
      x: Math.round(projX(wx, wy) - camX),
      y: Math.round(projY(wx, wy, wz) - camY),
      depth: wx + wy + wz,
    };
  };

  // Shadow (covers tractor plus the plow overhang at the rear)
  const sh = [
    local(-11, -5.5, 0),
    local(8.5, -5.5, 0),
    local(8.5, 5.5, 0),
    local(-11, 5.5, 0),
  ];
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.moveTo(sh[0].x, sh[0].y);
  for (const p of sh.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();

  const lift = tractor.plowLift * PLOW_LIFT_HEIGHT;
  const boxes = BOXES.concat(
    PLOW_BOXES.map((b) => ({ ...b, z0: b.z0 + lift, z1: b.z1 + lift }))
  );

  // Painter's algorithm: depth along the view axis is wx + wy + wz.
  const items = boxes.map((box) => {
    const pts = [];
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++)
          pts.push(local(xi ? box.x1 : box.x0, yi ? box.y1 : box.y0, zi ? box.z1 : box.z0));
    const center = local((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
    return { box, pts, depth: center.depth };
  });
  items.sort((a, b) => a.depth - b.depth);

  for (const item of items) {
    for (const face of FACES) {
      const pts = face.i.map((i) => item.pts[i]);
      if (signedArea(pts) <= 0) continue;

      const nx = face.n[0] * cos - face.n[1] * sin;
      const ny = face.n[0] * sin + face.n[1] * cos;
      const d = nx * LIGHT.x + ny * LIGHT.y + face.n[2] * LIGHT.z;
      const k = Math.min(1, Math.max(0.3, 0.3 + d));

      ctx.fillStyle = shade(item.box.color, k);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Wheel tracks: stamped permanently into the prerendered map canvas while
// driving over unplowed field dirt (plowing a tile repaints it clean).
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
    mapCtx.fillStyle = "rgba(54,38,20,0.45)";
    mapCtx.fillRect(px - (wheel.w >> 1), py, wheel.w, 1);
  }
}

// ---------------------------------------------------------------------------
// Exhaust smoke
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

function drawSmoke(camX, camY) {
  for (const p of smoke) {
    const t = 1 - p.life / 0.9;
    const size = 1 + Math.round(t * 3);
    ctx.fillStyle = `rgba(160,160,160,${(0.6 * (1 - t)).toFixed(2)})`;
    ctx.fillRect(
      Math.round(projX(p.wx, p.wy) - camX - size / 2),
      Math.round(projY(p.wx, p.wy, p.wz) - camY - size / 2),
      size,
      size
    );
  }
}

// ---------------------------------------------------------------------------
// Tractor state & physics
// ---------------------------------------------------------------------------

const tractor = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  angle: 0, // radians in the ground plane; 0 = toward screen lower-right
  speed: 0, // world units/s, positive = forward
  fastGear: true, // Shift toggles between road and work gear
  plowDown: false, // Space toggles the plow
  plowLift: 1, // animated: 0 = blades in the ground, 1 = fully raised
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

function update(dt) {
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

  // Top speed from the gear, further reduced by plow drag when it's down
  const maxForward =
    (tractor.fastGear ? GEAR_FAST : GEAR_SLOW) * (1 - 0.35 * (1 - tractor.plowLift));
  if (tractor.speed > maxForward)
    tractor.speed = Math.max(maxForward, tractor.speed - 80 * dt);
  tractor.speed = Math.max(MAX_REVERSE, tractor.speed);

  // Steering only has effect while moving; reversing flips it like a real vehicle
  const turnRate =
    Math.min(Math.abs(tractor.speed) / TURN_RADIUS, MAX_TURN_RATE) *
    Math.sign(tractor.speed);
  if (keys.ArrowLeft) tractor.angle -= turnRate * dt;
  if (keys.ArrowRight) tractor.angle += turnRate * dt;

  // Move on the ground plane
  tractor.x += cos * tractor.speed * dt;
  tractor.y += sin * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.x));
  tractor.y = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.y));

  // Hydraulic lift eases the plow up or down
  const liftTarget = tractor.plowDown ? 0 : 1;
  tractor.plowLift += (liftTarget - tractor.plowLift) * Math.min(1, dt * 5);

  // Till field tiles passing under the blades
  if (tractor.plowLift < 0.3 && Math.abs(tractor.speed) > 2) {
    const alongX = Math.abs(cos) > Math.abs(sin);
    for (const oy of [-3.5, 0, 3.5]) {
      plowTileAt(
        tractor.x - 9.8 * cos - oy * sin,
        tractor.y - 9.8 * sin + oy * cos,
        alongX
      );
    }
  }

  updateTracks(dt);
  updateSmoke(dt);
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

  // Void beyond the map edges
  ctx.fillStyle = "#10141a";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.drawImage(mapCanvas, -MAP_OFFSET_X - camX, -MAP_OFFSET_Y - camY);
  drawTractor(camX, camY);
  drawSmoke(camX, camY);

  screenCtx.drawImage(view, 0, 0, screenCanvas.width, screenCanvas.height);

  // HUD
  screenCtx.fillStyle = "rgba(0,0,0,0.45)";
  screenCtx.fillRect(0, screenCanvas.height - 26, screenCanvas.width, 26);
  screenCtx.fillStyle = "#e8e8d8";
  screenCtx.font = "bold 13px monospace";
  screenCtx.fillText(
    `GEAR: ${tractor.fastGear ? "FAST" : "SLOW"} [Shift]   ` +
      `PLOW: ${tractor.plowDown ? "DOWN" : "UP"} [Space]   ` +
      `Arrows: drive`,
    12,
    screenCanvas.height - 8
  );
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
