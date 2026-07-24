import { rotateLocal } from "./projection.js";
import {
  FARM,
  FARM_BUILDING_FOOTPRINTS,
  FUEL_TANK_LOCAL,
  FUEL_TANK_LEN,
  FUEL_TANK_R,
  FUEL_TANK_STAND_H,
  PADDOCKS_LOCAL,
} from "./farmyard.js";
// cargo/TRAILER_CAP aren't split out yet (Tractor section) - a genuine
// circular import, safe because trailerBoxes() only reads them when
// called at runtime (from drawScene, once per frame), never at this
// module's own top level.
import { cargo, TRAILER_CAP } from "./tractor.js";

// ---------------------------------------------------------------------------
// Box models: everything solid is axis-aligned boxes in local space
// (+x = forward, z = up), rotated around z and projected each frame.
// ---------------------------------------------------------------------------

export const TIRE = "#33363d";
export const HUB = "#a3874f";

// Styled after the old workhorse of the farmyard: dull grey-green
// bodywork riding on flint-gray running gear, a hood tapering into the
// grille, a bare pan seat between flat fenders, and a muffler halfway up
// the stack
export const TRACTOR_BODY = "#5c6b4f";

export const BOXES = [
  { x0: -7.0, x1: -3.4, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // frame rail, rear run
  { x0: -3.4, x1: -0.6, y0: -1.6, y1: 1.6, z0: 2.5, z1: 5.2, color: "#6e6e6e" }, // gearbox hump amidships, one higher
  { x0: -0.6, x1: 3.0, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // frame rail, front run
  { x0: -7.0, x1: -3.4, y0: -3.0, y1: 3.0, z0: 4.2, z1: 6.0, color: TRACTOR_BODY }, // body platform, rear
  { x0: -3.4, x1: -0.6, y0: -3.0, y1: 3.0, z0: 5.2, z1: 6.0, color: TRACTOR_BODY }, // body platform, thinner over the hump
  { x0: -0.6, x1: 3.0, y0: -3.0, y1: 3.0, z0: 4.2, z1: 6.0, color: TRACTOR_BODY }, // body platform, front
  { x0: -5.0, x1: -4.0, y0: -2.9, y1: 2.9, z0: 2.6, z1: 3.4, color: "#6e6e6e" }, // rear axle out to the big wheels
  { x0: 4.6, x1: 5.4, y0: -2.2, y1: 2.2, z0: 1.4, z1: 2.5, color: "#6e6e6e" }, // front axle under the engine
  { x0: 3.0, x1: 6.2, y0: -1.6, y1: 1.6, z0: 2.5, z1: 4.2, color: "#6e6e6e" }, // engine block, exposed at the sides
  { x0: 3.0, x1: 4.8, y0: -2.2, y1: 2.2, z0: 4.2, z1: 5.3, color: TRACTOR_BODY }, // hood lid, rear half
  { x0: 4.8, x1: 6.2, y0: -1.9, y1: 1.9, z0: 4.2, z1: 5.1, color: TRACTOR_BODY }, // hood lid tapering toward the front
  { x0: 6.2, x1: 7.0, y0: -1.5, y1: 1.5, z0: 2.5, z1: 4.3, color: "#454a3c" }, // nose, stepped down for a snub front
  { x0: 7.0, x1: 7.4, y0: -1.3, y1: 1.3, z0: 2.6, z1: 4.1, color: "#4a4238" }, // radiator grille
  { x0: -7.9, x1: -7.0, y0: -0.8, y1: 0.8, z0: 2.8, z1: 3.9, color: "#6b6b6b" }, // hitch block; implement drawbars butt against it
  { x0: -6.2, x1: -2.8, y0: 3.0, y1: 5.4, z0: 6.0, z1: 6.7, color: TRACTOR_BODY }, // rear fender L
  { x0: -6.2, x1: -2.8, y0: -5.4, y1: -3.0, z0: 6.0, z1: 6.7, color: TRACTOR_BODY }, // rear fender R
  { x0: -4.5, x1: -3.1, y0: -1.1, y1: 1.1, z0: 6.1, z1: 6.7, color: "#6e6e6e" }, // bare pan seat between the fenders
  { x0: -2.45, x1: -2.05, y0: -0.25, y1: 0.25, z0: 5.2, z1: 7.3, color: "#4c443c" }, // steering column off the gearbox hump
  { x0: 1.5, x1: 2.5, y0: -0.5, y1: 0.5, z0: 5.3, z1: 6.4, color: "#7a7a7a" }, // exhaust riser
  { x0: 1.3, x1: 2.7, y0: -0.7, y1: 0.7, z0: 6.4, z1: 8.2, color: "#8f8f8f" }, // muffler can
  { x0: 1.7, x1: 2.3, y0: -0.35, y1: 0.35, z0: 8.2, z1: 9.7, color: "#7a7a7a" }, // tailpipe
];

// Wheels are round: a disc on each face plus a slim inset box for the tread.
// x/z is the axle center, r the tire radius, y0..y1 the width. The rear
// pair is outsized on purpose — their tops sit level with the chassis top.
export const TRACTOR_WHEELS = [
  { x: -4.5, y0: 3.0, y1: 5.3, z: 3.0, r: 3.0 }, // rear L
  { x: -4.5, y0: -5.3, y1: -3.0, z: 3.0, r: 3.0 }, // rear R
  { x: 5.0, y0: 2.3, y1: 3.9, z: 1.6, r: 1.6 }, // front L
  { x: 5.0, y0: -3.9, y1: -2.3, z: 1.6, r: 1.6 }, // front R
];

// Round details: the steering wheel ahead of the seat and two headlamps
// perched on the nose. Their depth against the body swaps naturally with
// the heading — the wheel sits in front of the driver toward the camera and
// hides behind him driving away; the far-side lamp ducks behind the hood.
export const TRACTOR_SHAPES = [
  { blob: true, x: -2.2, y: 0, z: 7.5, r: 0.7, color: "#33363d" }, // steering wheel atop its column
  { blob: true, x: 6.6, y: 1.2, z: 4.65, r: 0.45, color: "#ffe66b" }, // headlamp L
  { blob: true, x: 6.6, y: -1.2, z: 4.65, r: 0.45, color: "#ffe66b" }, // headlamp R
];

// The driver: a round little figure out in the open on the seat. All parts
// stack at one local depth center (x -3.7, y 0) with rising z, so their
// paint order — overalls, head, straw hat — holds at every heading.
// `rest` is the seated height; z gets a bounce added per frame.
export const DRIVER_SHAPES = [
  { blob: true, x: -3.7, y: 0, rest: 7.3, z: 7.3, r: 1.5, color: "#4a6fa5" }, // overalls
  { blob: true, x: -3.7, y: 0, rest: 8.9, z: 8.9, r: 1.0, color: "#f2c091" }, // head
  { blob: true, x: -3.7, y: 0, rest: 9.65, z: 9.65, r: 0.8, color: "#e8b13d", bias: 0.05 }, // straw hat
];

// Implements hang behind the tractor; liftable ones get a z offset from the
// hydraulic lift so they can be raised for transport and dropped to work.
export const IMPLEMENT_LIFT_HEIGHT = 3.5;

export const PLOW_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.2, x1: -8.8, y0: -4.6, y1: 4.6, z0: 3.4, z1: 4.6, color: "#7a3226" }, // beam
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  PLOW_BOXES.push({
    x0: -10.6, x1: -9.4, y0: yc - 0.55, y1: yc + 0.55, z0: 0.3, z1: 3.4,
    color: "#54565a", // tine
  });
}

export const SEEDER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -10.4, x1: -8.6, y0: -4.6, y1: 4.6, z0: 3.2, z1: 4.4, color: "#8a6a3a" }, // frame
  { x0: -10.2, x1: -8.8, y0: -3.9, y1: -1.7, z0: 4.4, z1: 6.4, color: "#c9a24a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: -1.1, y1: 1.1, z0: 4.4, z1: 6.4, color: "#c9a24a" }, // hopper
  { x0: -10.2, x1: -8.8, y0: 1.7, y1: 3.9, z0: 4.4, z1: 6.4, color: "#c9a24a" }, // hopper
];
for (const yc of [-3.4, -1.1, 1.2, 3.5]) {
  SEEDER_BOXES.push({
    x0: -10.0, x1: -9.2, y0: yc - 0.35, y1: yc + 0.35, z0: 0.6, z1: 3.2,
    color: "#54565a", // coulter disc
  });
}

export const HARVESTER_BOXES = [
  { x0: -8.6, x1: -7.2, y0: -0.9, y1: 0.9, z0: 3.2, z1: 4.2, color: "#6b6b6b" }, // drawbar
  { x0: -13.0, x1: -8.6, y0: -4.8, y1: 4.8, z0: 2.2, z1: 8.0, color: "#5a7a4a" }, // body
  { x0: -12.4, x1: -11.2, y0: -4.2, y1: 4.2, z0: 8.0, z1: 9.4, color: "#3f5a38" }, // grain tank
  { x0: -8.6, x1: -7.4, y0: -4.8, y1: 4.8, z0: 0.4, z1: 2.6, color: "#7a3226" }, // header reel
];

export const HARVESTER_WHEELS = [
  { x: -11.0, y0: 4.8, y1: 6.0, z: 1.8, r: 1.8 }, // wheel L
  { x: -11.0, y0: -6.0, y1: -4.8, z: 1.8, r: 1.8 }, // wheel R
];

export const TRAILER_BOXES = [
  { x0: -11.5, x1: -7.0, y0: -0.7, y1: 0.7, z0: 2.6, z1: 3.6, color: "#6b6b6b" }, // long drawbar
  { x0: -21.0, x1: -11.5, y0: -4.2, y1: 4.2, z0: 3.0, z1: 7.0, color: "#9a7442" }, // wooden bed
];
// Tandem axles: two pairs of wheels under the rear half of the bed
export const TRAILER_WHEELS = [];
for (const wx of [-15.2, -18.6]) {
  TRAILER_WHEELS.push(
    { x: wx, y0: 4.2, y1: 5.4, z: 1.7, r: 1.7 }, // wheel L
    { x: wx, y0: -5.4, y1: -4.2, z: 1.7, r: 1.7 } // wheel R
  );
}

// Floor slots for hay bales: one row against the front wall, one against the
// back, ordered so loading starts in the near corner and fills outward along
// that wall before starting the far row.
export const BALE_POS = [];
for (const y of [-1.7, 1.7])
  for (const x of [-18.95, -16.25, -13.55]) BALE_POS.push({ x, y });
export const BALE_XH = 1.15;
export const BALE_YH = 1.5;
export const BALE_H = 1.3;
export const BALE_LAYER_GAP = 0.15;
export const BALE_COLORS = ["#d8ab52", "#c89a44"]; // alternating straw tones so bales read as distinct blocks

export function trailerBoxes() {
  if (cargo === 0) return TRAILER_BOXES;
  const full = cargo === TRAILER_CAP;
  const bales = [];
  for (let i = 0; i < cargo; i++) {
    const layer = Math.floor(i / BALE_POS.length);
    const p = BALE_POS[i % BALE_POS.length];
    const z0 = 7.0 + layer * (BALE_H + BALE_LAYER_GAP);
    // Full load sits a shade brighter so it reads as "done" without flashing
    const color = full ? "#f2c46a" : BALE_COLORS[i % BALE_COLORS.length];
    bales.push({
      x0: p.x - BALE_XH, x1: p.x + BALE_XH,
      y0: p.y - BALE_YH, y1: p.y + BALE_YH,
      z0, z1: z0 + BALE_H,
      color,
    });
  }
  return TRAILER_BOXES.concat(bales);
}

// Mounted implements (3-point hitch) turn rigidly with the tractor; towed
// ones ride on their own wheels and pivot at the drawbar pin.
export const IMPLEMENTS = {
  plow: { label: "PLOW", liftable: true, boxes: () => PLOW_BOXES, wheels: [] },
  seeder: { label: "SEEDER", liftable: true, boxes: () => SEEDER_BOXES, wheels: [] },
  harvester: { label: "HARVESTER", liftable: true, towed: true, towLength: 4.5, boxes: () => HARVESTER_BOXES, wheels: HARVESTER_WHEELS },
  trailer: { label: "TRAILER", liftable: false, towed: true, towLength: 9.9, boxes: trailerBoxes, wheels: TRAILER_WHEELS },
};

// Farm buildings, local to FARM
// A straight post-and-rail run from (x0,y0) to (x1,y1) — axis-aligned only
// (either x0===x1 or y0===y1), which is all the farmyard's fence lines need.
// Posts every ~3 units; rails are built as one short segment per post
// interval rather than a single box spanning the whole run. Each box's
// world height comes from sampling terrainHeight at its own corners (see
// makeItems' local()), so a single long rail box only samples the run's
// two far ends and draws a dead-straight line between them — over a long
// run on real (unflattened) ground that visibly mismatches the posts,
// which each follow their own local terrain, making the fence look like
// it randomly changes height wherever the two disagree. Short segments
// keep the rail sampling the ground about as often as the posts do, so
// it actually hugs the same contour instead of floating over or sinking
// into it between them.
export function addFenceRun(boxes, x0, y0, x1, y1, color) {
  const horizontal = y0 === y1;
  const len = horizontal ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
  const n = Math.max(1, Math.round(len / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    boxes.push({ x0: px - 0.3, x1: px + 0.3, y0: py - 0.3, y1: py + 0.3, z0: 0, z1: 2.6, color });
  }
  for (const [rz0, rz1] of [[1.1, 1.4], [2.0, 2.3]]) {
    for (let i = 0; i < n; i++) {
      const sx0 = x0 + (x1 - x0) * (i / n);
      const sy0 = y0 + (y1 - y0) * (i / n);
      const sx1 = x0 + (x1 - x0) * ((i + 1) / n);
      const sy1 = y0 + (y1 - y0) * ((i + 1) / n);
      boxes.push(
        horizontal
          ? { x0: Math.min(sx0, sx1), x1: Math.max(sx0, sx1), y0: y0 - 0.15, y1: y0 + 0.15, z0: rz0, z1: rz1, color }
          : { x0: x0 - 0.15, x1: x0 + 0.15, y0: Math.min(sy0, sy1), y1: Math.max(sy0, sy1), z0: rz0, z1: rz1, color }
      );
    }
  }
}

// A pitched roof over a wall footprint, built from two stacked tiers — a
// chunky eave course sized just like a plain flat roof, and a narrower
// ridge course riding on top of it. Two tiers rather than a finer taper
// (an earlier version used three, shrinking to a sliver at the top) reads
// as a proper roof at this game's scale; more/thinner tiers just blur
// into an odd lumpy silhouette instead of a crisp ridge line.
// `ridgeAxis` is the axis the ridge runs along (stays at the wall's own
// span, plus overhang); the other axis is the one that steps in for the
// ridge course.
export function addGableRoof(boxes, x0, x1, y0, y1, z0, z1, ridgeAxis, color, overhang) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const wallHalfX = (x1 - x0) / 2;
  const wallHalfY = (y1 - y0) / 2;
  const midZ = z0 + (z1 - z0) * 0.55;
  const tiers = [
    { f: 1.0, eave: overhang, tz0: z0, tz1: midZ }, // eave course, same footprint a flat roof would have
    { f: 0.4, eave: 0, tz0: midZ, tz1: z1 }, // ridge course
  ];
  for (const { f, eave, tz0, tz1 } of tiers) {
    if (ridgeAxis === "x") {
      const crossHalf = wallHalfY * f + eave;
      boxes.push({ x0: x0 - overhang, x1: x1 + overhang, y0: cy - crossHalf, y1: cy + crossHalf, z0: tz0, z1: tz1, color });
    } else {
      const crossHalf = wallHalfX * f + eave;
      boxes.push({ x0: cx - crossHalf, x1: cx + crossHalf, y0: y0 - overhang, y1: y1 + overhang, z0: tz0, z1: tz1, color });
    }
  }
}

export const FARM_BOXES = [
  { x0: -16.0, x1: 2.0, y0: -12.0, y1: 2.0, z0: 0.0, z1: 9.0, color: "#3d332a" }, // barn, tarred weatherboard
  { x0: -7.5, x1: -3.5, y0: 1.9, y1: 2.3, z0: 0.0, z1: 6.0, color: "#f7e8d8" }, // barn door, whitewashed
  // Farmhouse: pulled in close behind its own garden wall (below) rather
  // than set off across open grass — the wall marks house-from-yard, not
  // raw distance, so the whole place still reads as one farmstead.
  { x0: -13.0, x1: 1.0, y0: -30.0, y1: -16.0, z0: 0.0, z1: 7.0, color: "#9c6b52" }, // farmhouse walls, brick
  { x0: -6.8, x1: -5.3, y0: -29.0, y1: -27.5, z0: 8.5, z1: 13.0, color: "#7a5040" }, // chimney stack
  { x0: -7.0, x1: -5.0, y0: -16.1, y1: -15.7, z0: 0.0, z1: 4.5, color: "#4a3626" }, // farmhouse door
  { x0: -12.0, x1: -10.5, y0: -16.1, y1: -15.7, z0: 2.5, z1: 4.5, color: "#a8c2c9" }, // window
  { x0: -1.5, x1: 0.0, y0: -16.1, y1: -15.7, z0: 2.5, z1: 4.5, color: "#a8c2c9" }, // window
  // Well: stone-lined shaft with a wooden crossbeam and winding roof, in
  // the farmhouse's own garden a few steps from the door — domestic
  // water, kept apart from the stock down in the working yard.
  { x0: -20.0, x1: -16.0, y0: -19.0, y1: -15.0, z0: 0.0, z1: 2.2, color: "#8a8578" }, // well shaft, stone
  { x0: -19.6, x1: -19.0, y0: -18.8, y1: -18.2, z0: 2.2, z1: 6.0, color: "#6b5a42" }, // well post
  { x0: -17.0, x1: -16.4, y0: -15.8, y1: -15.2, z0: 2.2, z1: 6.0, color: "#6b5a42" }, // well post
  { x0: -20.4, x1: -15.6, y0: -19.4, y1: -14.6, z0: 6.0, z1: 7.0, color: "#5c4530" }, // well roof
  { x0: -19.6, x1: -16.4, y0: -17.2, y1: -16.8, z0: 5.6, z1: 6.0, color: "#6b5a42" }, // well crossbeam
  // Hen house: a small whitewashed coop tucked into the working yard's
  // near corner, right by the barn, where the chickens already scratch.
  { x0: -9.0, x1: -4.0, y0: 6.0, y1: 11.0, z0: 0.0, z1: 3.0, color: "#c9b28f" }, // hen house, whitewashed weatherboard
  { x0: -7.0, x1: -6.0, y0: 5.9, y1: 6.1, z0: 0.0, z1: 1.3, color: "#3d332a" }, // pop-hole
  // Granary: on staddle legs as before, closing the yard's north side.
  // Clear of the barn's own roofline, with a cart-width gap on to the
  // cartshed (below) that doubles as the yard's working gate.
  { x0: 6.5, x1: 7.5, y0: -12.5, y1: -11.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 13.5, x1: 14.5, y0: -12.5, y1: -11.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 6.5, x1: 7.5, y0: -5.5, y1: -4.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 13.5, x1: 14.5, y0: -5.5, y1: -4.5, z0: 0.0, z1: 1.6, color: "#8a8578" }, // staddle leg
  { x0: 6.0, x1: 15.0, y0: -13.0, y1: -4.0, z0: 1.6, z1: 6.6, color: "#9c7a52" }, // granary body
  // Cartshed: open-fronted, closing the yard's east side — an everyday
  // pole shed for carts and tackle, its whole west face left open onto
  // the yard instead of walled off. Set well out from the barn (below) so
  // there's real room to swing a tractor and implement between the two.
  { x0: 31.7, x1: 32.3, y0: -2.5, y1: -1.9, z0: 0.0, z1: 5.5, color: "#3a2e22" }, // open-front post
  { x0: 31.7, x1: 32.3, y0: 8.1, y1: 8.7, z0: 0.0, z1: 5.5, color: "#3a2e22" }, // open-front post
  { x0: 40.0, x1: 42.0, y0: -3.0, y1: 9.0, z0: 0.0, z1: 5.5, color: "#4a3a2c" }, // cartshed back wall
  { x0: 32.0, x1: 42.0, y0: -3.0, y1: -1.0, z0: 0.0, z1: 5.5, color: "#4a3a2c" }, // cartshed side wall
  { x0: 32.0, x1: 42.0, y0: 7.0, y1: 9.0, z0: 0.0, z1: 5.5, color: "#4a3a2c" }, // cartshed side wall
  // Cowshed: closes the yard's south side, set well down the yard from the
  // barn for the same reason — a plain byre for the house cow, nothing as
  // grand as the barn.
  { x0: -2.0, x1: 10.0, y0: 32.0, y1: 39.0, z0: 0.0, z1: 4.0, color: "#6b5a42" }, // cowshed walls, weatherboard
  { x0: 3.0, x1: 5.0, y0: 31.9, y1: 32.3, z0: 0.0, z1: 3.0, color: "#3d332a" }, // cowshed door
  // Hay rick: a thatched straw stack on stone staddles (its round tapering
  // bulk is built from stacked blobs in FARM_SHAPES, same trick as a tree
  // canopy), tucked past the cartshed in its own small rickyard, backed by
  // a short fence on its two field-facing sides for fire safety.
  { x0: 29.4, x1: 30.2, y0: 14.4, y1: 15.2, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 33.8, x1: 34.6, y0: 14.4, y1: 15.2, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 29.4, x1: 30.2, y0: 18.8, y1: 19.6, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 33.8, x1: 34.6, y0: 18.8, y1: 19.6, z0: 0.0, z1: 1.4, color: "#8a8578" }, // staddle stone
  { x0: 29.0, x1: 35.0, y0: 14.0, y1: 20.0, z0: 1.4, z1: 2.0, color: "#c9a24a" }, // staging platform
  // Fuel tank: a horizontal cylinder lying along the local y axis, built
  // the same way the tractor's own wheels are (an inscribed box for the
  // silhouette plus a full-radius disc at each end, see FARM_SHAPES) —
  // a true round profile rather than a boxy body with sphere caps.
  {
    x0: FUEL_TANK_LOCAL.x - FUEL_TANK_R * 0.6, x1: FUEL_TANK_LOCAL.x + FUEL_TANK_R * 0.6,
    y0: FUEL_TANK_LOCAL.y - FUEL_TANK_LEN + 0.3, y1: FUEL_TANK_LOCAL.y - FUEL_TANK_LEN + 0.8,
    z0: 0.0, z1: FUEL_TANK_STAND_H, color: "#5a5a5a",
  }, // near leg
  {
    x0: FUEL_TANK_LOCAL.x - FUEL_TANK_R * 0.6, x1: FUEL_TANK_LOCAL.x + FUEL_TANK_R * 0.6,
    y0: FUEL_TANK_LOCAL.y + FUEL_TANK_LEN - 0.8, y1: FUEL_TANK_LOCAL.y + FUEL_TANK_LEN - 0.3,
    z0: 0.0, z1: FUEL_TANK_STAND_H, color: "#5a5a5a",
  }, // far leg
  {
    x0: FUEL_TANK_LOCAL.x - FUEL_TANK_R * 0.72, x1: FUEL_TANK_LOCAL.x + FUEL_TANK_R * 0.72,
    y0: FUEL_TANK_LOCAL.y - FUEL_TANK_LEN, y1: FUEL_TANK_LOCAL.y + FUEL_TANK_LEN,
    z0: FUEL_TANK_STAND_H, z1: FUEL_TANK_STAND_H + FUEL_TANK_R * 1.44,
    color: "#3a4a3a",
  }, // tank body, riveted iron green
  {
    x0: FUEL_TANK_LOCAL.x - 0.3, x1: FUEL_TANK_LOCAL.x + 0.3,
    y0: FUEL_TANK_LOCAL.y - 0.3, y1: FUEL_TANK_LOCAL.y + 0.3,
    z0: FUEL_TANK_STAND_H - 0.8, z1: FUEL_TANK_STAND_H,
    color: "#3a3a3a",
  }, // valve hanging below the tank's midpoint
];
// Garden wall: the farmhouse's one boundary fence, the line between the
// house and the working yard below it.
addFenceRun(FARM_BOXES, -13, -14, 2, -14, "#6b5a42");
// Rickyard fence: backs the hay rick's two field-facing sides only (an
// unbroken ring risks a rail sitting across a road on some maps, and this
// is plenty to read as "fenced off from the stock")
addFenceRun(FARM_BOXES, 27, 12, 38, 12, "#6b5a42");
addFenceRun(FARM_BOXES, 27, 12, 27, 23, "#6b5a42");

// Gabled roofs — pitched, tapering tiers rather than flat slabs, one call
// per building (see addGableRoof above). Ridge axis runs the long way.
// Roofing material varies by building the way a real farmstead's would:
// the house gets the good clay tile, the barn got re-roofed in Welsh
// slate once the railway made it affordable, the lesser outbuildings make
// do with cheap corrugated iron or the barn's old plain tile.
addGableRoof(FARM_BOXES, -16.0, 2.0, -12.0, 2.0, 9.0, 12.0, "x", "#4f5a5e", 1.5); // barn, slate
addGableRoof(FARM_BOXES, -13.0, 1.0, -30.0, -16.0, 7.0, 10.0, "x", "#a8543a", 1.0); // farmhouse, terracotta clay tile
addGableRoof(FARM_BOXES, -9.0, -4.0, 6.0, 11.0, 3.0, 4.4, "x", "#8a929a", 0.6); // hen house, corrugated iron
addGableRoof(FARM_BOXES, 6.0, 15.0, -13.0, -4.0, 6.6, 9.2, "x", "#8a4a34", 0.7); // granary, aged clay tile
addGableRoof(FARM_BOXES, 32.0, 42.0, -3.0, 9.0, 5.5, 7.7, "y", "#8a929a", 1.0); // cartshed, corrugated iron
addGableRoof(FARM_BOXES, -2.0, 10.0, 32.0, 39.0, 4.0, 5.6, "x", "#5c4530", 0.6); // cowshed, plain tile

// Paddock fences and the pig sty: kept in their own array rather than
// pushed into FARM_BOXES, because they now sit far enough out (the
// pastures were pushed well past the yard, see PADDOCKS_LOCAL) that the
// shared farm-model depth base — which stamps every FARM_BOXES item with
// the farm CENTER's terrain height, not its own — drifts enough at this
// distance to sort behind/in front of nearby grazing animals wrong. Drawn
// with a per-box depth override in drawScene (search PADDOCK_BOXES there)
// using each box's own true ground position instead, the same convention
// animals/bushes/signs already use, so the two compare on equal terms.
export const PADDOCK_BOXES = [];
// Solid collision geometry for buildings/paddock fences, filled in by
// initBoxModels() below. Empty (harmless, matching no obstacles) until
// then rather than left undefined, since box-models.js may be imported
// before initBoxModels() runs.
export let FARM_SOLID_WORLD = [];
export let FENCE_SOLID_WORLD = [];

// A rotated local rectangle's corners no longer line up with the world axes
// unless FARM.angle is a 90° step (which it always is), so the world-space
// AABB is just the min/max of all 4 rotated corners.
function localRectToFarmWorldAABB([x0, x1, y0, y1]) {
  let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
  for (const lx of [x0, x1])
    for (const ly of [y0, y1]) {
      const { x: wx, y: wy } = rotateLocal(FARM.x, FARM.y, FARM.angle, lx, ly);
      wx0 = Math.min(wx0, wx); wx1 = Math.max(wx1, wx);
      wy0 = Math.min(wy0, wy); wy1 = Math.max(wy1, wy);
    }
  return { x0: wx0, x1: wx1, y0: wy0, y1: wy1 };
}

// Everything below needs PADDOCKS_LOCAL/PADDOCKS_WORLD finalized (which
// happens in main.js, right after makeMap()), so - like
// initTerrain()/initTrees() - this is an explicit init call rather than
// module-load-order top-level code: merely importing box-models.js must
// not read PADDOCKS_LOCAL before it exists.
export function initBoxModels() {
  // Pig sty: a low lean-to shelter tucked in the pig paddock's near corner,
  // out past the yard — kept low and plain, the humblest building here.
  // Positioned relative to PADDOCKS_LOCAL.pig (not fixed coordinates) since
  // which candidate placement won is only known once makeMap() has run.
  const p0 = PADDOCKS_LOCAL.pig;
  const STY = { x0: p0.x0 + 1, x1: p0.x0 + 1 + 4, y0: p0.y0 + 1, y1: p0.y0 + 1 + 3.5 };
  PADDOCK_BOXES.push(
    { x0: STY.x0, x1: STY.x1, y0: STY.y0, y1: STY.y1, z0: 0.0, z1: 2.2, color: "#8a7355" }, // sty walls, plain boarding
    {
      x0: (STY.x0 + STY.x1) / 2 - 0.6, x1: (STY.x0 + STY.x1) / 2 + 0.6,
      y0: STY.y1 - 0.1, y1: STY.y1 + 0.3, z0: 0.0, z1: 1.5, color: "#3d332a",
    } // sty doorway
  );
  addGableRoof(PADDOCK_BOXES, STY.x0, STY.x1, STY.y0, STY.y1, 2.2, 3.1, "x", "#8a929a", 0.5); // sty roof, corrugated iron
  // Cow and pig paddock fences: always a full, unbroken ring — no gate gaps
  // (an open fence reads as unfenced, which defeats the point). Road/water
  // clashes are avoided by *placement* instead, via the candidate search
  // right after makeMap() above; this just draws whichever rect it picked.
  for (const p of Object.values(PADDOCKS_LOCAL)) {
    addFenceRun(PADDOCK_BOXES, p.x0, p.y0, p.x1, p.y0, "#6b5a42"); // north rail
    addFenceRun(PADDOCK_BOXES, p.x0, p.y1, p.x1, p.y1, "#6b5a42"); // south rail
    addFenceRun(PADDOCK_BOXES, p.x0, p.y0, p.x0, p.y1, "#6b5a42"); // west rail
    addFenceRun(PADDOCK_BOXES, p.x1, p.y0, p.x1, p.y1, "#6b5a42"); // east rail
  }

  // Buildings block the tractor the same way trees and animals do (see the
  // collision check in update()). Only the load-bearing walls/body of each
  // building — not roofs, doors, fences or small fixtures — so a door-sized
  // gap in a wall box doesn't itself read as solid, and the cartshed's open
  // west face (it has no wall box there) stays driveable. Local coordinates,
  // turned into world-space boxes once here — FARM.angle only ever lands on
  // a 90° step, so this stays a true axis-aligned box in world space too.
  const FARM_SOLID_LOCAL = [
    ...FARM_BUILDING_FOOTPRINTS,
    [STY.x0, STY.x1, STY.y0, STY.y1], // pig sty
  ];
  FARM_SOLID_WORLD = FARM_SOLID_LOCAL.map(localRectToFarmWorldAABB);

  // Paddock fence rings, as thin collision strips (unlike FARM_SOLID_WORLD's
  // buildings, which are solid clean through, a paddock's rectangle is open
  // pasture — only the fence line itself should stop the tractor). Always a
  // full unbroken ring, matching the visual fence — no gate gaps, same
  // reasoning as there. Four strips per paddock, one along each rail, each
  // half FENCE_COLLIDE_HALF thick either side of the line.
  const FENCE_COLLIDE_HALF = 0.9;
  const FENCE_SOLID_LOCAL = [];
  for (const p of Object.values(PADDOCKS_LOCAL)) {
    FENCE_SOLID_LOCAL.push(
      [p.x0, p.x1, p.y0 - FENCE_COLLIDE_HALF, p.y0 + FENCE_COLLIDE_HALF], // north rail
      [p.x0, p.x1, p.y1 - FENCE_COLLIDE_HALF, p.y1 + FENCE_COLLIDE_HALF], // south rail
      [p.x0 - FENCE_COLLIDE_HALF, p.x0 + FENCE_COLLIDE_HALF, p.y0, p.y1], // west rail
      [p.x1 - FENCE_COLLIDE_HALF, p.x1 + FENCE_COLLIDE_HALF, p.y0, p.y1] // east rail
    );
  }
  FENCE_SOLID_WORLD = FENCE_SOLID_LOCAL.map(localRectToFarmWorldAABB);
}

// The two end-cap discs that round off the fuel tank's cylinder (same
// box+disc trick as makeWheels: the disc facing the camera reads as the
// tank's round end, the box gives its silhouette everywhere else), the
// well's hanging bucket, the yard's muck midden, and the hay rick's
// tapering thatched bulk (the same stacked-blob trick a tree canopy uses,
// just wider and golden)
export const FARM_SHAPES = [
  { blob: true, x: -18.0, y: -17.0, z: 4.0, r: 0.7, color: "#4a4238" }, // well bucket
  { blob: true, x: 16.0, y: 17.0, z: 0.9, r: 2.0, color: "#3a2e22" }, // muck midden
  { blob: true, x: 32.0, y: 17.0, z: 4.0, r: 4.2, color: "#d9b355" }, // rick, main bulk
  { blob: true, x: 32.0, y: 17.0, z: 6.5, r: 3.0, color: "#cfa64a" }, // rick, tapering
  { blob: true, x: 32.0, y: 17.0, z: 8.3, r: 1.8, color: "#c49a3f" }, // rick, tapering
  { blob: true, x: 32.0, y: 17.0, z: 9.4, r: 0.8, color: "#b98f38" }, // rick, thatched cap
];
for (const [ly, n] of [
  [FUEL_TANK_LOCAL.y - FUEL_TANK_LEN, -1],
  [FUEL_TANK_LOCAL.y + FUEL_TANK_LEN, 1],
]) {
  const z = FUEL_TANK_STAND_H + FUEL_TANK_R * 0.72;
  FARM_SHAPES.push(
    { disc: true, x: FUEL_TANK_LOCAL.x, y: ly, z, r: FUEL_TANK_R, n, color: "#3a4a3a" },
    { disc: true, x: FUEL_TANK_LOCAL.x, y: ly, z, r: FUEL_TANK_R * 0.6, n, color: "#28352a", bias: 0.06 }
  );
}

// City buildings, local to CITY: a small trading depot where the grain
// actually gets sold. No need for FARM's elaborate trampled yard — the
// depot just needs to read clearly from a distance as a destination.
export const CITY_BOXES = [
  { x0: -14.0, x1: 6.0, y0: -9.0, y1: 5.0, z0: 0.0, z1: 8.0, color: "#8a7a68" }, // warehouse
  { x0: -15.5, x1: 7.5, y0: -10.5, y1: 6.5, z0: 8.0, z1: 10.5, color: "#4a3f34" }, // warehouse roof
  { x0: -7.0, x1: -3.0, y0: 4.6, y1: 5.0, z0: 0.0, z1: 6.0, color: "#f7e8d8" }, // loading door
  { x0: 10.0, x1: 20.0, y0: -6.0, y1: 4.0, z0: 0.0, z1: 12.0, color: "#c9b896" }, // office block
  { x0: 9.0, x1: 21.0, y0: -7.0, y1: 5.0, z0: 12.0, z1: 14.0, color: "#6b5a44" }, // office roof
];
export const CITY_SHAPES = [
  { blob: true, x: 15.0, y: -1.0, z: 15.5, r: 2.4, color: "#8a4438" }, // roof accent
];

// Grain sacks dropped by the harvester: plump blobs with a tied-off top
export const SACK_SHAPES = [
  { blob: true, x: 0, y: 0, z: 1.5, r: 1.6, color: "#f0cf5e" },
  { blob: true, x: 0, y: 0, z: 3.1, r: 0.7, color: "#d9b446", bias: 0.05 },
];

// Faces of a unit box; corner index = xi*4 + yi*2 + zi. Windings are chosen
// so a face's projected signed area is positive exactly when it faces the
// camera, which doubles as backface culling.
export const FACES = [
  { n: [0, 0, 1], i: [1, 5, 7, 3] }, // top
  { n: [1, 0, 0], i: [4, 6, 7, 5] },
  { n: [-1, 0, 0], i: [2, 0, 1, 3] },
  { n: [0, 1, 0], i: [6, 2, 3, 7] },
  { n: [0, -1, 0], i: [0, 4, 5, 1] },
];

// Backface test on the UNROUNDED projection (fx/fy): for small thin boxes,
// pixel rounding can flip a near-edge-on face's sign from frame to frame
// while the model moves, making faces pop in and out
export function signedArea4(p0, p1, p2, p3) {
  return (
    p0.fx * p1.fy - p1.fx * p0.fy +
    p1.fx * p2.fy - p2.fx * p1.fy +
    p2.fx * p3.fy - p3.fx * p2.fy +
    p3.fx * p0.fy - p0.fx * p3.fy
  );
}

