#!/usr/bin/env bash
# Human APPROVES the live pending proposal, then verify the world actually changed.
set -u
cd /home/ubuntu/ba

echo "=== BEFORE: bridges in authoritative state ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/state \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("bridges:", json.dumps(d.get("bridges"))); print("wood:", d["resources"]["wood"])'

echo
echo "=== HUMAN DECISION: approve approval-001 ==="
curl -s -m 15 -X POST http://127.0.0.1:8787/astrix/approval/respond \
  -H 'content-type: application/json' \
  -d '{"approval_id":"approval-001","decision":"approve"}' | head -c 300
echo

sleep 12

echo
echo "=== AFTER: bridges in authoritative state ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/state \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("bridges:", json.dumps(d.get("bridges"))); print("wood:", d["resources"]["wood"]); print("connectivity:", json.dumps([(i["id"], i["connectivity"]) for i in d["islands"]]))'

echo
echo "=== AGENT LIFECYCLE AFTER APPROVAL ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/agent/status \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("state:", d.get("state"), " turn:", d.get("turn"))
for a in (d.get("actions") or [])[-6:]:
    print("  ", a.get("tool"), "risk=", a.get("risk"), "exec=", a.get("executionState"), "verified=", a.get("verified"))
for e in (d.get("lastEvents") or [])[-8:]:
    print("  evt", e.get("type"), json.dumps(e.get("data"))[:110])
'
