extends CanvasLayer
## Economic Observatory HUD: the portfolio dashboard fused with the 3D city.
##
## AUTHORITY: none. Every number shown here is derived from the authoritative
## Core snapshot / agent status handed in via update_economy(). Portfolio-style
## figures are PRESENTATIONAL scalings of real Core quantities (food, resources,
## biome health) so the Observatory reads as an economic instrument while Core
## stays the single source of truth. Nothing here mutates state.

var _dash: PanelContainer
var _dash_grid: GridContainer
var _dash_labels: Dictionary = {}
var _sel_panel: PanelContainer
var _sel_title: Label
var _sel_rows: Label
var _cause: Label

func _ready() -> void:
	layer = 5
	_build_dashboard()
	_build_selection()
	_build_causal_strip()

func _panel_style(alpha: float = 0.78) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.06, 0.09, alpha)
	sb.border_color = Color(1, 1, 1, 0.16)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	return sb

func _mono(text: String, size: int, color: Color = Color("e8eef4")) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_constant_override("outline_size", 4)
	l.add_theme_color_override("font_outline_color", Color(0.02, 0.03, 0.05, 0.9))
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _build_dashboard() -> void:
	_dash = PanelContainer.new()
	_dash.name = "EconomyDash"
	_dash.add_theme_stylebox_override("panel", _panel_style())
	_dash.position = Vector2(16, 16)
	_dash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 2)
	_dash.add_child(vb)
	var head := _mono("ASTRIX ECONOMIC OBSERVATORY", 13, Color("8fd3c7"))
	vb.add_child(head)
	_dash_grid = GridContainer.new()
	_dash_grid.columns = 2
	_dash_grid.add_theme_constant_override("h_separation", 14)
	_dash_grid.add_theme_constant_override("v_separation", 1)
	vb.add_child(_dash_grid)
	for key in ["PORTFOLIO", "LIQUIDITY", "RISK", "PRODUCTIVITY"]:
		var k := _mono(key, 11, Color("9fb0c6"))
		var v := _mono("—", 15)
		_dash_grid.add_child(k)
		_dash_grid.add_child(v)
		_dash_labels[key] = v
	var sub := _mono("authoritative Core state · Godot renders only", 10, Color("7a8a9c"))
	vb.add_child(sub)
	add_child(_dash)

func _build_selection() -> void:
	_sel_panel = PanelContainer.new()
	_sel_panel.name = "EntityPanel"
	_sel_panel.add_theme_stylebox_override("panel", _panel_style(0.88))
	_sel_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sel_panel.visible = false
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 2)
	_sel_panel.add_child(vb)
	_sel_title = _mono("ASSET", 14, Color("ffd98a"))
	vb.add_child(_sel_title)
	_sel_rows = _mono("", 12)
	_sel_rows.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sel_rows.custom_minimum_size = Vector2(300, 0)
	vb.add_child(_sel_rows)
	add_child(_sel_panel)
	_reposition()
	get_viewport().size_changed.connect(_reposition)

func _build_causal_strip() -> void:
	_cause = _mono("", 11, Color("c8d4e2"))
	_cause.name = "CausalStrip"
	_cause.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_cause.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_cause.custom_minimum_size = Vector2(620, 0)
	_cause.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_cause)
	_reposition()

func _reposition() -> void:
	if not is_inside_tree():
		return
	var v := get_viewport().get_visible_rect().size
	if is_instance_valid(_sel_panel):
		_sel_panel.position = Vector2(16, v.y - 260.0)
	if is_instance_valid(_cause):
		_cause.position = Vector2((v.x - 620.0) * 0.5, v.y - 44.0)

## Presentational economic scaling of real Core quantities.
func update_economy(snap: Dictionary, agent_status: Dictionary) -> void:
	if snap.is_empty():
		return
	var food := float(snap.get("food", 0))
	var res: Dictionary = snap.get("resources", {})
	var wood := float(res.get("wood", 0))
	var stone := float(res.get("stone", 0))
	var crystal := float(res.get("crystal", 0))
	var pop := maxi(1, int(snap.get("population", 1)))
	var health: Dictionary = snap.get("biomeHealth", {})
	var prod := 0.0
	var n := 0
	for k in health.keys():
		prod += float(health[k])
		n += 1
	prod = prod / float(maxi(1, n)) * 100.0
	var portfolio := food * 1200.0 + wood * 640.0 + stone * 880.0 + crystal * 4200.0
	var liquidity := food * 1200.0
	var pressure := str(snap.get("foodPressureLevel", "ok"))
	var risk := 22.0
	if pressure == "high":
		risk = 47.0
	elif pressure == "critical":
		risk = 78.0
	_set("PORTFOLIO", "$%.2fM" % (portfolio / 1000000.0))
	_set("LIQUIDITY", "$%.0fK" % (liquidity / 1000.0))
	_set("RISK", "%d%% · %s" % [int(risk), pressure.to_upper()])
	_set("PRODUCTIVITY", "%d%%" % int(prod))
	# causal strip: last steward events as observe -> decide -> execute chain
	var events: Array = []
	if agent_status.has("lastEvents") and agent_status["lastEvents"] is Array:
		events = agent_status["lastEvents"]
	if not events.is_empty():
		var tail: Array = events.slice(maxi(0, events.size() - 3))
		var bits: PackedStringArray = PackedStringArray()
		for e in tail:
			if e is Dictionary:
				var d: Variant = (e as Dictionary).get("data", {})
				var s := ""
				if d is Dictionary:
					s = str((d as Dictionary).get("decision", (d as Dictionary).get("tool", "")))
				bits.append("%s" % str((e as Dictionary).get("type", "?")))
				if s != "":
					bits.append(s)
		_cause.text = "CAUSAL CHAIN  " + "  →  ".join(bits)
	else:
		var state := str(agent_status.get("state", "IDLE"))
		_cause.text = "STEWARD %s · day %s · pop %d · food %d" % [state, str(snap.get("day", "—")), pop, int(food)]

func _set(key: String, text: String) -> void:
	if _dash_labels.has(key):
		(_dash_labels[key] as Label).text = text

func show_entity(title: String, rows: String) -> void:
	_sel_title.text = title
	_sel_rows.text = rows
	_sel_panel.visible = true

func clear_entity() -> void:
	_sel_panel.visible = false
