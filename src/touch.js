import { clamp, screenCanvas } from "./setup.js";
import { gameStarted } from "./rng.js";
import { audio, initAudio } from "./sound.js";
import { menuOpen, dateJump, autoThrottleOn } from "./input.js";
// tractor isn't split out yet (Tractor section) - a genuine circular
// import, safe because syncVisibility() only reads it once per animation
// frame, never at this module's own top level.
import { tractor } from "./legacy.js";

// ---------------------------------------------------------------------------
// Touch controls: on-screen buttons for phones/tablets (CSS shows them only
// on coarse, hover-less pointers). Every button just dispatches the same
// synthetic keyboard events the handlers above already process, so driving,
// menus and implement switching all work identically to keyboard input
// without a second code path to keep in sync.
// ---------------------------------------------------------------------------

export const touchDrive = {
  steering: 0, // -1..1 (left..right)
  throttle: 0, // -1..1 (reverse/brake..forward)
  steeringActive: false,
  throttleActive: false,
};

(function setupTouchControls() {
  const root = document.getElementById("touch-controls");
  if (!root) return;

  function fireKey(type, key) {
    initAudio(); // a touch is a user gesture too; unlocks audio the same way
    if (audio.ac.state === "suspended") audio.ac.resume();
    window.dispatchEvent(new KeyboardEvent(type, { key }));
  }

  // Tracked by pointerId (not just per-button) so a finger that slides off
  // a button, or a cancelled touch, can never leave a key stuck down.
  const activePointers = new Map();

  function release(pointerId) {
    const entry = activePointers.get(pointerId);
    if (!entry) return;
    activePointers.delete(pointerId);
    entry.btn.classList.remove("tbtn-active");
    fireKey("keyup", entry.key);
  }

  // Drive controls: two separate joysticks so right hand steers and left
  // hand controls the throttle.  Each joystick is constrained to a single
  // axis so the intention is always unambiguous.
  (function setupDriveJoysticks() {
    // axes: "horizontal" → ArrowLeft/ArrowRight  |  "vertical" → ArrowUp/ArrowDown
    function setupJoystickElement(baseId, knobId, axes, deadzone = 0.35) {
      const base = document.getElementById(baseId);
      const knob = document.getElementById(knobId);
      if (!base || !knob) return;
      const axisSize = axes === "horizontal" ? base.clientWidth : base.clientHeight;
      const RADIUS = Math.max(40, axisSize * 0.3); // px the knob can travel from centre
      const DEADZONE = deadzone; // fraction of RADIUS before an axis engages
      let pointerId = null;
      const dir = axes === "horizontal"
        ? { ArrowLeft: false, ArrowRight: false }
        : { ArrowUp: false, ArrowDown: false };

      function setDir(key, on) {
        if (dir[key] === on) return;
        dir[key] = on;
        fireKey(on ? "keydown" : "keyup", key);
      }

      function resetAll() {
        for (const key of Object.keys(dir)) setDir(key, false);
        knob.style.transform = "translate(0, 0)";
        if (axes === "horizontal") {
          touchDrive.steering = 0;
          touchDrive.steeringActive = false;
        } else {
          touchDrive.throttle = 0;
          touchDrive.throttleActive = false;
        }
      }

      function handleMove(e) {
        const rect = base.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const applyDeadzone = (v) => {
          const av = Math.abs(v);
          if (av <= DEADZONE) return 0;
          return ((av - DEADZONE) / (1 - DEADZONE)) * Math.sign(v);
        };
        if (axes === "horizontal") {
          const nxRaw = clamp(dx / RADIUS, -1, 1);
          const cx = nxRaw * RADIUS;
          knob.style.transform = `translate(${cx}px, 0)`;
          const steering = applyDeadzone(nxRaw);
          touchDrive.steering = steering;
          touchDrive.steeringActive = true;
          setDir("ArrowLeft", steering < 0);
          setDir("ArrowRight", steering > 0);
        } else {
          const nyRaw = clamp(dy / RADIUS, -1, 1);
          const cy = nyRaw * RADIUS;
          knob.style.transform = `translate(0, ${cy}px)`;
          const throttle = -applyDeadzone(nyRaw);
          touchDrive.throttle = throttle;
          touchDrive.throttleActive = true;
          setDir("ArrowUp", throttle > 0);
          setDir("ArrowDown", throttle < 0);
        }
      }

      base.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pointerId = e.pointerId;
        base.setPointerCapture(pointerId);
        initAudio();
        if (audio.ac.state === "suspended") audio.ac.resume();
        handleMove(e);
      });
      base.addEventListener("pointermove", (e) => {
        if (e.pointerId !== pointerId) return;
        handleMove(e);
      });
      function end(e) {
        if (pointerId === null || e.pointerId !== pointerId) return;
        pointerId = null;
        resetAll();
      }
      base.addEventListener("pointerup", end);
      base.addEventListener("pointercancel", end);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    }

    setupJoystickElement("td-joystick", "td-joystick-knob", "horizontal", 0.55); // steering (higher dead-zone → less twitchy)
    setupJoystickElement("td-throttle", "td-throttle-knob", "vertical");   // throttle
  })();

  root.querySelectorAll(".tbtn[data-key]").forEach((btn) => {
    const key = btn.dataset.key;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.classList.add("tbtn-active");
      activePointers.set(e.pointerId, { btn, key });
      fireKey("keydown", key);
    });
    btn.addEventListener("pointerup", (e) => release(e.pointerId));
    btn.addEventListener("pointercancel", (e) => release(e.pointerId));
    btn.addEventListener("pointerleave", (e) => release(e.pointerId));
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  window.addEventListener("pointerup", (e) => release(e.pointerId));
  window.addEventListener("pointercancel", (e) => release(e.pointerId));

  const fsBtn = document.getElementById("td-fullscreen");
  fsBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    initAudio();
    if (audio.ac.state === "suspended") audio.ac.resume();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (screenCanvas.requestFullscreen) {
      screenCanvas.requestFullscreen().catch(() => {});
    }
  });

  // The Enter button and the driving-only controls (gear/implements) are
  // shown or hidden depending on whether a menu or the date-jump field is
  // currently open, so idle buttons never sit in the way of the other mode.
  // The gear button also relabels itself to match the current mode (the
  // HUD's own "MODE: ROAD/WORK") instead of showing a static glyph, and
  // flashes the same way the HUD text does when a lower is refused.
  const spaceBtn = document.getElementById("td-space");
  const autoBtn = document.getElementById("td-auto");
  function syncVisibility() {
    const menuish = !gameStarted || menuOpen || dateJump !== null;
    document.body.classList.toggle("menu-mode", menuish);
    if (gameStarted) {
      const flash = tractor.implFlash > 0 && ((tractor.implFlash * 8) | 0) % 2 === 0;
      spaceBtn.textContent = tractor.fastGear ? "⬆ ROAD" : "⬇ WORK";
      spaceBtn.classList.toggle("tbtn-warn", flash);
      spaceBtn.setAttribute(
        "aria-label",
        tractor.fastGear ? "Lower implement, work mode" : "Raise implement, road mode"
      );
      autoBtn.classList.toggle("tbtn-off", !autoThrottleOn);
    }
    requestAnimationFrame(syncVisibility);
  }
  requestAnimationFrame(syncVisibility);
})();
