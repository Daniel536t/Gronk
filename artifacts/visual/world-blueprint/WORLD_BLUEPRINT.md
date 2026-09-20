# WORLD_BLUEPRINT.md — the world as a spatial system (map: world-map.svg/png)
Coordinate frame: meters, +X east, North up on the map. World 800x600.
Map south (+z world) is DOWN on the page. Zones 1-14 per legend.

## Mass budget (map area share, water excluded)
Highlands rock ~12% | forest slopes ~18% | settlement ~16% | farms ~8% |
beaches/sand ~10% | harbor/water structures ~4% | reef shelf ~8% | open sea rest.

## Vertical budget (meters above sea)
Peak (ridge) 12-14 | windmill knoll 9-10 | civic plaza 3-4 | farms 2.5-4 |
beaches 0-0.8 | harbor water -2..-5 | reef shelf -1..-2.5 | deep -6+.

## Adjacency rules (what touches what — the anti-scatter contract)
- Settlement touches plaza on all sides; farms NEVER touch plaza (market row buffers E).
- Windmill touches ridge + forest, never houses (clearance 25m+, silhouette rule).
- Lighthouse touches ONLY its rock + footbridge (isolation = landmark legibility).
- Harbor touches bay water on 3 sides + path into town on the 4th.
- Waterfall touches cliff face + plunge pool + downstream channel, in that order.
- Reef touches shallow shelf, never beach sand directly (gap of turquoise).
- Paths touch plaza → town hall / market / farms / harbor / beaches; no dead ends
  except lookout points.

## Camera contract
Default hero: elevated S/SW three-quarter (matches ref3 angle), island fills
~70% width, ocean establishes island-ness. Civic/harbor/terrain/farm focuses
per existing ?focus= views. Waterfall + lighthouse must both be visible in hero.
