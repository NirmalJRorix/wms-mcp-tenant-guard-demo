import { jwtVerify, type JWTVerifyGetKey, type CryptoKey, type KeyObject } from 'jose';
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { config } from '../config.ts';

type Key = CryptoKey | KeyObject | Uint8Array | JWTVerifyGetKey;

/**
 * Checks signature, issuer, audience and expiry, then copies tenant and user
 * out of the verified claims. Nothing here reads the request body.
 *
 * In production pass `createRemoteJWKSet(new URL(<your IdP JWKS URL>))` as `key`.
 */
export function createVerifier(key: Key): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
          issuer: config.issuer,
          audience: config.resource.href, // a token for another server is refused here
          requiredClaims: ['sub', 'exp', config.tenantClaim],
        }));
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token is invalid, expired, or not issued for this server');
      }
      const tenantId = payload[config.tenantClaim];
      if (typeof tenantId !== 'string' || tenantId.length === 0) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token has no tenant');
      }
      const scope = typeof payload.scope === 'string' ? payload.scope : '';
      return {
        token,
        clientId: typeof payload.client_id === 'string' ? payload.client_id : 'unknown-client',
        scopes: scope.split(' ').filter(Boolean),
        expiresAt: payload.exp,
        resource: config.resource,
        extra: { tenantId, userId: payload.sub },
      };
    },
  };
}
