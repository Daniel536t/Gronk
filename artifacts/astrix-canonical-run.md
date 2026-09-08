# ASTrix Canonical Run — Core Evidence

> Deterministic 30-day run of ASTrix Core with **no TrueForge**. Reasoning: `local-astrix-steward`. Run id: `astrix-canonical-v1-30d` (seed `astrix-canonical-v1`). Generated 2026-09-08T22:32:11.738Z.

Every mutation below travelled the real command bus; every irreversible action stopped at the
structural approval gate until the human policy decided. Nothing here is scripted narrative —
the steward's proposals are whatever it derived from the authoritative snapshot that day.

## Verdict

| Property | Result |
|---|---|
| Outcome | **VILLAGE SURVIVED** (day 31) |
| Population | 4 → 4 |
| Food | 40 → 142 |
| Farms / bridges | 7 / 2 |
| Steward decisions | 61 |
| Proposals (high-risk) | 111 (5) |
| Approvals | 4 granted, 1 rejected |
| Executed / verified | 110 / 110 |
| Failed actions | 0 |
| Adaptations after refusal | 1 |
| Crops harvested | 39 |
| Villagers starved | 0 |
| Events recorded | 928 |
| TrueForge used | **NO** |
| Final state consistent | yes |

## Timeline

```
DAY 1   World initialized — population 4, food 40, 0 farms, farmland meadow 0/2 frost 0/2 dusk 0/1
DAY 1   Steward: build a farm on meadow
DAY 1   Steward: plant 3 wheat on farm-001
DAY 1   Steward: plant 3 wheat on farm-005
DAY 2   Steward: clear terrain near tree-meadow-001 to create farmland
DAY 3   Steward: clear terrain near tree-meadow-002 to create farmland
DAY 4   Steward: build a farm on meadow
DAY 4   Steward: plant 3 wheat on farm-011
DAY 5   Steward: clear terrain near tree-meadow-001 to create farmland
DAY 6   Steward: build a farm on meadow
DAY 6   Steward: plant 3 wheat on farm-016
DAY 6   Steward: build a bridge from meadow to frost
DAY 8   Steward: build a farm on frost
DAY 8   Steward: plant 3 wheat on farm-022
DAY 8   Steward: plant 3 wheat on farm-026
DAY 9   Steward: harvest 6 mature crop(s)
DAY 9   Steward: plant 3 wheat on farm-001
DAY 9   Steward: plant 3 wheat on farm-005
DAY 9   Steward: build a bridge from meadow to dusk
DAY 11  Steward: build a farm on dusk
DAY 11  Steward: plant 3 wheat on farm-038
DAY 12  Steward: harvest 3 mature crop(s)
DAY 12  Steward: plant 3 wheat on farm-011
DAY 14  Steward: harvest 3 mature crop(s)
DAY 14  Steward: plant 3 wheat on farm-016
DAY 16  Steward: harvest 6 mature crop(s)
DAY 16  Steward: plant 3 wheat on farm-022
DAY 16  Steward: plant 3 wheat on farm-026
DAY 17  Steward: harvest 6 mature crop(s)
DAY 17  Steward: plant 3 wheat on farm-001
DAY 17  Steward: plant 3 wheat on farm-005
DAY 19  Steward: harvest 3 mature crop(s)
DAY 19  Steward: plant 3 wheat on farm-038
DAY 20  Steward: harvest 3 mature crop(s)
DAY 20  Steward: plant 3 wheat on farm-011
DAY 22  Steward: harvest 3 mature crop(s)
DAY 22  Steward: plant 3 wheat on farm-016
DAY 24  Steward: harvest 6 mature crop(s)
DAY 24  Steward: plant 3 wheat on farm-022
DAY 24  Steward: plant 3 wheat on farm-026
DAY 2   APPROVAL GATE — clear_terrain (high risk) → human REJECT  → ZERO MUTATION
DAY 3   APPROVAL GATE — clear_terrain (high risk) → human APPROVE  → executed + verified
DAY 5   APPROVAL GATE — clear_terrain (high risk) → human APPROVE  → executed + verified
DAY 6   APPROVAL GATE — build_bridge (high risk) → human APPROVE  → executed + verified
DAY 9   APPROVAL GATE — build_bridge (high risk) → human APPROVE  → executed + verified
DAY 2   ADAPTATION — changed: steward kept the clear_terrain strategy but chose a different target (day 3) after the refusal
Day 2: human REJECTED clear_terrain — zero mutation (nodes 5, wood 26, meadow health 0.8 unchanged).
Day 3: human APPROVED clear_terrain — executed once and verified (nodes 5->4, wood 26->27, bridges 0->0).
Day 5: human APPROVED clear_terrain — executed once and verified (nodes 4->3, wood 25->26, bridges 0->0).
Day 6: human APPROVED build_bridge — executed once and verified (nodes 3->3, wood 24->21, bridges 0->1).
Day 9: season changed to SUMMER.
Day 9: human APPROVED build_bridge — executed once and verified (nodes 3->3, wood 17->14, bridges 1->2).
Day 17: season changed to AUTUMN.
Day 25: season changed to WINTER — crops stop growing and consumption rises 1.5x.
Day 31: season changed to SPRING.
DAY 31  Final state — population 4, food 142, spring, 7 farms, 2 bridges, 3 resource nodes
```

## Governance detail

### approval-009 — clear_terrain (day 2)

- Reason recorded by the bus: Terrain will be permanently cleared
- Impact bound to the approval: `{"position":{"x":12,"y":3.5,"z":24},"radius":2,"cost":{},"irreversible":true,"permanent":true}`
- Human decision: **REJECT**
- World before: nodes 5, wood 26, meadow health 0.8, bridges 0
- World after: nodes 5, wood 26, meadow health 0.8, bridges 0
- Mutated: **no** · executed: no · verified: no

### approval-010 — clear_terrain (day 3)

- Reason recorded by the bus: Terrain will be permanently cleared
- Impact bound to the approval: `{"position":{"x":30,"y":3.5,"z":36},"radius":2,"cost":{},"irreversible":true,"permanent":true}`
- Human decision: **APPROVE**
- World before: nodes 5, wood 26, meadow health 0.8, bridges 0
- World after: nodes 4, wood 27, meadow health 0.7000000000000001, bridges 0
- Mutated: yes · executed: yes · verified: yes

### approval-015 — clear_terrain (day 5)

- Reason recorded by the bus: Terrain will be permanently cleared
- Impact bound to the approval: `{"position":{"x":12,"y":3.5,"z":24},"radius":2,"cost":{},"irreversible":true,"permanent":true}`
- Human decision: **APPROVE**
- World before: nodes 4, wood 25, meadow health 0.7000000000000001, bridges 0
- World after: nodes 3, wood 26, meadow health 0.6000000000000001, bridges 0
- Mutated: yes · executed: yes · verified: yes

### approval-020 — build_bridge (day 6)

- Reason recorded by the bus: Bridge construction changes island connectivity
- Impact bound to the approval: `{"islandA":"meadow","islandB":"frost","cost":{"wood":3,"stone":1},"irreversible":true,"permanent":true,"bridgePosition":{"x":32.5,"y":4,"z":16},"resultingTopology":"meadow <-> frost","unlocks":"building and gathering on frost"}`
- Human decision: **APPROVE**
- World before: nodes 3, wood 24, meadow health 0.6000000000000001, bridges 0
- World after: nodes 3, wood 21, meadow health 0.6000000000000001, bridges 1
- Mutated: yes · executed: yes · verified: yes

### approval-036 — build_bridge (day 9)

- Reason recorded by the bus: Bridge construction changes island connectivity
- Impact bound to the approval: `{"islandA":"meadow","islandB":"dusk","cost":{"wood":3,"stone":1},"irreversible":true,"permanent":true,"bridgePosition":{"x":46.5,"y":3.35,"z":26},"resultingTopology":"meadow <-> dusk","unlocks":"building and gathering on dusk"}`
- Human decision: **APPROVE**
- World before: nodes 3, wood 17, meadow health 0.6000000000000001, bridges 1
- World after: nodes 3, wood 14, meadow health 0.6000000000000001, bridges 2
- Mutated: yes · executed: yes · verified: yes

## Reproduce

```bash
ASTRIX_RUN_DAYS=30 ASTRIX_RUN_SEED=astrix-canonical-v1 npm run astrix:canonical
```

Machine-readable evidence: `artifacts/astrix-canonical-run.json` (schema `astrix-canonical-run/v1`).
