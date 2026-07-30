import type {
  ManagedResourceKind,
  ManagedResourceVersion,
} from '@smart-form/contracts';
import type { ResourceRepository } from './resource.repository';

function versionKey(tenantId: string, resourceId: string, version: string): string {
  return `${tenantId}\u0000${resourceId}\u0000${version}`;
}

function activeKey(tenantId: string, resourceId: string): string {
  return `${tenantId}\u0000${resourceId}`;
}

export class InMemoryResourceRepository implements ResourceRepository {
  private readonly versions = new Map<string, ManagedResourceVersion>();
  private readonly activeVersions = new Map<string, string>();

  async create(resource: ManagedResourceVersion): Promise<void> {
    this.versions.set(
      versionKey(resource.tenantId, resource.resourceId, resource.version),
      structuredClone(resource),
    );
  }

  async findVersion(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<ManagedResourceVersion | null> {
    const value = this.versions.get(versionKey(tenantId, resourceId, version));
    return value ? structuredClone(value) : null;
  }

  async listActive(
    tenantId: string,
    kinds: readonly ManagedResourceKind[],
  ): Promise<ManagedResourceVersion[]> {
    const kindSet = new Set(kinds);
    const result: ManagedResourceVersion[] = [];
    for (const [key, version] of this.activeVersions.entries()) {
      if (!key.startsWith(`${tenantId}\u0000`)) continue;
      const resourceId = key.slice(tenantId.length + 1);
      const resource = await this.findVersion(tenantId, resourceId, version);
      if (resource && kindSet.has(resource.kind)) result.push(resource);
    }
    return result;
  }

  async getActiveVersion(tenantId: string, resourceId: string): Promise<string | null> {
    return this.activeVersions.get(activeKey(tenantId, resourceId)) ?? null;
  }

  async setActiveVersion(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<void> {
    this.activeVersions.set(activeKey(tenantId, resourceId), version);
  }
}
