# W03 feedback fixes — owner check

About 10–15 minutes. Supplement to [the full W03 guide](./w03-check.md); this guide supersedes its old separate Quarry and wind-output instructions.

## Before you start

Use the main stack after W03 lands. The W03 demo was checked against the merged W08, W10 and W12 features, including construction, repair, dismantling, night power and the shared resource extractor.

- **Game:** [fresh W03 colony](http://127.0.0.1:5173/play.html?scenario=w03&skip=1)
- **Playground:** [model inspection](http://127.0.0.1:5173/playground.html?inspect=building.commandHub)
- **Backend:** [health](http://127.0.0.1:4001/v1/healthz), [readiness](http://127.0.0.1:4001/v1/readyz)
- **Checkout:** `/Users/ferretrec/work/TerraAgent` (main).
- Use the server-backed link above for this check. The earlier browser-local startup issue remains tracked as FF-80.
- Open the **in-game dev console** with the **backtick key (`)** under Esc. Enter commands one line at a time, press Enter, then close it with backtick. This is not browser DevTools.
- **B** opens Build; **U** opens Production; **Esc** cancels placement. Click **QUEUE** to watch construction.
- Start fresh after the merge: pre-landing W03 builder snapshots used a conflicting entity code (GP-79). Each reload of the scenario link creates a fresh colony. Keep the same tab for steps 1–8; step 9 deliberately starts fresh.

## 1. Prepare the colony and check the counters

Open the game link. Wait until terrain, units and buildings appear and the tick counter advances. Dismiss the stage announcement and close Goals to expose the map. This demo starts at Stage 2 so Builder and Pylon orders are unlocked.

In the in-game console enter:

```text
time day
fill all
warp 1
```

**Check:** stock totals and caps have four digits, such as `0500 / 0500`; hovering still gives the resource breakdown. The scenario starts with a Command Hub, Resource Extractor, Solar Array, HQ explorer and two Harvesters.

## 2. Reject placement visibly — including wind

1. Press **B**, choose **Solar Collector Array**, and move beyond the blue power area. `(9, 0)` is a verified invalid example.
2. Click the red ghost.
3. Repeat with **Wind Turbine**.
4. Press **Esc** when done.

**Check:** a toast says **“Cannot build here: outside the power zone”**. Nothing enters the queue. Moving back onto a valid flat tile inside the zone makes either ghost green. Wind also refuses occupied, obstructed and deposit-covered sites under the shared placement rules.

## 3. Make selection obvious

Click the existing extractor, then the Command Hub, then a unit.

**Check:** the selected model pulses orange, its ground ring fits its size, and its minimap marker is outlined. The previous object loses its highlight. Moving a selected unit should move its minimap marker with it.

## 4. Watch construction without job switching

1. Press **U** and queue a **Builder Drone**. Use `warp 10` until it appears, then `warp 1`.
2. Run `fill all` so resource shortages do not interfere with this check.
3. Press **B** and place a **Wind Turbine** on a green site; `(0, -4)` is a verified example.
4. Once a worker is building, place a **Capacitor Bank** on another green site; `(3, -3)` is a verified example.
5. Open **QUEUE** and watch both workers and progress bars at normal speed.

**Check:** a worker keeps its current build assignment instead of repeatedly changing sites. Each site's progress rises to completion without resetting. Walking to a new site after finishing is expected. Genuine resource/power shortages can still pause work.

Optional: use `warp 20` to finish the buildings, then return to `warp 1`.

## 5. Check cable attachments, flow and capacitor arcs

Inspect the completed buildings from different camera angles and zoom levels.

**Check:**

- Hub cables attach to its antenna; the extractor and other buildings use their upper terminals.
- Wind and capacitor connections meet solid terminals rather than empty space or the middle of the hull.
- Cables clear intervening roofs.
- Cyan supply pulses travel **Solar/Wind → relay**. Yellow demand pulses travel **relay → consumers**.
- Place a **Power Pylon** at `(4, -2)`. Its two wires animate in opposite directions: cyan supply toward the downstream pylon, yellow requests back toward the Hub.
- Run `time night`: the solar cable remains visible but its energy animation stops. Run `time day`: cyan solar pulses resume.
- The capacitor has electrical arcs between its three top terminals.

For an isolated model check, open the playground link and select Mine, Supply Depot or Coal Generator. Use **ISO / FRONT / SIDE / TOP** and **DUNE / OCEAN / FOREST**. Their new antenna mounts should remain connected and grounded.

## 6. Check all three wind levels

With the turbine completed, run the following commands one at a time. After each `setWind`, close the console briefly to watch the scene; reopen it for `power`.

```text
setWind 25
power
setWind 100
power
setWind 150
power
```

**Check:**

| Setting | HUD | Net output per completed turbine | Visible motion |
|---|---|---:|---|
| `25` | LOW 25% | 3 E/s | Slowest rotor and weakest wind response |
| `100` | MED 100% | 12 E/s | Normal rotor and wind response |
| `150` | HIGH 150% | 18 E/s | Fastest rotor and strongest wind response |

The colony's total supply also includes its other generators. Look at trees and a water surface while changing the level: their wind response should change with the turbine. These commands hold a manual override; step 9 checks natural wind separately.

## 7. Check the shared Resource Extractor

1. Press **B**: there should be one **Resource Extractor** card, with no separate Minerals Quarry card.
2. In the console run:

```text
spawndeposit -3 -3 minerals 1
fill all
```

3. Wait about one second for the deposit update to appear. Select Resource Extractor and place it over the new mineral deposit at `(-3, -3)`; use a green footprint covering that deposit.
4. Finish the construction, then return to `warp 1` and compare it with the original metal extractor.

**Check:** both use the same building type. The crystal/mineral extractor is violet-tinted and produces Minerals; the original produces Metals. Existing quarry entities in older saves remain supported.

## 8. Check 499 → 500 and stable header width

Wait until construction and unit production are finished. Keep the original metal extractor powered. Do not build a Supply Depot during this check, so the cap stays at 500.

Run:

```text
fill metals.t1 9
fill metals.t1 99
fill metals.t1 499
```

Pause briefly between commands to inspect the header.

**Check:** values read `0009`, `0099`, `0499` without changing counter width. Within a few seconds the working extractor reaches **`0500 / 0500`** and stops for the cap. It should not remain visually stuck at 499. Values above 9999 remain unabbreviated when a larger-cap setup permits them.

## 9. Check natural wind windows

Open a **fresh** [W03 scenario](http://127.0.0.1:5173/play.html?scenario=w03&skip=1), so the manual wind override from step 6 is gone.

Run `warp 1` and watch the wind indicator for several minutes.

**Check:** the level holds for three simulated minutes, then may pick LOW, MED or HIGH. Adjacent windows may pick the same level. For a faster check, `warp 20` makes each window roughly nine real seconds; finish with `warp 1`.

## Validation and reporting

The merged implementation passed 2,045 unit tests (one skipped), all 94 database integration tests, 20 contract tests, both client/server parity scenarios, repository checks and the production build. All 14 building archetypes passed with zero errors/warnings; all 48 validator self-tests passed. Model four-view checks were inspected across all three biomes.

Report the **step number**, what you expected, and what appeared instead. Keep the tab open if something fails so the scenario can be inspected.

Stack control from the main checkout:

```sh
npm run dev:restart
```

This restarts the backend only. `npm run dev` starts the complete stack when stopped. Current restart log: `/private/tmp/ta-main-stack.log`.
