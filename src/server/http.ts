import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { localhostAllowedHostnames, hostHeaderValidationResponse } from '@modelcontextprotocol/server';
import { config } from '../config.ts';
import { createVerifier } from '../auth/verifier.ts';
import { seededStore } from '../data/seed.ts';
import { StdoutAudit } from '../guard/audit.ts';
import { IdempotencyStore } from '../guard/idempotency.ts';
import { RateLimiter } from '../guard/rateLimit.ts';
import { loadDevPublicKey } from '../../scripts/dev-keys.ts';
import { createApp } from './app.ts';

// LOCAL DEMO ONLY: trusts a key generated on this machine by `npm run token`.
// In production, pass createRemoteJWKSet(new URL('<your IdP JWKS URL>')) instead.
const verifier = createVerifier(await loadDevPublicKey());

const app = createApp({
  store: seededStore(),
  audit: new StdoutAudit(),
  idem: new IdempotencyStore(config.limits.idempotencyTtlMs),
  limiter: new RateLimiter(config.limits.callsPerMinutePerTool),
}, verifier);

const node = toNodeHandler({
  fetch: async (request: Request) =>
    hostHeaderValidationResponse(request, localhostAllowedHostnames()) ?? app.fetch(request),
});

createServer((req, res) => void node(req, res)).listen(config.port, '127.0.0.1', () => {
  console.error(`MCP server on ${config.resource.href} (fake data, local only)`);
});
