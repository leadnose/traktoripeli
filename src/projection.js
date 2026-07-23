// ---------------------------------------------------------------------------
// Isometric projection (2:1, SimCity 2000 style)
// ---------------------------------------------------------------------------

// World: x/y on the ground plane, z up. One tile is TILE x TILE world units
// and projects to a 2*TILE wide, TILE tall diamond on screen.
export const TILE = 16;
export const MAP_TILES = 60;
export const MAP_SIZE = MAP_TILES * TILE;

export function projX(wx, wy) {
  return wx - wy;
}

export function projY(wx, wy, wz) {
  return (wx + wy) / 2 - (wz || 0);
}

// Rotate a local (lx, ly) point by a precomputed cos/sin pair — the inner
// step of rotateLocal(), split out so hot per-frame loops that already have
// cos/sin for their model's heading can reuse them across many points
// instead of recomputing Math.cos/Math.sin for each one.
export function rotateXY(cos, sin, lx, ly) {
  return { x: lx * cos - ly * sin, y: lx * sin + ly * cos };
}

// Rotate a local (lx, ly) point by angle and place it relative to an origin
// (ox, oy) — the common "local model point -> world position" transform
// used for fixtures, collision boxes and box-model corners alike.
export function rotateLocal(ox, oy, angle, lx, ly) {
  const p = rotateXY(Math.cos(angle), Math.sin(angle), lx, ly);
  return { x: ox + p.x, y: oy + p.y };
}
