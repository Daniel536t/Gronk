# Shore Palm A — pipeline proof (NOT a rollout)
BLENDER BINARY: /usr/bin/blender 5.0.1 (headless, bpy)
BLENDER SCENE: .../blender/shore-palm-a.blend
BLENDER SOURCE: assets/blender/veg_palmA.py (sculpted tapered/ringed/curved
  trunk; 9 custom ribbon-mesh fronds in 3 tiers with arch, V-fold, taper,
  jittered yaw/length/tilt; coconut cluster)
BLENDER RENDER: turntable tool broken for this asset class (empty frames;
  separate tooling debt, same failure as geo 3-5) — review done in Three.js
  isolated views instead (3/4, side, low): arching fronds, gaps, overlap,
  coconuts all verified.
GLB: assets/glb/ASTX_VEG_PALM_A.glb (staged, NOT in manifest, NOT deployed
  beyond a static copy for test loads, NOT referenced by the world)
THREE.JS: bounds x±~2.9 / y 0..4.9 (spec 4–6m ✓), grounded, 3-angle renders.
REVISION: fronds 0.34→0.52 wide (spike read → blade read), rest kept.
Reference comparison: separate arching fronds with gaps (not rectangles, not a
box); tapered trunk; coconuts; asymmetry; 4.9m scale. Curtain-like hang on one
side noted as residual nit.
Old primitive failed all of the above (flat quads, no arch, no gaps).
