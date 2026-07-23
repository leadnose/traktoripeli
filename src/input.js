import { MAP_INDEX, MODES, mode, gameStarted } from "./rng.js";
import { MAP_PROFILES } from "./map-profiles.js";
import { audio, initAudio, toggleMusic, toggleSound, playHydraulic, playClunk } from "./sound.js";
import { nearFarm } from "./farmyard.js";
import { IMPLEMENTS } from "./box-models.js";
// loadSave/clearSave (Save games), startGame/continueInSandbox/tryDateJump/
// gameOver/implementOverField (Tractor section), savingDisabled (Save
// games) and fpsShown (Main loop) aren't split out yet - genuine circular
// imports, safe because they're only read/called inside the keydown
// handlers, never at this module's own top level.
import {
  loadSave,
  clearSave,
  startGame,
  continueInSandbox,
  tryDateJump,
  gameOver,
  implementOverField,
  setSavingDisabled,
  fpsShown,
  setFpsShown,
  tractor,
} from "./legacy.js";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const keys = {};
export const IMPLEMENT_KEYS = { 1: "plow", 2: "seeder", 3: "harvester", 4: "trailer" };

// F1 opens the menu, the only place the map and mode can be picked. It is
// also the start menu: a fresh visit begins with it open and the clock held.
export let menuOpen = !gameStarted;
// P holds the whole world still — clock, crops, critters — until P again.
// Unlike the F1 menu, which leaves the calendar running, pause means pause.
export let paused = false;
// A toggles work mode's auto-throttle off and back on, for anyone who'd
// rather hold the accelerator themselves. On by default.
export let autoThrottleOn = true;
// D opens a little date field: type MMDD and Enter fast-forwards the
// calendar to that date — into next year if it's already passed, in the
// cyclical modes — growing crops and collecting taxes on the way, exactly
// like the away clock would.
export let dateJump = null; // null = closed, else the digits typed so far
export let dateJumpError = false; // the last Enter was an impossible or past date
export let menuMap = 1; // the start menu defaults to map 1; R rolls a random one
export let menuMode = mode;

// Only this module may reassign these (ESM imports are read-only bindings)
// - startGame() sets menuOpen/paused, tryDateJump() sets dateJump/
// dateJumpError, both still in legacy.js until tractor.js exists.
export function setMenuOpen(v) {
  menuOpen = v;
}
export function setPaused(v) {
  paused = v;
}
export function setDateJump(v) {
  dateJump = v;
}
export function setDateJumpError(v) {
  dateJumpError = v;
}
// The autosave the menu offers to continue, read once when the menu opens
// (parsing the save JSON every drawn frame would be wasteful)
export let menuSaveInfo = null;
// Only this module may reassign menuSaveInfo (ESM imports are read-only
// bindings) - main.js calls this instead of assigning directly.
export function refreshMenuSaveInfo() {
  if (menuOpen) menuSaveInfo = loadSave();
}

// Away clock, toggled in the menu: rAF stops in a hidden tab, so normally
// game time freezes there. With this on, the lost time is applied in one
// catch-up step on return — crops grow, the calendar turns, taxes fall due.
const AWAY_CLOCK_KEY = "traktoripeli.awayclock";
export let awayClock = false;
try {
  awayClock = localStorage.getItem(AWAY_CLOCK_KEY) === "1";
} catch {
  // private browsing etc: the option just isn't persisted
}

window.addEventListener("keydown", (e) => {
  // Browsers only allow audio after a user gesture
  initAudio();
  if (audio.ac.state === "suspended") audio.ac.resume();
  if (e.key === "F1" && !e.repeat) {
    e.preventDefault();
    if (!gameStarted) return; // the start menu stays until a mode is picked
    menuOpen = !menuOpen;
    dateJump = null; // one sign at a time
    menuMap = MAP_INDEX; // mid-game the field opens on the current map
    menuMode = mode;
    if (menuOpen) menuSaveInfo = loadSave();
    return;
  }
  if (gameOver && !menuOpen && (e.key === "s" || e.key === "S") && !e.repeat) {
    continueInSandbox();
    return;
  }
  if (menuOpen) {
    handleMenuKey(e);
    return;
  }
  if (dateJump !== null) {
    handleDateJumpKey(e);
    return;
  }
  handleGameplayKey(e);
});

// The menu swallows all input: left/right pick the map, up/down pick
// the mode, digits jump straight to a map, R rolls a random one, Enter
// starts, Esc closes (once a game is running)
function handleMenuKey(e) {
  e.preventDefault();
  if (e.key === "Enter") {
    clearSave(); // Enter always begins a fresh run
    if (!gameStarted && menuMap === MAP_INDEX) {
      // Same map as the one already generated: start without a reload
      startGame(menuMode);
    } else {
      // The reload's pagehide must not re-save the run just discarded
      setSavingDisabled(true);
      location.search = `?map=${menuMap}&mode=${menuMode}`;
    }
  } else if (e.key === "c" || e.key === "C") {
    // Continue the autosaved run: reloading with its map and mode in
    // the URL restores the save at boot
    if (menuSaveInfo)
      location.search = `?map=${menuSaveInfo.map}&mode=${menuSaveInfo.mode}`;
  } else if (e.key === "r" || e.key === "R") {
    menuMap = 1 + ((Math.random() * MAP_PROFILES.length) | 0);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const dir = e.key === "ArrowDown" ? 1 : -1;
    menuMode = MODES[(MODES.indexOf(menuMode) + dir + MODES.length) % MODES.length];
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const dir = e.key === "ArrowRight" ? 1 : -1;
    menuMap = ((menuMap - 1 + dir + MAP_PROFILES.length) % MAP_PROFILES.length) + 1;
  } else if ((e.key === "t" || e.key === "T") && !e.repeat) {
    awayClock = !awayClock;
    try {
      localStorage.setItem(AWAY_CLOCK_KEY, awayClock ? "1" : "0");
    } catch {
      // not persisted, still applies to this session
    }
  } else if ((e.key === "m" || e.key === "M") && !e.repeat) {
    toggleMusic();
  } else if ((e.key === "q" || e.key === "Q") && !e.repeat) {
    toggleSound();
  } else if (e.key === "Escape") {
    if (gameStarted) menuOpen = false;
  } else if (/^[0-9]$/.test(e.key)) {
    // 1-9 jump straight to that map, 0 is map 10
    const n = e.key === "0" ? 10 : parseInt(e.key, 10);
    if (n <= MAP_PROFILES.length) menuMap = n;
  }
}

// The date-jump field swallows all input while it is open: type the
// digits of MMDD, Enter jumps, Esc (or D again) closes
function handleDateJumpKey(e) {
  e.preventDefault();
  if (e.key === "Enter") {
    tryDateJump();
  } else if (e.key === "Escape" || e.key === "d" || e.key === "D") {
    dateJump = null;
  } else if (e.key === "Backspace") {
    dateJump = dateJump.slice(0, -1);
    dateJumpError = false;
  } else if (/^[0-9]$/.test(e.key) && dateJump.length < 4) {
    dateJump += e.key;
    dateJumpError = false;
  }
}

function handleGameplayKey(e) {
  if (e.key.startsWith("Arrow")) e.preventDefault();
  keys[e.key] = true;
  if ((e.key === "m" || e.key === "M") && !e.repeat) toggleMusic();
  if ((e.key === "q" || e.key === "Q") && !e.repeat) toggleSound();
  if ((e.key === "f" || e.key === "F") && !e.repeat) setFpsShown(!fpsShown);
  if ((e.key === "p" || e.key === "P") && !e.repeat && gameStarted && !gameOver)
    paused = !paused;
  if (paused) return; // the frozen world ignores gear and implement keys
  if ((e.key === "a" || e.key === "A") && !e.repeat && gameStarted && !gameOver) {
    autoThrottleOn = !autoThrottleOn;
  }
  if ((e.key === "d" || e.key === "D") && !e.repeat && gameStarted && !gameOver) {
    dateJump = "";
    dateJumpError = false;
    return;
  }
  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    // One toggle for the whole maneuver: road mode is the fast gear with the
    // implement raised, work mode the slow gear with it lowered
    const imp = IMPLEMENTS[tractor.implement];
    if (tractor.fastGear) {
      tractor.fastGear = false;
      if (imp.liftable) {
        // Lowering needs field dirt under the working width
        if (!implementOverField()) {
          tractor.implBounce = 0.6; // it tries, catches, and springs back up
        } else {
          tractor.implDown = true;
          tractor.implBounce = 0;
        }
        playHydraulic(true);
      }
    } else {
      // Lift before shifting up
      tractor.fastGear = true;
      if (tractor.implDown) {
        tractor.implDown = false;
        playHydraulic(false);
      }
    }
  }
  if (IMPLEMENT_KEYS[e.key] && !e.repeat) {
    // Implements are swapped at the farmyard
    if (nearFarm()) {
      if (tractor.implement !== IMPLEMENT_KEYS[e.key]) {
        tractor.implement = IMPLEMENT_KEYS[e.key];
        tractor.implDown = false;
        tractor.implLift = 1;
        playClunk();
      }
    } else {
      tractor.implFlash = 0.9;
    }
  }
}

window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});
