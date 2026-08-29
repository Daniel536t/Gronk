extends CanvasLayer
## Presentation-only console scaffold. Agent execution arrives in a later phase.

var panel: PanelContainer
var log_label: RichTextLabel

func _ready() -> void:
    layer = 20
    panel = PanelContainer.new()
    panel.name = "AgentConsolePanel"
    panel.position = Vector2(24, 520)
    panel.size = Vector2(520, 150)
    panel.visible = false
    add_child(panel)
    log_label = RichTextLabel.new()
    log_label.bbcode_enabled = true
    log_label.fit_content = false
    log_label.text = "[color=#b9c7d8]WORLD STEWARD // awaiting tools[/color]"
    panel.add_child(log_label)
    var bus := get_node_or_null("/root/GameCommandBus")
    if bus:
        bus.command_completed.connect(_on_command_completed)

func append_log(message: String) -> void:
    if log_label:
        log_label.append_text("\n" + message)

func _on_command_completed(command_name: String, result: Dictionary) -> void:
    append_log("[color=#ffd166]TOOL[/color] %s → %s" % [command_name, str(result.get("ok", false))])
