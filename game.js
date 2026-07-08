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
// Ground map (prerendered once)
// ---------------------------------------------------------------------------

const EDGE_DEPTH = 10; // thickness of the dirt "cliff" at the map's near edges
const MAP_OFFSET_X = MAP_SIZE; // shift so projX is never negative

const mapCanvas = document.createElement("canvas");
mapCanvas.width = MAP_SIZE * 2;
mapCanvas.height = MAP_SIZE + EDGE_DEPTH;

function makeMap() {
  const mctx = mapCanvas.getContext("2d");

  // Tile types: 0 = grass, 1 = plowed field
  const tiles = [];
  for (let ty = 0; ty < MAP_TILES; ty++) tiles.push(new Array(MAP_TILES).fill(0));
  for (let i = 0; i < 6; i++) {
    const px = 1 + ((Math.random() * (MAP_TILES - 6)) | 0);
    const py = 1 + ((Math.random() * (MAP_TILES - 6)) | 0);
    const pw = 2 + ((Math.random() * 3) | 0);
    const ph = 2 + ((Math.random() * 3) | 0);
    for (let ty = py; ty < py + ph; ty++)
      for (let tx = px; tx < px + pw; tx++) tiles[ty][tx] = 1;
  }

  const mp = (wx, wy) => ({ x: projX(wx, wy) + MAP_OFFSET_X, y: projY(wx, wy, 0) });

  const GRASS = ["#4a8f3c", "#478a39", "#4d9340", "#458738"];
  const GRASS_DOTS = ["#3f7d33", "#55a046", "#5aab4b", "#2f6427"];
  const DIRT = ["#8a6b42", "#84663e", "#8f7046"];
  const DIRT_DOTS = ["#755833", "#96774d"];

  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const dirt = tiles[ty][tx] === 1;
      const c0 = mp(tx * TILE, ty * TILE);
      const c1 = mp((tx + 1) * TILE, ty * TILE);
      const c2 = mp((tx + 1) * TILE, (ty + 1) * TILE);
      const c3 = mp(tx * TILE, (ty + 1) * TILE);

      const base = dirt ? DIRT : GRASS;
      mctx.fillStyle = base[(Math.random() * base.length) | 0];
      mctx.beginPath();
      mctx.moveTo(c0.x, c0.y);
      mctx.lineTo(c1.x, c1.y);
      mctx.lineTo(c2.x, c2.y);
      mctx.lineTo(c3.x, c3.y);
      mctx.closePath();
      mctx.fill();

      if (dirt) {
        // Furrow lines running across the tile
        mctx.strokeStyle = "#6d5230";
        mctx.lineWidth = 1;
        for (const s of [0.25, 0.5, 0.75]) {
          const a = mp((tx + s) * TILE, ty * TILE);
          const b = mp((tx + s) * TILE, (ty + 1) * TILE);
          mctx.beginPath();
          mctx.moveTo(a.x, a.y);
          mctx.lineTo(b.x, b.y);
          mctx.stroke();
        }
      } else {
        // Grass speckles
        const dots = GRASS_DOTS;
        for (let i = 0; i < 5; i++) {
          const p = mp((tx + Math.random()) * TILE, (ty + Math.random()) * TILE);
          mctx.fillStyle = dots[(Math.random() * dots.length) | 0];
          mctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        }
      }
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
    mctx.fillStyle = color;
    mctx.beginPath();
    mctx.moveTo(a.x, a.y);
    mctx.lineTo(b.x, b.y);
    mctx.lineTo(b.x, b.y + EDGE_DEPTH);
    mctx.lineTo(a.x, a.y + EDGE_DEPTH);
    mctx.closePath();
    mctx.fill();
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

const LIGHT = { x: 0.35, y: 0.6, z: 0.71 };

const shadeCache = {};
function shade(color, k) {
  const key = color + "|" + k.toFixed(2);
  if (shadeCache[key]) return shadeCache[key];
  const r = Math.round(parseInt(color.slice(1, 3), 16) * k);
  const g = Math.round(parseInt(color.slice(3, 5), 16) * k);
  const b = Math.round(parseInt(color.slice(5, 7), 16) * k);
  return (shadeCache[key] = `rgb(${r},${g},${b})`);
}

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

  const local = (lx, ly, lz) => {
    const wx = tractor.x + lx * cos - ly * sin;
    const wy = tractor.y + lx * sin + ly * cos;
    return {
      x: Math.round(projX(wx, wy) - camX),
      y: Math.round(projY(wx, wy, lz) - camY),
      depth: wx + wy + lz,
    };
  };

  // Shadow
  const sh = [
    local(-8.5, -5.5, 0),
    local(8.5, -5.5, 0),
    local(8.5, 5.5, 0),
    local(-8.5, 5.5, 0),
  ];
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.moveTo(sh[0].x, sh[0].y);
  for (const p of sh.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();

  // Painter's algorithm: depth along the view axis is wx + wy + wz.
  const items = BOXES.map((box) => {
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
      smoke.push({
        wx: tractor.x + 2 * cos,
        wy: tractor.y + 2 * sin,
        wz: 10,
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
};

const ACCEL = 55;
const BRAKE = 80;
const FRICTION = 28;
const MAX_FORWARD = 42;
const MAX_REVERSE = -20;
const TURN_RATE = 2.2; // rad/s at full speed

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
  tractor.speed = Math.max(MAX_REVERSE, Math.min(MAX_FORWARD, tractor.speed));

  // Steering only has effect while moving; reversing flips it like a real vehicle
  const speedFactor = tractor.speed / MAX_FORWARD;
  if (keys.ArrowLeft) tractor.angle -= TURN_RATE * speedFactor * dt;
  if (keys.ArrowRight) tractor.angle += TURN_RATE * speedFactor * dt;

  // Move on the ground plane
  tractor.x += Math.cos(tractor.angle) * tractor.speed * dt;
  tractor.y += Math.sin(tractor.angle) * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.x));
  tractor.y = Math.max(margin, Math.min(MAP_SIZE - margin, tractor.y));

  updateSmoke(dt);
}

// ---------------------------------------------------------------------------
// Camera (follows the tractor)
// ---------------------------------------------------------------------------

const cam = {
  x: projX(tractor.x, tractor.y) - VIEW_W / 2,
  y: projY(tractor.x, tractor.y, 0) - VIEW_H / 2,
};

function updateCamera(dt) {
  const tx = projX(tractor.x, tractor.y) - VIEW_W / 2;
  const ty = projY(tractor.x, tractor.y, 0) - VIEW_H / 2;
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

  ctx.drawImage(mapCanvas, -MAP_OFFSET_X - camX, -camY);
  drawTractor(camX, camY);
  drawSmoke(camX, camY);

  screenCtx.drawImage(view, 0, 0, screenCanvas.width, screenCanvas.height);
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
