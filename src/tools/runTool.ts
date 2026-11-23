import type { Principal } from '../auth/principal.ts';
import type { WarehouseStore } from '../data/store.ts';
import type { AuditRow, AuditSink } from '../guard/audit.ts';
import { argHash } from '../guard/hash.ts';
import type { IdempotencyStore } from '../guard/idempotency.ts';
import type { RateLimiter } from '../guard/rateLimit.ts';
import { toolByName } from './definitions.ts';

export interface Deps {
  store: WarehouseStore;
  audit: AuditSink;
  idem: IdempotencyStore<ToolOutcome>;
  limiter: RateLimiter;
}

export interface ToolOutcome {
  isError: boolean;
  status: AuditRow['status'];
  body: Record<string, unknown>;
}

// One message for "never existed" and "exists in another tenant", so errors leak nothing.
const NOT_FOUND = { error: 'not_found', message: 'Nothing found with that identifier in your warehouse.' };

/**
 * Every tool call goes through here, in this order:
 * scope check -> strict argument check -> rate limit -> idempotency -> handler -> audit row.
 * The tenant comes from `principal`, which came from the verified token.
 */
export async function runTool(deps: Deps, principal: Principal, toolName: string, rawArgs: unknown): Promise<ToolOutcome> {
  const started = performance.now();
  const hash = argHash(rawArgs ?? {});
  let idemKey: string | null = null;
  let replay = false;
  let out: ToolOutcome;

  try {
    const tool = toolByName.get(toolName);
    if (!tool) {
      out = { isError: true, status: 'invalid', body: { error: 'unknown_tool' } };
    } else if (!tool.scopes.every(s => principal.scopes.includes(s))) {
      out = { isError: true, status: 'denied', body: { error: 'insufficient_scope', required: tool.scopes } };
    } else {
      const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        out = { isError: true, status: 'invalid', body: { error: 'invalid_arguments', issues: parsed.error.issues.map(i => i.message) } };
      } else if (!deps.limiter.allow(principal.tenantId, principal.userId, tool.name)) {
        out = { isError: true, status: 'rate_limited', body: { error: 'rate_limited', retry_after_seconds: 60 } };
      } else {
        const args = parsed.data as Record<string, unknown>;
        let prior: ReturnType<typeof deps.idem.check> = { kind: 'fresh' };
        let scopedKey = '';
        let argsHashNoKey = '';
        if (tool.write) {
          idemKey = String(args.idempotency_key);
          const { idempotency_key: _k, ...rest } = args;
          argsHashNoKey = argHash({ tool: tool.name, ...rest });
          scopedKey = idemKey;
          prior = deps.idem.check(principal.tenantId, scopedKey, argsHashNoKey);
        }
        if (prior.kind === 'replay') {
          replay = true;
          out = prior.result;
        } else if (prior.kind === 'conflict') {
          out = { isError: true, status: 'conflict', body: { error: 'idempotency_key_reused', message: 'This idempotency_key was already used with different arguments.' } };
        } else {
          const r = tool.handler(principal, args, deps.store);
          out = r.status === 'ok' ? { isError: false, status: 'ok', body: r.data as Record<string, unknown> }
            : r.status === 'not_found' ? { isError: true, status: 'not_found', body: NOT_FOUND }
            : { isError: true, status: 'invalid', body: { error: 'invalid_request', message: r.message } };
          if (tool.write && out.status === 'ok') deps.idem.save(principal.tenantId, scopedKey, argsHashNoKey, out);
        }
      }
    }
  } catch {
    out = { isError: true, status: 'error', body: { error: 'internal_error' } };
  }

  deps.audit.write({
    at: new Date().toISOString(),
    tenantId: principal.tenantId,
    userId: principal.userId,
    clientId: principal.clientId,
    tool: toolName,
    argHash: hash,
    idempotencyKey: idemKey,
    replay,
    status: out.status,
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
  });
  return out;
}
