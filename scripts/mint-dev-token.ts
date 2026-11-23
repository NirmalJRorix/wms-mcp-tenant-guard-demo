// Usage: npm run token -- a     (or b)
// Prints a 1-hour token for a FAKE tenant. Never use this pattern in production.
import { importJWK, SignJWT } from 'jose';
import { config } from '../src/config.ts';
import { TENANT_A, TENANT_B } from '../src/data/seed.ts';
import { ensureDevKeys } from './dev-keys.ts';

const which = (process.argv[2] ?? 'a').toLowerCase();
const tenant = which === 'b' ? TENANT_B : TENANT_A;
const key = await importJWK(await ensureDevKeys(), 'ES256');

const token = await new SignJWT({
  [config.tenantClaim]: tenant,
  scope: 'wms.stock.read wms.locations.read wms.tasks.read wms.tasks.write',
  client_id: 'local-dev-client',
})
  .setProtectedHeader({ alg: 'ES256' })
  .setIssuer(config.issuer)
  .setAudience(config.resource.href)
  .setSubject(`demo-user-${which}`)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(key);

console.log(token);
