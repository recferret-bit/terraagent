import {
  getDayNightParams,
  isUserScrubbingDayNight,
  onDayNightUserEdit,
  setDayNightExternalSync,
  setDayNightParams,
  type DayNightParams,
} from '@terra/render/core/dayNightConfig';
import { computePlanetTimeAtTick, getPlanetTimeAnchor, type PlanetTimeView } from '@terra/sim';
import type { CommandBus } from '../../net/commandBus';
import type { WorldStore } from '../../store/WorldStore';

const THROTTLE_MS = 120;

export interface OnlineDayNightSync {
  syncFrame(nowMs?: number): PlanetTimeView | null;
  dispose(): void;
}

export interface OnlineDayNightSyncOptions {
  store: WorldStore;
  commandBus: Pick<CommandBus, 'send'>;
  hasColony: () => boolean;
}

/**
 * Keeps the viewport's Day/Night cycle (`@terra/render`) in bidirectional lockstep with the authoritative planet
 * time (`@terra/sim`) across both singleplayer (`?host=local`, `LocalHost`) and multiplayer (`PlanetHost`):
 * - Every frame, interpolates `timeOfDay`, `dayLengthHours`, and `timeScale` from `store.latest` + `store.serverTickF()`.
 * - When the user adjusts `timeOfDay`, `dayLengthHours`, or `timeScale` in the F8 Visual Shader Lab dialog, coalesces
 *   and dispatches `setPlanetTime` / `dev.time` (throttled <= 8 Hz per CL-09) to the authoritative host.
 */
export function bindOnlineDayNightSync(
  storeOrOpts: WorldStore | OnlineDayNightSyncOptions,
  maybeCommands?: Pick<CommandBus, 'send'>,
  maybeHasColony?: () => boolean,
): OnlineDayNightSync {
  const store = 'commandBus' in storeOrOpts ? storeOrOpts.store : storeOrOpts;
  const commands = 'commandBus' in storeOrOpts ? storeOrOpts.commandBus : maybeCommands!;
  const hasSeatedColony = 'commandBus' in storeOrOpts ? storeOrOpts.hasColony : (maybeHasColony ?? (() => false));
  setDayNightExternalSync(true);

  let pending: { timeOfDay?: number; realHoursPerDay?: number; timeScale?: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentMs = -Infinity;
  let inFlight = 0;
  let minSyncTick = -1;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const args = pending;
    pending = null;
    if (!store.latest) return;
    lastSentMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const kind = hasSeatedColony() ? 'setPlanetTime' : 'dev.time';
    inFlight++;
    void commands
      .send(kind, args)
      .then((res) => {
        if (res.ok) minSyncTick = Math.max(minSyncTick, res.appliedAtTick);
      })
      .catch(() => {
        /* ignore transient socket/reject during slider scrub */
      })
      .finally(() => {
        inFlight = Math.max(0, inFlight - 1);
      });
  };

  const queueSend = (patch: Partial<DayNightParams>) => {
    if (patch.timeOfDay === undefined && patch.dayLengthHours === undefined && patch.timeScale === undefined) return;
    pending = {
      ...(pending ?? {}),
      ...(patch.timeOfDay !== undefined ? { timeOfDay: patch.timeOfDay } : {}),
      ...(patch.dayLengthHours !== undefined ? { realHoursPerDay: patch.dayLengthHours } : {}),
      ...(patch.timeScale !== undefined ? { timeScale: patch.timeScale } : {}),
    };
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - lastSentMs;
    if (elapsed >= THROTTLE_MS) {
      flush();
    } else if (timer === null) {
      timer = setTimeout(flush, Math.max(16, THROTTLE_MS - elapsed));
    }
  };

  const offEdit = onDayNightUserEdit((patch) => queueSend(patch));

  return {
    syncFrame(nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()): PlanetTimeView | null {
      const v = store.latest;
      if (!v) return null;
      const data = store.simData() ?? undefined;
      const anchor = getPlanetTimeAnchor(v.blobs, data);
      const pt = computePlanetTimeAtTick(anchor, store.serverTickF(), data);
      const awaitingAck = (inFlight > 0 || v.tick < minSyncTick) && nowMs - lastSentMs < 1500;
      if (!isUserScrubbingDayNight(nowMs) && timer === null && !awaitingAck) {
        const cur = getDayNightParams();
        const hourDiff = Math.abs(cur.timeOfDay - pt.hour);
        const dayLenDiff = Math.abs(cur.dayLengthHours - pt.realHoursPerDay);
        const scaleDiff = Math.abs(cur.timeScale - pt.timeScale);
        if (hourDiff > 1e-3 || dayLenDiff > 1e-4 || scaleDiff > 1e-4) {
          setDayNightParams(
            {
              timeOfDay: pt.hour,
              dayLengthHours: pt.realHoursPerDay,
              timeScale: pt.timeScale,
            },
            'sync',
          );
        }
      }
      return pt;
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      offEdit();
      setDayNightExternalSync(false);
    },
  };
}
