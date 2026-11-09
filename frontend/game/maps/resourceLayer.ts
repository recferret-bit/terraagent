import { DEPOSIT_CODES } from '@terra/contracts/tiles/codes';
import { resolveMapAdapterForView } from './atlasMapAdapter';
import { isMapTileExplored } from './visibility';
import { RESOURCE_LEGEND } from './tileColors';
import type { MapLayerDrawView } from './types';

const DEPOSIT_COLOR: Readonly<Record<number, string>> = {
  [DEPOSIT_CODES.metals]: RESOURCE_LEGEND[0]!.color,
  [DEPOSIT_CODES.minerals]: RESOURCE_LEGEND[1]!.color,
  [DEPOSIT_CODES.oil]: RESOURCE_LEGEND[2]!.color,
};

/**
 * `resources` layer: one outlined dot per explored tile that carries a visible deposit (`tiles.deposit`;
 * the hidden `subDeposit` layer never reaches the client). Returns the number of dots drawn.
 */
export function drawResourcesLayer(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): number {
  const tiles = view.tiles;
  const deposit = tiles?.deposit;
  if (!tiles || !deposit) return 0;
  const adapter = resolveMapAdapterForView(view);
  const drawableTiles = adapter.getDrawableTiles(tiles.count);
  const dot = Math.max(1.6, view.tilePixelRadius * 0.36);
  let drawn = 0;
  ctx.save();
  ctx.lineWidth = Math.max(1, dot * 0.28);
  ctx.strokeStyle = 'rgba(11, 14, 19, 0.9)';
  for (let idx = 0; idx < drawableTiles.length; idx++) {
    const t = drawableTiles[idx]!;
    const i = t.bufferIndex;
    const code = deposit[i] ?? 0;
    if (code === 0) continue;
    if (!isMapTileExplored(view, i)) continue;
    const color = DEPOSIT_COLOR[code];
    if (!color) continue;
    const { x, y } = view.axialToPixel(t.q, t.r);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawn++;
  }
  ctx.restore();
  return drawn;
}
