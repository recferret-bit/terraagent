# Progression, tutorial goals and priorities — delivery contract

Owner-requested W08 follow-up (2026-11-03). This is a landing requirement for the waves below, including their hackathon slices. A tutorial card is a promise of executable gameplay, not just a target label.

## Runtime contract

- Stage browsing is read-only: Previous / Next / a stage segment opens its guide. It never reduces earned unlocks, changes threat, refunds costs or resets the world. Newly reached stages show a visible 30-second countdown; manually reopened guides stay until dismissed. Hide / Show preserves access to the guide.
- One HQ panel contains Goals and Priorities tabs. The five sliders are **economy, expansion, defense, power, terraform**. They affect ranked autonomous decisions; they are not completion percentages. Display the resulting action and reason. Safety floors, explicit player orders, diplomacy permissions and spending limits take precedence.
- Goal kinds have an executor registered with `registerGoalExecutor`. Without one, the option is disabled and the sim rejects it; enabling a wave flag alone does not make it executable. Register in the owning sim module, with shared capability metadata for UI availability and wave gating.
- An accepted goal creates real queue/unit commands using existing placement, pathfinding, payment and worker systems. No direct position writes, invented income, free deposits, pretend production or completion from unit counts. Progress and completion read authoritative outcomes. Distinguish a total rate target from an increase over baseline.
- Every active goal reports its current action, child orders, measured progress and actionable wait reason (resources, power, storage, site, reachability, supply, permission or unavailable feature). Queued goals identify the active predecessor. Failed enqueue calls cannot disappear silently. Restored unsupported goals explain the missing capability and allow cancellation.
- Goal harvesting steers automatic workers toward its resource without overwriting saved player priorities or manual assignments. Resource variants must target the exact resource/tier, including Water versus Biomass, and restore normal choices on cancellation/completion.
- Secure Power must verify the requested net output during actual night from the shared solar clock. Solar nameplate output is not night output. W03 must supply the night generator/storage executor integration before a positive night tutorial target can complete.
- Tutorial suggestions derive from the shared stage/goal catalog, include executable parameters and a next step, and resume after reload. Completed suggestions do not reappear as new tasks. Preview-only content is labelled with its owning wave and cannot be accepted.

## Stage and wave ownership

| Stage / feature | Owning waves | Required playable lesson and priority effects |
|---|---|---|
| S0 Landing | W01, W08 | Establish Colony: prepare, Hub, extractor, power; show each child order. |
| S1 First Light | W02, W08 | Grow Metals: build or assign production and reach measured units/min; economy steers output and procurement. |
| S2 The Grid | W03, W08 | Storage, grid reach, workers and night power. Complete Secure Power at night; power steers generator/capacitor/pylon work. |
| Terrain / exploration | W04, W05, W27 | Discover viable sites, clear/reclaim a target, expand a canonical sector. Terraform and expansion steer separate queues; explain unreachable sites. |
| S3 First Contact | W07, W08 | Defend Area and Clear Nest: train/dispatch through units runner, protect workers, observe outcome; defense changes protection allocation. |
| S4 Neighbor | W10, W13, W18, W27 | Expand Toward and Negotiate Supply: discover a neighbor, claim/connect a site, deliver/trade supply. Expansion and economy affect choices and budgets; defense affects escorts. |
| Away continuity | W09 | Resume active goal and tutorial, preserve slider state and wait reasons; away spending/raid settings constrain every action. |
| Profile continuity | W12 | Persist UnlockStage and lesson completion; keep current-world ThreatStage separate. |
| Fortification | W14 | Defend goal builds real coverage, walls and repair work; defense/power priorities choose supported orders. |
| Guild / director | W15, W16 | Guild and AI proposals consume the same priorities/goals and permission checks, not parallel automation; economy/defense guide supplies and assistance. |
| S5 Industrial | W17 | Tech Up: authorize and pay Hub T2 plus supporting power/production; sliders alone never authorize tier upgrades. |
| S6 Frontier | W17, W18 | Terraform Zone and Build Army: terrain access, counters, supply and unit production; defense/terraform shape the plan. |
| S7 Siege | W17, W18 | Fortify, counter siege and stage an explicitly authorized raid. Defense changes forces/escorts; economy affects resupply; expansion affects objectives. |
| Diplomacy | W18 | Negotiation, truces, retaliation and raid planning use priority-weighted policy. Sliders never break a truce or authorize aggression. Show rejected/blocked reasons. |
| S8 Air / S9 Orbital | W19 | Anti-air, reconnaissance, Hub T3 and uplink lessons; defense and power feed real coverage and infrastructure decisions. |
| Colony transfer | W20 | Transfer/reset authority for active goals and tutorials; old owner cannot issue actions after deed transfer. |
| S10 Rocket | W21 | Prepare Rocket child stages, fuel and telemetry; economy/power/defense affect preparation. Explicit launch remains mandatory. |
| Treasury / mercenaries | W22 | Economy/defense change funding/hiring proposals within explicit budgets and away permissions. |
| Real chain / mobile / release | W23, W24, W25 | Same executable goals under real adapters; touch-accessible guide replay/tabs; full progression smoke gate. |

## Required evidence before each owning wave lands

1. Start from the previous playable lesson, accept the new tutorial goal, observe real commands and reach its completion condition without dev completion overrides.
2. Test blocked then resumed work, cancel/reorder, reload/reconnect, and no-target cases. Demonstrate that no task is duplicated and no resources are fabricated.
3. With identical seeded state, change each relevant slider low/high and assert a different supported ranked decision or an explicit safety/permission reason for unchanged behavior. Test truce, player precedence, budget and wave-off boundaries.
4. Verify stage triggers, dwell and overrides from actual world outcomes; replay old lessons without altering unlocks/threat. S5–S10 content must extend this flow rather than introducing a separate tutorial.
5. Run on both local and server hosts, with later waves disabled. Add executable sim and browser regressions, and extend the wave owner check guide with precise URLs, actions, expected orders, progress and completion.

W08 currently runs on W00/W01/W02/W06 mechanics. Its S0–S4 stage metadata does not provide the missing W03/W07/W10 mechanics, and S5–S10 previews do not enable their waves. The later waves above own those implementations; they must not land with decorative goal cards.
