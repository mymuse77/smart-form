import { describe, expect, it } from 'vitest';
import type { ManagedResourceVersion } from '@smart-form/contracts';
import { ConflictError } from '../shared/app-error';
import { InMemoryResourceRepository } from './in-memory-resource.repository';
import { ResourceService } from './resource.service';

const timestamp = '2026-07-31T00:00:00.000Z';

function resource(
  overrides: Partial<ManagedResourceVersion> = {},
): ManagedResourceVersion {
  const kind = overrides.kind ?? 'capability';
  return {
    resourceId: 'orders-collector',
    tenantId: 'tenant-1',
    kind,
    name: 'Order collection',
    version: '1.0.0',
    status: 'ACTIVE',
    criteria: {
      intents: ['collect orders', '采集 订单'],
      domains: ['example.com'],
      tags: ['orders'],
      modes: ['read'],
      priority: 80,
    },
    artifact: {
      artifactId: 'artifact-1',
      tenantId: 'tenant-1',
      kind,
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      signature: 'c2ln',
      signingKeyId: 'server-key-1',
      contentLength: 100,
      transport: { type: 'local', path: 'fixtures/artifact.js' },
      publishedAt: timestamp,
    },
    metadata: {},
    createdAt: timestamp,
    createdBy: 'user-1',
    ...overrides,
  };
}

describe('ResourceService', () => {
  it('publishes immutable versions', async () => {
    const service = new ResourceService(new InMemoryResourceRepository());
    await service.publish(resource());

    await expect(service.publish(resource())).rejects.toBeInstanceOf(ConflictError);
  });

  it('matches active resources by tenant, domain, mode and intent', async () => {
    const service = new ResourceService(new InMemoryResourceRepository());
    await service.publish(resource());
    await service.publish(resource({
      resourceId: 'other-domain',
      version: '1.0.0',
      criteria: {
        intents: ['collect orders'],
        domains: ['other.example'],
        tags: [],
        modes: ['read'],
        priority: 100,
      },
    }));

    const matches = await service.match({
      tenantId: 'tenant-1',
      intent: 'collect orders',
      targetUrl: 'https://portal.example.com/orders',
      mode: 'read',
      requestedKinds: ['capability'],
      tags: ['orders'],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.resource.resourceId).toBe('orders-collector');
    expect(matches[0]?.score).toBeGreaterThan(0.8);
  });

  it('rolls back by switching the active immutable version', async () => {
    const repository = new InMemoryResourceRepository();
    const service = new ResourceService(repository);
    await service.publish(resource({ version: '1.0.0' }));
    await service.publish(resource({
      version: '2.0.0',
      artifact: { ...resource().artifact, version: '2.0.0' },
    }));

    await service.rollback('tenant-1', 'orders-collector', '1.0.0');

    expect(await repository.getActiveVersion('tenant-1', 'orders-collector')).toBe('1.0.0');
  });
});
