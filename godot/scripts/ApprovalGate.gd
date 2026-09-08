extends CanvasLayer
## Human approval SEAM. No autonomous agent can bypass this node.
##
## Presentation moved to the Observatory (AgentConsole.gd), which renders the
## real pending proposal and owns the APPROVE/REJECT buttons. This node stays as
## the explicit approval seam in the scene tree — it receives the authoritative
## request, exposes approved/rejected signals for anything that wants to observe
## the gate, and routes a decision back through GameClient. It draws no UI, so
## the human never sees two competing approval dialogs.

signal approved(request: Dictionary)
signal rejected(request: Dictionary)

var current_request: Dictionary = {}

func _ready() -> void:
    layer = 30
    if get_node_or_null("/root/GameClient") != null:
        GameClient.astrix_approval_requested.connect(show_request)
    approved.connect(_respond_approved)
    rejected.connect(_respond_rejected)

## Record the authoritative pending request. The Observatory displays it.
func show_request(request: Dictionary) -> void:
    current_request = request.duplicate(true)

func approve() -> void:
    if not current_request.is_empty():
        approved.emit(current_request)

func reject() -> void:
    if not current_request.is_empty():
        rejected.emit(current_request)

func _respond_approved(request: Dictionary) -> void:
    GameClient.respond_to_astrix_approval(str(request.get("id", "")), "approve")

func _respond_rejected(request: Dictionary) -> void:
    GameClient.respond_to_astrix_approval(str(request.get("id", "")), "reject")
