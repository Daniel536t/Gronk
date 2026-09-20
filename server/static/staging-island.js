// Gate D island-scale staging assembly (STAGING ONLY — never production).
// Production-style batching: one InstancedMesh per template part per asset.
// Decorative vegetation only: existence comes from authored layout, NEVER from
// Core state. Stateful entities (buildings/crops/bridges/NPCs) are mirrored by
// reconcileDynamic/reconcile from the authoritative snapshot (causal path).
import { GROVES, ISLAND_GROVES, densityFilter } from './staging-grove.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const AQUATIC = new Set(['ASTX_VEG_SEAWEED_A', 'ASTX_VEG_CORAL_A']);

export async function assembleIsland(ctx) {
  // ctx: { THREE, loadGLB, groundY, heightAt, decor, density, exclude }
  // exclude: [{x,z,r}] no-plant circles (lots, plots, rendered buildings).
  // Nothing decorative may collide with architecture — ever.
  const { THREE, loadGLB, groundY, heightAt, decor, density, exclude = [] } = ctx;
  const clearOf = (x, z) => {
    for (const s of exclude) {
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz < s.r * s.r) return s;
    }
    return null;
  };
  const groves = [...GROVES, ...ISLAND_GROVES];
  const perAsset = new Map(); // asset -> [{x,y,z,ry,sc}]
  const skipped = [];
  for (const grove of groves) {
    // Density knob governs VEGETATION only. Architecture (non-VEG assets)
    // always places: a plaza must not vanish at low density.
    const vegIdx = grove.items.map((it, i) => i).filter(i => grove.items[i][0].startsWith('ASTX_VEG_'));
    const kept = new Set(densityFilter(vegIdx.map(i => i)));
    const [sx, sz] = grove.site;
    for (const [i, [asset, dx, dz, ry, sc, opts = {}]] of grove.items.entries()) {
      if (asset.startsWith('ASTX_VEG_') && !kept.has(i)) continue;
      const x = sx + dx, z = sz + dz;
      // Authored non-vegetation (architecture, props) is DELIBERATELY placed
      // relative to buildings, so it bypasses exclusion. Only vegetation
      // (the scatter/collision risk) must clear lots and buildings.
      const wild = asset.startsWith('ASTX_VEG_') && !opts.bypass;
      const hit = wild ? clearOf(x, z) : null;
      if (hit) { skipped.push([asset, x, z, 'lot']); continue; }
      const h = heightAt(x, z);
      const aquatic = AQUATIC.has(asset);
      if (!aquatic && h < 0.0) { skipped.push([asset, x, z, h]); continue; }
      if (aquatic && h > 0.6) { skipped.push([asset, x, z, h]); continue; }
      const y = groundY(x, z) - 0.05;
      if (!perAsset.has(asset)) perAsset.set(asset, []);
      // buildings/plots: exact authored rotation (no golden-angle jitter)
      const yaw = opts.ryExact ? (ry * Math.PI) / 180 : (ry * Math.PI) / 180 + i * 2.39996;
      perAsset.get(asset).push({ x, y, z, ry: yaw, sc });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3(), part = new THREE.Matrix4();
  const summary = {};
  let mergedGroups = 0, soloParts = 0;
  for (const [asset, list] of perAsset) {
    const tpl = await loadGLB(`/assets/glb/${asset}.glb`);
    tpl.updateMatrixWorld(true);
    const parts = [];
    tpl.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, local: o.matrixWorld.clone() }); });
    // Merge-by-material: single-group, same-attribute parts sharing a material
    // become one geometry (silhouette-preserving: pure rigid vertex merge).
    const byMat = new Map();
    for (const part of parts) {
      const sig = Object.keys(part.geo.attributes).sort().join(',') + '|indexed=' + (part.geo.index ? 1 : 0);
      const key = part.mat.uuid + '|' + sig + '|groups=' + part.geo.groups.length;
      if (!byMat.has(key)) byMat.set(key, { mat: part.mat, items: [] });
      byMat.get(key).items.push(part);
    }
    const batches = [];
    for (const { mat, items } of byMat.values()) {
      if (items.length > 1 && items[0].geo.groups.length <= 1) {
        const gs = items.map(({ geo, local }) => geo.clone().applyMatrix4(local));
        const merged = mergeGeometries(gs, false);
        gs.forEach(g => g.dispose());
        if (merged) { batches.push({ geo: merged, mat, local: new THREE.Matrix4() }); mergedGroups++; continue; }
      }
      for (const { geo, mat: m2, local } of items) { batches.push({ geo, mat: m2, local }); soloParts++; }
    }
    summary[asset] = { instances: list.length, parts: parts.length, batches: batches.length };
    for (const { geo, mat, local } of batches) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = true; im.receiveShadow = true;
      list.forEach((t, i) => {
        e.set(0, t.ry, 0); q.setFromEuler(e);
        p.set(t.x, t.y, t.z); s.set(t.sc, t.sc, t.sc);
        m4.compose(p, q, s).multiply(local);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      decor.add(im);
    }
  }
  window.__mergeStats = { mergedGroups, soloParts };
  const total = [...perAsset.values()].reduce((a, l) => a + l.length, 0);
  window.__island = {
    sites: groves.map(g => g.site.join(',')),
    density,
    instances: total,
    assets: summary,
    skipped: skipped.length,
    skippedList: skipped.map(([a, x, z, h]) => `${a}@${Math.round(x)},${Math.round(z)} h=${typeof h === 'number' ? h.toFixed(2) : h}`),
  };
  return window.__island;
}
