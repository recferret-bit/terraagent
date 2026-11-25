import { hexDistance, hexIndex, inHex, PREP, TERRAIN } from '@terra/sim';
import type { OnlineSession } from '../../app/online/OnlineSession';
import { forEachEntity } from '../../store/replica/viewCodec';
import { hiveSpeciesForPresetId, type CombatSpawnPreset } from './catalog';
import { HIVE_KINDS, type RosterSnapshot } from './roster';

function isTilePassableForSpawn(terrain: number, prep: number): boolean {
  return (
    terrain !== TERRAIN.deep &&
    terrain !== TERRAIN.shallow &&
    terrain !== TERRAIN.hole &&
    prep !== PREP.ridge &&
    prep !== PREP.moat
  );
}

function resolveFallbackDryTile(
  session: OnlineSession,
  q: number,
  r: number,
): { q: number; r: number } {
  const tiles = session.store.latestTiles;
  const radius = session.store.latest?.planet?.radius ?? 0;
  if (!tiles || radius <= 0) return { q, r };
  const hx = hexIndex(radius);
  for (let dist = 0; dist <= Math.min(20, radius); dist++) {
    for (let dq = -dist; dq <= dist; dq++) {
      for (let dr = -dist; dr <= dist; dr++) {
        if (hexDistance(0, 0, dq, dr) !== dist) continue;
        const cq = q + dq;
        const cr = r + dr;
        if (!inHex(cq, cr, radius)) continue;
        const idx = hx.indexOf(cq, cr);
        if (idx < 0) continue;
        const t = tiles.terrain[idx] ?? TERRAIN.flat;
        const p = tiles.prep[idx] ?? PREP.wild;
        if (isTilePassableForSpawn(t, p)) return { q: cq, r: cr };
      }
    }
  }
  return { q, r };
}

export interface CombatCommandContext {
  readonly session: OnlineSession;
  readonly setStatus: (msg: string) => void;
}

const REFILL_RESOURCES = [
  'metals.t1',
  'minerals.t1',
  'bio.water',
  'bio.biomass',
  'metals.t2',
  'minerals.t2',
  'bio.t2',
] as const;

export function trackCombatCommand(
  pending: unknown,
  label: string,
  okStatus: string,
  setStatus: (msg: string) => void,
): Promise<boolean> {
  return Promise.resolve(pending as { ok?: boolean; code?: string; detail?: string } | undefined)
    .then((res) => {
      if (!res || res.ok !== false) {
        setStatus(okStatus);
        return true;
      }
      setStatus(`Rejected (${label}): ${res.code ?? 'error'}${res.detail ? ` — ${res.detail}` : ''}`);
      return false;
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Failed (${label}): ${msg}`);
      return false;
    });
}

export function dispatchCombatTestSpawn(
  ctx: CombatCommandContext,
  opts: {
    preset: CombatSpawnPreset;
    q: number;
    r: number;
    owner: number;
    count: number;
    insectAggressive: boolean;
    fallbackNear?: boolean;
  },
): void {
  const { preset, q, r, owner, count, insectAggressive, fallbackNear } = opts;
  if (preset.commandKind === 'dev.spawnbuilding') {
    ctx.setStatus(`Spawning ${preset.label} at (${q}, ${r}) · Col ${owner}...`);
    void trackCombatCommand(
      ctx.session.commandBus.send('dev.spawnbuilding', {
        building: preset.id,
        q,
        r,
        owner,
        ...(fallbackNear ? { fallbackNear: true } : {}),
      }),
      preset.label,
      `Spawned ${preset.label} at (${q}, ${r}) · Col ${owner}`,
      ctx.setStatus,
    );
    return;
  }
  const mode = insectAggressive ? 'aggressive' : 'passive';
  const target = fallbackNear ? resolveFallbackDryTile(ctx.session, q, r) : { q, r };
  if (preset.commandKind === 'dev.spawnhive') {
    ctx.setStatus(`Spawning ${preset.label} at (${target.q}, ${target.r})...`);
    void trackCombatCommand(
      ctx.session.commandBus.send('dev.spawnhive', {
        species: hiveSpeciesForPresetId(preset.id),
        q: target.q,
        r: target.r,
        mode,
        initialResidents: 4,
      }),
      preset.label,
      `Spawned ${preset.label} at (${target.q}, ${target.r})`,
      ctx.setStatus,
    );
    return;
  }
  const isBug = preset.category === 'insect';
  ctx.setStatus(`Spawning ${count}x ${preset.label} at (${target.q}, ${target.r})...`);
  void trackCombatCommand(
    ctx.session.commandBus.send('dev.spawnunit', {
      unit: preset.id,
      q: target.q,
      r: target.r,
      count,
      ...(isBug ? { mode } : { owner }),
    }),
    preset.label,
    `Spawned ${count}x ${preset.label} at (${target.q}, ${target.r})${isBug ? ` (${mode})` : ` · Col ${owner}`}`,
    ctx.setStatus,
  );
}

export async function dispatchAllHivesMode(
  ctx: CombatCommandContext,
  mode: 'passive' | 'aggressive',
): Promise<void> {
  const v = ctx.session.store.latest;
  if (!v) return;
  const sends: Promise<unknown>[] = [];
  forEachEntity(v.entities, v.count, (e) => {
    if (e.hp > 0 && HIVE_KINDS.has(e.kind)) {
      sends.push(Promise.resolve(
        ctx.session.commandBus.send('dev.faunamode', { entityId: e.id, mode, colonyIndex: 0 }),
      ));
    }
  });
  const results = (await Promise.all(sends)) as ({ ok?: boolean; code?: string } | undefined)[];
  const failed = results.filter((r) => r && r.ok === false).length;
  ctx.setStatus(
    failed > 0
      ? `Set ${sends.length - failed}/${sends.length} hive(s) to ${mode} (${failed} rejected)`
      : `Set ${sends.length} hive(s) to ${mode}`,
  );
}

export async function dispatchInsectWave(ctx: CombatCommandContext, roster: RosterSnapshot): Promise<void> {
  if (roster.playerUnits + roster.playerBuildings === 0) {
    ctx.setStatus('Spawn at least 1 player unit or building first so insects have a target');
    return;
  }
  ctx.setStatus('Dispatching aggressive insect wave...');
  await trackCombatCommand(
    ctx.session.commandBus.send('dev.spawnraid', { count: 5, colonyIndex: 0 }),
    'Insect wave',
    'Dispatched aggressive insect wave toward staging',
    ctx.setStatus,
  );
}

export async function dispatchRefillAndReveal(ctx: CombatCommandContext): Promise<void> {
  const sends: Promise<unknown>[] = REFILL_RESOURCES.map((resource) =>
    Promise.resolve(ctx.session.commandBus.send('dev.grant', { resource, amount: 25000 })),
  );
  sends.push(Promise.resolve(ctx.session.commandBus.send('dev.reveal', {})));
  const results = (await Promise.all(sends)) as ({ ok?: boolean; code?: string } | undefined)[];
  const rejected = results.find((r) => r && r.ok === false);
  ctx.setStatus(
    rejected
      ? `Refill/Reveal rejected: ${rejected.code ?? 'error'}`
      : 'Refilled stocks (+25k all) & revealed full 56-radius map',
  );
}

export function bindCombatTestPlacement(opts: {
  session: OnlineSession;
  getArmed: () => CombatSpawnPreset | null;
  disarm: () => void;
  spawnAt: (preset: CombatSpawnPreset, q: number, r: number) => void;
  setStatus: (msg: string) => void;
}): () => void {
  const canvas = opts.session.viewport.renderer.domElement;
  let suppressLeftUpUntil = 0;
  let suppressLeftClickUntil = 0;
  let suppressRightUpUntil = 0;
  let suppressContextUntil = 0;

  const onPointerDown = (e: PointerEvent) => {
    const armed = opts.getArmed();
    if (!armed) return;
    if (e.button === 2) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const until = Date.now() + 400;
      suppressRightUpUntil = until;
      suppressContextUntil = until;
      opts.disarm();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const until = Date.now() + 500;
    suppressLeftUpUntil = until;
    suppressLeftClickUntil = until;
    const pick = opts.session.pickAt(e.clientX, e.clientY);
    if (!pick) {
      opts.setStatus('Click onto planet terrain to spawn');
      return;
    }
    opts.spawnAt(armed, pick.q, pick.r);
  };
  const onPointerUp = (e: PointerEvent) => {
    const now = Date.now();
    if (e.button === 0 && (opts.getArmed() || now <= suppressLeftUpUntil)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressLeftUpUntil = 0;
      return;
    }
    if (e.button === 2 && (opts.getArmed() || now <= suppressRightUpUntil)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressRightUpUntil = 0;
    }
  };
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (!opts.getArmed() && Date.now() > suppressLeftClickUntil) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressLeftClickUntil = 0;
  };
  const onContext = (e: MouseEvent) => {
    if (!opts.getArmed() && Date.now() > suppressContextUntil) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressContextUntil = 0;
    if (opts.getArmed()) opts.disarm();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !opts.getArmed()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    opts.disarm();
  };

  canvas.addEventListener('pointerdown', onPointerDown, true);
  canvas.addEventListener('pointerup', onPointerUp, true);
  canvas.addEventListener('click', onClick, true);
  canvas.addEventListener('contextmenu', onContext, true);
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown, true);
    canvas.removeEventListener('pointerup', onPointerUp, true);
    canvas.removeEventListener('click', onClick, true);
    canvas.removeEventListener('contextmenu', onContext, true);
    window.removeEventListener('keydown', onKeyDown, true);
  };
}
