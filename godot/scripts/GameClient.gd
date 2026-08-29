extends Node
## Thin Godot client for the existing Gronk's Hoard HTTP API.
## This phase deliberately does not implement movement, prediction, hiding, or HUD.

signal state_received(state: Dictionary)
signal request_failed(message: String)
signal session_created(session: Dictionary)

@export var api_origin: String = "http://127.0.0.1:8787"
@export var poll_interval_seconds: float = 0.1

var session: Dictionary = {}
var latest_state: Dictionary = {}
var _poll_timer: Timer
var _requests: Array[HTTPRequest] = []

func _ready() -> void:
    _poll_timer = Timer.new()
    _poll_timer.wait_time = poll_interval_seconds
    _poll_timer.timeout.connect(_poll_state)
    add_child(_poll_timer)

func create_room(mode: String = "solo", player_name: String = "Wizard") -> void:
    _post_json("/api/create", {"mode": mode, "name": player_name}, func(data: Dictionary) -> void:
        session = data
        session_created.emit(session)
        _start_polling()
    )

func join_room(room_code: String, player_name: String = "Wizard") -> void:
    _post_json("/api/join", {"roomCode": room_code.to_upper(), "name": player_name}, func(data: Dictionary) -> void:
        session = {
            "roomCode": room_code.to_upper(),
            "playerId": str(data.get("playerId", "")),
            "team": int(data.get("team", 0)),
            "host": false,
        }
        session_created.emit(session)
        _start_polling()
    )

func start_match() -> void:
    if not _has_session():
        request_failed.emit("No active room session")
        return
    _post_json("/api/start", {
        "roomCode": session["roomCode"],
        "playerId": session["playerId"],
    }, func(_data: Dictionary) -> void:
        pass
    )

func get_state_once() -> void:
    if not _has_session():
        request_failed.emit("No active room session")
        return
    var path := "/state?room=%s&player=%s" % [
        _url_escape(str(session["roomCode"])),
        _url_escape(str(session["playerId"])),
    ]
    _get_json(path, func(data: Dictionary) -> void:
        latest_state = _parse_game_state(data)
        state_received.emit(latest_state)
    )

func _start_polling() -> void:
    _poll_timer.start()
    get_state_once()

func _poll_state() -> void:
    get_state_once()

func _has_session() -> bool:
    return not session.is_empty() and str(session.get("roomCode", "")) != "" and str(session.get("playerId", "")) != ""

func _parse_game_state(raw: Dictionary) -> Dictionary:
    # Keep the public state shape intact. This is a defensive parser: absent
    # optional/null values remain valid, while required collections get stable
    # defaults for the first rendering milestone.
    return {
        "matchId": str(raw.get("matchId", "")),
        "status": str(raw.get("status", "lobby")),
        "tick": int(raw.get("tick", 0)),
        "elapsed": float(raw.get("elapsed", 0.0)),
        "matchDuration": float(raw.get("matchDuration", 300.0)),
        "winnerTeam": raw.get("winnerTeam", null),
        "winReason": raw.get("winReason", null),
        "suddenDeath": bool(raw.get("suddenDeath", false)),
        "enraged": bool(raw.get("enraged", false)),
        "riddleSet": int(raw.get("riddleSet", 0)),
        "visibleRiddleLines": _array_of_strings(raw.get("visibleRiddleLines", [])),
        "players": _array_of_dictionaries(raw.get("players", [])),
        "furniture": _array_of_dictionaries(raw.get("furniture", [])),
        "gronk": _dictionary(raw.get("gronk", {})),
        "pedestals": _array_of_dictionaries(raw.get("pedestals", [])),
        "closetSpots": _array_of_dictionaries(raw.get("closetSpots", [])),
        "groundTreasure": raw.get("groundTreasure", null),
        "treasurePings": _array_of_dictionaries(raw.get("treasurePings", [])),
        "pendingBank": raw.get("pendingBank", null),
        "bankCooldownUntilTick": raw.get("bankCooldownUntilTick", [0, 0]),
        "latestNoise": raw.get("latestNoise", null),
    }

func _post_json(path: String, body: Dictionary, on_success: Callable) -> void:
    var request := HTTPRequest.new()
    add_child(request)
    _requests.append(request)
    request.request_completed.connect(func(result: int, response_code: int, _headers: PackedStringArray, payload: PackedByteArray) -> void:
        _finish_request(request)
        if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
            request_failed.emit("HTTP request failed (%d/%d)" % [result, response_code])
            return
        var parsed = JSON.parse_string(payload.get_string_from_utf8())
        if not parsed is Dictionary:
            request_failed.emit("API returned invalid JSON")
            return
        on_success.call(parsed)
    )
    request.request(api_origin + path, ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(body))

func _get_json(path: String, on_success: Callable) -> void:
    var request := HTTPRequest.new()
    add_child(request)
    _requests.append(request)
    request.request_completed.connect(func(result: int, response_code: int, _headers: PackedStringArray, payload: PackedByteArray) -> void:
        _finish_request(request)
        if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
            request_failed.emit("HTTP state request failed (%d/%d)" % [result, response_code])
            return
        var parsed = JSON.parse_string(payload.get_string_from_utf8())
        if not parsed is Dictionary:
            request_failed.emit("State endpoint returned invalid JSON")
            return
        on_success.call(parsed)
    )

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
            if item is Dictionary:
                result.append(item)
    return result

func _array_of_strings(value: Variant) -> Array[String]:
    var result: Array[String] = []
    if value is Array:
        for item in value:
            result.append(str(item))
    return result
