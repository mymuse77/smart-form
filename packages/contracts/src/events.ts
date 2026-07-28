import { z } from 'zod';

// ─── 事件包络 ───────────────────────────────────────────
// 基于设计文档 §14 事件设计

export const EventSeverity = z.enum(['info', 'warn', 'error', 'critical']);
export type EventSeverity = z.infer<typeof EventSeverity>;

export const EventSource = z.enum([
  'explore-agent',
  'playwright-runner',
  'orchestrator',
  'user',
  'system',
]);
export type EventSource = z.infer<typeof EventSource>;

/** 事件类型枚举 — 按分类组织 */
export const EventType = z.enum([
  // 任务生命周期
  'task.created',
  'task.state_changed',
  'task.completed',
  'task.failed',
  'task.cancelled',

  // 计划
  'plan.created',
  'plan.revised',

  // 浏览器
  'browser.navigated',
  'browser.popup',
  'browser.download',
  'browser.stream_state_changed',

  // 动作
  'action.proposed',
  'action.started',
  'action.succeeded',
  'action.failed',

  // 控制权
  'control.requested',
  'control.transferred',

  // 人工介入
  'human.required',
  'human.resumed',

  // 数据
  'record.extracted',
  'batch.persisted',
  'data.validation_failed',

  // 能力
  'capability.compiled',
  'capability.replay_passed',
  'capability.published',

  // 安全
  'policy.blocked',
  'domain.blocked',
  'secret.redacted',

  // 填报专属
  'fill.field_filled',
  'fill.submit_requested',
  'fill.submit_approved',
  'fill.submit_completed',
  'fill.submit_failed',
  'fill.submit_unknown',
]);
export type EventType = z.infer<typeof EventType>;

/** 事件隐私标记 */
export const EventPrivacy = z.object({
  containsSensitiveData: z.boolean(),
  uploadAllowed: z.boolean(),
});
export type EventPrivacy = z.infer<typeof EventPrivacy>;

/** 结构化事件包络 */
export const TaskEvent = z.object({
  eventId: z.string(),
  taskId: z.string(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  source: EventSource,
  type: EventType,
  severity: EventSeverity,
  payload: z.record(z.unknown()),
  privacy: EventPrivacy,
});
export type TaskEvent = z.infer<typeof TaskEvent>;
