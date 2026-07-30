import { z } from 'zod';

export const ManagedResourceKind = z.enum(['capability', 'prompt', 'skill', 'rule']);
export type ManagedResourceKind = z.infer<typeof ManagedResourceKind>;

export const ArtifactTransport = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('https'),
    url: z.string().url().refine((value) => value.startsWith('https://'), {
      message: 'Production artifact URLs must use HTTPS',
    }),
  }),
  z.object({
    type: z.literal('local'),
    path: z.string().min(1),
  }),
]);
export type ArtifactTransport = z.infer<typeof ArtifactTransport>;

export const RuntimeCompatibility = z.object({
  protocolVersion: z.string().min(1),
  sdkRange: z.string().min(1),
  playwrightRange: z.string().min(1),
  nodeRange: z.string().min(1),
  browser: z.literal('chromium'),
  executionModes: z.array(z.enum(['cdp', 'native-playwright'])).min(1),
});
export type RuntimeCompatibility = z.infer<typeof RuntimeCompatibility>;

export const ArtifactReference = z.object({
  artifactId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: ManagedResourceKind,
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  signature: z.string().min(1),
  signingKeyId: z.string().min(1),
  contentLength: z.number().int().nonnegative(),
  transport: ArtifactTransport,
  compatibility: RuntimeCompatibility.optional(),
  publishedAt: z.string().datetime(),
});
export type ArtifactReference = z.infer<typeof ArtifactReference>;

export const ExecutionEnvironment = z.object({
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  protocolVersion: z.string().min(1),
  sdkVersion: z.string().min(1),
  playwrightVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  browser: z.literal('chromium'),
  executionMode: z.enum(['cdp', 'native-playwright']),
});
export type ExecutionEnvironment = z.infer<typeof ExecutionEnvironment>;

export const ArtifactRejectionCode = z.enum([
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_SIZE_MISMATCH',
  'ARTIFACT_HASH_MISMATCH',
  'ARTIFACT_SIGNATURE_INVALID',
  'ARTIFACT_SIGNING_KEY_UNKNOWN',
  'ARTIFACT_MANIFEST_INVALID',
  'TENANT_MISMATCH',
  'PROTOCOL_INCOMPATIBLE',
  'SDK_INCOMPATIBLE',
  'PLAYWRIGHT_INCOMPATIBLE',
  'NODE_INCOMPATIBLE',
  'BROWSER_INCOMPATIBLE',
  'EXECUTION_MODE_INCOMPATIBLE',
  'PERMISSION_DENIED',
]);
export type ArtifactRejectionCode = z.infer<typeof ArtifactRejectionCode>;

export const ArtifactExecutionRejection = z.object({
  taskId: z.string().min(1),
  commandId: z.string().min(1),
  artifactId: z.string().min(1),
  artifactVersion: z.string().min(1),
  deviceId: z.string().min(1),
  code: ArtifactRejectionCode,
  detail: z.string().min(1),
  reportedAt: z.string().datetime(),
});
export type ArtifactExecutionRejection = z.infer<typeof ArtifactExecutionRejection>;
