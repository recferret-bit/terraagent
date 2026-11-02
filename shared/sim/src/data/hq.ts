import { defineTable } from './_define';

/**
 * HQ Commander Drone T1 (`UO-HQ-01..03`, `UO-HQ-06`) and starting landing kit (§6.4 S0, W01-09).
 * One field per value (XC-01): fields in `units` are read in compiled units (ticks, per tick); readers convert back to
 * seconds only where a UI shows seconds.
 */
export default defineTable({
  name: 'hq',
  summary: 'HQ Commander Drone T1 stats, power cell parameters, and starting pod cargo (W01).',
  units: {
    speedTilesPerS: 'perSecond',
    cellSelfRechargePerS: 'perSecond',
    cellFastRechargePerS: 'perSecond',
    podDescentS: 'seconds',
    podLandMinS: 'seconds',
    autoPlaceIdleS: 'seconds',
    stopHoldS: 'seconds',
    retryBlockedS: 'seconds',
    retryBlockedMaxS: 'seconds',
  },
  amounts: ['cargo'],
  rows: [
    {
      id: 't1',
      wave: 'W01',
      tier: 1,
      hp: 900,
      speedTilesPerS: 1.6,
      radius: 0.6,
      viewRadius: 9,
      workRate: 1.5,
      supply: 0,
      gridDrawPerS: 0,
      maxBuildTier: 1,
      cellCapacity: 800,
      cellSelfRechargePerS: 3,
      cellFastRechargePerS: 20,
      cellFastRechargeRadius: 6,
      cellFastRechargeShedGroup: 3,
      selfPreservationHpRatio: 0.4,
      dps: 12,
      weaponRange: 5,
      // Work reach (hex tiles): the HQ walks until the work tile / site centre is within [min, max] tiles, then works.
      terraformReachMin: 1,
      terraformReachTiles: 2,
      buildReachMin: 2,
      buildReachTiles: 3,
      // After `stop` the HQ ignores queued work for this long; work it could not reach is retried after this long.
      stopHoldS: 5,
      retryBlockedS: 5,
      // Unreachable work is retried after `retryBlockedS`, doubling per further failure up to this many seconds (GP-21).
      retryBlockedMaxS: 60,
      // Terraform lane limits per colony (GP-02): open manual orders (a Hub's linked prep does not count) and queued
      // jobs over all orders. Over either, `enqueueTask` is rejected `queue_full`.
      terraformMaxOrders: 16,
      terraformMaxJobs: 1024,
      archetype: 'robot.hero',
    },
    {
      id: 'startingKit',
      wave: 'W01',
      podDescentS: 6,
      // A player's `landPod` opens the pod once it has descended this long (the client's touchdown animation).
      podLandMinS: 5,
      autoPlaceIdleS: 60,
      // Min hex distance between two colonies' landing pods; also: one landing per colony (`already_landed`).
      minLandingSeparation: 6,
      // The landing pod entity's hit points.
      podHp: 500,
      // Storage cap per resource family before the colony's Hub is built (the pod's hold). A Hub never lowers a cap.
      storageCaps: { metals: 600, minerals: 500, bio: 500 },
      // Before its Hub claims territory, a colony may terraform unclaimed tiles only within this many tiles of its
      // landing (linked Hub prep is not limited); afterwards only its own territory.
      preHubTerraformRadius: 10,
      // A Hub is placed within this many tiles of the colony's landing, and at least `minLandingSeparation` tiles
      // from every other colony's landing pod and Hub.
      hubMaxDistFromLanding: 12,
      cargo: {
        'metals.t1': 600,
        'metals.t2': 0,
        'metals.t3': 0,
        'minerals.t1': 350,
        'minerals.t2': 0,
        'minerals.t3': 0,
        'bio.water': 200,
        'bio.biomass': 200,
        'bio.t2': 0,
        'bio.t3': 0,
      },
    },
  ],
});
