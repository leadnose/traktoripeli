// ---------------------------------------------------------------------------
// Exhaust smoke & chaff particles
// ---------------------------------------------------------------------------

const smoke = [];
let smokeTimer = 0;

function updateSmoke(dt) {
  const onGas =
    keys.ArrowUp || autoThrottling() || (touchDrive.throttleActive && touchDrive.throttle > 0.05);
  if (!gameOver && (onGas || Math.abs(tractor.speed) > 5 * GEAR_FAST_RATIO)) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = onGas ? 0.07 : 0.18;
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
    p.wx += (rand() - 0.5) * 8 * dt;
    p.wy += (rand() - 0.5) * 8 * dt;
    if (p.life <= 0) smoke.splice(i, 1);
  }
}

// Golden chaff burst thrown up when a tile is harvested or grain is sold
function spawnChaff(wx, wy) {
  const base = terrainHeight(wx, wy);
  for (let i = 0; i < 8; i++) {
    const life = 0.5 + rand() * 0.4;
    smoke.push({
      wx: wx + (rand() - 0.5) * 10,
      wy: wy + (rand() - 0.5) * 10,
      wz: base + 2 + rand() * 4,
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
