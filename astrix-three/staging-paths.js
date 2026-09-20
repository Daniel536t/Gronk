// Authored path network (authored-world INFRA, not decor, not state).
// Organic circulation: plaza ring + radials threading BETWEEN lots (audited),
// contour-following farm lane, harbor descent ending at the overlook.
// Terrain-following ribbons (2m sand + stone edging), merged to 2 draws.
// Density-invariant: paths never thin out.
export const PATH_ROUTES = [
  { name: 'plaza-ring', w: 1.8, pts: [[20,0],[18.7,5],[15,8.7],[10,10],[5,8.7],[1.3,5],[0,0],[1.3,-5],[5,-8.7],[10,-10],[15,-8.7],[18.7,-5],[20,0]] },
  { name: 'market', w: 1.6, pts: [[10,0],[20,4],[28,8],[34,8]] },
  { name: 'w-lanes', w: 1.6, pts: [[10,0],[0,10],[-12,18],[-24,26],[-36,32],[-48,38]] },
  { name: 's-lanes', w: 1.6, pts: [[10,0],[8,14],[4,26],[-2,38],[-10,48]] },
  { name: 'lane-link', w: 1.3, pts: [[-24,26],[-14,34],[-4,38]] },
  { name: 'farm-lane', w: 1.8, pts: [[10,0],[30,-6],[52,-8],[72,-16],[92,-26],[112,-32],[130,-34]] },
  { name: 'harbor-descent', w: 1.6, pts: [[10,0],[30,20],[55,45],[80,70],[102,95]] },
  { name: 'market-farm', w: 1.3, pts: [[34,8],[60,-2],[80,-14]] },
];

export function mergeGeos(gs, THREE) {
  // manual merge (positions+normals+index only; avoids addon dependency)
  let vc = 0, ic = 0;
  for (const g of gs) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  const idx = new (vc > 65535 ? Uint32Array : Uint16Array)(ic);
  let vo = 0, io = 0;
  for (const g of gs) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const ia = g.index.array;
    for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo;
    vo += g.attributes.position.count; io += ia.length;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
export function buildPaths(ctx) {
  // ctx: { THREE, groundY, decor }
  const { THREE, groundY, decor } = ctx;
  const sandGeos = [], edgeGeos = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const route of PATH_ROUTES) {
    const curve = new THREE.CatmullRomCurve3(route.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), route.name === 'plaza-ring');
    const len = curve.getLength();
    const n = Math.max(8, Math.round(len / 1.5));
    const spine = curve.getSpacedPoints(n);
    const strip = (w, lift, store) => {
      const pos = [];
      for (let i = 0; i <= n; i++) {
        const c = spine[i];
        const t = curve.getTangent(i / n); t.y = 0; t.normalize();
        const nx = -t.z, nz = t.x;
        for (const s of [-1, 1]) {
          const x = c.x + nx * s * w / 2, z = c.z + nz * s * w / 2;
          pos.push(x, groundY(x, z) + lift, z);
        }
      }
      const idx = [];
      for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      store.push(g);
    };
    strip(route.w + 0.6, 0.04, edgeGeos);
    strip(route.w, 0.09, sandGeos);
  }
  const sand = new THREE.Mesh(mergeGeos(sandGeos, THREE),
    new THREE.MeshStandardMaterial({ color: 0xe8cf9a, roughness: 1 }));
  sand.receiveShadow = true;
  const edge = new THREE.Mesh(mergeGeos(edgeGeos, THREE),
    new THREE.MeshStandardMaterial({ color: 0x8d8d94, roughness: 0.95 }));
  edge.receiveShadow = true;
  decor.add(edge, sand);
  window.__paths = { routes: PATH_ROUTES.length };
  return window.__paths;
}
