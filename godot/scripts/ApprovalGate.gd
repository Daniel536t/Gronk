extends CanvasLayer
## Human approval presentation seam. No autonomous agent can bypass this node.

signal approved(request: Dictionary)
signal rejected(request: Dictionary)

var current_request: Dictionary = {}
var panel: PanelContainer
var action_label: Label

func _ready() -> void:
    layer = 30
    panel = PanelContainer.new()
    panel.name = "ApprovalGatePanel"
    panel.position = Vector2(400, 240)
    panel.size = Vector2(480, 240)
    panel.visible = false
    add_child(panel)
    var box := VBoxContainer.new()
    panel.add_child(box)
    action_label = Label.new()
    action_label.text = "Approval required"
    box.add_child(action_label)
    var approve_button := Button.new()
    approve_button.text = "APPROVE"
    approve_button.pressed.connect(_approve)
    box.add_child(approve_button)
    var reject_button := Button.new()
    reject_button.text = "REJECT"
    reject_button.pressed.connect(_reject)
    box.add_child(reject_button)
    GameClient.astrix_approval_requested.connect(show_request)
    approved.connect(_respond_approved)
    rejected.connect(_respond_rejected)

func show_request(request: Dictionary) -> void:
    current_request = request.duplicate(true)
    if action_label:
        action_label.text = "%s\n%s\nImpact: %s" % [str(request.get("action", "Action")), str(request.get("reason", "")), str(request.get("impact", {}))]
    if panel:
        panel.visible = true

func _approve() -> void:
    panel.visible = false
    approved.emit(current_request)

func _reject() -> void:
    panel.visible = false
    rejected.emit(current_request)

func _respond_approved(request: Dictionary) -> void:
    GameClient.respond_to_astrix_approval(str(request.get("id", "")), "approve")

func _respond_rejected(request: Dictionary) -> void:
    GameClient.respond_to_astrix_approval(str(request.get("id", "")), "reject")
