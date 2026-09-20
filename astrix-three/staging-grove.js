// Staging grove compositions (VEGETATION INTEGRATION GATE only).
// snapshot-free, deterministic, authored clusters. Loaded by main.js only when
// ?staging=grove. NEVER touches Core, manifest, or the live world.
// [asset, dx, dz, ryDeg, scale] — authored positions relative to site.
export const GROVES = [
  { site: [-38, 28], name: 'settlement-edge SW', items: [
    // background emergents (depth) — kept clear of housing lots (audit 09-19)
    ['ASTX_VEG_CANOPY_A', -14, -10, 20, 1.15],
    ['ASTX_VEG_CANOPY_A', -2, -12, 140, 1.0],
    ['ASTX_VEG_PALM_A', 18, -6, 0, 1.0],
    // midground secondary
    ['ASTX_VEG_CANOPY_A', -12, -14, 75, 0.85],
    ['ASTX_VEG_SHRUB_A', -14, 8, 0, 1.1],
    ['ASTX_VEG_SHRUB_A', 6, -6, 0, 1.0],
    ['ASTX_VEG_SHRUB_A', 2, 8, 0, 0.9],
    ['ASTX_VEG_SHRUB_A', -2, -8, 0, 1.0],
    // foreground ground layer
    ['ASTX_VEG_GRASS_A', -2, 12, 0, 1.4],
    ['ASTX_VEG_GRASS_A', 4, 4, 0, 1.2],
    ['ASTX_VEG_GRASS_A', 0, 10, 0, 1.5],
    ['ASTX_VEG_GRASS_A', -14, -4, 0, 1.1],
    ['ASTX_VEG_GRASS_A', 9, 2, 0, 1.3],
    ['ASTX_VEG_FLOWERS_A', 0, 10, 0, 1.2],
    ['ASTX_VEG_FLOWERS_A', 5, 7, 0, 1.0],
    ['ASTX_VEG_FLOWERS_A', 1, -4, 0, 1.1],
  ] },
  { site: [0, 0], name: 'south-beach coast (barrier bar + mainland fringe)', items: [
    // barrier bar (dry sand z 158-182): palms + scrub, lean seaward
    ['ASTX_VEG_PALM_A', -8, 168, 10, 1.0],
    ['ASTX_VEG_PALM_A', 7, 170, -12, 0.9],
    ['ASTX_VEG_SCRUB_A', -14, 164, 0, 1.1],
    ['ASTX_VEG_SCRUB_A', 12, 166, 0, 1.0],
    ['ASTX_VEG_SCRUB_A', 2, 162, 0, 0.9],
    ['ASTX_VEG_GRASS_A', -5, 172, 0, 1.3],
    ['ASTX_VEG_GRASS_A', 6, 174, 0, 1.2],
    ['ASTX_VEG_GRASS_A', 0, 166, 0, 1.0],
    // mainland beach fringe (dry z 118-128)
    ['ASTX_VEG_PALM_A', -6, 124, 5, 0.95],
    ['ASTX_VEG_SCRUB_A', 8, 122, 0, 1.0],
    ['ASTX_VEG_GRASS_A', 0, 126, 0, 1.2],
    ['ASTX_VEG_SHRUB_A', -11, 120, 0, 0.9],
  ] },
  { site: [-48, -58], name: 'ridge cliff foot', items: [
    // geology dominant: tufts on ledges, one sparse shrub, grass pockets
    ['ASTX_VEG_CLIFFTUFT_A', -4, 2, 0, 1.2],
    ['ASTX_VEG_CLIFFTUFT_A', 3, -3, 0, 1.0],
    ['ASTX_VEG_CLIFFTUFT_A', 0, 6, 0, 0.9],
    ['ASTX_VEG_CLIFFTUFT_A', 6, 3, 0, 1.1],
    ['ASTX_VEG_SHRUB_A', -7, -4, 0, 0.8],
    ['ASTX_VEG_GRASS_A', 2, 9, 0, 1.0],
    ['ASTX_VEG_GRASS_A', -2, -9, 0, 0.9],
  ] },
  { site: [8, -88], name: 'ridge forest N slope (Gate C)', items: [
    // COMPOSITION v2: closed-canopy core (~30x26m). Canopy centers 6-9m apart
    // so 4-7m crowns OVERLAP; sightline corridor dx 0..6/dz +2..+10 kept low.
    // INTERLEAVED by layer so low/med rungs keep vertical structure.
    ['ASTX_VEG_CANOPY_B', -8, -10, 10, 1.1],    // emergent bg
    ['ASTX_VEG_UNDERSTORY_A', -4, -6, 20, 1.0], // mid under spire
    ['ASTX_VEG_CANOPY_A', 0, -8, 40, 1.0],      // umbrella core
    ['ASTX_VEG_FERN_A', 4, -4, 0, 1.2],         // ground between trunks
    ['ASTX_VEG_CANOPY_C', 8, -10, 75, 1.0],     // banyan ceiling
    ['ASTX_VEG_FLOOR_A', -2, -2, 30, 1.2],      // debris infill
    ['ASTX_VEG_CANOPY_B', 13, -17, 200, 1.0],   // 2nd-rank spire
    ['ASTX_VEG_SHRUB_A', -11, -2, 0, 1.0],      // edge shrub W
    ['ASTX_VEG_CANOPY_A', -14, -8, 160, 0.95],  // core W (overlaps B)
    ['ASTX_VEG_GRASS_A', -6, 2, 0, 1.2],        // corridor edge grass
    ['ASTX_VEG_UNDERSTORY_A', 6, -2, 140, 1.05],// mid E
    ['ASTX_VEG_FERN_A', -9, -4, 0, 1.3],        // ground W
    ['ASTX_VEG_CANOPY_A', 4, -18, 250, 1.0],    // core deep (overlaps C/B)
    ['ASTX_VEG_FLOOR_A', 10, 1, 150, 1.0],      // debris E
    ['ASTX_VEG_CANOPY_B', -2, -25, 90, 1.15],   // back-rank emergent
    ['ASTX_VEG_SHRUB_A', 2, 3, 0, 0.9],         // corridor shrub (low)
    ['ASTX_VEG_UNDERSTORY_A', -14, -13, 300, 0.9], // deep W mid
    ['ASTX_VEG_FERN_A', 12, -6, 0, 1.4],        // ground E deep
    ['ASTX_VEG_CANOPY_C', -18, -14, 90, 0.9],   // edge banyan W
    ['ASTX_VEG_GRASS_A', 5, 5, 0, 1.3],         // corridor grass
    ['ASTX_VEG_CANOPY_A', 17, -20, 120, 0.95],  // back-rank E umbrella
    ['ASTX_VEG_FERN_A', -2, -12, 0, 1.1],       // deep ground
    ['ASTX_VEG_FLOWERS_A', 1, 7, 0, 1.0],       // corridor accent
    ['ASTX_VEG_FLOOR_A', -7, 6, 90, 1.1],       // foreground floor W
    ['ASTX_VEG_FERN_A', -4, 11, 0, 1.5],        // foreground frame
    ['ASTX_VEG_FLOOR_A', 6, 11, 200, 1.3],      // foreground frame E
    ['ASTX_VEG_UNDERSTORY_A', 14, -8, 80, 1.0], // edge mid E
    ['ASTX_VEG_GRASS_A', -12, 5, 0, 1.1],       // edge grass W
  ] },
  { site: [0, 143], name: 'reef shelf + lagoon (Gate C aquatics)', items: [
    // v2: aquatics moved INTO lagoon shallows (were high/dry on bar grass).
    // Seabed grounding + 1.1-1.5m height => crowns breach surface (reef-flat read).
    ['ASTX_VEG_CORAL_A', -10, 1, 0, 1.2],
    ['ASTX_VEG_CORAL_A', 6, 3, 120, 1.0],
    ['ASTX_VEG_CORAL_A', 0, 5, 240, 1.1],
    ['ASTX_VEG_SEAWEED_A', -6, 0, 0, 1.3],
    ['ASTX_VEG_SEAWEED_A', 8, 0, 0, 1.1],
    ['ASTX_VEG_SEAWEED_A', 2, 3, 0, 1.2],
    ['ASTX_VEG_SEAWEED_A', -2, 5, 0, 1.0],
    // dry bar transition behind the waterline: grass fringe + scrub
    ['ASTX_VEG_GRASS_A', -12, 10, 0, 1.2],
    ['ASTX_VEG_GRASS_A', 12, 10, 0, 1.1],
    ['ASTX_VEG_SCRUB_A', 0, 12, 0, 1.0],
  ] },
];

// density filter: low keeps every 3rd, med every 2nd, ref keeps all.
export function densityFilter(items, density) {
  if (density === 'low') return items.filter((_, i) => i % 3 === 0);
  if (density === 'med') return items.filter((_, i) => i % 2 === 0);
  return items;
}

// ---- GATE D: island-scale ecological rollout (staging only) ----
// Authored masses per eco_zone/district. NOT scatter: each stand is a composed
// cluster; wilderness gaps (NE highlands, far W headland) deliberately empty.
// Items interleaved by layer so low/med keep vertical structure.
// [asset, dx, dz, ryDeg, scale] relative to site. Total ref ~150.
export const ISLAND_GROVES = [
  { site: [-38, -100], name: 'highland stand W', items: [
    ['ASTX_VEG_CANOPY_B', 0, -6, 10, 1.1],
    ['ASTX_VEG_UNDERSTORY_A', 6, -2, 140, 1.0],
    ['ASTX_VEG_CANOPY_A', -8, 0, 40, 1.0],
    ['ASTX_VEG_FERN_A', 2, 2, 0, 1.2],
    ['ASTX_VEG_CANOPY_C', 9, -8, 90, 1.0],
    ['ASTX_VEG_FLOOR_A', -4, 5, 30, 1.2],
    ['ASTX_VEG_CANOPY_A', -13, -7, 160, 0.95],
    ['ASTX_VEG_UNDERSTORY_A', 12, 1, 80, 1.0],
    ['ASTX_VEG_FERN_A', -9, 6, 0, 1.3],
    ['ASTX_VEG_CANOPY_B', 4, -14, 200, 1.0],
    ['ASTX_VEG_GRASS_A', 0, 8, 0, 1.2],
    ['ASTX_VEG_FLOOR_A', 8, 6, 150, 1.0],
    ['ASTX_VEG_UNDERSTORY_A', -5, -11, 300, 0.9],
    ['ASTX_VEG_CANOPY_C', -17, 2, 0, 0.9],
    ['ASTX_VEG_FERN_A', 13, -3, 0, 1.1],
    ['ASTX_VEG_GRASS_A', -13, 9, 0, 1.1],
  ] },
  { site: [48, -100], name: 'highland stand E', items: [
    ['ASTX_VEG_CANOPY_A', 0, -6, 250, 1.0],
    ['ASTX_VEG_UNDERSTORY_A', -6, -1, 20, 1.0],
    ['ASTX_VEG_CANOPY_B', 8, -9, 90, 1.1],
    ['ASTX_VEG_FERN_A', -2, 3, 0, 1.2],
    ['ASTX_VEG_CANOPY_C', -10, -8, 160, 1.0],
    ['ASTX_VEG_FLOOR_A', 5, 2, 90, 1.1],
    ['ASTX_VEG_UNDERSTORY_A', 12, -2, 140, 1.05],
    ['ASTX_VEG_CANOPY_A', -14, 1, 40, 0.95],
    ['ASTX_VEG_GRASS_A', 1, 7, 0, 1.3],
    ['ASTX_VEG_FERN_A', 9, 5, 0, 1.4],
    ['ASTX_VEG_CANOPY_B', -4, -15, 0, 1.0],
    ['ASTX_VEG_FLOOR_A', -7, 6, 200, 1.0],
    ['ASTX_VEG_SHRUB_A', 13, 3, 0, 0.9],
    ['ASTX_VEG_UNDERSTORY_A', 3, -12, 80, 1.0],
  ] },
  { site: [8, -52], name: 'forest edge feather (transition to settlement)', items: [
    ['ASTX_VEG_UNDERSTORY_A', -12, -4, 20, 1.0],
    ['ASTX_VEG_GRASS_A', -4, 0, 0, 1.3],
    ['ASTX_VEG_UNDERSTORY_A', 4, -6, 140, 0.9],
    ['ASTX_VEG_FERN_A', 10, -2, 0, 1.2],
    ['ASTX_VEG_SHRUB_A', -2, 4, 0, 1.0],
    ['ASTX_VEG_GRASS_A', 12, 2, 0, 1.2],
    ['ASTX_VEG_UNDERSTORY_A', -18, 2, 300, 1.0],
    ['ASTX_VEG_FLOOR_A', 6, 5, 30, 1.0],
  ] },
  { site: [10, -24], name: 'civic N frame (plaza r18 kept clear)', items: [
    ['ASTX_VEG_CANOPY_A', -22, -4, 40, 1.0],
    ['ASTX_VEG_FLOWERS_A', -14, 2, 0, 1.1],
    ['ASTX_VEG_CANOPY_C', 22, -4, 160, 0.95],
    ['ASTX_VEG_SHRUB_A', 14, 3, 0, 1.0],
    ['ASTX_VEG_UNDERSTORY_A', -28, 3, 80, 1.0],
    ['ASTX_VEG_GRASS_A', 0, -8, 0, 1.2],
    ['ASTX_VEG_FLOWERS_A', 8, 4, 0, 1.0],
  ] },
  { site: [-40, 40], name: 'residential lanes (lots kept clear)', items: [
    ['ASTX_VEG_UNDERSTORY_A', -20, -14, 20, 1.0],
    ['ASTX_VEG_SHRUB_A', -14, -6, 0, 1.0],
    ['ASTX_VEG_UNDERSTORY_A', 8, -16, 140, 1.0],
    ['ASTX_VEG_FLOWERS_A', 26, 2, 0, 1.0],
    ['ASTX_VEG_CANOPY_A', -28, 2, 90, 0.9],
    ['ASTX_VEG_GRASS_A', 0, -4, 0, 1.2],
    ['ASTX_VEG_SHRUB_A', 24, 4, 0, 0.9],
    ['ASTX_VEG_UNDERSTORY_A', -2, 12, 300, 1.0],
  ] },
  { site: [136, -70], name: 'farm windbreak N (never inside plots)', items: [
    ['ASTX_VEG_CANOPY_A', -24, 0, 40, 1.0],
    ['ASTX_VEG_UNDERSTORY_A', -12, 2, 140, 1.0],
    ['ASTX_VEG_CANOPY_A', 0, -2, 160, 1.0],
    ['ASTX_VEG_GRASS_A', 10, 3, 0, 1.2],
    ['ASTX_VEG_UNDERSTORY_A', 12, 0, 80, 1.0],
    ['ASTX_VEG_CANOPY_A', 24, -2, 250, 1.0],
    ['ASTX_VEG_SHRUB_A', -32, 4, 0, 0.9],
    ['ASTX_VEG_GRASS_A', -6, -2, 0, 1.1],
  ] },
  { site: [150, -16], name: 'farm greenhouse (authored infra)', items: [
    ['ASTX_BUILDING_GREENHOUSE', 0, 0, 0, 1.0, { ryExact: true, bypass: true }],
  ] },
  { site: [72, -120], name: 'windmill knoll (authored infra, static blades)', items: [
    ['ASTX_BUILDING_WINDMILL', 0, 0, -35, 1.0, { ryExact: true, bypass: true }],
  ] },
  { site: [182, -42], name: 'farm windbreak E + field margin', items: [
    ['ASTX_VEG_CANOPY_A', 0, -14, 120, 1.0],
    ['ASTX_VEG_UNDERSTORY_A', 2, -4, 20, 1.0],
    ['ASTX_VEG_CANOPY_A', -2, 8, 300, 0.95],
    ['ASTX_VEG_GRASS_A', 3, 14, 0, 1.3],
    ['ASTX_VEG_UNDERSTORY_A', 0, 18, 140, 1.0],
    ['ASTX_VEG_SHRUB_A', -4, -20, 0, 0.9],
  ] },
  { site: [187, 80], name: 'east beach palms + scrub', items: [
    ['ASTX_VEG_PALM_A', -6, -4, 10, 1.0],
    ['ASTX_VEG_SCRUB_A', 6, -2, 0, 1.0],
    ['ASTX_VEG_PALM_A', 8, 6, -12, 0.9],
    ['ASTX_VEG_GRASS_A', -2, 6, 0, 1.2],
    ['ASTX_VEG_SCRUB_A', -12, 4, 0, 1.1],
  ] },
  { site: [-185, 100], name: 'west cove scrub', items: [
    ['ASTX_VEG_SCRUB_A', 0, 0, 0, 1.1],
    ['ASTX_VEG_PALM_A', -10, 4, 5, 0.95],
    ['ASTX_VEG_GRASS_A', 8, 6, 0, 1.2],
    ['ASTX_VEG_SCRUB_A', 10, -6, 0, 1.0],
  ] },
  { site: [-95, 175], name: 'hut islet palms', items: [
    ['ASTX_VEG_PALM_A', -4, 2, 20, 1.0],
    ['ASTX_VEG_PALM_A', 5, -3, -15, 0.9],
    ['ASTX_VEG_GRASS_A', 0, 5, 0, 1.2],
  ] },
  { site: [-195, 45], name: 'W islet palms', items: [
    ['ASTX_VEG_PALM_A', 0, 0, 40, 1.0],
    ['ASTX_VEG_PALM_A', 7, 4, -30, 0.9],
    ['ASTX_VEG_SCRUB_A', -6, 5, 0, 1.0],
  ] },
  { site: [228, 105], name: 'lighthouse rock (sparse)', items: [
    ['ASTX_VEG_CLIFFTUFT_A', -3, 2, 0, 1.0],
    ['ASTX_VEG_GRASS_A', 3, -2, 0, 1.0],
  ] },
  { site: [102, 121], name: 'harbor point W of bay (raycast-verified dry)', items: [
    ['ASTX_VEG_PALM_A', -3, 0, 10, 1.0],
    ['ASTX_VEG_GRASS_A', 0, 4, 0, 1.2],
    ['ASTX_VEG_SCRUB_A', -4, 7, 0, 1.0],
    ['ASTX_VEG_SHRUB_A', 3, -6, 0, 0.9],
  ] },
  { site: [-30, -30], name: 'meadow copse W (savanna rhythm)', items: [
    ['ASTX_VEG_CANOPY_A', 0, 0, 40, 1.05],
    ['ASTX_VEG_UNDERSTORY_A', 8, 4, 140, 1.0],
    ['ASTX_VEG_GRASS_A', -6, 5, 0, 1.3],
    ['ASTX_VEG_SHRUB_A', -9, -5, 0, 1.0],
    ['ASTX_VEG_GRASS_A', 5, -6, 0, 1.2],
    ['ASTX_VEG_UNDERSTORY_A', -3, 10, 300, 0.9],
    ['ASTX_VEG_FERN_A', 10, -3, 0, 1.2],
  ] },
  { site: [60, -10], name: 'meadow copse E (savanna rhythm)', items: [
    ['ASTX_VEG_CANOPY_A', 0, 0, 160, 1.0],
    ['ASTX_VEG_GRASS_A', 7, 3, 0, 1.3],
    ['ASTX_VEG_UNDERSTORY_A', -7, 5, 20, 1.0],
    ['ASTX_VEG_SHRUB_A', 4, -7, 0, 0.9],
    ['ASTX_VEG_GRASS_A', -5, -6, 0, 1.2],
    ['ASTX_VEG_CANOPY_C', 12, 8, 90, 0.9],
    ['ASTX_VEG_FLOOR_A', -10, -1, 30, 1.0],
  ] },
  { site: [10, -2], name: 'civic anchor (authored infra, Region 2)', items: [
    ['ASTX_PLAZA_CIVIC', 0, 2, 0, 1.0, { ryExact: true, bypass: true }],
    ['ASTX_BUILDING_TOWNHALL', 0, -18, 0, 1.0, { ryExact: true, bypass: true }],
    ['ASTX_BUILDING_MARKET', 18, 8, -15, 1.0, { ryExact: true, bypass: true }],
    ['ASTX_BUILDING_MARKET', 24, 2, -10, 1.0, { ryExact: true, bypass: true }],
  ] },
  { site: [-48, -50], name: 'falls-mist proxy (ferns/flowers at cliff foot)', items: [
    ['ASTX_VEG_FERN_A', -3, 10, 0, 1.4],
    ['ASTX_VEG_FLOWERS_A', 3, 12, 0, 1.1],
    ['ASTX_VEG_FERN_A', 7, 9, 0, 1.2],
    ['ASTX_VEG_CLIFFTUFT_A', 0, 14, 0, 1.0],
  ] },
  { site: [16, 6], name: 'ACTIVITY market row (commerce)', items: [
    ['ASTX_PROP_CRATE', 10, 2, 20, 1.0, { ryExact: true }],
    ['ASTX_PROP_CRATE', 11, 1, -15, 1.0, { ryExact: true }],
    ['ASTX_PROP_BARREL', 15, -3, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_BASKET', 14, -1, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_BENCH', 6, 6, 200, 1.0, { ryExact: true }],
    ['ASTX_PROP_SIGNPOST', 4, -2, 40, 1.0, { ryExact: true }],
    ['ASTX_PROP_LANTERN', 0, 2, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_LANTERN', 8, 4, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_BENCH', -6, 5, 180, 1.0, { ryExact: true }],
    ['ASTX_PROP_BASKET', 4, 4, 0, 1.0, { ryExact: true }],
  ] },
  { site: [-30, 32], name: 'ACTIVITY residential lane (habitation)', items: [
    ['ASTX_PROP_BENCH', 0, 0, 140, 1.0, { ryExact: true }],
    ['ASTX_PROP_WOODPILE', -3, 3, 75, 1.0, { ryExact: true }],
    ['ASTX_PROP_BASKET', 3, -3, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_LANTERN', -6, -2, 0, 1.0, { ryExact: true }],
  ] },
  { site: [140, -44], name: 'ACTIVITY farm yard (production)', items: [
    ['ASTX_PROP_GRAINSTACK', 0, 0, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_CRATE', -4, 4, 10, 1.0, { ryExact: true }],
    ['ASTX_PROP_CRATE', -3, 5, 30, 1.0, { ryExact: true }],
    ['ASTX_PROP_SACK', 4, -4, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_SACK', 10, 0, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_BARREL', 6, 3, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_SIGNPOST', -60, 30, 40, 1.0, { ryExact: true }],
  ] },
  { site: [102, 121], name: 'ACTIVITY harbor point (transport)', items: [
    ['ASTX_PROP_DRYRACK', 4, 3, -20, 1.0, { ryExact: true }],
    ['ASTX_PROP_ROPECOIL', 2, -1, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_BUOY', 6, 6, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_CRATE', -2, 4, 15, 1.0, { ryExact: true }],
    ['ASTX_PROP_BARREL', -5, -2, 0, 1.0, { ryExact: true }],
    ['ASTX_PROP_LANTERN', 0, 8, 0, 1.0, { ryExact: true }],
  ] },
];
