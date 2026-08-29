extends Node
## Thin Godot client for the existing legacy API plus the parallel ASTrix API.
## ASTrix world mutations are server-authoritative and never committed locally.

signal state_received(state: Dictionary)
signal request_failed(message: String)
signal session_created(session: Dictionary)
signal astrix_state_received(state: Dictionary)
signal astrix_event_received(event: Dictionary)
signal astrix_command_succeeded(result: Dictionary)
signal astrix_command_failed(error: String)
signal astrix_approval_requested(request: Dictionary)

@export var api_origin: String = ""  # empty -> auto (web: same origin as the page; native: localhost)
@export var poll_interval_seconds: float = 0.5
@export var astrix_api_key: String = ""

var session: Dictionary = {}
var latest_state: Dictionary = {}
var astrix_state: Dictionary = {}
var _poll_timer: Timer
var _requests: Array[HTTPRequest] = []
var _last_event_fingerprint := ""
var _astrix_poll_in_flight := false

func _ready() -> void:
    if api_origin.is_empty():
        if OS.has_feature("web"):
            # Browser build: talk to the origin that served this page (relative
            # URLs do not work with HTTPRequest, so resolve the full origin).
            api_origin = str(JavaScriptBridge.eval("window.location.origin", true))
        else:
            api_origin = "http://127.0.0.1:8787"
    _poll_timer = Timer.new()
    _poll_timer.wait_time = poll_interval_seconds
    _poll_timer.timeout.connect(_poll_state)
    add_child(_poll_timer)
    _start_astrix_polling()

func create_room(mode: String = "solo", player_name: String = "Wizard") -> void:
    _post_json("/api/create", {"mode": mode, "name": player_name}, func(data: Dictionary) -> void:
        session = data
        session_created.emit(session)
        _start_polling()
    )

func join_room(room_code: String, player_name: String = "Wizard") -> void:
    _post_json("/api/join", {"roomCode": room_code.to_upper(), "name": player_name}, func(data: Dictionary) -> void:
        session = {"roomCode": room_code.to_upper(), "playerId": str(data.get("playerId", "")), "team": int(data.get("team", 0)), "host": false}
        session_created.emit(session)
        _start_polling()
    )

func start_match() -> void:
    if not _has_session():
        request_failed.emit("No active room session")
        return
    _post_json("/api/start", {"roomCode": session["roomCode"], "playerId": session["playerId"]}, func(_data: Dictionary) -> void: pass)

func get_state_once() -> void:
    get_state_once_legacy()

func get_state_once_legacy() -> void:
    if not _has_session():
        request_failed.emit("No active room session")
        return
    var path := "/state?room=%s&player=%s" % [_url_escape(str(session["roomCode"])), _url_escape(str(session["playerId"]))]
    _get_json(path, func(data: Dictionary) -> void:
        latest_state = _parse_game_state(data)
        state_received.emit(latest_state)
    )

func get_astrix_state_once() -> void:
    if _astrix_poll_in_flight:
        return
    _astrix_poll_in_flight = true
    _get_json("/astrix/state", func(data: Dictionary) -> void:
        _astrix_poll_in_flight = false
        _apply_astrix_state(data)
        astrix_state_received.emit(astrix_state)
    , func() -> void:
        _astrix_poll_in_flight = false
    )

func _start_astrix_polling() -> void:
    if _poll_timer.is_stopped():
        _poll_timer.start()
    get_astrix_state_once()

func send_astrix_command(command: Dictionary) -> void:
    var payload := command.duplicate(true)
    payload["player_id"] = str(session.get("playerId", "godot-player"))
    _post_json_astrix("/astrix/command", payload, func(result: Dictionary) -> void:
        if bool(result.get("success", false)):
            astrix_command_succeeded.emit(result)
            get_astrix_state_once()
        else:
            astrix_command_failed.emit(str(result.get("error", "ASTrix command rejected")))
    )

func respond_to_astrix_approval(approval_id: String, decision: String) -> void:
    _post_json_astrix("/astrix/approval/respond", {"approval_id": approval_id, "decision": decision}, func(result: Dictionary) -> void:
        if not bool(result.get("success", false)):
            astrix_command_failed.emit(str(result.get("error", "approval failed")))
        get_astrix_state_once()
    )

func get_astrix_tools() -> void:
    _get_json("/astrix/mcp/tools/list", func(_data: Dictionary) -> void: pass)

func _start_polling() -> void:
    _poll_timer.start()
    get_astrix_state_once()

func _poll_state() -> void:
    get_astrix_state_once()

func _apply_astrix_state(data: Dictionary) -> void:
    astrix_state = data
    var approvals: Variant = data.get("pendingApprovals", [])
    if approvals is Array:
        for approval in approvals:
            if approval is Dictionary:
                var fingerprint := JSON.stringify(approval)
                if fingerprint != _last_event_fingerprint:
                    _last_event_fingerprint = fingerprint
                    astrix_approval_requested.emit(approval)

func _has_session() -> bool:
    return not session.is_empty() and str(session.get("roomCode", "")) != "" and str(session.get("playerId", "")) != ""

func _parse_game_state(raw: Dictionary) -> Dictionary:
    return {"matchId": str(raw.get("matchId", "")), "status": str(raw.get("status", "lobby")), "tick": int(raw.get("tick", 0)), "elapsed": float(raw.get("elapsed", 0.0)), "matchDuration": float(raw.get("matchDuration", 300.0)), "winnerTeam": raw.get("winnerTeam", null), "winReason": raw.get("winReason", null), "suddenDeath": bool(raw.get("suddenDeath", false)), "enraged": bool(raw.get("enraged", false)), "riddleSet": int(raw.get("riddleSet", 0)), "visibleRiddleLines": _array_of_strings(raw.get("visibleRiddleLines", [])), "players": _array_of_dictionaries(raw.get("players", [])), "furniture": _array_of_dictionaries(raw.get("furniture", [])), "gronk": _dictionary(raw.get("gronk", {})), "pedestals": _array_of_dictionaries(raw.get("pedestals", [])), "closetSpots": _array_of_dictionaries(raw.get("closetSpots", [])), "groundTreasure": raw.get("groundTreasure", null), "treasurePings": _array_of_dictionaries(raw.get("treasurePings", [])), "pendingBank": raw.get("pendingBank", null), "bankCooldownUntilTick": raw.get("bankCooldownUntilTick", [0, 0]), "latestNoise": raw.get("latestNoise", null)}

func _post_json_astrix(path: String, body: Dictionary, on_success: Callable) -> void:
    var headers: Array = ["Content-Type: application/json"]
    if not astrix_api_key.is_empty():
        headers.append("Authorization: Bearer %s" % astrix_api_key)
    _post_json(path, body, on_success, headers)

func _post_json(path: String, body: Dictionary, on_success: Callable, headers_override: Array = []) -> void:
    var headers: Array = ["Content-Type: application/json"] if headers_override.is_empty() else headers_override
    var request := HTTPRequest.new()
    add_child(request)
    _requests.append(request)
    request.request_completed.connect(func(result: int, response_code: int, _headers: PackedStringArray, payload: PackedByteArray) -> void:
        _finish_request(request)
        var parsed = JSON.parse_string(payload.get_string_from_utf8())
        if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
            var message := "HTTP request failed (%d/%d)" % [result, response_code]
            request_failed.emit(message)
            if path.begins_with("/astrix/"): astrix_command_failed.emit(message)
            return
        if not parsed is Dictionary:
            var message := "API returned invalid JSON"
            request_failed.emit(message)
            if path.begins_with("/astrix/"): astrix_command_failed.emit(message)
            return
        on_success.call(parsed)
    )
    request.request(api_origin + path, headers, HTTPClient.METHOD_POST, JSON.stringify(body))

func _get_json(path: String, on_success: Callable, on_complete: Callable = Callable()) -> void:
    var request := HTTPRequest.new()
    add_child(request)
    _requests.append(request)
    request.request_completed.connect(func(result: int, response_code: int, _headers: PackedStringArray, payload: PackedByteArray) -> void:
        _finish_request(request)
        if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
            if on_complete.is_valid(): on_complete.call()
            request_failed.emit("HTTP state request failed (%d/%d)" % [result, response_code])
            return
        var parsed = JSON.parse_string(payload.get_string_from_utf8())
        if parsed is Dictionary: on_success.call(parsed)
        else:
            request_failed.emit("State endpoint returned invalid JSON")
            if on_complete.is_valid(): on_complete.call()
    )
    request.request(api_origin + path, ["Accept: application/json"], HTTPClient.METHOD_GET)

func _finish_request(request: HTTPRequest) -> void:
    _requests.erase(request)
    request.queue_free()

func _url_escape(value: String) -> String:
    return value.uri_encode()

func _dictionary(value: Variant) -> Dictionary:
    return value if value is Dictionary else {}

func _array_of_dictionaries(value: Variant) -> Array:
    var result: Array = []
    if value is Array:
        for item in value:
            if item is Dictionary: result.append(item)
    return result

func _array_of_strings(value: Variant) -> Array[String]:
    var result: Array[String] = []
    if value is Array:
        for item in value: result.append(str(item))
    return result
