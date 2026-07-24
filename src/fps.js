// ---------------------------------------------------------------------------
// FPS tracking (Shift+F toggles the on-screen readout)
// ---------------------------------------------------------------------------

let fpsShown = false;
// Kept as a setter so this file stays the one place fpsShown is
// declared - input.js's handleGameplayKey() calls this instead.
function setFpsShown(v) {
  fpsShown = v;
}

let fpsFrames = 0;
let fpsMs = 0;
let fpsValue = 0;

// Frames averaged over half-second windows; called once per frame from
// the main loop with that frame's raw (uncapped) elapsed milliseconds.
function updateFps(frameMs) {
  fpsFrames++;
  fpsMs += frameMs;
  if (fpsMs >= 500) {
    fpsValue = Math.round((fpsFrames * 1000) / fpsMs);
    fpsFrames = 0;
    fpsMs = 0;
  }
}
