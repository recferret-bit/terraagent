import type { Blob, ColonyState, PlanetState } from '../kernel/state';
import { isColonyOwnerField } from './colonySummary';
import { applyPatch, deepClone, diffValue, MAX_PATCH_DEPTH, type ObjPatch } from './structPatch';

/** A patch of one colony record (`changedAt` rides inside `p.s` when it moved). */
export interface ColonyPatchEntry { i: number; p: ObjPatch }

/** Blobs the delta always carries whole: replicas read their decoded value straight from the diff. */
export const WHOLE_DIFF_BLOBS: ReadonlySet<string> = new Set(['faunaDirectives']);

/** The colony and blob sections of one client delta window, computed against what the receivers already hold. */
export interface ShadowWindow {
  /** Colonies the receivers do not hold yet (new, re-founded, or first window after a reset): sent whole to everyone. */
  colonies: ColonyState[];
  /** Summary fields (everything but the owner fields) of changed colonies, for every receiver. */
  colonyPatches: ColonyPatchEntry[];
  /** Owner fields of changed colonies, one entry per colony: only that colony's sockets (and full viewers) get it. */
  own: ColonyPatchEntry[];
  /** Blobs sent whole (new to the receivers, re-shaped, or in `WHOLE_DIFF_BLOBS`). */
  blobs: Record<string, Blob>;
  /** Changed blobs as patches of `{ changedAt, value }`. */
  blobPatches: Record<string, ObjPatch>;
}

const OBJ_PATCH_KEYS = ['s', 'p'] as const;

/** Splits a colony patch into its summary part and its owner part (deletions split the same way). */
function splitColonyPatch(p: ObjPatch): { summary: ObjPatch; owner: ObjPatch } {
  const summary: ObjPatch = {}, owner: ObjPatch = {};
  for (const part of OBJ_PATCH_KEYS) {
    for (const [k, v] of Object.entries(p[part] ?? {})) {
      const into = isColonyOwnerField(k) ? owner : summary;
      ((into[part] ??= {}) as Record<string, unknown>)[k] = v;
    }
  }
  for (const k of p.d ?? []) ((isColonyOwnerField(k) ? owner : summary).d ??= []).push(k);
  return { summary, owner };
}

const isEmptyPatch = (p: ObjPatch): boolean => !p.s && !p.p && !p.d;

/**
 * The sender's copy of what every receiver of a client delta stream holds for colonies and blobs ("what was last
 * sent"). Only the one host send path may advance it (`clientDeltaFrames(…, { shadow })`); a window that does not
 * start where the last one ended (re-subscribe, reload, a failed send) resets it, so that window sends full records.
 * The receivers' copy equals the shadow because both apply the same patches; a welcome snapshot is taken at a delta
 * boundary, where the shadow equals the state for everything sent.
 */
export class ClientDeltaShadow {
  private cols: Array<Record<string, unknown> | undefined> = [];
  private blobs = new Map<string, Blob>();
  private tick = -1;

  /** Forgets everything: the next window sends changed colonies and blobs whole. */
  reset(): void {
    this.cols = [];
    this.blobs.clear();
    this.tick = -1;
  }

  /** The window `fromTick → state.meta.tick` for colonies stamped after `fromTick` and the given changed blobs. */
  window(state: PlanetState, fromTick: number, changedBlobs: Record<string, Blob>): ShadowWindow {
    if (fromTick !== this.tick) this.reset();
    try {
      const out: ShadowWindow = { colonies: [], colonyPatches: [], own: [], blobs: {}, blobPatches: {} };
      for (const c of state.colonies) if (c.changedAt > fromTick) this.colony(c, out);
      for (const [name, b] of Object.entries(changedBlobs)) this.blob(name, b, out);
      this.tick = state.meta.tick;
      return out;
    } catch (e) {
      this.reset(); // half-advanced: nothing of this window was sent
      throw e;
    }
  }

  private colony(c: ColonyState, out: ShadowWindow): void {
    const prev = this.cols[c.index];
    const ch = prev && prev.id === c.id ? diffValue(prev, c, MAX_PATCH_DEPTH + 1) : { set: c };
    if (!ch) return; // nothing at all moved (not even changedAt)
    if ('set' in ch) {
      out.colonies.push(c);
      this.cols[c.index] = deepClone(c) as unknown as Record<string, unknown>;
      return;
    }
    applyPatch(prev, ch.patch, true);
    const { summary, owner } = splitColonyPatch(ch.patch as ObjPatch);
    if (!isEmptyPatch(summary)) out.colonyPatches.push({ i: c.index, p: summary });
    if (!isEmptyPatch(owner)) out.own.push({ i: c.index, p: owner });
  }

  private blob(name: string, b: Blob, out: ShadowWindow): void {
    if (WHOLE_DIFF_BLOBS.has(name)) { out.blobs[name] = b; return; }
    const prev = this.blobs.get(name);
    const ch = prev ? diffValue(prev, b, MAX_PATCH_DEPTH + 1) : { set: b };
    if (!ch) return;
    if ('set' in ch) {
      out.blobs[name] = b;
      this.blobs.set(name, deepClone(b));
      return;
    }
    applyPatch(prev, ch.patch, true);
    out.blobPatches[name] = ch.patch as ObjPatch;
  }
}
