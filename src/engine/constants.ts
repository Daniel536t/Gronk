// Fixed game constants. All time values are in seconds; the engine ticks at
// TICKS_PER_SECOND and converts to tick counts internally.

export const TICKS_PER_SECOND = 10;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

// Room (top-down 2D plane, arbitrary units). No physics engine.
export const ROOM_WIDTH = 100;
export const ROOM_HEIGHT = 60;

export const PLAYER_RADIUS = 1;
export const GRONK_RADIUS = 1.5;
export const TOUCH_RANGE = PLAYER_RADIUS + GRONK_RADIUS; // Gronk "touch" = catch

// Movement
export const MOVE_SPEED = 4; // units/sec
export const CARRY_SPEED_MULT = 0.7; // carrier is 30% slower

// Gronk
export const GRONK_SPEED = 3.5; // units/sec
export const GRONK_ENRAGE_SPEED_MULT = 2;
export const SNIFF_INTERVAL = 15; // Gronk sniffs every 15s
export const WANDER_RETARGET_INTERVAL = 3; // picks a new wander point every 3s

// Match timings
export const MATCH_DURATION = 300; // 5:00
export const ENRAGE_AT = MATCH_DURATION - 60; // final 60s -> enrage
export const SUDDEN_DEATH_PING_INTERVAL = 10; // treasure pings every 10s in sudden death

// Effects
export const CLOSET_DURATION = 25; // caught -> closet 25s, then respawn
export const STUN_DURATION = 3;
export const STUN_IMMUNITY = 2; // post-stun immunity

// Interactions
export const TRANSFORM_RANGE = 2.5; // must stand next to furniture to transform
export const ACTION_RANGE = 2.5; // must be near furniture to search
export const PEDESTAL_RANGE = 2.5; // must be at own pedestal to bank
export const GRAB_RANGE = 2.5; // walk over a dropped treasure to grab it

// Approval gate (M5): a rejected bank request blocks that team for 10s.
export const BANK_COOLDOWN = 10; // seconds

// Riddles
export const RIDDLE_REVEAL_INTERVAL = 90; // lines revealed at 0s / 90s / 180s
