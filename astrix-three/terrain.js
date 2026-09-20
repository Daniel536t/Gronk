// ASTrix island landform — analytic TWIN of the authored Blender terrain
// (assets/blender/build_terrain_v1.py). Same zones, same numbers, simplified.
// Role: fast queries (scatter pre-filter, gameplay logic). RUNTIME PLACEMENT
// grounds via raycast against the rendered GLB mesh (exact, no drift).
// Y-up meters. NORTH = -z. Map: artifacts/visual/world-blueprint/world-map.
function gauss(x, z, cx, cz, s) {
  const dx = (x - cx) / s, dz = (z - cz) / s;
  return Math.exp(-(dx * dx + dz * dz));
}
function peak(x, z, cx, cz, h, sx, szN, szS) {
  const dx = (x - cx) / sx, dz = (z - cz) / (z < cz ? szN : szS);
  return h * Math.exp(-(dx * dx + dz * dz));
}
function rgauss(x, z, cx, cz, sx, sz, ang, h) {
  const dx = x - cx, dz = z - cz;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const u = (dx * ca + dz * sa) / sx, v = (-dx * sa + dz * ca) / sz;
  return h * Math.exp(-(u * u + v * v));
}
const sstep = (a, b, t) => {
  const k = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export const SEA_Y = -0.35;

export function heightAt(x, z) {
  const dx = (x - 10) / 245, dz = (z - 8) / 175;
  const r = Math.hypot(dx, dz);
  const th = Math.atan2(dz, dx);
  let coast = 1.0 + 0.10 * Math.cos(2 * th + 0.6) - 0.08 * Math.cos(3 * th - 1.1)
    + 0.06 * Math.cos(5 * th + 2.0);
  const bth = Math.atan2((135 - 8) / 175, (170 - 10) / 245);
  let dth = Math.abs(th - bth);
  if (dth > Math.PI) dth = 2 * Math.PI - dth;
  coast -= 0.30 * Math.exp(-(dth * dth) / 0.09);
  const land = sstep(1.03, 0.80, r / coast);
  // N mountain spine (mirrors build_terrain_v1.py; terracing/gully/pool omitted:
  // placement raycasts the GLB exactly, guards use sea-level thresholds only)
  let up = 2.6
    + peak(x, z, -34, -108, 12.0, 24, 12, 30)
    + peak(x, z, 6, -114, 14.5, 28, 13, 34)
    + peak(x, z, 46, -106, 11.5, 22, 12, 28)
    + 4.0 * gauss(x, z, 60, -118, 26)
    + 5.0 * gauss(x, z, -62, -62, 10) + 4.5 * gauss(x, z, 52, -58, 9)
    + 4.0 * gauss(x, z, -18, -38, 8) + 5.0 * gauss(x, z, 92, -72, 11)
    + 4.0 * gauss(x, z, -10, -80, 9) + 3.5 * gauss(x, z, 30, -84, 8)
    + rgauss(x, z, 205, 55, 34, 13, -0.5, 3.5) + rgauss(x, z, -175, 55, 30, 15, 0.4, 3.0);
  const pm = sstep(60, 22, Math.hypot(x - 10, z - 2));
  up = up * (1 - pm * 0.72) + 3.4 * pm;
  const fm = sstep(46, 16, Math.hypot(x - 150, z + 40));
  up = up * (1 - fm * 0.6) + 3.0 * fm;
  const shore = sstep(0.0, 0.15, land);
  let h = Math.max(-6.0, -6.0 + (up + 6.0) * shore);
  h = Math.max(h, -6.0 + 15.0 * gauss(x, z, 14, -100, 42));
  h = Math.max(h, -6.0 + 10.0 * gauss(x, z, 150, -38, 34));
  h = Math.max(h, -6.0 + 9.2 * gauss(x, z, -95, 175, 11));
  h = Math.max(h, -6.0 + 11.5 * gauss(x, z, 228, 105, 8));
  h = Math.max(h, -6.0 + 8.0 * gauss(x, z, -195, 45, 10));
  h = Math.max(h, -6.0 + 8.0 * gauss(x, z, -15, -195, 7));
  h = Math.max(h, -6.0 + 4.8 * gauss(x, z, 30, 210, 30));
  for (const [ccx, ccz, cr] of [[0, 171, 55], [187, 80, 40], [-185, 100, 45]]) {
    const dd = Math.hypot(x - ccx, z - ccz);
    if (dd < cr) {
      const prof = 1.1 - (dd / cr) * 3.1;
      const m = sstep(cr, cr * 0.55, dd) * 0.9 + 0.1;
      h = h * (1 - m) + prof * m;
    }
  }
  return h;
}

export function colorAt(x, z, h, slope) {
  if (h < SEA_Y + 0.45) return [0.91, 0.81, 0.60];
  if (slope > 0.42 || h > 7.2) return [0.60, 0.60, 0.63];
  if (h > 5.2) return [0.45, 0.62, 0.35];
  return [0.37, 0.75, 0.35];
}
