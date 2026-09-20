extends Object
class_name CityKit
## Procedural PBR city construction kit for the ASTrix Economic Observatory.
##
## ARCHITECTURE (from research): hybrid procedural + authored (brief option E).
## Road-first layout, parcel subdivision, per-district building typologies, all
## from primitives with shared unit meshes + cached PBR StandardMaterial3D.
## No external assets: license-clean, web (gl_compatibility) safe.
##
## RENDERING CONSTRAINT (measured, not assumed): the project exports to Web with
## renderer/rendering_method="gl_compatibility". SDFGI and volumetric fog are
## Forward+ only (Godot 4.7 docs), so they are unavailable here. The kit uses
## what Compatibility DOES support: PBR albedo/metallic/roughness, emissive
## windows, real shadow-casting directional light, traditional fog, ProceduralSky,
## Filmic/ACES tonemap. Documented in godot/ASSET_LICENSING.md.
##
## PERFORMANCE: one shared UNIT_BOX mesh scaled per node (mesh reuse), cached
## materials (material reuse), static shadows only from the sun. Repeated small
## props (lamps, bollards, trees) are built as single nodes; the traffic layer
## in World3D uses MultiMesh where counts exceed ~50.

static var _unit_box: BoxMesh
static var _mats: Dictionary = {}

static func unit_box() -> BoxMesh:
	if _unit_box == null or not is_instance_valid(_unit_box):
		_unit_box = BoxMesh.new()
		_unit_box.size = Vector3.ONE
	return _unit_box

## Cached PBR material. Key selects a tuned preset; tint optionally adjusts albedo.
static func mat(key: String, tint: Color = Color(1, 1, 1, 1)) -> StandardMaterial3D:
	var cache_key := key + "_" + tint.to_html()
	if _mats.has(cache_key):
		return _mats[cache_key]
	var m := StandardMaterial3D.new()
	match key:
		"concrete":
			m.albedo_color = Color("b8b4ac") * tint
			m.roughness = 0.92
		"concrete_dark":
			m.albedo_color = Color("7d7a74") * tint
			m.roughness = 0.95
		"asphalt":
			m.albedo_color = Color("333438")
			m.roughness = 0.96
		"asphalt_worn":
			m.albedo_color = Color("45464a")
			m.roughness = 0.98
		"sidewalk":
			m.albedo_color = Color("9b978e")
			m.roughness = 0.95
		"curb":
			m.albedo_color = Color("6e6c66")
			m.roughness = 0.95
		"glass":
			m.albedo_color = Color("2b3e4e")
			m.metallic = 0.85
			m.roughness = 0.12
		"glass_warm":
			m.albedo_color = Color("4a4234")
			m.metallic = 0.7
			m.roughness = 0.18
			m.emission_enabled = true
			m.emission = Color("ffcf7a")
			m.emission_energy_multiplier = 0.9
		"brick":
			m.albedo_color = Color("8a4a38") * tint
			m.roughness = 0.9
		"roof":
			m.albedo_color = Color("3c3e42")
			m.roughness = 0.9
		"metal":
			m.albedo_color = Color("7a8288")
			m.metallic = 0.8
			m.roughness = 0.38
		"metal_dark":
			m.albedo_color = Color("3a3f45")
			m.metallic = 0.6
			m.roughness = 0.55
		"paint_white":
			m.albedo_color = Color("dfe3e6")
			m.roughness = 0.6
		"paint_yellow":
			m.albedo_color = Color("d8a428")
			m.roughness = 0.65
		"foliage":
			m.albedo_color = Color("4a7a34") * tint
			m.roughness = 0.95
		"trunk":
			m.albedo_color = Color("5a4230")
			m.roughness = 0.95
		"soil":
			m.albedo_color = Color("4c4438")
			m.roughness = 1.0
		"water":
			m.albedo_color = Color("1c4a6e")
			m.metallic = 0.4
			m.roughness = 0.15
		"lamp_head":
			m.albedo_color = Color("fff2cc")
			m.emission_enabled = true
			m.emission = Color("ffe6a0")
			m.emission_energy_multiplier = 2.2
		"signal_red":
			m.albedo_color = Color("a02020")
			m.emission_enabled = true
			m.emission = Color("ff2a1a")
			m.emission_energy_multiplier = 1.6
		"signal_green":
			m.albedo_color = Color("1a7028")
			m.emission_enabled = true
			m.emission = Color("2aff5a")
			m.emission_energy_multiplier = 1.6
		"sign":
			m.albedo_color = Color("204a80") * tint
			m.roughness = 0.5
			m.emission_enabled = true
			m.emission = Color("204a80") * tint
			m.emission_energy_multiplier = 0.35
		"window_dark":
			m.albedo_color = Color("232c34")
			m.metallic = 0.6
			m.roughness = 0.25
		"window_lit":
			m.albedo_color = Color("ffdf9a")
			m.emission_enabled = true
			m.emission = Color("ffcf7a")
			m.emission_energy_multiplier = 1.5
		"hazard":
			m.albedo_color = Color("c87818")
			m.roughness = 0.8
		"crane":
			m.albedo_color = Color("c8a020")
			m.roughness = 0.6
			m.metallic = 0.3
		_:
			m.albedo_color = tint
			m.roughness = 0.9
	_mats[cache_key] = m
	return m

## Unit-box part: position is the CENTRE, size is full extents.
static func part(name_hint: String, size: Vector3, pos: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = name_hint
	node.mesh = unit_box()
	node.scale = size
	node.position = pos
	node.material_override = material
	return node

static func rng(seed_value: int) -> RandomNumberGenerator:
	var r := RandomNumberGenerator.new()
	r.seed = seed_value
	return r

# ===========================================================================
# BUILDINGS — every builder returns a Node3D with ORIGIN AT GROUND CENTRE.
# out["windows_lit"] / out["windows_dark"] collect panes for the dusk cycle.
# out["footprint"] is the XZ size, used by parcels and selection.
# kind selects the typology; district selects the material story.
# ===========================================================================

static func office_tower(seed_value: int, w: float, d: float, floors: int) -> Dictionary:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "OfficeTower"
	var floor_h := 3.0
	var h := float(floors) * floor_h
	var lit: Array[MeshInstance3D] = []
	var dark: Array[MeshInstance3D] = []
	# podium: 2-storey stone retail base with storefront band
	var podium_h := 7.0
	root.add_child(part("Podium", Vector3(w, podium_h, d), Vector3(0, podium_h * 0.5, 0), mat("concrete_dark")))
	root.add_child(part("Storefront", Vector3(w * 0.92, 2.6, 0.2), Vector3(0, 2.2, d * 0.5 + 0.02), mat("glass")))
	var sign_colors := [Color("20c0d0"), Color("e07820"), Color("8040c0")]
	var sign := part("Signage", Vector3(w * 0.5, 0.9, 0.25), Vector3(-w * 0.12, 5.6, d * 0.5 + 0.04), mat("sign", sign_colors[seed_value % 3]))
	sign.name = "Signage"
	root.add_child(sign)
	# tower shaft with alternating glass / concrete slab bands
	var shaft_w := w * (0.82 + r.randf() * 0.08)
	var shaft_d := d * (0.82 + r.randf() * 0.08)
	var base_y := podium_h
	for f in range(floors):
		var fy := base_y + float(f) * floor_h
		var band := part("Slab_%d" % f, Vector3(shaft_w + 0.5, 0.35, shaft_d + 0.5), Vector3(0, fy + 0.17, 0), mat("concrete"))
		root.add_child(band)
		var glazing := part("WindowBand_%d" % f, Vector3(shaft_w, floor_h - 0.5, shaft_d), Vector3(0, fy + floor_h * 0.5 + 0.1, 0), mat("glass"))
		glazing.name = "WindowBand_%d" % f
		root.add_child(glazing)
		dark.append(glazing)
		# vertical fins for silhouette breakup
		if f % 2 == 0:
			for sx in [-1.0, 1.0]:
				root.add_child(part("Fin", Vector3(0.35, floor_h, shaft_d * 0.9), Vector3(sx * (shaft_w * 0.5 + 0.1), fy + floor_h * 0.5, 0), mat("concrete_dark")))
	root.add_child(part("Crown", Vector3(shaft_w * 0.6, 1.2, shaft_d * 0.6), Vector3(0, base_y + h + 0.6, 0), mat("concrete_dark")))
	# rooftop equipment: AC boxes, railing posts, antenna
	root.add_child(part("AC_1", Vector3(1.6, 1.0, 1.2), Vector3(shaft_w * 0.2, base_y + h + 0.5, shaft_d * 0.15), mat("metal")))
	root.add_child(part("AC_2", Vector3(1.1, 0.8, 0.9), Vector3(-shaft_w * 0.22, base_y + h + 0.4, -shaft_d * 0.12), mat("metal_dark")))
	root.add_child(part("Antenna", Vector3(0.18, 4.2, 0.18), Vector3(shaft_w * 0.1, base_y + h + 2.1, -shaft_d * 0.2), mat("metal_dark")))
	# entrance canopy + doors
	root.add_child(part("Canopy", Vector3(3.4, 0.25, 1.6), Vector3(0, 3.4, d * 0.5 + 0.8), mat("metal_dark")))
	for dx in [-0.9, 0.9]:
		root.add_child(part("DoorCol", Vector3(0.3, 3.2, 0.3), Vector3(dx * 1.6, 1.6, d * 0.5 + 1.3), mat("metal_dark")))
	return {"root": root, "height": base_y + h, "footprint": Vector3(w, 0, d), "windows_lit": lit, "windows_dark": dark}

static func apartment_block(seed_value: int, w: float, d: float, floors: int) -> Dictionary:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "Apartments"
	var floor_h := 2.9
	var h := float(floors) * floor_h
	var brick_tints := [Color(1, 1, 1), Color(1.08, 0.95, 0.9), Color(0.92, 0.92, 0.96)]
	var wall_mat: Material = mat("brick", brick_tints[seed_value % 3])
	var lit: Array[MeshInstance3D] = []
	var dark: Array[MeshInstance3D] = []
	root.add_child(part("Base", Vector3(w + 0.4, 0.6, d + 0.4), Vector3(0, 0.3, 0), mat("concrete_dark")))
	root.add_child(part("Walls", Vector3(w, h, d), Vector3(0, h * 0.5 + 0.6, 0), wall_mat))
	root.add_child(part("RoofSlab", Vector3(w + 0.5, 0.4, d + 0.5), Vector3(0, h + 0.8, 0), mat("roof")))
	# parapet + stair bulkhead + railing
	root.add_child(part("Parapet", Vector3(w + 0.5, 0.7, 0.15), Vector3(0, h + 1.3, d * 0.5 + 0.2), mat("brick")))
	root.add_child(part("Bulkhead", Vector3(2.4, 2.0, 2.0), Vector3(w * 0.2, h + 1.8, 0), mat("concrete")))
	# windows + balconies on both long faces
	for f in range(floors):
		var fy := 0.6 + float(f) * floor_h + 1.7
		var bays := maxi(2, int(w / 2.6))
		for b in range(bays):
			var bx := -w * 0.5 + w * (float(b) + 0.5) / float(bays)
			var pane := part("Window_%d_%d" % [f, b], Vector3(1.1, 1.2, 0.15), Vector3(bx, fy, d * 0.5 + 0.03), mat("window_dark"))
			pane.name = "Window_%d_%d" % [f, b]
			root.add_child(pane)
			dark.append(pane)
			if r.randf() < 0.55:
				root.add_child(part("Balcony", Vector3(1.7, 0.15, 0.9), Vector3(bx, fy - 0.85, d * 0.5 + 0.45), mat("concrete")))
				root.add_child(part("BalconyRail", Vector3(1.7, 0.6, 0.08), Vector3(bx, fy - 0.5, d * 0.5 + 0.85), mat("metal_dark")))
	root.add_child(part("Entry", Vector3(1.6, 2.3, 0.3), Vector3(0, 1.75, d * 0.5 + 0.05), mat("glass_warm")))
	return {"root": root, "height": h + 1.0, "footprint": Vector3(w, 0, d), "windows_lit": lit, "windows_dark": dark}

static func commercial_block(seed_value: int, w: float, d: float) -> Dictionary:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "Commercial"
	var h := 7.5 + r.randf() * 2.0
	var lit: Array[MeshInstance3D] = []
	var dark: Array[MeshInstance3D] = []
	root.add_child(part("Walls", Vector3(w, h, d), Vector3(0, h * 0.5, 0), mat("concrete", Color(1.02, 0.98, 0.94))))
	# storefront band with display glass + awnings + signage
	root.add_child(part("ShopGlass", Vector3(w * 0.94, 2.4, 0.18), Vector3(0, 1.9, d * 0.5 + 0.02), mat("glass_warm")))
	var sign_colors := [Color("d02040"), Color("20a080"), Color("e0a020"), Color("2060d0")]
	var nsign := 1 + seed_value % 2
	for s in range(nsign):
		var sx := (float(s) - float(nsign - 1) * 0.5) * w * 0.45
		var sg := part("Signage", Vector3(w * 0.32, 0.9, 0.22), Vector3(sx, 4.4, d * 0.5 + 0.04), mat("sign", sign_colors[(seed_value + s) % 4]))
		sg.name = "Signage"
		root.add_child(sg)
	var naw := maxi(2, int(w / 3.0))
	for a in range(naw):
		var ax := -w * 0.5 + w * (float(a) + 0.5) / float(naw)
		var awn := part("Awning", Vector3(2.2, 0.12, 1.1), Vector3(ax, 3.4, d * 0.5 + 0.55), mat("sign", sign_colors[(seed_value + a) % 4]))
		awn.rotation_degrees.x = -12.0
		root.add_child(awn)
	# upper ribbon windows + cornice + roof plant
	root.add_child(part("Ribbon", Vector3(w * 0.9, 1.4, 0.15), Vector3(0, h - 1.6, d * 0.5 + 0.02), mat("glass")))
	dark.append(root.get_child(root.get_child_count() - 1) as MeshInstance3D)
	root.add_child(part("Cornice", Vector3(w + 0.4, 0.5, d + 0.4), Vector3(0, h + 0.15, 0), mat("concrete_dark")))
	root.add_child(part("RoofUnit", Vector3(1.8, 1.1, 1.4), Vector3(w * 0.2, h + 0.9, 0), mat("metal")))
	return {"root": root, "height": h + 0.4, "footprint": Vector3(w, 0, d), "windows_lit": lit, "windows_dark": dark}

static func warehouse(seed_value: int, w: float, d: float) -> Dictionary:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "Warehouse"
	var h := 6.0 + r.randf() * 1.5
	root.add_child(part("Walls", Vector3(w, h, d), Vector3(0, h * 0.5, 0), mat("concrete", Color(0.9, 0.88, 0.82))))
	# sawtooth roof monitors
	var bays := maxi(2, int(w / 6.0))
	for b in range(bays):
		var bx := -w * 0.5 + w * (float(b) + 0.5) / float(bays)
		root.add_child(part("Monitor", Vector3(3.0, 1.4, 2.2), Vector3(bx, h + 0.7, 0), mat("concrete_dark")))
		root.add_child(part("MonitorGlass", Vector3(3.0, 0.8, 0.15), Vector3(bx, h + 0.8, 1.12), mat("glass")))
	# loading docks on +Z face
	var docks := maxi(2, int(w / 5.0))
	for i in range(docks):
		var dx := -w * 0.5 + w * (float(i) + 0.5) / float(docks)
		root.add_child(part("DockDoor", Vector3(2.6, 3.2, 0.15), Vector3(dx, 1.7, d * 0.5 + 0.03), mat("metal_dark")))
		root.add_child(part("DockApron", Vector3(3.2, 0.15, 2.4), Vector3(dx, 0.08, d * 0.5 + 1.2), mat("concrete_dark")))
	# pallets + dumpster + vents
	root.add_child(part("Pallet", Vector3(1.2, 1.0, 1.2), Vector3(w * 0.5 + 1.4, 0.5, d * 0.2), mat("concrete", Color(0.75, 0.6, 0.45))))
	root.add_child(part("Dumpster", Vector3(2.0, 1.2, 1.1), Vector3(-w * 0.5 - 1.6, 0.6, d * 0.25), mat("metal_dark")))
	root.add_child(part("Vent", Vector3(0.5, 1.6, 0.5), Vector3(w * 0.25, h + 0.8, -d * 0.2), mat("metal")))
	return {"root": root, "height": h + 1.4, "footprint": Vector3(w, 0, d), "windows_lit": [], "windows_dark": []}

static func civic_hall(seed_value: int, w: float, d: float) -> Dictionary:
	var root := Node3D.new()
	root.name = "CivicHall"
	var h := 10.0
	root.add_child(part("Steps", Vector3(w * 0.6, 0.5, 3.0), Vector3(0, 0.25, d * 0.5 + 1.4), mat("concrete")))
	root.add_child(part("Walls", Vector3(w, h, d), Vector3(0, h * 0.5 + 0.5, 0), mat("concrete", Color(1.04, 1.0, 0.94))))
	for i in range(6):
		var cx := -w * 0.5 + w * (float(i) + 0.5) / 6.0
		root.add_child(part("Column", Vector3(0.9, h - 1.0, 0.9), Vector3(cx, (h - 1.0) * 0.5 + 0.5, d * 0.5 + 0.45), mat("paint_white")))
	root.add_child(part("Entablature", Vector3(w + 0.8, 1.2, 1.6), Vector3(0, h - 0.1, d * 0.5 + 0.4), mat("concrete_dark")))
	root.add_child(part("ClockGlass", Vector3(1.6, 1.6, 0.2), Vector3(0, h - 0.1, d * 0.5 + 1.25), mat("glass_warm")))
	root.add_child(part("RoofSlab", Vector3(w + 0.6, 0.5, d + 0.6), Vector3(0, h + 0.75, 0), mat("roof")))
	return {"root": root, "height": h + 1.0, "footprint": Vector3(w, 0, d), "windows_lit": [], "windows_dark": []}

static func construction_site(seed_value: int, w: float, d: float) -> Dictionary:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "Construction"
	var h := 4.0 + r.randf() * 3.0
	# concrete core + exposed slab edges + scaffolding poles
	root.add_child(part("Core", Vector3(w * 0.5, h, d * 0.5), Vector3(0, h * 0.5, 0), mat("concrete")))
	for f in range(maxi(2, int(h / 3.0))):
		var fy := 3.0 + float(f) * 3.0
		root.add_child(part("SlabEdge", Vector3(w * 0.85, 0.3, d * 0.85), Vector3(0, fy, 0), mat("concrete_dark")))
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			root.add_child(part("Scaffold", Vector3(0.15, h + 2.0, 0.15), Vector3(sx * w * 0.48, (h + 2.0) * 0.5, sz * d * 0.48), mat("metal")))
	# tower crane: mast + jib + counter-jib + hook cable
	root.add_child(part("CraneMast", Vector3(0.8, h + 9.0, 0.8), Vector3(w * 0.5 + 1.5, (h + 9.0) * 0.5, -d * 0.3), mat("crane")))
	root.add_child(part("CraneJib", Vector3(9.0, 0.5, 0.5), Vector3(w * 0.5 + 1.5 - 3.0, h + 8.6, -d * 0.3), mat("crane")))
	root.add_child(part("CraneCounter", Vector3(3.0, 0.5, 0.5), Vector3(w * 0.5 + 1.5 + 4.5, h + 8.6, -d * 0.3), mat("crane")))
	root.add_child(part("HookCable", Vector3(0.08, 3.0, 0.08), Vector3(w * 0.5 - 4.0, h + 7.0, -d * 0.3), mat("metal_dark")))
	root.add_child(part("HookLoad", Vector3(1.4, 1.0, 0.8), Vector3(w * 0.5 - 4.0, h + 5.0, -d * 0.3), mat("concrete_dark")))
	# barriers + site hut
	for i in range(maxi(3, int(w / 2.5))):
		var bx := -w * 0.5 + float(i) * 2.5
		root.add_child(part("Barrier", Vector3(2.0, 0.9, 0.25), Vector3(bx, 0.45, d * 0.5 + 1.6), mat("hazard")))
	root.add_child(part("SiteHut", Vector3(2.4, 2.4, 2.0), Vector3(-w * 0.5 - 2.0, 1.2, d * 0.3), mat("paint_white")))
	return {"root": root, "height": h + 9.0, "footprint": Vector3(w, 0, d), "windows_lit": [], "windows_dark": []}

# ===========================================================================
# ROADS + STREETSCAPE
# ===========================================================================

## Asphalt carriageway centred at pos, running along `length` on Z (rotated by yaw).
static func road_straight(length: float, lanes: int, seed_value: int) -> Node3D:
	var root := Node3D.new()
	root.name = "Road"
	var lane_w := 3.2
	var w := float(lanes) * lane_w
	root.add_child(part("Asphalt", Vector3(w, 0.12, length), Vector3(0, 0.06, 0), mat("asphalt")))
	# edge lines + centre dashes with wear variation
	var r := rng(seed_value)
	for sx in [-1.0, 1.0]:
		root.add_child(part("EdgeLine", Vector3(0.14, 0.02, length * 0.98), Vector3(sx * (w * 0.5 - 0.3), 0.13, 0), mat("paint_white")))
	var dashes := int(length / 4.0)
	for i in range(dashes):
		var z := -length * 0.5 + 2.0 + float(i) * 4.0
		var shade := 0.9 + r.randf() * 0.2
		root.add_child(part("Dash", Vector3(0.16, 0.02, 1.8), Vector3(0, 0.13, z), mat("paint_white", Color(shade, shade, shade))))
	# sidewalks + curbs both sides
	for sx in [-1.0, 1.0]:
		root.add_child(part("Sidewalk", Vector3(2.6, 0.22, length), Vector3(sx * (w * 0.5 + 1.5), 0.11, 0), mat("sidewalk")))
		root.add_child(part("Curb", Vector3(0.3, 0.26, length), Vector3(sx * (w * 0.5 + 0.15), 0.13, 0), mat("curb")))
	return root

static func intersection(size_w: float, size_d: float) -> Node3D:
	var root := Node3D.new()
	root.name = "Intersection"
	root.add_child(part("Asphalt", Vector3(size_w, 0.12, size_d), Vector3(0, 0.06, 0), mat("asphalt_worn")))
	# crosswalk stripes on all four entries
	for sz in [-1.0, 1.0]:
		for i in range(5):
			var x := (float(i) - 2.0) * 1.1
			root.add_child(part("Cross", Vector3(0.55, 0.02, 2.2), Vector3(x, 0.13, sz * (size_d * 0.5 - 1.6)), mat("paint_white")))
	return root

static func streetlamp() -> Node3D:
	var root := Node3D.new()
	root.name = "Streetlamp"
	root.add_child(part("Pole", Vector3(0.18, 7.0, 0.18), Vector3(0, 3.5, 0), mat("metal_dark")))
	var arm := part("Arm", Vector3(0.15, 0.15, 1.8), Vector3(0, 6.9, 0.8), mat("metal_dark"))
	root.add_child(arm)
	root.add_child(part("Head", Vector3(0.5, 0.18, 0.7), Vector3(0, 6.8, 1.6), mat("lamp_head")))
	return root

static func traffic_light() -> Dictionary:
	var root := Node3D.new()
	root.name = "TrafficLight"
	root.add_child(part("Pole", Vector3(0.22, 5.2, 0.22), Vector3(0, 2.6, 0), mat("metal_dark")))
	root.add_child(part("Head", Vector3(0.5, 1.4, 0.5), Vector3(0, 5.4, 0), mat("metal_dark")))
	var red := part("Red", Vector3(0.3, 0.3, 0.1), Vector3(0, 5.7, 0.26), mat("signal_red"))
	var grn := part("Green", Vector3(0.3, 0.3, 0.1), Vector3(0, 5.1, 0.26), mat("signal_green"))
	root.add_child(red)
	root.add_child(grn)
	return {"root": root, "red": red, "green": grn}

static func tree_street(seed_value: int) -> Node3D:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "StreetTree"
	root.add_child(part("Pit", Vector3(1.4, 0.25, 1.4), Vector3(0, 0.12, 0), mat("soil")))
	root.add_child(part("Trunk", Vector3(0.28, 2.2, 0.28), Vector3(0, 1.3, 0), mat("trunk")))
	var tint := Color(1.0 - r.randf() * 0.12, 1.0, 1.0 - r.randf() * 0.1)
	var c1 := part("Crown1", Vector3(1.9, 1.6, 1.9), Vector3(0, 3.0, 0), mat("foliage", tint))
	var c2 := part("Crown2", Vector3(1.3, 1.1, 1.3), Vector3(0.4, 3.9, 0.2), mat("foliage", tint.lightened(0.08)))
	root.add_child(c1)
	root.add_child(c2)
	return root

static func bench() -> Node3D:
	var root := Node3D.new()
	root.name = "Bench"
	root.add_child(part("Seat", Vector3(1.8, 0.12, 0.5), Vector3(0, 0.55, 0), mat("trunk")))
	for sx in [-0.75, 0.75]:
		root.add_child(part("Leg", Vector3(0.12, 0.55, 0.45), Vector3(sx, 0.28, 0), mat("metal_dark")))
	return root

static func bollard() -> Node3D:
	var root := Node3D.new()
	root.name = "Bollard"
	root.add_child(part("Post", Vector3(0.22, 0.9, 0.22), Vector3(0, 0.45, 0), mat("metal_dark")))
	root.add_child(part("Band", Vector3(0.24, 0.12, 0.24), Vector3(0, 0.7, 0), mat("paint_yellow")))
	return root

static func planter_box() -> Node3D:
	var root := Node3D.new()
	root.name = "Planter"
	root.add_child(part("Box", Vector3(1.6, 0.6, 0.7), Vector3(0, 0.3, 0), mat("concrete_dark")))
	root.add_child(part("Shrub", Vector3(1.4, 0.5, 0.5), Vector3(0, 0.8, 0), mat("foliage")))
	return root

# ===========================================================================
# VEHICLES + PEOPLE (low-cost, readable at ortho distance)
# ===========================================================================

static func vehicle(seed_value: int, kind: String = "car") -> Node3D:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "Vehicle"
	var palette := [Color("b03030"), Color("3050a0"), Color("d0d0d0"), Color("30a080"), Color("d0a020"), Color("404040")]
	var body_c := palette[seed_value % palette.size()]
	var jitter := 0.92 + r.randf() * 0.16
	body_c = Color(minf(1.0, body_c.r * jitter), minf(1.0, body_c.g * jitter), minf(1.0, body_c.b * jitter))
	if kind == "truck":
		root.add_child(part("Cab", Vector3(2.2, 2.2, 2.4), Vector3(0, 1.5, 3.4), mat("paint_white", body_c.lightened(0.2))))
		root.add_child(part("Trailer", Vector3(2.4, 2.6, 6.5), Vector3(0, 1.7, -1.2), mat("paint_white", body_c)))
		for wx in [-1.0, 1.0]:
			for wz in [3.6, -0.5, -2.8]:
				root.add_child(part("Wheel", Vector3(0.35, 0.8, 0.8), Vector3(wx * 1.1, 0.4, wz), mat("metal_dark")))
	else:
		root.add_child(part("Body", Vector3(1.9, 0.75, 4.1), Vector3(0, 0.75, 0), mat("paint_white", body_c)))
		root.add_child(part("Cabin", Vector3(1.6, 0.6, 2.0), Vector3(0, 1.4, -0.2), mat("glass")))
		for wx in [-1.0, 1.0]:
			for wz in [1.3, -1.3]:
				root.add_child(part("Wheel", Vector3(0.3, 0.65, 0.65), Vector3(wx * 0.95, 0.33, wz), mat("metal_dark")))
		var hl := part("Headlights", Vector3(1.5, 0.18, 0.1), Vector3(0, 0.75, 2.06), mat("lamp_head"))
		hl.name = "Headlights"
		root.add_child(hl)
	return root

static func pedestrian(seed_value: int) -> Node3D:
	var r := rng(seed_value)
	var root := Node3D.new()
	root.name = "Pedestrian"
	var coats := [Color("804040"), Color("405080"), Color("507038"), Color("888888"), Color("306070")]
	var coat: Color = coats[seed_value % coats.size()]
	root.add_child(part("Legs", Vector3(0.42, 0.8, 0.3), Vector3(0, 0.4, 0), mat("metal_dark")))
	root.add_child(part("Torso", Vector3(0.5, 0.75, 0.32), Vector3(0, 1.15, 0), mat("paint_white", coat)))
	root.add_child(part("Head", Vector3(0.28, 0.3, 0.28), Vector3(0, 1.68, 0), mat("paint_white", Color(0.92, 0.78, 0.66))))
	root.rotation.y = r.randf() * TAU
	return root
