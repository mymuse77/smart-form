import { z } from 'zod';
import { ArtifactReference } from './artifact.js';
import { ManagedResourceVersion } from './resource.js';
import { TaskDefinition } from './task.js';

export const AgentCommandType = z.enum([
  'START_TASK',
  'PAUSE_TASK',
  'REQUEST_TAKEOVER',
  'RESUME_AFTER_HUMAN',
  'CANCEL_TASK',
  'APPROVE_SUBMIT',
  'REJECT_SUBMIT',
]);
export type AgentCommandType = z.infer<typeof AgentCommandType>;

const AgentCommandBase = z.object({
  protocolVersion: z.string().min(1),
  commandId: z.string().min(1),
  taskId: z.string().min(1),
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const StartTaskCommand = AgentCommandBase.extend({
  type: z.literal('START_TASK'),
  task: TaskDefinition,
  capability: ArtifactReference.optional(),
  resources: z.array(ManagedResourceVersion).default([]),
});
export type StartTaskCommand = z.infer<typeof StartTaskCommand>;

export const AgentControlCommand = AgentCommandBase.extend({
  type: z.enum([
    'PAUSE_TASK',
    'REQUEST_TAKEOVER',
    'RESUME_AFTER_HUMAN',
    'CANCEL_TASK',
    'APPROVE_SUBMIT',
    'REJECT_SUBMIT',
  ]),
  submissionId: z.string().optional(),
});
export type AgentControlCommand = z.infer<typeof AgentControlCommand>;

export const AgentCommand = z.union([
  StartTaskCommand,
  AgentControlCommand,
]);
export type AgentCommand = z.infer<typeof AgentCommand>;

export const AgentReportType = z.enum([
  'COMMAND_ACK',
  'COMMAND_REJECTED',
  'TASK_EVENT',
  'TASK_CHECKPOINT',
  'ARTIFACT_REJECTED',
  'DEVICE_HEARTBEAT',
]);
export type AgentReportType = z.infer<typeof AgentReportType>;

export const AgentReport = z.object({
  protocolVersion: z.string().min(1),
  reportId: z.string().min(1),
  type: AgentReportType,
  tenantId: z.string().min(1),
  deviceId: z.string().min(1),
  taskId: z.string().optional(),
  commandId: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()),
});
export type AgentReport = z.infer<typeof AgentReport>;
