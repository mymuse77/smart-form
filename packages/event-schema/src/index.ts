import { randomUUID } from 'node:crypto';
import {
  EventType as EventTypeContract,
  TaskEvent,
  type EventSource,
  type EventSeverity,
  type TaskEvent as TaskEventValue,
} from '@smart-form/contracts';

/** Compatibility aliases backed by the canonical contracts package. */
export const EventTypeSchema = EventTypeContract;
export type EventType = import('@smart-form/contracts').EventType;

export const EventEnvelopeSchema = TaskEvent;
export type EventEnvelope = TaskEventValue;

export function createEventEnvelope(
  taskId: string,
  eventType: EventType,
  payload: Record<string, unknown>,
  options: {
    sequence?: number;
    source?: EventSource;
    severity?: EventSeverity;
    containsSensitiveData?: boolean;
    uploadAllowed?: boolean;
  } = {},
): EventEnvelope {
  return TaskEvent.parse({
    eventId: randomUUID(),
    taskId,
    sequence: options.sequence ?? 0,
    timestamp: new Date().toISOString(),
    source: options.source ?? 'system',
    type: eventType,
    severity: options.severity ?? 'info',
    payload,
    privacy: {
      containsSensitiveData: options.containsSensitiveData ?? false,
      uploadAllowed: options.uploadAllowed ?? true,
    },
  });
}
