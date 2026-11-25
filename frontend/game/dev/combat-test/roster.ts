import { ENTITY_KIND } from '@terra/sim';
import type { ClientView } from '../../store/replica/viewCodec';
import { forEachEntity } from '../../store/replica/viewCodec';

export interface RosterSnapshot {
  playerUnits: number;
  playerBuildings: number;
  botColonies: Array<{ index: number; name: string }>;
  botEntities: number;
  insects: number;
  hives: number;
  firstBotTile: { q: number; r: number } | null;
  firstHiveTile: { q: number; r: number } | null;
  stagingTile: { q: number; r: number };
}

export const HIVE_KINDS = new Set<number>([
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);

const BUG_KINDS = new Set<number>([
  ENTITY_KIND.blackAnt,
  ENTITY_KIND.blueBeetle,
  ENTITY_KIND.greenSpitter,
]);

const MOBILE_UNIT_KINDS = new Set<number>([
  ENTITY_KIND.hq,
  ENTITY_KIND.worker,
  ENTITY_KIND.recon,
  ENTITY_KIND.demoTank,
  ENTITY_KIND.demoArtillery,
]);

export function summarizeRoster(view: ClientView | null | undefined): RosterSnapshot {
  const ct = (view?.blobs?.combatTest as { staging?: { q: number; r: number } } | undefined)?.staging;
  const out: RosterSnapshot = {
    playerUnits: 0,
    playerBuildings: 0,
    botColonies: [],
    botEntities: 0,
    insects: 0,
    hives: 0,
    firstBotTile: null,
    firstHiveTile: null,
    stagingTile: ct ?? { q: 0, r: 0 },
  };
  if (!view) return out;
  const activeBotOwners = new Set<number>();
  forEachEntity(view.entities, view.count, (e) => {
    if (e.hp <= 0) return;
    if (HIVE_KINDS.has(e.kind)) {
      out.hives++;
      if (!out.firstHiveTile) out.firstHiveTile = { q: e.q, r: e.r };
      return;
    }
    if (BUG_KINDS.has(e.kind)) {
      out.insects++;
      return;
    }
    if (e.owner === 0) {
      if (MOBILE_UNIT_KINDS.has(e.kind)) out.playerUnits++;
      else out.playerBuildings++;
    } else if (e.owner > 0) {
      out.botEntities++;
      activeBotOwners.add(e.owner);
      if (!out.firstBotTile) out.firstBotTile = { q: e.q, r: e.r };
    }
  });
  for (const c of view.colonies ?? []) {
    if (!c || c.index <= 0 || c.status === 'eliminated') continue;
    const isBot = Boolean((c as { isBot?: boolean }).isBot) || activeBotOwners.has(c.index);
    if (!isBot) continue;
    out.botColonies.push({ index: c.index, name: c.name || `Bot ${c.index}` });
  }
  return out;
}
