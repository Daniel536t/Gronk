#!/bin/bash
# Witnessed causal run: proposal -> REJECT (no mutation) -> proposal -> APPROVE (mutation+verify) -> render.
# Uses ONLY real ASTrix control surfaces. Frontend never mutates.
set -u
BASE=http://127.0.0.1:8787
OUT=/home/ubuntu/ba/artifacts/witnessed-run
mkdir -p "$OUT"
say(){ echo "=== $*"; }

say "0. stop steward loop (freeze concurrent actor)"
curl -s -X POST $BASE/astrix/agent/stop -H 'Content-Type: application/json' -d '{"reason":"witnessed governance run"}' | tee "$OUT/00-stop.json"; echo

say "1. authoritative state BEFORE"
curl -s $BASE/astrix/state | tee "$OUT/01-state-before.json" | python3 -c "import json,sys; s=json.load(sys.stdin); print('day',s['day'],'bridges',s['bridges'],'approvals',len(s['pendingApprovals']))"

say "2. STEWARD proposal (high-risk build_bridge meadow->frost) via real command surface"
curl -s -X POST $BASE/astrix/command -H 'Content-Type: application/json' \
  -d '{"command":"build_bridge","island_a":"meadow","island_b":"frost"}' | tee "$OUT/02-propose1.json"; echo

say "3. state: AWAITING HUMAN (approval queued, zero mutation)"
curl -s $BASE/astrix/state | tee "$OUT/03-state-awaiting1.json" | python3 -c "import json,sys; s=json.load(sys.stdin); print('bridges',s['bridges'],'approvals',[(a['id'],a['command']) for a in s['pendingApprovals']])"

ID1=$(python3 -c "import json; print(json.load(open('$OUT/02-propose1.json'))['pendingApproval']['id'])")
echo "approval=$ID1"

say "4. human REJECT"
curl -s -X POST $BASE/astrix/approval/respond -H 'Content-Type: application/json' \
  -d "{\"approval_id\":\"$ID1\",\"decision\":\"reject\"}" | tee "$OUT/04-reject.json"; echo

say "5. verify NO mutation after reject"
curl -s $BASE/astrix/state | tee "$OUT/05-state-after-reject.json" | python3 -c "
import json; b=json.load(open('$OUT/01-state-before.json')); a=json.load(open('$OUT/05-state-after-reject.json'))
print('bridges before/after:', b['bridges'], a['bridges'])
print('approvals:', len(a['pendingApprovals']))
print('MUTATION-FREE:', b['bridges']==a['bridges'] and a['pendingApprovals']==[])
print('wood/stone:', a['resources']['wood'], a['resources']['stone'])"

say "6. second proposal (same pair)"
curl -s -X POST $BASE/astrix/command -H 'Content-Type: application/json' \
  -d '{"command":"build_bridge","island_a":"meadow","island_b":"frost"}' | tee "$OUT/06-propose2.json"; echo
ID2=$(python3 -c "import json; print(json.load(open('$OUT/06-propose2.json'))['pendingApproval']['id'])")
echo "approval=$ID2"

say "7. human APPROVE"
curl -s -X POST $BASE/astrix/approval/respond -H 'Content-Type: application/json' \
  -d "{\"approval_id\":\"$ID2\",\"decision\":\"approve\"}" | tee "$OUT/07-approve.json"; echo

say "8. verify mutation + verification evidence"
curl -s $BASE/astrix/state | tee "$OUT/08-state-after-approve.json" | python3 -c "
import json; r=json.load(open('$OUT/07-approve.json')); a=json.load(open('$OUT/08-state-after-approve.json'))
bid=r.get('bridgeId'); print('bridgeId:',bid)
print('in bridges[]:', any(b['id']==bid for b in a['bridges']), '(== orchestrator checkVerification rule)')
print('bridges:',a['bridges']); print('approvals:',len(a['pendingApprovals']))"

say "9. crop chain: build farm (low-risk) + plant wheat"
curl -s -X POST $BASE/astrix/command -H 'Content-Type: application/json' \
  -d '{"command":"build","building_type":"farm","island_id":"meadow","position":{"x":22,"y":0,"z":30}}' | tee "$OUT/09-build-farm.json"; echo
FARM=$(python3 -c "import json; print(json.load(open('$OUT/09-build-farm.json')).get('buildingId','') or '')")
echo "farm=$FARM"
curl -s -X POST $BASE/astrix/command -H 'Content-Type: application/json' \
  -d "{\"command\":\"plant\",\"farm_plot_id\":\"$FARM\",\"crop_type\":\"wheat\"}" | tee "$OUT/10-plant.json"; echo
curl -s $BASE/astrix/state | python3 -c "import json,sys; s=json.load(sys.stdin); print('crops:',[(c['id'],c['farmPlotId'],c['growthStage']) for c in s['crops']])" | tee "$OUT/11-crops.txt"

say "10. event log tail"
curl -s $BASE/astrix/log | python3 -c "import json,sys; e=json.load(sys.stdin)['events']; print(len(e),'events; last:',[(x['type']) for x in e[-8:]])" | tee "$OUT/12-log.txt"
say DONE
