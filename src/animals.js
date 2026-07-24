// ---------------------------------------------------------------------------
// Animals: cows, sheep, pigs and goats graze in small herds on the meadows,
// horses roam wider, ducks keep to the shoreline, a cat and dog linger
// around the farmyard, and flocks of birds cross the sky.
// ---------------------------------------------------------------------------

// The body is split into adjacent segments instead of overlapping boxes:
// overlapping boxes have near-equal painter's depths, and the sort order
// flips as the cow turns or drapes over a hill, which made them flicker
// Animal parts are listed in paint order (legs under body, head on top):
// each animal is drawn as one unit in this fixed order, because its parts
// are so small and close together that depth-sorting them individually
// lands on near-ties that flip while the animal moves
const COW_BOXES = [
  { x0: -2.0, x1: -1.2, y0: -1.0, y1: 1.0, z0: 0.0, z1: 1.3, color: "#5a534c" }, // hind legs
  { x0: 1.0, x1: 1.8, y0: -1.0, y1: 1.0, z0: 0.0, z1: 1.3, color: "#5a534c" }, // front legs
  { x0: -2.4, x1: -1.7, y0: -1.2, y1: 1.2, z0: 1.3, z1: 3.8, color: "#f0ede2" }, // rump
  { x0: -1.7, x1: 0.4, y0: -1.2, y1: 1.2, z0: 1.3, z1: 3.8, color: "#413c38" }, // dark middle
  { x0: 0.4, x1: 2.0, y0: -1.2, y1: 1.2, z0: 1.3, z1: 3.8, color: "#f0ede2" }, // shoulders
  { x0: 2.0, x1: 2.9, y0: -0.8, y1: 0.8, z0: 2.4, z1: 4.2, color: "#f0ede2" }, // head
  { x0: 2.9, x1: 3.35, y0: -0.7, y1: 0.7, z0: 2.4, z1: 3.4, color: "#d9a3ab" }, // muzzle
];
const SHEEP_BOXES = [
  { x0: 1.4, x1: 2.4, y0: -0.6, y1: 0.6, z0: 1.6, z1: 2.9, color: "#4a4238" }, // head
  { x0: -1.4, x1: -0.6, y0: -0.7, y1: 0.7, z0: 0.0, z1: 1.4, color: "#4a4238" }, // hind legs
  { x0: 0.5, x1: 1.3, y0: -0.7, y1: 0.7, z0: 0.0, z1: 1.4, color: "#4a4238" }, // front legs
];

// Horse: taller and slimmer, with a raised neck, dark mane and a tail.
// Same fixed paint order: legs, body, tail, neck, head, mane.
const HORSE_BOXES = [
  { x0: -1.9, x1: -1.1, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // hind legs
  { x0: 1.0, x1: 1.8, y0: -0.9, y1: 0.9, z0: 0.0, z1: 1.8, color: "#5a4636" }, // front legs
  { x0: -2.3, x1: 2.0, y0: -1.0, y1: 1.0, z0: 1.8, z1: 3.9, color: "#8a5c3a" }, // body
  { x0: -2.9, x1: -2.3, y0: -0.3, y1: 0.3, z0: 2.2, z1: 3.7, color: "#4a3626" }, // tail
  { x0: 1.6, x1: 2.5, y0: -0.55, y1: 0.55, z0: 3.4, z1: 5.6, color: "#8a5c3a" }, // neck
  { x0: 2.2, x1: 3.4, y0: -0.5, y1: 0.5, z0: 4.6, z1: 5.7, color: "#8a5c3a" }, // head
  { x0: 1.5, x1: 2.1, y0: -0.15, y1: 0.15, z0: 4.2, z1: 6.0, color: "#4a3626" }, // mane
];
const SHEEP_SHAPES = [
  { blob: true, x: 0, y: 0, z: 2.1, r: 1.8, color: "#f4f1e6" }, // woolly body
];

// Chicken: a tiny white bird with a red comb and orange beak, drawn in
// fixed paint order like the others (body, tail, head, comb, beak)
const CHICKEN_BOXES = [
  { x0: -0.7, x1: 0.7, y0: -0.5, y1: 0.5, z0: 0.4, z1: 1.6, color: "#f5f1e4" }, // body
  { x0: -1.05, x1: -0.6, y0: -0.25, y1: 0.25, z0: 1.0, z1: 1.9, color: "#f5f1e4" }, // tail
  { x0: 0.5, x1: 0.95, y0: -0.25, y1: 0.25, z0: 1.3, z1: 2.3, color: "#f5f1e4" }, // head
  { x0: 0.6, x1: 0.9, y0: -0.12, y1: 0.12, z0: 2.3, z1: 2.6, color: "#d94a2e" }, // comb
  { x0: 0.95, x1: 1.25, y0: -0.12, y1: 0.12, z0: 1.5, z1: 1.7, color: "#f0a030" }, // beak
];

// Pig: low, round and dusty pink, with a curled tail and a flat snout
const PIG_BOXES = [
  { x0: -1.3, x1: -0.7, y0: -0.6, y1: 0.6, z0: 0.0, z1: 0.9, color: "#c98a94" }, // hind legs
  { x0: 0.6, x1: 1.2, y0: -0.6, y1: 0.6, z0: 0.0, z1: 0.9, color: "#c98a94" }, // front legs
  { x0: -1.6, x1: 1.3, y0: -1.0, y1: 1.0, z0: 0.9, z1: 2.3, color: "#eeb0bb" }, // body
  { x0: -1.9, x1: -1.5, y0: -0.25, y1: 0.25, z0: 1.6, z1: 2.1, color: "#d99aa4" }, // curled tail
  { x0: 1.3, x1: 2.1, y0: -0.55, y1: 0.55, z0: 1.1, z1: 2.1, color: "#eeb0bb" }, // head
  { x0: 2.1, x1: 2.45, y0: -0.4, y1: 0.4, z0: 1.2, z1: 1.7, color: "#c98a94" }, // snout
];

// Goat: leaner than a sheep, short-haired, with a pair of small dark horns
const GOAT_BOXES = [
  { x0: -1.1, x1: -0.5, y0: -0.55, y1: 0.55, z0: 0.0, z1: 1.1, color: "#8f8672" }, // hind legs
  { x0: 0.4, x1: 1.0, y0: -0.55, y1: 0.55, z0: 0.0, z1: 1.1, color: "#8f8672" }, // front legs
  { x0: -1.5, x1: 1.1, y0: -0.7, y1: 0.7, z0: 1.1, z1: 2.3, color: "#c9bfa8" }, // body
  { x0: 1.1, x1: 1.9, y0: -0.5, y1: 0.5, z0: 1.5, z1: 2.5, color: "#c9bfa8" }, // head
  { x0: 1.3, x1: 1.6, y0: -0.15, y1: 0.15, z0: 2.5, z1: 2.9, color: "#4a4238" }, // horns
];

// Duck: small and low to the ground, cream-gray with an orange beak — same
// legless silhouette convention as the chicken
const DUCK_BOXES = [
  { x0: -0.6, x1: 0.6, y0: -0.45, y1: 0.45, z0: 0.3, z1: 1.1, color: "#e3dcc4" }, // body
  { x0: -0.85, x1: -0.55, y0: -0.2, y1: 0.2, z0: 0.6, z1: 1.0, color: "#e3dcc4" }, // tail
  { x0: 0.5, x1: 0.85, y0: -0.22, y1: 0.22, z0: 0.9, z1: 1.5, color: "#e3dcc4" }, // head
  { x0: 0.8, x1: 1.1, y0: -0.12, y1: 0.12, z0: 0.95, z1: 1.15, color: "#e8891f" }, // beak
];

// Farm dog: brown with an up-curled tail and alert ears
const DOG_BOXES = [
  { x0: -0.9, x1: -0.5, y0: -0.4, y1: 0.4, z0: 0.0, z1: 0.9, color: "#8a6a42" }, // hind legs
  { x0: 0.4, x1: 0.8, y0: -0.4, y1: 0.4, z0: 0.0, z1: 0.9, color: "#8a6a42" }, // front legs
  { x0: -1.2, x1: 0.9, y0: -0.55, y1: 0.55, z0: 0.8, z1: 1.7, color: "#8a6a42" }, // body
  { x0: -1.5, x1: -1.15, y0: -0.15, y1: 0.15, z0: 1.1, z1: 1.6, color: "#6a4e30" }, // tail
  { x0: 0.9, x1: 1.5, y0: -0.4, y1: 0.4, z0: 1.1, z1: 1.9, color: "#8a6a42" }, // head
  { x0: 1.5, x1: 1.85, y0: -0.25, y1: 0.25, z0: 1.15, z1: 1.55, color: "#6a4e30" }, // snout
  { x0: 1.05, x1: 1.35, y0: -0.4, y1: -0.15, z0: 1.75, z1: 2.05, color: "#6a4e30" }, // left ear
  { x0: 1.05, x1: 1.35, y0: 0.15, y1: 0.4, z0: 1.75, z1: 2.05, color: "#6a4e30" }, // right ear
];

// Farm cat: small, orange tabby, tail curved up
const CAT_BOXES = [
  { x0: -0.5, x1: -0.2, y0: -0.3, y1: 0.3, z0: 0.0, z1: 0.55, color: "#b57a3f" }, // hind legs
  { x0: 0.15, x1: 0.45, y0: -0.3, y1: 0.3, z0: 0.0, z1: 0.55, color: "#b57a3f" }, // front legs
  { x0: -0.7, x1: 0.5, y0: -0.35, y1: 0.35, z0: 0.5, z1: 1.05, color: "#c98a4a" }, // body
  { x0: -0.95, x1: -0.65, y0: -0.12, y1: 0.12, z0: 0.9, z1: 1.6, color: "#a5713a" }, // tail
  { x0: 0.45, x1: 0.85, y0: -0.28, y1: 0.28, z0: 0.75, z1: 1.15, color: "#c98a4a" }, // head
  { x0: 0.55, x1: 0.7, y0: -0.28, y1: -0.12, z0: 1.15, z1: 1.35, color: "#a5713a" }, // left ear
  { x0: 0.55, x1: 0.7, y0: 0.12, y1: 0.28, z0: 1.15, z1: 1.35, color: "#a5713a" }, // right ear
];

// Per-species behavior: chickens are quick, jerky, peck constantly, keep to
// a small range and may run on roads (the yard is full of them)
// Every species gets clear of the tractor (spook radius + flee speed +
// fleeTurn rate): horses and chickens dash in a panic, while cows and sheep
// — still solid to drive against — just plod calmly out of the way.
const ANIMAL_SPECS = {
  cow: { speed: 2.5, range: 22, sep: 4.5, turn: 1.4, pauseChance: 0.004, pauseDur: [1, 3], shadow: 3.4, spook: 16, flee: 3.5, fleeTurn: 3 },
  sheep: { speed: 2.2, range: 20, sep: 4.5, turn: 1.4, pauseChance: 0.005, pauseDur: [1, 3], shadow: 2.4, spook: 16, flee: 3.8, fleeTurn: 3.5 },
  horse: { speed: 3.2, range: 26, sep: 4.5, turn: 1.4, pauseChance: 0.004, pauseDur: [1, 3], shadow: 3.4, spook: 26, flee: 22, fleeTurn: 8 },
  chicken: { speed: 5, range: 15, sep: 1.6, turn: 4, pauseChance: 0.03, pauseDur: [0.4, 1.2], shadow: 1.0, roads: true, spook: 18, flee: 16, fleeTurn: 8 },
  pig: { speed: 1.8, range: 14, sep: 3.2, turn: 1.3, pauseChance: 0.008, pauseDur: [1, 3], shadow: 2.4, spook: 14, flee: 10, fleeTurn: 5 },
  goat: { speed: 2.8, range: 26, sep: 3.6, turn: 1.6, pauseChance: 0.005, pauseDur: [1, 2.5], shadow: 2.0, spook: 18, flee: 14, fleeTurn: 6 },
  duck: { speed: 1.4, range: 10, sep: 1.4, turn: 3.5, pauseChance: 0.02, pauseDur: [0.3, 1], shadow: 0.8, spook: 10, flee: 9, fleeTurn: 7 },
  dog: { speed: 3.0, range: 12, sep: 2.0, turn: 2.5, pauseChance: 0.02, pauseDur: [0.5, 2], shadow: 1.6, roads: true, spook: 14, flee: 12, fleeTurn: 8 },
  cat: { speed: 2.2, range: 10, sep: 1.6, turn: 3, pauseChance: 0.03, pauseDur: [1, 4], shadow: 1.2, roads: true, spook: 10, flee: 14, fleeTurn: 10 },
};

// Every species draws as one fixed-order box unit except sheep, which pairs
// a woolly blob (SHEEP_SHAPES) with SHEEP_BOXES and is special-cased where
// items get built (see the sheep branch there)
const ANIMAL_BOXES = {
  cow: COW_BOXES,
  horse: HORSE_BOXES,
  chicken: CHICKEN_BOXES,
  pig: PIG_BOXES,
  goat: GOAT_BOXES,
  duck: DUCK_BOXES,
  dog: DOG_BOXES,
  cat: CAT_BOXES,
};

const animals = [];

// Every spawned group is registered as a herd, so routines can send its
// members somewhere together (see updateHerds) by moving their home anchor
const herds = [];

function spawnHerd(species, hx, hy, count) {
  const n = count || 3 + ((rand() * 4) | 0);
  const members = [];
  for (let i = 0; i < n; i++) {
    // Keep trying offsets until the animal actually stands on grass —
    // otherwise it can spawn in the water beside a shoreline home spot
    let wx = hx;
    let wy = hy;
    const pad = PADDOCKS_WORLD[species];
    for (let t = 0; t < 20; t++) {
      let cx = hx + (rand() - 0.5) * 24;
      let cy = hy + (rand() - 0.5) * 24;
      if (pad) {
        cx = clamp(cx, pad.x0 + 0.7, pad.x1 - 0.7);
        cy = clamp(cy, pad.y0 + 0.7, pad.y1 - 0.7);
      } else if (insideAnyPaddock(cx, cy)) {
        // Not this species' own paddock — every other species must never
        // spawn inside either fence, not just its own
        continue;
      }
      if (
        tileTypeAt(cx, cy) === 0 &&
        (ANIMAL_SPECS[species].roads || !roadTiles.has(tileKey(cx, cy)))
      ) {
        wx = cx;
        wy = cy;
        break;
      }
    }
    const a = {
      species,
      hx,
      hy,
      wx,
      wy,
      angle: rand() * Math.PI * 2,
      pause: rand() * 4,
      // Unique depth tiebreak: animals standing at the same depth keep a
      // consistent order instead of interleaving their parts
      tie: animals.length * 0.004,
    };
    animals.push(a);
    members.push(a);
  }
  herds.push({
    species,
    homeX: hx,
    homeY: hy,
    members,
    out: false,
    next: 20 + rand() * 60, // time until the first outing
  });
}

// Grass banks beside water, where the herds can amble down for a drink (and
// where ducks make their home outright) — computed early so the farm and
// wild duck herds below can place themselves on the shore
const shoreSpots = [];

function nearestShoreSpot(x, y) {
  let spot = null;
  let bd = Infinity;
  for (const s of shoreSpots) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) {
      bd = d;
      spot = s;
    }
  }
  return spot && { spot, dist: bd };
}

// Herd/flock placement needs the road network, forest tiles and finalized
// paddocks to already exist, and its rand() calls have a fixed position in
// the world-gen sequence - like initTerrain()/initTrees(), an explicit init
// call rather than module-load-order top-level code.
function initAnimals() {
  for (let sy = 0; sy < MAP_TILES; sy++)
    for (let sx = 0; sx < MAP_TILES; sx++) {
      if (tiles[sy][sx] !== 0 || roadTiles.has(sy * MAP_TILES + sx)) continue;
      if (isWater(sx + 1, sy) || isWater(sx - 1, sy) || isWater(sx, sy + 1) || isWater(sx, sy - 1))
        shoreSpots.push({ x: (sx + 0.5) * TILE, y: (sy + 0.5) * TILE });
    }

  // The farm always keeps one herd of each grazing species close by. Cows
  // and pigs are penned, so their home anchor is just their paddock's
  // center — no need to go hunting for open ground for them.
  for (const species of ["cow", "sheep", "horse", "pig", "goat"]) {
    if (PADDOCKS_WORLD[species]) {
      const p = PADDOCKS_WORLD[species];
      spawnHerd(species, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2);
      continue;
    }
    let hx = FARM.x;
    let hy = FARM.y;
    for (let tries = 0; tries < 200; tries++) {
      const a = rand() * Math.PI * 2;
      const d = FARM_RADIUS + 30 + rand() * 40;
      const cx = FARM.x + Math.cos(a) * d;
      const cy = FARM.y + Math.sin(a) * d;
      if (cx < 24 || cy < 24 || cx > MAP_SIZE - 24 || cy > MAP_SIZE - 24) continue;
      if (tileTypeAt(cx, cy) !== 0) continue;
      if (forestTiles.has(tileKey(cx, cy)) || roadTiles.has(tileKey(cx, cy))) continue;
      if (insideAnyPaddock(cx, cy)) continue; // not this species' pen to graze in
      hx = cx;
      hy = cy;
      break;
    }
    spawnHerd(species, hx, hy);
  }

  // ...and a flock of chickens pecking around the yard itself, plus one cat
  // and one dog that just linger there rather than wandering as a herd
  spawnHerd("chicken", FARM.x, FARM.y, 6 + ((rand() * 4) | 0));
  spawnHerd("cat", FARM.x, FARM.y, 1);
  spawnHerd("dog", FARM.x, FARM.y, 1);

  // A handful of ducks at the waterside nearest the farm, if there's one
  // close enough to be plausibly "theirs"
  {
    const near = nearestShoreSpot(FARM.x, FARM.y);
    if (near && near.dist < 260) spawnHerd("duck", near.spot.x, near.spot.y);
  }

  // Plus a few wild-placed herds further out — cows and pigs are excluded
  // here, since those two are penned at the farm (see PENNED_SPECIES) and
  // have no business grazing loose out in the countryside
  for (let placed = 0, tries = 0; placed < 6 && tries < 400; tries++) {
    const hx = 30 + rand() * (MAP_SIZE - 60);
    const hy = 30 + rand() * (MAP_SIZE - 60);
    if (tileTypeAt(hx, hy) !== 0) continue;
    if (forestTiles.has(tileKey(hx, hy)) || roadTiles.has(tileKey(hx, hy))) continue;
    if (Math.hypot(hx - FARM.x, hy - FARM.y) < FARM_RADIUS + 24) continue;
    if (insideAnyPaddock(hx, hy)) continue;
    const r = rand();
    const species = r < 1 / 3 ? "sheep" : r < 2 / 3 ? "horse" : "goat";
    spawnHerd(species, hx, hy);
    placed++;
  }

  // A couple of wild duck herds at shores further from the farm
  for (let placed = 0, tries = 0; placed < 2 && tries < 60 && shoreSpots.length; tries++) {
    const s = shoreSpots[(rand() * shoreSpots.length) | 0];
    if (Math.hypot(s.x - FARM.x, s.y - FARM.y) < FARM_RADIUS + 100) continue;
    spawnHerd("duck", s.x, s.y);
    placed++;
  }
}

// Step the animal forward along its current heading if the destination is
// walkable; otherwise pivot smoothly in place (an instant turn every frame
// strobes the model) rather than snapping toward some other heading.
function moveOrPivot(a, walkable, speed, pivotRate, dt) {
  const nx = a.wx + Math.cos(a.angle) * speed * dt;
  const ny = a.wy + Math.sin(a.angle) * speed * dt;
  if (walkable(nx, ny)) {
    a.wx = nx;
    a.wy = ny;
  } else {
    a.angle += pivotRate * dt;
  }
}

// Herd spacing: crowding neighbors ease each other apart (also while
// grazing) so animals never stand inside one another.
function updateSeparation(a, spec, dt, walkable) {
  for (const b of animals) {
    if (b === a) continue;
    const dx = a.wx - b.wx;
    const dy = a.wy - b.wy;
    const d = Math.hypot(dx, dy);
    if (d < spec.sep && d > 0.001) {
      const nx = a.wx + (dx / d) * (spec.sep - d) * dt * 3;
      const ny = a.wy + (dy / d) * (spec.sep - d) * dt * 3;
      if (walkable(nx, ny)) {
        a.wx = nx;
        a.wy = ny;
      }
    } else if (d <= 0.001) {
      a.wx += rand() - 0.5; // unstick exact overlaps
    }
  }
}

// The delivery cart spooks animals just like the tractor does: flee
// whichever machine is nearer, sideways off its path (not down the line of
// travel), turning at the species' own pace but always smoothly (no
// snaps). Returns true if the animal fled — fleeing overrides grazing and
// homing for the rest of this frame.
function updateFleeFromMachine(a, spec, dt, walkable, tractorDist) {
  let spook = tractor;
  let spookDist = tractorDist;
  let spookSpeed = Math.abs(tractor.speed);
  if (cart.on) {
    const vd = Math.hypot(a.wx - cart.x, a.wy - cart.y);
    if (vd < spookDist) {
      spook = cart;
      spookDist = vd;
      spookSpeed = cart.moving;
    }
  }
  if (!spec.spook || spookDist >= spec.spook) return false;
  a.pause = 0;
  const tdx = a.wx - spook.x;
  const tdy = a.wy - spook.y;
  const hx = Math.cos(spook.angle);
  const hy = Math.sin(spook.angle);
  const side = tdx * -hy + tdy * hx >= 0 ? 1 : -1;
  const fx = -hy * side + (tdx / (spookDist || 1)) * 0.5;
  const fy = hx * side + (tdy / (spookDist || 1)) * 0.5;
  // Threshold scales with GEAR_SLOW_RATIO like the tractor's own
  // "meaningfully moving" checks — this reads tractor.speed too (or
  // cart.moving, fixed and unrelated to tractor gearing) and was
  // missed by the original tractor-speed rescale
  const want = spookSpeed > 3 * GEAR_SLOW_RATIO ? Math.atan2(fy, fx) : Math.atan2(tdy, tdx);
  const d = Math.atan2(Math.sin(want - a.angle), Math.cos(want - a.angle));
  a.angle += clamp(d, -spec.fleeTurn * dt, spec.fleeTurn * dt);
  // cornered against water or a field: sidle along the obstacle
  moveOrPivot(a, walkable, spec.flee, 3, dt);
  return true;
}

// Tick down a resting pause; returns true while the animal is still paused.
function updatePauseTimer(a, dt) {
  if (a.pause > 0) {
    a.pause -= dt;
    return true;
  }
  return false;
}

// Amble about, turning back toward the herd's home spot when strayed.
// Penned species (pad set) skip the homing pull: the fence (via walkable)
// is their real boundary, so they're free to use the whole paddock rather
// than getting pulled back toward the center once they're spec.range from
// a home point that's just the paddock's middle.
function updateWander(a, spec, pad, dt, walkable) {
  a.angle += (rand() - 0.5) * spec.turn * dt;
  if (!pad && Math.hypot(a.wx - a.hx, a.wy - a.hy) > spec.range) {
    const want = Math.atan2(a.hy - a.wy, a.hx - a.wx);
    const d = Math.atan2(Math.sin(want - a.angle), Math.cos(want - a.angle));
    a.angle += clamp(d, -2.5 * dt, 2.5 * dt);
  }
  // Blocked by water, a field or a road: pivot smoothly until a clear
  // direction opens up
  moveOrPivot(a, walkable, spec.speed, 2.5, dt);
  if (rand() < spec.pauseChance) {
    a.pause = spec.pauseDur[0] + rand() * spec.pauseDur[1];
  }
}

function updateAnimals(dt) {
  for (const a of animals) {
    const spec = ANIMAL_SPECS[a.species];
    const tractorDist = Math.hypot(a.wx - tractor.x, a.wy - tractor.y);
    const pad = PADDOCKS_WORLD[a.species];
    const walkable = (wx, wy) => {
      if (tileTypeAt(wx, wy) !== 0) return false;
      if (!spec.roads && roadTiles.has(tileKey(wx, wy))) return false;
      // Penned species stop at their fence line — inset half a unit so
      // they turn back before visibly clipping through the rails
      if (pad && (wx < pad.x0 + 0.6 || wx > pad.x1 - 0.6 || wy < pad.y0 + 0.6 || wy > pad.y1 - 0.6))
        return false;
      // The rail itself blocks every species, not just the ones penned
      // inside it — otherwise a wandering sheep or goat walks straight
      // through the line and stands astride it, which is what let animals
      // render in front of a fence they should have been behind
      for (const b of FENCE_SOLID_WORLD) {
        if (wx > b.x0 && wx < b.x1 && wy > b.y0 && wy < b.y1) return false;
      }
      // Never walk into the tractor (moving further away is always allowed)
      const td = Math.hypot(wx - tractor.x, wy - tractor.y);
      return td > 5 || td > tractorDist;
    };
    updateSeparation(a, spec, dt, walkable);
    if (updateFleeFromMachine(a, spec, dt, walkable, tractorDist)) continue;
    if (updatePauseTimer(a, dt)) continue;
    updateWander(a, spec, pad, dt, walkable);
  }
}

// Herd routines: every so often a grazing herd ambles to the nearest water
// for a drink, lingers on the bank, and heads home again. Only the home
// anchor moves — the members' ordinary wander-and-home behavior walks them
// there at their own pace.
// Species that stay put rather than roaming to water on their own: the
// chicken flock and farm cat/dog keep to the yard, ducks already live at
// the shore, and cows/pigs are fenced into their paddock (PENNED_SPECIES)
// — none of them have anywhere their routine could send them
const STATIONARY_HERDS = new Set(["chicken", "cat", "dog", "duck", ...PENNED_SPECIES]);

function updateHerds(dt) {
  for (const h of herds) {
    if (STATIONARY_HERDS.has(h.species)) continue;
    h.next -= dt;
    if (h.next > 0) continue;
    if (h.out) {
      for (const a of h.members) {
        a.hx = h.homeX;
        a.hy = h.homeY;
      }
      h.out = false;
      h.next = 60 + rand() * 90;
      continue;
    }
    let spot = null;
    let bd = Infinity;
    for (const s of shoreSpots) {
      const d = Math.hypot(s.x - h.homeX, s.y - h.homeY);
      if (d < bd) {
        bd = d;
        spot = s;
      }
    }
    if (!spot || bd > 140 || bd < 20) {
      // No water worth the walk (or they graze on the bank already)
      h.next = 300;
      continue;
    }
    for (const a of h.members) {
      a.hx = spot.x;
      a.hy = spot.y;
    }
    h.out = true;
    h.next = 30 + rand() * 25; // drink and linger, then head back
  }
}

const birds = [];

// Bird-flock placement is order-sensitive (rand()-consuming), and the
// original sequence placed it after the cart, not with the rest of the
// animal herds - so it's a separate init call from initAnimals(), called
// from main.js at that later point.
function initBirds() {
  for (let flock = 0; flock < 4; flock++) {
    const fx = rand() * MAP_SIZE;
    const fy = rand() * MAP_SIZE;
    const dir = rand() * Math.PI * 2;
    const n = 3 + ((rand() * 4) | 0);
    for (let i = 0; i < n; i++) {
      birds.push({
        wx: fx + (rand() - 0.5) * 30,
        wy: fy + (rand() - 0.5) * 30,
        alt: 26 + rand() * 12,
        dir: dir + (rand() - 0.5) * 0.3,
        phase: rand() * 10,
      });
    }
  }
}

function updateBirds(dt) {
  for (const b of birds) {
    b.dir += (rand() - 0.5) * 0.5 * dt;
    b.wx += Math.cos(b.dir) * 22 * dt;
    b.wy += Math.sin(b.dir) * 22 * dt;
    if (b.wx < -30) b.wx += MAP_SIZE + 60;
    if (b.wx > MAP_SIZE + 30) b.wx -= MAP_SIZE + 60;
    if (b.wy < -30) b.wy += MAP_SIZE + 60;
    if (b.wy > MAP_SIZE + 30) b.wy -= MAP_SIZE + 60;
  }
}

function drawBirds(camX, camY) {
  ctx.fillStyle = "#2e3138";
  for (const b of birds) {
    const x = Math.round(projX(b.wx, b.wy) - camX);
    const y = Math.round(projY(b.wx, b.wy, terrainHeight(b.wx, b.wy) + b.alt) - camY);
    if (x < -4 || x > VIEW_W + 4 || y < -4 || y > VIEW_H + 4) continue;
    if (Math.sin(worldTime * 9 + b.phase) > 0) {
      ctx.fillRect(x - 2, y - 1, 2, 1); // wings up
      ctx.fillRect(x + 1, y - 1, 2, 1);
      ctx.fillRect(x - 1, y, 1, 1);
    } else {
      ctx.fillRect(x - 2, y, 2, 1); // wings down
      ctx.fillRect(x + 1, y, 2, 1);
      ctx.fillRect(x - 1, y - 1, 1, 1);
    }
  }
}
