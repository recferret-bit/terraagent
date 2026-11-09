import { InsectPresentation, isInsectMelee } from './InsectPresentation';
import { faunaMuzzle } from './faunaMuzzles';
import * as THREE from 'three';
import { computeArcHeight, resolveVfxWeaponKind } from '../visuals/projectiles/ProjectileVfxSystem';
import type { ProjectileFiredVfxInput, ProjectileImpactVfxInput } from '../visuals/projectiles/types';
import { getWeaponRig, WeaponRig } from './WeaponRig';
import { WeaponRigRegistry } from './weaponRigs';
import { meshAimPoint, point3, surfaceContact, type ShotContact } from './shotContact';

interface TargetState { targetId: number | null }
interface ShotHold {
  target: THREE.Vector3; targetId?: number; root?: THREE.Vector3; lift: number;
  kind: ReturnType<typeof resolveVfxWeaponKind>; arc?: 'direct' | 'indirect';
}
/** Presentation adapter shared by the game and gallery. Rules remain in the sim orchestrator. */
export class BattlePresentation {
  readonly insects = new InsectPresentation();
  private readonly rigs = new Map<number, WeaponRig>();
  private targets: Record<number, TargetState> = {};
  private readonly holds = new Map<number, ShotHold>();
  private readonly contacts = new Map<string, ShotContact>();
  private sequence = 0;

  constructor(private readonly meshFor: (id: number) => THREE.Object3D | undefined) {}

  sync(raw: unknown): void {
    const slot = raw as { value?: unknown } | undefined;
    const data = (slot?.value ?? raw) as { byEntityId?: Record<number, TargetState> } | undefined;
    this.targets = data?.byEntityId ?? {};
  }

  update(dt: number): void {
    this.insects.update(dt);
    for (const key of Object.keys(this.targets)) this.rig(Number(key));
    for (const [id, rig] of this.rigs) {
      if (this.meshFor(id) !== rig.mesh) { this.rigs.delete(id); this.holds.delete(id); continue; }
      const hold = this.holds.get(id);
      const targetId = this.targets[id]?.targetId;
      if (hold && (targetId === undefined || targetId === hold.targetId)) {
        this.trackHold(rig, hold);
        rig.aim(hold.target, hold.lift);
      } else {
        this.holds.delete(id);
        const target = targetId == null ? undefined : this.meshFor(targetId);
        rig.aim(target ? meshAimPoint(target) : null);
      }
      rig.update(dt);
    }
  }

  /** Preserve firing elevation between shots; only the barrel slides during recoil. */
  private trackHold(rig: WeaponRig, hold: ShotHold): void {
    const mesh = hold.targetId === undefined ? undefined : this.meshFor(hold.targetId);
    if (!mesh || !hold.root) return;
    const root = mesh.getWorldPosition(new THREE.Vector3());
    if (root.distanceToSquared(hold.root) < 1e-10) return;
    hold.target.add(root.clone().sub(hold.root));
    hold.root.copy(root);
    if (hold.kind !== 'laser') {
      const from = rig.muzzle();
      hold.lift = 4 * computeArcHeight(hold.kind, from.y, hold.target.y,
        Math.hypot(hold.target.x - from.x, hold.target.z - from.z), hold.arc);
    }
  }

  /** Align before emission, then sample the exact GPU muzzle including terrain placement. */
  shot(attackerId: number, input: ProjectileFiredVfxInput): ProjectileFiredVfxInput {
    const rig = this.rig(attackerId);
    const targetId = input.targetId ?? this.targets[attackerId]?.targetId ?? undefined;
    if (input.firedTick !== undefined) this.insects.release(attackerId, input.firedTick, targetId);
    const mesh = targetId === undefined ? undefined : this.meshFor(targetId);
    const kind = resolveVfxWeaponKind(input);
    const key = this.key(attackerId, { ...input, targetId });
    const aim = mesh ? meshAimPoint(mesh) : point3(input.to);
    const shooter = this.meshFor(attackerId);
    const origin = rig ? rig.muzzle() : (shooter ? faunaMuzzle(shooter, aim) : null) ?? point3(input.from);
    const initialArc = kind === 'laser' ? 0 : computeArcHeight(kind, origin.y, aim.y,
      Math.hypot(aim.x - origin.x, aim.z - origin.z), input.arc);
    const contact = surfaceContact(mesh, origin, aim, 4 * initialArc, key);
    this.contacts.set(key, contact);
    if (this.contacts.size > 512) this.contacts.delete(this.contacts.keys().next().value!);
    const target = contact.at;
    if (!rig) {
      const shooter = this.meshFor(attackerId);
      const from = shooter ? faunaMuzzle(shooter, target) : null;
      return { ...input, to: target, ...(from ? { from } : {}) };
    }
    const fired = rig.fire(target, 0, kind !== 'laser');
    let from = fired.from;
    let arcHeight = 0;
    for (let i = 0; i < 8 && kind !== 'laser'; i++) {
      arcHeight = computeArcHeight(kind, from.y, target.y, Math.hypot(target.x - from.x, target.z - from.z), input.arc);
      rig.aim(target, 4 * arcHeight);
      from = rig.muzzle(fired.barrel);
      if (arcHeight === 0) break;
    }
    this.holds.set(attackerId, { target: target.clone(), targetId, kind, arc: input.arc, lift: 4 * arcHeight,
      root: mesh?.getWorldPosition(new THREE.Vector3()) });
    return { ...input, from, to: target, arcHeight,
      source: () => rig.muzzle(fired.barrel), direction: () => rig.direction(fired.barrel) };
  }

  impact(attackerId: number, input: ProjectileImpactVfxInput): ProjectileImpactVfxInput {
    if (input.hit !== false && input.targetId !== undefined) this.insects.hit(input.targetId);
    if (isInsectMelee(input.weaponId)) input = { ...input, weaponKind: 'bullet' };
    const key = this.key(attackerId, input);
    const contact = this.contacts.get(key);
    this.contacts.delete(key);
    if (input.hit === false) return { ...input, at: { ...input.at, y: input.groundY ?? input.at.y }, normal: { x: 0, y: 1, z: 0 } };
    if (contact) return { ...input, at: contact.at, normal: contact.normal };
    const mesh = input.targetId === undefined ? undefined : this.meshFor(input.targetId);
    if (!mesh) return input;
    const shooter = this.meshFor(attackerId);
    const from = shooter ? meshAimPoint(shooter) : point3(input.at).add(new THREE.Vector3(-1, 1, 0));
    const fallback = surfaceContact(mesh, from, meshAimPoint(mesh), 0, key);
    return { ...input, at: fallback.at, normal: fallback.normal };
  }

  getRig(id: number): WeaponRig | undefined { return this.rig(id); }
  clear(): void { this.insects.clear(); this.rigs.clear(); this.holds.clear(); this.contacts.clear(); this.targets = {}; }

  private key(attacker: number, input: { targetId?: number; impactTick?: number; weaponId?: string }): string {
    return `${attacker}:${input.targetId ?? 0}:${input.weaponId ?? ''}:${input.impactTick ?? this.sequence++}`;
  }

  private rig(id: number): WeaponRig | undefined {
    const mesh = this.meshFor(id);
    if (!mesh) return undefined;
    const cached = this.rigs.get(id);
    if (cached?.mesh === mesh) return cached;
    const definition = WeaponRigRegistry.get(mesh.userData.archetypeId ?? mesh.name);
    if (!definition) return undefined;
    const rig = getWeaponRig(mesh) ?? new WeaponRig(mesh, definition);
    this.rigs.set(id, rig);
    return rig;
  }
}
