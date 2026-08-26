// Three riddle sets, three escalating lines each. Line 1 reveals at match
// start (0s), line 2 at 90s, line 3 at 180s. The treasure furniture id is
// NEVER hinted at here; it lives only in the engine.
//
// Set 0 — Kitchen  -> pairs with the Fridge spot
// Set 1 — Living room -> pairs with the Bookshelf spot
// Set 2 — Lounge   -> pairs with the Couch spot
export const RIDDLE_SETS: string[][] = [
  [
    "The treasure sleeps where meals are made.",
    "It rests where cold things stay.",
    "Open the fridge. Behind the milk.",
  ],
  [
    "The treasure waits where stories are told.",
    "It hides among tales of old.",
    "Third shelf of the bookshelf, behind the red book.",
  ],
  [
    "The treasure dozes where guests take their seat.",
    "It sank where cushions meet.",
    "Under the couch's left cushion. Dig.",
  ],
];
