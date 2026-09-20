#!/usr/bin/env bash
# Watch the live ASTrix steward loop. READ-ONLY: this script only issues GETs
# and never approves, rejects, starts, stops or otherwise mutates anything.
#
# It replaces a grep-based version that was wrong in three ways:
#   * it ran for a fixed 8x20s = 160s and then stopped, so a turn longer than
#     that looked like a stall when the loop was still working;
#   * `grep -o '"tool":"..."' | tail -3` matched across BOTH actions[] and
#     lastEvents[], so it printed historical tool names as if they were the
#     current action;
#   * AWAITING_APPROVAL (a healthy pause waiting on a human) was indistinguishable
#     from FAILED/COMPLETED.
#
# Usage:
#   scripts/poll-steward.sh                  # until a terminal state (default 1h cap)
#   scripts/poll-steward.sh 5 600            # every 5s, give up after 600s
#   POLL_UNTIL_TERMINAL=0 scripts/poll-steward.sh 20 160   # fixed window, like the old one
#
# Terminal for this script means the loop can no longer advance on its own:
#   COMPLETED, FAILED, STOPPED, IDLE (after having run), or AWAITING_APPROVAL
#   (a human decision is required -- polling can never resolve it).
set -uo pipefail
INTERVAL="${1:-${POLL_INTERVAL:-10}}"
BUDGET="${2:-${POLL_BUDGET:-3600}}"
HOST="${ASTRIX_HOST:-http://127.0.0.1:8787}"
UNTIL_TERMINAL="${POLL_UNTIL_TERMINAL:-1}"

echo "watching $HOST every ${INTERVAL}s (budget ${BUDGET}s, until_terminal=$UNTIL_TERMINAL)"
started=$(date +%s)
while :; do
  now=$(date +%s); elapsed=$((now - started))
  status="$(curl -s -m 8 "$HOST/astrix/agent/status" || true)"
  line="$(ELAPSED="$elapsed" STATUS="$status" python3 <<'PY'
import json, os
elapsed = os.environ.get("ELAPSED", "?")
raw = os.environ.get("STATUS") or ""
try:
    d = json.loads(raw)
except Exception as exc:
    print(f"TRANSIENT t={elapsed}s  server unreadable ({type(exc).__name__}) -- retrying")
    raise SystemExit(0)

state = str(d.get("state"))
turn = d.get("turn")
actions = d.get("actions") or []
current = d.get("currentAction")
pending = d.get("pendingApproval")

# CURRENT means: this turn's records only, and never an event-log entry.
this_turn = [a for a in actions if isinstance(a, dict) and a.get("turn") == turn]
def brief(a):
    args = a.get("args") or {}
    detail = ",".join(f"{k}={v}" for k, v in args.items() if not isinstance(v, (dict, list)))
    return f"{a.get('tool')}({detail})->{a.get('executionState')}/{a.get('verificationState')}"

parts = [f"t={elapsed}s", state, f"turn={turn}"]
if current:
    parts.append("current=" + brief(current))
parts.append(f"turn{turn}_actions={len(this_turn)}")
if this_turn:
    parts.append("[" + " | ".join(brief(a) for a in this_turn[-3:]) + "]")
else:
    parts.append("[none yet this turn -- the model is still deciding]")
if pending:
    # Read the flattened fields when the server provides them, otherwise fall
    # back to the nested action/impact -- never print a fabricated route.
    act = pending.get("action") or {}
    imp = pending.get("impact") or {}
    pargs = pending.get("args") or act.get("args") or {}
    def pick(*keys):
        for k in keys:
            for src in (pending, imp, pargs):
                if isinstance(src, dict) and src.get(k) not in (None, ""):
                    return src[k]
        return None
    route = ""
    a, b = pick("sourceIsland", "islandA", "island_a"), pick("destinationIsland", "islandB", "island_b")
    if a and b:
        route = f" {a}->{b}"
    parts.append(
        "GATE approval={0} {1}{2} (human decision required; world clock frozen)".format(
            pending.get("approvalId"),
            pending.get("command") or pending.get("tool") or act.get("tool") or "?",
            route,
        )
    )
if d.get("error"):
    parts.append("error=" + str(d["error"])[:160])

terminal = state in {"COMPLETED", "FAILED", "STOPPED", "AWAITING_APPROVAL"} or (state == "IDLE" and actions)
print(("TERMINAL " if terminal else "RUNNING  ") + "  ".join(parts))
PY
)"
  echo "$line"
  case "$line" in
    TERMINAL*) if [ "$UNTIL_TERMINAL" = "1" ]; then echo "-- terminal state reached; polling stops (nothing was mutated)"; exit 0; fi ;;
  esac
  if [ "$elapsed" -ge "$BUDGET" ]; then
    echo "-- observation budget ${BUDGET}s exhausted; the loop may still be working. Re-run to keep watching."
    exit 3
  fi
  sleep "$INTERVAL"
done
