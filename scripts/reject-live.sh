#!/usr/bin/env bash
# Human REJECTS the next live pending proposal, then verify the steward adapts
# instead of executing. This is the other half of the approval seam.
set -u
cd /home/ubuntu/ba

APPROVAL=$(curl -s -m 8 http://127.0.0.1:8787/astrix/agent/status \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); pa=d.get("pendingApproval") or {}; print(pa.get("approvalId") or "")')

if [ -z "$APPROVAL" ]; then
  echo "no pending approval to reject"
  exit 0
fi

echo "=== BEFORE: biome health + resource nodes ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/state \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("biomeHealth:", json.dumps(d["biomeHealth"])); print("wood nodes:", len([n for n in d["resourceNodes"] if n["type"]=="wood"]))'

echo
echo "=== HUMAN DECISION: reject $APPROVAL ==="
curl -s -m 15 -X POST http://127.0.0.1:8787/astrix/approval/respond \
  -H 'content-type: application/json' \
  -d "{\"approval_id\":\"$APPROVAL\",\"decision\":\"reject\"}" | head -c 300
echo

sleep 15

echo
echo "=== AFTER: did the world stay unchanged? ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/state \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("biomeHealth:", json.dumps(d["biomeHealth"])); print("wood nodes:", len([n for n in d["resourceNodes"] if n["type"]=="wood"]))'

echo
echo "=== STEWARD RESPONSE TO REJECTION ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/agent/status \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("state:", d.get("state"), " turn:", d.get("turn"))
for a in (d.get("actions") or [])[-4:]:
    print("  ", a.get("tool"), "exec=", a.get("executionState"), "err=", (a.get("error") or "")[:70])
for e in (d.get("lastEvents") or [])[-6:]:
    print("  evt", e.get("type"), json.dumps(e.get("data"))[:110])
'
