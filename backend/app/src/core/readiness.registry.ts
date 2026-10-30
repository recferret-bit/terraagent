import { Injectable } from '@nestjs/common';

export type ReadinessCheck = () => unknown | Promise<unknown>;
export type CheckResult = { readonly status: 'fail'; readonly error: string } | unknown;

const CHECK_TIMEOUT_MS = 2000;

/** Modules register named readiness checks here; `GET /v1/readyz` reports each check's value under its name. */
@Injectable()
export class ReadinessRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();

  /** Registers (or replaces) a check. It passes by returning any value and fails by throwing / rejecting. */
  register(name: string, check: ReadinessCheck): void {
    this.checks.set(name, check);
  }

  unregister(name: string): void {
    this.checks.delete(name);
  }

  async run(): Promise<{ ok: boolean; body: Record<string, CheckResult> }> {
    const body: Record<string, CheckResult> = {};
    let ok = true;
    await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        try {
          body[name] = await withTimeout(Promise.resolve().then(check), name);
        } catch (e) {
          ok = false;
          body[name] = { status: 'fail', error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    return { ok, body: Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b))) };
  }
}

function withTimeout<T>(p: Promise<T>, name: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`readiness check "${name}" timed out`)), CHECK_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
