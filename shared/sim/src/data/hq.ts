import { defineTable } from './_define';

/**
 * HQ Commander Drone T1 (`UO-HQ-01..03`, `UO-HQ-06`) and starting landing kit (§6.4 S0, W01-09).
 */
export default defineTable({
  name: 'hq',
  summary: 'HQ Commander Drone T1 stats, power cell parameters, and starting pod cargo (W01).',
  units: {
    speedTilesPerS: 'perSecond',
    cellSelfRechargePerS: 'perSecond',
    cellFastRechargePerS: 'perSecond',
    podDescentS: 'seconds',
    autoPlaceIdleS: 'seconds',
    stopHoldS: 'seconds',
    retryBlockedS: 'seconds',
  },
  rows: [
    {
      id: 't1',
      wave: 'W01',
      tier: 1,
      hp: 900,
      speedTilesPerS: 1.6,
      designSpeedTilesPerS: 1.6,
      radius: 0.6,
      viewRadius: 9,
      workRate: 1.5,
      supply: 0,
      gridDrawPerS: 0,
      maxBuildTier: 1,
      cellCapacity: 800,
      cellCapacityE: 800,
      cellSelfRechargePerS: 3,
      designCellSelfRechargePerS: 3,
      selfRechargeEPerS: 3,
      cellFastRechargePerS: 20,
      designCellFastRechargePerS: 20,
      hubRechargeEPerS: 20,
      cellFastRechargeRadius: 6,
      hubRechargeRadius: 6,
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
      archetype: 'robot.hero',
    },
    {
      id: 'startingKit',
      wave: 'W01',
      podDescentS: 6,
      designPodDescentS: 6,
      autoPlaceIdleS: 60,
      designAutoPlaceIdleS: 60,
      // Min hex distance between two colonies' landing pods; also: one landing per colony (`already_landed`).
      minLandingSeparation: 6,
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
