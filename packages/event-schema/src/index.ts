import { z } from "zod";

/**
 * 平台统一事件类型枚举
 */
export const EventTypeSchema = z.enum([
  // 代理与设备状态
  "DEVICE_HEARTBEAT",
  "AGENT_STATE_CHANGED",
  "CONTROL_STATE_CHANGED",
  
  // 截图帧与流
  "SCREENSHOT_FRAME",
  
  // 人工接管与介入
  "TAKEOVER_REQUESTED",
  "TAKEOVER_RELEASED",
  "HUMAN_INTERVENTION_REQUIRED",
  
  // 探索与执行
  "ACTION_PROPOSED",
  "ACTION_EXECUTED",
  "DATA_COLLECTED",
  "CHECKPOINT_SAVED",
  "REPLAY_STARTED",
  "REPLAY_COMPLETED",
  
  // 异常与错误
  "TASK_ERROR",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * 标准事件包络 (Event Envelope) Schema
 */
export const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid().or(z.string().min(1)),
  taskId: z.string(),
  eventType: EventTypeSchema,
  timestamp: z.number().default(() => Date.now()),
  payload: z.record(z.unknown()),
  signature: z.string().optional(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * 创建事件包络帮助函数
 */
export function createEventEnvelope(
  taskId: string,
  eventType: EventType,
  payload: Record<string, unknown>
): EventEnvelope {
  return {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    taskId,
    eventType,
    timestamp: Date.now(),
    payload,
  };
}
