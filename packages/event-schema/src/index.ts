/**
 * @smart-form/event-schema
 *
 * 事件校验与工厂函数。
 */

import { TaskEvent, EventType, type EventSource, type EventSeverity } from '@smart-form/contracts';
import { randomUUID } from 'node:crypto';

/**
 * 校验事件包络
 */
export function validateEvent(input: unknown): TaskEvent {
  return TaskEvent.parse(input);
}

/**
 * 创建事件的工厂函数，自动填充 eventId 和 timestamp
 */
export function createEvent(
  taskId: string,
  sequence: number,
  source: EventSource,
  type: EventType,
  severity: EventSeverity,
  payload: Record<string, unknown>,
  options?: {
    containsSensitiveData?: boolean;
    uploadAllowed?: boolean;
  },
): TaskEvent {
  return TaskEvent.parse({
    eventId: randomUUID(),
    taskId,
    sequence,
    timestamp: new Date().toISOString(),
    source,
    type,
    severity,
    payload,
    privacy: {
      containsSensitiveData: options?.containsSensitiveData ?? false,
      uploadAllowed: options?.uploadAllowed ?? true,
    },
  });
}

export { TaskEvent, EventType } from '@smart-form/contracts';
