// ---------------------------------------------------------------------------
// The ladybug: one tiny critter hides in the grass somewhere. Roll up to it
// slowly and it pays a little luck money, buzzes off, and hides again.
// ---------------------------------------------------------------------------

const LADYBUG_BONUS = 10;

const ladybug = { wx: 0, wy: 0, flee: 0, dir: 0 };
let luckFlash = 0; // makes the CASH readout blink green on a find

function placeLadybug() {
  for (let tries = 0; tries < 200; tries++) {
    const wx = 24 + rand() * (MAP_SIZE - 48);
    const wy = 24 + rand() * (MAP_SIZE - 48);
    if (tileTypeAt(wx, wy) !== 0) continue;
    if (roadTiles.has(tileKey(wx, wy))) continue;
    // Not in the farmyard, where every run starts
    if (Math.hypot(wx - FARM.x, wy - FARM.y) < FARM_RADIUS + 20) continue;
    ladybug.wx = wx;
    ladybug.wy = wy;
    return;
  }
}

function updateLadybug(dt) {
  luckFlash = Math.max(0, luckFlash - dt);
  if (ladybug.flee > 0) {
    // Airborne: buzz away from the finder, then hide somewhere fresh
    ladybug.flee -= dt;
    ladybug.wx += Math.cos(ladybug.dir) * 26 * dt;
    ladybug.wy += Math.sin(ladybug.dir) * 26 * dt;
    if (ladybug.flee <= 0) placeLadybug();
    return;
  }
  if (!gameStarted || gameOver) return;
  // Only a slow, deliberate approach counts as finding it — half the
  // work gear's top speed, expressed as such so it stays exactly half no
  // matter how GEAR_SLOW gets retuned
  const d = Math.hypot(tractor.x - ladybug.wx, tractor.y - ladybug.wy);
  if (d < 8 && Math.abs(tractor.speed) < GEAR_SLOW / 2) {
    addCash(LADYBUG_BONUS);
    luckFlash = 1.2;
    playPickup();
    ladybug.flee = 1.6;
    ladybug.dir = Math.atan2(ladybug.wy - tractor.y, ladybug.wx - tractor.x);
  }
}

function drawLadybug(camX, camY) {
  const b = ladybug;
  const lift = b.flee > 0 ? (1.6 - b.flee) * 14 : 0;
  const x = Math.round(projX(b.wx, b.wy) - camX);
  const y = Math.round(projY(b.wx, b.wy, terrainHeight(b.wx, b.wy) + 0.6 + lift) - camY);
  if (x < -3 || x > VIEW_W + 3 || y < -3 || y > VIEW_H + 3) return;
  ctx.fillStyle = shade("#d8291f", 1); // wing shells
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(x + 1, y - 1, 1, 2); // head
  ctx.fillRect(x - 1, y - 1, 1, 1); // spot
  if (b.flee > 0 && Math.sin(worldTime * 16) > 0) {
    ctx.fillStyle = "rgba(252,247,235,0.9)"; // wing blur while airborne
    ctx.fillRect(x - 2, y - 2, 1, 1);
    ctx.fillRect(x + 2, y - 2, 1, 1);
  }
}
