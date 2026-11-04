import { computeColonyTerraformStats, type ColonyTerraformStats, type ViewColony } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { makeDiv, makeSpan } from '../shared/dom';
import { createHudIcon } from './hudIcons';
import { bindHoverPopover } from './resourceBreakdown';

export const TERRAFORM_BONUS_HINT = 'Living ground: +10 % ground move speed · +5 % adjacent extractor output';
export const TERRAFORM_TIER_GATE_HINT = 'T2 at 30 % · T3 at 70 %';

export function readColonyTerraformStats(
  col: ViewColony | undefined,
  view: GameView | undefined,
  colonyIdx: number,
): ColonyTerraformStats {
  const raw = (col as { terraform?: Partial<ColonyTerraformStats> } | undefined)?.terraform;
  let colStats: ColonyTerraformStats | null = null;
  if (raw && typeof raw.livingTiles === 'number' && typeof raw.eligibleOwnedTiles === 'number') {
    const livingTiles = Math.max(0, Math.floor(raw.livingTiles));
    const eligibleOwnedTiles = Math.max(0, Math.floor(raw.eligibleOwnedTiles));
    const percent =
      typeof raw.percent === 'number' && Number.isFinite(raw.percent)
        ? raw.percent
        : eligibleOwnedTiles > 0
          ? Number(((livingTiles / eligibleOwnedTiles) * 100).toFixed(1))
          : 0;
    colStats = { livingTiles, eligibleOwnedTiles, percent };
  }
  const tiles = (view as {
    tiles?: {
      count: number;
      terrain?: ArrayLike<number>;
      prep?: ArrayLike<number>;
      owner?: ArrayLike<number>;
      valid?: ArrayLike<number>;
    };
  } | undefined)?.tiles;
  if (tiles && tiles.terrain && tiles.prep && tiles.owner && tiles.count > 0) {
    const tileStats = computeColonyTerraformStats(
      { tileCount: tiles.count, terrain: tiles.terrain, prep: tiles.prep, owner: tiles.owner, valid: tiles.valid },
      colonyIdx,
    );
    if (tileStats.eligibleOwnedTiles > 0) {
      if (!colStats) return tileStats;
      if (tileStats.livingTiles !== colStats.livingTiles) {
        return tileStats.livingTiles > colStats.livingTiles ? tileStats : colStats;
      }
      return tileStats;
    }
  }
  return colStats ?? { livingTiles: 0, eligibleOwnedTiles: 0, percent: 0 };
}

export function renderTerraformBreakdown(container: HTMLElement, stats: ColonyTerraformStats): void {
  if (!container.querySelector('.ta-res-breakdown__header')) {
    container.replaceChildren();
    const hdr = makeDiv('ta-res-breakdown__header', undefined, 'TERRAFORM');
    const flow = makeDiv('ta-res-breakdown__flow');
    const countLine = makeDiv('ta-res-breakdown__flow-line ta-res-breakdown__net', 'res-terraform-count');
    const bonusLine = makeDiv('ta-res-breakdown__flow-line ta-res-breakdown__income', 'res-terraform-bonus');
    const gateLine = makeDiv('ta-res-breakdown__flow-line', 'res-terraform-gates');
    flow.append(countLine, bonusLine, gateLine);
    container.append(hdr, flow);
  }
  const countEl = container.querySelector('[data-testid="res-terraform-count"]');
  if (countEl) {
    countEl.textContent = `Terraform ${stats.livingTiles} / ${stats.eligibleOwnedTiles} (${stats.percent.toFixed(1)} %)`;
  }
  const bonusEl = container.querySelector('[data-testid="res-terraform-bonus"]');
  if (bonusEl) bonusEl.textContent = TERRAFORM_BONUS_HINT;
  const gateEl = container.querySelector('[data-testid="res-terraform-gates"]');
  if (gateEl) gateEl.textContent = TERRAFORM_TIER_GATE_HINT;
}

export interface TerraformSlot {
  el: HTMLElement;
  val: HTMLElement;
  breakdown: HTMLElement;
}

export function createTerraformSlot(): TerraformSlot {
  const el = makeDiv('ta-hud-min__terraform ta-res-chip', 'hud-terraform');
  el.setAttribute('data-family', 'terraform');
  const val = makeSpan('ta-hud-min__terraform-val', 'hud-terraform-val', 'Terraform 0 / 0 (0.0 %)');
  const breakdown = makeDiv('ta-res-chip__breakdown plate-sm', 'res-breakdown-terraform');
  renderTerraformBreakdown(breakdown, { livingTiles: 0, eligibleOwnedTiles: 0, percent: 0 });
  el.append(createHudIcon('terraform'), val, breakdown);
  bindHoverPopover(el);
  return { el, val, breakdown };
}

