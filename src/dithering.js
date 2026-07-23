// ---------------------------------------------------------------------------
// Ordered dithering: posterize colors to coarse levels and dither between
// them with a Bayer matrix, the classic pixel-art way to draw gradients.
// ---------------------------------------------------------------------------

export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const DITHER_STEP = 24; // size of one posterized color level

export function ditherRegion(c2d, x, y, w, h) {
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(c2d.canvas.width - x, Math.ceil(w));
  h = Math.min(c2d.canvas.height - y, Math.ceil(h));
  if (w <= 0 || h <= 0) return;
  const img = c2d.getImageData(x, y, w, h);
  const data = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (data[i + 3] === 0) continue;
      // Threshold from the absolute canvas position, so re-dithering a
      // repainted region is stable and lines up with its surroundings
      const t = ((BAYER[(y + py) & 3][(x + px) & 3] + 0.5) / 16) * DITHER_STEP;
      for (let ch = 0; ch < 3; ch++) {
        const v = data[i + ch];
        const base = Math.floor(v / DITHER_STEP) * DITHER_STEP;
        data[i + ch] = Math.min(255, base + (v - base > t ? DITHER_STEP : 0));
      }
    }
  }
  c2d.putImageData(img, x, y);
}
