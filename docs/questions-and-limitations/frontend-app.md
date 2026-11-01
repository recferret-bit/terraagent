# Frontend app: game client shell

Known gaps, deliberate trade-offs and open questions in the `/play.html` client shell: `frontend/game/{app,store,net,core,dev,descent}`,
`frontend/game/main.ts` and `frontend/index.html` (online session, boot flow, WorldStore / replica / prediction, local hosts,
transports, dev console wiring). Entry format: [README](./README.md). Ledger journal limits are in [`economy-ledger.md`](./economy-ledger.md).

## Online session lifecycle

### FA-01 · The access token is never renewed, so an online session ends about 15 minutes after boot

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED (traced client and server; not reproduced in a browser)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:122-124` (guest `bootTarget`), `:292-300` (`resolveBootTarget`), `frontend/game/net/WsTransport.ts:92-109,157-172`, `frontend/game/net/closeCodes.ts:15-17`; server `backend/app/src/ws/connection.ts:129-139` (`armExpTimer`), `backend/app/src/core/auth/auth-token.service.ts:5` (`ACCESS_TOKEN_TTL_S = 900`); `docs/spec/PROTOCOL.md` LB-02, `docs/spec/CLIENT.md:190-192`
- **What happens:** the server closes the socket with `4003 forbidden` at the access token's `exp` (15 min) unless a `reauth` arrived first. The client never sends `reauth` (no `reauth` in `Outgoing`, `net/types.ts:22-26`). `forbidden` maps to `reconnect-once`, the transport calls `target.resolve()`, and `resolveBootTarget` returns the cached `{ planetId }` because `bootResult` is already set, so `bootTarget.accessToken` is still the expired token. The second hello fails `verify` ("Access token expired") → another `4003` within 30 s → `terminal`, banner "Couldn't join colony". The same happens to any reconnect (server restart, Wi-Fi drop) later than 15 min after boot. The `tryRefresh` branch of `bootAuthAndHome` is only reached when `bootResult` is still empty, i.e. never on a reconnect.
- **Why it is like this:** W01 built guest auth and the boot flow; token lifetime on a long-lived socket was not wired.
- **Workaround / mitigation:** reload the page (a new guest login with the same device secret gets a new token). Dev `?scenario=`/`?join=` flows use `dev:<name>` tokens, which do not expire.
- **To resolve:** before `exp` call `POST /v1/auth/refresh` and send `reauth`; in `resolveBootTarget` refresh the token whenever the last close was `4000/4003` (CLIENT §6.3 "refresh the token, then re-resolve"). Add a WsTransport spec for "forbidden → fresh token on the retry".
- **Found:** 2026-11-01, frontend-app review

### FA-02 · Disposing the session while the guest boot is in flight restarts the socket and leaks listeners

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (traced)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:160-161,268-290` (`startBootSequence`), `:482-498` (`dispose`), `frontend/game/net/WsTransport.ts:61-74`
- **What happens:** `startBootSequence` awaits `bootAuthAndHome` (two HTTP calls). If `dispose()` runs meanwhile (Esc → Return to orbit, `Game.teardownSession`, HMR), it runs `cleanups` and `transport.stop()`. When the await returns, the method continues on the disposed session: it pushes a new `store.onView` listener into `cleanups` (never run again), may `attachLocalHost` (starting a `setInterval` that nobody clears), and calls `this.transport.start()`. `WsTransport.start()` only returns early when `!stopped`; after `stop()` `stopped` is true, so it connects again and keeps reconnecting with backoff forever, with no owner.
- **Why it is like this:** the boot sequence has no "disposed" guard.
- **Workaround / mitigation:** none; the leak lasts until the page reloads.
- **To resolve:** set a `disposed` flag in `dispose()` and return from `startBootSequence` (and the `onState` fallback) when it is set; consider making `WsTransport.start()` after `stop()` explicit (e.g. a `disposed` state that refuses to start).
- **Found:** 2026-11-01, frontend-app review

### FA-03 · `dispose()` stops but never terminates the `?host=local` worker

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:126-128,493`, `frontend/game/net/LocalTransport.ts:49-58`, `frontend/game/net/LagTransport.ts:63,67`, `frontend/game/store/local/LocalHostCore.ts:274-293`
- **What happens:** the session calls `transport.stop()`, not `dispose()`. For a `LocalTransport` this posts `stop` (the core saves and stops stepping) but `link.dispose()` (`worker.terminate()`) is never called, so each Return to orbit from `?host=local&scenario=…` leaves an idle Worker holding a whole `SimHost`. With `?lag=`, `LagTransport.dispose()` (which unsubscribes from the inner transport) is not called either.
- **Why it is like this:** `Transport` has no `dispose`; only `stop`.
- **Workaround / mitigation:** a page reload frees them.
- **To resolve:** add an optional `dispose()` to `Transport` and call it from `OnlineSession.dispose()`. Note: `LocalHostCore.save()` is fire-and-forget (IndexedDB), so terminating right after `stop` can drop the final save; terminate after the host confirms the save (or delay the terminate).
- **Found:** 2026-11-01, frontend-app review

### FA-04 · Unmounting before the dynamic import resolves leaves the session running

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/main.ts:22-46`
- **What happens:** `startOnline` / `startPrototype` return `() => session?.dispose()` while `session` is still null until `import('./app/online/OnlineSession')` resolves. An HMR dispose (or a re-mount) in that window disposes nothing, and the session created afterwards runs alongside the next one (two rAF loops, two sockets).
- **Why it is like this:** lazy loading of the app chunk.
- **Workaround / mitigation:** only reachable in the first moments after load or on HMR.
- **To resolve:** keep a `cancelled` flag in the closure and dispose the session right after construction when it is set.
- **Found:** 2026-11-01, frontend-app review

## Boot flow and fallbacks

### FA-05 · The socket-terminal fallback keeps the server colony index, so the local colony is not "own"

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (traced, no spec covers this path)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:279-285` (`transport.onState` fallback), `:318-327` (`attachLocalHost`), `frontend/game/app/online/bootOnline.ts:230-297` (`createLocalBootFallback`)
- **What happens:** after a successful HTTP boot, if the socket goes `terminal` before the first view, the session builds `createLocalBootFallback(...)`, which always seats the colony as **index 0** (`col_0`). `applyBootResult` is not called for it, so `this.colonyIndex`, `this.planetId`, `entities`/`landfall` owner index keep the server's values, and `attachLocalHost` even calls `lh.setColonyIndex(this.colonyIndex)`. For any player whose server colony index is not 0 (every second+ player on a dev planet): commands are submitted for a colony that does not exist locally, the own pod/HQ is never found (`extractPodDescentStatus`, `EntityMeshes.computeMeshVisible`), and the descent overlay never hands over to the colony view.
- **Why it is like this:** the fallback was written for "no backend at all", where index 0 is right.
- **Workaround / mitigation:** none in the UI; reload.
- **To resolve:** call `applyBootResult(fb)` (or at least sync `colonyIndex`/`planetId`/owner) before `attachLocalHost`, and add a bootFlow spec with a non-zero server colony index and a terminal socket.
- **Found:** 2026-11-01, frontend-app review

### FA-06 · Any boot or socket failure silently turns the online game into an offline local one

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/bootOnline.ts:306-350` (`bootAuthAndHome` catch-all), `frontend/game/app/online/OnlineSession.ts:278-285`, `frontend/game/net/ConnectionBanner.ts:24-27`
- **What happens:** every error of `POST /v1/auth/guest` / `GET /v1/me/home` (network down, but also 401 after refresh, 429, 500, a bad payload) returns `createLocalBootFallback`, an in-process planet with the same id (`pl_dev`, `pl_dev_ocean`, …) as the server's. Nothing on screen says the game is offline; progress there is lost on reload (FA-07). After a socket `terminal`, the banner still shows the terminal message with a **Retry** button; Retry restarts the `WsTransport`, and if it reconnects the store's worker starts emitting server views while the local host keeps pushing its own views into the same store (both write `latestView`).
- **Why it is like this:** W01-38 asked for a "graceful local fallback when no backend is running" so the page always shows something.
- **Workaround / mitigation:** dev builds log nothing; the dev console `planet` output looks the same.
- **To resolve:** decide whether production should fall back at all. Recommendation: only fall back on a network error in dev builds (or with `?host=local`), show an "OFFLINE · LOCAL" badge when it does, hide/disable the banner's Retry once a local host is attached, and surface HTTP errors as an error splash with Retry.
- **Found:** 2026-11-01, frontend-app review

### FA-07 · Two browser hosts: the in-process `LocalHost` duplicates `LocalHostCore` with weaker behaviour

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/WorldStore.ts:248-376` (`LocalHost`), `frontend/game/store/local/LocalHostCore.ts`, `frontend/game/app/online/OnlineSession.ts:178-186,326` (dev server choice, `setInterval` stepping), `frontend/game/net/devServer.ts:58-66`
- **What happens:** the boot fallback uses `LocalHost`, a second authority next to the `?host=local` worker host. Compared with `LocalHostCore` it: runs the sim on the main thread with `setInterval(TICK_MS)` (throttled in background tabs, no `PlanetScheduler`); has no `precheckClientCommand` (no arg validation, wave gate or `invalid_args` rejects; any `system.*` kind from the page is accepted as a dev command); has no persistence (reload = new colony, journal from `system:seed`); packs and pushes the full tile layers every tick (`step` → `sync(true)`), computes a `diffSince` per tick that only the `CommandBus` listens to, and also pushes every view into its own never-started `store`; its dev console `devServer` is the HTTP one (`createHud` picks `httpDevServer()` because `local` is null), so `tune`/`scenario`/`chain.ping` hit the real server, possibly the server planet with the same id. The welcome / ack / reject / command-mapping code is a near-copy of `LocalHostCore` (AGENTS "no copy/paste").
- **Why it is like this:** `LocalHost` predates the worker host (W00 in-process tests) and was reused for the W01 fallback.
- **Workaround / mitigation:** only reached when the backend is down (FA-06).
- **To resolve:** run the fallback on `LocalTransport` + `LocalHostController` (worker, IndexedDB, precheck, local dev server) with a "seat colony at slot" option, and keep `LocalHost` for unit tests only (or delete it).
- **Found:** 2026-11-01, frontend-app review

### FA-08 · The boot flow lands the pod with the admin command `dev.land`, which production refuses

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED (client trace + `shared/contracts/src/precheck.ts:36`)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:109` (`fastStartLand`), `:244-247`, `:367-370`, `:470-473` (three copies of "send `dev.land` once"), `:331-337` (Esc/Space skip), `shared/sim/src/systems/landing/index.ts:69-76` (`podDescentS`, default 30 s)
- **What happens:** `/play.html` and the orbit hand-off send `dev.land` once the client touchdown animation ends (and Esc/Space send it to skip). `dev.*` kinds are `unknown_kind` in production (`def.dev && production`), so in production the HQ only deploys when the sim's own descent timer (about 30 s) runs out, while in dev it deploys right after the 5 s animation. QA in dev never sees the production timing.
- **Why it is like this:** a dev shortcut to get a fast start.
- **Workaround / mitigation:** the descent overlay shows progress until the sim lands.
- **To resolve:** decide the production landing time. Recommendation: make the short descent a data row (landing kit `podDescentS` per entry mode) or a player command (`land`), not a dev command, and factor the three copies into one `sendLandOnce()`.
- **Found:** 2026-11-01, frontend-app review

### FA-09 · Every deploy from the orbit menu resets the device secret: a new guest and a new colony each time

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/Game.ts:206` (`resetDeviceSecret()` in the deploy path, commit 87adadd), `backend/app/src/core/home/home.repository.ts:163-187`; docs `docs/dev/DEV_TOOLS.md:12,28`, `docs/plan/checks/w01-check.md:22`
- **What happens:** each DEPLOY COLONY on `/play.html?planet=<kind>` writes a fresh `ta_device_secret`, so the next `POST /v1/auth/guest` creates a new player and `GET /v1/me/home` seats a new colony. The previous guest's colony stays on the planet and keeps its spawn slot (5 seats per dev planet, then `pl_dev_2`, …). DEV_TOOLS says the orbit flow is "pre-warming auth/home in the background" (removed in the same commit: `preBoot = null`) and "an existing colony keeps its planet"; the check guide says "An existing guest keeps its first planet whatever you pick". Both are true only for `/play.html` opened directly.
- **Why it is like this:** probably so that every orbit pick lands on a planet of the picked type (an existing guest would keep its first planet).
- **Workaround / mitigation:** none; dev planets fill up with abandoned colonies.
- **To resolve:** owner decision. Recommendation: keep the guest and let `/v1/me/home?type=` move or add a colony explicitly (or reset only in dev builds), then fix the two docs.
- **Found:** 2026-11-01, frontend-app review

### FA-10 · `?as=<name>` does not create a fresh guest in the W01 boot flow, although the docs say so

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:121` (`useGuestBoot` ignores `as`), `frontend/game/app/online/sessionTarget.ts:33` (the only reader of `as`), `frontend/game/app/online/bootOnline.ts:8,306-316`; docs `docs/dev/DEV_TOOLS.md:28`, `docs/plan/checks/w01-check.md:11,22,29`
- **What happens:** `as` only names the `dev:<name>` token of the `?scenario=`/`?join=` flows. On plain `/play.html` (guest boot) the device secret comes from `localStorage` whatever `as` says, so "open a second fresh guest (`?as=b`, then `?as=c`)" in the W01 check (D-39 unique landing positions) lands the same guest again. The check guide also names the storage key `terra.deviceSecret`; the code uses `ta_device_secret`.
- **Why it is like this:** `as` predates guest auth.
- **Workaround / mitigation:** use a private window per extra guest, or clear `ta_device_secret`.
- **To resolve:** either derive a per-`as` device secret key (`ta_device_secret:<as>`) in dev builds, or fix DEV_TOOLS and the W01 check guide to say "private window".
- **Found:** 2026-11-01, frontend-app review

### FA-11 · Esc and Space skip the landing whenever the HQ is "not deployed", including while typing and on planets without a pod

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (traced)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:329-342` (`bindKeys`), `frontend/game/app/online/PodTouchdownFx.ts:191-197,368-369`
- **What happens:** the key handler does not check `e.target`, so a Space typed into any input (dev console, a feature form) during the descent calls `skipLanding()`. On `?scenario=w00` there is no pod, so `isHqDeployed()` stays false until something disables the touchdown FX: the first Esc does not open the pause menu but sends `dev.land` and shows the colony view.
- **Why it is like this:** the skip shortcut was written for the W01 pod flow.
- **Workaround / mitigation:** press Esc a second time.
- **To resolve:** ignore keys whose target is an editable element; only offer the skip while an own pod is actually descending.
- **Found:** 2026-11-01, frontend-app review

### FA-12 · `fastStartLand` depends on whether a test injected `wsDeps` / `localHost`

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:109`, `frontend/game/app/online/bootFlow.spec.ts`
- **What happens:** `fastStartLand = skipDescent || (!opts.wsDeps && !opts.localHost && !scenario)`. In the browser `wsDeps` is never passed, so it is always on (except `?scenario=`); specs that inject `wsDeps` run with it off, i.e. they do not exercise the `dev.land` auto-landing the browser uses.
- **Why it is like this:** keeps the spec timelines deterministic.
- **Workaround / mitigation:** the browser path is checked by hand (W01 check step 2).
- **To resolve:** make it an explicit option (`autoLand`) so a spec can cover both paths.
- **Found:** 2026-11-01, frontend-app review

### FA-13 · Dead boot options: `preBoot`, `cachedAccessToken`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (grep: no callers)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:48,270`, `frontend/game/app/online/bootOnline.ts:60,320-325`
- **What happens:** `OnlineSessionOptions.preBoot` lost its only caller when `Game.ts` stopped pre-warming (87adadd); `BootAuthOptions.cachedAccessToken` (which fakes an `AuthResponse` with player `pr_cached`) has no caller.
- **Why it is like this:** leftovers of the pre-warm design.
- **To resolve:** delete both (or reinstate pre-warming and update DEV_TOOLS, see FA-09).
- **Found:** 2026-11-01, frontend-app review

## Transports and command bus

### FA-14 · `CommandBus.send` rejects instead of resolving `not_connected` when the transport cannot send

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/net/commandBus.ts:46-56`, `frontend/game/net/WsTransport.ts:76-79`, `frontend/game/net/LocalTransport.ts:60-63`, callers `OnlineSession.ts:246,369,472` (`void this.commandBus.send('dev.land', …)`)
- **What happens:** `WsTransport.send` / `LocalTransport.send` throw while not `welcomed/streaming/resyncing` (reconnecting, connecting, idle). The throw happens inside the `new Promise` executor, so `send()` returns a **rejected** promise, not the documented `{ ok: false, code: 'not_connected' }`. The `pending` entry and its timer stay for 5 s. `void` callers produce an unhandled rejection; `await` callers in features get an exception they do not expect. (With `?lag=` the throw is swallowed by `LagTransport` and the command times out instead.)
- **Why it is like this:** the bus assumed `send` never throws.
- **Workaround / mitigation:** the banner shows the reconnect state.
- **To resolve:** wrap `transport.send` in try/catch, settle with `not_connected` and clear the entry; add a spec "send while reconnecting resolves not_connected".
- **Found:** 2026-11-01, frontend-app review

### FA-15 · Every welcome starts another ping chain

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (traced; no spec covers pings)
- **Area / code:** `frontend/game/net/WsTransport.ts:127-131,149-155`
- **What happens:** `onWelcome` calls `schedulePing()` unconditionally and the previous chain is never cancelled. A resync (delta gap → re-join → new welcome) on the same socket adds a second 20 s ping loop, a third resync a third, and so on until the socket closes. Each extra pong also rewrites the clock offset.
- **Why it is like this:** the chain only stops when it fires while disconnected.
- **To resolve:** keep the ping timer handle and clear it before scheduling; add a fake-timer spec.
- **Found:** 2026-11-01, frontend-app review

## WorldStore, replica and prediction

### FA-16 · A command that is never acked or rejected stays predicted forever

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (traced)
- **Area / code:** `frontend/game/store/prediction/Predictor.ts:70-82,95-121,217-222`, `frontend/game/net/commandBus.ts:49-51`, `frontend/game/store/WorldStore.ts:208-212`
- **What happens:** pending commands leave the predictor only on `ack` + a confirmed tick past `appliedAtTick`, or on `reject`. A command sent just before the socket drops never reaches the server; the re-join welcome keeps pending commands ("a re-join does not forget"). The `CommandBus` times it out after 5 s, but the timeout is not passed to the worker. From then on every predicted view re-applies it at the first tick after the confirmed state (`due = max(..., first)`), e.g. the HQ keeps starting a walk the server never ordered, every rebuild clones and steps the host, and `pending` in the net overlay never returns to 0.
- **Why it is like this:** prediction trusts the server to answer every command; there is no client-side expiry.
- **Workaround / mitigation:** a page reload.
- **To resolve:** drop pending commands older than the bus timeout (or have `CommandBus` post a `reject{code:'timeout'}` to the worker through `WorldStore`), and drop un-acked ones on a `reason: 'join'` welcome after a reconnect.
- **Found:** 2026-11-01, frontend-app review

### FA-17 · Predicted commands use `colonies[0]` when the welcome has no `colonyId`

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/prediction/Predictor.ts:184-187`, `frontend/game/store/local/LocalHostCore.ts:200,227`, `frontend/game/store/WorldStore.ts:340`
- **What happens:** both browser hosts send `colonyId: null`; the predictor then predicts as the first colony in the state, and `LocalHostCore.command` hard-codes `colonyIndex: 0`. Correct while a local host has exactly one player; a multi-colony local scenario would predict and apply commands for the wrong colony.
- **Why it is like this:** a local host has one planet and one player.
- **To resolve:** if a local multi-colony scenario is ever needed, send the seated colony id in the local welcome.
- **Found:** 2026-11-01, frontend-app review

### FA-18 · Online meshes are drawn 1.5 ticks behind the confirmed tick, even with prediction on

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** PLAUSIBLE (from the code; latency not measured)
- **Area / code:** `frontend/game/app/online/EntityMeshes.ts:215-221` (`clock.observe(min(confirmedTick, view.tick))`), `frontend/game/app/online/entityMotion.ts:15-16,96-127`, `docs/dev/DEV_TOOLS.md:35`, `docs/spec/CLIENT.md` §7
- **What happens:** the HQ / pod / hub meshes follow a `RenderClock` that runs 1.5 ticks (300 ms) behind the newest **confirmed** tick. Predicted poses are pushed into the track at predicted ticks, but they are only drawn when the clock reaches them, i.e. after the server has confirmed about that far. So a right-click starts the visible walk no earlier than without prediction (W01 check: "it starts about 0.3 s after the click"); prediction here only prevents snap-backs. `?predict=0` is documented as "render the server state interpolated 400 ms behind", which is what the `features/entities` layer does, not these meshes (they are 300 ms behind in both modes).
- **Why it is like this:** chosen for constant walking speed (no speed-up while predicted, no jump back when the confirmed state arrives), see the header of `entityMotion.ts`.
- **To resolve:** owner: is ~300 ms + one-way latency acceptable for unit orders? If not, start the clock on the predicted track for the player's own selected unit only. Either way, say in DEV_TOOLS which renderer `?predict=0` affects.
- **Found:** 2026-11-01, frontend-app review

### FA-19 · `WorldStore.simData()` says it includes live `tune` overrides; it only changes on a welcome

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/WorldStore.ts:76-86,190-192`, `frontend/game/features/tune/index.ts:8-11`
- **What happens:** the doc comment says the data includes "live overrides, e.g. dev `tune`", but `welcomeData` is only set from `welcome`, and neither host re-welcomes after a tune. The placement ghost (D-37 preview) and the predictor keep the old numbers until a reload, as the `tune` feature itself says.
- **Why it is like this:** D-35: "clients reload the same numbers".
- **To resolve:** fix the comment (or apply the `dev.tuned` event / `tune` reply overrides to `welcomeData` and the worker).
- **Found:** 2026-11-01, frontend-app review

## Browser local host (worker, IndexedDB)

### FA-20 · An IndexedDB failure can leave an unobserved rejected promise

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/game/store/local/snapshotStore.ts:63-69`
- **What happens:** `run` creates `done` (tx complete/error/abort) and then awaits the request. When the request fails, `asPromise` rejects first, `await done` is never reached, and `done` rejects too on `tx.onerror`/`onabort` with no handler: an "Uncaught (in promise)" in the worker console next to the reported save error. `idbSnapshotStore` has no spec (tests use the memory store).
- **To resolve:** `Promise.all([request, done])`, or attach a no-op catch to `done`; add a `fake-indexeddb` spec.
- **Found:** 2026-11-01, frontend-app review

### FA-21 · `frontend/game/package.json` does not declare `@terra/scenarios`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/package.json:7`; imports in `frontend/game/store/local/LocalHostCore.ts:2`, `frontend/game/dev/parity/main.ts`, `frontend/game/dev/parity/runLocal.ts`
- **What happens:** the workspace resolves it through the root, so builds pass, but the package's dependency list (updated for `@terra/ledger` in this wave) is incomplete.
- **To resolve:** add `"@terra/scenarios": "0.1.0"`.
- **Found:** 2026-11-01, frontend-app review

## Rendering code in the app

### FA-22 · The drop-pod shell and crater are hand-built THREE meshes outside kitbash and the Unifier material

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/PodImpactRig.ts` (429 lines; `MeshStandardMaterial`s at `:92-101,215-244`, separate meshes for petals, ramp, seat, legs), `AGENTS.md` §2 pillars 1 and 3, §6 "Build on the existing renderer"
- **What happens:** the opening 4-petal pod, its interior and the impact crater are built in the game app from separate primitive meshes with plain standard materials. They do not use `createUnifiedColonyMaterial`, are not a merged kitbash archetype (`ship.dropPod` exists in `frontend/render/kitbash`), are not checked by `npm run validate:models`, and cannot be inspected in `/playground.html`. The owned pod mesh from `EntityMeshes` and this rig are two pod models in one scene.
- **Why it is like this:** the petal opening needs articulated parts that the kitbash `aPartAnim` channels may not cover.
- **To resolve:** owner: accept as a one-off VFX rig, or move the shell into `frontend/render` as a kitbash archetype with `aPartAnim` petal channels and the Unifier material (then validate it).
- **Found:** 2026-11-01, frontend-app review

### FA-23 · Every terrain pick logs to the console, including every pointer move of the placement ghost

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/viewportHelper.ts:76`, callers `frontend/game/features/hub-placement/HubPlacementMenu.ts:367-390`, `frontend/game/features/terraform-basic/BrushController.ts:357-360`
- **What happens:** `pickTerrainAt` does `console.log('[pick] …')` unconditionally; the hub ghost and the terraform brush call `pickTile` on pointer moves, so the console fills with one line per move. DEV_TOOLS documents only "left click logs its q, r".
- **To resolve:** log only on click (or behind a debug flag); `__online.lastPick` already keeps the last pick.
- **Found:** 2026-11-01, frontend-app review

### FA-24 · Small render-side approximations in `EntityMeshes`

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/EntityMeshes.ts:50-55` (`archetypeForKind`), `:345-358` (`hubCoversCrater`), `frontend/game/app/online/viewportHelper.ts:142-169` (`createSafeViewport`)
- **What happens:** any entity kind other than hq / pod / commandHub is drawn as `robot.scout` (today only `devProbe` reaches that branch); the crater is hidden when a hub is within 3 by **Euclidean distance on axial (q, r)**, which is not hex distance (it is 1.41 for a neighbour at (1, -1) and 1.41 for a tile two steps away at (1, 1)); when `createColonyViewport` throws in a real browser (no WebGL), the session silently uses a no-op viewport and the page stays black with no message.
- **Why it is like this:** W01 has only these kinds; the headless fallback exists for specs.
- **To resolve:** map kinds through a registry when new kinds arrive; use `hexDistance` from `@terra/sim/grid/hex`; show an error plate when the real viewport fails.
- **Found:** 2026-11-01, frontend-app review

## Types, docs and tests

### FA-25 · `FeatureServices` gained an index signature and an `any` store

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/core/registry/types.ts:15-25`
- **What happens:** `[key: string]: unknown` and `store?: { [k: string]: any; … }` replace the declaration-merging contract: a misspelt service name now type-checks (as `unknown`), and everything reached through `services.store` is `any`, so a feature can call a non-existent store method without a compile error.
- **Why it is like this:** to let features read `store` and `pickTile` without a typed service declaration.
- **To resolve:** declare `store` and `pickTile` by declaration merging with real types (`WorldStore` subset, `HexPick`), and drop the index signature.
- **Found:** 2026-11-01, frontend-app review

### FA-26 · DEV_TOOLS says `?host=local` without `scenario` uses `w00`; it opens the prototype

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/dev/DEV_TOOLS.md:31`, `frontend/game/app/online/onlineMode.ts:23`, `frontend/game/app/online/localHost.ts:10`
- **What happens:** `onlineMode` returns `null` (prototype world picker) for `host=local` without `scenario`, so the `DEFAULT_LOCAL_SCENARIO = 'w00'` default in `localHostOptions` is unreachable from `/play.html`.
- **To resolve:** fix the doc row (or route `?host=local` alone to the local `w01` host and drop the prototype exception).
- **Found:** 2026-11-01, frontend-app review

### FA-27 · Unused symbols

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (`tsc --noUnusedLocals --noUnusedParameters`)
- **Area / code:** `frontend/game/app/online/bootFlow.spec.ts:4` (`ENTITY_STATE`), `frontend/game/app/RTSCamera.ts:20` (`private dom` is never read as a field; only the parameter is used), `frontend/game/dev/explorer/main.ts:28` (`root`)
- **To resolve:** drop the import / the `private` modifiers.
- **Found:** 2026-11-01, frontend-app review

### FA-28 · Untested lifecycle and failure paths of the client shell

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (spec inventory)
- **Area / code:** `frontend/game/app/online/bootFlow.spec.ts`, `frontend/game/net/WsTransport.spec.ts`, `frontend/game/net/commandBus.spec.ts`, `frontend/game/store/local/LocalHostCore.spec.ts`
- **What happens:** no spec covers `OnlineSession.dispose()` (listeners, rAF, timers, transport), dispose during boot (FA-02), the socket-terminal fallback (FA-05), token expiry / reauth (FA-01), send while reconnecting (FA-14), the ping schedule (FA-15), predictor expiry of lost commands (FA-16), the in-process `LocalHost` stepping, or `idbSnapshotStore` (FA-20). The bugs above live exactly in these paths.
- **To resolve:** add fake-timer specs per path when fixing the entries above.
- **Found:** 2026-11-01, frontend-app review

## Cross-area findings (added by the lead)

### FA-29 · The feature HUD remounts every feature on each `welcome`, reconnects included

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts` (`createHud` on welcome), `FeatureHud`
- **What happens:** an open placement ghost or brush selection is lost on every reconnect, and the order of window key listeners flips between the first mount and later ones (root of FF-11).
- **To resolve:** mount features once per session and feed them new views/services on welcome; test that a reconnect keeps an open placement.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
