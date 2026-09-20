#!/usr/bin/env bash
# READ-ONLY view of the live pending approval.
#
# Renders everything a human needs to authorize an irreversible mutation:
# command, source/destination island, resource cost (against what is actually
# in the treasury), risk level, irreversible/permanent status, the resulting
# topology, and the action + turn that are blocked on the answer.
#
# This script only ever issues GETs. It never approves, rejects, or mutates.
# Use scripts/approve-live.sh / scripts/reject-live.sh to decide.
set -uo pipefail
HOST="${ASTRIX_HOST:-http://127.0.0.1:8787}"

STATE="$(curl -s -m 8 "$HOST/astrix/state" || true)"
STATUS="$(curl -s -m 8 "$HOST/astrix/agent/status" || true)"

STATE="$STATE" STATUS="$STATUS" python3 <<'PY'
import json, os, sys

def load(name):
    raw = os.environ.get(name) or ""
    try:
        return json.loads(raw)
    except Exception as exc:
        print(f"!! could not read {name.lower()}: {exc}", file=sys.stderr)
        return {}

state, status = load("STATE"), load("STATUS")
if not state and not status:
    print("!! ASTrix server unreachable -- nothing to show")
    raise SystemExit(2)

approvals = state.get("pendingApprovals") or []
pending = status.get("pendingApproval") or {}
res = state.get("resources") or {}

print("=== LOOP ===")
print(f"  state    : {status.get('state')}")
print(f"  turn     : {status.get('turn')}")
print(f"  provider : {status.get('provider')}")
print(f"  day      : {state.get('day')}  season {state.get('season')}")

if not approvals and not pending:
    print("\nNo pending approval. The gate is open; nothing is waiting on a human.")
    raise SystemExit(0)

# The authoritative record is the one in Core state; the loop's view is the same
# approval flattened for reading. Prefer Core, fall back to the loop.
core = approvals[0] if approvals else {}
impact = core.get("impact") or pending.get("impact") or {}
args = pending.get("args") or (pending.get("action") or {}).get("args") or {}

def first(*keys):
    for k in keys:
        for src in (impact, pending, args):
            v = src.get(k) if isinstance(src, dict) else None
            if v not in (None, ""):
                return v
    return None

print("\n=== PROPOSAL AWAITING HUMAN APPROVAL ===")
print(f"  approval id  : {core.get('id') or pending.get('approvalId')}")
print(f"  command      : {core.get('command') or pending.get('command') or pending.get('tool')}")
print(f"  tool         : {pending.get('tool') or (pending.get('action') or {}).get('tool')}")
print(f"  action id    : {pending.get('actionId') or (pending.get('action') or {}).get('id')}")
print(f"  turn         : {pending.get('turn') or (pending.get('action') or {}).get('turn')}")
print(f"  agent        : {pending.get('agent') or (pending.get('action') or {}).get('agent')}")
print(f"  risk level   : {str(pending.get('riskLevel') or (pending.get('action') or {}).get('riskLevel') or impact.get('risk') or 'high').upper()}")
print(f"  reason       : {core.get('reason') or pending.get('reason')}")

src_i, dst_i = first("islandA", "island_a", "from"), first("islandB", "island_b", "to")
if src_i or dst_i:
    print(f"  source       : {src_i}")
    print(f"  destination  : {dst_i}")
topology = impact.get("resultingTopology") or (f"{src_i} <-> {dst_i}" if src_i and dst_i else None)
if topology:
    print(f"  topology     : {topology}   (after approval)")
pos = first("bridgePosition", "position")
if pos:
    print(f"  position     : {json.dumps(pos)}   (derived from the island pair)")
if impact.get("unlocks"):
    print(f"  unlocks      : {impact['unlocks']}")

cost = impact.get("cost") or {}
if cost:
    parts, afford = [], True
    for k, need in cost.items():
        have = res.get(k)
        if isinstance(have, (int, float)) and have < need:
            afford = False
            parts.append(f"{need} {k} (HAVE {have} -- INSUFFICIENT)")
        elif isinstance(have, (int, float)):
            parts.append(f"{need} {k} (of {have})")
        else:
            parts.append(f"{need} {k}")
    print(f"  cost         : {', '.join(parts)}")
    print(f"  affordable   : {'yes' if afford else 'NO'}")
else:
    # Say nothing was RECORDED -- never claim a command is free just because an
    # older approval record predates cost reporting.
    print("  cost         : not recorded in this approval record")

print(f"  irreversible : {impact.get('irreversible', True)}")
print(f"  permanent    : {impact.get('permanent', True)}")
print("  world clock  : FROZEN while this gate is open (approval does not race the sim)")

print("\n=== FULL AUTHORITATIVE IMPACT ===")
print(json.dumps(impact, indent=2, sort_keys=True))
print("\n=== AGENT-SUPPLIED ARGS (approval ids stripped server-side) ===")
print(json.dumps(args, indent=2, sort_keys=True))
print(f"\nTo decide:  scripts/approve-live.sh   |   scripts/reject-live.sh")
PY
