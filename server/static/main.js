// ASTrix Three.js Observatory — world adapter. Visualization != Authority.
// Loads ASTX GLBs, reconciles ONLY from authoritative snapshot. Decor never invents state.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Transport: same-origin first (production serves API + Observatory on one
// port), loopback fallback for local dev (python http.server on :5199).
// Operator key model mirrors GameClient.gd: reads are anonymous; writes need
// `Authorization: Bearer <key>`. The key is NEVER baked in — the operator seeds
// it at runtime via #astrix_key=... (stored to localStorage) or not at all.
const DEV = 'http://127.0.0.1:8787';
try {
  const m = (location.hash || '').match(/astrix_key=([^&]+)/);
  if (m) { localStorage.setItem('astrix_api_key', decodeURIComponent(m[1])); history.replaceState(null, ' ', location.pathname + location.search); }
} catch {}
const apiKey = () => { try { return localStorage.getItem('astrix_api_key') || ''; } catch { return ''; } };
const authHeaders = () => (apiKey() ? { Authorization: `Bearer ${apiKey()}` } : {});
async function apiGet(path) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (r.ok) return { data: await r.json(), live: true };
  } catch {}
  const r2 = await fetch(DEV + path, { cache: 'no-store' });
  if (!r2.ok) throw new Error(`GET ${path} -> ${r2.status}`);
  return { data: await r2.json(), live: true };
}

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a4a6e);
scene.fog = new THREE.Fog(0x0a4a6e, 650, 1800);

// Camera preset: elevated isometric three-quarter (45 yaw, ~38 pitch) framing island + ocean
const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 4000);
function frameCamera() {
  const a = size();
  camera.aspect = a.w / a.h; camera.updateProjectionMatrix();
  const focus = new URLSearchParams(location.search).get('focus');
  // World is ~500m across now: pull back so the island mass reads.
  if (focus === 'bridge' || focus === 'harbor') {
    camera.position.set(60, 70, 210);
    camera.lookAt(175, 0, 110);
    return;
  }
  if (focus === 'farm') {
    camera.position.set(60, 55, 85);
    camera.lookAt(145, 0, -35);
    return;
  }
  if (focus === 'civic') {
    camera.position.set(-70, 60, 110);
    camera.lookAt(10, 0, -6);
    return;
  }
  if (focus === 'top') {
    camera.position.set(10, 520, 9);
    camera.lookAt(10, 0, 8);
    return;
  }
  if (focus === 'opposite') {
    camera.position.set(330, 210, -270);
    camera.lookAt(0, 0, 0);
    return;
  }
  if (focus === 'shore') {
    camera.position.set(0, 8, 215);
    camera.lookAt(0, 0, 135);
    return;
  }
  if (focus === 'highland') {
    camera.position.set(-120, 90, 180);
    camera.lookAt(10, 6, -90);
    return;
  }
  if (focus === 'sedge') {
    camera.position.set(-72, 14, 68);
    camera.lookAt(-38, 3, 28);
    return;
  }
  if (focus === 'scoast') {
    camera.position.set(-6, 9, 196);
    camera.lookAt(0, 0, 148);
    return;
  }
  if (focus === 'scliff') {
    camera.position.set(-95, 26, 30);
    camera.lookAt(-48, 8, -62);
    return;
  }
  if (focus === 'smid') {
    camera.position.set(-110, 42, 110);
    camera.lookAt(-30, 4, 20);
    return;
  }
  if (focus === 'slow') {
    camera.position.set(-52, 4.5, 52);
    camera.lookAt(-34, 4, 24);
    return;
  }
  if (focus === 'sclose') {
    camera.position.set(-48, 7, 42);
    camera.lookAt(-38, 3, 28);
    return;
  }
  if (focus === 'sforest') {
    camera.position.set(-38, 22, -34);
    camera.lookAt(8, 6, -88);
    return;
  }
  if (focus === 'sreef') {
    camera.position.set(-10, 6, 175);
    camera.lookAt(0, -0.5, 143);
    return;
  }
  if (focus === 'sharbor') {
    camera.position.set(78, 9, 148);
    camera.lookAt(103, 1, 123);
    return;
  }
  camera.position.set(-170, 150, 228); // upper-left warm key side
  camera.lookAt(10, 0, 10);
}
function size() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  return { w: r.width, h: r.height };
}
addEventListener('resize', frameCamera);

// Light: warm key w/ shadows + cool sky fill (no shadow) + faint warm bounce.
// ?sun=ref selects the calibration candidate (lower warmer key, stronger form
// shadows); default prod is the current baseline. Compared in calibration shots.
const QPARAMS = new URLSearchParams(location.search);
const STAGING = QPARAMS.get('staging'); // 'grove' = vegetation integration staging (world untouched by design)
const DENSITY = QPARAMS.get('density') || 'ref'; // low | med | ref (reference-target)
const SUN_MODE = new URLSearchParams(location.search).get('sun') || 'ref'; // ref won calibration
const sun = new THREE.DirectionalLight(SUN_MODE === 'ref' ? 0xffd9a8 : 0xffe7c4, SUN_MODE === 'ref' ? 3.2 : 2.6);
sun.position.set(...(SUN_MODE === 'ref' ? [-180, 90, -40] : [-140, 130, -60])); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.15; // kills terrain shadow-map ripple without darkening (bisect-verified); facets kept
sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, far: 900 });
scene.add(sun, new THREE.HemisphereLight(0xbfe3ff, 0x3a5a34, SUN_MODE === 'ref' ? 0.6 : 0.75));
const bounce = new THREE.DirectionalLight(0xffd9b0, SUN_MODE === 'ref' ? 0.5 : 0.35);
bounce.position.set(120, 40, 140);
scene.add(bounce);

import { heightAt, colorAt, SEA_Y } from './terrain.js';

// Ocean: real geometry w/ vertex-independent shader-ish motion (presentation only)
const oceanGeo = new THREE.PlaneGeometry(2400, 2400, 48, 48);
const oceanMat = new THREE.MeshStandardMaterial({ color: 0x0e6f9a, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.96 });
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.name = 'ocean';
ocean.rotation.x = -Math.PI / 2; ocean.position.y = SEA_Y; ocean.receiveShadow = true;
scene.add(ocean);
const seabed = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color: 0x08354d }));
seabed.name = 'seabed';
seabed.rotation.x = -Math.PI / 2; seabed.position.y = -6; scene.add(seabed);

// Authored terrain: Blender-built main island + islets (world-map driven).
// Placement grounds via RAYCAST against these meshes (exact); heightAt() stays
// as fast analytic twin for filters and gameplay logic.
const terrainMeshes = [];
const landGroup = new THREE.Group(); scene.add(landGroup);
const bareKeep = []; // major water features stay visible in bare review mode
async function loadTerrain() {
  for (const a of ['ASTX_TERRAIN_MAIN', 'ASTX_TERRAIN_ISLETS']) {
    const m = await loadGLB(`/assets/glb/${a}.glb`);
    m.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; terrainMeshes.push(o); } });
    landGroup.add(m);
  }
}
const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
function groundY(x, z) {
  _ray.set(new THREE.Vector3(x, 80, z), _down);
  const hits = _ray.intersectObjects(terrainMeshes, false);
  if (hits.length) return hits[0].point.y;
  return heightAt(x, z); // fallback: analytic twin (never NaN, keeps world alive)
}

// Shallow ring + foam band (from island footprints — presentation of real land positions)
const shallow = new THREE.Mesh(new THREE.RingGeometry(38, 62, 48),
  new THREE.MeshBasicMaterial({ color: 0x2fc4d8, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
shallow.rotation.x = -Math.PI / 2; shallow.position.set(10, -0.55, 10); shallow.name = 'shallow'; scene.add(shallow);
// Shallow shelf discs: light sand under transparent water so coves read
// turquoise-shallow vs deep-blue at hero distance. Static geography.
for (const [x, z, r] of [[0, 165, 48], [196, 78, 30], [-192, 98, 36]]) {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40),
    new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 1 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, -1.1, z);
  disc.receiveShadow = true;
  scene.add(disc);
}

const loader = new GLTFLoader();
// Cache-buster: bump on every asset redeploy so tablets/phones drop stale
// broken GLBs (the Sep-18 orientation fix stranded old files in caches).
const ASSET_V = '20260919a';
const world = new THREE.Group(); scene.add(world);
const registry = new Map(); // entityId -> Object3D (authoritative-bound)
const decor = new THREE.Group(); scene.add(decor); // pure dressing, never counted as state
const clock = new THREE.Clock();
const boats = [], palms = [], npcs = [];
const windmillHubs = []; // hubPIVOT nodes: ambient rotation (presentation, like boat bob).
let snapshot = null, lastEvents = [];

async function loadGLB(rel) {
  const url = rel.includes('?') ? rel : `${rel}?v=${ASSET_V}`;
  const g = await loader.loadAsync(url);
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g.scene;
}
let skirtMat = null; // shared stone foundation material (plinth-gap fix)
async function spawn(asset, x, z, ry = 0, parent = world, entityId = null, ground = true) {
  const m = await loadGLB(`/assets/glb/${asset}.glb`);
  // Batch: merge single-group parts by material (pure batching, zero visual
  // change). Kinetic pivots (*PIVOT*) are exempt: merging would destroy them.
  let hasPivot = false;
  m.traverse(o => { if (o.name.includes('PIVOT')) hasPivot = true; });
  if (!hasPivot) {
    const { mergeGeos } = await import('./staging-paths.js');
    m.updateMatrixWorld(true);
    const byMat = new Map();
    m.traverse(o => {
      if (!o.isMesh || o.geometry.groups.length > 1) return;
      const sig = Object.keys(o.geometry.attributes).sort().join(',') + '|' + (o.geometry.index ? 1 : 0);
      const key = o.material.uuid + '|' + sig;
      if (!byMat.has(key)) byMat.set(key, { mat: o.material, items: [] });
      byMat.get(key).items.push(o);
    });
    for (const { mat, items } of byMat.values()) {
      if (items.length < 2) continue;
      const gs = items.map(o => o.geometry.clone().applyMatrix4(o.matrixWorld));
      const merged = mergeGeometriesFallback(gs);
      gs.forEach(g => g.dispose());
      if (!merged) continue;
      const im = new THREE.Mesh(merged, mat);
      im.castShadow = true; im.receiveShadow = true;
      // merged geometry is in m-local space (m at origin): attach to m root
      for (const o of items) o.parent.remove(o);
      m.add(im);
    }
    function mergeGeometriesFallback(gs) {
      try { return mergeGeos(gs, THREE); } catch { return null; }
    }
  }
  // Grounding: raycast against rendered terrain (exact). Water entities opt out.
  m.position.set(x, ground ? groundY(x, z) - 0.05 : 0, z); m.rotation.y = ry;
  m.userData.baseY = m.position.y;
  if (ground && asset.startsWith('ASTX_BUILDING_')) {
    // Plinth-gap fix: stone foundation skirt from building base down past the
    // lowest footprint corner (child of m: moves/removed with the building).
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
    const r = Math.max(sx, sz) * 0.5;
    const minY = Math.min(groundY(x - r, z - r), groundY(x + r, z - r), groundY(x - r, z + r), groundY(x + r, z + r), m.position.y);
    if (m.position.y - minY > 0.25) {
      if (!skirtMat) skirtMat = new THREE.MeshStandardMaterial({ color: 0x8d8d94, roughness: 0.95 });
      const h = (m.position.y + 0.02) - (minY - 0.15);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.82, h, sz * 0.82), skirtMat);
      skirt.position.y = 0.02 - h / 2; // local: top tucks under base
      skirt.castShadow = true; skirt.receiveShadow = true;
      m.add(skirt);
    }
  }
  parent.add(m);
  if (entityId) registry.set(entityId, m);
  // Kinetic pivots: collect hub nodes so animate() can drive them. No state implied.
  m.traverse(o => { if (o.name.endsWith('hubPIVOT')) windmillHubs.push(o); });
  return m;
}
// Deterministic PRNG (mulberry32, fixed seed): identical scatter every load.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(1379);

// ---- VEGETATION INTEGRATION STAGING (?staging=grove; world untouched) ----
// Authored clusters from staging-grove.js; density via ?density=low|med|ref.
// Staged GLBs load direct (not in manifest by design). No Core contact here.
async function assembleGrove() {
  const { GROVES, densityFilter } = await import('./staging-grove.js');
  const cache = new Map();
  async function staged(asset) {
    if (!cache.has(asset)) cache.set(asset, await loadGLB(`/assets/glb/${asset}.glb`));
    return cache.get(asset);
  }
  let total = 0;
  const sites = [];
  for (const grove of GROVES) {
    const items = densityFilter(grove.items, DENSITY);
    const [sx, sz] = grove.site;
    for (const [i, [asset, dx, dz, ry, sc]] of items.entries()) {
      const tpl = await staged(asset);
      const m = tpl.clone(true);
      const x = sx + dx, z = sz + dz;
      m.position.set(x, groundY(x, z) - 0.05, z);
      m.rotation.y = (ry * Math.PI) / 180 + (i * 2.39996);
      m.scale.setScalar(sc);
      m.userData.baseY = m.position.y;
      decor.add(m);
    }
    total += items.length;
    sites.push(grove.site.join(','));
  }
  window.__grove = { sites, density: DENSITY, count: total };
}

// ---- island assembly: GROUND-UP RESET (bare terrain only) ----
// Terrain + ocean + light only. Every static ground spawn (houses, plaza/
// fountain, paths, market/barn/farm/greenhouse, windmill, lighthouse, dock,
// waterfalls, cliffs/rocks/terraces/stacks, beaches/reefs/boulders, palms,
// trees/bushes, crates/barrels/lanterns, boats, NPCs, staging groves) has
// been removed. The ground starts empty; reconcileDynamic() below re-adds
// ONLY what Core's authoritative snapshot says exists.
async function assemble() {
  await loadTerrain();
  // No static spawns. No staging grove. No decor. Bare ground by design.
}

// ---- state adapter: AUTHORITATIVE snapshot -> reconciliation (never invents) ----
const FALLBACK = { day: 1, season: 'summer', population: 4, food: 40, foodPressureLevel: 'ok', foodPerDay: 4, daysOfFoodRemaining: 10, resources: { wood: 30, stone: 15, food: 40, water: 0, crystal: 5 }, biomeHealth: { meadow: 0.8, frost: 0.6, dusk: 0.4 }, crops: [], farmland: [], bridges: [], buildings: [{ id: 'house-001', type: 'house' }], resourceNodes: [], islands: [], pendingApprovals: [] };

async function poll() {
  try {
    const { data: snap } = await apiGet('/astrix/state');
    let agent = {};
    try { ({ data: agent } = await apiGet('/astrix/agent/status')); } catch {}
    return { snap, agent, live: true };
  } catch {
    return { snap: FALLBACK, agent: {}, live: false };
  }
}

function reconcile(snap) {
  // NPCs = population (authoritative). Show/hide to match exactly.
  const want = Math.max(0, Math.min(14, snap.population ?? 4));
  npcs.forEach((n, i) => n.visible = i < want);
  // Crops: scale farm crop-rows by growthStage (authoritative) — farm group exists; tint by maturity
  // Bridges/buildings: registry already holds authoritative ids; removal when absent handled by full re-mirror on buildings/bridges arrays when live
  // (vertical slice: town hall + seed farm persistent; dynamic add/remove path implemented + tested below)
}

// Presentational projection Core coords -> world coords (pixels only; topology stays in Core).
// Meadow (x10-30,z20-36) lands on the island interior. Bridges use the harbor berth instead
// (single-landmass slice; true archipelago is Priority 2 terrain work).
const coreToWorld = (cx, cz) => ({ x: (cx - 20) * 1.6 + 10, z: (cz - 28) * 1.6 + 10 });
const BRIDGE_BERTH = { x: 218, z: 106 }; // landing stage at the lighthouse rock edge

let dyn = new Map();
const cropMeshes = new Map();
let cropMat = null, cropGoldMat = null;
// Authored layout: lots/plots/berths (world-layout.json). Lots are composition;
// Core decides existence. A building renders on a claimed lot; lots free when
// the building is removed. Fallback: legacy spiral shore-resolve (unchanged).
let LAYOUT = { housing_lots: [], farm_plots: [], bridge_berths: [] };
const usedLots = new Set();
async function loadLayout() {
  for (const u of ['/assets/world-layout.json', '/astrix-three/world-layout.json', 'http://127.0.0.1:5199/astrix-three/world-layout.json']) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.housing_lots?.length) { LAYOUT = j; return; } }
    } catch {}
  }
}
function claimLot(kind, id) {
  // Storage barns belong to the farm belt (agricultural district composition).
  // Placement only — Core decides WHAT exists; the authored layer says WHERE.
  const pool = (kind === 'farm' || kind === 'storage') ? LAYOUT.farm_plots : kind === 'bridge' ? LAYOUT.bridge_berths : LAYOUT.housing_lots;
  const free = pool.filter(l => !usedLots.has(l.id));
  if (!free.length) return null;
  const pick = free[Math.abs(hash(id)) % free.length];
  usedLots.add(pick.id);
  return pick;
}
function releaseLotFor(id) {
  for (const [lid, bid] of [...lotOwners]) if (bid === id) { usedLots.delete(lid); lotOwners.delete(lid); }
}
const lotOwners = new Map();

async function reconcileDynamic(snap) {
  // buildings[] mirror: create/remove to match authoritative ids (no invention)
  const want = new Map((snap.buildings || []).map(b => [b.id, b]));
  for (const [id, obj] of [...dyn]) {
    if (String(id).startsWith('bridge:') || String(id).startsWith('crop:') || String(id).startsWith('field:')) continue;
    if (!want.has(id)) { world.remove(obj); dyn.delete(id); registry.delete(id); releaseLotFor(id); }
  }
  // field plots live and die with their farm building
  for (const [id, obj] of [...dyn]) {
    if (String(id).startsWith('field:') && !want.has(id.slice(6))) { world.remove(obj); dyn.delete(id); registry.delete(id); }
  }
  for (const [id, b] of want) {
    if (registry.has(id) || dyn.has(id)) continue;
    // bridge_segment buildings are already represented by the bridges[] span — never double-render.
    if (b.type === 'bridge_segment') { registry.set(id, null); continue; }
    const asset = b.type === 'farm' ? 'ASTX_BUILDING_FARM' : b.type === 'storage' ? 'ASTX_BUILDING_BARN' : 'ASTX_BUILDING_HOUSE';
    // Authored lots first (composition); legacy resolve as fallback.
    const lot = claimLot(b.type, id);
    let x, z, ry = 0;
    if (lot) {
      lotOwners.set(lot.id, id);
      x = lot.pos[0]; z = lot.pos[1]; ry = lot.ry || 0;
    } else {
      x = 10 + (Math.abs(hash(id)) % 40); z = 10 + (Math.abs(hash(id) >> 3) % 30);
      if (b.position && Number.isFinite(b.position.x)) { const w = coreToWorld(b.position.x, b.position.z); x = w.x; z = w.z; }
      // resolve onto dry land: spiral out from the candidate until heightAt clears
      // the waterline (deterministic per id). Never leave a building swimming.
      if (groundY(x, z) < 0.4) {
        const hh = Math.abs(hash(id + ':shore'));
        outer: for (let r = 6; r < 120; r += 6) {
          for (let k = 0; k < 12; k++) {
            const a = (hh + k * 0.52) % (Math.PI * 2);
            const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
            if (groundY(cx, cz) >= 0.4) { x = cx; z = cz; break outer; }
          }
        }
      }
    }
    const m = await spawn(asset, x, z, ry, world, id);
    m.userData.corePos = b.position || null;
    dyn.set(id, m);
    // Farm buildings bring their tilled plot: EMPTY rows (static). Crop tufts
    // are reconciled separately from snap.crops — never baked into the field.
    if (b.type === 'farm' && !dyn.has(`field:${id}`)) {
      const f = await spawn('ASTX_FIELD_PLOT', x + 15, z + 2, 0, world, `field:${id}`);
      dyn.set(`field:${id}`, f);
    }
  }
  // bridges[] mirror: one span per authoritative bridge at an authored berth
  const wb = new Map((snap.bridges || []).map(br => [`bridge:${br.id}`, br]));
  for (const [id, obj] of [...dyn]) if (String(id).startsWith('bridge:') && !wb.has(id)) { world.remove(obj); dyn.delete(id); registry.delete(id); releaseLotFor(id); }
  let bi = 0;
  for (const [id, br] of wb) {
    if (dyn.has(id) || registry.has(id)) { bi++; continue; }
    const berth = claimLot('bridge', id);
    const bx = berth ? berth.pos[0] : BRIDGE_BERTH.x + bi * 5;
    const bz = berth ? berth.pos[1] : BRIDGE_BERTH.z;
    if (berth) lotOwners.set(berth.id, id);
    const m = await spawn('ASTX_INFRA_BRIDGE', bx, bz, 0.6, world, id, false);
    m.position.y = SEA_Y + 0.9; // deck rides above the harbor water
    m.userData.pair = `${br.islandA}<->${br.islandB}`;
    dyn.set(id, m); bi++;
  }
  // crops[] mirror: one tuft per authoritative crop on its farm, height = growthStage
  if (!cropMat) {
    cropMat = new THREE.MeshStandardMaterial({ color: 0x3f9e4d, roughness: 0.9 });
    cropGoldMat = new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.7, emissive: 0x664400, emissiveIntensity: 0.4 });
  }
  const wc = new Map((snap.crops || []).map(c => [`crop:${c.id}`, c]));
  for (const [id, obj] of [...cropMeshes]) if (!wc.has(id)) { world.remove(obj); cropMeshes.delete(id); }
  const farms = new Map([...dyn].filter(([id]) => !String(id).startsWith('bridge:')).map(([id, o]) => [id, o]));
  for (const [id, c] of wc) {
    if (cropMeshes.has(id)) {
      const m = cropMeshes.get(id);
      m.scale.y = 0.3 + (c.growthStage || 0) * 1.4;
      m.material = c.harvestable ? cropGoldMat : cropMat;
      continue;
    }
    const farm = farms.get(c.farmPlotId);
    const fx = farm ? farm.position.x : 52, fz = farm ? farm.position.z : -18;
    const fy = farm ? farm.position.y : 0;
    const k = cropMeshes.size;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1, 0.7), c.harvestable ? cropGoldMat : cropMat);
    m.position.set(fx - 2 + (k % 3) * 2, fy + 0.6, fz - 1 + Math.floor(k / 3) * 2);
    m.scale.y = 0.3 + (c.growthStage || 0) * 1.4;
    m.castShadow = true;
    world.add(m); cropMeshes.set(id, m);
  }
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ---- HUD ----
const $ = id => document.getElementById(id);
function paintHUD(snap, agent, live, perf) {
  $('mode').textContent = live ? 'LIVE' : 'REPLAY/FALLBACK';
  $('mode').className = 'badge ' + (live ? 'b-live' : 'b-replay');
  $('world').innerHTML = ['day', 'season', 'population', 'food', 'foodPressureLevel'].map(k =>
    `<div class="row"><span>${k}</span><b>${snap[k]}</b></div>`).join('') +
    `<div class="row"><span>buildings/crops/bridges</span><b>${(snap.buildings || []).length}/${(snap.crops || []).length}/${(snap.bridges || []).length}</b></div>` +
    ((snap.bridges || []).map(br => `<div class="row"><span>bridge ${br.id}</span><b>${br.islandA}↔${br.islandB}</b></div>`).join(''));
  $('steward').innerHTML = `<div class="row"><span>state</span><b>${agent.state || agent.loop?.state || '—'}</b></div>
    <div class="row"><span>turn</span><b>${agent.turn ?? '—'}</b></div>
    <div class="row"><span>provider</span><b>${agent.provider || 'local'}</b></div>`;
  const pa = (snap.pendingApprovals || []).length;
  $('gate').innerHTML = pa ? `<span class="badge b-replay">AWAITING HUMAN ×${pa}</span>` : `<span class="badge b-live">no gate</span>`;
  $('gov').innerHTML = (snap.pendingApprovals || []).map(a =>
    `<div class="row"><span>${a.id} ${a.command}</span><span><button data-appr="${a.id}" data-d="approve">APPROVE</button> <button data-appr="${a.id}" data-d="reject">REJECT</button></span></div>`).join('') || '<div class="row"><span>gate</span><b class="ok">clear</b></div>';
  document.querySelectorAll('[data-appr]').forEach(b => b.onclick = async () => {
    // Legitimate control surface only: POST to Core approval endpoint. Never mutates locally.
    // Same-origin first (production), loopback fallback (dev). Needs operator key when
    // the server sets ASTRIX_API_KEY or sits behind a proxy — otherwise expect 401.
    const body = JSON.stringify({ approval_id: b.dataset.appr, decision: b.dataset.d });
    for (const base of ['', DEV]) {
      try {
        const r = await fetch(base + '/astrix/approval/respond', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body,
        });
        const j = await r.json().catch(() => ({}));
        $('feed').textContent += `\napproval ${b.dataset.d} -> ${r.status}${r.status === 401 ? ' (operator key required: seed via #astrix_key=...)' : ''} ${j.error || j.bridgeId || ''}`;
        if (r.ok || r.status === 404) break;
      } catch (e) { if (base === DEV) $('feed').textContent += `\napproval request failed: ${e}`; }
    }
    tick();
  });
  $('chain').innerHTML = `<div class="row"><span>magicblock</span><b>receipt-settlement only (honest status in docs)</b></div>
    <div class="row"><span>solana</span><b>program present, ER crank unverified here</b></div>`;
  $('perf').innerHTML = `<div class="row"><span>draw calls</span><b>${perf.calls}</b></div>
    <div class="row"><span>tris</span><b>${perf.tris}</b></div><div class="row"><span>fps</span><b>${perf.fps}</b></div>`;
}

// ---- loop: presentation anim only (never mutates authority) ----
let frames = 0, t0 = performance.now(), fps = 60;
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  controls.update();
  ocean.position.y = SEA_Y + Math.sin(t * 0.8) * 0.08; // water movement (presentation)
  boats.forEach((b, i) => { b.position.y = (b.userData.baseY ?? SEA_Y) + Math.sin(t * 1.1 + i * 2) * 0.15; b.rotation.z = Math.sin(t + i) * 0.03; });
  // Windmill blades: ambient rotation around the hub axle (local Z). This is
  // PRESENTATION, like water and boat bob — Core has no wind/mill state, so no
  // state relationship is claimed. If milling ever becomes authoritative, drive
  // this speed from snapshot state instead.
  windmillHubs.forEach(h => { h.rotation.z = t * 0.5; });
  palms.forEach((p, i) => p.rotation.z = Math.sin(t * 1.3 + i) * 0.02);
  npcs.forEach((n, i) => { if (n.visible) n.position.y = (n.userData.baseY ?? 0) + Math.abs(Math.sin(t * 2 + i * 1.7)) * 0.05; });
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - t0 > 1000) { fps = Math.round(frames * 1000 / (now - t0)); frames = 0; t0 = now; }
  window.__astrix = { snapshot, registrySize: registry.size, dynSize: dyn.size, bots: boats.length, npcs: npcs.filter(n => n.visible).length, fps,
    bridges: (snapshot?.bridges || []).map(b => b.id), crops: (snapshot?.crops || []).length,
    approvals: (snapshot?.pendingApprovals || []).map(a => a.id),
    hubs: windmillHubs.length, hubAngle: windmillHubs.length ? windmillHubs[0].rotation.z : null };
}

let hsMod = null, hsGroup = null, hsSig = '';
async function syncHomesteads() {
  // Courtyards + fences follow RECONCILED buildings (representation only).
  // Signature-guarded: rebuilds only when building membership changes.
  if (!hsMod) hsMod = await import('./staging-homestead.js');
  const sig = hsMod.homesteadSignature(dyn);
  if (sig === hsSig) return;
  hsSig = sig;
  if (hsGroup) { decor.remove(hsGroup); hsGroup.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); hsGroup = null; }
  if (!sig) return;
  const buildings = [...dyn.entries()]
    .filter(([id]) => !String(id).startsWith('bridge:') && !String(id).startsWith('crop:') && !String(id).startsWith('field:'))
    .map(([, o]) => ({ x: o.position.x, z: o.position.z }));
  hsGroup = hsMod.buildHomesteads({ THREE, groundY, decor, buildings });
}
async function tick() {
  const { snap, agent, live } = await poll();
  snapshot = snap; lastEvents = agent.lastEvents || [];
  if (!STAGING || STAGING === 'island') { await reconcileDynamic(snap); reconcile(snap); }
  if (ISLAND) await syncHomesteads();
  $('feed').textContent = (lastEvents.slice(-12).map(e => `${e.type} ${JSON.stringify(e.data || {}).slice(0, 110)}`).join('\n')) || 'no agent events (fallback snapshot)';
  const info = renderer.info;
  paintHUD(snap, agent, live, { calls: info.render.calls, tris: info.render.triangles, fps });
}

frameCamera();
await loadLayout();
await assemble();
if (STAGING) window.__probeGround = (x, z) => groundY(x, z); // staging interrogation only
if (STAGING === 'grove') await assembleGrove(); // Gate C vectors (kept for regression)
const ISLAND = STAGING === 'island' || (!STAGING && !new URLSearchParams(location.search).has('bare'));
if (ISLAND) {
  // Gate D: causal mirror FIRST (state determines what exists), then authored
  // island vegetation as pure decor (placement only, never state).
  const { snap: s0 } = await poll();
  snapshot = s0;
  await reconcileDynamic(s0); reconcile(s0);
  for (let i = 0; i < 14; i++) {
    const n = await spawn('ASTX_NPC_VILLAGER', 6 + i * 3, 12, 0, world, `npc-${i}`);
    n.scale.setScalar(1.25); npcs.push(n);
  }
  reconcile(s0);
  // No-plant exclusion: authored lots/plots + civic circle + every RENDERED
  // building (covers hash-claimed lots, fields, spiral fallback). Decorative
  // vegetation must never collide with architecture (audit 09-19: canopies on
  // housing lots). LAYOUT is loaded above; dyn holds post-reconcile positions.
  const exclude = [
    ...LAYOUT.housing_lots.map(l => ({ x: l.pos[0], z: l.pos[1], r: 7 })),
    ...LAYOUT.farm_plots.map(l => ({ x: l.pos[0], z: l.pos[1], r: 10 })),
    { x: 10, z: 0, r: 22 }, // civic plaza + hall forecourt keep-clear
    ...[...dyn.values()].map(o => ({ x: o.position.x, z: o.position.z, r: 8 })),
  ];
  const { assembleIsland } = await import('./staging-island.js');
  await assembleIsland({ THREE, loadGLB, groundY, heightAt, decor, density: DENSITY, exclude });
  const { buildPaths } = await import('./staging-paths.js');
  buildPaths({ THREE, groundY, decor }); // authored path network (infra, density-invariant)
  window.__causal = {
    snapshot: {
      buildings: (s0.buildings || []).map(b => b.id),
      crops: (s0.crops || []).map(c => c.id),
      bridges: (s0.bridges || []).map(b => b.id),
      population: s0.population,
    },
    rendered: {
      dyn: [...dyn.keys()],
      crops: [...cropMeshes.keys()],
      npcsVisible: npcs.filter(n => n.visible).length,
    },
  };
  await syncHomesteads();
}
// Bare review mode (?bare=1): LAND + WATER + TERRAIN MATERIALS + MAJOR WATER
// FEATURES only. Hides every building/vegetation/prop/boat/NPC/path/infra.
// Terrain GLBs + waterfall stay; ocean/seabed/shallow stay.
if (new URLSearchParams(location.search).has('bare')) {
  world.visible = false;
  decor.visible = false;
  for (const m of bareKeep) m.visible = true;
}
// Debug handle for scene interrogation (read-only; never mutates).
window.__scene = scene;
// Orbit inspection: mouse + touch (tablet primary). Constrained so the island stays framed;
// default pose == overview framing above (screenshots unchanged).
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.42;
controls.minDistance = 40;
controls.maxDistance = 320;
const FOCUS = new URLSearchParams(location.search).get('focus');
if (FOCUS === 'bridge' || FOCUS === 'harbor') controls.target.set(175, 0, 110);
else if (FOCUS === 'farm') controls.target.set(140, 0, -30);
else if (FOCUS === 'civic') controls.target.set(10, 0, -6);
else if (FOCUS === 'top') controls.target.set(10, 0, 8);
else if (FOCUS === 'opposite') controls.target.set(0, 0, 0);
else if (FOCUS === 'shore') controls.target.set(0, 0, 120);
else if (FOCUS === 'highland') controls.target.set(10, 6, -90);
else if (FOCUS === 'sedge') controls.target.set(-38, 3, 28);
else if (FOCUS === 'scoast') controls.target.set(0, 0, 148);
else if (FOCUS === 'scliff') controls.target.set(-48, 8, -62);
else if (FOCUS === 'smid') controls.target.set(-30, 4, 20);
else if (FOCUS === 'slow') controls.target.set(-34, 4, 24);
else if (FOCUS === 'sclose') controls.target.set(-38, 3, 28);
else if (FOCUS === 'sforest') controls.target.set(8, 6, -88);
else if (FOCUS === 'sreef') controls.target.set(0, -0.5, 143);
else if (FOCUS === 'sharbor') controls.target.set(103, 1, 123);
else controls.target.set(10, 0, 10);
controls.maxDistance = 1200;
controls.update();
animate();
await tick(); setInterval(tick, 2000);
window.__astrixReady = true;
