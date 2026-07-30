import { z } from 'zod';
import { FieldDefinition, TaskDefinition, TaskMode } from './task.js';
import { ResourceMatch } from './resource.js';

export const ChatTaskRequest = z.object({
  message: z.string().min(1).max(20_000),
  deviceId: z.string().min(1),
  workspaceId: z.string().min(1),
  targetUrl: z.string().url().optional(),
  modeHint: TaskMode.optional(),
  inputValues: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional(),
  fields: z.array(FieldDefinition).max(500).optional(),
  tags: z.array(z.string().max(100)).max(100).default([]),
});
export type ChatTaskRequest = z.infer<typeof ChatTaskRequest>;

export const ChatTaskAccepted = z.object({
  accepted: z.literal(true),
  task: TaskDefinition,
  commandId: z.string().min(1),
  matchedResources: z.array(ResourceMatch),
});
export type ChatTaskAccepted = z.infer<typeof ChatTaskAccepted>;

export const TaskControlRequest = z.object({
  type: z.enum([
    'PAUSE_TASK',
    'REQUEST_TAKEOVER',
    'RESUME_AFTER_HUMAN',
    'CANCEL_TASK',
    'APPROVE_SUBMIT',
    'REJECT_SUBMIT',
  ]),
  submissionId: z.string().min(1).optional(),
});
export type TaskControlRequest = z.infer<typeof TaskControlRequest>;

