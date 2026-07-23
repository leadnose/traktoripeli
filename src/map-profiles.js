// ---------------------------------------------------------------------------
// Map profiles: the world is always one of exactly 10 fixed archetypes,
// each with its own RNG seed (so it's exactly as reproducible as a free
// seed used to be) and its own target ranges for water/field/forest
// coverage and hill scale. Within its own ranges a map still rolls organic
// variation call to call — the bands just keep it from ever drifting into a
// different archetype the way an arbitrary free-form seed could.
// water and field are shares the generator always rolled (water: share of
// the whole grid, field: share of dry land). forest is a share of what's
// left over after water and field — the open, unfarmed grass — so forest
// and "free land" are a direct complementary pair: forest: [0,1] means
// none of that leftover land is wooded (all free/open grass) up to all of
// it (no free land at all), and every value in between is reachable.
// meadow is, in turn, a share of whatever free grass forest didn't claim —
// open ground given over to tall wildflower patches instead of plain grass.
// hilliness is a multiplier on the hill generator's stock count/height.
// ---------------------------------------------------------------------------

// Each profile also carries a palette: the map's own take on ground, water,
// sky and canopy color, so e.g. Highlands reads as cool heather moorland
// while Patchwork Farm reads as bright cultivated lowland. grass/dirt/skyTop/
// skyBottom/canopy are [spring, summer, autumn] triples fed through the same
// seasonHex() wheel as before; water/road/conifer are single tones (conifers
// don't turn with the seasons, and water/roads read as one steady color
// year-round). Everything else — dot speckles, furrows, bridges, ditches,
// minimap tones, tree canopy tiers — is derived from these few tones at load
// time via tint(), so a new theme only needs these fields.

export const MAP_PROFILES = [
  {
    name: "Homestead Plains", seed: 1137, water: [0.03, 0.10], field: [0.45, 0.65], forest: [0.10, 0.25], meadow: [0.20, 0.40], hilliness: [0.4, 0.6], broadleaf: 0.8,
    palette: {
      grass: ["#78b064", "#609554", "#a69e62"],
      dirt: ["#9c8771", "#9c8771", "#9c8771"],
      water: "#4e7eb3",
      skyTop: ["#93b8cc", "#8ab0c3", "#9db1c0"],
      skyBottom: ["#d4e5ec", "#cee0e6", "#e0e1cb"],
      road: "#b2a38e",
      canopy: ["#659f61", "#5f945a", "#a18049"],
      conifer: "#365938",
    },
  },
  {
    name: "River Valley", seed: 1274, water: [0.35, 0.50], field: [0.20, 0.35], forest: [0.15, 0.30], meadow: [0.15, 0.30], hilliness: [0.8, 1.2], broadleaf: 0.6,
    palette: {
      grass: ["#73ad60", "#5a8d4e", "#9d955a"],
      dirt: ["#937c65", "#937c65", "#937c65"],
      water: "#4e85b7",
      skyTop: ["#97b9cd", "#8bafc3", "#99aebd"],
      skyBottom: ["#d7e5eb", "#d0e0e5", "#dadbc6"],
      road: "#aa9a86",
      canopy: ["#639b5f", "#598d57", "#9c7c47"],
      conifer: "#365938",
    },
  },
  {
    name: "Highlands", seed: 1411, water: [0.10, 0.20], field: [0.15, 0.30], forest: [0.30, 0.50], meadow: [0.25, 0.45], hilliness: [1.7, 2.2], broadleaf: 0.1,
    palette: {
      grass: ["#7d8863", "#707d56", "#90875e"],
      dirt: ["#8b8376", "#8b8376", "#8b8376"],
      water: "#607a86",
      skyTop: ["#95a0a8", "#8b98a1", "#89929a"],
      skyBottom: ["#ced5d7", "#c8d0d3", "#d0d0c5"],
      road: "#9b9488",
      canopy: ["#6a7d5a", "#5e6f50", "#8b764c"],
      conifer: "#3e4e42",
      flowers: ["#b48fd1", "#ffffff", "#e0d156"], // heather and gorse, not the usual meadow mix
    },
  },
  {
    name: "Deep Woods", seed: 1548, water: [0.20, 0.35], field: [0.05, 0.15], forest: [0.85, 1.00], meadow: [0.00, 0.10], hilliness: [0.8, 1.2], broadleaf: 0.25,
    palette: {
      grass: ["#659058", "#547e4c", "#8e8856"],
      dirt: ["#786b5a", "#786b5a", "#786b5a"],
      water: "#416989",
      skyTop: ["#86a5b8", "#7d9eb0", "#8c9ead"],
      skyBottom: ["#c9d9de", "#c4d5d6", "#d4d4c2"],
      road: "#9b8d7d",
      canopy: ["#4a754d", "#3f6642", "#846f40"],
      conifer: "#2d4436",
    },
  },
  {
    name: "Patchwork Farm", seed: 1685, water: [0.03, 0.10], field: [0.55, 0.72], forest: [0.00, 0.08], meadow: [0.35, 0.55], hilliness: [0.4, 0.6], broadleaf: 0.85,
    palette: {
      grass: ["#82b96c", "#679d5a", "#aca46e"],
      dirt: ["#a08b73", "#a08b73", "#a08b73"],
      water: "#5a8cbb",
      skyTop: ["#9abdd0", "#91b6c9", "#a2b6c5"],
      skyBottom: ["#d8e9ef", "#d3e5ea", "#e3e5cf"],
      road: "#b8a995",
      canopy: ["#6ca467", "#64965e", "#ad8d4e"],
      conifer: "#365938",
    },
  },
  {
    name: "Lake District", seed: 1822, water: [0.45, 0.60], field: [0.10, 0.20], forest: [0.10, 0.25], meadow: [0.20, 0.35], hilliness: [0.4, 0.6], broadleaf: 0.45,
    palette: {
      grass: ["#76b568", "#609c57", "#a19a5f"],
      dirt: ["#95846e", "#95846e", "#95846e"],
      water: "#5091c3",
      skyTop: ["#98bfd1", "#8eb7ca", "#9fb7c6"],
      skyBottom: ["#cee5ec", "#c9e1e8", "#dcdeca"],
      road: "#ab9c88",
      canopy: ["#68a463", "#5e9359", "#9d8148"],
      conifer: "#39603f",
    },
  },
  {
    name: "Rolling Hills", seed: 1959, water: [0.10, 0.20], field: [0.30, 0.45], forest: [0.30, 0.50], meadow: [0.25, 0.45], hilliness: [1.3, 1.7], broadleaf: 0.65,
    palette: {
      grass: ["#7cb065", "#659757", "#a99e65"],
      dirt: ["#9b8771", "#9b8771", "#9b8771"],
      water: "#5785b1",
      skyTop: ["#96bbcd", "#8db3c5", "#9fb2be"],
      skyBottom: ["#d5e5eb", "#d0dfe4", "#e1e2cb"],
      road: "#afa08c",
      canopy: ["#67a062", "#5e925b", "#a1824b"],
      conifer: "#3c6441",
    },
  },
  {
    name: "Wetlands", seed: 2096, water: [0.35, 0.50], field: [0.05, 0.15], forest: [0.60, 0.80], meadow: [0.05, 0.20], hilliness: [0.4, 0.6], broadleaf: 0.7,
    palette: {
      grass: ["#789465", "#698558", "#89885f"],
      dirt: ["#70695b", "#70695b", "#70695b"],
      water: "#4f7061",
      skyTop: ["#99aeb4", "#90a7ad", "#9ba5a5"],
      skyBottom: ["#d6e0df", "#d0dcdc", "#d2d5c4"],
      road: "#8b8373",
      canopy: ["#62865c", "#567851", "#8b8051"],
      conifer: "#394f40",
    },
  },
  {
    name: "The Common", seed: 2233, water: [0.03, 0.10], field: [0.05, 0.15], forest: [0.00, 0.08], meadow: [0.45, 0.65], hilliness: [0.8, 1.2], broadleaf: 0.6,
    palette: {
      grass: ["#8ea369", "#7d915b", "#a99f61"],
      dirt: ["#a2907a", "#a2907a", "#a2907a"],
      water: "#638fb4",
      skyTop: ["#b5cad8", "#adc2d0", "#adb9c1"],
      skyBottom: ["#e6eff2", "#e1eaee", "#dfe1cb"],
      road: "#b5a894",
      canopy: ["#7da469", "#6e935d", "#a38b51"],
      conifer: "#436245",
    },
  },
  {
    name: "The Weald", seed: 2370, water: [0.10, 0.20], field: [0.05, 0.15], forest: [0.85, 1.00], meadow: [0.00, 0.10], hilliness: [1.7, 2.2], broadleaf: 0.75,
    palette: {
      grass: ["#69885c", "#59794f", "#7f7a4c"],
      dirt: ["#7b6d5e", "#7b6d5e", "#7b6d5e"],
      water: "#497088",
      skyTop: ["#8caabb", "#81a1b2", "#8897a1"],
      skyBottom: ["#cbdbde", "#c6d6da", "#d1d3c0"],
      road: "#968978",
      canopy: ["#568457", "#4a764c", "#817045"],
      conifer: "#2c4435",
    },
  },
];
