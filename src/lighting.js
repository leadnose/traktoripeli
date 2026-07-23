// ---------------------------------------------------------------------------
// Shared lighting helpers
// ---------------------------------------------------------------------------

export const LIGHT = { x: 0.35, y: 0.6, z: 0.71 };

// Before shading, every base color is pulled a little toward warm cream and
// tilted away from blue, so the scene reads like inks printed on soft paper
// rather than raw screen color. Direct fills that skip lighting use
// shade(color, 1) to pick up the same treatment.
export const PAPER_MIX = 0.12;
export const PAPER = [246, 233, 205];
export const INK_GAIN = [1.03, 1.0, 0.93];

// Outline ink shared by the scene silhouettes and the map's boundary lines
export const INK = "#4a3827";

// Same ink, thinned out for the ground's own boundary lines so they read as
// soft creases in the paper rather than the heavier silhouette lines used
// elsewhere. The road/ditch rim gets its own, fainter still: stamps overlap
// along a path, so any tint there stacks up darker than a single tile edge.
export const MAP_INK = "rgba(74, 56, 39, 0.3)";
export const ROAD_INK = "rgba(74, 56, 39, 0.14)";

export const shadeCache = {};
export function shade(color, k) {
  const key = color + ((k * 100 + 0.5) | 0);
  if (shadeCache[key]) return shadeCache[key];
  const ch = (i) => {
    const v = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
    const p = (v * (1 - PAPER_MIX) + PAPER[i] * PAPER_MIX) * INK_GAIN[i];
    return Math.min(255, Math.round(p * k));
  };
  return (shadeCache[key] = `rgb(${ch(0)},${ch(1)},${ch(2)})`);
}

export const mixCache = {};
export function mixHex(a, b, t) {
  const key = a + b + ((t * 64) | 0);
  if (mixCache[key]) return mixCache[key];
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  let out = "#";
  for (const shift of [16, 8, 0]) {
    const v = Math.round(((va >> shift) & 255) * (1 - t) + ((vb >> shift) & 255) * t);
    out += v.toString(16).padStart(2, "0");
  }
  return (mixCache[key] = out);
}

// Lighten (amt > 0) or darken (amt < 0) a hex color toward white/black. Used
// to derive dot speckles, tiers, furrows and the like from a palette's few
// base tones instead of hand-authoring every shade per map.
export function tint(hex, amt) {
  return amt >= 0 ? mixHex(hex, "#ffffff", amt) : mixHex(hex, "#000000", -amt);
}

export function grassDotShades(base) {
  return [tint(base, -0.16), tint(base, 0.2), tint(base, 0.32), tint(base, -0.3)];
}

export function dirtDotShades(base) {
  return [tint(base, -0.16), tint(base, 0.16)];
}

// Warms a grass tone toward wildflower-meadow yellow-green, so meadows read
// as a distinct patch of a map's own grass rather than a separate hue
export function meadowTint(hex) {
  return mixHex(hex, "#ffe066", 0.35);
}

// Dries a dirt tone toward pale straw-gold, for stubble left standing after
// harvest but not yet plowed under — distinct from the darker turned-soil
// tone of a plowed or seeded tile, derived from the map's own dirt rather
// than a separate authored color
export function stubbleTint(hex) {
  return mixHex(hex, "#e6c85a", 0.5);
}

