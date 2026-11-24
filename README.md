# wms-mcp-tenant-guard-demo

A minimal MCP server for a multi-tenant warehouse system. It lets an AI agent check stock
and create warehouse tasks, and it is built so that a token for Tenant A cannot read or
change anything that belongs to Tenant B.

This is the companion repo for the blog post
**"Building an MCP Server for a WMS: Letting AI Agents Query Stock and Create Tasks Without Leaking Tenant B's Data"**
([read the post](https://www.rorixtech.com/blogs/building-an-mcp-server-for-a-wms-letting-ai-agents-query-stock-and-create-tasks-without-leaking-tenants-data)).

> **Fake data only.** 2 made-up tenants, a few made-up SKUs and locations, an in-memory store.
> This is a teaching example, not the code behind any production system.

## The 3 rules, and where each one lives

| Rule | What it means | Where to look |
|---|---|---|
| 1. Tenant comes from the token | The server checks the token's signature, issuer, expiry and **audience** (it must be issued for this server). Tenant and user are read from the verified claims. No tool has a `tenant_id` argument, and unknown arguments are rejected. | `src/auth/verifier.ts`, `src/server/app.ts`, `src/tools/definitions.ts` |
| 2. Safe retries, full audit | Write tools need an `idempotency_key`. Keys are unique per tenant. A retry returns the first result; the same key with different arguments is an error. Every call writes 1 audit row. | `src/guard/idempotency.ts`, `src/guard/audit.ts`, `src/tools/runTool.ts` |
| 3. No lethal trifecta | The server reads private data and may return untrusted free text, so it has **no** way to send data out: no email, webhook or URL fetch tools. Free text is off by default and comes back in a labeled field. | `src/tools/untrusted.ts`, `test/trifecta.test.ts` |

Tool hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are set honestly,
but nothing depends on them. Every check is enforced in the server.

## Quick start

Needs Node.js 22.18 or newer (TypeScript runs directly, no build step).

```bash
npm install
npm test            # 20 tests, including Tenant A vs Tenant B
npm start           # MCP server on http://localhost:3333/mcp
npm run token -- a  # prints a 1-hour token for fake Tenant A (use "b" for Tenant B)
```

`npm start` and `npm run token` create a throwaway signing key in `.dev-keys/` (git-ignored)
so the demo works offline. A real deployment trusts your identity provider instead. See
"Adapting this to your system" below.

Connect any MCP client that supports Streamable HTTP and a bearer token header to
`http://localhost:3333/mcp`. The server speaks MCP revision 2026-07-28 and also answers
2025-era clients; the tenant checks are the same on both.

## Tools

| Tool | Type | Scope needed | Idempotency key | Can it... |
|---|---|---|---|---|
| `get_stock_level` | read | `wms.stock.read` | no | read only the caller's tenant; notes only if `include_notes: true` |
| `list_locations` | read | `wms.locations.read` | no | return 50 rows per page, never everything |
| `create_putaway_task` | write | `wms.tasks.write` | **yes** | create a task only; it never moves stock or puts away into a dock |
| `create_cycle_count_task` | write | `wms.tasks.write` | **yes** | count up to 25 locations; never adjusts inventory |
| `get_task` | read | `wms.tasks.read` | no | look up a task ID only inside the caller's tenant |

Every call is limited to 60 per minute per tenant, user and tool.

## What the tests prove

Each test runs a real MCP client against the real handler, in memory. The numbers match the
test list in the blog post.

| # | Test | Expected |
|---|---|---|
| 1 | Tenant A asks for a SKU only Tenant B has (both protocol eras) | `not_found`, and none of B's numbers appear |
| 2 | Tenant A adds `tenant_id: B` to the arguments | rejected; schemas advertise `additionalProperties: false` |
| 3 | Tenant B uses a task ID created by Tenant A | `not_found`, identical to an ID that never existed |
| 4 | Token issued for a different server | HTTP 401 before any MCP parsing |
| 5 | Expired token, no token, token without a tenant | HTTP 401 |
| 6 | Same idempotency key sent twice | 1 task, same result both times |
| 7 | Same key, different quantity | error, still 1 task |
| 8 | Same key used by Tenant A and Tenant B | 2 separate tasks |
| 9 | A note containing "IGNORE PREVIOUS INSTRUCTIONS..." | returned as labeled data; 0 outbound network calls |

Plus: scope denial is audited, every audit row has the same 10 fields and no raw arguments,
a looping agent hits the rate limit, and the tool list contains nothing that can send data out.

**Try breaking it.** Change `stockForSku` in `src/data/store.ts` to search every tenant, then run
`npm test`. 4 tests fail. That is the point of having them.

## Adapting this to your system

| In this demo | In production |
|---|---|
| Local key in `.dev-keys/` | `createRemoteJWKSet(new URL('<your IdP JWKS URL>'))` passed to `createVerifier` |
| `tenant_id` claim | Whatever claim your identity provider uses; set `TENANT_CLAIM` |
| In-memory `WarehouseStore` | Your database, with a tenant column on every table and row-level security, so a missed filter still cannot cross tenants |
| In-memory idempotency map | A table with `UNIQUE (tenant_id, idempotency_key)`, written in the same transaction as the task |
| Audit to stdout | An append-only table or log pipeline your support team can query |
| Fixed-window rate limit in memory | A shared limiter (for example in your gateway), since the server is stateless and runs as many copies |

Environment variables: `MCP_RESOURCE` (this server's public URL, used as the token audience),
`TOKEN_ISSUER`, `TENANT_CLAIM`, `PORT`.

## What this demo does not do

- It is not an authorization server. It does not log users in or issue tokens.
- Calls rejected by the MCP layer's own schema check (for example an unknown `tenant_id` field)
  are refused before our audit step, so they are not audited. Add request logging at the HTTP layer if you need those.
- It cannot stop the trifecta across servers. If a user connects this server and an email tool
  from somewhere else to the same assistant, the risk returns. Say so in your customer docs.
- Truncating and labeling free text lowers prompt-injection risk. It does not remove it.

## Layout

```
src/
  config.ts              limits and claim names
  auth/verifier.ts       token checks: signature, issuer, audience, expiry, tenant claim
  auth/principal.ts      the verified caller (tenant, user, client, scopes)
  data/store.ts          fake tenant-partitioned store
  data/seed.ts           2 fake tenants, including one injection attempt in a note
  guard/                 idempotency, audit, rate limit, argument hashing
  tools/definitions.ts   the 5 tools, their schemas, scopes and hints
  tools/runTool.ts       the pipeline every call goes through
  tools/untrusted.ts     labeling and truncating free text
  server/mcp.ts          registers tools on a per-request MCP server
  server/app.ts          auth gate + MCP handler (web-standard fetch)
  server/http.ts         local Node HTTP server
scripts/                 local-only token minting
test/                    the tests listed above
```

## License

MIT. See `LICENSE`. Security reports: see `SECURITY.md`.
