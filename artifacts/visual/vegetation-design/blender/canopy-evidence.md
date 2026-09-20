# Canopy Broadleaf A — pipeline proof (NOT a rollout)
BLENDER BINARY: /usr/bin/blender 5.0.1 (headless, bpy)
BLENDER SCENE: artifacts/visual/vegetation-design/blender/canopy-broadleaf-a.blend
BLENDER SOURCE: assets/blender/veg_canopyA.py (sculpted trunk, aimed branches,
  3 displaced icosphere masses, seeded, flat-shaded)
BLENDER RENDER: .../canopy-broadleaf-a-turntable.png (2 iterations: raised
  crowns, longer trunk, thicker branches, stronger displacement)
GLB EXPORT: assets/glb/ASTX_VEG_CANOPY_A.glb (38K; staged, NOT in manifest,
  NOT deployed, NOT referenced by the world)
THREE.JS IMPORT: success, bounds x±4.1 / y 0..7.8 (spec 6–8m ✓), grounded,
  crown shadow reads.
THREE.JS RENDER: .../canopy-broadleaf-a-three.png

Reference comparison (design sheet): 3 overlapping ragged masses widest ~60%,
visible tapered/bent trunk, branch structure into crowns, gaps, asymmetry,
3-tone greens. Old primitive: 1 box + 1 cylinder, no branches, no gaps.
Verdict: materially beyond the primitive ceiling on every listed axis.
Remaining nits: crown slightly top-heavy from some angles; trunk columnar
below fork. Awaiting director review before the other six + grove + rollout.
