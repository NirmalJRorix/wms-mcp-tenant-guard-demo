import { generateKeyPair, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { config } from '../src/config.ts';
import { createVerifier } from '../src/auth/verifier.ts';
import { seededStore } from '../src/data/seed.ts';
import { MemoryAudit } from '../src/guard/audit.ts';
import { IdempotencyStore } from '../src/guard/idempotency.ts';
import { RateLimiter } from '../src/guard/rateLimit.ts';
import { createApp } from '../src/server/app.ts';
import type { Deps } from '../src/tools/runTool.ts';

export const ALL_SCOPES = 'wms.stock.read wms.locations.read wms.tasks.read wms.tasks.write';

/** A complete server wired with fake data, an in-memory audit log, and a throwaway signing key. */
export async function setup(opts: { perMinute?: number } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const audit = new MemoryAudit();
  const deps: Deps = {
    store: seededStore(),
    audit,
    idem: new IdempotencyStore(config.limits.idempotencyTtlMs),
    limiter: new RateLimiter(opts.perMinute ?? 1000),
  };
  const app = createApp(deps, createVerifier(publicKey));

  async function token(t: { tenant?: string; aud?: string; exp?: string | number; scope?: string; sub?: string; omitTenant?: boolean } = {}) {
    const claims: Record<string, unknown> = { scope: t.scope ?? ALL_SCOPES, client_id: 'test-client' };
    if (!t.omitTenant) claims[config.tenantClaim] = t.tenant ?? 'demo-tenant-a';
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(config.issuer)
      .setAudience(t.aud ?? config.resource.href)
      .setSubject(t.sub ?? 'user-1')
      .setIssuedAt()
      .setExpirationTime(t.exp ?? '5m')
      .sign(privateKey);
  }

  /** A real MCP client talking to the real handler, in memory (no network). */
  async function client(bearer: string, era: 'modern' | 'legacy' = 'modern') {
    // 'modern' pins protocol revision 2026-07-28 (stateless, no session). 'legacy' speaks 2025-era MCP.
    const c = new Client(
      { name: 'test-client', version: '0.0.0' },
      era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
    );
    const transport = new StreamableHTTPClientTransport(config.resource, {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      fetch: (input: any, init?: any) => app.fetch(new Request(input, init)),
    });
    await c.connect(transport);
    return c;
  }

  /** Raw HTTP call, for checking 401s before any MCP parsing happens. */
  function rawPost(bearer: string | null) {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return app.fetch(new Request(config.resource, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
  }

  return { app, deps, audit, token, client, rawPost };
}

export function body(result: any): any {
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
