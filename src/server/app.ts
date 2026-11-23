import {
  bearerAuthChallengeResponse, createMcpHandler, getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken, type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { config } from '../config.ts';
import { principalFrom } from '../auth/principal.ts';
import { buildMcpServer } from './mcp.ts';
import type { Deps } from '../tools/runTool.ts';

/**
 * A web-standard fetch(request) app:
 *   1. serves the RFC 9728 protected-resource document,
 *   2. verifies the bearer token (signature, issuer, audience, expiry) BEFORE any MCP parsing,
 *   3. hands the verified AuthInfo to the MCP handler, which builds a per-request server.
 * The client's token is never forwarded anywhere.
 */
export function createApp(deps: Deps, verifier: OAuthTokenVerifier) {
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(config.resource);
  const mcp = createMcpHandler(ctx => buildMcpServer(deps, principalFrom(ctx.authInfo)));

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === new URL(metadataUrl).pathname) {
        return Response.json({
          resource: config.resource.href,
          authorization_servers: [config.issuer],
          scopes_supported: ['wms.stock.read', 'wms.locations.read', 'wms.tasks.read', 'wms.tasks.write'],
          bearer_methods_supported: ['header'],
        });
      }
      if (url.pathname !== config.resource.pathname) return new Response('Not found', { status: 404 });

      let authInfo;
      try {
        authInfo = await verifyBearerToken(request.headers.get('authorization'), {
          verifier,
          expectedResource: config.resource,
          resourceMetadataUrl: metadataUrl,
        });
      } catch (err) {
        return bearerAuthChallengeResponse(err, { resourceMetadataUrl: metadataUrl });
      }
      return mcp.fetch(request, { authInfo });
    },
    close: () => mcp.close(),
  };
}
