
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Wood grain for the HUD carpentry: thin streaks with the occasional knot.
// Seeded from the region so the pattern is identical every frame — drawing
// fresh random streaks each frame would shimmer.
function drawWoodGrain(c2d, x, y, w, h) {
  let s = ((x * 73856093) ^ (y * 19349663) ^ (w * 83492791) ^ h) | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = (w * h) / 220; // streak density scales with the area
  for (let i = 0; i < n; i++) {
    const gx = Math.round(x + rnd() * w);
    const gy = Math.round(y + 2 + rnd() * (h - 4));
    const len = 8 + rnd() * 36;
    c2d.fillStyle =
      rnd() < 0.7 ? "rgba(40,24,12,0.18)" : "rgba(255,235,200,0.10)";
    // Two offset segments so it reads as grain, not pinstripes
    const seg1 = Math.round(len * (0.3 + rnd() * 0.5));
    c2d.fillRect(gx, gy, clamp(seg1, 0, x + w - gx), 1);
    c2d.fillRect(
      gx + seg1,
      gy + (rnd() < 0.5 ? 1 : -1),
      clamp(len - seg1, 0, x + w - gx - seg1),
      1
    );
    if (rnd() < 0.06) {
      // a knot in the plank
      c2d.fillStyle = "rgba(40,24,12,0.22)";
      c2d.fillRect(gx, gy - 1, 2, 3);
      c2d.fillRect(gx - 1, gy, 4, 1);
    }
  }
}

// The HUD's wooden chrome never changes, so the plank bars and the minimap's
// panel are prerendered once and blitted per frame instead of rebuilding
// their fills and grain streaks. Each prerender keeps its on-screen
// coordinates via translate, so the grain (seeded from x/y/w/h) stays put.
const topH = 28; // top bar height, shared by the layout below
const barY = screenCanvas.height - 28; // bottom bar top edge

const mmScale = 2;
const mmW = minimapCanvas.width * mmScale;
const mmH = minimapCanvas.height * mmScale;
const mmX = screenCanvas.width - mmW - 8;
const mmY = topH + 8;

function prerenderPanel(x, y, w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const p = c.getContext("2d");
  p.translate(-x, -y);
  paint(p);
  return c;
}

const hudTopCanvas = prerenderPanel(0, 0, screenCanvas.width, topH + 3, (p) => {
  p.fillStyle = "#7a4f2d";
  p.fillRect(0, 0, screenCanvas.width, topH);
  p.fillStyle = "#4a2f1a";
  p.fillRect(0, topH, screenCanvas.width, 3);
  p.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
  for (let px = 40; px < screenCanvas.width; px += 80) p.fillRect(px, 0, 1, topH);
  drawWoodGrain(p, 0, 0, screenCanvas.width, topH);
  p.fillStyle = "rgba(255,240,200,0.15)"; // sun-bleached lower edge
  p.fillRect(0, topH - 1, screenCanvas.width, 1);
});

const hudBottomCanvas = prerenderPanel(0, barY - 3, screenCanvas.width, 31, (p) => {
  p.fillStyle = "#4a2f1a";
  p.fillRect(0, barY - 3, screenCanvas.width, 3);
  p.fillStyle = "#7a4f2d";
  p.fillRect(0, barY, screenCanvas.width, 28);
  p.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
  for (let px = 40; px < screenCanvas.width; px += 80) p.fillRect(px, barY, 1, 28);
  drawWoodGrain(p, 0, barY, screenCanvas.width, 28);
  p.fillStyle = "rgba(255,240,200,0.15)"; // sun-bleached top edge
  p.fillRect(0, barY, screenCanvas.width, 1);
});

const minimapPanelCanvas = prerenderPanel(mmX - 8, topH, mmW + 16, mmH + 16, (p) => {
  p.fillStyle = "#4a2f1a"; // rim, continuous with the bar trim
  p.fillRect(mmX - 8, topH, mmW + 16, mmH + 16);
  p.fillStyle = "rgba(122,79,45,0.95)"; // plank fill
  p.fillRect(mmX - 5, topH + 3, mmW + 10, mmH + 10);
  drawWoodGrain(p, mmX - 5, topH + 3, mmW + 10, mmH + 10);
});

// The field ledger strip hangs flush under the minimap panel; its plank
// starts right at the joint so the minimap's bottom rim reads as the
// seam between the two pieces.
const tallyY = topH + mmH + 16;
const tallyH = 20;
const fieldTallyPanelCanvas = prerenderPanel(mmX - 8, tallyY, mmW + 16, tallyH, (p) => {
  p.fillStyle = "#4a2f1a"; // rim
  p.fillRect(mmX - 8, tallyY, mmW + 16, tallyH);
  p.fillStyle = "rgba(122,79,45,0.95)"; // plank fill
  p.fillRect(mmX - 5, tallyY, mmW + 10, tallyH - 3);
  drawWoodGrain(p, mmX - 5, tallyY, mmW + 10, tallyH - 3);
});

// Tiny pixel icons for the top bar: a note for the music, a speaker for the
// sound effects. Muted draws dim with a red strike across.
function iconStrike(x, y) {
  screenCtx.fillStyle = "#ff5040";
  for (let i = 0; i < 6; i++) screenCtx.fillRect(x + i * 2, y + 10 - i * 2, 2, 2);
}

function drawNoteIcon(x, y, on) {
  screenCtx.fillStyle = on ? "#f5e9c8" : "#4a2f1a";
  screenCtx.fillRect(x + 3, y + 1, 7, 2); // beam
  screenCtx.fillRect(x + 3, y + 1, 2, 8); // stems
  screenCtx.fillRect(x + 8, y + 1, 2, 8);
  screenCtx.fillRect(x + 1, y + 8, 4, 3); // note heads
  screenCtx.fillRect(x + 6, y + 8, 4, 3);
  if (!on) iconStrike(x, y);
}

function drawSpeakerIcon(x, y, on) {
  screenCtx.fillStyle = on ? "#f5e9c8" : "#4a2f1a";
  screenCtx.fillRect(x, y + 4, 3, 4); // box
  screenCtx.beginPath(); // cone
  screenCtx.moveTo(x + 3, y + 6);
  screenCtx.lineTo(x + 7, y + 2);
  screenCtx.lineTo(x + 7, y + 10);
  screenCtx.closePath();
  screenCtx.fill();
  if (on) {
    screenCtx.strokeStyle = "#f5e9c8"; // sound waves
    screenCtx.lineWidth = 1;
    screenCtx.beginPath();
    screenCtx.arc(x + 7, y + 6, 3, -0.8, 0.8);
    screenCtx.stroke();
    screenCtx.beginPath();
    screenCtx.arc(x + 7, y + 6, 5.5, -0.8, 0.8);
    screenCtx.stroke();
  } else {
    iconStrike(x, y);
  }
}

function draw() {
  // Scene, sky and weather compositing: everything that isn't HUD/overlay
  function drawWorldAndWeather() {
    const camX = Math.round(cam.x);
    const camY = Math.round(cam.y);

    // Sky beyond the map edges: the farm floats like a little island
    ctx.drawImage(skyCanvas, 0, 0);
    drawSun();
    drawClouds(camX, camY);

    ctx.drawImage(mapCanvas, -MAP_OFFSET_X - camX, -MAP_OFFSET_Y - camY);
    drawScene(camX, camY);
    drawSmoke(camX, camY);
    drawButterflies(camX, camY);
    drawLadybug(camX, camY);
    drawBirds(camX, camY);
    drawMist(camX, camY);

    screenCtx.drawImage(view, 0, 0, screenCanvas.width, screenCanvas.height);
  }
  drawWorldAndWeather();

  // Text is stamped: a dark offset shadow under warm cream
  const label = (str, x, y, color) => {
    screenCtx.fillStyle = "rgba(40,24,12,0.9)";
    screenCtx.fillText(str, x + 1, y + 1);
    screenCtx.fillStyle = color;
    screenCtx.fillText(str, x, y);
  };

  // A HUD line writer: stamps left-to-right along one baseline, advancing
  // its own cursor past each segment's measured width. Bottom and top bars
  // each get one, independent cursors starting at the same left margin.
  const makeSegWriter = (y, startX) => {
    let x = startX;
    return (text, color) => {
      label(text, x, y, color || "#f5e9c8");
      x += screenCtx.measureText(text).width;
    };
  };

  // HUD: a worn wooden plank bar along the bottom (prerendered)
  function drawBottomHud() {
  const imp = IMPLEMENTS[tractor.implement];
  screenCtx.drawImage(hudBottomCanvas, 0, barY - 3);
  screenCtx.font = "bold 13px monospace";
  const hudY = screenCanvas.height - 10;
  const seg = makeSegWriter(hudY, 12);
  const RED = "#ff5040";
  const flashImpl = tractor.implFlash > 0 && ((tractor.implFlash * 8) | 0) % 2 === 0;
  // Gear and implement move as one: road mode is fast with the implement
  // raised, work mode slow with it lowered — the lift state is still shown,
  // for the bounce when there's no field dirt to drop into. The attached
  // implement is named by the highlight in the farm list.
  const state =
    (imp.liftable ? (tractor.implDown ? ", IMPLEMENT DOWN" : ", IMPLEMENT UP") : "") +
    (autoThrottleOn ? "" : ", AUTO OFF");
  seg(`MODE: ${tractor.fastGear ? "ROAD" : "WORK"}${state} [Space][A]   `, flashImpl ? RED : null);
  if (tractor.implement === "seeder") {
    // Solid red when the hopper is empty; flashing when it's empty AND the
    // seeder is down working a field — driving along planting nothing
    const dryRun =
      seeds === 0 &&
      tractor.implLift < 0.3 &&
      Math.abs(tractor.speed) > MOVING_THRESHOLD &&
      implementOverField();
    const seedColor = dryRun
      ? ((worldTime * 6) | 0) % 2 === 0
        ? RED
        : null
      : seeds === 0
        ? RED
        : null;
    seg(`SEEDS: ${seeds}   `, seedColor);
  }
  if (tractor.implement === "trailer") {
    // Flash when the trailer is full while rolling over a field — passing
    // by grain sacks it has no room to pick up
    const fullRun =
      cargo === TRAILER_CAP &&
      Math.abs(tractor.speed) > MOVING_THRESHOLD &&
      implementOverField();
    const cargoColor = fullRun && ((worldTime * 6) | 0) % 2 === 0 ? RED : null;
    seg(`CARGO: ${cargo}/${TRAILER_CAP}${atCity ? " @TOWN" : ""}   `, cargoColor);
  }
  const lucky = luckFlash > 0 && ((luckFlash * 8) | 0) % 2 === 0;
  seg(`CASH: £${cash}   `, lucky ? "#c9e6a8" : cash < SEED_PRICE ? RED : "#ffd94f");
  seg(`SOLD: ${sold}   `);
  const fuelPct = Math.round((fuel / FUEL_CAP) * 100);
  seg(
    `FUEL: ${fuelPct}%${atFuelTank ? " @TANK" : ""}   `,
    fuelPct <= 20 ? RED : null
  );
  // The implement list at the farm, with the attached one lit up
  seg(`@FARM `, "#d8c49a");
  const IMPLEMENT_HINTS = { plow: "PLOW", seeder: "SEED", harvester: "HARVEST", trailer: "TRAILER" };
  for (const [key, impName] of Object.entries(IMPLEMENT_KEYS)) {
    seg(
      `${key}:${IMPLEMENT_HINTS[impName]} `,
      tractor.implement === impName ? "#ffd94f" : "#d8c49a"
    );
  }
  }
  drawBottomHud();

  // The top HUD is a single-line plank bar matching the bottom one, trim
  // mirrored: mode, map and the pause/menu hint on the left, the season
  // calendar in the middle with the year folded into its date label, and
  // the mute icons and FPS on the right
  function drawTopHud() {
  screenCtx.drawImage(hudTopCanvas, 0, 0);

  screenCtx.font = "11px monospace";
  const topY = 18; // shared text baseline in the bar

  // Left: mode, map, and the pause/menu hint
  const topSeg = makeSegWriter(topY, 12);
  topSeg(`#${MAP_INDEX} ${PROFILE.name.toUpperCase()}  `);
  topSeg(`${mode.toUpperCase()}   `, "#ffd94f");

  // Season calendar instead of a clock: the year and date count continuously
  // Jan 1 through Dec 31 along a wooden trough; in survival the tax bill
  // comes due at Dec 31, flashing red for the last 30 seconds before it.
  const day = currentCalendarDay();
  const progress = day / 365;
  const date = new Date(2001, 0, 1 + day);
  const barW = 140;
  const barH = 8;
  const bx = (screenCanvas.width - barW) / 2;
  const by = 10;
  // Nothing is due at year's end in sandbox, so no red urgency flash there
  const flash =
    mode !== "sandbox" && timeLeft < 30 && ((timeLeft * 2) | 0) % 2 === 0;
  const taxJustPaid = mode === "survival" && taxFlash > 0 && !gameOver;
  // The banner shows the year the bill was actually for — the year counter
  // itself has already rolled over to the new year by the time it's shown
  const yearShown = taxJustPaid ? taxYear : year;
  screenCtx.textAlign = "right";
  label(
    `Y${yearShown} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`,
    bx - 8,
    topY,
    flash ? "#ff5040" : "#f5e9c8"
  );
  screenCtx.textAlign = "left";
  const endLabel = taxJustPaid
    ? `-£${taxPaid} PAID`
    : mode === "survival"
      ? `TAX £${propertyTax}`
      : "DEC 31";
  label(endLabel, bx + barW + 8, topY, taxJustPaid ? "#ff5040" : "#d8c49a");
  // The season grows along a wooden trough
  screenCtx.fillStyle = "#4a2f1a";
  screenCtx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
  screenCtx.fillStyle = "#2e1d10";
  screenCtx.fillRect(bx, by, barW, barH);
  screenCtx.fillStyle = flash ? "#ff5040" : seasonHex(SEASON_BAR_COLORS);
  screenCtx.fillRect(bx, by, Math.round(barW * progress), barH);

  // Right: the pause/menu hint, then the music & sound icons
  let rx = screenCanvas.width - 12;
  drawSpeakerIcon(rx - 13, 8, !soundMuted);
  rx -= 13 + 10;
  drawNoteIcon(rx - 12, 8, !musicMuted);
  rx -= 12 + 14;
  screenCtx.textAlign = "right";
  label(`[P] PAUSE  [F1] MENU`, rx, topY, "#d8c49a");
  screenCtx.textAlign = "left";
  }
  drawTopHud();

  // Game over: final score and the all-time best list
  function drawGameOverOverlay() {
  if (!gameOver) return;
  {
    const w = 460;
    const h = 260;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    // Dusk settles over the farm
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A big wooden signboard
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.fillStyle = "rgba(0,0,0,0.12)"; // plank seams
    for (let py = y + 52; py < y + h; py += 52) screenCtx.fillRect(x, py, w, 1);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 24px monospace";
    label("BANKRUPT — THE FARM IS LOST", cx, y + 40, "#ff7a5c");
    screenCtx.font = "bold 18px monospace";
    label(
      `SURVIVED ${year} YEAR${year === 1 ? "" : "S"}   (£${cash})`,
      cx,
      y + 74,
      "#f5e9c8"
    );
    screenCtx.font = "13px monospace";
    bestScores.forEach((entry, i) => {
      label(
        `${i + 1}.  ${entry.years} YEAR${entry.years === 1 ? " " : "S"}   £${entry.cash}   (map ${entry.map ?? entry.seed ?? "?"})`,
        cx,
        y + 106 + i * 20,
        i === finalRank ? "#ffd94f" : "#e0d0a8"
      );
    });
    label(
      "[S] SWITCH TO SANDBOX, KEEP FARMING   [F1] MENU — NEW GAME",
      cx,
      y + h - 18,
      "#c9e6a8"
    );
    screenCtx.textAlign = "left";
  }
  }
  drawGameOverOverlay();

  // Minimap: a wooden panel hanging off the right end of the top bar,
  // flush with the screen edge. Its dark rim starts at the bar's trim in
  // the same color, so the two read as one piece of carpentry.
  function drawMinimapPanel() {
  screenCtx.drawImage(minimapPanelCanvas, mmX - 8, topH);
  screenCtx.drawImage(minimapCanvas, mmX, mmY, mmW, mmH);
  screenCtx.save();
  screenCtx.beginPath();
  screenCtx.rect(mmX, mmY, mmW, mmH);
  screenCtx.clip();
  // Camera viewport (the minimap shares the iso projection, minus heights,
  // so the projected view rectangle maps straight onto it)
  screenCtx.strokeStyle = "rgba(255,255,255,0.8)";
  screenCtx.lineWidth = 1;
  screenCtx.strokeRect(
    mmX + ((cam.x + MAP_SIZE) / TILE) * mmScale,
    mmY + (cam.y / TILE) * mmScale,
    (VIEW_W / TILE) * mmScale,
    (VIEW_H / TILE) * mmScale
  );
  // Tractor
  const tmx = mmX + ((tractor.x - tractor.y) / TILE + MAP_TILES) * mmScale;
  const tmy = mmY + ((tractor.x + tractor.y) / (2 * TILE)) * mmScale;
  screenCtx.fillStyle = "#ffffff";
  screenCtx.fillRect(tmx - 2, tmy - 2, 4, 4);
  screenCtx.fillStyle = TRACTOR_BODY;
  screenCtx.fillRect(tmx - 1, tmy - 1, 2, 2);
  screenCtx.restore();
  }
  drawMinimapPanel();

  // Field ledger strip under the minimap: a count per working state
  // (stubble, plowed, sown, ripe) with the total at the right end. Each
  // swatch is the state's minimap tile color, so the strip doubles as the
  // minimap's legend.
  function drawFieldLedger() {
  screenCtx.drawImage(fieldTallyPanelCanvas, mmX - 8, tallyY);
  const tally = countFieldTiles();
  screenCtx.font = "11px monospace";
  let tallyX = mmX;
  for (const [count, color] of [
    [tally.stubble, MINIMAP_COLORS[1]],
    [tally.plowed, MINIMAP_COLORS[2]],
    [tally.sown, MINIMAP_COLORS[3]],
    [tally.ripe, "#e3c355"],
  ]) {
    screenCtx.fillStyle = "rgba(40,24,12,0.9)"; // swatch backing, like the text shadow
    screenCtx.fillRect(tallyX, tallyY + 5, 8, 8);
    screenCtx.fillStyle = color;
    screenCtx.fillRect(tallyX + 1, tallyY + 6, 6, 6);
    label(String(count), tallyX + 11, tallyY + 13, "#f5e9c8");
    tallyX += 11 + screenCtx.measureText(String(count)).width + 8;
  }
  screenCtx.textAlign = "right";
  label(
    `=${tally.stubble + tally.plowed + tally.sown + tally.ripe}`,
    mmX + mmW,
    tallyY + 13,
    "#ffd94f"
  );
  screenCtx.textAlign = "left";
  }
  drawFieldLedger();

  // Paused: dusk settles over the farm and a small sign waits for P.
  // The F1 menu draws after this, so it stays readable on top.
  function drawPauseOverlay() {
  if (!paused || menuOpen) return;
  {
    const w = 260;
    const h = 74;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A little wooden sign matching the menu's carpentry
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 24px monospace";
    label("PAUSED", cx, y + 34, "#ffd94f");
    screenCtx.font = "13px monospace";
    label("[P] RESUME", cx, y + 58, "#c9e6a8");
    screenCtx.textAlign = "left";
    screenCtx.font = "11px monospace";
  }
  }
  drawPauseOverlay();

  // Date-jump field: shows the typed digits in an MM-DD mask; Enter
  // fast-forwards the calendar to that date. Red digits mean the last
  // attempt didn't parse as a reachable date.
  function drawDateJumpOverlay() {
  if (dateJump === null || menuOpen) return;
  {
    const w = 280;
    const h = 96;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A little wooden sign matching the menu's carpentry
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 16px monospace";
    label("JUMP TO DATE", cx, y + 26, "#ffd94f");
    const digitAt = (i) => dateJump[i] || "_";
    screenCtx.font = "bold 24px monospace";
    label(
      `${digitAt(0)}${digitAt(1)}-${digitAt(2)}${digitAt(3)}`,
      cx,
      y + 56,
      dateJumpError ? "#ff5040" : "#f5e9c8"
    );
    screenCtx.font = "11px monospace";
    label("[0-9] MONTH-DAY   [ENTER] GO   [ESC] CANCEL", cx, y + 80, "#c9e6a8");
    screenCtx.textAlign = "left";
    screenCtx.font = "11px monospace";
  }
  }
  drawDateJumpOverlay();

  // Start / F1 menu: map and mode on a little wooden sign. A fresh visit
  // opens it before the clock starts; F1 brings it back later.
  function drawStartMenuOverlay() {
  if (!menuOpen) return;
  {
    const w = 420;
    const h = 256;
    const x = (screenCanvas.width - w) / 2;
    const y = (screenCanvas.height - h) / 2;
    const cx = screenCanvas.width / 2;
    screenCtx.fillStyle = "rgba(24,14,6,0.45)";
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    screenCtx.fillStyle = "#4a2f1a";
    screenCtx.fillRect(x - 6, y - 6, w + 12, h + 12);
    screenCtx.fillStyle = "#7a4f2d";
    screenCtx.fillRect(x, y, w, h);
    screenCtx.textAlign = "center";
    screenCtx.font = "bold 16px monospace";
    label(gameStarted ? "MENU" : "THE HOME FARM", cx, y + 26, "#ffd94f");

    screenCtx.font = "11px monospace";
    label("MAP", cx, y + 46, "#d8c49a");
    screenCtx.fillStyle = "#2e1d10";
    screenCtx.fillRect(x + 90, y + 52, w - 180, 24);
    screenCtx.font = "bold 14px monospace";
    label(
      `« ${menuMap} — ${MAP_PROFILES[menuMap - 1].name.toUpperCase()} »`,
      cx,
      y + 69,
      "#f5e9c8"
    );

    screenCtx.font = "bold 12px monospace";
    const modeRows = [
      ["survival", "SURVIVAL — PAY THE YEARLY TAX, SURVIVE"],
      ["sandbox", "SANDBOX  — NO CLOCK PRESSURE, JUST ROAM"],
    ];
    modeRows.forEach(([m, text], i) => {
      const sel = menuMode === m;
      label((sel ? "» " : "  ") + text, cx, y + 104 + i * 20, sel ? "#ffd94f" : "#e0d0a8");
    });

    screenCtx.font = "11px monospace";
    label(
      `[T] AWAY CLOCK: ${awayClock ? "ON " : "OFF"} — TIME PASSES WHILE THE TAB IS HIDDEN`,
      cx,
      y + 172,
      awayClock ? "#c9e6a8" : "#d8c49a"
    );
    label(
      `[M] MUSIC: ${musicMuted ? "OFF" : "ON "}      [Q] SOUND: ${soundMuted ? "OFF" : "ON "}`,
      cx,
      y + 192,
      "#d8c49a"
    );
    if (menuSaveInfo) {
      label(
        `[C] CONTINUE — ${menuSaveInfo.mode.toUpperCase()}, MAP ${menuSaveInfo.map}, YEAR ${menuSaveInfo.year}`,
        cx,
        y + 212,
        "#c9e6a8"
      );
    }
    label(
      "[←→] MAP   [↑↓] MODE   [R] RANDOM MAP   [ENTER] START" +
        (gameStarted ? "   [ESC] CLOSE" : ""),
      cx,
      y + h - 14,
      "#c9e6a8"
    );
    screenCtx.textAlign = "left";
  }
  }
  drawStartMenuOverlay();

  function drawFpsReadout() {
  if (!fpsShown) return;
  {
    // Debug readout sits over the open world, so it gets its own dark
    // plate for contrast instead of relying on the stamped shadow alone
    screenCtx.font = "bold 11px monospace";
    screenCtx.textAlign = "left";
    const simRate = mode === "sandbox" ? sandboxClockRate() : 1;
    const text = `${fpsValue} FPS  ${simRate}× SIM`;
    const textW = screenCtx.measureText(text).width;
    screenCtx.fillStyle = "rgba(40,24,12,0.8)";
    screenCtx.fillRect(4, topH + 6, textW + 9, 15);
    label(text, 8, topH + 17, "#ffe89a");
  }
  }
  drawFpsReadout();
}
