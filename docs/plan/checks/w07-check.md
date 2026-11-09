# W07 — First Contact (hive fauna + battle v1): owner check

> The wave's demo story ([`waves/W07-first-contact.md`](../waves/W07-first-contact.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 12 minutes.

## Before you start

- **Where it runs:** branch `wave/w07-first-contact`, worktree `../TerraAgent-wt/w07`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4100` → app **4101**, client **5273** (`TA_DB_NAME=terra_wave_w07_first_contact`). Below, `<client>` = `http://127.0.0.1:5273`, `<app>` = `http://127.0.0.1:4101`.
- **Wave scope:** the game URLs below include `waves=..07`. A scenario supplies starting state; it does not disable later waves. Enabling W08 also enables autonomous building, which can occupy the scripted construction sites. Test the AI demand follow-up separately at `<client>/play.html?scenario=w08&waves=..08`.
- **After this update:** refresh an already-open game tab after restarting the backend. Current clients show **Game updated. Reload to continue.** on a version mismatch; the Reload button rejoins the current scenario planet. Version-2 saves with matching balance data and wave flags migrate without a reset.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w07 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Second browser / reconnect:** run `planet b` in the first game's dev console and open its printed `?join=<planetId>&as=b` link in a second browser profile. Opening `?scenario=w07` again creates another scenario planet; use the join link to compare one shared world.
- **3D Playground:** open `<client>/playground.html?inspect=bug.blackAnt` (or `bug.blueBeetle`, `bug.greenSpitter`, `hive.blackAnt`, `hive.blueBeetle`, `hive.greenSpitter`) for the 4-view model audit, and `<client>/playground.html?faunaScene=mixed&faunaSeed=7` for the live hive-life scenes.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Neutral species hives and playground hive-life scenes.**
   - **Where:** open `<client>/play.html?scenario=w07&waves=..07`, then `<client>/playground.html?faunaScene=mixed&faunaSeed=7`.
   - **How:** on `<client>/play.html?scenario=w07&waves=..07`, inspect the top resource bar (`0500 / 0500` Metals/Minerals/Bio, **`7 / 10`** supply, `0800 / 0800 E`) and the bottom-left minimap showing your Stage 3 colony at `(0, 0)` with remote species-specific hives initially hidden by fog 30 tiles away (`blackAnt` at `(30, 0)`, `blueBeetle` at `(-15, 30)`, `greenSpitter` at `(-30, 15)`). Send a Recon within sight of each hive to reveal its model and map marker; panning alone must not reveal it. After the scout leaves, the terrain stays explored but darkens and hostile markers disappear. run `warp 10` in the dev console (`` ` ``) for a few seconds, then `warp 1`. Next, open `<client>/playground.html?faunaScene=mixed&faunaSeed=7` and try the **HIVE-LIFE FIXTURES** buttons (`ANT HIVE`, `BEETLE NEST`, `SPITTER HIVE`, `MIXED`, `MODE: PASSIVE` / `AGGRESSIVE`, `PAUSE`, `+1 STEP`, `RESET`, `ACID PREVIEW`), and inspect the six archetypes in the left sidebar (`bug.blackAnt`, `bug.blueBeetle`, `bug.greenSpitter`, `hive.blackAnt`, `hive.blueBeetle`, `hive.greenSpitter`).
   - **See:** in `/play.html?scenario=w07&waves=..07`, bugs wander and tend their hives passively and neither side auto-attacks (all HP stays full). In `/playground.html?faunaScene=mixed&faunaSeed=7`, the **HIVE-LIFE FIXTURES** panel shows `NEUTRAL`, `POP 17 / 21`, and three live hive rows (`hive:blackAnt`, `hive:blueBeetle`, `hive:greenSpitter`); `ACID PREVIEW` launches a green parabolic acid glob with splash VFX; all six bug/hive models show `ground contact ✔` and `< 3.5k` triangles across all four views (`ISO`, `FRONT`, `SIDE`, `TOP`).
2. **Build Robotics Factory T1 and produce 3 Recon Armored Scouts to the rally flag.**
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → Command Dock (bottom left) → **BUILD `[B]`** tab, then **PRODUCTION `[U]`** tab.
   - **How:** open the dev console (`` ` ``) and run `warp 10`. In **BUILD `[B]`**, click **ROBOTICS FACTORY** (`3×3`, `120 Metals · 70 Minerals · 30 Biomass · 20 Water`) and place it on the prepared pad northeast of the Hub at `(4, -3)`. Wait ~8 s for the builders to finish it. Switch to **PRODUCTION `[U]`**: the **ARMY** section appears with **RECON ARMORED SCOUT** (`Supply 1`, `14s`, `35 Metals · 15 Minerals · 5 Water`) and **SET RALLY POINT**. Click **SET RALLY POINT**, click tile `(7, -2)` on the map, then click **QUEUE** on the Recon Armored Scout card 3 times (or set batch `+` to `3` and click **QUEUE**).
   - **See:** the rally readout updates to `(7, -2)` with a 3D rally flag on the map, the **FACTORY QUEUE** shows the Recon orders progressing one by one, 3 Recon Armored Scouts roll out of the Robotics Factory to `(7, -2)`, and the top HUD supply counter climbs from **`7 / 10`** to **`10 / 10`**.
3. **Supply cap block (`supply_cap`) at 10/10 and Drone Control Array (+8 cap → 18).**
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → **PRODUCTION `[U]`** tab and **BUILD `[B]`** tab.
   - **How:** at `10 / 10` supply, inspect the Recon Armored Scout card in **PRODUCTION `[U]`** (or run `enqueueTask` for a 4th Recon). Then refill resources in the dev console (`fill all`), switch to **BUILD `[B]`**, select **DRONE CONTROL ARRAY** (`1×1`, `+8 Supply`, `-5 E/s`), and place it at `(2, -3)`. Once it finishes, switch back to **PRODUCTION `[U]`** and click **QUEUE** on **RECON ARMORED SCOUT**.
   - **See:** at `10 / 10` supply, the Recon **QUEUE** button is disabled with the inline supply-cap reason (`Supply cap reached — build a Drone Control Array`) and any `buildUnit` command is rejected with `supply_cap` (toast: `Supply cap reached — build a Supply Depot`). As soon as the Drone Control Array at `(2, -3)` finishes, the top HUD supply counter reads **`10 / 18`**, the block clears, and the 4th Recon Armored Scout builds and rolls out (`11 / 18`).
4. **Autocannon and Laser Tower T1 range & view rings + `Alt` overlay.**
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → **BUILD `[B]`** tab and the 3D viewport.
   - **How:** in **BUILD `[B]`**, select **AUTOCANNON TURRET** (`1×1`, range 8) and place it on the eastern defense line at `(6, -1)`; select **LASER TOWER** (`1×1`, unlocked at S3, range 9) and place it at `(6, -2)`. Close the dev console (`` ` ``) once both finish. Click the Autocannon at `(6, -1)`, then click the Laser Tower at `(6, -2)`. Finally, hold the **`Alt`** key.
   - **See:** while placing a turret ghost, its weapon range ring previews in orange. Clicking the finished Autocannon or Laser Tower selects it in the bottom bar and renders its **solid orange weapon range ring** (8 tiles = 16 m for Autocannon; 9 tiles = 18 m for Laser Tower) and **dashed white view ring** (5 tiles for either turret). A scout must spot targets between turret sight and weapon range. Holding **`Alt`** renders the range and view rings for all of your colony's units and turrets simultaneously in one instanced draw call.
5. **Bounded species raid, under-attack alert ping, turret tracers/beams, HP bars, and corpse removal.**
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → dev console (`` ` ``), top-right **COMBAT LOG**, and eastern turret line.
   - **How:** in the dev console run `spawnRaid blackAnt 3` (and `warp 5` or `warp 10` to speed their march from the eastern `blackAnt` hive at `(30, 0)` to your colony). Watch the ants enter turret range around `(6, -1)` and `(6, -2)`.
   - **See:** `Raid incoming (blackAnt) [30, 0]` appears in the top-right **COMBAT LOG** along with a red **`RAID INCOMING`** / **`UNDER ATTACK`** alert ping on the screen edge (clicking the ping pans the camera to the action). When the ants reach the turrets, the Autocannon fires yellow bullet tracers and the Laser Tower fires instant glowing beams; damaged units show overhead 3D **HP bars**; killed ants are removed from the world.
6. **Demo artillery parabolic shells, stationary armored scouts, AoE impacts, and `hitDebug on`.**
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → dev console (`` ` ``) and eastern hive approach `(22, 0)`–`(30, 0)`.
   - **How:** in the dev console run:
     ```text
     hitDebug on
     spawnUnit recon 24 0 3
     spawnUnit demoArtillery 22 0 2
     ```
     Pan the camera east to `(26, 0)` so the spawned Recons, artillery, and black ants near `(28, 0)` are in view. Select the spawned units (or right-click an ant at `(28, 0)` to attack). The owner-requested armored scout now holds position while firing. Move orders still use normal ground paths.
   - **See:** `hitDebug on` enables the 3D hit-debug overlay (aim-point crosshairs and AoE splash circles). The `demoArtillery` units lob high parabolic shells (`projSpeed: 4` tiles/s, `aoe: 1.5`) that leave smoke trails and detonate at the aim point with an orange AoE ground ring decal after their flight time ends; stationary targets take full/splash damage. A target moved away before impact can evade a slow shell; scouts no longer automatically strafe.
7. **Colony-scoped hive provocation and destroying a hive (`nestDestroyed`).**
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → eastern `blackAnt` hive at `(30, 0)`.
   - **How:** in the dev console run `spawnUnit demoTank 27 0 6`, select your combat units near `(24, 0)`–`(27, 0)` (click / Shift-click, or press **`A`** and left-click the `blackAnt` hive at `(30, 0)`, or right-click the hive directly) and run `warp 10` until the hive's `1 500 HP` drops to `0`.
   - **See:** attacking the `blackAnt` hive provokes **only** that hive against your colony (the `blueBeetle` hive at `(-15, 30)` and `greenSpitter` hive at `(-30, 15)` remain passive). When the hive reaches `0 HP`, it is removed, its resident replenishment and future waves stop permanently, and the **COMBAT LOG** records **`Fauna nest destroyed [30, 0]`** (`nestDestroyed` / Nest Breaker progression fact).
8. **Repel a raid with zero buildings lost → `raidRepelled (Unbreached)`.**
   - **Order:** perform this before destroying the black-ant hive in step 7; a destroyed hive cannot launch another raid.
   - **Where:** `<client>/play.html?scenario=w07&waves=..07` → top-right **COMBAT LOG**.
   - **How:** with your Autocannon and Laser Tower defending the colony (or after steps 4–5), run `spawnRaid blackAnt 3` in the dev console and let the turrets eliminate the raiding cohort without losing any colony building.
   - **See:** once the last raider dies with 0 colony buildings destroyed, the **COMBAT LOG** displays a green entry: **`Raid repelled (Unbreached)`** (`raidRepelled { unbreached: true }`, incrementing Unbreached achievement progress).
9. **Second browser / mid-wave reconnect parity and directive sync.**
   - **Where:** the original scenario tab and a second browser profile joined with `?join=<planetId>&as=b` via the dev console `planet b` command, plus automated parity suite `tests/e2e/parity/w07-fauna-parity.spec.ts`.
   - **How:** in tab 1's dev console run `planet b` and copy the printed `?join=<planetId>&as=b` URL, then trigger a wave with `spawnRaid greenSpitter 3` (its hive survives step 7). Open that join URL in the second profile while the wave is active, then reload it during combat.
   - **See:** both tabs show identical hive positions, species, active raiders, HP bars, and combat impacts, driven by versioned `FaunaDirectiveV1` packets and sparse corrections rather than per-tick transform streams.
10. **Building destruction leaves a Prepared pad.** *(3-second rubble collapse VFX `W07-23` is `H+` / deferred per the wave's Hackathon slice; the building transitions directly to its Prepared pad.)*
    - **Where:** `<client>/play.html?scenario=w07&waves=..07` → Capacitor Bank at `(-2, -3)` and dev console (`` ` ``).
    - **How:** click the Capacitor Bank at `(-2, -3)` to see its entity `#<id>` badge in the bottom selection bar (e.g. `#9`), then run `damage 9 100` in the dev console.
    - **See:** the Capacitor Bank is destroyed and removed at once, the **COMBAT LOG** shows **`Building lost: capacitor [-2, -3]`**, and its `2×2` footprint tiles at `(-2, -3)` become **Prepared** ground ready for immediate rebuilding.
11. **Wave flag gate (`waves=..06`).**
    - **Where:** `<client>/play.html?scenario=w03&waves=..06`.
    - **How:** open the URL and check the **WAVES** panel (top right) and **BUILD `[B]`** menu.
    - **See:** only `W00`–`W06` are lit; there are no insect hives or bugs, no Robotics Factory / Autocannon / Laser Tower cards in the Build menu, and no Combat Log HUD.

## Automated checks

See [the current review report](../../coverage/w07-review-2026-11-06.md#verification) for exact final results, counts, failed attempts and reruns. The gate set includes check/build, all workspace tests, integration/contract/parity, both server and local W07 browser stories, earlier-wave regressions, model/particle validation and the isolated simulation benchmark.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 07`. It re-runs the gates, merges W07 into `main`, tags `wave-07`, pushes, and removes the W07 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.

## Combat Lab and armored scout check (2026-11-07)

1. Open http://127.0.0.1:5273/play.html?scenario=w07&waves=..07 and click **COMBAT F6** (or press F6). F8 still opens the visual lab.
2. Select **Recon Armored Scout**. Edit Maximum health, Damage / hit, Rate / second or Range, then use that field's **APPLY**. Existing scouts retain their health percentage; changes apply to every scout on this planet. Range rings follow the new range. Test **EXPORT JSON** to copy balance overrides.
3. Close the panel, select a scout and move it near a hive. It has six wheels, an armored hull, an independently aiming cannon turret and twin antennas. In weapon range it holds position and fires instead of dodging; normal movement still follows orders and ground paths.
4. Inspect the model at http://127.0.0.1:5273/playground.html?inspect=robot.recon and use keys 1–4 for iso/front/side/top. Expect 2,652 triangles, ground contact and zero validator issues.

Visual evidence: [scout iso](../../visuals/evidence/recon-armored/recon-iso.png), [front](../../visuals/evidence/recon-armored/recon-front.png), [side](../../visuals/evidence/recon-armored/recon-side.png), [top](../../visuals/evidence/recon-armored/recon-top.png), [Combat Lab](../../visuals/evidence/recon-armored/combat-panel.png). Robot category validation: 5/5 clean; validator self-tests: 57/57.

Combat Lab browser checks passed on local and server hosts (damage, health, range and rate), with no page errors. See the current review report for the repository-wide verification results. Tuning scope/limits are recorded in GP-91; the side-on melee preview in RN-78.

## Review regression checks (2026-11-07)

1. Open http://127.0.0.1:5273/play.html?scenario=w07&waves=..07. Select a turret: the weapon ring extends beyond the dashed sight ring. Targets outside all colony sight remain hidden and cannot be acquired/fired upon. Move a scout toward them to provide spotting.
2. Select a moving scout. Its selection and sight indicators follow its rendered pose smoothly. Newly visited terrain becomes explored; areas outside current colony sight re-shroud. Unseen hives do not appear on the minimap.
3. Press **F6**, change scout sight/weapon range, and apply. The selected ring, minimap visibility and 3D vision reflect the same host settings. Change a hive’s maximum HP: its health fraction is preserved and tuning alone does not provoke it.
4. For reconnect, open the dev console with **`**, run `planet b`, and use the printed join URL in another browser context. Run `spawnRaid greenSpitter 3` in the original tab and reload the join tab during the fight. Both views recover the same hive/cohort/HP state. The automated test additionally compares matching ticks and pending acid impacts.
5. Open http://127.0.0.1:5273/playground.html?faunaScene=mixed&faunaSeed=7. Use views **1–4** and all three biomes. Swarms retain their species appearance, animation, shadows and ground contact with species batching enabled.

The original H+ footprint refits, building-collapse VFX and duel harness remain deferred; see the review comparison before landing the full uncut wave. Changes are uncommitted until explicitly staged and committed; running the landing command is an owner action.
