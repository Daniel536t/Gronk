extends CanvasLayer
## Presentation-only console for the ASTrix World Steward.
## Consumes the server's structured agent status (GameClient polls
## /astrix/agent/status) plus local command-bus completions. No authority
## lives here — this is a mirror of what the server reports.

var panel: PanelContainer
var log_label: RichTextLabel
var _status_text := "WORLD STEWARD // awaiting server"
var _lines: Array[String] = []

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
    log_label.text = _status_text
    panel.add_child(log_label)
    var bus := get_node_or_null("/root/GameCommandBus")
    if bus:
        bus.command_completed.connect(_on_command_completed)
    if Engine.has_singleton("GameClient"):
        GameClient.astrix_agent_status_received.connect(_on_agent_status)

func _on_agent_status(status: Dictionary) -> void:
    panel.visible = true
    var state := str(status.get("state", "UNKNOWN"))
    var turn := int(status.get("turn", 0))
    var objective := str(status.get("objective", "")).strip_edges()
    _status_text = "[color=#ffd166]WORLD STEWARD[/color] // %s // turn %d" % [state, turn]
    if objective != "":
        _status_text += "\n[color=#b9c7d8]objective:[/color] %s" % objective
    var pending: Variant = status.get("pendingApproval")
    if pending is Dictionary:
        var approval_id := str(pending.get("approvalId", ""))
        var action: Variant = pending.get("action", {})
        var tool := ""
        if action is Dictionary:
            tool = str(action.get("tool", ""))
        _status_text += "\n[color=#ff8fa3]approval required[/color] %s (%s)" % [approval_id, tool]
    var events: Variant = status.get("lastEvents")
    if events is Array:
        var feed: Array[String] = []
        for event in events:
            if event is Dictionary:
                var type_name := str(event.get("type", ""))
                var data: Variant = event.get("data", {})
                var detail := ""
                if data is Dictionary:
                    detail = str(data.get("tool", data.get("error", "")))
                feed.append("[color=#b9c7d8]%s[/color] %s %s" % [type_name, detail, _time_label(int(event.get("at", 0)))])
        _lines = feed
    _render()

func _on_command_completed(command_name: String, result: Dictionary) -> void:
    _lines.append("[color=#ffd166]TOOL[/color] %s → %s" % [command_name, str(result.get("ok", false))])
    if _lines.size() > 12:
        _lines.remove_at(0)
    _render()

func append_log(message: String) -> void:
    _lines.append(message)
    if _lines.size() > 12:
        _lines.remove_at(0)
    _render()

func _render() -> void:
    if log_label == null:
        return
    var body := _status_text
    for line in _lines.slice(maxi(0, _lines.size() - 8)):
        body += "\n" + line
    log_label.text = body

func _time_label(at_ms: int) -> String:
    if at_ms <= 0:
        return ""
    var seconds := int(at_ms / 1000)
    var mins := seconds / 60
    var secs := seconds % 60
    return "[%02d:%02d]" % [mins, secs]
