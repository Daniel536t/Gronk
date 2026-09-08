extends Object
class_name AstrixMesh
## Low-poly mesh primitives shared by every ASTrix asset builder.
##
## Everything the world is made of funnels through here so the whole scene keeps
## one construction language (chunky faceted volumes, flat colour, pivot at the
## base) instead of each builder inventing its own conventions.
##
## PIVOT CONVENTION (matches godot/assets/ASSET_PIPELINE.md):
##   characters / trees / rocks / props -> pivot at GROUND CONTACT (y = 0)
##   buildings                          -> pivot at FLOOR CENTRE (y = 0)
## Builders therefore never need magic offsets to sit on terrain.

## Axis-aligned box whose BOTTOM sits at `base_y` — the workhorse. Using a
## bottom-anchored helper (instead of centre-anchored boxes) is what removes the
## whole class of "geometry floats / sinks / leaves a void band" bugs.
static func box_on(name_hint: String, size: Vector3, pos: Vector3, color: Color) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := BoxMesh.new()
    mesh.size = size
    node.mesh = mesh
    node.position = Vector3(pos.x, pos.y + size.y * 0.5, pos.z)
    node.material_override = AstrixPalette.flat(color)
    return node

## Centre-anchored box, for parts positioned relative to a parent pivot.
static func box(name_hint: String, size: Vector3, pos: Vector3, color: Color) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := BoxMesh.new()
    mesh.size = size
    node.mesh = mesh
    node.position = pos
    node.material_override = AstrixPalette.flat(color)
    return node

## Faceted cylinder/plateau, bottom-anchored. `segments` low (7-10) keeps the
## chunky low-poly silhouette the reference uses for islands and silos.
static func cylinder_on(name_hint: String, radius_top: float, radius_bottom: float,
        height: float, pos: Vector3, color: Color, segments: int = 9) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := CylinderMesh.new()
    mesh.top_radius = radius_top
    mesh.bottom_radius = radius_bottom
    mesh.height = height
    mesh.radial_segments = segments
    mesh.rings = 1
    node.mesh = mesh
    node.position = Vector3(pos.x, pos.y + height * 0.5, pos.z)
    node.material_override = AstrixPalette.flat(color)
    return node

## Cone, bottom-anchored — conifer crowns, silo roofs, tent tops.
static func cone_on(name_hint: String, radius: float, height: float,
        pos: Vector3, color: Color, segments: int = 8) -> MeshInstance3D:
    return cylinder_on(name_hint, 0.001, radius, height, pos, color, segments)

## Faceted sphere — broadleaf canopies, boulders, bushes.
static func blob(name_hint: String, radius: float, pos: Vector3, color: Color,
        segments: int = 8, rings: int = 4) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := SphereMesh.new()
    mesh.radius = radius
    mesh.height = radius * 2.0
    mesh.radial_segments = segments
    mesh.rings = rings
    node.mesh = mesh
    node.position = pos
    node.material_override = AstrixPalette.flat(color)
    return node

## Gable roof from a PrismMesh. IMPORTANT: PrismMesh tapers along X as Y rises
## and extrudes along Z, so the RIDGE RUNS ALONG Z and the sloping faces look
## down ±X. `size` = (span_x, height, depth_z). Bottom-anchored at `pos`.
static func gable(name_hint: String, size: Vector3, pos: Vector3, color: Color) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := PrismMesh.new()
    mesh.size = size
    node.mesh = mesh
    node.position = Vector3(pos.x, pos.y + size.y * 0.5, pos.z)
    node.material_override = AstrixPalette.flat(color)
    return node

## Flat horizontal quad lying on the ground (paths, plot floors, foam dashes).
## `render_priority` lets callers force a deterministic draw order so coplanar
## ground decals can never z-fight (see World3D's GROUND LAYER convention).
static func ground_quad(name_hint: String, size: Vector2, pos: Vector3, color: Color,
        priority: int = 0, unshaded: bool = false) -> MeshInstance3D:
    var node := MeshInstance3D.new()
    node.name = name_hint
    var mesh := QuadMesh.new()
    mesh.size = size
    node.mesh = mesh
    node.rotation_degrees.x = -90.0
    node.position = pos
    var mat := AstrixPalette.unshaded(color) if unshaded else AstrixPalette.flat(color)
    mat.render_priority = priority
    node.material_override = mat
    return node

## Deterministic RNG for placement variation. Seeded per call site so the world
## is identical on every run — required for reproducible visual evidence.
static func rng(seed_value: int) -> RandomNumberGenerator:
    var r := RandomNumberGenerator.new()
    r.seed = seed_value
    return r

## Radius of an ellipse (rx, rz) along a normalised XZ direction. Used to place
## shorelines, bridge endpoints and rim props exactly ON an island's edge
## instead of guessing offsets.
static func ellipse_radius(radius: Vector2, dir: Vector3) -> float:
    var cx := dir.x / maxf(0.0001, radius.x)
    var cz := dir.z / maxf(0.0001, radius.y)
    return 1.0 / maxf(0.0001, sqrt(cx * cx + cz * cz))
