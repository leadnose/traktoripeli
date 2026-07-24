
// ---------------------------------------------------------------------------
// Seeded RNG: the whole world is generated through rand(), so the same map
// number always produces the same world. Picked from the F1 menu (or ?map=
// in the URL, 1-10); anything out of range gets replaced with a random pick.
// ---------------------------------------------------------------------------

const urlParams = new URLSearchParams(location.search);
const mapParam = parseInt(urlParams.get("map"), 10);
const MAP_INDEX =
  Number.isInteger(mapParam) && mapParam >= 1 && mapParam <= MAP_PROFILES.length
    ? mapParam
    : 1 + ((Math.random() * MAP_PROFILES.length) | 0);
const PROFILE = MAP_PROFILES[MAP_INDEX - 1];
const SEED = PROFILE.seed;

// Game mode: "survival" rolls year after year — growing season running
// straight through, Jan 1 to Dec 31 — with a property tax due every Dec 31,
// and "sandbox" rolls the same years with no taxes, no failure and no end —
// just roaming. Chosen in the start menu; reloads carry the mode in the URL
// next to the map number, and a fresh visit (no mode in the URL) opens the
// start menu before anything moves.
const MODES = ["survival", "sandbox"];
let mode = MODES.includes(urlParams.get("mode")) ? urlParams.get("mode") : "survival";
let gameStarted = urlParams.has("mode");

// Kept as setters so this file stays the one place mode/gameStarted are
// declared — startGame()/continueInSandbox() call these instead.
function setMode(m) {
  mode = m;
}
function setGameStarted(v) {
  gameStarted = v;
}

const rand = (function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(SEED >>> 0);

console.log(
  `map ${MAP_INDEX}/${MAP_PROFILES.length} — ${PROFILE.name} — reload with ?map=${MAP_INDEX} to reproduce`
);

// Roll a value within one of this map's profile bands (a [min,max] pair)
function rollBand(range) {
  return range[0] + rand() * (range[1] - range[0]);
}
