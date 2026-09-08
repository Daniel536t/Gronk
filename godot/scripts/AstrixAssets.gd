extends Object
class_name AstrixAssets
## ASTrix authored asset library — every physical thing in the world.
##
## One construction language for the whole settlement so it reads as ONE place:
## chunky faceted low-poly volumes, flat colour from AstrixPalette, pivots at
## ground contact, silhouette-first (roof mass > wall mass, so buildings read
## from a high diorama camera).
##
## Every builder returns a Node3D whose ORIGIN IS THE GROUND CONTACT POINT, so
## callers place it with `node.position = Vector3(x, surface, z)` and it sits
## flush. No magic offsets, no floating, no sinking.
##
## Nothing in this file knows about the simulation. Callers decide WHAT to build
## from authoritative state; this file only knows HOW things look.


# ===========================================================================
# BUILDINGS
# ===========================================================================

## HOUSE — cream plaster walls, terracotta gable roof with real overhang, door,
## windows, chimney. Roof mass dominates so it reads from above (the reference's
## key trick: the roof carries the colour, the walls stay pale).
static func house(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "House"
    var r := AstrixMesh.rng(seed_value)
    var w := 2.8 + r.randf() * 0.7          # width  (X)
    var d := 2.4 + r.randf() * 0.6          # depth  (Z)
    # Walls tall enough that a 1.8-unit villager fits through the door.
    var wall_h := 1.95 + r.randf() * 0.4

    # Stone footing: grounds the building instead of letting walls float.
    root.add_child(AstrixMesh.box_on("Footing", Vector3(w + 0.22, 0.16, d + 0.22), Vector3.ZERO, AstrixPalette.STONE_WALL))
    root.add_child(AstrixMesh.box_on("Walls", Vector3(w, wall_h, d), Vector3(0.0, 0.14, 0.0), AstrixPalette.WALL))
    # Shaded rear/side band gives the volume a lit-vs-shadow read even in flat light.
    root.add_child(AstrixMesh.box("WallShade", Vector3(w + 0.01, wall_h * 0.4, 0.02),
        Vector3(0.0, 0.14 + wall_h * 0.2, -d * 0.5 - 0.01), AstrixPalette.WALL_SHADE))

    # Roof: prism ridge along X, overhanging eaves on all four sides.
    var roof_h := 0.95 + r.randf() * 0.25
    var roof := AstrixMesh.gable("Roof", Vector3(w + 0.55, roof_h, d + 0.55),
        Vector3(0.0, 0.14 + wall_h, 0.0), AstrixPalette.ROOF)
    root.add_child(roof)
    # Winter snow on the roof planes. Named SnowCap* so World3D's season system
    # finds and toggles it — a roof cap can only be shaped by whoever built the
    # roof, so the asset supplies it rather than the world guessing a box.
    var cap := AstrixMesh.gable("SnowCapRoof", Vector3(w + 0.62, roof_h * 0.55, d + 0.62),
        Vector3(0.0, 0.14 + wall_h + roof_h * 0.42, 0.0), AstrixPalette.SNOW)
    cap.visible = false
    root.add_child(cap)
    # Ridge cap + eave shadow line: two strokes that make the roof read as tiled.
    # PrismMesh's ridge runs along Z, so the cap is a long thin bar along Z.
    root.add_child(AstrixMesh.box("Ridge", Vector3(0.16, 0.08, d + 0.6),
        Vector3(0.0, 0.14 + wall_h + roof_h, 0.0), AstrixPalette.ROOF_DARK))
    root.add_child(AstrixMesh.box("Eave", Vector3(w + 0.6, 0.09, d + 0.6),
        Vector3(0.0, 0.14 + wall_h + 0.04, 0.0), AstrixPalette.ROOF_DARK))

    # Door (front = +Z) with a timber frame, sized like a person can use it.
    root.add_child(AstrixMesh.box_on("Door", Vector3(0.5, 0.95, 0.08),
        Vector3(0.0, 0.14, d * 0.5), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.box_on("DoorFrame", Vector3(0.66, 1.05, 0.04),
        Vector3(0.0, 0.14, d * 0.5 + 0.02), AstrixPalette.TIMBER_LIT))
    # Windows: two on the front, one per side. Dark inset + light frame. Named
    # Window* (and Window*Frame) so World3D's light cycle can switch the panes to
    # emissive at dusk — lit windows are the clearest "it is evening" cue.
    for wx in [-w * 0.28, w * 0.28]:
        root.add_child(AstrixMesh.box("Window", Vector3(0.44, 0.44, 0.07),
            Vector3(wx, 0.14 + wall_h * 0.62, d * 0.5), Color("2f3a44")))
        root.add_child(AstrixMesh.box("WindowFrame", Vector3(0.52, 0.52, 0.03),
            Vector3(wx, 0.14 + wall_h * 0.62, d * 0.5 + 0.03), AstrixPalette.WALL_SHADE))
    root.add_child(AstrixMesh.box("WindowSide", Vector3(0.07, 0.4, 0.4),
        Vector3(w * 0.5, 0.14 + wall_h * 0.62, 0.0), Color("2f3a44")))

    # Chimney: narrow, tall, with a terracotta pot — reads as a chimney rather
    # than a flat grey slab on the roof.
    var cx := w * 0.3
    var chimney_h := roof_h + 0.75
    root.add_child(AstrixMesh.box_on("Chimney", Vector3(0.28, chimney_h, 0.28),
        Vector3(cx, 0.14 + wall_h * 0.55, -d * 0.16), AstrixPalette.STONE_WALL))
    var pot_y := 0.14 + wall_h * 0.55 + chimney_h + 0.1
    root.add_child(AstrixMesh.box("ChimneyPot", Vector3(0.2, 0.22, 0.2),
        Vector3(cx, pot_y, -d * 0.16), AstrixPalette.ROOF_DARK))
    # Woodsmoke: a rising column of puffs. Sized to actually read at diorama
    # distance — a probe measured the first version at 7px on screen, which is
    # why review kept reporting "no smoke".
    for i in range(4):
        var puff := AstrixMesh.blob("Smoke", 0.34 + float(i) * 0.16,
            Vector3(cx + float(i) * 0.3, pot_y + 0.55 + float(i) * 0.85, -d * 0.16 - float(i) * 0.22),
            Color(0.95, 0.96, 0.98, 0.78 - float(i) * 0.14), 7, 4)
        puff.scale.y = 0.82
        root.add_child(puff)
    return root


## BARN / FARM BUILDING — unmistakably agricultural: red board walls, big double
## doors, hay-loft opening under the ridge, lean-to shelter, hay bales.
static func barn(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Barn"
    var r := AstrixMesh.rng(seed_value)
    var w := 3.2 + r.randf() * 0.5
    var d := 2.5 + r.randf() * 0.4
    var wall_h := 1.8

    root.add_child(AstrixMesh.box_on("Footing", Vector3(w + 0.2, 0.14, d + 0.2), Vector3.ZERO, AstrixPalette.STONE_WALL))
    root.add_child(AstrixMesh.box_on("Walls", Vector3(w, wall_h, d), Vector3(0.0, 0.12, 0.0), AstrixPalette.BARN))
    # Vertical board battens: cheap texture-free way to read "timber barn".
    for i in range(5):
        var bx := -w * 0.5 + w * (float(i) + 0.5) / 5.0
        root.add_child(AstrixMesh.box("Batten", Vector3(0.07, wall_h * 0.94, 0.02),
            Vector3(bx, 0.12 + wall_h * 0.5, d * 0.5 + 0.01), AstrixPalette.BARN.darkened(0.25)))

    var roof_h := 1.15
    root.add_child(AstrixMesh.gable("Roof", Vector3(w + 0.5, roof_h, d + 0.5),
        Vector3(0.0, 0.12 + wall_h, 0.0), AstrixPalette.ROOF_DARK))
    root.add_child(AstrixMesh.box("Ridge", Vector3(0.18, 0.09, d + 0.55),
        Vector3(0.0, 0.12 + wall_h + roof_h, 0.0), Color("7d3010")))

    # Double doors, cream-trimmed, with the classic X brace.
    root.add_child(AstrixMesh.box_on("DoorL", Vector3(0.62, 1.35, 0.07),
        Vector3(-0.34, 0.12, d * 0.5), AstrixPalette.WALL_SHADE))
    root.add_child(AstrixMesh.box_on("DoorR", Vector3(0.62, 1.35, 0.07),
        Vector3(0.34, 0.12, d * 0.5), AstrixPalette.WALL_SHADE))
    for sign_x in [-0.34, 0.34]:
        var brace := AstrixMesh.box("Brace", Vector3(0.85, 0.07, 0.03),
            Vector3(sign_x, 0.12 + 0.68, d * 0.5 + 0.05), AstrixPalette.BARN.darkened(0.3))
        brace.rotation_degrees.z = 42.0 if sign_x < 0.0 else -42.0
        root.add_child(brace)
    # Hay-loft opening under the ridge + protruding hoist beam.
    root.add_child(AstrixMesh.box("Loft", Vector3(0.6, 0.55, 0.06),
        Vector3(0.0, 0.12 + wall_h + 0.3, d * 0.5), Color("36251c")))
    root.add_child(AstrixMesh.box("Hoist", Vector3(0.12, 0.12, 0.7),
        Vector3(0.0, 0.12 + wall_h + 0.62, d * 0.5 + 0.3), AstrixPalette.TIMBER))

    # Lean-to on the -X side with straw beneath: working-farm silhouette.
    var lean := AstrixMesh.box("LeanRoof", Vector3(1.0, 0.09, d * 0.8),
        Vector3(-w * 0.5 - 0.45, 0.12 + wall_h * 0.72, 0.0), AstrixPalette.THATCH)
    lean.rotation_degrees.z = 16.0
    root.add_child(lean)
    root.add_child(AstrixMesh.box_on("LeanPost", Vector3(0.1, wall_h * 0.62, 0.1),
        Vector3(-w * 0.5 - 0.86, 0.12, d * 0.3), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.box_on("LeanPost2", Vector3(0.1, wall_h * 0.62, 0.1),
        Vector3(-w * 0.5 - 0.86, 0.12, -d * 0.3), AstrixPalette.TIMBER))
    for i in range(2):
        root.add_child(AstrixMesh.box_on("HayBale", Vector3(0.5, 0.36, 0.36),
            Vector3(-w * 0.5 - 0.6, 0.12, -0.4 + float(i) * 0.8), AstrixPalette.CROP_HARVEST.darkened(0.12)))
    return root


## STORAGE / GRANARY — a stone-based grain silo: banded body, ladder, discharge
## chute and a domed cap. Review flagged the earlier version as reading like a
## water tower, so the roof is now a dome (not a cone) in the same terracotta
## family as the settlement's other roofs, and the industrial details are real.
static func storage(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Storage"
    var r := AstrixMesh.rng(seed_value)
    var radius := 1.05 + r.randf() * 0.15
    var body_h := 2.5

    root.add_child(AstrixMesh.cylinder_on("Base", radius + 0.18, radius + 0.26, 0.32,
        Vector3.ZERO, AstrixPalette.STONE_WALL, 12))
    root.add_child(AstrixMesh.cylinder_on("Silo", radius, radius, body_h,
        Vector3(0.0, 0.32, 0.0), AstrixPalette.WALL, 12))
    # Corrugation: vertical staves, the grain-store signature.
    for i in range(10):
        var a := TAU * float(i) / 10.0
        root.add_child(AstrixMesh.box("Stave", Vector3(0.07, body_h * 0.96, 0.07),
            Vector3(cos(a) * radius, 0.32 + body_h * 0.5, sin(a) * radius),
            AstrixPalette.WALL_SHADE))
    # Iron hoops.
    for i in range(3):
        root.add_child(AstrixMesh.cylinder_on("Hoop", radius + 0.05, radius + 0.05, 0.1,
            Vector3(0.0, 0.6 + float(i) * 0.75, 0.0), AstrixPalette.ROCK_DARK, 12))
    # Domed cap in the settlement's roof colour, with a ridge finial.
    var dome := AstrixMesh.blob("Dome", radius + 0.16, Vector3(0.0, 0.32 + body_h, 0.0),
        AstrixPalette.ROOF, 12, 5)
    dome.scale.y = 0.6
    root.add_child(dome)
    root.add_child(AstrixMesh.box("Finial", Vector3(0.14, 0.3, 0.14),
        Vector3(0.0, 0.32 + body_h + (radius + 0.16) * 0.6, 0.0), AstrixPalette.ROCK_DARK))
    # Ladder up the side: the detail that says "silo" rather than "tank".
    for i in range(7):
        root.add_child(AstrixMesh.box("Rung", Vector3(0.34, 0.05, 0.05),
            Vector3(0.0, 0.5 + float(i) * 0.32, radius + 0.06), AstrixPalette.ROCK_DARK))
    for side in [-0.16, 0.16]:
        root.add_child(AstrixMesh.box("LadderRail", Vector3(0.05, 2.3, 0.05),
            Vector3(side, 0.32 + 1.15, radius + 0.06), AstrixPalette.ROCK_DARK))
    # Hopper + discharge chute at the base: grain comes OUT here.
    var hopper := AstrixMesh.cone_on("Hopper", 0.4, 0.55,
        Vector3(0.0, 0.34, -radius - 0.1), AstrixPalette.ROCK, 8)
    hopper.rotation_degrees.x = 180.0
    hopper.position.y = 1.0
    root.add_child(hopper)
    var chute := AstrixMesh.box("Chute", Vector3(0.36, 0.1, 0.95),
        Vector3(0.0, 0.62, -radius - 0.5), AstrixPalette.TIMBER_LIT)
    chute.rotation_degrees.x = -20.0
    root.add_child(chute)

    # Sacks + crates around the base: the "stored goods" read.
    for i in range(3):
        var a2 := float(i) * 2.1 + r.randf() * 0.4
        var sack := AstrixMesh.blob("Sack", 0.28,
            Vector3(cos(a2) * (radius + 0.6), 0.26, sin(a2) * (radius + 0.6)),
            AstrixPalette.THATCH, 7, 4)
        sack.scale.y = 0.85
        root.add_child(sack)
    root.add_child(AstrixMesh.box_on("Crate", Vector3(0.5, 0.5, 0.5),
        Vector3(radius + 0.85, 0.0, -0.5), AstrixPalette.TIMBER_LIT))
    root.add_child(AstrixMesh.box_on("Crate2", Vector3(0.42, 0.42, 0.42),
        Vector3(radius + 0.7, 0.5, -0.44), AstrixPalette.TIMBER))
    return root


# ===========================================================================
# FARM PLOT + CROPS  (the food-production story, made visible)
#
# DESIGN NOTE — this is the third iteration. The first two failed visual review
# ("no farms exist", then "reads as a wooden deck with railings"). Root causes:
# tall corner posts + rails read as a boardwalk railing, evenly spaced furrow
# bars read as planks, pale tan soil did not separate from the grass, and a
# 12-slot grid holding 3 thin stalks read as empty.
#
# Now: ONE AUTHORITATIVE CROP = ONE DENSELY PLANTED ROW on a raised ridge of
# dark tilled earth. Plot size follows the crop count, the border is a low earth
# bank (no railings), and every row is full, so a farm reads as a farm and the
# growth stage is legible as a change across the whole row.
# ===========================================================================

## Build a field sized for `row_count` crop rows.
## Returns {"root": Node3D, "rows": Array[Dictionary]} where each row carries its
## local centre and width so the caller can plant along it.
static func farm_plot(seed_value: int, row_count: int) -> Dictionary:
    var root := Node3D.new()
    root.name = "FarmField"
    var r := AstrixMesh.rng(seed_value)
    var rows: int = maxi(3, row_count)
    var row_pitch := 1.25
    var plot_d := float(rows) * row_pitch + 1.0
    # Narrow enough that two authoritative farms ~5 world units apart never
    # overlap, wide enough that a planted row still reads as a field.
    var plot_w := 4.0

    # Tilled earth bed — dark red-brown with real thickness, so it separates
    # hard from the green grass and can never z-fight against it.
    root.add_child(AstrixMesh.box_on("TilledSoil", Vector3(plot_w, 0.18, plot_d),
        Vector3(0.0, 0.0, 0.0), AstrixPalette.SOIL))
    # Low earth bank around the field instead of a fence: reads as a ploughed
    # boundary, and nothing about it can be mistaken for a railing.
    for side in [-1.0, 1.0]:
        root.add_child(AstrixMesh.box_on("Bank", Vector3(plot_w + 0.5, 0.3, 0.36),
            Vector3(0.0, 0.0, side * (plot_d * 0.5 + 0.1)), AstrixPalette.SOIL.darkened(0.25)))
        root.add_child(AstrixMesh.box_on("BankSide", Vector3(0.36, 0.3, plot_d + 0.5),
            Vector3(side * (plot_w * 0.5 + 0.1), 0.0, 0.0), AstrixPalette.SOIL.darkened(0.25)))

    var row_data: Array[Dictionary] = []
    for row in range(rows):
        var rz := -plot_d * 0.5 + 0.8 + float(row) * row_pitch
        # Planting ridge built from overlapping CLUMPS of turned earth, not one
        # long bar: a bar of uniform width and spacing is what made earlier
        # versions read as decking planks.
        var clumps := 7
        for c in range(clumps):
            var cx := -plot_w * 0.5 + 0.55 + (plot_w - 1.1) * float(c) / float(clumps - 1)
            var clump := AstrixMesh.blob("Ridge", 0.42 + r.randf() * 0.1,
                Vector3(cx, 0.2, rz), AstrixPalette.SOIL_TILLED, 6, 3)
            clump.scale.y = 0.34
            root.add_child(clump)
        row_data.append({"z": rz, "width": plot_w - 1.2, "y": 0.24})

    # Working props at the field edge, all low.
    root.add_child(AstrixMesh.cylinder_on("WaterBarrel", 0.32, 0.28, 0.55,
        Vector3(plot_w * 0.5 - 0.5, 0.18, -plot_d * 0.5 + 0.5), AstrixPalette.TIMBER, 9))
    root.add_child(AstrixMesh.box_on("SeedCrate", Vector3(0.5, 0.42, 0.5),
        Vector3(-plot_w * 0.5 + 0.55, 0.18, -plot_d * 0.5 + 0.5), AstrixPalette.TIMBER_LIT))
    return {"root": root, "rows": row_data}


## One authoritative crop rendered as a DENSE PLANTED ROW at growth stage 0..1.
## Five visually distinct tiers differing in height, mass AND colour:
##   0.0        bare seeded ridge (turned mounds only)
##   <0.3       seedlings — low green tufts
##   <0.65      growing — mid green bushes
##   <1.0       mature — tall stalks with heads, colour turning
##   1.0        harvestable — gold, heavy, faintly glowing = READY
##
## Bundle geometry is CHUNKY on purpose: at the observatory camera 1 world unit
## is ~28 screen px, so the previous 0.075-wide stalks were 2px and review read
## the fields as empty. Each station is now a ~0.36-wide sheaf.
## Visual height of a crop row at an authoritative growth stage. Shared with
## World3D so a stage TRANSITION can be eased from the previous silhouette to the
## new one instead of popping: the caller needs the same tier table this builder
## uses, and duplicating it would let the two drift apart.
static func crop_tier_height(stage: float) -> float:
    if stage <= 0.0:
        return 0.07     # seed mounds: not zero, so a ratio against them is sane
    if stage >= 1.0:
        return 1.2
    if stage >= 0.65:
        return 1.05
    if stage >= 0.3:
        return 0.68
    return 0.34


static func crop_row(stage: float, width: float, seed_value: int) -> Node3D:
    var root := Node3D.new()
    var r := AstrixMesh.rng(seed_value)
    var count := maxi(5, int(width / 0.62))

    if stage <= 0.0:
        root.name = "CropRow_Seeded"
        for i in range(count):
            var x := -width * 0.5 + width * float(i) / float(count - 1)
            var mound := AstrixMesh.blob("Seed", 0.2, Vector3(x, 0.02, 0.0),
                AstrixPalette.SOIL.lightened(0.16), 6, 3)
            mound.scale.y = 0.35
            root.add_child(mound)
        return root

    var tier := 1
    if stage >= 1.0:
        tier = 4
    elif stage >= 0.65:
        tier = 3
    elif stage >= 0.3:
        tier = 2

    var heights: Array[float] = [0.0, 0.34, 0.68, 1.05, 1.2]
    var colors: Array[Color] = [
        AstrixPalette.SOIL, AstrixPalette.CROP_SEEDLING, AstrixPalette.CROP_GROWING,
        AstrixPalette.CROP_MATURE, AstrixPalette.CROP_HARVEST,
    ]
    var names: Array[String] = ["", "CropRow_Seedling", "CropRow_Growing", "CropRow_Mature", "CropRow_Harvestable"]
    var height: float = heights[tier]
    var color: Color = colors[tier]
    root.name = names[tier]

    for i in range(count):
        var x := -width * 0.5 + width * float(i) / float(count - 1)
        var jitter := (r.randf() - 0.5) * 0.12
        var h: float = height * (0.9 + r.randf() * 0.2)
        if tier == 1:
            # Seedlings: low leafy tufts, clearly plants but clearly small.
            var tuft := AstrixMesh.blob("Sprout", 0.19, Vector3(x, h * 0.5, jitter), color, 6, 3)
            tuft.scale.y = 0.9
            root.add_child(tuft)
            continue
        if tier == 2:
            # Growing: a green bush of real mass, half the mature height.
            var bushy := AstrixMesh.blob("Plant", 0.28, Vector3(x, h * 0.55, jitter), color, 7, 4)
            bushy.scale.y = 1.25
            root.add_child(bushy)
            root.add_child(AstrixMesh.box_on("Stem", Vector3(0.12, h * 0.5, 0.12),
                Vector3(x, 0.0, jitter), color.darkened(0.2)))
            continue
        # Mature / harvestable: a chunky sheaf with a heavy grain head.
        var sheaf := AstrixMesh.box_on("Sheaf", Vector3(0.34, h, 0.3),
            Vector3(x, 0.0, jitter), color.darkened(0.14))
        sheaf.rotation_degrees.z = (r.randf() - 0.5) * 6.0
        root.add_child(sheaf)
        var head := AstrixMesh.box("Head", Vector3(0.4, 0.38, 0.34),
            Vector3(x, h + 0.16, jitter), color)
        if tier == 4:
            head.material_override = AstrixPalette.glow(AstrixPalette.CROP_HARVEST, 0.28)
            head.rotation_degrees.x = 14.0
        root.add_child(head)
        # Awns fanning off the head: the shape that says "grain".
        for a in range(3):
            var awn := AstrixMesh.box("Awn", Vector3(0.05, 0.22, 0.05),
                Vector3(x - 0.1 + float(a) * 0.1, h + 0.42, jitter), color.lightened(0.2))
            awn.rotation_degrees.z = -12.0 + float(a) * 12.0
            root.add_child(awn)
    return root


## Scarecrow — a farm landmark that also reads as a tiny human silhouette,
## reinforcing "this field is worked".
static func scarecrow(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Scarecrow"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    root.add_child(AstrixMesh.box_on("Pole", Vector3(0.09, 1.5, 0.09), Vector3.ZERO, AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.box("Arms", Vector3(1.1, 0.08, 0.08), Vector3(0.0, 1.12, 0.0), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.box("Body", Vector3(0.5, 0.55, 0.28), Vector3(0.0, 0.98, 0.0), AstrixPalette.BARN.lightened(0.1)))
    root.add_child(AstrixMesh.blob("Head", 0.19, Vector3(0.0, 1.45, 0.0), AstrixPalette.THATCH, 7, 4))
    root.add_child(AstrixMesh.box("Hat", Vector3(0.5, 0.05, 0.5), Vector3(0.0, 1.58, 0.0), AstrixPalette.THATCH.darkened(0.2)))
    root.add_child(AstrixMesh.box("HatTop", Vector3(0.24, 0.13, 0.24), Vector3(0.0, 1.64, 0.0), AstrixPalette.THATCH.darkened(0.28)))
    return root


# ===========================================================================
# BRIDGE  (must visibly cross water, with supports going INTO the water)
# ===========================================================================

## A bridge spanning from `from_pos` to `to_pos` (both world-space, at their own
## island surface heights), with piers descending below `water_y` into the water,
## a plank deck, railings, and ramped abutments at each end.
static func bridge(from_pos: Vector3, to_pos: Vector3, water_y: float, seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Bridge"
    var r := AstrixMesh.rng(seed_value)
    var span := to_pos - from_pos
    var length := Vector2(span.x, span.z).length()
    if length < 0.5:
        return root
    # Deck runs along local +Z; the root is placed at the midpoint and yawed.
    var mid := (from_pos + to_pos) * 0.5
    # Deck sits just above the HIGHER shore so it never sinks into either island.
    var deck_y := maxf(from_pos.y, to_pos.y) + 0.12
    root.position = Vector3(mid.x, deck_y, mid.z)
    root.rotation.y = atan2(span.x, span.z)

    var half := length * 0.5
    var width := 1.7

    # Deck: individual planks with visible gaps (reads as a built structure).
    var plank_count := int(length / 0.42)
    for i in range(plank_count):
        var t := -half + 0.28 + (length - 0.56) * float(i) / maxf(1.0, float(plank_count - 1))
        var plank := AstrixMesh.box("Plank", Vector3(width, 0.1, 0.34), Vector3(0.0, 0.0, t), AstrixPalette.TIMBER_LIT)
        # Tiny per-plank tone variation so the deck isn't one flat bar.
        plank.material_override = AstrixPalette.flat(AstrixPalette.TIMBER_LIT.darkened(r.randf() * 0.14))
        root.add_child(plank)
    # Stringers under the planks: structural depth from a low camera.
    for side in [-0.62, 0.62]:
        root.add_child(AstrixMesh.box("Stringer", Vector3(0.14, 0.16, length - 0.3),
            Vector3(side, -0.13, 0.0), AstrixPalette.TIMBER))

    # Piers: descend from the deck to well BELOW the waterline, which is what
    # makes the water read as water with something standing in it.
    var pier_count := maxi(2, int(length / 4.0))
    for i in range(pier_count):
        var t2 := -half + 1.0 + (length - 2.0) * float(i) / maxf(1.0, float(pier_count - 1))
        var pier_bottom := water_y - 1.6 - deck_y            # local space
        var pier_h := -pier_bottom - 0.05
        for side2 in [-0.55, 0.55]:
            root.add_child(AstrixMesh.box_on("Pier", Vector3(0.2, pier_h, 0.2),
                Vector3(side2, pier_bottom, t2), AstrixPalette.TIMBER.darkened(0.18)))
        # Cross brace between the pair.
        root.add_child(AstrixMesh.box("PierBrace", Vector3(1.3, 0.1, 0.1),
            Vector3(0.0, pier_bottom + pier_h * 0.55, t2), AstrixPalette.TIMBER.darkened(0.3)))

    # Railings: posts + two rails per side, at a height that never hides people.
    var rail_posts := maxi(3, int(length / 1.6))
    for i in range(rail_posts):
        var t3 := -half + 0.3 + (length - 0.6) * float(i) / maxf(1.0, float(rail_posts - 1))
        for side3 in [-width * 0.5 + 0.1, width * 0.5 - 0.1]:
            root.add_child(AstrixMesh.box_on("RailPost", Vector3(0.1, 0.62, 0.1),
                Vector3(side3, 0.05, t3), AstrixPalette.TIMBER))
    for side4 in [-width * 0.5 + 0.1, width * 0.5 - 0.1]:
        root.add_child(AstrixMesh.box("RailTop", Vector3(0.09, 0.09, length - 0.5),
            Vector3(side4, 0.62, 0.0), AstrixPalette.TIMBER_LIT))
        root.add_child(AstrixMesh.box("RailMid", Vector3(0.07, 0.07, length - 0.5),
            Vector3(side4, 0.38, 0.0), AstrixPalette.TIMBER_LIT.darkened(0.1)))

    # Abutments: short ramps that bridge the height difference to each shore, so
    # the deck visibly MEETS the land instead of hovering near it.
    for endpoint in [{"z": -half, "y": from_pos.y}, {"z": half, "y": to_pos.y}]:
        var drop: float = deck_y - float(endpoint["y"])
        var ramp := AstrixMesh.box("Abutment", Vector3(width + 0.2, 0.14, 1.1),
            Vector3(0.0, -drop * 0.5, float(endpoint["z"]) + (0.45 if endpoint["z"] < 0.0 else -0.45)),
            AstrixPalette.TIMBER_LIT.darkened(0.08))
        ramp.rotation_degrees.x = rad_to_deg(atan2(drop, 1.1)) * (1.0 if endpoint["z"] < 0.0 else -1.0)
        root.add_child(ramp)
        # Stone abutment block under the ramp end.
        root.add_child(AstrixMesh.box_on("AbutmentStone", Vector3(width + 0.5, maxf(0.3, drop + 0.3), 0.7),
            Vector3(0.0, -drop - 0.3, float(endpoint["z"]) + (0.9 if endpoint["z"] < 0.0 else -0.9)),
            AstrixPalette.STONE_WALL))
    return root


# ===========================================================================
# VEGETATION
# ===========================================================================

## Mature broadleaf tree: tapered trunk + 2-3 faceted canopy blobs. Canopy
## meshes are returned in `foliage` so the season system can repaint them.
static func tree_broadleaf(seed_value: int, scale_mult: float = 1.0) -> Dictionary:
    var root := Node3D.new()
    root.name = "TreeBroadleaf"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    var h := (1.5 + r.randf() * 0.6) * scale_mult
    var foliage: Array[MeshInstance3D] = []

    root.add_child(AstrixMesh.cylinder_on("Trunk", 0.13 * scale_mult, 0.2 * scale_mult, h, Vector3.ZERO, AstrixPalette.BARK, 7))
    # Root flare: three small wedges so the trunk grips the ground.
    for i in range(3):
        var a := float(i) * 2.1 + r.randf()
        var flare := AstrixMesh.blob("Root", 0.16 * scale_mult,
            Vector3(cos(a) * 0.17 * scale_mult, 0.05, sin(a) * 0.17 * scale_mult), AstrixPalette.BARK_DARK, 6, 3)
        flare.scale.y = 0.4
        root.add_child(flare)
    # A visible fork gives the silhouette structure rather than a lollipop.
    var branch := AstrixMesh.cylinder_on("Branch", 0.06 * scale_mult, 0.09 * scale_mult, 0.7 * scale_mult,
        Vector3(0.0, h * 0.62, 0.0), AstrixPalette.BARK, 6)
    branch.rotation_degrees.z = 34.0
    root.add_child(branch)

    var crowns := 2 + int(r.randf() * 2.0)
    for i in range(crowns):
        var cr := (0.62 - float(i) * 0.09 + r.randf() * 0.12) * scale_mult
        var pos := Vector3(
            (r.randf() - 0.5) * 0.5 * scale_mult,
            h + 0.2 * scale_mult + float(i) * 0.42 * scale_mult,
            (r.randf() - 0.5) * 0.5 * scale_mult)
        # Upper crowns lighter, lower darker: value layering without textures.
        var tint: Color = AstrixPalette.FOLIAGE_LIGHT if i == crowns - 1 else (AstrixPalette.FOLIAGE if i == 0 else AstrixPalette.FOLIAGE.lightened(0.08))
        var crown := AstrixMesh.blob("Crown", cr, pos, tint, 8, 4)
        crown.scale.y = 0.82
        root.add_child(crown)
        foliage.append(crown)
    return {"root": root, "foliage": foliage}


## Conifer: stacked cones, cooler green. Used for the frost island and treelines.
static func tree_conifer(seed_value: int, scale_mult: float = 1.0) -> Dictionary:
    var root := Node3D.new()
    root.name = "TreeConifer"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    var h := (1.1 + r.randf() * 0.4) * scale_mult
    var foliage: Array[MeshInstance3D] = []
    root.add_child(AstrixMesh.cylinder_on("Trunk", 0.1 * scale_mult, 0.15 * scale_mult, h, Vector3.ZERO, AstrixPalette.BARK_DARK, 6))
    var tiers := 3
    for i in range(tiers):
        var radius := (0.72 - float(i) * 0.17) * scale_mult
        var tier_h := (0.85 - float(i) * 0.1) * scale_mult
        var y := h * 0.55 + float(i) * 0.52 * scale_mult
        var tint: Color = AstrixPalette.CONIFER.lightened(0.06 * float(i))
        var cone := AstrixMesh.cone_on("Tier", radius, tier_h, Vector3(0.0, y, 0.0), tint, 8)
        root.add_child(cone)
        foliage.append(cone)
    return {"root": root, "foliage": foliage}


## Young tree / sapling — the same species language at a smaller scale, so the
## world reads as having growth stages rather than cloned adults.
static func tree_young(seed_value: int) -> Dictionary:
    var root := Node3D.new()
    root.name = "TreeYoung"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    var h := 0.65 + r.randf() * 0.25
    var foliage: Array[MeshInstance3D] = []
    root.add_child(AstrixMesh.cylinder_on("Trunk", 0.07, 0.1, h, Vector3.ZERO, AstrixPalette.BARK, 6))
    var crown := AstrixMesh.blob("Crown", 0.34 + r.randf() * 0.1, Vector3(0.0, h + 0.24, 0.0), AstrixPalette.FOLIAGE_LIGHT, 7, 4)
    crown.scale.y = 0.9
    root.add_child(crown)
    foliage.append(crown)
    return {"root": root, "foliage": foliage}


static func bush(seed_value: int) -> Dictionary:
    var root := Node3D.new()
    root.name = "Bush"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    var foliage: Array[MeshInstance3D] = []
    for i in range(3):
        var a := float(i) * 2.1 + r.randf() * 0.5
        var rad := 0.2 + r.randf() * 0.12
        var blob := AstrixMesh.blob("Leaf", rad,
            Vector3(cos(a) * 0.16, rad * 0.75, sin(a) * 0.16),
            AstrixPalette.BUSH.lightened(r.randf() * 0.12), 7, 3)
        blob.scale.y = 0.78
        root.add_child(blob)
        foliage.append(blob)
    return {"root": root, "foliage": foliage}


## Grass tuft — the specks that break up flat terrain in the reference.
static func grass_tuft(seed_value: int) -> Dictionary:
    var root := Node3D.new()
    root.name = "GrassTuft"
    var r := AstrixMesh.rng(seed_value)
    var foliage: Array[MeshInstance3D] = []
    for i in range(4):
        var blade := AstrixMesh.box_on("Blade", Vector3(0.045, 0.2 + r.randf() * 0.16, 0.045),
            Vector3((r.randf() - 0.5) * 0.24, 0.0, (r.randf() - 0.5) * 0.24), AstrixPalette.GRASS_DARK.lightened(0.18))
        blade.rotation_degrees.z = (r.randf() - 0.5) * 34.0
        blade.rotation_degrees.x = (r.randf() - 0.5) * 24.0
        root.add_child(blade)
        foliage.append(blade)
    return {"root": root, "foliage": foliage}


static func flower(seed_value: int, color: Color) -> Node3D:
    var root := Node3D.new()
    root.name = "Flower"
    var r := AstrixMesh.rng(seed_value)
    root.add_child(AstrixMesh.box_on("Stem", Vector3(0.03, 0.18, 0.03), Vector3.ZERO, AstrixPalette.GRASS_DARK))
    root.add_child(AstrixMesh.blob("Bloom", 0.075, Vector3(0.0, 0.21, 0.0), color, 6, 3))
    root.rotation.y = r.randf() * TAU
    return root


# ===========================================================================
# ROCKS / TERRAIN DETAIL
# ===========================================================================

## `color` defaults to the neutral rock grey; pass a biome rock colour to tint.
## (Default arg is a sentinel because GDScript default values must be literal.)
static func rock(seed_value: int, scale_mult: float = 1.0, color: Color = Color(0, 0, 0, 0)) -> Node3D:
    if color.a <= 0.0:
        color = AstrixPalette.ROCK
    var root := Node3D.new()
    root.name = "Rock"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    var count := 1 + int(r.randf() * 2.5)
    for i in range(count):
        var rad := (0.24 + r.randf() * 0.22) * scale_mult
        var chunk := AstrixMesh.blob("Chunk", rad,
            Vector3((r.randf() - 0.5) * 0.5 * scale_mult, rad * 0.62, (r.randf() - 0.5) * 0.5 * scale_mult),
            color.lightened(r.randf() * 0.16 - 0.06), 6, 3)
        chunk.scale.y = 0.62 + r.randf() * 0.3
        chunk.rotation.y = r.randf() * TAU
        root.add_child(chunk)
    return root


## Boulder ring piece used along island rims — the reference's rocky shoreline.
static func shore_rock(seed_value: int) -> Node3D:
    return rock(seed_value, 1.35, AstrixPalette.ROCK_LIT)


static func crystal(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Crystal"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    for i in range(3):
        var h := 0.5 + r.randf() * 0.5
        var shard := AstrixMesh.cone_on("Shard", 0.16, h,
            Vector3((r.randf() - 0.5) * 0.3, 0.0, (r.randf() - 0.5) * 0.3), AstrixPalette.CRYSTAL, 5)
        shard.material_override = AstrixPalette.glow(AstrixPalette.CRYSTAL, 0.5)
        shard.rotation_degrees.z = (r.randf() - 0.5) * 22.0
        root.add_child(shard)
    return root


# ===========================================================================
# PROPS / SETTLEMENT DRESSING
# ===========================================================================

static func well() -> Node3D:
    var root := Node3D.new()
    root.name = "Well"
    root.add_child(AstrixMesh.cylinder_on("Ring", 0.62, 0.68, 0.55, Vector3.ZERO, AstrixPalette.STONE_WALL, 10))
    root.add_child(AstrixMesh.cylinder_on("Water", 0.5, 0.5, 0.06, Vector3(0.0, 0.46, 0.0), AstrixPalette.WATER_DEEP, 10))
    for side in [-0.55, 0.55]:
        root.add_child(AstrixMesh.box_on("Post", Vector3(0.11, 1.1, 0.11), Vector3(side, 0.5, 0.0), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.gable("Roof", Vector3(1.7, 0.45, 1.1), Vector3(0.0, 1.6, 0.0), AstrixPalette.ROOF))
    root.add_child(AstrixMesh.box("Beam", Vector3(1.2, 0.09, 0.09), Vector3(0.0, 1.5, 0.0), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.cylinder_on("Bucket", 0.14, 0.12, 0.2, Vector3(0.0, 1.15, 0.0), AstrixPalette.TIMBER_LIT, 8))
    return root


static func fence_run(length: float, seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Fence"
    var r := AstrixMesh.rng(seed_value)
    var posts := maxi(2, int(length / 1.2))
    for i in range(posts):
        var t := -length * 0.5 + length * float(i) / float(posts - 1)
        var post := AstrixMesh.box_on("Post", Vector3(0.11, 0.72 + r.randf() * 0.08, 0.11),
            Vector3(0.0, 0.0, t), AstrixPalette.TIMBER)
        root.add_child(post)
    for h in [0.3, 0.56]:
        root.add_child(AstrixMesh.box("Rail", Vector3(0.06, 0.07, length), Vector3(0.0, h, 0.0), AstrixPalette.TIMBER_LIT))
    return root


static func signpost(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Signpost"
    var r := AstrixMesh.rng(seed_value)
    root.add_child(AstrixMesh.box_on("Post", Vector3(0.11, 1.25, 0.11), Vector3.ZERO, AstrixPalette.TIMBER))
    var board := AstrixMesh.box("Board", Vector3(0.85, 0.3, 0.06), Vector3(0.25, 1.1, 0.0), AstrixPalette.TIMBER_LIT)
    board.rotation_degrees.y = r.randf() * 30.0 - 15.0
    root.add_child(board)
    return root


static func lantern() -> Node3D:
    var root := Node3D.new()
    root.name = "Lantern"
    root.add_child(AstrixMesh.box_on("Post", Vector3(0.1, 1.5, 0.1), Vector3.ZERO, AstrixPalette.TIMBER))
    var glass := AstrixMesh.box("Glass", Vector3(0.26, 0.32, 0.26), Vector3(0.0, 1.58, 0.0), Color("ffe9a8"))
    glass.material_override = AstrixPalette.glow(Color("ffe9a8"), 1.1)
    root.add_child(glass)
    root.add_child(AstrixMesh.box("Cap", Vector3(0.34, 0.07, 0.34), Vector3(0.0, 1.77, 0.0), AstrixPalette.ROCK_DARK))
    return root


static func cart(seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Cart"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    root.add_child(AstrixMesh.box_on("Bed", Vector3(1.3, 0.24, 0.8), Vector3(0.0, 0.34, 0.0), AstrixPalette.TIMBER_LIT))
    for side in [-0.36, 0.36]:
        root.add_child(AstrixMesh.box("Side", Vector3(1.3, 0.3, 0.06), Vector3(0.0, 0.62, side), AstrixPalette.TIMBER))
    for wx in [-0.42, 0.42]:
        var wheel := AstrixMesh.cylinder_on("Wheel", 0.3, 0.3, 0.1, Vector3(wx, 0.0, 0.0), AstrixPalette.TIMBER.darkened(0.2), 9)
        wheel.rotation_degrees.z = 90.0
        wheel.position.y = 0.3
        root.add_child(wheel)
    root.add_child(AstrixMesh.box("Handle", Vector3(0.08, 0.08, 0.9), Vector3(0.0, 0.5, 0.75), AstrixPalette.TIMBER))
    # Cargo: sacks of grain, tying the cart to the food story.
    for i in range(2):
        root.add_child(AstrixMesh.blob("Sack", 0.2, Vector3(-0.25 + float(i) * 0.5, 0.66, 0.0), AstrixPalette.THATCH, 6, 3))
    return root


static func market_stall(seed_value: int, awning: Color) -> Node3D:
    var root := Node3D.new()
    root.name = "MarketStall"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = r.randf() * TAU
    for cx in [-0.7, 0.7]:
        for cz in [-0.5, 0.5]:
            root.add_child(AstrixMesh.box_on("Post", Vector3(0.09, 1.5, 0.09), Vector3(cx, 0.0, cz), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.box_on("Counter", Vector3(1.6, 0.12, 1.1), Vector3(0.0, 0.75, 0.0), AstrixPalette.TIMBER_LIT))
    # Striped awning: two colours, the reference's market signature.
    for i in range(4):
        var stripe: Color = awning if i % 2 == 0 else Color("f4f2ea")
        root.add_child(AstrixMesh.box("Awning", Vector3(0.42, 0.07, 1.4),
            Vector3(-0.63 + float(i) * 0.42, 1.55, 0.0), stripe))
    # Goods on the counter.
    for i in range(3):
        root.add_child(AstrixMesh.blob("Goods", 0.12, Vector3(-0.45 + float(i) * 0.45, 0.93, 0.0),
            [AstrixPalette.CROP_HARVEST, AstrixPalette.ROOF, AstrixPalette.FOLIAGE][i], 6, 3))
    return root


# ===========================================================================
# BOATS / WATER DRESSING  (sells the water as navigable, per the reference)
# ===========================================================================

## Sailboat.
##
## REBUILT for legibility. Review reported the previous boats as crates; three
## causes, all addressed here.
##  1. The hull was a plain box, and a box in water is a crate. The prow and stern
##     are now triangular wedges, so the PLAN silhouette is boat-shaped.
##  2. The sails were 0.07-unit-thin BOXES. A slab does not read as a sail. They
##     are now real triangles - a Bermuda main with its head over the masthead and
##     a jib forward - which is the most recognisable shape on open water.
##  3. `rotation.y = randf() * TAU` gave every boat a random heading, so a sail
##     regularly presented edge-on at ~2 screen px and the whole boat collapsed.
##     Heading is now supplied by the caller (World3D.BOAT_ANCHORS) broadside to
##     the diorama camera, so the sail always shows its full area.
##
## Scale: ~4.1 units long, 3.4-unit mast, against 2.15-unit villagers and 1.95-unit
## house walls. At the OVERVIEW camera (~15 px per world unit on a 768px viewport)
## that is ~63px long and ~52px tall, which clears the threshold this project
## settled on for a prop being IDENTIFIABLE rather than merely visible.
static func sailboat(seed_value: int, heading: float = -0.785) -> Node3D:
    var root := Node3D.new()
    root.name = "Sailboat"
    var r := AstrixMesh.rng(seed_value)
    root.rotation.y = heading
    var hull := AstrixPalette.TIMBER
    # Hull: centre box between a long fore wedge and a short aft wedge, sitting
    # half-submerged so the waterline cuts it the way a real hull is cut.
    root.add_child(AstrixMesh.box("Hull", Vector3(1.15, 0.5, 2.6), Vector3.ZERO, hull))
    root.add_child(_wedge("Bow", Vector3(1.15, 1.0, 0.5), Vector3(0.0, 0.0, 1.8), true, hull))
    root.add_child(_wedge("Stern", Vector3(1.15, 0.5, 0.5), Vector3(0.0, 0.0, -1.55), false, hull))
    # A rubbing strake along the sheer. One strong horizontal line is what makes a
    # hull read as a hull once it is only 60px wide.
    root.add_child(AstrixMesh.box("HullStripe", Vector3(1.22, 0.15, 2.5), Vector3(0.0, 0.2, 0.0), AstrixPalette.ROOF))
    root.add_child(AstrixMesh.box("Deck", Vector3(0.95, 0.1, 2.3), Vector3(0.0, 0.29, 0.0), AstrixPalette.TIMBER_LIT))
    root.add_child(AstrixMesh.box("Cockpit", Vector3(0.62, 0.2, 0.72), Vector3(0.0, 0.36, -0.6), hull))
    root.add_child(AstrixMesh.cylinder_on("Mast", 0.06, 0.085, 3.1, Vector3(0.0, 0.3, 0.15), hull))
    # Bermuda main: luff 0.0 puts the apex forward over the mast, foot along the boom.
    root.add_child(_sail("Sail", 1.95, 2.55, 0.1, 0.0, Vector3(0.0, 0.32, -0.82), Color("f4f2ea")))
    root.add_child(AstrixMesh.box("Boom", Vector3(0.09, 0.09, 1.9), Vector3(0.0, 0.36, -0.8), hull))
    # Jib ahead of the mast, apex aft toward the masthead.
    root.add_child(_sail("Jib", 1.35, 1.75, 0.09, 1.0, Vector3(0.0, 0.32, 0.85), Color("e8e4d4")))
    # Masthead pennant: a small bright accent at the highest point sharpens the
    # silhouette against flat water.
    root.add_child(AstrixMesh.box("Pennant", Vector3(0.06, 0.16, 0.4), Vector3(0.0, 3.24, -0.05), AstrixPalette.ROOF))
    # Deterministic per-boat trim so a fleet is not five identical copies, kept
    # small enough that the READABLE properties (bow direction, sail area) hold.
    root.rotation.y += (r.randf() - 0.5) * 0.16
    return root


## Horizontal triangular wedge for a bow or stern. PrismMesh's apex points along
## +Y, so a quarter turn about X lays it flat: `forward` true aims the apex at +Z,
## false at -Z. The extrusion axis becomes vertical, so size.z is hull depth.
static func _wedge(name_hint: String, size: Vector3, pos: Vector3, forward: bool, color: Color) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := PrismMesh.new()
    mesh.size = size
    node.mesh = mesh
    node.rotation.x = (PI * 0.5) if forward else (-PI * 0.5)
    node.position = pos
    node.material_override = AstrixPalette.flat(color)
    return node


## Triangular sail. PrismMesh's triangle lies in XY and extrudes along Z, so a
## quarter turn about Y swings the triangle into the boat's fore-aft/vertical
## plane and leaves size.z as cloth thickness. `luff` chooses which end carries
## the apex: 0.0 forward (a mainsail's head over the mast), 1.0 aft (a jib).
## Bottom-anchored, so callers position the FOOT at deck height.
static func _sail(name_hint: String, length: float, height: float, thickness: float,
        luff: float, pos: Vector3, color: Color) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := PrismMesh.new()
    mesh.size = Vector3(length, height, thickness)
    mesh.left_to_right = luff
    node.mesh = mesh
    node.rotation.y = PI * 0.5
    node.position = Vector3(pos.x, pos.y + height * 0.5, pos.z)
    node.material_override = AstrixPalette.flat(color)
    return node


## A granary crib: sacks stacked in proportion to authoritative food. This is how
## "we are running out of food" becomes visible IN THE WORLD instead of living
## only in the HUD — a full store looks full, an empty one looks empty.
##
## SCALE NOTE: at the observatory camera 1 world unit is ~24 screen px. The first
## version was house-adjacent in footprint but only ~1.3 units tall, so a probe
## measured its sacks at 8px and review reported the granary as absent. It is now
## a full building-sized structure (~4.5 x 3.2 x 2.6) with 0.42-radius sacks.
static func food_store(food: int, capacity: int, seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "FoodStore"
    var r := AstrixMesh.rng(seed_value)
    var w := 4.4
    var d := 3.0
    var wall_h := 1.7

    # Stone footing + open-fronted timber crib so the contents are visible.
    root.add_child(AstrixMesh.box_on("CribFooting", Vector3(w + 0.3, 0.2, d + 0.3), Vector3.ZERO, AstrixPalette.STONE_WALL))
    for side in [-1.0, 1.0]:
        root.add_child(AstrixMesh.box_on("CribSide", Vector3(0.22, wall_h, d),
            Vector3(side * (w * 0.5 - 0.11), 0.2, 0.0), AstrixPalette.TIMBER_LIT))
    root.add_child(AstrixMesh.box_on("CribBack", Vector3(w, wall_h, 0.22),
        Vector3(0.0, 0.2, -d * 0.5 + 0.11), AstrixPalette.TIMBER_LIT))
    # Board battens on the back wall so it reads as built, not as a slab.
    for i in range(5):
        root.add_child(AstrixMesh.box("Batten", Vector3(0.1, wall_h * 0.9, 0.04),
            Vector3(-w * 0.4 + float(i) * w * 0.2, 0.2 + wall_h * 0.5, -d * 0.5 + 0.02), AstrixPalette.TIMBER))
    # Low front lip: keeps the sacks in, keeps the contents readable.
    root.add_child(AstrixMesh.box_on("CribLip", Vector3(w, 0.4, 0.2),
        Vector3(0.0, 0.2, d * 0.5 - 0.1), AstrixPalette.TIMBER))
    root.add_child(AstrixMesh.gable("CribRoof", Vector3(w + 0.7, 0.95, d + 0.7),
        Vector3(0.0, 0.2 + wall_h, 0.0), AstrixPalette.THATCH))
    root.add_child(AstrixMesh.box("CribRidge", Vector3(0.16, 0.09, d + 0.7),
        Vector3(0.0, 0.2 + wall_h + 0.95, 0.0), AstrixPalette.THATCH.darkened(0.28)))
    for side2 in [-1.0, 1.0]:
        root.add_child(AstrixMesh.box_on("CribPost", Vector3(0.18, 0.2 + wall_h, 0.18),
            Vector3(side2 * (w * 0.5 - 0.11), 0.2, d * 0.5 - 0.11), AstrixPalette.TIMBER))

    # Sacks: 0..9, driven by the authoritative food fraction.
    #
    # PLACED OUTSIDE, ON AN OPEN PLATFORM IN FRONT OF THE CRIB. A probe measured
    # the crib roof at 18 screen px, so anything *inside* it is invisible from the
    # diorama camera — which is why review kept reporting the granary as absent.
    # Stock has to sit on open ground to be readable from above.
    # STOCK: 0..5 large grain stacks. Sized at VILLAGER HEIGHT (~1.8 units ≈ 44px
    # at the observatory camera). Earlier versions used 0.24 → 0.6 → 0.72-unit
    # bales, which probes measured at 8 → 16 → 14px; at that size review read them
    # as sheep, boulders, or a workbench, never as stored food. A prop that must
    # be identified at diorama zoom has to be person-sized.
    var stacks := int(round(clampf(float(food) / maxf(1.0, float(capacity)), 0.0, 1.0) * 5.0))
    root.add_child(AstrixMesh.box_on("StockPlatform", Vector3(w + 1.6, 0.24, 3.0),
        Vector3(0.0, 0.0, d * 0.5 + 1.5), AstrixPalette.TIMBER.darkened(0.22)))
    for i in range(stacks):
        var sx := -2.4 + float(i % 3) * 2.4
        var sz := d * 0.5 + 0.9 + float(i / 3) * 1.7
        var stack := Node3D.new()
        stack.name = "Sack_%d" % i
        stack.position = Vector3(sx, 0.24, sz)
        stack.rotation.y = (r.randf() - 0.5) * 0.4
        root.add_child(stack)
        # Three tiers, tapering: a real stack silhouette rather than one block.
        var tiers := [
            {"w": 1.5, "h": 0.7, "d": 1.2, "y": 0.0},
            {"w": 1.3, "h": 0.6, "d": 1.05, "y": 0.7},
            {"w": 1.0, "h": 0.5, "d": 0.85, "y": 1.3},
        ]
        for t in range(tiers.size()):
            var tier: Dictionary = tiers[t]
            var bale := AstrixMesh.box_on("Bale_%d" % t,
                Vector3(float(tier["w"]), float(tier["h"]), float(tier["d"])),
                Vector3(0.0, float(tier["y"]), 0.0),
                Color("f2e8c6").darkened(0.03 * float(t) + r.randf() * 0.05))
            bale.rotation_degrees.y = (r.randf() - 0.5) * 12.0
            stack.add_child(bale)
            # Dark binding strap: makes each tier read as a tied bundle.
            stack.add_child(AstrixMesh.box("Strap_%d" % t,
                Vector3(float(tier["w"]) + 0.04, 0.11, 0.16),
                Vector3(0.0, float(tier["y"]) + float(tier["h"]) * 0.5, 0.0),
                AstrixPalette.TIMBER.darkened(0.32)))
        # Cap sheaf so the top reads as loose grain, not a crate.
        stack.add_child(AstrixMesh.cone_on("Cap", 0.5, 0.42, Vector3(0.0, 1.8, 0.0),
            AstrixPalette.CROP_HARVEST.darkened(0.08), 7))
    # An empty platform gets toppled baskets: unmistakably "nothing left".
    if stacks == 0:
        for i in range(3):
            var basket := AstrixMesh.cylinder_on("EmptyBasket_%d" % i, 0.6, 0.5, 0.8,
                Vector3(-1.8 + float(i) * 1.8, 0.24, d * 0.5 + 1.4), AstrixPalette.TIMBER_LIT, 9)
            basket.rotation_degrees.z = 72.0 + float(i) * 18.0
            root.add_child(basket)
    return root


static func dock(length: float, seed_value: int) -> Node3D:
    var root := Node3D.new()
    root.name = "Dock"
    var r := AstrixMesh.rng(seed_value)
    var planks := maxi(3, int(length / 0.45))
    for i in range(planks):
        var t := -length * 0.5 + length * float(i) / float(planks - 1)
        var plank := AstrixMesh.box("Plank", Vector3(1.1, 0.09, 0.36), Vector3(0.0, 0.0, t), AstrixPalette.TIMBER_LIT)
        plank.material_override = AstrixPalette.flat(AstrixPalette.TIMBER_LIT.darkened(r.randf() * 0.12))
        root.add_child(plank)
    for i in range(maxi(2, int(length / 2.0))):
        var t2 := -length * 0.5 + 0.4 + (length - 0.8) * float(i) / maxf(1.0, float(maxi(2, int(length / 2.0)) - 1))
        for side in [-0.42, 0.42]:
            root.add_child(AstrixMesh.box_on("Piling", Vector3(0.16, 1.6, 0.16), Vector3(side, -1.55, t2), AstrixPalette.TIMBER.darkened(0.2)))
    return root
