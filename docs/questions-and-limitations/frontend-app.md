# Frontend app: game client shell

Known gaps, deliberate trade-offs and open questions in the `/play.html` client shell: `frontend/game/{app,store,net,core,dev,descent}`,
`frontend/game/main.ts` and `frontend/index.html` (online session, boot flow, WorldStore / replica / prediction, local hosts,
transports, dev console wiring). Entry format: [README](./README.md). Ledger journal limits are in [`economy-ledger.md`](./economy-ledger.md).

## Online session lifecycle

### FA-01 · The access token is never renewed, so an online session ends about 15 minutes after boot

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** high
- **Confidence:** CONFIRMED (traced client and server; not reproduced in a browser)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:122-124` (guest `bootTarget`), `:292-300` (`resolveBootTarget`), `frontend/game/net/WsTransport.ts:92-109,157-172`, `frontend/game/net/closeCodes.ts:15-17`; server `backend/app/src/ws/connection.ts:129-139` (`armExpTimer`), `backend/app/src/core/auth/auth-token.service.ts:5` (`ACCESS_TOKEN_TTL_S = 900`); `docs/spec/PROTOCOL.md` LB-02, `docs/spec/CLIENT.md:190-192`
- **What happens:** the server closes the socket with `4003 forbidden` at the access token's `exp` (15 min) unless a `reauth` arrived first. The client never sends `reauth` (no `reauth` in `Outgoing`, `net/types.ts:22-26`). `forbidden` maps to `reconnect-once`, the transport calls `target.resolve()`, and `resolveBootTarget` returns the cached `{ planetId }` because `bootResult` is already set, so `bootTarget.accessToken` is still the expired token. The second hello fails `verify` ("Access token expired") → another `4003` within 30 s → `terminal`, banner "Couldn't join colony". The same happens to any reconnect (server restart, Wi-Fi drop) later than 15 min after boot. The `tryRefresh` branch of `bootAuthAndHome` is only reached when `bootResult` is still empty, i.e. never on a reconnect.
- **Why it is like this:** W01 built guest auth and the boot flow; token lifetime on a long-lived socket was not wired.
- **Workaround / mitigation:** reload the page (a new guest login with the same device secret gets a new token). Dev `?scenario=`/`?join=` flows use `dev:<name>` tokens, which do not expire.
- **To resolve:** before `exp` call `POST /v1/auth/refresh` and send `reauth`; in `resolveBootTarget` refresh the token whenever the last close was `4000/4003` (CLIENT §6.3 "refresh the token, then re-resolve"). Add a WsTransport spec for "forbidden → fresh token on the retry".
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `SessionTarget` gained `tokenExpiresAtMs` + `refresh()`; `WsTransport` renews the token `REAUTH_LEAD_MS` (60 s) before expiry and sends `reauth` on the open socket (the server's answering `ready` no longer triggers a `join`), and renews before the next `hello` after a `4000`/`4003` close or when the token is about to expire. The guest flow's target is `GuestBootTarget` (`app/online/guestBoot.ts`: refresh cookie, else guest login, via `renewAccessToken` in `bootOnline.ts`; `expiresIn` is now kept as `BootAuthResult.tokenExpiresInS`). Tests: `net/WsTransport.spec.ts` "WsTransport token lifetime (FA-01)" (reauth before expiry, `forbidden (4003) → the retry says hello with a fresh token`, expired token on a network reconnect), `app/online/guestBoot.spec.ts` "GuestBootTarget (FA-01)".

### FA-02 · Disposing the session while the guest boot is in flight restarts the socket and leaks listeners

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (traced)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:160-161,268-290` (`startBootSequence`), `:482-498` (`dispose`), `frontend/game/net/WsTransport.ts:61-74`
- **What happens:** `startBootSequence` awaits `bootAuthAndHome` (two HTTP calls). If `dispose()` runs meanwhile (Esc → Return to orbit, `Game.teardownSession`, HMR), it runs `cleanups` and `transport.stop()`. When the await returns, the method continues on the disposed session: it pushes a new `store.onView` listener into `cleanups` (never run again), may `attachLocalHost` (starting a `setInterval` that nobody clears), and calls `this.transport.start()`. `WsTransport.start()` only returns early when `!stopped`; after `stop()` `stopped` is true, so it connects again and keeps reconnecting with backoff forever, with no owner.
- **Why it is like this:** the boot sequence has no "disposed" guard.
- **Workaround / mitigation:** none; the leak lasts until the page reloads.
- **To resolve:** set a `disposed` flag in `dispose()` and return from `startBootSequence` (and the `onState` fallback) when it is set; consider making `WsTransport.start()` after `stop()` explicit (e.g. a `disposed` state that refuses to start).
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `OnlineSession` has a `disposed` flag: `startBootSequence` returns after the HTTP boot when disposed, `applyBootResult` and the socket-terminal fallback do nothing on a disposed session; `Transport.dispose()` (new, optional) is called from `dispose()`, and `WsTransport.dispose()` refuses any later `start()` (plain `stop()` stays restartable for the banner's Retry). Tests: `app/online/OnlineSession.lifecycle.spec.ts` "FA-02: dispose while the HTTP boot is in flight never opens a socket afterwards", `net/WsTransport.spec.ts` "dispose() stops for good".
- **Also:** dispose while the boot error splash waits for Retry settles the wait (`BootOverlay.dispose`), `GuestBootTarget.boot()` returns null and `whenBooted` resolves null. Test: `OnlineSession.lifecycle.spec.ts` "FA-02: dispose on the error splash ends the boot".

### FA-03 · `dispose()` stops but never terminates the `?host=local` worker

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:126-128,493`, `frontend/game/net/LocalTransport.ts:49-58`, `frontend/game/net/LagTransport.ts:63,67`, `frontend/game/store/local/LocalHostCore.ts:274-293`
- **What happens:** the session calls `transport.stop()`, not `dispose()`. For a `LocalTransport` this posts `stop` (the core saves and stops stepping) but `link.dispose()` (`worker.terminate()`) is never called, so each Return to orbit from `?host=local&scenario=…` leaves an idle Worker holding a whole `SimHost`. With `?lag=`, `LagTransport.dispose()` (which unsubscribes from the inner transport) is not called either.
- **Why it is like this:** `Transport` has no `dispose`; only `stop`.
- **Workaround / mitigation:** a page reload frees them.
- **To resolve:** add an optional `dispose()` to `Transport` and call it from `OnlineSession.dispose()`. Note: `LocalHostCore.save()` is fire-and-forget (IndexedDB), so terminating right after `stop` can drop the final save; terminate after the host confirms the save (or delay the terminate).
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `Transport.dispose?()`; `OnlineSession.dispose()` calls it (else `stop()`). `LocalTransport.dispose()` posts `stop` and terminates the worker when the host answers the new `{ t: 'stopped' }` (sent by `LocalHostController` after `LocalHostCore.stop()`'s final save settled; `save()` / `stop()` now return that promise), or after `DISPOSE_GRACE_MS` (2 s); a disposed `LocalTransport` does not start again. `LagTransport.dispose()` forwards to the inner transport's `dispose`. Tests: `net/LocalTransport.spec.ts` "terminates the worker only after the host saved its final snapshot", `OnlineSession.lifecycle.spec.ts` "FA-03: dispose releases the transport for good".

### FA-04 · Unmounting before the dynamic import resolves leaves the session running

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/main.ts:22-46`
- **What happens:** `startOnline` / `startPrototype` return `() => session?.dispose()` while `session` is still null until `import('./app/online/OnlineSession')` resolves. An HMR dispose (or a re-mount) in that window disposes nothing, and the session created afterwards runs alongside the next one (two rAF loops, two sockets).
- **Why it is like this:** lazy loading of the app chunk.
- **Workaround / mitigation:** only reachable in the first moments after load or on HMR.
- **To resolve:** keep a `cancelled` flag in the closure and dispose the session right after construction when it is set.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `app/lazyStart.ts` (`lazyStart(load, build)`): `main.ts` builds the session / prototype only if the unmount has not run meanwhile. Test: `app/lazyStart.spec.ts`.

## Boot flow and fallbacks

### FA-05 · The socket-terminal fallback keeps the server colony index, so the local colony is not "own"

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (traced, no spec covers this path)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:279-285` (`transport.onState` fallback), `:318-327` (`attachLocalHost`), `frontend/game/app/online/bootOnline.ts:230-297` (`createLocalBootFallback`)
- **What happens:** after a successful HTTP boot, if the socket goes `terminal` before the first view, the session builds `createLocalBootFallback(...)`, which always seats the colony as **index 0** (`col_0`). `applyBootResult` is not called for it, so `this.colonyIndex`, `this.planetId`, `entities`/`landfall` owner index keep the server's values, and `attachLocalHost` even calls `lh.setColonyIndex(this.colonyIndex)`. For any player whose server colony index is not 0 (every second+ player on a dev planet): commands are submitted for a colony that does not exist locally, the own pod/HQ is never found (`extractPodDescentStatus`, `EntityMeshes.computeMeshVisible`), and the descent overlay never hands over to the colony view.
- **Why it is like this:** the fallback was written for "no backend at all", where index 0 is right.
- **Workaround / mitigation:** none in the UI; reload.
- **To resolve:** call `applyBootResult(fb)` (or at least sync `colonyIndex`/`planetId`/owner) before `attachLocalHost`, and add a bootFlow spec with a non-zero server colony index and a terminal socket.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** the socket-terminal fallback (`OnlineSession.onSocketState`) calls `applyBootResult(fallback)` before `attachLocalHost`, so `colonyIndex` (0), `colonyId`, `planetId`, the mesh / landfall owner index and the local host's colony agree. Test: `OnlineSession.lifecycle.spec.ts` "FA-05: a terminal socket before the first view seats the local fallback colony as index 0".

### FA-06 · Any boot or socket failure silently turns the online game into an offline local one

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/bootOnline.ts:306-350` (`bootAuthAndHome` catch-all), `frontend/game/app/online/OnlineSession.ts:278-285`, `frontend/game/net/ConnectionBanner.ts:24-27`
- **What happens:** every error of `POST /v1/auth/guest` / `GET /v1/me/home` (network down, but also 401 after refresh, 429, 500, a bad payload) returns `createLocalBootFallback`, an in-process planet with the same id (`pl_dev`, `pl_dev_ocean`, …) as the server's. Nothing on screen says the game is offline; progress there is lost on reload (FA-07). After a socket `terminal`, the banner still shows the terminal message with a **Retry** button; Retry restarts the `WsTransport`, and if it reconnects the store's worker starts emitting server views while the local host keeps pushing its own views into the same store (both write `latestView`).
- **Why it is like this:** W01-38 asked for a "graceful local fallback when no backend is running" so the page always shows something.
- **Workaround / mitigation:** dev builds log nothing; the dev console `planet` output looks the same.
- **To resolve:** decide whether production should fall back at all. Recommendation: only fall back on a network error in dev builds (or with `?host=local`), show an "OFFLINE · LOCAL" badge when it does, hide/disable the banner's Retry once a local host is attached, and surface HTTP errors as an error splash with Retry.
- **Found:** 2026-11-01, frontend-app review
- **Fix (recommendation applied):** `bootAuthAndHome` falls back to a local host only when `allowLocalFallback` (default: dev builds) and the server is unreachable (`backendUnreachable`: network error or 5xx, which is what the Vite proxy answers with the app down); every other failure throws a `BootError`, and `GuestBootTarget.boot()` shows it on the splash with **Retry** (`BootOverlay.showError`) until a retry succeeds. The socket-terminal fallback is dev-only too. When a fallback host is attached the **OFFLINE · LOCAL** badge (`[data-testid="offline-badge"]`) shows and the connection banner (with its Retry) is removed, so server views can no longer mix into the local store. Tests: `OnlineSession.lifecycle.spec.ts` "FA-06: production never falls back…" and "FA-06: in a dev build a 4xx is an error splash too…", `guestBoot.spec.ts` "boot failures (FA-06)". DEV_TOOLS `*(none)*` row updated.

### FA-07 · Two browser hosts: the in-process `LocalHost` duplicates `LocalHostCore` with weaker behaviour

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/WorldStore.ts:248-376` (`LocalHost`, before the fix), `frontend/game/store/local/LocalHostCore.ts`, `frontend/game/app/online/OnlineSession.ts:178-186,326` (dev server choice, `setInterval` stepping), `frontend/game/net/devServer.ts:58-66`
- **What happens:** the boot fallback uses `LocalHost`, a second authority next to the `?host=local` worker host. Compared with `LocalHostCore` it: runs the sim on the main thread with `setInterval(TICK_MS)` (throttled in background tabs, no `PlanetScheduler`); has no `precheckClientCommand` (no arg validation, wave gate or `invalid_args` rejects; any `system.*` kind from the page is accepted as a dev command); has no persistence (reload = new colony, journal from `system:seed`); packs and pushes the full tile layers every tick (`step` → `sync(true)`), computes a `diffSince` per tick that only the `CommandBus` listens to, and also pushes every view into its own never-started `store`; its dev console `devServer` is the HTTP one (`createHud` picks `httpDevServer()` because `local` is null), so `tune`/`scenario`/`chain.ping` hit the real server, possibly the server planet with the same id. The welcome / ack / reject / command-mapping code is a near-copy of `LocalHostCore` (AGENTS "no copy/paste").
- **Why it is like this:** `LocalHost` predates the worker host (W00 in-process tests) and was reused for the W01 fallback.
- **Workaround / mitigation:** only reached when the backend is down (FA-06).
- **To resolve:** run the fallback on `LocalTransport` + `LocalHostController` (worker, IndexedDB, precheck, local dev server) with a "seat colony at slot" option, and keep `LocalHost` for unit tests only (or delete it).
- **Found:** 2026-11-01, frontend-app review
- **Earlier (review-fix round):** with the in-process host attached, the dev console's server commands other than `warp` answered `host_unavailable` instead of hitting the real server (`app/online/sessionHud.ts`); superseded by the fix below.
- **Fix:** one implementation: `LocalHost` (moved to `frontend/game/store/local/LocalHost.ts`) is now a thin in-process shell over `LocalHostCore`, the engine of `?host=local`, with an in-memory snapshot store and a direct post channel instead of a Worker. `LocalHostCore` gained a planet source (`store/local/planetSource.ts`: `scenarioSource` for the worker, `builtPlanetSource` for a planet built in code), a synchronous `open()` (fresh planet, not stepping), `run()` (scheduler + 10 s saves) and `advance(n)` (manual steps + one delta, for tests and the scripted boot). So the dev fallback gets the precheck (`unknown_kind` for page-sent `system.*`, `invalid_args`, wave gate), detailed rejects, the `PlanetScheduler` (5 TPS, dev warp) instead of the page `setInterval`, the failed-step handling of FA-33 (commands rejected `internal`, `host_unavailable` while down, restored from its last in-memory snapshot or a freshly seated planet, re-welcomed), and the core's dev server (`warp`, `tune`, `scenario`, `local.reset`, `ledger`; anything else `host_unavailable`). `createLocalBootFallback` seats colony 0 inside the source (`system.spawnColony`), so `local.reset` and a restore seat it again and the journal starts from the seating postings. Views are pushed to the bound stores on every welcome / delta, tile layers only when a tile changed. `OnlineSession` lost `localTimer` / `setColonyIndex` (the core's colony is 0, as the fallback's always was) and stops the host on dispose; `sessionHud` routes the dev console to `LocalHost.devServer`. Still dev builds only (FA-06); a reload starts a new planet (snapshots are in memory). Tests: `app/online/localFallback.spec.ts` ("a step that throws rejects its commands internal (no ack)…", precheck, dev console, view push), `OnlineSession.lifecycle.spec.ts` › "the fallback is the in-process LocalHostCore…"; every existing `LocalHost` spec green (imports moved to `store/local/LocalHost`). DEV_TOOLS fallback and `ledger` rows updated.
- **Limitation:** what the in-process host still does differently from `?host=local` (main thread, no event toasts) is FA-35.

### FA-08 · The boot flow lands the pod with the admin command `dev.land`, which production refuses

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (client trace + `shared/contracts/src/precheck.ts:36`)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:109` (`fastStartLand`), `:244-247`, `:367-370`, `:470-473` (three copies of "send `dev.land` once"), `:331-337` (Esc/Space skip), `shared/sim/src/systems/landing/index.ts:69-76` (`podDescentS`, default 30 s)
- **What happens:** `/play.html` and the orbit hand-off send `dev.land` once the client touchdown animation ends (and Esc/Space send it to skip). `dev.*` kinds are `unknown_kind` in production (`def.dev && production`), so in production the HQ only deploys when the sim's own descent timer (about 30 s) runs out, while in dev it deploys right after the 5 s animation. QA in dev never sees the production timing.
- **Why it is like this:** a dev shortcut to get a fast start.
- **Workaround / mitigation:** the descent overlay shows progress until the sim lands.
- **To resolve:** decide the production landing time. Recommendation: make the short descent a data row (landing kit `podDescentS` per entry mode) or a player command (`land`), not a dev command, and factor the three copies into one `sendLandOnce()`.
- **Found:** 2026-11-01, frontend-app review
- **Partly done (review-fix round 2026-11-01):** the three copies are one `sendLandOnce()` in `OnlineSession`. Still open for the owner: production landing time; a player `land` command or a per-entry-mode `podDescentS` data row belongs to the sim / contracts (SIM-GAMEPLAY), not the client.
- **Fix (recommendation applied, final pass 2026-11-01):** the sim has the player command `landPod` (`shared/contracts/src/commands/land-pod.ts`, allowed in production): it opens the caller's descending pod once it has descended `hq.startingKit.podLandMinS` (5 s, the client touchdown animation; asked earlier, it arms that minimum). `OnlineSession.sendLandOnce()` sends `landPod` instead of `dev.land`, so dev and production land at the same time; Esc/Space and `?skip=1` send it too: the colony view shows at once, but the HQ deploys only when the pod has descended the 5 s minimum (dev now sees the production timing; before, `dev.land` opened the pod instantly in dev). An instant dev skip stays available as the console's `land` (`dev.land`). `dev.land` stays a dev-console command only (the host fills `colonyIndex`). Test `bootFlow.spec.ts` › "4. hand-off from 3D pod descent…" (the session sends exactly `{ kind: 'landPod', args: {} }` and the server sim opens the pod after 25 ticks, before its 30-tick descent).

### FA-09 · Every deploy from the orbit menu resets the device secret: a new guest and a new colony each time

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/Game.ts:206` (`resetDeviceSecret()` in the deploy path, commit 87adadd), `backend/app/src/core/home/home.repository.ts:163-187`; docs `docs/dev/DEV_TOOLS.md:12,28`, `docs/plan/checks/w01-check.md:22`
- **What happens:** each DEPLOY COLONY on `/play.html?planet=<kind>` writes a fresh `ta_device_secret`, so the next `POST /v1/auth/guest` creates a new player and `GET /v1/me/home` seats a new colony. The previous guest's colony stays on the planet and keeps its spawn slot (5 seats per dev planet, then `pl_dev_2`, …). DEV_TOOLS says the orbit flow is "pre-warming auth/home in the background" (removed in the same commit: `preBoot = null`) and "an existing colony keeps its planet"; the check guide says "An existing guest keeps its first planet whatever you pick". Both are true only for `/play.html` opened directly.
- **Why it is like this:** probably so that every orbit pick lands on a planet of the picked type (an existing guest would keep its first planet).
- **Workaround / mitigation:** none; dev planets fill up with abandoned colonies.
- **To resolve:** owner decision. Recommendation: keep the guest and let `/v1/me/home?type=` move or add a colony explicitly (or reset only in dev builds), then fix the two docs.
- **Found:** 2026-11-01, frontend-app review
- **Fix (recommendation, dev-build variant):** `Game.ts` resets the device secret on DEPLOY COLONY only in dev builds (`import.meta.env.DEV`); production keeps the guest and its colony. DEV_TOOLS (`?planet=` and the orbit row: no pre-warming, per-build behaviour) and the W01 check guide step 1 updated. The other option of the recommendation, an explicit "move / add colony" on `/v1/me/home?type=`, is a backend change left to the owner.

### FA-10 · `?as=<name>` does not create a fresh guest in the W01 boot flow, although the docs say so

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:121` (`useGuestBoot` ignores `as`), `frontend/game/app/online/sessionTarget.ts:33` (the only reader of `as`), `frontend/game/app/online/bootOnline.ts:8,306-316`; docs `docs/dev/DEV_TOOLS.md:28`, `docs/plan/checks/w01-check.md:11,22,29`
- **What happens:** `as` only names the `dev:<name>` token of the `?scenario=`/`?join=` flows. On plain `/play.html` (guest boot) the device secret comes from `localStorage` whatever `as` says, so "open a second fresh guest (`?as=b`, then `?as=c`)" in the W01 check (D-39 unique landing positions) lands the same guest again. The check guide also names the storage key `terra.deviceSecret`; the code uses `ta_device_secret`.
- **Why it is like this:** `as` predates guest auth.
- **Workaround / mitigation:** use a private window per extra guest, or clear `ta_device_secret`.
- **To resolve:** either derive a per-`as` device secret key (`ta_device_secret:<as>`) in dev builds, or fix DEV_TOOLS and the W01 check guide to say "private window".
- **Found:** 2026-11-01, frontend-app review
- **Fix:** dev builds key the device secret by `?as=` (`deviceSecretKey`: `ta_device_secret:<name>`; production and URLs without `as` use `ta_device_secret`). DEV_TOOLS `&as=` row and the check guide ("Second player", step 1) updated, including the real storage key. Test: `guestBoot.spec.ts` "guest device secret per ?as= (FA-10)".

### FA-11 · Esc and Space skip the landing whenever the HQ is "not deployed", including while typing and on planets without a pod

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (traced)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:329-342` (`bindKeys`), `frontend/game/app/online/PodTouchdownFx.ts:191-197,368-369`
- **What happens:** the key handler does not check `e.target`, so a Space typed into any input (dev console, a feature form) during the descent calls `skipLanding()`. On `?scenario=w00` there is no pod, so `isHqDeployed()` stays false until something disables the touchdown FX: the first Esc does not open the pause menu but sends `dev.land` and shows the colony view.
- **Why it is like this:** the skip shortcut was written for the W01 pod flow.
- **Workaround / mitigation:** press Esc a second time.
- **To resolve:** ignore keys whose target is an editable element; only offer the skip while an own pod is actually descending.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `bindKeys` ignores keys whose target is an input / textarea / select / contenteditable (`isEditableTarget`), and offers the skip only while the descent overlay shows or the own pod is descending (`landingSkippable`), not "HQ not deployed". Test: `OnlineSession.lifecycle.spec.ts` "FA-11: Esc pauses on a planet without a pod; keys typed into a text field are ignored".

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

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (grep: no callers)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:48,270`, `frontend/game/app/online/bootOnline.ts:60,320-325`
- **What happens:** `OnlineSessionOptions.preBoot` lost its only caller when `Game.ts` stopped pre-warming (87adadd); `BootAuthOptions.cachedAccessToken` (which fakes an `AuthResponse` with player `pr_cached`) has no caller.
- **Why it is like this:** leftovers of the pre-warm design.
- **To resolve:** delete both (or reinstate pre-warming and update DEV_TOOLS, see FA-09).
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `OnlineSessionOptions.preBoot` and `BootAuthOptions.cachedAccessToken` (with its fake `pr_cached` response) deleted.

## Transports and command bus

### FA-14 · `CommandBus.send` rejects instead of resolving `not_connected` when the transport cannot send

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/net/commandBus.ts:46-56`, `frontend/game/net/WsTransport.ts:76-79`, `frontend/game/net/LocalTransport.ts:60-63`, callers `OnlineSession.ts:246,369,472` (`void this.commandBus.send('dev.land', …)`)
- **What happens:** `WsTransport.send` / `LocalTransport.send` throw while not `welcomed/streaming/resyncing` (reconnecting, connecting, idle). The throw happens inside the `new Promise` executor, so `send()` returns a **rejected** promise, not the documented `{ ok: false, code: 'not_connected' }`. The `pending` entry and its timer stay for 5 s. `void` callers produce an unhandled rejection; `await` callers in features get an exception they do not expect. (With `?lag=` the throw is swallowed by `LagTransport` and the command times out instead.)
- **Why it is like this:** the bus assumed `send` never throws.
- **Workaround / mitigation:** the banner shows the reconnect state.
- **To resolve:** wrap `transport.send` in try/catch, settle with `not_connected` and clear the entry; add a spec "send while reconnecting resolves not_connected".
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `CommandBus.send` registers the pending entry, then calls `transport.send` in a try/catch: a throw settles `{ ok: false, code: 'not_connected', detail }` at once, clears the timer and skips the prediction. Test: `net/commandBus.spec.ts` "a transport that cannot send (reconnecting) resolves not_connected…".

### FA-15 · Every welcome starts another ping chain

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (traced; no spec covers pings)
- **Area / code:** `frontend/game/net/WsTransport.ts:127-131,149-155`
- **What happens:** `onWelcome` calls `schedulePing()` unconditionally and the previous chain is never cancelled. A resync (delta gap → re-join → new welcome) on the same socket adds a second 20 s ping loop, a third resync a third, and so on until the socket closes. Each extra pong also rewrites the clock offset.
- **Why it is like this:** the chain only stops when it fires while disconnected.
- **To resolve:** keep the ping timer handle and clear it before scheduling; add a fake-timer spec.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `WsTransport` keeps one ping timer handle per socket, cleared before rescheduling and on close. Test: `net/WsTransport.spec.ts` "a resync welcome restarts the ping chain instead of adding a second one".

## WorldStore, replica and prediction

### FA-16 · A command that is never acked or rejected stays predicted forever

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (traced)
- **Area / code:** `frontend/game/store/prediction/Predictor.ts:70-82,95-121,217-222`, `frontend/game/net/commandBus.ts:49-51`, `frontend/game/store/WorldStore.ts:208-212`
- **What happens:** pending commands leave the predictor only on `ack` + a confirmed tick past `appliedAtTick`, or on `reject`. A command sent just before the socket drops never reaches the server; the re-join welcome keeps pending commands ("a re-join does not forget"). The `CommandBus` times it out after 5 s, but the timeout is not passed to the worker. From then on every predicted view re-applies it at the first tick after the confirmed state (`due = max(..., first)`), e.g. the HQ keeps starting a walk the server never ordered, every rebuild clones and steps the host, and `pending` in the net overlay never returns to 0.
- **Why it is like this:** prediction trusts the server to answer every command; there is no client-side expiry.
- **Workaround / mitigation:** a page reload.
- **To resolve:** drop pending commands older than the bus timeout (or have `CommandBus` post a `reject{code:'timeout'}` to the worker through `WorldStore`), and drop un-acked ones on a `reason: 'join'` welcome after a reconnect.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `CommandBus` reports a timed-out command (`onTimedOut`), `OnlineSession` forwards it to `WorldStore.notifyTimedOut(id)`, which rolls it back in the worker as a `timeout` reject (`onCommandRejected` fires, `EntityMeshes` drops the predicted future since `timeout` is unpredictable). The re-join welcome still keeps pending commands (a command sent on the old socket may yet be applied); the timeout bounds them to 5 s. Test: `store/WorldStore.spec.ts` "a command the CommandBus timed out is rolled back, not predicted forever (FA-16)", `commandBus.spec.ts` "a timed-out command is reported to onTimedOut".
- **Also:** with `?lag=<ms>` the bus timeout is `COMMAND_TIMEOUT_MS + 2 × ms` (`OnlineSession`), so a deliberately slow link does not roll every prediction back as timed out (DEV_TOOLS `&lag=` row).

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
- **Partly done (review-fix round 2026-11-01):** DEV_TOOLS `&predict=0` now says which renderer it affects (W00 `devProbe` layer 400 ms behind; HQ / pod / Hub meshes 300 ms behind in both modes). The latency question stays with the owner; no render change made.
- **Shared sampler (2026-11-06):** Implementation now lives in `frontend/render/motion/entityMotion.ts`; the old path re-exports it. March and Hive use the same sampler with a local fixed-tick clock. Gameplay's confirmed-clock latency and correction handling are unchanged; see RN-76 in `render.md`.

### FA-19 · `WorldStore.simData()` says it includes live `tune` overrides; it only changes on a welcome

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/WorldStore.ts:76-86,190-192`, `frontend/game/features/tune/index.ts:8-11`
- **What happens:** the doc comment says the data includes "live overrides, e.g. dev `tune`", but `welcomeData` is only set from `welcome`, and neither host re-welcomes after a tune. The placement ghost (D-37 preview) and the predictor keep the old numbers until a reload, as the `tune` feature itself says.
- **Why it is like this:** D-35: "clients reload the same numbers".
- **To resolve:** fix the comment (or apply the `dev.tuned` event / `tune` reply overrides to `welcomeData` and the worker).
- **Found:** 2026-11-01, frontend-app review
- **Fix:** the `WorldStore.simData()` comment now says the data is the last welcome's (flags + overrides it carried) and that a dev `tune` reaches the client on the next welcome (D-35).
- **Update (FA-31):** a later live `tune set` now also reaches `simData()` (from its `dev.tuned` event); a `tune reset` triggers a fresh welcome. The comment says so.

## Browser local host (worker, IndexedDB)

### FA-20 · An IndexedDB failure can leave an unobserved rejected promise

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/game/store/local/snapshotStore.ts:63-69`
- **What happens:** `run` creates `done` (tx complete/error/abort) and then awaits the request. When the request fails, `asPromise` rejects first, `await done` is never reached, and `done` rejects too on `tx.onerror`/`onabort` with no handler: an "Uncaught (in promise)" in the worker console next to the reported save error. `idbSnapshotStore` has no spec (tests use the memory store).
- **To resolve:** `Promise.all([request, done])`, or attach a no-op catch to `done`; add a `fake-indexeddb` spec.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `idbSnapshotStore.run` awaits the request and the transaction together (`Promise.all`), so a failed request's transaction error is observed. Test: `store/local/snapshotStore.spec.ts` (fake `IDBFactory`: round trip, and "a failed write rejects once … no unobserved rejection").

### FA-21 · `frontend/game/package.json` does not declare `@terra/scenarios`

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/package.json:7`; imports in `frontend/game/store/local/LocalHostCore.ts:2`, `frontend/game/dev/parity/main.ts`, `frontend/game/dev/parity/runLocal.ts`
- **What happens:** the workspace resolves it through the root, so builds pass, but the package's dependency list (updated for `@terra/ledger` in this wave) is incomplete.
- **To resolve:** add `"@terra/scenarios": "0.1.0"`.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `"@terra/scenarios": "0.1.0"` added to `frontend/game/package.json` and to the `frontend/game` entry of `package-lock.json`.

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
- **Note (review-fix round 2026-11-01):** left as is: moving the shell into a kitbash archetype changes the game's 3D look and needs the owner's choice; no change made.

### FA-23 · Every terrain pick logs to the console, including every pointer move of the placement ghost

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/viewportHelper.ts:76`, callers `frontend/game/features/hub-placement/HubPlacementMenu.ts:367-390`, `frontend/game/features/terraform-basic/BrushController.ts:357-360`
- **What happens:** `pickTerrainAt` does `console.log('[pick] …')` unconditionally; the hub ghost and the terraform brush call `pickTile` on pointer moves, so the console fills with one line per move. DEV_TOOLS documents only "left click logs its q, r".
- **To resolve:** log only on click (or behind a debug flag); `__online.lastPick` already keeps the last pick.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** the `console.log('[pick]')` in `pickTerrainAt` is gone; the last pick stays in `window.__online.lastPick` (DEV_TOOLS line updated). Same change resolves XC-17's client part.

### FA-24 · Small render-side approximations in `EntityMeshes`

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/EntityMeshes.ts:50-55` (`archetypeForKind`), `:345-358` (`hubCoversCrater`), `frontend/game/app/online/viewportHelper.ts:142-169` (`createSafeViewport`)
- **What happens:** any entity kind other than hq / pod / commandHub is drawn as `robot.scout` (today only `devProbe` reaches that branch); the crater is hidden when a hub is within 3 by **Euclidean distance on axial (q, r)**, which is not hex distance (it is 1.41 for a neighbour at (1, -1) and 1.41 for a tile two steps away at (1, 1)); when `createColonyViewport` throws in a real browser (no WebGL), the session silently uses a no-op viewport and the page stays black with no message.
- **Why it is like this:** W01 has only these kinds; the headless fallback exists for specs.
- **To resolve:** map kinds through a registry when new kinds arrive; use `hexDistance` from `@terra/sim/grid/hex`; show an error plate when the real viewport fails.
- **Found:** 2026-11-01, frontend-app review
- **Update (W02 review round 1, 2026-11-03, frontend agent): the crater / egress part is now a Question for the owner; the description above is stale.**
  - **Kinds:** `archetypeForKind` (`EntityMeshes.ts:49-57`) now maps `metalsExtractor` → `building.mine`, `solar` → `building.solar`, `harvester` → `robot.miner`, and any other kind (`devProbe`) to `robot.builder`, not `robot.scout` (see RN-60 for the light mismatch).
  - **Crater cover:** `hubCoversCrater` (`EntityMeshes.ts:332-353`) no longer uses axial distance. It hides the crater and the egress shell when **any** constructible building (`isConstructibleBuilding`, state not `waiting`) of **any** colony has its centre within 4.2 m (Hub) or 3.2 m (Extractor / Solar) of the pod in world xz. A tile is 2 m, so 4.2 m is about 2 hexes, while a 3×3 Hub footprint reaches about 2 hexes from its centre and the W01 rule said "within 3"; a neighbour's building next to the pod also hides it.
  - **Egress shell:** after touchdown the opened pod (petals, ramp; `PodImpactRig.setSettled` / the `done` state of `PodTouchdownFx`) stays visible on the landing tile until such a building covers it; without a building it stays for the whole game.
  - **Question:** should the landed pod shell disappear on its own (after the HQ walks out, or when the pod entity is dismantled), and should only the owner's own Hub hide it, using hex distance? Recommendation: hide the shell when the pod entity is gone, keep the crater until the own Hub covers it by `hexDistance ≤ 2`.

## Types, docs and tests

### FA-25 · `FeatureServices` gained an index signature and an `any` store

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/core/registry/types.ts:15-25`
- **What happens:** `[key: string]: unknown` and `store?: { [k: string]: any; … }` replace the declaration-merging contract: a misspelt service name now type-checks (as `unknown`), and everything reached through `services.store` is `any`, so a feature can call a non-existent store method without a compile error.
- **Why it is like this:** to let features read `store` and `pickTile` without a typed service declaration.
- **To resolve:** declare `store` and `pickTile` by declaration merging with real types (`WorldStore` subset, `HexPick`), and drop the index signature.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `FeatureServices` has no index signature; `store` is `FeatureStore` (`Partial<Pick<WorldStore, 'latest' | 'latestTiles' | 'onView' | 'onCommandRejected' | 'sendCommand' | 'simData' | 'currentPlanetId'>>`) and `pickTile` is typed; all other services come from declaration merging. Typecheck of every feature passes with it.

### FA-26 · DEV_TOOLS says `?host=local` without `scenario` uses `w00`; it opens the prototype

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/dev/DEV_TOOLS.md:31`, `frontend/game/app/online/onlineMode.ts:23`, `frontend/game/app/online/localHost.ts:10`
- **What happens:** `onlineMode` returns `null` (prototype world picker) for `host=local` without `scenario`, so the `DEFAULT_LOCAL_SCENARIO = 'w00'` default in `localHostOptions` is unreachable from `/play.html`.
- **To resolve:** fix the doc row (or route `?host=local` alone to the local `w01` host and drop the prototype exception).
- **Found:** 2026-11-01, frontend-app review
- **Fix:** DEV_TOOLS `?host=local` row and README line 118 say `scenario` is needed and `?host=local` alone opens the prototype world picker (the routing stays as W01-38 chose it). Same change resolves XC-20.

### FA-27 · Unused symbols

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (`tsc --noUnusedLocals --noUnusedParameters`)
- **Area / code:** `frontend/game/app/online/bootFlow.spec.ts:4` (`ENTITY_STATE`), `frontend/game/app/RTSCamera.ts:20` (`private dom` is never read as a field; only the parameter is used), `frontend/game/dev/explorer/main.ts:28` (`root`)
- **To resolve:** drop the import / the `private` modifiers.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** `ENTITY_STATE` import dropped from `bootFlow.spec.ts`, `RTSCamera`'s `dom` is a plain parameter, `dev/explorer/main.ts`'s `root` is a plain parameter.

### FA-28 · Untested lifecycle and failure paths of the client shell

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (spec inventory)
- **Area / code:** `frontend/game/app/online/bootFlow.spec.ts`, `frontend/game/net/WsTransport.spec.ts`, `frontend/game/net/commandBus.spec.ts`, `frontend/game/store/local/LocalHostCore.spec.ts`
- **What happens:** no spec covers `OnlineSession.dispose()` (listeners, rAF, timers, transport), dispose during boot (FA-02), the socket-terminal fallback (FA-05), token expiry / reauth (FA-01), send while reconnecting (FA-14), the ping schedule (FA-15), predictor expiry of lost commands (FA-16), the in-process `LocalHost` stepping, or `idbSnapshotStore` (FA-20). The bugs above live exactly in these paths.
- **To resolve:** add fake-timer specs per path when fixing the entries above.
- **Found:** 2026-11-01, frontend-app review
- **Fix:** specs added with the fixes above: `OnlineSession.lifecycle.spec.ts` (dispose during boot, terminal-socket fallback seat, error splash / Retry, keys, transport dispose), `WsTransport.spec.ts` (reauth, fresh token after 4003, ping chain, dispose), `commandBus.spec.ts` (send while reconnecting, timeout hook), `WorldStore.spec.ts` (timed-out prediction), `LocalTransport.spec.ts` (dispose after the final save), `snapshotStore.spec.ts` (IndexedDB store), `guestBoot.spec.ts`, `featureHud.spec.ts`, `lazyStart.spec.ts`. The in-process `LocalHost` stepping is still only covered through `bootFlow.spec.ts` (see FA-07).

## Cross-area findings (added by the lead)

### FA-29 · The feature HUD remounts every feature on each `welcome`, reconnects included

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts` (`createHud` on welcome), `FeatureHud`
- **What happens:** an open placement ghost or brush selection is lost on every reconnect, and the order of window key listeners flips between the first mount and later ones (root of FF-11).
- **To resolve:** mount features once per session and feed them new views/services on welcome; test that a reconnect keeps an open placement.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** the trigger was the first `welcome` (flags source `default` → `welcome`; the flags store already ignored identical reconnect welcomes). `FeatureHud` now mounts once and re-mounts only when the set of enabled features changes; a flags update with the same features refreshes the live `ctx.flags` set and the `flagsSource` getter in place. Services are copied with their getters (`colonyId`, `hexTerrain` stay live). Test: `app/online/featureHud.spec.ts` "mounts the features once: the first welcome and a reconnect welcome keep the same panels". FF-11's "remount reverses the listener order" no longer happens, so its own fix (stopImmediatePropagation / capture) is needed. See FA-30 for the flags panel.

### FA-30 · The flags panel renders `ctx.flags` once at mount, so it shows the pre-welcome set

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/flags/index.ts` (`render()` reads `ctx.flags` / `services.flagsSource` only at mount and on a header click), `frontend/game/app/online/featureHud.ts` (FA-29: no re-mount when only the flags change)
- **What happens:** since FA-29 the features are not re-mounted on the first `welcome`, so the dev flag panel keeps showing the pre-welcome chips and "source: default" until it is collapsed / expanded (its click handler re-renders from the live `ctx`). The `flags` console command reads the live values and is right.
- **Why it is like this:** the panel was written for a remount per flag change.
- **To resolve:** (FRONTEND-FEATURES) re-render in the panel's `update()` when `ctx.flags` / `flagsSource` differ from what it drew.
- **Fix:** the panel remembers what it drew (flag set + source) and redraws in `update()` when the live `ctx.flags` / `flagsSource` differ; `frontend/game/features/flags/index.ts`, test `flags.spec.ts` › "redraws on update() when the live flag set or its source changed after mount".
- **Found:** 2026-11-01, frontend-app fix round (side effect of FA-29)

### FA-31 · A live `tune` never reached the client's replica, so prediction stepped with stale data

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (traced; reported by SIM-ENGINE)
- **Area / code:** `frontend/game/store/replica/ReplicaCore.ts` (data compiled once from `welcome.overrides`), `frontend/game/store/WorldStore.ts` (`delta.events` / `event` not passed to the worker), `frontend/game/store/prediction/Predictor.ts`
- **What happens:** the replica compiles its data from the welcome's overrides, so hashes match at join. After a dev `tune` the host runs new data, but the client's replica (and every predicted clone of it) kept the old pipeline until the next welcome: predicted steps used other numbers than the host, e.g. a path search spanning several steps restarted on every predicted step. Only prediction was affected (confirmed state comes from diffs).
- **Fix:** `WorldStore` forwards each `dev.tuned` event (in a delta or a bare `event`) to the worker as `{ t: 'tune' }` before the delta; `Predictor.retune` → `ReplicaCore.retune` applies a `set` to the welcome's effective overrides (`store/replica/tuneEvent.ts`), recompiles, checks the hash against the event's `dataHash` and swaps the replica host's pipeline keeping its state. A `reset` (the client knows base ⊕ live, not the base), a rejected path or a hash mismatch makes the worker ask for a fresh welcome (re-join). `simData()` follows a `set` too. Test: `store/replica/tune.spec.ts` (replica rebuild keeps state and later deltas apply; mismatch / reset → resync join).
- **Found:** 2026-11-01, SIM-ENGINE via the lead (fix round)

### FA-32 · The client did not know the hardened server's answers: `/me/home` 503 / 429, `bye 4003 not_your_planet`, non-ACTIVE homes

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/bootOnline.ts` (`fetchHomeWithRetry`, `normalizeHomePayload`, `backendUnreachable`), `frontend/game/net/closeCodes.ts`, `frontend/game/net/bannerText.ts`, `frontend/game/app/online/OnlineSession.ts` (`onSocketState`); server: BE-14 (`503 HOME_UNAVAILABLE`), BE-17 (`429 rate_limited`), WS-12 (`bye 4003 not_your_planet`), BE-11/BE-12 (`bye 4012 planet_down`), BE-21 (`co_<ULID>` colony ids, `newPlanetTypes`)
- **What happens:** a `503 HOME_UNAVAILABLE` (the home planet is still loading) counted as "server unreachable", so a dev build silently fell back to a local planet and production showed an error at once; `429` was an error at once. Any `/me/home` answer was read field by field with literal defaults (`pl_dev`, `golden-1`, radius 56, `col_0`), so a `NEW` / `ELIMINATED` / `PLANET_ENDED` home booted a made-up colony on `pl_dev`. `bye 4003 not_your_planet` was treated like an expired token (one reconnect, then terminal "Couldn't join colony"), and in a dev build the terminal socket was replaced by the local fallback, hiding the refusal.
- **Why it is like this:** the client predates those server answers.
- **Fix:** `/me/home` retries `503 HOME_UNAVAILABLE` and `429` with the reconnect backoff (0.5, 1, 2, 4 s; `HOME_ATTEMPTS` = 5 tries, splash status "Home planet is starting, retrying (n/4)…" / "Orbit is busy…"), then fails with a `BootError` carrying the server's `errorCode`; `backendUnreachable` is true only for no answer or a 5xx without the server's error envelope, so a server-named 5xx is an error splash with Retry, never the dev fallback. The answer is parsed with the contract (`HomeResponse`): `co_<ULID>` and legacy `col_…` ids pass through, only `ACTIVE` boots, other states are a `BootError` naming the state and the offered `newPlanetTypes` (`['desert']`), a malformed answer is `BAD_HOME`; no literal planet / colony defaults are left (the local fallback uses `DEV_PLANET_RADIUS` / `DEV_PLANET_SEED` / `DEV_PLANET_CAPACITY` from `@terra/sim`). `closeAction(code, reason)`: `4003 not_your_planet` is terminal at once with the banner "Not your colony's planet" (`terminalText`), other `4003` still reconnect once; `4012 planet_down` reconnects with backoff. The dev local fallback is skipped for `not_your_planet`. Tests: `guestBoot.spec.ts` › "/v1/me/home answers of the hardened server" (3 tests), `WsTransport.spec.ts` › "WsTransport server refusals" (2 tests), `OnlineSession.lifecycle.spec.ts` › "bye 4003 not_your_planet is shown, never replaced by the dev local fallback"; boot fixtures now come from `app/online/homeFixture.ts` (server-shaped `ACTIVE` home with a `co_<ULID>` id).
- **Found:** 2026-11-01, final frontend pass (server changes of the BACKEND fix round)

### FA-33 · `?host=local` dropped a handler's reject detail and kept stepping a planet whose step threw

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/local/LocalHostCore.ts` (`stepOnce`, `fail`, `restore`, `answer`, `command`, `save`), `frontend/game/store/WorldStore.ts` (`LocalHost.step`); sim GP-31 (`{ code, detail }` rejects), LED-09 (`SimHost.step` publishes the failed step's outcomes and postings, then rethrows `StepError`); server BE-12
- **What happens:** `cmd.reject` from the browser hosts carried a detail only for codes outside the contract, so the placement block text the sim now returns (GP-31) never reached the Hub menu. A throwing step was logged and the scheduler stepped the half-changed planet again; the outcomes `SimHost` had already published for the failed step were acked although the state they applied to was broken, and the periodic save could persist that state.
- **Fix:** `answer()` copies `outcome.detail` (cut to `REJECT_DETAIL_MAX`); a code outside the contract is `internal` with `code: detail` as detail. The in-process `LocalHost` copies `detail` too. A step's outcomes are buffered and answered only after it completed; a throwing step does what the server does (BE-12): its commands and those queued since are rejected `internal` (no ack), the planet leaves the scheduler, commands meanwhile answer `host_unavailable`, saves are skipped, and the planet is restored from its last snapshot (else a fresh scenario planet) and re-welcomed (`resync`), at most `MAX_STEP_RESTORES` = 3 times per host (the server: 3 per 10 min); after that it stays down. Tests `LocalHostCore.spec.ts` › "a handler's { code, detail } reaches the client's cmd.reject", "a step that throws rejects its commands internal (no ack), restores the last snapshot and re-welcomes", "after 3 restores a failing planet stays down; saves never persist it".
- **Limitation (closed by FA-07):** the in-process `LocalHost` (dev fallback) let a throwing step escape its `setInterval`; it now runs on `LocalHostCore` and handles a failed step as above (`app/online/localFallback.spec.ts`).
- **Found:** 2026-11-01, final frontend pass (sim contract changes of the SIM-GAMEPLAY fix round)

### FA-34 · Three copies of the "typing into a text field" key guard

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/viewportHelper.ts` (`isEditableTarget`), `frontend/game/app/online/unitControl.ts` (inline check), `frontend/game/dev/console/DevConsole.ts` (inline check), `frontend/game/features/shared/hotkeys.ts` (`isTypingTarget`, FF-07)
- **What happens:** the session keys, the unit stop key and the dev console each had their own tag list next to the features' shared guard.
- **Fix:** one guard: `isTypingTarget` / `isHotkeyPress` in `features/shared/hotkeys.ts`; `OnlineSession.bindKeys`, `unitControl` (X stop key: `isHotkeyPress`) and the dev console key use it; `isEditableTarget` is deleted. Existing tests green (`OnlineSession.lifecycle.spec.ts` › "FA-11…", `terraform-basic.spec.ts` hotkeys).
- **Found:** 2026-11-01, FF-07 fix report

### FA-35 · The in-process fallback host runs on the main thread and its sim events never reach the HUD

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/store/local/LocalHost.ts` (`fromCore`: views are pushed with `WorldStore.pushView`), `frontend/game/app/online/OnlineSession.ts` (`attachLocalHost`), `frontend/game/store/WorldStore.ts` (`onServerEvents` only fires from transport messages)
- **What happens:** since FA-07 the dev fallback (no game server, dev builds only, FA-06) runs the same `LocalHostCore` as `?host=local`, but on the page: its `PlanetScheduler` timers are throttled when the tab is in the background, and the session's store reads the authoritative state directly instead of applying diffs in the replica worker (no prediction). The `event` messages and `delta.events` it sends reach the session's command bus and warp bookkeeping, but not `WorldStore.onServerEvents`, so event toasts and alerts never show on the fallback (as before FA-07).
- **Why it is like this:** the fallback is attached to a session whose store is already bound to the `WsTransport`; feeding the core's messages into that store (or moving the core into a Worker) needs a transport swap inside a running session.
- **Workaround / mitigation:** dev builds only, and only while the game server is down; `?host=local&scenario=w01` runs the full worker path with toasts and prediction.
- **To resolve:** attach the fallback as a `LocalTransport` over a `LocalHostController` (direct link, or a Worker with a "seat colony at slot" source) and let the store consume it like any transport; or give `WorldStore` a `pushServerEvents` for the in-process host.
- **Found:** 2026-11-01, FA-07 fix

## W02 review rounds 1–2 (2026-11-03)

### FA-36 · Two unused client paths write the replica's tile layers

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (grep: no production caller)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:243-245` (`applyTilePatch`), `frontend/game/app/online/viewportHelper.ts:156-160` (`applyChangedTileList` → `HexTerrain.setTileState`), `frontend/render/planets/hex/createHexTerrain.ts` (`setTileState` → `applyTileStateMutation` on the terrain's current `tiles`); debug handle `window.__online` (`frontend/game/app/Game.ts:218,317`); RN-35
- **What happens:** `applyTilePatch` sends a list of tile changes through `applyChangedTileList`, which calls `setTileState` per tile: it writes terrain / prep / height / deposit / richness into the layers the terrain currently holds, which are the replica's last tile snapshot, and rebuilds the planet once per tile (RN-35). Nothing in the game calls it any more (the session applies snapshots with `applyTerrainTileChanges` → one `updateTiles`), but it is reachable from the console as `__online.applyTilePatch(...)`, and a call makes the drawn ground and the replica's tiles disagree with the host (AGENTS §6: the client never mutates world state).
- **Why it is like this:** the per-tile path predates the single incremental update of RN-35 and was kept as a public method.
- **Workaround / mitigation:** dev handle only.
- **To resolve:** delete `applyTilePatch` and `applyChangedTileList` (`HexTerrain.setTileState` stays: the playground's `content/HexSampleHost.ts` uses it on its own sample terrain).
- **Found:** 2026-11-03, W02 review round 1 (frontend agent)

### FA-37 · Playground dialog hide state is not in the URL

- **Status:** Accepted (by design)
- **Area / code:** `frontend/playground/panels/dock.ts`, `Sidebar.ts` (`expanded`)
- **What happens:** LIST, INFO, CONTROLS, and LIGHTS in the centered header toggle their dialog. A lit tab means the dialog is open. A second click collapses it until the tab is pressed again, or until reload. A reload opens every dialog again. Hive-life and group march are tabs inside the object list (HIVE, MARCH, UNITS), not separate dialogs. Object groups (robot, building, ship, resource, fauna, prop) start collapsed. While the search box has text, every group that still has matches is forced open, and clicking its header does not collapse it. Clearing the search returns to the groups opened by hand (none, on a fresh load). Collapsing the lights editor leaves the night preview on; `L` and the Work-tab lights toggle still turn the feature off, and turning it back on opens the editor.
- **Why it is like this:** the playground URL stays the inspect and scene parameters. Hide and expand are session chrome, not a shareable scene.
- **Workaround / mitigation:** The header tabs are the hide and show control. `/` opens the object list, selects UNITS, and focuses search.
- **To resolve:** only if a shared link should reopen a collapsed layout. Add explicit parameters then; do not infer them from the search box.
- **Found:** 2026-11-04, playground dialog pass

### FA-38 · Sparse fauna motion was not reconstructed on the live client path

- **Status:** Resolved (2026-11-07 working-tree motion reconstruction; commit pending)
- **Area / code:** `frontend/game/store/replica/ReplicaCore.ts`, `shared/sim/src/host/faunaMotionReplica.ts`, `shared/sim/src/codec/faunaMotionSeed.ts`
- **What happens:** Client diffs suppress routine fauna transforms until the 25-tick correction, but the old live replica only applied diffs. The tested directive helper was not connected to that path. With prediction disabled or no player command pending, ants could retain stale positions between corrections.
- **Why it is like this:** In-process parity helpers exercised additional replay calls that production delivery did not execute.
- **Resolution:** ReplicaCore reconstructs motion through a separate shared simulation service, using existing fauna movement/routing rules. Welcome snapshots include filtered fauna routes, commands and timing; authoritative rows win every correction. A sparse material-route journal preserves authority timing under colony path-search competition; the 80-HQ stress regression, batched frames and cancellations now match exactly. Private route/search state is filtered from renderer-bound worker views. Tests use the actual worker/replica path for both server and local hosts, including prediction, mid-walk joins, terrain edits, tuning and recovery.
- **Workaround / mitigation:** A newly received directive for an already-simulated tick requests a fresh welcome rather than mutating history without the full historical command stream. Migrated saves and current-protocol welcomes without the optional seed remain loadable and converge at the next correction; modern servers include the seed. Live protocol versions still must match (FA-39). The service is not a complete replay of other colonies’ historical commands or path-budget competition.
- **To resolve:** No known routine-motion fix pending. Add complete historical command inputs only if historical rollback is preferred over authoritative resynchronization.
- **Found:** 2026-11-07, full W07 review and a failing production-path motion regression.

### FA-39 · Combat wire changes require an explicit client-version boundary

- **Status:** Resolved (2026-11-07 working-tree protocol versioning and save migration; commit pending)
- **Area / code:** `shared/sim/src/host/diff.ts`, `shared/sim/src/kernel/constants.ts`, `shared/sim/src/codec/migrations/index.ts`, `frontend/game/store/local/snapshotStore.ts`, `frontend/game/net/VersionMismatchNotice.ts`
- **What happens:** Without a version change, an older client accepts the new compact diff envelope but ignores its projectile and stance fields, retaining stale combat state.
- **Why it is like this:** Canonical snapshot layout stayed compatible while the live diff format changed; snapshot compatibility alone did not identify the new wire contract.
- **Resolution:** Diff format 2 and simulation version 3 reject incompatible live peers. An immutable identity migration from save version 2 preserves existing canonical snapshots; local resume recognizes the supported migration while retaining hash and flag checks. A visible mismatch notice offers an explicit reload, preserves the active scenario planet via its join URL, and cleans up with the session.
- **Workaround / mitigation:** Already-loaded older JavaScript cannot gain the new notice retroactively. Refresh that page manually after restarting the stack. No automatic reload loop is introduced.
- **To resolve:** No current-client fix pending. Deploy compatible frontend/backend versions together.
- **Found:** 2026-11-07, independent final codec review.
