
// ---------------------------------------------------------------------------
// Save games: the whole mutable state autosaves to localStorage, so a reload
// (or updating the game) resumes the run. Terrain, roads, water and scenery
// all regenerate deterministically from the seed and aren't saved; only the
// tile arrays and the player's numbers are.
// ---------------------------------------------------------------------------

const SAVE_KEY = "traktoripeli.save";
const SAVE_VERSION = 4; // bump when map generation or calendar meaning changes: stale saves drop
let savingDisabled = false; // set when navigating away from a discarded run
// Kept as a setter so this file stays the one place savingDisabled is
// declared - input.js's handleMenuKey() calls this instead.
function setSavingDisabled(v) {
  savingDisabled = v;
}

function saveGame() {
  if (!gameStarted || gameOver || savingDisabled) return;
  const data = {
    v: SAVE_VERSION,
    map: MAP_INDEX,
    mode,
    tiles,
    dirs,
    growth: growth.map((row) => row.map((g) => Math.round(g * 10) / 10)),
    sacks,
    cash,
    seeds,
    cargo,
    sold,
    fuel,
    year,
    propertyTax,
    timeLeft: Math.round(timeLeft * 10) / 10,
    tractor: {
      x: tractor.x,
      y: tractor.y,
      angle: tractor.angle,
      fastGear: tractor.fastGear,
      implement: tractor.implement,
      implAngle: tractor.implAngle,
      implDown: tractor.implDown,
      implLift: tractor.implLift,
    },
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // private browsing etc: the run just isn't saved
  }
}

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === SAVE_VERSION && s.tiles && s.tiles.length === MAP_TILES
      ? s
      : null;
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // nothing to do
  }
}

// Save on the way out (tab closed, hidden or navigated away), on top of
// the periodic autosave from update()
window.addEventListener("pagehide", saveGame);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveGame();
});
