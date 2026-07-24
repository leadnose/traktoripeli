import { clamp } from "./setup.js";
import { gameStarted, mode, setMode, setGameStarted, MAP_INDEX } from "./rng.js";
import { MAP_SIZE, TILE, MAP_TILES, rotateLocal } from "./projection.js";
import { terrainHeight } from "./terrain.js";
import { SEASON_DAYS, updateSeason } from "./seasons.js";
import { playTax, playPickup, playSell } from "./sound.js";
import { keys, paused, dateJump, autoThrottleOn, setMenuOpen, setPaused, setDateJump, setDateJumpError } from "./input.js";
import { touchDrive } from "./touch.js";
import { FARM, nearFarm, nearFuelTank } from "./farmyard.js";
import { nearCity } from "./city.js";
import { IMPLEMENTS, FARM_SOLID_WORLD, FENCE_SOLID_WORLD } from "./box-models.js";
import { CROP_STAGES, tileTypeAt, roadTiles, tileKey, plowTileAt, seedTileAt, harvestTileAt, updateCrops } from "./ground.js";
import { treesByTile } from "./trees.js";
import { animals, updateAnimals, updateHerds, updateBirds } from "./animals.js";
import { updateCart } from "./cart.js";
import { updateButterflies } from "./butterflies.js";
import { updateLadybug } from "./ladybug.js";
import { updateSmoke, spawnChaff } from "./smoke.js";
import { updateTracks } from "./wheel-tracks.js";
import { saveGame, clearSave } from "./save.js";

export let worldTime = 0;

// ---------------------------------------------------------------------------
// Tractor state, economy & physics
// ---------------------------------------------------------------------------

export const SEED_CAP = 64; // seeder hopper size, refilled at the farm
export const TRAILER_CAP = 12; // sacks the trailer can carry
export const SEED_PRICE = 2; // £ per seed, bought automatically at the farm
export const SACK_PRICE = 10; // £ earned per sack of grain sold

// Fuel: a tank sized so a full one comfortably covers a return trip from
// anywhere on the map, refilled automatically at the farm like seeds
export const FUEL_CAP = 100;
export const FUEL_PRICE = 1; // £ per unit, bought automatically at the farm

// seconds — one Jan 1 - Dec 31 year, at the same real-seconds-per-day pace
// the old Apr-Oct growing season ran at (300s / 213 days)
export const ROUND_TIME = Math.round((300 * SEASON_DAYS) / 213);
export let timeLeft = ROUND_TIME;
export let gameOver = false;
export let bestScores = [];
export let finalRank = -1; // this round's place in the best list, -1 if none

// Survival mode: the years keep rolling and every Dec 31 the property tax
// is collected, growing a little each year, income or not. Seeds can go on
// credit down to the debt limit; sink below it and the bank takes the farm.
// The scoreboard is the longest runs in years, kept in localStorage.
export const SURVIVAL_START_CASH = 250;
export const TAX_BASE = 150; // £ — the first year's property tax
export const TAX_STEP = 75; // £ added to the tax each following year
export const DEBT_LIMIT = 400; // bankruptcy when cash drops below -this
export const SURVIVAL_SCORES_KEY = "traktoripeli.survival";
export let year = 1;
export let propertyTax = TAX_BASE;
export let taxFlash = 0; // seconds left of the "tax paid" banner
export let taxPaid = 0; // amount shown in that banner
export let taxYear = 0; // the year that amount was billed against, for the banner

// Sandbox mode: the same rolling years, but nothing is ever due and
// nothing ever ends. A fat wallet so seeds are never a worry.
export const SANDBOX_START_CASH = 1000;

// Calendar day indices for the year's key dates (Jan 1 = day 0), named so
// every place that needs one of these boundaries — the sandbox pacing
// phases below and currentCalendarDay()'s comment — refers to the same
// source instead of restating the numbers.
export const APR1_DAY = 90; // Jan 1 - Mar 31 days, i.e. the day index Apr 1 lands on
export const JUN1_DAY = 151;
export const SEP1_DAY = 243;
export const NOV1_DAY = 304;

// Sandbox season pacing: the calendar crawls through spring planting and
// autumn harvest so there is time to plant every field and haul every sack,
// and runs at full speed the rest of the year — through summer while the
// crops ripen, and again through the quiet stretch from Nov 1 to Mar 31.
// Rates are calendar seconds per real second; the phase boundaries are
// expressed as timeLeft values so the frame loop can compare directly.
export const SANDBOX_SPRING_RATE = 0.25; // Apr 1 – May 31: planting
export const SANDBOX_SUMMER_RATE = 1; // Jun 1 – Aug 31: growing
export const SANDBOX_AUTUMN_RATE = 0.25; // Sep 1 – Oct 31: harvest and hauling
export const SPRING_START_LEFT = ROUND_TIME * (1 - APR1_DAY / SEASON_DAYS);
export const SUMMER_START_LEFT = ROUND_TIME * (1 - JUN1_DAY / SEASON_DAYS);
export const AUTUMN_START_LEFT = ROUND_TIME * (1 - SEP1_DAY / SEASON_DAYS);
export const OFFSEASON_START_LEFT = ROUND_TIME * (1 - NOV1_DAY / SEASON_DAYS);

// In sandbox crops grow on the calendar instead of the wall clock: seed to
// mature spans this many calendar days, so a spring planting sprouts slowly,
// shoots up over summer and stands golden by September whatever the
// real-time pace of each phase.
export const SANDBOX_GROW_DAYS = 90;
export const SANDBOX_GROW_FACTOR =
  CROP_STAGES[2] / ((SANDBOX_GROW_DAYS * ROUND_TIME) / SEASON_DAYS);

// The sandbox pacing phases, in the order they're tested as the calendar
// counts down from ROUND_TIME to 0: the first entry whose boundary timeLeft
// is still ahead is the current phase. One table instead of two separate
// rate/floor cascades, so a boundary change only has to be made once.
export const SANDBOX_PHASES = [
  { boundary: SPRING_START_LEFT, rate: 1 }, // Jan 1 - Mar 31: quiet stretch
  { boundary: SUMMER_START_LEFT, rate: SANDBOX_SPRING_RATE }, // Apr 1 - May 31: planting
  { boundary: AUTUMN_START_LEFT, rate: SANDBOX_SUMMER_RATE }, // Jun 1 - Aug 31: growing
  { boundary: OFFSEASON_START_LEFT, rate: SANDBOX_AUTUMN_RATE }, // Sep 1 - Oct 31: harvest and hauling
  { boundary: 0, rate: 1 }, // Nov 1 - Dec 31: quiet stretch
];

export function sandboxPhase() {
  for (const p of SANDBOX_PHASES) {
    if (timeLeft > p.boundary) return p;
  }
  return SANDBOX_PHASES[SANDBOX_PHASES.length - 1];
}

export function sandboxClockRate() {
  return sandboxPhase().rate;
}

// The timeLeft value where the current phase's rate stops applying
export function sandboxPhaseFloor() {
  return sandboxPhase().boundary;
}

export function modeStartCash(m) {
  return m === "sandbox" ? SANDBOX_START_CASH : SURVIVAL_START_CASH;
}

export function startGame(m) {
  setMode(m);
  cash = modeStartCash(m);
  setGameStarted(true);
  setMenuOpen(false);
  setPaused(false);
}

// Dec 31: the tax collector comes around. Returns false when the bill
// bankrupts the farm and the run is over.
export function collectTax() {
  cash -= propertyTax;
  taxPaid = propertyTax;
  taxYear = year; // the year that's ending, before the caller rolls it over
  taxFlash = 4;
  playTax();
  if (cash < -DEBT_LIMIT) {
    endSurvival();
    return false;
  }
  propertyTax += TAX_STEP;
  return true;
}

// Dec 31 -> Jan 1: the year turns over and the calendar starts again from
// the top. Shared by the live per-frame update and the offline catch-up
// loop so this crossing only lives in one place.
export function rollOverYear() {
  year++;
  timeLeft = ROUND_TIME;
}

// Away-clock catch-up: time the frame loop never saw (rAF stops in a
// hidden tab) is applied in one step. Crops grow and the calendar keeps
// turning — year by year in survival, taxes and all.
export function advanceTime(sec) {
  // Paused means paused: time away from the tab stays off the books too
  if (!gameStarted || gameOver || paused) return;
  worldTime += sec;
  while (sec > 0 && !gameOver) {
    if (mode === "sandbox") {
      // The calendar runs at a phase-dependent speed and the crops grow on
      // the calendar, so the catch-up walks phase by phase: each step spends
      // the real seconds the current phase's remainder costs at its rate.
      const rate = sandboxClockRate();
      const floor = sandboxPhaseFloor();
      const span = timeLeft - floor; // calendar seconds left in this phase
      if (sec * rate >= span) {
        updateCrops(span * SANDBOX_GROW_FACTOR);
        sec -= span / rate;
        timeLeft = floor;
        if (floor === 0) rollOverYear();
      } else {
        updateCrops(sec * rate * SANDBOX_GROW_FACTOR);
        timeLeft -= sec * rate;
        sec = 0;
      }
      continue;
    }
    // Survival runs on the wall clock
    if (timeLeft > sec) {
      updateCrops(sec);
      timeLeft -= sec;
      sec = 0;
    } else {
      updateCrops(timeLeft);
      sec -= timeLeft;
      timeLeft = 0;
      if (!collectTax()) return;
      rollOverYear();
    }
  }
}

// Where the calendar stands as a day index of the game year: Jan 1 = 0,
// Mar 31 = APR1_DAY - 1, Apr 1 = APR1_DAY, Nov 1 = NOV1_DAY,
// Dec 31 = SEASON_DAYS - 1. Mirrors the HUD's date arithmetic exactly, so a
// jump lands on the date the player reads.
export function currentCalendarDay() {
  const p = 1 - timeLeft / ROUND_TIME;
  return Math.min(SEASON_DAYS - 1, Math.floor(p * SEASON_DAYS));
}

// Enter in the date-jump field: parse the typed MMDD and fast-forward the
// calendar to that date's next occurrence. The world advances in small
// real-time steps through advanceTime, so crops grow and taxes fall due
// exactly as if the time had really been played.
export function tryDateJump() {
  if (dateJump.length !== 4) {
    setDateJumpError(true);
    return;
  }
  const mm = +dateJump.slice(0, 2);
  const dd = +dateJump.slice(2);
  // A fixed non-leap reference year, just to validate the typed date
  const y = 2001;
  if (
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    new Date(Date.UTC(y, mm - 1, dd)).getUTCDate() !== dd
  ) {
    setDateJumpError(true);
    return;
  }
  const target = (Date.UTC(y, mm - 1, dd) - Date.UTC(y, 0, 1)) / 86400000;
  // Always at least one step forward: jumping to today's date rolls a
  // whole year around in the cyclical modes. The guard comfortably covers
  // the longest year (sandbox's slow spring and autumn phases) and the loop
  // stops early if the jump itself ends the run (a tax it can't cover).
  for (let guard = 0; guard < 12000 && !gameOver; guard++) {
    advanceTime(0.2);
    if (currentCalendarDay() === target) break;
  }
  setDateJump(null);
}

// ---------------------------------------------------------------------------
// Save games: the whole mutable state autosaves to localStorage, so a reload
// (or updating the game) resumes the run. Terrain, roads, water and scenery
// all regenerate deterministically from the seed and aren't saved; only the
// tile arrays and the player's numbers are.
// ---------------------------------------------------------------------------

export function endSurvival() {
  gameOver = true;
  tractor.speed = 0;
  tractor.angVel = 0;
  clearSave(); // a finished run must not resurrect on reload
  const entry = { years: year, cash, map: MAP_INDEX, date: Date.now() };
  let scores;
  try {
    scores = JSON.parse(localStorage.getItem(SURVIVAL_SCORES_KEY)) || [];
  } catch {
    scores = [];
  }
  scores.push(entry);
  scores.sort((a, b) => b.years - a.years || b.cash - a.cash);
  bestScores = scores.slice(0, 5);
  finalRank = bestScores.indexOf(entry);
  try {
    localStorage.setItem(SURVIVAL_SCORES_KEY, JSON.stringify(bestScores));
  } catch {
    // private browsing etc: scores just aren't persisted
  }
}

// Offered on the bankruptcy screen: rather than starting over, the same
// farm — tractor, fields, calendar — carries on in sandbox mode, debt
// forgiven and no tax ever falling due again.
export function continueInSandbox() {
  setMode("sandbox");
  cash = SANDBOX_START_CASH;
  gameOver = false;
  taxFlash = 0;
  saveGame();
}

// Starting capital by mode: survival a buffer against the first tax bill,
// sandbox plenty
export let cash = modeStartCash(mode);
// Only this module may reassign `cash` (ESM imports are read-only
// bindings) - ladybug.js's find bonus calls this instead of `cash += x`.
export function addCash(amount) {
  cash += amount;
}
export let seeds = 0; // start empty: buy seeds at the farm
export let cargo = 0; // sacks on the trailer
export let sold = 0; // total sacks delivered to the city
export let fuel = FUEL_CAP; // start full
// Set once per frame in update(dt) and read again by the HUD in draw(), so
// each proximity check only runs its Math.hypot once a frame instead of once
// per reader
export let atFuelTank = false;
export let atCity = false;
export const sacks = []; // grain sacks lying on the fields

// Only this module may reassign `seeds` (ESM imports are read-only
// bindings) — ground.js's seedTileAt() calls this instead of `seeds--`.
export function consumeSeed() {
  seeds--;
}

// Restores the economy/calendar numbers from an autosave. Only this module
// may reassign cash/seeds/cargo/sold/fuel/year/propertyTax/timeLeft (ESM
// imports are read-only bindings) — the startup resume logic calls this
// instead of assigning each field directly.
export function loadSavedRun(s) {
  sacks.push(...s.sacks);
  cash = s.cash;
  seeds = s.seeds;
  cargo = s.cargo;
  sold = s.sold;
  fuel = s.fuel === undefined ? FUEL_CAP : s.fuel; // saves from before fuel existed: start full
  year = s.year;
  propertyTax = s.propertyTax;
  timeLeft = s.timeLeft;
  Object.assign(tractor, s.tractor);
}

export const tractor = {
  x: FARM.x + 34,
  y: FARM.y + 10,
  angle: -2.4, // facing up-left, toward the middle of the map
  speed: 0, // world units/s, positive = forward
  angVel: 0, // rad/s, ramps toward the steering target instead of snapping to it
  fastGear: true, // Space toggles road mode (fast, lifted) vs work mode (slow, lowered)
  implement: "plow", // current implement: plow / seeder / harvester / trailer
  implAngle: -2.4, // world heading of a towed implement (trails the hitch)
  implDown: false, // lowered together with the work gear (part of the mode toggle)
  implLift: 1, // animated: 0 = working the ground, 1 = fully raised
  implBounce: 0, // seconds left of the refused-lower dip animation
  implFlash: 0, // seconds left of the red HUD flash (implement complaint)
  workLane: null, // tile row/column the current pass is locked to (see field work)
};

// Top speeds lean toward history without fully committing to it: true
// pre-WW2 British tractor speeds (Ivel/Saunderson ~2-4mph in the field,
// even a late-1930s Fordson N's top road gear only ~8mph) played too
// slow to be fun once tried. These split the difference, about 2/3 of
// the way back from that historical pace toward the original arcade-y
// numbers (GEAR_FAST 42, GEAR_SLOW 16) — still noticeably more sedate
// than a modern tractor, just not a literal simulation. World-unit/mph
// conversion (for whoever retunes this again): derived from the tractor
// model's own proportions (TRACTOR_WHEELS' 3.0-unit rear wheel radius vs
// a real period wheel's ~0.68m, and the 9.5-unit wheelbase vs a real
// Fordson's ~2.03m, both agreeing on ~0.23m/unit, i.e. ~1.96 world
// units/s per mph) — so GEAR_FAST≈28 is ~14mph; GEAR_SLOW≈14 is ~7mph
// (nudged up from an initial ~5mph — felt too slow for fieldwork even
// after the road gear was judged right), both above the historical
// figures on purpose.
export const GEAR_FAST = 28; // ~14mph, top (road) gear
export const GEAR_SLOW = 14; // ~7mph, working (plow) gear
// Every other speed-coupled constant below (and in update()) is an
// expression in one of these two ratios, not a hand-rounded literal —
// ACCEL/BRAKE/FRICTION/accelRate/the slope-gravity coefficient/the
// exhaust-smoke threshold move with GEAR_FAST_RATIO; MOVING_THRESHOLD/
// the bogged-down cap/the crawl-stop threshold/the ladybug threshold/the
// animal spook-flee threshold move with GEAR_SLOW_RATIO. That way a
// future GEAR_FAST/GEAR_SLOW retune (this session did it three times)
// carries all of them along automatically instead of needing each one
// hand-recomputed and its "scaled by such-and-such ratio" comment
// re-verified — which is exactly how one of these already drifted once:
// an earlier pass's crawl-stop comment claimed an exact ratio that its
// hardcoded literal didn't actually match.
export const GEAR_FAST_RATIO = GEAR_FAST / 42; // 42 was the original GEAR_FAST
export const GEAR_SLOW_RATIO = GEAR_SLOW / 16; // 16 was the original GEAR_SLOW
export const ACCEL = 55 * GEAR_FAST_RATIO;
export const BRAKE = 80 * GEAR_FAST_RATIO;
export const FRICTION = 28 * GEAR_FAST_RATIO;
export const MAX_REVERSE = -GEAR_SLOW; // backing up is never faster than the work gear
// Shared "is the tractor meaningfully moving" gate — field work, the
// ground-work engine noise, and a couple of HUD warnings all use this
// rather than a bare 0 so a stopped-but-twitching tractor doesn't flicker
// them on and off. Gear-gated (all four call sites only apply while a
// lowered implement is engaged in work gear), so this tracks GEAR_SLOW —
// see ROLLING_THRESHOLD below for the one gear-agnostic "is it rolling at
// all" case that doesn't belong on this constant.
export const MOVING_THRESHOLD = 2 * GEAR_SLOW_RATIO;
// The driver's seat-bounce animation: unlike MOVING_THRESHOLD's four
// sites, this one isn't gated to work gear — it fires at any speed in
// either gear — so it tracks the gear-agnostic GEAR_FAST_RATIO instead of
// being lumped in with MOVING_THRESHOLD just because the two started out
// as the same bare number.
export const ROLLING_THRESHOLD = 2 * GEAR_FAST_RATIO;
// Fuel burn only applies while actually on the gas; coasting or sitting
// still is free. Road gear burns faster than a work-gear pass, giving the
// work-mode auto-throttle choice real stakes.
export const FUEL_BURN_WORK = 0.5; // fuel/s, work gear on the gas
export const FUEL_BURN_ROAD = 1.1; // fuel/s, road gear on the gas
// An empty tank never fully strands the tractor — it limps home at a
// fraction of its usual top speed instead of stopping dead. Left at its
// original (pre-rescale) value rather than scaled down with the gears —
// scaling it along with GEAR_SLOW made the limp speed feel painfully
// slow, and unlike normal driving there's no "it should feel heavy"
// case for it: running dry is already a punishing enough state on its
// own without also crawling.
export const FUEL_EMPTY_LIMP = 4;
// Fixed steering geometry: turn rate scales with speed, so the turning
// radius stays ~TURN_RADIUS at working speeds — tight enough to U-turn
// into the adjacent row (one tile = 16 units away).
export const TURN_RADIUS = 7; // world units
export const MAX_TURN_RATE = 2.5; // rad/s cap so the fast gear doesn't spin wildly
// Steering doesn't snap to its target rate — it ramps there at this
// angular acceleration instead, so turning in feels like leaning a heavy
// machine into a corner rather than an instant twitch. This only softens
// the *approach* to a turn; once angVel catches up to the target it holds
// steady there, so the sustained-turn radius stays ~TURN_RADIUS exactly
// as before (see steering below, in update()) — only the entry/exit of a
// turn gets slower, not the circle itself. Expressed as "reach full lock
// in about half a second" rather than a bare rad/s² figure so it stays
// sensible on its own if MAX_TURN_RATE (the ceiling it's ramping toward)
// ever changes — unlike the constants above, this one was never tied to
// GEAR_FAST/GEAR_SLOW in the first place, so it doesn't move with them.
export const STEER_RESPONSE = MAX_TURN_RATE / 0.5; // rad/s²

// Towed implements pivot at the drawbar pin and trail behind the tractor
export const HITCH_X = -7; // hitch pin position in tractor-local coords
export const MAX_HITCH_ANGLE = 1.6; // jackknife limit: the drawbar hits the wheel

// Frame the implement actually occupies: mounted implements share the
// tractor's frame; towed ones swing around the hitch with their own heading.
// The origin is placed so local (HITCH_X, 0) lands exactly on the hitch pin.
export function implementPose() {
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
export function implementOverField() {
  const pose = implementPose();
  const points = [
    [-9.8, -4],
    [-9.8, 0],
    [-9.8, 4],
    [-6, 0],
  ];
  for (const [lx, ly] of points) {
    const { x: wx, y: wy } = rotateLocal(pose.x, pose.y, pose.angle, lx, ly);
    const tt = tileTypeAt(wx, wy);
    if (tt >= 1 && tt <= 3) return true;
  }
  return false;
}

// Work mode drives itself at a steady crawl so both hands (or the one
// thumb steering on touch) are free to just steer the implement straight,
// instead of also holding the accelerator down the whole pass. The brake
// still overrides it. Road mode stays fully manual. Shared by the physics,
// engine sound and exhaust smoke so they all agree on when the tractor is
// "on the gas".
export function autoThrottling() {
  return (
    autoThrottleOn &&
    !tractor.fastGear &&
    !keys.ArrowDown &&
    !(touchDrive.throttleActive && touchDrive.throttle < -0.05)
  );
}

// Moves `current` toward `target`, capped at `maxDelta` per call — the
// "ramp toward a limit instead of snapping to it" shape both the tractor's
// speed-vs-gear-ceiling clamp and its steering ramp need (see update()).
// One expression handles both directions, so there's no if/else pair per
// call site that could drift out of sync with each other.
export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

// Undo the tractor's move for this frame and bring it to a hard stop —
// shared by every solid-obstacle collision check below (water, trees,
// buildings, fences, animals). A hard stop, not a coast: angVel is zeroed
// too so the tractor doesn't sit there spinning in place against the wall.
export function stopTractor(prevX, prevY) {
  tractor.x = prevX;
  tractor.y = prevY;
  tractor.speed = 0;
  tractor.angVel = 0;
}

export function update(dt) {
  if (paused) return;
  // Ambient life keeps moving even after the round ends
  worldTime += dt;
  updateSmoke(dt);
  updateButterflies(dt);
  updateAnimals(dt);
  updateHerds(dt);
  updateCart(dt);
  updateBirds(dt);
  updateLadybug(dt);
  updateSeason();
  if (!gameStarted || gameOver) return;

  // The year turns over at Dec 31 -> Jan 1
  timeLeft = Math.max(
    0,
    timeLeft - dt * (mode === "sandbox" ? sandboxClockRate() : 1)
  );
  if (timeLeft === 0) {
    if (mode === "survival" && !collectTax()) return;
    rollOverYear();
  }
  taxFlash = Math.max(0, taxFlash - dt);

  const imp = IMPLEMENTS[tractor.implement];

  // Shared across the phases below: applyThrottleAndGravity fills
  // cos/sin/throttleInput/brakeInput in, each read again by a later phase
  // (burnFuel's throttle check, moveTractor's cos/sin, checkCollisions'
  // prevX/prevY set by moveTractor).
  let cos, sin, throttleInput, brakeInput, prevX, prevY;

  // Throttle / brake (touch uses proportional input, keyboard stays digital)
  function applyThrottleAndGravity() {
  const touchThrottle = touchDrive.throttleActive ? touchDrive.throttle : 0;
  throttleInput = Math.max(
    keys.ArrowUp ? 1 : 0,
    touchThrottle > 0 ? touchThrottle : 0,
    autoThrottling() ? 1 : 0
  );
  brakeInput = Math.max(keys.ArrowDown ? 1 : 0, touchThrottle < 0 ? -touchThrottle : 0);
  if (throttleInput > 0) {
    tractor.speed += ACCEL * throttleInput * dt;
  } else if (brakeInput > 0) {
    tractor.speed -= BRAKE * brakeInput * dt;
  } else {
    // Roll to a stop
    if (tractor.speed > 0) tractor.speed = Math.max(0, tractor.speed - FRICTION * dt);
    else tractor.speed = Math.min(0, tractor.speed + FRICTION * dt);
  }
  // Gravity along the slope: uphill fights the engine, downhill helps.
  // Scaled with ACCEL/BRAKE/FRICTION (was a bare 60) — left at its old
  // strength it would now overpower the much weaker period engine on any
  // real hill, instead of just leaning on it the way it used to.
  cos = Math.cos(tractor.angle);
  sin = Math.sin(tractor.angle);
  const grade =
    (terrainHeight(tractor.x + cos * 4, tractor.y + sin * 4) -
      terrainHeight(tractor.x - cos * 4, tractor.y - sin * 4)) /
    8;
  tractor.speed -= grade * 60 * GEAR_FAST_RATIO * dt;

  // At a crawl with no throttle the tractor simply stops — otherwise slope
  // gravity keeps it creeping forever and the camera never settles
  if (throttleInput === 0 && brakeInput === 0 && Math.abs(tractor.speed) < 1.5 * GEAR_SLOW_RATIO) {
    tractor.speed = 0;
  }
  }
  applyThrottleAndGravity();

  // Burn fuel only while actually powering the wheels
  function burnFuel() {
  if (throttleInput > 0) {
    fuel = Math.max(
      0,
      fuel - (tractor.fastGear ? FUEL_BURN_ROAD : FUEL_BURN_WORK) * throttleInput * dt
    );
  }
  }
  burnFuel();

  // Top speed from the gear, further reduced by drag when working the ground
  function limitGearSpeed() {
  let maxForward =
    (tractor.fastGear ? GEAR_FAST : GEAR_SLOW) *
    (imp.liftable ? 1 - 0.35 * (1 - tractor.implLift) : 1);
  let maxReverse = MAX_REVERSE;

  // Running dry doesn't strand the tractor, just slows it to a limp
  if (fuel <= 0) {
    maxForward = Math.min(maxForward, FUEL_EMPTY_LIMP);
    maxReverse = Math.max(maxReverse, -FUEL_EMPTY_LIMP);
  }

  // Packed dirt roads are ~30% faster than driving across the meadows
  if (roadTiles.has(tileKey(tractor.x, tractor.y))) maxForward *= 1.3;

  const accelRate = 120 * GEAR_FAST_RATIO;

  // A lowered implement digging into unbroken ground bogs the tractor down
  if (imp.liftable && tractor.implLift < 0.5 && !implementOverField()) {
    maxForward = 3 * GEAR_SLOW_RATIO;
    maxReverse = -3 * GEAR_SLOW_RATIO;
  }

  if (tractor.speed > maxForward) tractor.speed = approach(tractor.speed, maxForward, accelRate * dt);
  if (tractor.speed < maxReverse) tractor.speed = approach(tractor.speed, maxReverse, accelRate * dt);
  }
  limitGearSpeed();

  // Steering only has effect while moving; reversing flips it like a real vehicle
  function applySteering() {
  const turnRate =
    Math.min(Math.abs(tractor.speed) / TURN_RADIUS, MAX_TURN_RATE) *
    Math.sign(tractor.speed);
  const steeringInput = touchDrive.steeringActive
    ? touchDrive.steering
    : (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  // Ramp toward the target rate rather than snapping to it (see
  // STEER_RESPONSE) — the sustained-turn radius is unchanged, only how
  // briskly the tractor winds up to and out of it.
  const targetAngVel = turnRate * steeringInput;
  tractor.angVel = approach(tractor.angVel, targetAngVel, STEER_RESPONSE * dt);
  tractor.angle += tractor.angVel * dt;
  }
  applySteering();

  // Move on the ground plane
  function moveTractor() {
  prevX = tractor.x;
  prevY = tractor.y;
  tractor.x += cos * tractor.speed * dt;
  tractor.y += sin * tractor.speed * dt;

  // Keep on the map
  const margin = 12;
  tractor.x = clamp(tractor.x, margin, MAP_SIZE - margin);
  tractor.y = clamp(tractor.y, margin, MAP_SIZE - margin);
  }
  moveTractor();

  function checkCollisions() {
  // Water blocks the tractor, except where a road bridges it
  if (
    tileTypeAt(tractor.x, tractor.y) === 4 &&
    !roadTiles.has(tileKey(tractor.x, tractor.y))
  ) {
    stopTractor(prevX, prevY);
  }

  // Trees are solid trunks: driving into one stops the tractor dead, same
  // as water. Only the tractor's own tile and its ring of neighbors are
  // checked (TREE_COLLIDE_R never reaches a second tile out).
  const TREE_COLLIDE_R = 4.5;
  const ttx = (tractor.x / TILE) | 0;
  const tty = (tractor.y / TILE) | 0;
  outer: for (let ny = Math.max(0, tty - 1); ny <= Math.min(MAP_TILES - 1, tty + 1); ny++)
    for (let nx = Math.max(0, ttx - 1); nx <= Math.min(MAP_TILES - 1, ttx + 1); nx++) {
      const list = treesByTile.get(ny * MAP_TILES + nx);
      if (!list) continue;
      for (const t of list) {
        if (Math.hypot(t.wx - tractor.x, t.wy - tractor.y) < TREE_COLLIDE_R) {
          stopTractor(prevX, prevY);
          break outer;
        }
      }
    }

  // Farm buildings are solid too: driving into a wall stops the tractor
  // dead, same as a tree. FARM_SOLID_WORLD (see its definition) covers just
  // the load-bearing walls, expanded by a small margin so the tractor can't
  // clip in right up to the very wall line before stopping.
  const BUILDING_COLLIDE_MARGIN = 2;
  for (const b of FARM_SOLID_WORLD) {
    if (
      tractor.x > b.x0 - BUILDING_COLLIDE_MARGIN &&
      tractor.x < b.x1 + BUILDING_COLLIDE_MARGIN &&
      tractor.y > b.y0 - BUILDING_COLLIDE_MARGIN &&
      tractor.y < b.y1 + BUILDING_COLLIDE_MARGIN
    ) {
      stopTractor(prevX, prevY);
      break;
    }
  }

  // Paddock fences stop the tractor too, but only the rail line itself —
  // FENCE_SOLID_WORLD is a ring of thin strips, not a solid block, so the
  // pasture inside stays open ground the tractor just can't reach.
  for (const b of FENCE_SOLID_WORLD) {
    if (tractor.x > b.x0 && tractor.x < b.x1 && tractor.y > b.y0 && tractor.y < b.y1) {
      stopTractor(prevX, prevY);
      break;
    }
  }

  // Cows, sheep and pigs are solid: drive into one and the tractor stops
  // until it has plodded aside (they walk clear of a nearby tractor on
  // their own). Only blocked while closing in, so backing away always works.
  for (const an of animals) {
    if (an.species !== "cow" && an.species !== "sheep" && an.species !== "pig") continue;
    const dNew = Math.hypot(an.wx - tractor.x, an.wy - tractor.y);
    if (dNew < 6.5 && dNew < Math.hypot(an.wx - prevX, an.wy - prevY)) {
      stopTractor(prevX, prevY);
      break;
    }
  }
  }
  checkCollisions();

  // A towed implement's wheels roll rather than skid, so the hitch's
  // sideways motion swings its heading toward the tractor's over time
  function updateHitchAndLift() {
  if (imp.towed) {
    let rel = tractor.angle - tractor.implAngle;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel)); // wrap to (-pi, pi]
    rel -=
      ((tractor.speed * Math.sin(rel) + HITCH_X * tractor.angVel * Math.cos(rel)) /
        imp.towLength) *
      dt;
    rel = clamp(rel, -MAX_HITCH_ANGLE, MAX_HITCH_ANGLE);
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
  tractor.implFlash = Math.max(0, tractor.implFlash - dt);
  }
  updateHitchAndLift();

  // Field work under the implement while it's down and moving. A pass is
  // locked to a single row of tiles: the lane is picked where work starts,
  // and the lock gates the work — wobbling over a tile boundary works
  // nothing (never the neighboring row, and never the locked row from a
  // distance, which would let a zigzag cover two rows in one pass). The
  // lock moves once the centerline is well inside a neighboring row, or
  // when the travel axis flips. Raising the implement ends the pass.
  function doFieldWork() {
  if (imp.liftable && tractor.implLift < 0.3 && Math.abs(tractor.speed) > MOVING_THRESHOLD) {
    const pose = implementPose();
    const pcos = Math.cos(pose.angle);
    const psin = Math.sin(pose.angle);
    const alongX = Math.abs(pcos) > Math.abs(psin);
    const wx = pose.x - 9.8 * pcos;
    const wy = pose.y - 9.8 * psin;
    const perp = alongX ? wy : wx;
    const lane = (perp / TILE) | 0;
    const lock = tractor.workLane;
    if (!lock || lock.alongX !== alongX) {
      tractor.workLane = { alongX, lane };
    } else if (lane !== lock.lane) {
      const past =
        lane > lock.lane ? perp - (lock.lane + 1) * TILE : lock.lane * TILE - perp;
      // The lock moves sooner the straighter the heading: a calm drift into
      // the next row is deliberate, while a swinging heading is a zigzag
      // trying to stitch two rows and gets the full stickiness.
      const sway = Math.abs(alongX ? psin : pcos);
      if (past > 1.5 + Math.min(20 * sway, 8)) tractor.workLane = { alongX, lane };
    }
    if (tractor.workLane.lane === lane) {
      if (tractor.implement === "plow") plowTileAt(wx, wy, alongX);
      else if (tractor.implement === "seeder") seedTileAt(wx, wy);
      else if (tractor.implement === "harvester") harvestTileAt(wx, wy);
    }
  } else if (tractor.implLift >= 0.3) {
    tractor.workLane = null;
  }
  }
  doFieldWork();

  // The trailer scoops up grain sacks it passes over — only in work mode,
  // same as the other implements needing their gear down to do their job.
  // The trailer has no lift of its own to gate this on (it's not
  // liftable), so without this it would scoop just as well at road-gear
  // speed, sacks flying into the bed at 40+.
  function pickUpTrailerSacks() {
  if (tractor.implement === "trailer" && !tractor.fastGear) {
    const pose = implementPose();
    const bx = pose.x - 16 * Math.cos(pose.angle);
    const by = pose.y - 16 * Math.sin(pose.angle);
    for (let i = sacks.length - 1; i >= 0 && cargo < TRAILER_CAP; i--) {
      if (Math.hypot(sacks[i].wx - bx, sacks[i].wy - by) < 9) {
        sacks.splice(i, 1);
        cargo++;
        playPickup();
      }
    }
  }
  }
  pickUpTrailerSacks();

  function handleRefuelAndTrading() {
  atFuelTank = nearFuelTank(tractor.x, tractor.y);
  atCity = nearCity();

  // Refueling happens only at the fuel tank, off in its own corner of the
  // yard, rather than anywhere in the broader farm radius — refueling costs
  // cash, so it shouldn't happen incidentally every time the player is at
  // the farm to sell grain or buy seed.
  if (atFuelTank && fuel < FUEL_CAP) {
    // Top up the tank with as many whole units as the cash covers (fuel
    // itself drains fractionally, cash never should); in survival the
    // farm sells fuel on credit down to the debt limit, same as seeds
    const budget = mode === "survival" ? cash + DEBT_LIMIT : cash;
    const bought = Math.min(Math.ceil(FUEL_CAP - fuel), Math.floor(budget / FUEL_PRICE));
    if (bought > 0) {
      fuel = Math.min(FUEL_CAP, fuel + bought);
      cash -= bought * FUEL_PRICE;
    }
  }

  // Farmyard services: seed purchase only — grain is sold at the city now,
  // not handed over on the spot where it was grown
  if (nearFarm(tractor.x, tractor.y)) {
    if (tractor.implement === "seeder" && seeds < SEED_CAP) {
      // Top up the hopper with as many seeds as the cash covers; in
      // survival the farm buys on credit down to the debt limit
      const budget = mode === "survival" ? cash + DEBT_LIMIT : cash;
      const bought = Math.min(SEED_CAP - seeds, Math.floor(budget / SEED_PRICE));
      if (bought > 0) {
        seeds += bought;
        cash -= bought * SEED_PRICE;
      }
    }
  }

  // City services: the depot pays out for a loaded trailer. The farm only
  // stores and dispatches grain now — the payoff is hauling it to market.
  if (atCity && tractor.implement === "trailer" && cargo > 0) {
    cash += cargo * SACK_PRICE;
    sold += cargo;
    cargo = 0;
    const pose = implementPose();
    spawnChaff(pose.x - 16 * Math.cos(pose.angle), pose.y - 16 * Math.sin(pose.angle));
    playSell();
  }
  }
  handleRefuelAndTrading();

  updateTracks(dt);
  updateCrops(
    mode === "sandbox" ? dt * sandboxClockRate() * SANDBOX_GROW_FACTOR : dt
  );

  // Periodic autosave so even a crash or hard reload loses only moments
  function triggerAutosave() {
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    saveGame();
  }
  }
  triggerAutosave();
}

