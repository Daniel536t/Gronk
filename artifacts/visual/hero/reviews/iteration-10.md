# Iteration 10 — shoreline focus (Option A). NO done-words; verdict requested.
Frames: bare-shore x2, hero, + earlier bare-top/hero/opposite/highland/civic.

## Built this pass
- Cove shelf geometry (S/E/W profiles +1.1→-2.0) + bay azimuth corrected.
- Foam-white waterline band + wet band; beach kit moved onto coves.
- Shallow sand discs under S/E/W coves (turquoise read at distance).
- Terrain skirt + 2400m ocean/seabed (grey gap artifact gone).
- Vertex colors → per-VERTEX via bmesh slope normals (quilt killer).
- Lighting baseline (key 2.6, bias, bounce); 6 test views; group-based bare mode.

## Shoreline test read (honest)
- Shore close-up: sand band + white foam line + dark water READ. PASS at close range.
- Hero: coastline rim + S shallows + E beaches READ. PASS with caveats.
- Caveats: water itself flat dark (no turquoise gradient — water phase debt);
  mid-range ground still faintly quilts; W cliff-kit boxes exposed as boxes;
  foam invisible beyond ~150m.
- Verdict requested: does this satisfy "ground approved," or does the shore
  need another targeted round (gradient water + beach geometry detail)?

## Preserved
271/271, typecheck, Core/bus/gate/verify/MagicBlock untouched, live world
untouched (no restart; static copies only). No vegetation/density added.
