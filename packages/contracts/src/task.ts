import { z } from 'zod';

// ─── 任务模式 ───────────────────────────────────────────
// 由 mode 字段在任务创建时锁定，状态机 guard 拒绝不匹配分支

/** 任务模式：read（采集）或 write（填报） */
export const TaskMode = z.enum(['read', 'write']);
export type TaskMode = z.infer<typeof TaskMode>;

// ─── 任务主状态 ─────────────────────────────────────────
// 基于设计文档 §5 状态机定义

export const TaskState = z.enum([
  // 通用流程
  'DRAFT',
  'PLANNING',
  'WAITING_DEVICE',
  'MATCHING',
  'REUSING',
  'EXPLORING',
  'WAITING_HUMAN',

  // 读模式（采集）
  'COLLECTING',
  'DATA_VALIDATING',
  'COMPILING',
  'REPLAYING',
  'PUBLISHING',

  // 写模式（填报）
  'FILLING',
  'SUBMIT_PENDING',
  'WAITING_APPROVAL_SUBMIT',
  'SUBMITTING',
  'SUBMITTED',
  'SUBMIT_FAILED',
  'SUBMIT_UNKNOWN',

  // 终态
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'PAUSED',
]);
export type TaskState = z.infer<typeof TaskState>;

// ─── 任务定义 ───────────────────────────────────────────
// 基于设计文档 §9.1（结构化任务定义）

export const FieldDefinition = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'decimal', 'date', 'boolean', 'enum', 'url', 'image']),
  required: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type FieldDefinition = z.infer<typeof FieldDefinition>;

export const TaskBudget = z.object({
  maxSteps: z.number().int().positive().default(100),
  stepTimeoutMs: z.number().int().positive().default(30_000),
  totalTimeoutMs: z.number().int().positive().default(1_800_000),
  maxCostUsd: z.number().nonnegative().default(1),
});
export type TaskBudget = z.infer<typeof TaskBudget>;

export const TaskDefinition = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  taskType: z.literal('collect').or(z.literal('fill')),
  mode: TaskMode,
  site: z.object({
    entryUrl: z.string().url(),
    allowedDomains: z.array(z.string()),
    moduleHint: z.string().optional(),
  }),
  target: z.object({
    entity: z.string(),
    fields: z.array(FieldDefinition),
  }),
  scope: z.object({
    dateRange: z.object({
      mode: z.enum(['relative', 'absolute']),
      value: z.string(),
    }).optional(),
    maxRecords: z.number().int().positive().optional(),
  }).optional(),
  pagination: z.object({
    mode: z.enum(['auto', 'manual']),
    maxPages: z.number().int().positive().optional(),
  }).optional(),
  output: z.object({
    format: z.enum(['jsonl', 'csv', 'xlsx']),
    destination: z.enum(['local', 'server']),
  }),
  input: z.object({
    values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  }).optional(),
  budget: TaskBudget.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((task, context) => {
  const expectedType = task.mode === 'read' ? 'collect' : 'fill';
  if (task.taskType !== expectedType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taskType'],
      message: `taskType must be "${expectedType}" when mode is "${task.mode}"`,
    });
  }
  if (task.mode === 'write' && !task.input) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['input'],
      message: 'write tasks must include input values',
    });
  }
});
export type TaskDefinition = z.infer<typeof TaskDefinition>;

export function validateTaskDefinition(data: unknown): TaskDefinition {
  return TaskDefinition.parse(data);
}

// ─── 任务摘要（服务端与客户端共享） ────────────────────

export interface TaskSummary {
  id: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  state: TaskState;
  mode: TaskMode;
  definition: TaskDefinition;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
