import { Injectable } from '@nestjs/common';
import { Prisma, type ResourceKind } from '@prisma/client';
import {
  ManagedResourceVersion as ManagedResourceVersionSchema,
  type ManagedResourceKind,
  type ManagedResourceVersion,
} from '@smart-form/contracts';
import { PrismaService } from '../database/prisma.service';
import type { ResourceRepository } from './resource.repository';

@Injectable()
export class PrismaResourceRepository implements ResourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(resource: ManagedResourceVersion): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const aggregate = await transaction.managedResource.upsert({
        where: {
          tenantId_resourceKey: {
            tenantId: resource.tenantId,
            resourceKey: resource.resourceId,
          },
        },
        create: {
          tenantId: resource.tenantId,
          resourceKey: resource.resourceId,
          kind: resource.kind as ResourceKind,
        },
        update: {},
      });
      await transaction.managedResourceVersion.create({
        data: {
          resourceId: aggregate.id,
          tenantId: resource.tenantId,
          version: resource.version,
          name: resource.name,
          status: resource.status,
          criteria: resource.criteria as Prisma.InputJsonValue,
          artifact: resource.artifact as Prisma.InputJsonValue,
          metadata: resource.metadata as Prisma.InputJsonValue,
          payload: resource as unknown as Prisma.InputJsonValue,
          createdBy: resource.createdBy,
          createdAt: new Date(resource.createdAt),
        },
      });
    });
  }

  async findVersion(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<ManagedResourceVersion | null> {
    const row = await this.prisma.managedResourceVersion.findFirst({
      where: {
        tenantId,
        version,
        resource: { resourceKey: resourceId },
      },
    });
    return row
      ? ManagedResourceVersionSchema.parse(row.payload)
      : null;
  }

  async listActive(
    tenantId: string,
    kinds: readonly ManagedResourceKind[],
  ): Promise<ManagedResourceVersion[]> {
    const resources = await this.prisma.managedResource.findMany({
      where: {
        tenantId,
        kind: { in: [...kinds] as ResourceKind[] },
        activeVersion: { not: null },
      },
      include: { versions: true },
    });

    return resources.flatMap((resource) => {
      const active = resource.versions.find(
        (version) => version.version === resource.activeVersion,
      );
      return active ? [ManagedResourceVersionSchema.parse(active.payload)] : [];
    });
  }

  async getActiveVersion(tenantId: string, resourceId: string): Promise<string | null> {
    const resource = await this.prisma.managedResource.findUnique({
      where: { tenantId_resourceKey: { tenantId, resourceKey: resourceId } },
      select: { activeVersion: true },
    });
    return resource?.activeVersion ?? null;
  }

  async setActiveVersion(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<void> {
    await this.prisma.managedResource.update({
      where: { tenantId_resourceKey: { tenantId, resourceKey: resourceId } },
      data: { activeVersion: version },
    });
  }
}
