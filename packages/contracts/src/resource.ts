import { z } from 'zod';
import { ManagedResourceKind, ArtifactReference } from './artifact.js';
import { TaskMode } from './task.js';

export const ManagedResourceStatus = z.enum([
  'DRAFT',
  'VALIDATING',
  'ACTIVE',
  'DEGRADED',
  'RETIRED',
  'REJECTED',
]);
export type ManagedResourceStatus = z.infer<typeof ManagedResourceStatus>;

export const ResourceMatchCriteria = z.object({
  intents: z.array(z.string().min(1)).default([]),
  domains: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  modes: z.array(TaskMode).min(1),
  priority: z.number().int().min(0).max(100).default(50),
});
export type ResourceMatchCriteria = z.infer<typeof ResourceMatchCriteria>;

export const ManagedResourceVersion = z.object({
  resourceId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: ManagedResourceKind,
  name: z.string().min(1),
  version: z.string().min(1),
  status: ManagedResourceStatus,
  criteria: ResourceMatchCriteria,
  artifact: ArtifactReference,
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
});
export type ManagedResourceVersion = z.infer<typeof ManagedResourceVersion>;

export const ResourceMatchRequest = z.object({
  tenantId: z.string().min(1),
  intent: z.string().min(1),
  targetUrl: z.string().url(),
  mode: TaskMode,
  requestedKinds: z.array(ManagedResourceKind).min(1),
  tags: z.array(z.string()).default([]),
});
export type ResourceMatchRequest = z.infer<typeof ResourceMatchRequest>;

export const ResourceMatch = z.object({
  resource: ManagedResourceVersion,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});
export type ResourceMatch = z.infer<typeof ResourceMatch>;
