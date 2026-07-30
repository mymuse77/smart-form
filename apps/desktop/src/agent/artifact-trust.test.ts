import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadArtifactTrust } from './artifact-trust';

describe('artifact trust bootstrap', () => {
  it('loads explicitly pinned public keys without network access', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const fetchImpl = vi.fn();

    const keys = await loadArtifactTrust({
      configuredKeysJson: JSON.stringify({ 'key-1': der }),
      nodeEnv: 'production',
      serverWsUrl: 'wss://control.example.com/ws',
      accessToken: 'secret',
      fetchImpl: fetchImpl as never,
    });

    expect(keys.has('key-1')).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses trust-on-first-use outside loopback development', async () => {
    await expect(loadArtifactTrust({
      nodeEnv: 'development',
      serverWsUrl: 'wss://control.example.com/ws',
      accessToken: 'secret',
    })).rejects.toThrow('loopback');
  });

  it('requires pinned trust in production', async () => {
    await expect(loadArtifactTrust({
      nodeEnv: 'production',
      serverWsUrl: 'wss://control.example.com/ws',
      accessToken: 'secret',
    })).rejects.toThrow('pinned');
  });

  it('discovers an ephemeral key only from an authenticated loopback control plane', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      keyId: 'dev-key',
      algorithm: 'Ed25519',
      publicKeyPem,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const keys = await loadArtifactTrust({
      nodeEnv: 'development',
      serverWsUrl: 'ws://127.0.0.1:3001/ws',
      accessToken: 'dev-token',
      fetchImpl,
    });

    expect(keys.has('dev-key')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3001/v1/artifacts/signing-keys/current'),
      expect.objectContaining({
        headers: { authorization: 'Bearer dev-token' },
        redirect: 'error',
      }),
    );
  });

  it('rejects invalid configured and discovered key documents', async () => {
    await expect(loadArtifactTrust({
      configuredKeysJson: '{}',
      nodeEnv: 'production',
      serverWsUrl: 'wss://control.example.com/ws',
      accessToken: 'token',
    })).rejects.toThrow('At least one');
    await expect(loadArtifactTrust({
      configuredKeysJson: JSON.stringify({ bad: 42 }),
      nodeEnv: 'production',
      serverWsUrl: 'wss://control.example.com/ws',
      accessToken: 'token',
    })).rejects.toThrow('invalid');
    await expect(loadArtifactTrust({
      nodeEnv: 'development',
      serverWsUrl: 'ws://localhost:3001/ws',
      accessToken: 'token',
      fetchImpl: vi.fn(async () => new Response('no', { status: 500 })),
    })).rejects.toThrow('HTTP 500');
    await expect(loadArtifactTrust({
      nodeEnv: 'development',
      serverWsUrl: 'ws://localhost:3001/ws',
      accessToken: 'token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ keyId: 'x' }), { status: 200 })),
    })).rejects.toThrow('invalid signing-key');
  });
});
