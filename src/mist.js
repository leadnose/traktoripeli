import { VIEW_W, VIEW_H, ctx } from "./setup.js";
// worldTime isn't split out yet (Tractor section) - a genuine circular
// import, safe because these only read it at runtime.
import { worldTime } from "./legacy.js";

// ---------------------------------------------------------------------------
// Mist: a soft overcast haze that thickens and thins with mistiness(), plus
// a light shower once it's properly socked in. Pure screen-space overlay
// drawn straight to ctx, so it never touches the ink outline pipeline. Rain
// streaks are laid out by golden-ratio hops instead of the seeded RNG, so
// world generation stays byte-identical for a given seed.
// ---------------------------------------------------------------------------

// How overcast the day is, 0 (clear) to 1 (socked in): two slow sines of
// unrelated periods multiplied together, so it drifts continuously and
// never repeats on a predictable beat or pops between frames — same
// no-per-frame-randomness, no-snapping rule the rest of the weather/season
// system follows.
export function mistiness() {
  return 0.5 + 0.5 * Math.sin(worldTime * 0.02) * Math.sin(worldTime * 0.0053 + 1.7);
}

const RAIN_STREAKS = [];
for (let i = 0; i < 70; i++) {
  RAIN_STREAKS.push({
    x: ((i * 0.618034) % 1) * (VIEW_W + 40),
    y: ((i * 0.381966) % 1) * VIEW_H,
    speed: 14 + ((i * 7) % 13),
    sway: (i * 2.399963) % (Math.PI * 2), // golden angle, in radians
    size: i % 3 === 0 ? 2 : 1,
  });
}

export function drawMist(camX, camY) {
  const m = mistiness();

  // Haze: a pale gradient, thicker toward the top of the view (distance)
  if (m > 0.02) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, `rgba(206,216,220,${(0.4 * m).toFixed(2)})`);
    g.addColorStop(1, `rgba(206,216,220,${(0.06 * m).toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // Rain only once it's properly overcast
  const rain = Math.max(0, m - 0.55) / 0.45;
  if (rain <= 0) return;
  const n = Math.ceil(RAIN_STREAKS.length * Math.min(1, rain * 1.5));
  ctx.strokeStyle = `rgba(205,218,226,${(0.3 + 0.35 * rain).toFixed(2)})`;
  const wrapX = VIEW_W + 40;
  for (let i = 0; i < n; i++) {
    const f = RAIN_STREAKS[i];
    const sx =
      ((((f.x + Math.sin(worldTime * 2 + f.sway) * 3 - camX * 0.4) % wrapX) +
        wrapX) %
        wrapX) -
      20;
    const sy =
      (((f.y + worldTime * f.speed * 2.4 - camY * 0.4) % VIEW_H) + VIEW_H) % VIEW_H;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 1, sy + 4);
    ctx.stroke();
  }
}
