import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../shared/app-error';
import { loadConfig } from '../shared/config';
import { FileArtifactStore } from './artifact-store';
import { ArtifactService } from './artifact.service';

const directories: string[] = [];

async function createService() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smart-form-artifacts-'));
  directories.push(directory);
  const config = loadConfig({
    NODE_ENV: 'test',
    ARTIFACT_ROOT: directory,
    ARTIFACT_TRANSPORT: 'local',
  });
  return new ArtifactService(new FileArtifactStore(directory), config);
}

const compatibility = {
  protocolVersion: '1.0.0',
  sdkRange: '^1.0.0',
  playwrightRange: '^1.50.0',
  nodeRange: '>=20',
  browser: 'chromium' as const,
  executionModes: ['cdp' as const],
};

function capabilityContent(program: unknown[] = [{
  type: 'extract',
  fields: [{ name: 'id', selector: '.id', read: 'text' }],
}]) {
  return Buffer.from(JSON.stringify({
    format: 'smart-form-capability-v1',
    manifest: {
      schemaVersion: '1.1',
      capabilityId: 'collector-1',
      version: '1.0.0',
      tenantId: 'tenant-1',
      name: 'Collector',
      taskType: 'collect',
      mode: 'read',
      site: {
        domains: ['example.com'],
        entryUrlPatterns: ['https://example.com/*'],
        module: 'orders',
      },
      runtime: { ...compatibility, language: 'declarative-v1' },
      permissions: {
        domains: ['example.com'],
        downloads: false,
        uploads: false,
        filesystem: [],
        requiresHumanLogin: false,
      },
      validation: {
        status: 'passed',
        validatedAt: '2026-07-31T00:00:00.000Z',
        consecutivePasses: 3,
        successRate30d: 1,
      },
      fingerprints: [],
      entrypoint: 'program',
      riskLevel: 'low',
      requiresApproval: false,
      reversible: true,
    },
    program,
  }));
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (directory) => fs.promises.rm(directory, { recursive: true, force: true }),
  ));
});

describe('ArtifactService', () => {
  it('publishes an immutable signed artifact and reads it by tenant', async () => {
    const service = await createService();
    const content = capabilityContent();
    const reference = await service.publish({
      tenantId: 'tenant-1',
      artifactId: 'collector-1',
      kind: 'capability',
      version: '1.0.0',
      content,
      compatibility,
    });

    expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reference.signature).not.toBe('');
    expect((await service.get(
      'tenant-1',
      'capability',
      'collector-1',
      '1.0.0',
    )).content).toEqual(content);
  });

  it('rejects overwriting an existing version', async () => {
    const service = await createService();
    const input = {
      tenantId: 'tenant-1',
      artifactId: 'collector-1',
      kind: 'capability' as const,
      version: '1.0.0',
      content: capabilityContent(),
      compatibility,
    };
    await service.publish(input);

    await expect(service.publish({ ...input, content: capabilityContent([{
      type: 'waitFor',
      selector: 'body',
      state: 'visible',
    }]) }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('does not expose artifacts across tenants', async () => {
    const service = await createService();
    await service.publish({
      tenantId: 'tenant-1',
      artifactId: 'collector-1',
      kind: 'capability',
      version: '1.0.0',
      content: capabilityContent(),
      compatibility,
    });

    await expect(service.get(
      'tenant-2',
      'capability',
      'collector-1',
      '1.0.0',
    )).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects executable content that is not a validated declarative bundle', async () => {
    const service = await createService();

    await expect(service.publish({
      tenantId: 'tenant-1',
      artifactId: 'collector-1',
      kind: 'capability',
      version: '1.0.0',
      content: Buffer.from('module.exports = process.env'),
      compatibility,
    })).rejects.toMatchObject({ statusCode: 422 });
  });
});
