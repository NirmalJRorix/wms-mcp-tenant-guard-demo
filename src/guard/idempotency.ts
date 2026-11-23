/**
 * Idempotency keys are unique per (tenant, key). The first call stores its result;
 * a retry with the same key and same arguments gets the stored result back;
 * the same key with DIFFERENT arguments is an error, not a silent second write.
 *
 * In-memory here. In production: a table with a UNIQUE (tenant_id, key) constraint,
 * written in the same transaction as the task itself.
 */
export type IdemOutcome<T> =
  | { kind: 'fresh' }
  | { kind: 'replay'; result: T }
  | { kind: 'conflict' };

interface Entry<T> { argHash: string; result: T; createdAt: number }

export class IdempotencyStore<T> {
  private entries = new Map<string, Entry<T>>();
  private ttlMs: number;
  private now: () => number;
  constructor(ttlMs: number, now: () => number = Date.now) { this.ttlMs = ttlMs; this.now = now; }

  private k(tenantId: string, key: string) { return `${tenantId}\u0000${key}`; }

  check(tenantId: string, key: string, argHash: string): IdemOutcome<T> {
    const e = this.entries.get(this.k(tenantId, key));
    if (!e || this.now() - e.createdAt > this.ttlMs) return { kind: 'fresh' };
    return e.argHash === argHash ? { kind: 'replay', result: e.result } : { kind: 'conflict' };
  }

  save(tenantId: string, key: string, argHash: string, result: T) {
    this.entries.set(this.k(tenantId, key), { argHash, result, createdAt: this.now() });
  }
}
