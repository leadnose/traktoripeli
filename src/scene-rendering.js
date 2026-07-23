import { VIEW_W, VIEW_H, ctx, clamp, AMBIENT_FLOOR } from "./setup.js";
import { projX, projY, rotateXY, rotateLocal } from "./projection.js";
import { terrainHeight } from "./terrain.js";
import { LIGHT, INK, shade } from "./lighting.js";
import {
  TIRE,
  HUB,
  BOXES,
  TRACTOR_WHEELS,
  TRACTOR_SHAPES,
  DRIVER_SHAPES,
  IMPLEMENT_LIFT_HEIGHT,
  IMPLEMENTS,
  FARM_BOXES,
  FARM_SHAPES,
  PADDOCK_BOXES,
  CITY_BOXES,
  CITY_SHAPES,
  SACK_SHAPES,
  FACES,
  signedArea4,
} from "./box-models.js";
import { tractor, worldTime, implementPose, ROLLING_THRESHOLD, sacks } from "./tractor.js";
import { FARM } from "./farmyard.js";
import { CITY } from "./city.js";
import { cart, CART_BOXES, CART_WHEELS, CART_DRIVER } from "./cart.js";
import { trees, TREE_KINDS } from "./trees.js";
import { bushes } from "./bushes.js";
import { animals, ANIMAL_SPECS, ANIMAL_BOXES, SHEEP_BOXES, SHEEP_SHAPES } from "./animals.js";
import { signs, drawSign } from "./signposts.js";
import { seasonHex } from "./seasons.js";

// ---------------------------------------------------------------------------
// Scene rendering: all box sets (tractor, implement, farm, sacks) go into one
// list and are painter-sorted together so occlusion works between them.
// ---------------------------------------------------------------------------

// Each point rides at terrain height under its own footprint, which drapes
// models over slopes so they visibly pitch and roll on hills. Sort depths,
// however, use the terrain height at the model's origin for every box: on a
// steep slope falling away from the camera, per-footprint heights nearly
// cancel the depth differences between a model's parts, and the resulting
// near-ties flip per frame and flicker.
function makeItems(items, boxes, ox, oy, angle, liftZ, camX, camY, baseDepth) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Model-level depth: callers of moving models can pass a smoothed value so
  // frame-to-frame jitter can't flip the draw order against neighbors
  const M = baseDepth !== undefined ? baseDepth : ox + oy + terrainHeight(ox, oy);
  const local = (lx, ly, lz) => {
    const p = rotateXY(cos, sin, lx, ly);
    const wx = ox + p.x;
    const wy = oy + p.y;
    const wz = lz + terrainHeight(wx, wy);
    const fx = projX(wx, wy) - camX;
    const fy = projY(wx, wy, wz) - camY;
    return { x: Math.round(fx), y: Math.round(fy), fx, fy };
  };
  for (const box of boxes) {
    const pts = [];
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++)
          pts.push(
            local(
              xi ? box.x1 : box.x0,
              yi ? box.y1 : box.y0,
              (zi ? box.z1 : box.z0) + liftZ
            )
          );
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const rel = cx * cos - cy * sin + cx * sin + cy * cos;
    const depth = M + rel + (box.z0 + box.z1) / 2 + liftZ;
    items.push({ box, pts, depth, cos, sin });
  }
}

// Round shapes: discs are circles in the local x-z plane (wheel faces),
// blobs are soft spheres drawn as shaded ellipses (canopies, sacks, domes).
function makeRoundItems(items, shapes, ox, oy, angle, liftZ, camX, camY, baseDepth) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const M = baseDepth !== undefined ? baseDepth : ox + oy + terrainHeight(ox, oy);
  const project = (lx, ly, lz) => {
    const p = rotateXY(cos, sin, lx, ly);
    const wx = ox + p.x;
    const wy = oy + p.y;
    const wz = lz + terrainHeight(wx, wy);
    return {
      x: Math.round(projX(wx, wy) - camX),
      y: Math.round(projY(wx, wy, wz) - camY),
    };
  };
  for (const s of shapes) {
    const c = project(s.x, s.y, s.z + liftZ);
    // Depth from the shared model base, like makeItems
    const rel = s.x * cos - s.y * sin + s.x * sin + s.y * cos;
    const depth = M + rel + s.z + liftZ + (s.bias || 0);
    if (s.disc) {
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        pts.push(project(s.x + Math.cos(a) * s.r, s.y, s.z + liftZ + Math.sin(a) * s.r));
      }
      // Lit like a box's side face: normal is the rotated local y axis
      const d = -s.n * sin * LIGHT.x + s.n * cos * LIGHT.y;
      const k = clamp(AMBIENT_FLOOR + d, AMBIENT_FLOOR, 1);
      items.push({ poly: pts, color: s.color, k, depth });
    } else {
      items.push({
        blob: c,
        rx: s.r * 1.4,
        ry: s.r * 1.2,
        color: s.color,
        k: Math.min(1, 0.35 + LIGHT.z),
        depth,
      });
    }
  }
}

// A wheel is a slim tread box plus a tire disc and hubcap on each face. The
// disc on the camera side always projects nearer than the box center, so the
// painter's sort shows the round face; edge-on, the box gives the silhouette.
function makeWheels(items, wheels, ox, oy, angle, liftZ, camX, camY) {
  const boxes = [];
  const shapes = [];
  for (const w of wheels) {
    boxes.push({
      x0: w.x - w.r * 0.72, x1: w.x + w.r * 0.72,
      y0: w.y0, y1: w.y1,
      z0: w.z - w.r * 0.72, z1: w.z + w.r * 0.72,
      color: TIRE,
    });
    for (const [ly, n] of [[w.y0, -1], [w.y1, 1]]) {
      shapes.push({ disc: true, x: w.x, y: ly, z: w.z, r: w.r, n, color: TIRE });
      shapes.push({ disc: true, x: w.x, y: ly, z: w.z, r: w.r * 0.45, n, color: HUB, bias: 0.06 });
    }
  }
  makeItems(items, boxes, ox, oy, angle, liftZ, camX, camY);
  makeRoundItems(items, shapes, ox, oy, angle, liftZ, camX, camY);
}

// Coarse visibility test for scattered scenery (trees, bushes, sacks)
function onScreen(wx, wy, camX, camY) {
  const x = projX(wx, wy) - camX;
  const y = projY(wx, wy, 0) - camY;
  return x > -40 && x < VIEW_W + 40 && y > -80 && y < VIEW_H + 80;
}

// Scene models render onto their own transparent canvas so an ink pass can
// outline them: the canvas alpha stamped at the four cardinal offsets, minus
// the scene itself, is exactly a one-pixel line around every silhouette.
// Overlapping models merge into one inked shape, so no line ever cuts
// through a correct occlusion, and the draw order stays untouched.
const sceneCanvas = document.createElement("canvas");
sceneCanvas.width = VIEW_W;
sceneCanvas.height = VIEW_H;
export const sceneCtx = sceneCanvas.getContext("2d");

const inkCanvas = document.createElement("canvas");
inkCanvas.width = VIEW_W;
inkCanvas.height = VIEW_H;
const inkCtx = inkCanvas.getContext("2d");

export function drawScene(camX, camY) {
  const pose = implementPose();

  // Ground shadows: one quad under the tractor, one under the implement
  // (they part ways when a towed implement swings out of line)
  const shadowQuad = (ox, oy, angle, x0, x1, hw) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const shPt = (lx, ly) => {
      const p = rotateXY(cos, sin, lx, ly);
      const wx = ox + p.x;
      const wy = oy + p.y;
      return {
        x: Math.round(projX(wx, wy) - camX),
        y: Math.round(projY(wx, wy, terrainHeight(wx, wy)) - camY),
      };
    };
    const a = shPt(x0, -hw);
    const b = shPt(x1, -hw);
    const c = shPt(x1, hw);
    const d = shPt(x0, hw);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  // One path for both quads so their overlap at the hitch doesn't darken
  const imp = IMPLEMENTS[tractor.implement];
  const impBoxes = imp.boxes();
  const impRear = Math.min(...impBoxes.map((b) => b.x0)) - 0.5;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  shadowQuad(tractor.x, tractor.y, tractor.angle, -6, 8.5, 5.5);
  shadowQuad(pose.x, pose.y, pose.angle, impRear, -6.5, 6);
  if (cart.on && onScreen(cart.x, cart.y, camX, camY))
    shadowQuad(cart.x, cart.y, cart.angle, -6, 6.9, 2.2);
  for (const t of trees) {
    if (!onScreen(t.wx, t.wy, camX, camY)) continue;
    const sx = Math.round(projX(t.wx, t.wy) - camX);
    const sy = Math.round(projY(t.wx, t.wy, terrainHeight(t.wx, t.wy)) - camY);
    ctx.moveTo(sx + 6, sy);
    ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2);
  }
  for (const b of bushes) {
    if (!onScreen(b.wx, b.wy, camX, camY)) continue;
    const sx = Math.round(projX(b.wx, b.wy) - camX);
    const sy = Math.round(projY(b.wx, b.wy, terrainHeight(b.wx, b.wy)) - camY);
    ctx.moveTo(sx + b.r * 1.6, sy);
    ctx.ellipse(sx, sy, b.r * 1.6, b.r * 0.8, 0, 0, Math.PI * 2);
  }
  for (const a of animals) {
    if (!onScreen(a.wx, a.wy, camX, camY)) continue;
    const sx = Math.round(projX(a.wx, a.wy) - camX);
    const sy = Math.round(projY(a.wx, a.wy, terrainHeight(a.wx, a.wy)) - camY);
    const r = ANIMAL_SPECS[a.species].shadow;
    ctx.moveTo(sx + r, sy);
    ctx.ellipse(sx, sy, r, r / 2, 0, 0, Math.PI * 2);
  }
  for (const s of signs) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    const sx = Math.round(projX(s.wx, s.wy) - camX);
    const sy = Math.round(projY(s.wx, s.wy, terrainHeight(s.wx, s.wy)) - camY);
    ctx.moveTo(sx + 3, sy);
    ctx.ellipse(sx, sy, 3, 1.5, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Painter's algorithm: depth along the view axis is wx + wy + wz.
  const items = [];
  const liftZ = imp.liftable ? tractor.implLift * IMPLEMENT_LIFT_HEIGHT : 0;
  makeItems(items, BOXES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeWheels(items, TRACTOR_WHEELS, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeRoundItems(items, TRACTOR_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  // The driver bounces gently in the seat while rolling; the whole stack
  // shares one offset so its internal ordering never changes
  const bob = Math.abs(tractor.speed) > ROLLING_THRESHOLD ? Math.sin(worldTime * 11) * 0.22 : 0;
  for (const s of DRIVER_SHAPES) s.z = s.rest + bob;
  makeRoundItems(items, DRIVER_SHAPES, tractor.x, tractor.y, tractor.angle, 0, camX, camY);
  makeItems(items, impBoxes, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeWheels(items, imp.wheels, pose.x, pose.y, pose.angle, liftZ, camX, camY);
  makeItems(items, FARM_BOXES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  makeRoundItems(items, FARM_SHAPES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
  // Paddock fences and the pig sty get a per-box depth override using
  // their own true world position (same "+2.5" ground convention as
  // animals/bushes/signs below) instead of the farm-wide model depth
  // makeItems just gave them — see the PADDOCK_BOXES comment for why.
  {
    const start = items.length;
    makeItems(items, PADDOCK_BOXES, FARM.x, FARM.y, FARM.angle, 0, camX, camY);
    for (let i = start; i < items.length; i++) {
      const b = items[i].box;
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      const { x: wx, y: wy } = rotateLocal(FARM.x, FARM.y, FARM.angle, cx, cy);
      items[i].depth = wx + wy + terrainHeight(wx, wy) + 2.5;
    }
  }
  makeItems(items, CITY_BOXES, CITY.x, CITY.y, CITY.angle, 0, camX, camY);
  makeRoundItems(items, CITY_SHAPES, CITY.x, CITY.y, CITY.angle, 0, camX, camY);
  if (cart.on && onScreen(cart.x, cart.y, camX, camY)) {
    makeItems(items, CART_BOXES, cart.x, cart.y, cart.angle, 0, camX, camY);
    makeWheels(items, CART_WHEELS, cart.x, cart.y, cart.angle, 0, camX, camY);
    makeRoundItems(items, CART_DRIVER, cart.x, cart.y, cart.angle, 0, camX, camY);
  }
  for (const t of trees) {
    if (!onScreen(t.wx, t.wy, camX, camY)) continue;
    const kind = TREE_KINDS[t.kind];
    makeItems(items, kind.boxes, t.wx, t.wy, t.angle, 0, camX, camY);
    makeRoundItems(items, kind.blobs, t.wx, t.wy, t.angle, 0, camX, camY);
  }
  for (const b of bushes) {
    if (!onScreen(b.wx, b.wy, camX, camY)) continue;
    b.shapes[0].color = seasonHex(b.seasonColors);
    makeRoundItems(items, b.shapes, b.wx, b.wy, 0, 0, camX, camY);
    // Anchor the bush to the same ground-based depth formula the animals
    // use, so an animal grazing past swaps order exactly where the ground
    // positions cross — anywhere else and the swap visibly pops
    items[items.length - 1].depth = b.wx + b.wy + terrainHeight(b.wx, b.wy) + 2.5;
  }
  for (const a of animals) {
    if (!onScreen(a.wx, a.wy, camX, camY)) continue;
    // Smooth the animal's base depth so its wandering can't jitter the draw
    // order against herd-mates standing at nearly the same depth
    const target = a.wx + a.wy + terrainHeight(a.wx, a.wy) + a.tie;
    // Hysteresis follower: the sort depth trails the true depth a little and
    // holds still while the animal wanders inside the band, so per-frame
    // jitter can't flip the draw order against neighbors
    if (a.sd === undefined) {
      a.sd = target;
    } else {
      const diff = target - a.sd;
      if (Math.abs(diff) > 0.75) a.sd = target - Math.sign(diff) * 0.75;
    }
    // One unit, fixed internal paint order: overwrite the parts' depths with
    // strictly increasing values around the smoothed base, so the global
    // sort can never reorder them (see COW_BOXES)
    const start = items.length;
    if (a.species === "sheep") {
      makeRoundItems(items, SHEEP_SHAPES, a.wx, a.wy, a.angle, 0, camX, camY);
      makeItems(items, SHEEP_BOXES, a.wx, a.wy, a.angle, 0, camX, camY);
    } else {
      makeItems(items, ANIMAL_BOXES[a.species], a.wx, a.wy, a.angle, 0, camX, camY);
    }
    for (let i = start; i < items.length; i++) {
      items[i].depth = a.sd + 2.5 + (i - start) * 1e-4;
    }
  }
  for (const s of sacks) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    makeRoundItems(items, SACK_SHAPES, s.wx, s.wy, 0, 0, camX, camY);
  }
  for (const s of signs) {
    if (!onScreen(s.wx, s.wy, camX, camY)) continue;
    items.push({
      sign: s,
      x: Math.round(projX(s.wx, s.wy) - camX),
      y: Math.round(projY(s.wx, s.wy, terrainHeight(s.wx, s.wy)) - camY),
      // Same ground-based depth convention as the bushes and animals
      depth: s.wx + s.wy + terrainHeight(s.wx, s.wy) + 2.5,
    });
  }
  items.sort((a, b) => a.depth - b.depth);

  sceneCtx.clearRect(0, 0, VIEW_W, VIEW_H);
  for (const item of items) {
    if (item.sign) {
      drawSign(item.sign, item.x, item.y);
      continue;
    }
    if (item.blob) {
      // Soft sphere: base ellipse with a lighter highlight up and to the left
      sceneCtx.fillStyle = shade(item.color, item.k);
      sceneCtx.beginPath();
      sceneCtx.ellipse(item.blob.x, item.blob.y, item.rx, item.ry, 0, 0, Math.PI * 2);
      sceneCtx.fill();
      sceneCtx.fillStyle = shade(item.color, item.k * 1.16);
      sceneCtx.beginPath();
      sceneCtx.ellipse(
        item.blob.x - item.rx * 0.25,
        item.blob.y - item.ry * 0.3,
        item.rx * 0.55,
        item.ry * 0.5,
        0, 0, Math.PI * 2
      );
      sceneCtx.fill();
      continue;
    }
    if (item.poly) {
      sceneCtx.fillStyle = shade(item.color, item.k);
      sceneCtx.beginPath();
      sceneCtx.moveTo(item.poly[0].x, item.poly[0].y);
      for (let i = 1; i < item.poly.length; i++)
        sceneCtx.lineTo(item.poly[i].x, item.poly[i].y);
      sceneCtx.closePath();
      sceneCtx.fill();
      continue;
    }
    for (const face of FACES) {
      const p0 = item.pts[face.i[0]];
      const p1 = item.pts[face.i[1]];
      const p2 = item.pts[face.i[2]];
      const p3 = item.pts[face.i[3]];
      if (signedArea4(p0, p1, p2, p3) <= 0) continue;

      const nx = face.n[0] * item.cos - face.n[1] * item.sin;
      const ny = face.n[0] * item.sin + face.n[1] * item.cos;
      const d = nx * LIGHT.x + ny * LIGHT.y + face.n[2] * LIGHT.z;
      const k = clamp(AMBIENT_FLOOR + d, AMBIENT_FLOOR, 1);

      sceneCtx.fillStyle = shade(item.box.color, k);
      sceneCtx.beginPath();
      sceneCtx.moveTo(p0.x, p0.y);
      sceneCtx.lineTo(p1.x, p1.y);
      sceneCtx.lineTo(p2.x, p2.y);
      sceneCtx.lineTo(p3.x, p3.y);
      sceneCtx.closePath();
      sceneCtx.fill();
    }
  }

  // Ink pass: dilate the scene's alpha one pixel in each cardinal direction,
  // cut the scene itself back out, and tint the remaining ring
  inkCtx.globalCompositeOperation = "source-over";
  inkCtx.clearRect(0, 0, VIEW_W, VIEW_H);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
    inkCtx.drawImage(sceneCanvas, dx, dy);
  inkCtx.globalCompositeOperation = "destination-out";
  inkCtx.drawImage(sceneCanvas, 0, 0);
  inkCtx.globalCompositeOperation = "source-in";
  inkCtx.fillStyle = INK;
  inkCtx.fillRect(0, 0, VIEW_W, VIEW_H);

  // The line goes under the models: outline first, scene on top
  ctx.drawImage(inkCanvas, 0, 0);
  ctx.drawImage(sceneCanvas, 0, 0);
}
