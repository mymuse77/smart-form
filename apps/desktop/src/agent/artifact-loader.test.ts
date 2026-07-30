import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactReference, RuntimeCompatibility } from '@smart-form/contracts';
import { signArtifactReference } from '@smart-form/capability-sdk';
import { ArtifactLoader } from './artifact-loader';

const directories: string[] = [];
const keys = generateKeyPairSync('ed25519');
const compatibility: RuntimeCompatibility = {
  protocolVersion: '1.0.0',
  sdkRange: '^1.0.0',
  playwrightRange: '^1.50.0',
  nodeRange: '>=20',
  browser: 'chromium',
  executionModes: ['cdp'],
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(
    (directory) => fs.promises.rm(directory, { recursive: true, force: true }),
  ));
});

async function fixture(content = Buffer.from('capability')) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smart-form-loader-'));
  directories.push(root);
  const directory = path.join(root, 'tenant-1', 'capability', 'collector-1', '1.0.0');
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(path.join(directory, 'artifact.bin'), content);
  const reference = signArtifactReference({
    artifactId: 'collector-1',
    tenantId: 'tenant-1',
    kind: 'capability',
    version: '1.0.0',
    sha256: createHash('sha256').update(content).digest('hex'),
    signingKeyId: 'server-key-1',
    contentLength: content.byteLength,
    transport: { type: 'local', path: 'capability/collector-1/1.0.0' },
    compatibility,
    publishedAt: new Date().toISOString(),
  }, keys.privateKey);
  const loader = new ArtifactLoader({
    environment: {
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      protocolVersion: '1.0.0',
      sdkVersion: '1.2.0',
      playwrightVersion: '1.50.1',
      nodeVersion: '22.0.0',
      browser: 'chromium',
      executionMode: 'cdp',
    },
    trustedSigningKeys: new Map([['server-key-1', keys.publicKey]]),
    accessToken: 'device-token',
    localArtifactRoot: root,
  });
  return { root, loader, reference };
}

describe('ArtifactLoader', () => {
  it('loads only after hash, signature and compatibility verification', async () => {
    const { loader, reference } = await fixture();
    await expect(loader.load(reference)).resolves.toEqual(Buffer.from('capability'));
  });

  it('rejects tampered local content', async () => {
    const { root, loader, reference } = await fixture();
    await fs.promises.writeFile(
      path.join(root, 'tenant-1', 'capability', 'collector-1', '1.0.0', 'artifact.bin'),
      'tampered!!',
    );
    await expect(loader.load(reference)).rejects.toMatchObject({
      code: 'ARTIFACT_HASH_MISMATCH',
    });
  });

  it('rejects runtime-incompatible capabilities', async () => {
    const { root, reference } = await fixture();
    const { signature: _signature, ...unsigned } = reference;
    const incompatible: ArtifactReference = signArtifactReference({
      ...unsigned,
      compatibility: { ...compatibility, protocolVersion: '2.0.0' },
    }, keys.privateKey);
    const loader = new ArtifactLoader({
      environment: {
        tenantId: 'tenant-1',
        deviceId: 'device-1',
        protocolVersion: '1.0.0',
        sdkVersion: '1.2.0',
        playwrightVersion: '1.50.1',
        nodeVersion: '22.0.0',
        browser: 'chromium',
        executionMode: 'cdp',
      },
      trustedSigningKeys: new Map([['server-key-1', keys.publicKey]]),
      accessToken: 'device-token',
      localArtifactRoot: root,
    });

    await expect(loader.load(incompatible)).rejects.toMatchObject({
      code: 'PROTOCOL_INCOMPATIBLE',
    });
  });

  it('downloads HTTPS artifacts only from an allowlisted origin', async () => {
    const content = Buffer.from('capability');
    const { reference } = await fixture(content);
    const httpsReference = {
      ...reference,
      transport: {
        type: 'https' as const,
        url: 'https://artifacts.example.com/capability.bin',
      },
    };
    const fetchMock = vi.fn(async () => new Response(content, {
      status: 200,
      headers: { 'content-length': String(content.byteLength) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const loader = new ArtifactLoader({
      environment: {
        tenantId: 'tenant-1',
        deviceId: 'device-1',
        protocolVersion: '1.0.0',
        sdkVersion: '1.2.0',
        playwrightVersion: '1.50.1',
        nodeVersion: '22.0.0',
        browser: 'chromium',
        executionMode: 'cdp',
      },
      trustedSigningKeys: new Map([['server-key-1', keys.publicKey]]),
      accessToken: 'device-token',
      allowedHttpsOrigins: ['https://artifacts.example.com'],
    });

    await expect(loader.load(httpsReference)).resolves.toEqual(content);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(httpsReference.transport.url),
      expect.objectContaining({
        headers: { authorization: 'Bearer device-token' },
        redirect: 'error',
      }),
    );
  });

  it('rejects non-allowlisted HTTPS origins and oversized artifacts before download', async () => {
    const { reference } = await fixture();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const loader = new ArtifactLoader({
      environment: {
        tenantId: 'tenant-1',
        deviceId: 'device-1',
        protocolVersion: '1.0.0',
        sdkVersion: '1.2.0',
        playwrightVersion: '1.50.1',
        nodeVersion: '22.0.0',
        browser: 'chromium',
        executionMode: 'cdp',
      },
      trustedSigningKeys: new Map([['server-key-1', keys.publicKey]]),
      accessToken: 'device-token',
      allowedHttpsOrigins: ['https://artifacts.example.com'],
      maxArtifactBytes: reference.contentLength,
    });
    await expect(loader.load({
      ...reference,
      transport: { type: 'https', url: 'https://attacker.example.net/file' },
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(loader.load({
      ...reference,
      contentLength: reference.contentLength + 1,
    })).rejects.toMatchObject({ code: 'ARTIFACT_SIZE_MISMATCH' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects disabled, missing, and root-escaping local artifact paths', async () => {
    const { root, reference } = await fixture();
    const baseConfig = {
      environment: {
        tenantId: 'tenant-1',
        deviceId: 'device-1',
        protocolVersion: '1.0.0',
        sdkVersion: '1.2.0',
        playwrightVersion: '1.50.1',
        nodeVersion: '22.0.0',
        browser: 'chromium' as const,
        executionMode: 'cdp' as const,
      },
      trustedSigningKeys: new Map([['server-key-1', keys.publicKey]]),
      accessToken: 'device-token',
    };
    await expect(new ArtifactLoader(baseConfig).load(reference))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(new ArtifactLoader({ ...baseConfig, localArtifactRoot: root }).load({
      ...reference,
      transport: { type: 'local', path: '../../../../outside' },
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await fs.promises.rm(
      path.join(root, 'tenant-1', 'capability', 'collector-1', '1.0.0', 'artifact.bin'),
    );
    await expect(new ArtifactLoader({ ...baseConfig, localArtifactRoot: root }).load(reference))
      .rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
  });
});
