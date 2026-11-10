import { defineTable } from './_define';

/**
 * W18 PvP & Diplomacy balance parameters (`UO-T-05`, `UO-HQ-04`, `UO-TF-05`, `UO-DIP-01..06`, D-35).
 * Design units: `seconds` are converted to ticks (`round(s × 1000 / TICK_MS)`) and `perSecond` to per-tick by `compileData`.
 */
export default defineTable({
  name: 'diplomacy',
  summary:
    'W18 PvP & Diplomacy parameters: truce durations/caps, notice 10 min, Oathbreaker 24 h, shield 6 h, siphon rate, HQ reprint cost/time, critical timer 10 min, ruin decay 1 %/s.',
  units: {
    offerExpiryS: 'seconds',
    hostilityWindowS: 'seconds',
    noticeS: 'seconds',
    oathbreakerS: 'seconds',
    shieldDurationS: 'seconds',
    siphonRatePerS: 'perSecond',
    criticalTimerS: 'seconds',
    ruinDecayRatioPerS: 'perSecond',
    anchorRevertGraceS: 'seconds',
    hqReprintS: 'seconds',
    hqReprintRepeatedS: 'seconds',
    hqReprintRepeatWindowS: 'seconds',
  },
  amounts: ['reprintCost'],
  rows: [
    {
      id: 'truce',
      wave: 'W18',
      durationsHours: [2, 6, 24, 72],
      maxHoursByHqTier: { '1': 24, '2': 72, '3': 72 },
      activeCapsByHqTier: { '1': 1, '2': 2, '3': 4 },
      offerExpiryS: 600,
      hostilityWindowS: 600,
      noticeS: 600,
      oathbreakerS: 86400,
    },
    {
      id: 'pvp',
      wave: 'W18',
      shieldDurationS: 21600,
      shieldDropStage: 4,
      shieldDropStageFull: 6,
      siphonRatePerS: 1,
      siphonCarryCap: 40,
      siphonRangeTiles: 1,
    },
    {
      id: 'elimination',
      wave: 'W18',
      criticalTimerS: 600,
      ruinDecayRatioPerS: 0.01,
      anchorRevertGraceS: 60,
      hqReprintS: 60,
      hqReprintRepeatedS: 90,
      hqReprintRepeatWindowS: 600,
      reprintCost: {
        'metals.t1': 200,
        'minerals.t1': 100,
        'bio.biomass': 50,
        'bio.water': 50,
      },
    },
  ],
});
