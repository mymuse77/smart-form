import { createPublicKey, type KeyLike } from 'node:crypto';

export interface ArtifactTrustOptions {
  configuredKeysJson?: string;
  nodeEnv: string;
  serverWsUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

function parseConfiguredKeys(input: string): Map<string, KeyLike> {
  const values = JSON.parse(input) as Record<string, unknown>;
  const keys = new Map<string, KeyLike>();
  for (const [keyId, encoded] of Object.entries(values)) {
    if (typeof encoded !== 'string' || !encoded) {
      throw new Error(`Artifact signing key is invalid: ${keyId}`);
    }
    const key = encoded.includes('BEGIN PUBLIC KEY')
      ? createPublicKey(encoded)
      : createPublicKey({
        key: Buffer.from(encoded, 'base64'),
        format: 'der',
        type: 'spki',
      });
    keys.set(keyId, key);
  }
  if (keys.size === 0) throw new Error('At least one artifact signing key is required');
  return keys;
}

export async function loadArtifactTrust(
  options: ArtifactTrustOptions,
): Promise<Map<string, KeyLike>> {
  if (options.configuredKeysJson) {
    return parseConfiguredKeys(options.configuredKeysJson);
  }
  if (options.nodeEnv === 'production') {
    throw new Error('Production requires pinned ARTIFACT_SIGNING_PUBLIC_KEYS_JSON');
  }

  const endpoint = new URL(options.serverWsUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
    throw new Error('Development signing-key discovery is restricted to loopback');
  }
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
  endpoint.pathname = '/v1/artifacts/signing-keys/current';
  endpoint.search = '';
  endpoint.hash = '';
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    headers: { authorization: `Bearer ${options.accessToken}` },
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Unable to load development artifact signing key: HTTP ${response.status}`);
  }
  const payload = await response.json() as Record<string, unknown>;
  if (
    typeof payload.keyId !== 'string'
    || payload.algorithm !== 'Ed25519'
    || typeof payload.publicKeyPem !== 'string'
  ) {
    throw new Error('Control plane returned an invalid signing-key document');
  }
  return new Map([[payload.keyId, createPublicKey(payload.publicKeyPem)]]);
}

