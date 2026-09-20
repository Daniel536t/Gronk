# LIGHTING_BLUEPRINT.md — match the reference, not "nice" colors
- Key: warm sun upper-LEFT, ~45° elevation, #FFF1D6, THE shadow caster (2048,
  tight frustum on main island). Long readable shadows = form definition.
- Fill: cool sky #BFE3FF hemisphere, no shadow. Ambient: sea-sky blue gradient.
- Exposure/tone: painterly mid-key; whites never clip (turntable blew out roofs
  twice — fixed by metering). AO: baked vertex/cavity on cliffs + contact discs
  under buildings (no floating reads).
- Water: sun-glint lane aligned with key; shallow turquoise vs deep blue split
  by depth uniform from island footprints (existing shader approach, improve
  ramp). Foam: white reserved for shoreline band + falls crests.
- Palette (locked): ocean #0A5A8A, shallow #1E9EC0, foam #E8FBFF, sand #E8CF9A,
  grass #5FBF5A, foliage #2E7D3A, wood #8A5A33, timber-dark #5B3418 (soil MUST
  differ — prior decks-vs-soil failure), roofs #C96F2E/#2E7FC9, stone #9A9AA0,
  gold #FFB02E emissive-only accent, coral violet reserved exotic.
- Night: out of scope this phase (day/dusk authoritative cycle exists in Core;
  presentation follows later, never wall-clock).
