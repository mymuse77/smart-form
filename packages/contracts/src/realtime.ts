import { z } from 'zod';

// ─── WebSocket 消息类型 ─────────────────────────────────
// 基于设计文档 §13 + 详细设计文档 §15.3

/** 客户端 → 服务端消息类型 */
export const ClientMessageType = z.enum([
  'client.hello',
  'client.heartbeat',
  'task.event_summary',
  'task.command_ack',
  'browser.frame',
  'browser.stream_state',
  'capability.upload_progress',
]);
export type ClientMessageType = z.infer<typeof ClientMessageType>;

/** 服务端 → 客户端消息类型 */
export const ServerMessageType = z.enum([
  'chat.delta',
  'chat.completed',
  'task.plan',
  'task.command',
  'browser.stream_policy',
  'capability.match',
  'policy.updated',
  'session.expiring',
]);
export type ServerMessageType = z.infer<typeof ServerMessageType>;

/** 通用 WebSocket 消息包络 */
export const WsMessage = z.object({
  messageId: z.string(),
  type: z.string(),
  timestamp: z.string().datetime(),
  correlationId: z.string().optional(),
  payload: z.record(z.unknown()),
});
export type WsMessage = z.infer<typeof WsMessage>;

/** 截图帧二进制头信息 */
export interface FrameHeader {
  taskId: string;
  frameSequence: number;
  capturedAt: string;
  width: number;
  height: number;
  mimeType: 'image/webp' | 'image/jpeg';
  redacted: boolean;
}
