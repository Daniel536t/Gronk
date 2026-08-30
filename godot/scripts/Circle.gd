class_name Circle
extends Control
## A simple filled antialiased circle Control used for the pastel UI buttons.

@export var radius: float = 32.0:
    set(v):
        radius = v
        queue_redraw()
@export var color: Color = Color.WHITE:
    set(v):
        color = v
        queue_redraw()

func _init() -> void:
    mouse_filter = MOUSE_FILTER_IGNORE

func _draw() -> void:
    var r := minf(radius, minf(size.x, size.y) / 2.0)
    draw_circle(size / 2.0, r, color)