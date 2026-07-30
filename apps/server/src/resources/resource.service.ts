import {
  ManagedResourceVersion as ManagedResourceVersionSchema,
  ResourceMatchRequest as ResourceMatchRequestSchema,
  type ManagedResourceVersion,
  type ResourceMatch,
  type ResourceMatchRequest,
} from '@smart-form/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../shared/app-error';
import type { ResourceRepository } from './resource.repository';

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[\s,，。;；:/_-]+/u)
      .filter(Boolean),
  );
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersections = 0;
  for (const item of left) {
    if (right.has(item)) intersections += 1;
  }
  return intersections / Math.max(left.size, right.size);
}

function domainMatches(hostname: string, allowedDomain: string): boolean {
  const normalized = normalize(allowedDomain).replace(/^\*\./, '');
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

export class ResourceService {
  constructor(private readonly repository: ResourceRepository) {}

  async publish(resourceInput: ManagedResourceVersion): Promise<ManagedResourceVersion> {
    const resource = ManagedResourceVersionSchema.parse(resourceInput);
    const existing = await this.repository.findVersion(
      resource.tenantId,
      resource.resourceId,
      resource.version,
    );
    if (existing) {
      throw new ConflictError('Resource versions are immutable', {
        resourceId: resource.resourceId,
        version: resource.version,
      });
    }
    if (resource.artifact.tenantId !== resource.tenantId) {
      throw new ValidationError('Artifact tenant must match resource tenant');
    }
    if (resource.artifact.kind !== resource.kind) {
      throw new ValidationError('Artifact kind must match resource kind');
    }

    await this.repository.create(resource);
    if (resource.status === 'ACTIVE') {
      await this.repository.setActiveVersion(
        resource.tenantId,
        resource.resourceId,
        resource.version,
      );
    }
    return resource;
  }

  async activate(
    tenantId: string,
    resourceId: string,
    version: string,
  ): Promise<ManagedResourceVersion> {
    const resource = await this.repository.findVersion(tenantId, resourceId, version);
    if (!resource) throw new NotFoundError('resource version', `${resourceId}@${version}`);
    if (!['ACTIVE', 'VALIDATING', 'DEGRADED'].includes(resource.status)) {
      throw new ValidationError(`Cannot activate resource in ${resource.status} state`);
    }
    await this.repository.setActiveVersion(tenantId, resourceId, version);
    return resource;
  }

  async rollback(
    tenantId: string,
    resourceId: string,
    targetVersion: string,
  ): Promise<ManagedResourceVersion> {
    return this.activate(tenantId, resourceId, targetVersion);
  }

  async match(requestInput: ResourceMatchRequest): Promise<ResourceMatch[]> {
    const request = ResourceMatchRequestSchema.parse(requestInput);
    const hostname = normalize(new URL(request.targetUrl).hostname);
    const candidates = await this.repository.listActive(
      request.tenantId,
      request.requestedKinds,
    );
    const intentTokens = tokenize(request.intent);
    const requestedTags = new Set(request.tags.map(normalize));

    const matches = candidates.flatMap((resource): ResourceMatch[] => {
      if (!resource.criteria.modes.includes(request.mode)) return [];
      const domainScore = resource.criteria.domains.length === 0
        ? 0.5
        : Math.max(...resource.criteria.domains.map(
          (domain) => domainMatches(hostname, domain) ? 1 : 0,
        ));
      if (domainScore === 0) return [];

      const resourceIntentTokens = tokenize([
        resource.name,
        ...resource.criteria.intents,
        ...resource.criteria.tags,
      ].join(' '));
      const normalizedIntent = normalize(request.intent);
      const intentScore = resource.criteria.intents.some(
        (candidate) => normalize(candidate) === normalizedIntent,
      )
        ? 1
        : overlap(intentTokens, resourceIntentTokens);
      const resourceTags = new Set(resource.criteria.tags.map(normalize));
      const tagScore = requestedTags.size === 0 ? 0.5 : overlap(requestedTags, resourceTags);
      const priorityScore = resource.criteria.priority / 100;
      const score = Number((
        domainScore * 0.4
        + intentScore * 0.4
        + tagScore * 0.1
        + priorityScore * 0.1
      ).toFixed(4));

      return [{
        resource,
        score,
        reasons: [
          `domain=${domainScore.toFixed(2)}`,
          `intent=${intentScore.toFixed(2)}`,
          `tags=${tagScore.toFixed(2)}`,
          `priority=${priorityScore.toFixed(2)}`,
        ],
      }];
    });

    return matches.sort((left, right) => right.score - left.score);
  }
}
