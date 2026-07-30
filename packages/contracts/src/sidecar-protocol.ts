import { z } from 'zod';

const SidecarEnvelope = z.object({
  protocol_version: z.literal('1.0.0'),
  request_id: z.string().min(1),
});

export const SidecarExecuteRequest = SidecarEnvelope.extend({
  type: z.literal('execute'),
  task_id: z.string().min(1),
  cdp_endpoint: z.string().min(1),
  target_id: z.string().min(1),
  prompt: z.string().min(1).max(100_000),
  allowed_domains: z.array(z.string().min(1)).min(1).max(100),
  max_steps: z.number().int().min(1).max(500),
});

export const SidecarControlRequest = SidecarEnvelope.extend({
  type: z.enum(['pause', 'resume', 'cancel']),
  task_id: z.string().min(1),
});

export const SidecarRequest = z.discriminatedUnion('type', [
  SidecarExecuteRequest,
  SidecarControlRequest,
  SidecarEnvelope.extend({ type: z.literal('ping') }),
  SidecarEnvelope.extend({ type: z.literal('shutdown') }),
]);
export type SidecarRequest = z.infer<typeof SidecarRequest>;

export const SidecarResponse = z.object({
  protocol_version: z.literal('1.0.0'),
  type: z.enum(['ready', 'ack', 'result', 'error']),
  request_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  status: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
});
export type SidecarResponse = z.infer<typeof SidecarResponse>;

