// ---------------------------------------------------------------------------
// The delivery cart: a horse pulling a flat-bed wagon, putters around the
// road network all day, pauses at dead ends to drop something off, and
// waits politely for the tractor to pass. Road points are 3 world units
// apart, so pts index maps to distance.
// ---------------------------------------------------------------------------

const CART_SPEED = 8;

// One rigid body: the horse's silhouette (reusing HORSE_BOXES' proportions,
// shifted forward) harnessed by a shaft to a wooden cart bed behind it —
// legs stand at z0 0, same ground contact as the cart's own wheels.
const CART_BOXES = [
  { x0: -6.0, x1: -0.8, y0: -2.0, y1: 2.0, z0: 1.8, z1: 3.4, color: "#9a7442" }, // wooden cart bed
  { x0: -1.2, x1: -0.8, y0: -2.0, y1: 2.0, z0: 1.8, z1: 4.4, color: "#8a6238" }, // front board / seat back
  { x0: -0.8, x1: 1.6, y0: -0.15, y1: 0.15, z0: 2.2, z1: 2.6, color: "#6b6b6b" }, // shaft, horse to cart
  { x0: 1.6, x1: 2.4, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // horse hind legs
  { x0: 4.5, x1: 5.3, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // horse front legs
  { x0: 1.2, x1: 5.5, y0: -1.0, y1: 1.0, z0: 1.8, z1: 3.9, color: "#8a5c3a" }, // horse body
  { x0: 0.6, x1: 1.2, y0: -0.3, y1: 0.3, z0: 2.2, z1: 3.7, color: "#4a3626" }, // horse tail
  { x0: 5.1, x1: 6.0, y0: -0.55, y1: 0.55, z0: 3.4, z1: 5.6, color: "#8a5c3a" }, // horse neck
  { x0: 5.7, x1: 6.9, y0: -0.5, y1: 0.5, z0: 4.6, z1: 5.7, color: "#8a5c3a" }, // horse head
  { x0: 5.0, x1: 5.6, y0: -0.15, y1: 0.15, z0: 4.2, z1: 6.0, color: "#4a3626" }, // horse mane
];

const CART_WHEELS = [
  { x: -3.4, y0: 1.9, y1: 2.7, z: 1.8, r: 1.8 },
  { x: -3.4, y0: -2.7, y1: -1.9, z: 1.8, r: 1.8 },
];

// The carter sits on the front board, just behind the horse — same seated
// three-blob figure convention as the tractor's own driver
const CART_DRIVER = [
  { blob: true, x: -1.0, y: 0, z: 5.0, r: 0.75, color: "#4a6fa5", bias: 0.5 }, // coat
  { blob: true, x: -1.0, y: 0, z: 6.0, r: 0.55, color: "#f2c091", bias: 0.55 }, // head
  { blob: true, x: -1.0, y: 0, z: 6.55, r: 0.5, color: "#4a4238", bias: 0.6 }, // flat cap
];

const cart = { on: false, x: 0, y: 0, angle: 0, road: null, seg: 0, dir: 1, pause: 0, moving: 0 };

// Placement needs the road network (ground.js) to already exist, and its
// rand() calls have a fixed position in the world-gen sequence - like
// initTerrain()/initTrees(), an explicit init call rather than
// module-load-order top-level code.
function initCart() {
  // Start somewhere along the network
  const usable = roads.filter((r) => r.pts.length > 4);
  if (usable.length) {
    cart.road = usable[(rand() * usable.length) | 0];
    cart.seg = 1 + ((rand() * (cart.road.pts.length - 2)) | 0);
    cart.dir = rand() < 0.5 ? 1 : -1;
    const p = cart.road.pts[cart.seg];
    cart.x = p.x;
    cart.y = p.y;
    cart.angle = p.dir + (cart.dir < 0 ? Math.PI : 0);
    cart.on = true;
  }
}

function updateCart(dt) {
  if (!cart.on) return;
  if (cart.pause > 0) {
    cart.pause -= dt;
    cart.moving = 0;
    return;
  }
  // Wait for the tractor to pass rather than drive through it
  if (Math.hypot(tractor.x - cart.x, tractor.y - cart.y) < 10) {
    cart.moving = 0;
    return;
  }
  cart.moving = CART_SPEED;
  cart.seg += (cart.dir * CART_SPEED * dt) / 3;
  const pts = cart.road.pts;
  if (cart.seg <= 0 || cart.seg >= pts.length - 1) {
    // Reached an end of this road: make the delivery, then take any road
    // passing the spot — one of them is usually the road back
    cart.seg = clamp(cart.seg, 0, pts.length - 1);
    const end = pts[Math.round(cart.seg)];
    cart.pause = 2.5 + rand() * 3;
    const options = [];
    for (const r of roads) {
      if (r.pts.length < 5) continue;
      // Enter at the road's point nearest the junction, so resuming does
      // not visibly hop, and head into its longer side so the trip amounts
      // to something
      let bi = -1;
      let bd = 25; // squared: consider points within 5 units
      for (let i = 0; i < r.pts.length; i++) {
        const q = r.pts[i];
        const dd = (q.x - end.x) * (q.x - end.x) + (q.y - end.y) * (q.y - end.y);
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      }
      if (bi >= 0) options.push({ road: r, seg: bi, dir: bi < r.pts.length / 2 ? 1 : -1 });
    }
    const pick = options.length
      ? options[(rand() * options.length) | 0]
      : { road: cart.road, seg: Math.round(cart.seg), dir: -cart.dir };
    cart.road = pick.road;
    cart.seg = pick.seg;
    cart.dir = pick.dir;
    return;
  }
  const i = Math.floor(cart.seg);
  const f = cart.seg - i;
  const a = pts[i];
  const b = pts[i + 1];
  cart.x = a.x + (b.x - a.x) * f;
  cart.y = a.y + (b.y - a.y) * f;
  // Ease the heading toward the direction of travel (never snap)
  const want = Math.atan2((b.y - a.y) * cart.dir, (b.x - a.x) * cart.dir);
  const d = Math.atan2(Math.sin(want - cart.angle), Math.cos(want - cart.angle));
  cart.angle += clamp(d, -4 * dt, 4 * dt);
}
