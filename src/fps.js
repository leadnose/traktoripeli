// ---------------------------------------------------------------------------
// FPS tracking (Shift+F toggles the on-screen readout)
// ---------------------------------------------------------------------------

export let fpsShown = false;
// Only this module may reassign fpsShown (ESM imports are read-only
// bindings) - input.js's handleGameplayKey() calls this instead.
export function setFpsShown(v) {
  fpsShown = v;
}

let fpsFrames = 0;
let fpsMs = 0;
export let fpsValue = 0;

// Frames averaged over half-second windows; called once per frame from
// the main loop with that frame's raw (uncapped) elapsed milliseconds.
export function updateFps(frameMs) {
  fpsFrames++;
  fpsMs += frameMs;
  if (fpsMs >= 500) {
    fpsValue = Math.round((fpsFrames * 1000) / fpsMs);
    fpsFrames = 0;
    fpsMs = 0;
  }
}
