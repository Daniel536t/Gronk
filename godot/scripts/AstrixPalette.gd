extends Object
class_name AstrixPalette
## SINGLE SOURCE OF ART DIRECTION for the ASTrix world.
##
## Direction: saturated low-poly settlement-builder diorama, sampled from the
## project reference (/home/ubuntu/refs/ref1.jpg): a green/terracotta/ocean-blue
## triad with desaturated cream + grey neutrals, flat Lambert materials, no
## textures, strong sky ambient, single warm key light.
##
## DELIBERATE DEPARTURE: the previous build used a pale parchment-lavender
## palette with violet water. Visual review found the violet water did not read
## as water at all and the whole frame collapsed into one dark value band. Per
## the current objective (clarity + beauty + simulation legibility) the water is
## now ocean blue and the meadow is actually green. The violet signature is kept,
## but demoted to the DUSK biome accent + crystal props, where it reads as
## "strange island" instead of contaminating the whole world.
##
## Colour is TAXONOMY here, not decoration: terracotta = built by people,
## green = alive/growing, gold = harvest-ready, grey = stone/inert,
## blue = water, violet = arcane.

# ---------------------------------------------------------------------------
# WATER
# ---------------------------------------------------------------------------
const WATER := Color("2e7cd2")
const WATER_DEEP := Color("1c5196")
const WATER_SHALLOW := Color("4f9cd8")
const FOAM := Color("eaf3ff")

# ---------------------------------------------------------------------------
# TERRAIN
# ---------------------------------------------------------------------------
const GRASS := Color("6bc42e")
const GRASS_LIT := Color("7ecb33")
const GRASS_DARK := Color("40801e")
## Tilled earth. Deliberately a DARK RED-BROWN, well away from the timber
## colours: at the previous value (7a5f32) review consistently read farm fields
## as "wooden planked decks" because soil and TIMBER (6b4a2e) were the same hue.
const SOIL := Color("5b3418")
const SOIL_TILLED := Color("7d4c24")
const SAND := Color("dcc694")
const ROCK := Color("9ca2a3")
const ROCK_LIT := Color("b7bcbc")
const ROCK_DARK := Color("6b7275")
const PATH := Color("b39a72")
const PATH_DARK := Color("8f7854")

# Frost biome: cold rock + snow, still inside the same value discipline.
const FROST_GRASS := Color("b8d6c8")
const FROST_ROCK := Color("8fa2ad")
const SNOW := Color("eef4f8")
## Basalt: the Bastion's volcanic skeleton. Near-black blue-grey, used for
## Frost's column palisade and gate foundations — the darkest built tone.
const BASALT := Color("3d444e")

# Dusk biome: the ASTrix arcane signature, contained to one island.
# Deepened a full step in the reimagination pass: the old violet was so pale it
# read as unfinished snow, not as "strange island".
const DUSK_GRASS := Color("7763a8")
const DUSK_ROCK := Color("5d4c78")
const CRYSTAL := Color("b98bf0")

# ---------------------------------------------------------------------------
# BUILT STRUCTURES
# ---------------------------------------------------------------------------
const ROOF := Color("dc5f22")            # terracotta — "people built this"
const ROOF_LIT := Color("e8763a")
const ROOF_DARK := Color("ae461a")
const ROOF_CIVIC := Color("2189d9")      # civic/important infrastructure
const WALL := Color("f1ece0")            # cream plaster
const WALL_SHADE := Color("d8d0be")
const TIMBER := Color("6b4a2e")
const TIMBER_LIT := Color("8a6238")
const BARN := Color("b5482e")            # agricultural red
const THATCH := Color("c9a24b")
const STONE_WALL := Color("9ba1a3")

# ---------------------------------------------------------------------------
# VEGETATION / CROPS
# ---------------------------------------------------------------------------
const FOLIAGE := Color("62a344")
const FOLIAGE_LIGHT := Color("93c93f")
const FOLIAGE_DARK := Color("3a6a28")
const CONIFER := Color("4f8c36")
const BARK := Color("6a4526")
const BARK_DARK := Color("4e3018")
const BUSH := Color("55963a")
const CROP_SEEDLING := Color("8ed060")
const CROP_GROWING := Color("79b93b")
const CROP_MATURE := Color("d9c33a")
const CROP_HARVEST := Color("edd62b")    # gold = ready, the harvest signal

# ---------------------------------------------------------------------------
# PEOPLE
# ---------------------------------------------------------------------------
const SKIN := Color("e8c9a0")
const HAIR := Color("3a2b22")
const TROUSERS := Color("55483c")
const TUNIC_FARMER := Color("4f9e57")
const TUNIC_BUILDER := Color("c26a34")
const TUNIC_CARRIER := Color("3d7ba8")
const CLOAK_WINTER := Color("7d8697")

# ---------------------------------------------------------------------------
# SEASONS — Core owns the season; this table owns what it LOOKS like.
# ---------------------------------------------------------------------------
const SEASONS := {
    "spring": {
        "grass": Color("74c93a"), "grass_dark": Color("47892a"),
        "frost_grass": Color("8fb89e"), "dusk_grass": Color("8571b6"),
        "conifer": Color("4f9c40"),
        "foliage": Color("6fb843"), "foliage_light": Color("9ed64c"),
        "sky_top": Color("4a94e4"), "sky_horizon": Color("bcd8f0"),
        "sun": Color("fff4d8"), "sun_energy": 1.55, "ambient": 0.52,
        "water_deep": Color("0e3d78"), "water_shallow": Color("3d8fc8"),
        "snow": 0.0, "fill": Color("cfe2f5"),
    },
    "summer": {
        "grass": Color("6bc42e"), "grass_dark": Color("40801e"),
        "frost_grass": Color("93bfa4"), "dusk_grass": Color("7763a8"),
        "conifer": Color("4f8c36"),
        "foliage": Color("58a83f"), "foliage_light": Color("8ec73a"),
        "sky_top": Color("3f8ee0"), "sky_horizon": Color("cfe4ef"),
        "sun": Color("fff6cf"), "sun_energy": 1.75, "ambient": 0.55,
        "water_deep": Color("0f4288"), "water_shallow": Color("3f97d4"),
        "snow": 0.0, "fill": Color("cfe2f5"),
    },
    "autumn": {
        # Autumn must stay GREEN-olive on the ground: the previous value
        # (a8b23a) turned the whole meadow yellow and killed the contrast
        # against every canopy. The warmth belongs in the foliage, not the field.
        "grass": Color("74a336"), "grass_dark": Color("4d7226"),
        "frost_grass": Color("7fa068"), "dusk_grass": Color("6a5790"),
        "conifer": Color("5a8c3c"),
        "foliage": Color("c96f28"), "foliage_light": Color("e09a34"),
        "sky_top": Color("4d8ccc"), "sky_horizon": Color("e6c9a0"),
        "sun": Color("ffdca8"), "sun_energy": 1.5, "ambient": 0.48,
        "water_deep": Color("0d3a70"), "water_shallow": Color("3585b8"),
        "snow": 0.0, "fill": Color("e0d0bc"),
    },
    "winter": {
        # Winter must be unmistakable: snow on, vegetation grey-green, low
        # cold sun, steel water. This is the food-pressure season.
        "grass": Color("d8e4ea"), "grass_dark": Color("a8bcc8"),
        "frost_grass": Color("b9d2dc"), "dusk_grass": Color("9a90b8"),
        "conifer": Color("6e8a90"),
        "foliage": Color("7e94a0"), "foliage_light": Color("9fb2bc"),
        "sky_top": Color("7e9ec0"), "sky_horizon": Color("dce6ee"),
        "sun": Color("e6f0ff"), "sun_energy": 1.05, "ambient": 0.62,
        "water_deep": Color("0c2c47"), "water_shallow": Color("32647f"),
        "snow": 1.0, "fill": Color("dae6f2"),
    },
}

static func season(id: String) -> Dictionary:
    return SEASONS.get(id, SEASONS["summer"])

# ---------------------------------------------------------------------------
# MATERIALS
# ---------------------------------------------------------------------------
## Flat Lambert surface: the ref uses per-object flat colour with no texture and
## no gloss, so form comes from the key light and colour discipline alone.
static func flat(color: Color) -> StandardMaterial3D:
    var mat := StandardMaterial3D.new()
    mat.albedo_color = color
    mat.roughness = 0.95
    mat.metallic = 0.0
    mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
    if color.a < 1.0:
        mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    return mat

## Emissive accent — used ONLY for state signals (harvest-ready gold, crystal,
## lantern glow), never for decoration.
static func glow(color: Color, energy: float = 0.5) -> StandardMaterial3D:
    var mat := flat(color)
    mat.emission_enabled = true
    mat.emission = color
    mat.emission_energy_multiplier = energy
    return mat

## Water: the one material allowed a specular response, so the sun produces a
## real highlight and the surface reads as liquid rather than painted ground.
static func water(color: Color, alpha: float = 0.88) -> StandardMaterial3D:
    var mat := StandardMaterial3D.new()
    mat.albedo_color = Color(color.r, color.g, color.b, alpha)
    mat.roughness = 0.12
    mat.metallic = 0.35
    mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    mat.cull_mode = BaseMaterial3D.CULL_DISABLED
    return mat

## Unlit flat colour — for foam dashes and UI-ish world marks that must keep a
## constant value regardless of light direction.
static func unshaded(color: Color) -> StandardMaterial3D:
    var mat := flat(color)
    mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    return mat
