# assets/blender — Blender factory sources

Blender is the asset factory. Three.js is the observer. Core is the authority.

Because this environment has no Blender binary, the headless equivalent
`tools/build_glbs.py` (+ `tools/astx_glb.py`) generates the exact same
geometry/naming/origins as the `.py` scripts below. Open any script in
Blender's Text Editor → Run: it builds the asset with `ASTX_*` object names,
meters, bottom-anchored origin (y=0 at ground center), applied transforms,
and shared `M_*` materials.

- `build_house.py` — ASTX_BUILDING_HOUSE (walls, foundation, gable roof, chimney, door, window)
- `build_palm.py` — ASTX_VEG_PALM (trunk + 6 fronds + nuts)
- All other assets follow the same kit language; see `tools/build_glbs.py` for
  exact dims (single source of truth until a Blender workstation extends these).

Export from Blender: File → Export → glTF (.glb), Apply Modifiers ✓, UVs ✓,
Normals ✓, Materials Export ✓, image format WebP/JPEG for large textures,
one file per asset named `<ASTX_ID>.glb` into `assets/glb/`, then update
`assets/manifests/asset-manifest.json` (schema in `assets/materials/`).
