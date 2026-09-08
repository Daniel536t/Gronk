#!/usr/bin/env bash
# Operator STARTS a live steward run (the missing sibling of approve-live.sh /
# reject-live.sh / poll-steward.sh).
#
# WHY THIS IS AN OPERATOR SCRIPT AND NOT AUTOPILOT: ASTrix never starts a run by
# itself. The world clock is gated on a live run (src/server/worldClock.ts), so
# starting a run is the act that makes world time advance. That is a human
# decision, taken here explicitly.
#
# AUTHORITY: loopback is the operator channel. With ASTRIX_API_KEY unset the
# server authorizes consequential routes only for direct, unproxied loopback
# requests (src/astrix/server.ts authorizeWrite); public traffic arrives through
# Caddy with X-Forwarded-For and is refused 401.
set -u
cd /home/ubuntu/ba

OBJECTIVE="${1:-Keep the Observatory fed and growing: secure the food supply first, then expand shelter.}"

echo "=== BEFORE ==="
curl -s -m 8 http://127.0.0.1:8787/astrix/agent/status \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("steward:", d.get("state"), "turn", d.get("turn"))'
curl -s -m 8 http://127.0.0.1:8787/astrix/state \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("day:", d["day"], d["season"], "pop:", d["population"], "food:", d["food"])'

echo
echo "=== OPERATOR DECISION: start a run ==="
curl -s -m 20 -X POST http://127.0.0.1:8787/astrix/agent/start \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"objective": sys.argv[1]}))' "$OBJECTIVE")"

echo
echo
echo "=== AFTER (the clock should now be running) ==="
sleep 3
curl -s -m 8 http://127.0.0.1:8787/astrix/agent/status \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("steward:", d.get("state"), "turn", d.get("turn"))'
curl -s -m 8 http://127.0.0.1:8787/astrix/state \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("day:", d["day"], d["season"], "pop:", d["population"], "food:", d["food"])'
echo
echo "Now watch it: ./scripts/poll-steward.sh"
