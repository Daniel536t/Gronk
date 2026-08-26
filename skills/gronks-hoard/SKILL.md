---
name: gronks-hoard
description: Full rules, riddle sets, and the riddle reveal schedule for Gronk's Hoard — a real-time hide-and-seek heist where TrueForge agents are the monster and the bots. Load this to play as Gronk, a bot wizard, or the game master.
---

# Gronk's Hoard — Game Rules

A real-time multiplayer hide-and-seek heist. Two wizard teams in one single-screen
room, top-down 2D (Among Us feel). The room is a 2D plane (x, y as floats, ~100x60).
No physics engine.

## Teams & roles

- 2 teams, 2 wizards each (max 2v2). No hider/seeker split — **everyone** can hide
  as furniture and **everyone** can search.
- Gronk is the troll monster. He wanders, sniffs, and catches wizards.

## Treasure (the secret)

- At match start the ENGINE secretly picks one furniture item that holds the treasure.
- `treasureFurnitureId` NEVER leaves the server. Clients and agents only ever learn:
  (a) riddle text, and (b) whether THEIR OWN search succeeded.

## Riddles

Three hardcoded sets, three escalating lines each, revealed at 0s / 90s / 180s.

### Set 0 — Kitchen
1. The treasure sleeps where meals are made.
2. It rests where cold things stay.
3. Open the fridge. Behind the milk.

### Set 1 — Living room
1. The treasure waits where stories are told.
2. It hides among tales of old.
3. Third shelf of the bookshelf, behind the red book.

### Set 2 — Lounge
1. The treasure dozes where guests take their seat.
2. It sank where cushions meet.
3. Under the couch's left cushion. Dig.

The three sets pair with three furniture spots: **fridge** (Set 0), **bookshelf**
(Set 1), **couch** (Set 2).

## Furniture

~10 fixed spots. Stand next to furniture and TRANSFORM into it — your position
locks and you cannot move while transformed. Pressing TRANSFORM again (or moving)
breaks the disguise.

## The one verb: ACTION (near furniture = SEARCH)

Searching resolves, in order:
1. **Treasure there** → pick it up (you become the carrier).
2. **Enemy transformed as it** → they are revealed + stunned 3s.
3. **Otherwise** → "empty!".

**Every search emits a noise event that attracts Gronk.** Searching is never free.

## Stun

3s. Can't act, glow. 2s post-stun immunity (re-hiding during immunity reveals you
but does not stun you).

## Carrying

Carrier glows gold, moves 30% slower, cannot transform. A stunned carrier DROPS
the treasure at their position (walk over it to grab). Carrier at their own
pedestal + ACTION = bank request.

## Gronk (the troll)

- Wanders; every 15s SNIFFS and moves toward, in priority order:
  1. latest noise event,
  2. nearest stunned player,
  3. nearest visible (non-transformed) player.
- Touch → player sent to the CLOSET for 25s, then respawns at their own pedestal.
- Final 60s: ENRAGE (2x speed).
- Gronk cannot see transformed (hidden) wizards.

## Sudden death

No bank by 5:00 → the treasure pings the map every 10s and enrage stays on.

## Win conditions

- Bank the treasure at your own pedestal (with human approval in M5) → your team wins.
- Whole enemy team in the closet simultaneously → you win instantly.

---

## Riddle reveal schedule

| Line | Game time |
|------|-----------|
| 1    | 0s        |
| 2    | 90s       |
| 3    | 180s      |

The game-master agent owns this schedule: on each reveal, call `reveal_riddle`
and broadcast the returned line text. The frontend polls `get_state` and shows
`visibleRiddleLines` automatically.

## Agent intents

`agent_intent(agent_id, intent, targetId?)` with intents:
`SEARCH_FURNITURE | HIDE_AS | FLEE | GRAB | GO_TO_PEDESTAL | HUNT_NEAREST`.
The engine executes an intent continuously until replaced. Gronk's `agent_id`
is `gronk`, and its lever is `HUNT_NEAREST` (steers the next sniff).
