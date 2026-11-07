# State, sockets and presentation ownership

The current shared attack view is `state.blobs.insectActions.value.byEntityId[id]` with `state`, `startedTick`, `durationTicks` and `targetId`. The 5 Hz simulation drives idle, moving, windup, attack and recovery. Only active windup/attack/recovery records are replicated in this blob; absence returns the renderer to ECS-driven idle/moving. Never retain stale charge/recovery when an entry disappears. Read the implementation rather than duplicating its phase durations in a renderer. Local host, server and scene fixtures use the same action rules.

The renderer adds short hit reactions and a terminal dying/dead presentation after authoritative removal. A controller retains the latest action record, detects transitions by state plus start tick, and computes normalized phase between snapshots. Identical snapshots do not reset the phase. A late record should reconcile to its actual elapsed time, not replay a completed charge. A dying controller ignores later attack or movement messages.

| State | Readability requirement | Event / lifetime invariant |
| --- | --- | --- |
| idle | antenna probing, subtle breathing, planted legs | no charge/release loop; individual phase seed |
| moving | alternating tripod, coupled thorax suspension | driven by actual locomotion, not target existence |
| windup | jaw opening / horn loading / sac inflation | no damage or projectile before release |
| attack | clamp / horn contact / sac contraction | release and effects once, aligned to the sim event |
| recovery | recoil settles, mandibles relax, sac refills | cannot cause another hit |
| hurt | brief localized flinch | does not permanently lose the authoritative state |
| dying | buckle, lower, curl | no attack or walking; root remains sim-owned |
| dead | inert grounded silhouette | no living loops; finite corpse retention and one disposal |

`frontend/render/animation/insects/` owns the presentation state machine and closed-form insect poses. `BattlePresentation` consumes plain app-provided views and coordinates its insect adapter with weapon presentation. Apps bridge ECS state/event records into it. `render/` does not import sim internals.

`createArchetypeMesh` attaches the insect animator for supported insect archetypes. `tickArchetypeMesh` updates base shader clocks but must not advance the action controller a second time. Advance action time once per rendered frame; a paused preview supplies zero elapsed time. A shared corpse holder owns retained meshes after the entity leaves live app records, ensuring they still receive dying/dead uniforms before disposal.

Use the animator's world-space `socket('projectile', side)` for rear-sac emission and `socket('melee')` for jaw/horn diagnostics. Sockets use the same species pivots and action phase as the vertex shader. Sample after syncing the release state and orienting the root toward its sim target. Alternate sacs only if the sac pose and emitted side agree.

Geometry authored for an existing species can gain semantic part tags; keep anatomical selection explicit by authored names/tags instead of broad coordinate heuristics. Preserve the coupled leg attachment and keep deformation limited to declared tissue. State uniforms belong in visible and depth materials with distinct shader program cache keys. Normal transforms must follow the pose too.

Pool liquid effects. Validate composition, contrast, bounce and instance/triangle budgets using the same registry as other particles. A contact-plane approximation and flat terrain bounce are presentation constraints, not 3D gameplay collision. Never implement a second damage pass in a work handler or preview loop to make attacks appear effective.

## Extending beyond the existing three species

The current renderer has explicit species tables and anatomical pivots, and the shared action union enumerates implemented phases. A new insect or phase such as emergence requires extending the shared action types/timing and renderer rig tables, CPU poses, shader chunks, sockets and parity tests together; registry registration alone is insufficient. Keep those extensions in the existing composition points rather than an independent preview animator.

For intentional burrowing or emergence, author and test a state-specific below-ground envelope. Preserve ordinary ground-contact checks for idle, walk, contact and the final corpse; do not globally weaken their thresholds to accommodate an underground state.


## Sac alternation and inertia

The controller counts distinct observed attack timestamps, alternates its emission side once per release and exposes that selection through `emissionSide` and `uInsectSacSide`. Sample the animated top-of-sac socket; never derive left/right from tick parity (an even cadence would keep firing one side). Snapshot plus event delivery for the same release must not toggle twice. New presentation instances start left; this is cosmetic, not replicated combat state.

Charge/recovery scalar responses retain velocity across state boundaries using an exact critically damped step. Keep release/contact tied to the event; ease the return instead of resetting the pose when recovery ends. Blend gait back as the attack displacement settles. Validate mixed charge/strike and walking/recovery combinations as well as isolated states.

The spitter's selected secretory sac now has an explicit 20.5% maximum expansion and 12.5% maximum contraction envelope, with a reduced pulse on the inactive sac. These replace the earlier 13.5% insect-action envelope, not the legacy 1.8% hive-gland channel. Other rigid or flexible parts keep their existing limits. Sweep both sides and verify visible/depth/CPU transforms together.
