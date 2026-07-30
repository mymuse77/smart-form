import { z } from 'zod';

export const DeviceAccessClaims = z.object({
  subject: z.string().min(1),
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type DeviceAccessClaims = z.infer<typeof DeviceAccessClaims>;

export const DeviceValidationEvidence = z.object({
  evidenceId: z.string().min(1),
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  taskId: z.string().min(1),
  artifactId: z.string().min(1),
  artifactVersion: z.string().min(1),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/i),
  createdAt: z.string().datetime(),
  signingKeyId: z.string().min(1),
  signature: z.string().min(1),
});
export type DeviceValidationEvidence = z.infer<typeof DeviceValidationEvidence>;
