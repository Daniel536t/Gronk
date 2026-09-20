# Deployment record — public rollout of the Gate D + Readiness release

RELEASE BUILD: gateD-readiness-20260919a (base 1609372ac1 + working tree;
ASSET_V 20260919a; manifest v1/55 assets; vitest 272/272).
Deployed: bundle built from the verified tree via scripts/build-three-observatory.sh
(default server/static = live root; static read per-request, no server restart needed;
no-cache + Last-Modified guarantees fresh bytes).
Byte proof: public main.js identical to verified build (29533 B, cmp IDENTICAL);
public manifest 55/55; staging-island.js served 200.

## Public smoke test (https://astrixx.duckdns.org, no staging flags, no writes)
- public-hero.png: 177 instances, causal EXACT vs live state
  (house-001/bridge-003/farm-004/storage-007/crop-005/pop 4 -> mirrored exactly),
  108 draws/302k tris, gate panel live ("clear"), zero failed requests, zero errors.
- public-overview-low.png: 69 instances, 108 draws/175k tris, clean.
- Grounding/composition/hero/overview/NPC/crop/stateful mirror: PASS (same release
  as seam-verified; composition byte-identical).
- Governance UI reaches real Core (live gate status renders). No approval actions
  taken on live (no operator key used): live reject/approve UI clicks NOT performed
  to avoid manufacturing irreversible live state. Reject->zero-mutation,
  approve->mutation, and reload-convergence were proven against the identical bundle
  in the isolated seam test (fresh backend). This is the explicit approved exception.

## Preserved ledger (unchanged by deployment)
Bamboo gap; llvmpipe FPS artifact; flat reef water; unidentified white posts;
2 by-design water rejects; deliberately retained low-poly facet colors.

PUBLIC DEPLOYMENT: PROVEN
