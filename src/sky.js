// ---------------------------------------------------------------------------
// Sky: gradient, a friendly sun, and puffy clouds drifting past the island
// ---------------------------------------------------------------------------

// The sky gradient is prerendered so it can be dithered, and repainted
// whenever the season shifts its colors
const skyCanvas = document.createElement("canvas");
skyCanvas.width = VIEW_W;
skyCanvas.height = VIEW_H;
const skyCtx = skyCanvas.getContext("2d", { willReadFrequently: true });

function paintSky() {
  const g = skyCtx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, shade(seasonHex(SKY_TOP_SEASONS), 1));
  g.addColorStop(1, shade(seasonHex(SKY_BOTTOM_SEASONS), 1));
  skyCtx.fillStyle = g;
  skyCtx.fillRect(0, 0, VIEW_W, VIEW_H);
  ditherRegion(skyCtx, 0, 0, VIEW_W, VIEW_H);
}

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

// The initial paintSky() and the CLOUDS layout both need to run at the
// exact point the original inline code did (CLOUDS' rand() calls have a
// fixed position in the world-gen sequence), so - like
// initTerrain()/initTrees() - this is an explicit init call rather than
// module-load-order top-level code.
function initSky() {
  paintSky();
  for (let i = 0; i < 9; i++) {
    CLOUDS.push({
      x: rand() * (VIEW_W + 240),
      y: rand() * (VIEW_H + 200),
      speed: 2 + rand() * 3,
      scale: 0.7 + rand() * 0.9,
      par: 0.15 + rand() * 0.25, // parallax: far clouds track the camera less
    });
  }
}

function drawClouds(camX, camY) {
  const wrapX = VIEW_W + 240;
  const wrapY = VIEW_H + 200;
  // Greyer and a touch more solid on overcast days, paper-white on clear ones
  const m = mistiness();
  const grey = Math.round(252 - 40 * m);
  ctx.fillStyle = `rgba(${grey},${grey - 2},${grey - 8},${(0.8 + 0.15 * m).toFixed(2)})`;
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
