import type { AuthInfo } from '@modelcontextprotocol/server';

/**
 * Who is calling. Built ONLY from a verified token, never from tool arguments.
 */
export interface Principal {
  tenantId: string;
  userId: string;
  clientId: string;
  scopes: string[];
}

export class NotAuthenticated extends Error {}

export function principalFrom(authInfo: AuthInfo | undefined): Principal {
  const tenantId = authInfo?.extra?.tenantId;
  const userId = authInfo?.extra?.userId;
  if (!authInfo || typeof tenantId !== 'string' || typeof userId !== 'string') {
    throw new NotAuthenticated('No verified tenant and user on this request');
  }
  return { tenantId, userId, clientId: authInfo.clientId, scopes: authInfo.scopes };
}
