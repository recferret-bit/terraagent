/** Exact critically damped scalar response; no overshoot or frame-rate-dependent lerp. */
export class InsectInertia {
  value = 0;
  private velocity = 0;
  snap(value: number): void { this.value = value; this.velocity = 0; }
  step(target: number, dt: number, frequency: number): void {
    if (dt <= 0) return;
    const offset = this.value - target;
    const impulse = this.velocity + frequency * offset;
    const decay = Math.exp(-frequency * dt);
    this.value = target + (offset + impulse * dt) * decay;
    this.velocity = (this.velocity - frequency * impulse * dt) * decay;
  }
}
