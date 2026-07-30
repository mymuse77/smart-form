import type {
  ManagedResourceKind,
  ManagedResourceVersion,
} from '@smart-form/contracts';

export interface ResourceRepository {
  create(resource: ManagedResourceVersion): Promise<void>;
  findVersion(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<ManagedResourceVersion | null>;
  listActive(
    tenantId: string,
    kinds: readonly ManagedResourceKind[],
  ): Promise<ManagedResourceVersion[]>;
  getActiveVersion(
    tenantId: string,
    resourceId: string,
  ): Promise<string | null>;
  setActiveVersion(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<void>;
}
