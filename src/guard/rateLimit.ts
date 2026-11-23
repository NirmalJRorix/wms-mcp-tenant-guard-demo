/** Fixed-window limit per (tenant, user, tool). Enough to stop a looping agent. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  private perMinute: number;
  private now: () => number;
  constructor(perMinute: number, now: () => number = Date.now) { this.perMinute = perMinute; this.now = now; }

  allow(tenantId: string, userId: string, tool: string): boolean {
    const key = `${tenantId}|${userId}|${tool}`;
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) { this.windows.set(key, { start: t, count: 1 }); return true; }
    w.count += 1;
    return w.count <= this.perMinute;
  }
}
