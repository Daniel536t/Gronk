// Homestead dressing: courtyard + split-rail fences per RECONCILED building.
// Causal: follows state (rebuilds when dyn membership changes), represents only.
// Timber fences + worn-earth courtyards turn claimed lots into inhabited plots.
import { mergeGeos } from './staging-paths.js';

const TIMBER = 0x6b4a2e, SOIL = 0x93765a;

// Lane-side pastoral fence runs (static, always correct — never on lots).
export const LANE_FENCES = [
  [[-8, 14], [-20, 22]], [[-28, 30], [-38, 36]],
  [[6, 20], [0, 30]], [[36, 2], [48, -4]],
];

function fenceRun(geos, x1, z1, x2, z2, groundY) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 2));
  const box = (w, h, d, x, y, z, ry) => ({ w, h, d, x, y, z, ry });
  const parts = [];
  for (let i = 0; i <= n; i++) {
    const x = x1 + (dx * i) / n, z = z1 + (dz * i) / n;
    parts.push(box(0.14, 0.9, 0.14, x, groundY(x, z) + 0.45, z, 0));
  }
  const ang = Math.atan2(dx, dz);
  for (const h of [0.45, 0.72]) {
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    parts.push({ w: 0.09, h: 0.09, d: len, x: mx, y: groundY(mx, mz) + h, z: mz, ry: ang });
  }
  return parts;
}

function boxesToGeo(THREE, parts) {
  const gs = parts.map(({ w, h, d, x, y, z, ry }) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry || 0); g.translate(x, y, z);
    return g;
  });
  const merged = mergeGeos(gs, THREE);
  gs.forEach(g => g.dispose());
  return merged;
}

export function homesteadSignature(dyn) {
  return [...dyn.keys()].filter(k => !String(k).startsWith('bridge:') && !String(k).startsWith('crop:') && !String(k).startsWith('field:')).sort().join(',');
}

export function buildHomesteads(ctx) {
  // ctx: { THREE, groundY, decor, buildings: [{x,z}] } (reconciled positions)
  const { THREE, groundY, decor, buildings } = ctx;
  const group = new THREE.Group();
  const timberMat = new THREE.MeshStandardMaterial({ color: TIMBER, roughness: 0.9 });
  const soilMat = new THREE.MeshStandardMaterial({ color: SOIL, roughness: 1 });
  const fenceParts = [];
  for (const b of buildings) {
    // courtyard disc (front, +Z side)
    const cy = groundY(b.x, b.z + 5.5);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), soilMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(b.x, cy + 0.07, b.z + 5.5);
    disc.receiveShadow = true;
    group.add(disc);
    // fence L: front run with gate gap + side run (gate faces courtyard)
    const fx = b.x - 4, fz = b.z + 8.5;
    fenceParts.push(...fenceRun(null, fx, fz, b.x - 1.2, fz, groundY));
    fenceParts.push(...fenceRun(null, b.x + 1.2, fz, b.x + 4, fz, groundY));
    fenceParts.push(...fenceRun(null, b.x + 4, fz, b.x + 4, fz - 6, groundY));
  }
  for (const [a, c] of LANE_FENCES) fenceParts.push(...fenceRun(null, a[0], a[1], c[0], c[1], groundY));
  if (fenceParts.length) {
    const fences = new THREE.Mesh(boxesToGeo(THREE, fenceParts), timberMat);
    fences.castShadow = true; fences.receiveShadow = true;
    group.add(fences);
  }
  decor.add(group);
  return group;
}
