import { exportJWK, generateKeyPair, importJWK, type CryptoKey } from 'jose';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Keys live in .dev-keys/ (git-ignored). They exist only so the demo runs offline.
const DIR = new URL('../.dev-keys/', import.meta.url);

export async function ensureDevKeys() {
  try {
    return JSON.parse(await readFile(new URL('private.jwk.json', DIR), 'utf8'));
  } catch {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    await mkdir(DIR, { recursive: true });
    const priv = await exportJWK(privateKey);
    await writeFile(new URL('private.jwk.json', DIR), JSON.stringify(priv));
    await writeFile(new URL('public.jwk.json', DIR), JSON.stringify(await exportJWK(publicKey)));
    return priv;
  }
}

export async function loadDevPublicKey(): Promise<CryptoKey> {
  await ensureDevKeys();
  const jwk = JSON.parse(await readFile(new URL('public.jwk.json', DIR), 'utf8'));
  return (await importJWK(jwk, 'ES256')) as CryptoKey;
}
