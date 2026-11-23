// All values are for local demos. Real deployments read these from the environment.
export const config = {
  // The URL of this MCP server. Tokens must name it as their audience (RFC 8707).
  resource: new URL(process.env.MCP_RESOURCE ?? 'http://localhost:3333/mcp'),
  // Who is allowed to issue tokens for this server.
  issuer: process.env.TOKEN_ISSUER ?? 'https://login.example.test',
  // Claim names. Change these to match your identity provider.
  tenantClaim: process.env.TENANT_CLAIM ?? 'tenant_id',
  port: Number(process.env.PORT ?? 3333),
  limits: {
    listLocationsPageSize: 50,
    maxCountLocations: 25,
    freeTextMaxChars: 200,
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
    callsPerMinutePerTool: 60,
  },
} as const;
