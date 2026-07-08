"use strict";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const SCALE = 4; // size of one sprite "pixel" on screen

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
// Ground texture
// ---------------------------------------------------------------------------

// A tiled grass texture: flat green base with random darker/lighter speckles,
// drawn at SCALE so the speckles match the sprite pixel size.
function makeGroundPattern() {
  const cells = 32; // tile is 32x32 "pixels"
  const tile = document.createElement("canvas");
  tile.width = cells * SCALE;
  tile.height = cells * SCALE;
  const tctx = tile.getContext("2d");

  tctx.fillStyle = "#4a8f3c";
  tctx.fillRect(0, 0, tile.width, tile.height);

  const speckles = ["#3f7d33", "#55a046", "#437f36", "#5aab4b"];
  for (let i = 0; i < 180; i++) {
    tctx.fillStyle = speckles[(Math.random() * speckles.length) | 0];
    const x = (Math.random() * cells) | 0;
    const y = (Math.random() * cells) | 0;
    tctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  }

  // A few small tufts of grass (2-pixel vertical marks)
  tctx.fillStyle = "#2f6427";
  for (let i = 0; i < 12; i++) {
    const x = (Math.random() * cells) | 0;
    const y = (Math.random() * (cells - 1)) | 0;
    tctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE * 2);
  }

  return ctx.createPattern(tile, "repeat");
}

const groundPattern = makeGroundPattern();

// ---------------------------------------------------------------------------
// Tractor sprite (top-down, facing up)
// ---------------------------------------------------------------------------

const PALETTE = {
  D: "#33231a", // dark outline
  R: "#c8402a", // red body
  r: "#a32f1e", // darker red
  B: "#9ad1e0", // cab window
  G: "#6b6b6b", // exhaust / metal
};

// Body only; wheels are drawn separately so they can animate.
const BODY_MAP = [
  "..DDDDD..",
  ".DRRRRRD.",
  ".DRGRRRD.",
  ".DRRRRRD.",
  ".DRRRRRD.",
  ".DrrrrrD.",
  ".DDDDDDD.",
  ".DBBBBBD.",
  ".DBBBBBD.",
  ".DDDDDDD.",
  ".DrRRRrD.",
  ".DrRRRrD.",
  "..DDDDD..",
];

function makeSprite(map, palette) {
  const c = document.createElement("canvas");
  c.width = map[0].length;
  c.height = map.length;
  const cc = c.getContext("2d");
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const color = palette[map[y][x]];
      if (!color) continue;
      cc.fillStyle = color;
      cc.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

const bodySprite = makeSprite(BODY_MAP, PALETTE);

// Wheels in sprite-local pixel coordinates (origin at tractor center).
// Front wheels are small, rear wheels are big.
const WHEELS = [
  { x: -6, y: -6, w: 2, h: 4 }, // front left
  { x: 4, y: -6, w: 2, h: 4 }, // front right
  { x: -7, y: 1, w: 3, h: 6 }, // rear left
  { x: 4, y: 1, w: 3, h: 6 }, // rear right
];

function drawWheel(wheel, phase) {
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(wheel.x, wheel.y, wheel.w, wheel.h);
  // Animated tread stripes
  ctx.fillStyle = "#4d4d4d";
  for (let y = 0; y < wheel.h; y++) {
    if ((y + phase) % 3 === 0) {
      ctx.fillRect(wheel.x, wheel.y + y, wheel.w, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Tractor state & physics
// ---------------------------------------------------------------------------

const tractor = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  angle: 0, // radians, 0 = facing up
  speed: 0, // px/s, positive = forward
  wheelPhase: 0,
};

const ACCEL = 180;
const BRAKE = 260;
const FRICTION = 90;
const MAX_FORWARD = 140;
const MAX_REVERSE = -70;
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

  // Move
  tractor.x += Math.sin(tractor.angle) * tractor.speed * dt;
  tractor.y -= Math.cos(tractor.angle) * tractor.speed * dt;

  // Keep on the map
  const margin = 8 * SCALE;
  tractor.x = Math.max(margin, Math.min(canvas.width - margin, tractor.x));
  tractor.y = Math.max(margin, Math.min(canvas.height - margin, tractor.y));

  // Wheel animation follows speed
  tractor.wheelPhase += tractor.speed * dt * 0.4;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
  ctx.fillStyle = groundPattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(Math.round(tractor.x), Math.round(tractor.y));
  ctx.rotate(tractor.angle);
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = false;

  const phase = ((Math.floor(tractor.wheelPhase) % 3) + 3) % 3;
  for (const wheel of WHEELS) drawWheel(wheel, phase);

  ctx.drawImage(bodySprite, -bodySprite.width / 2, -bodySprite.height / 2);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
