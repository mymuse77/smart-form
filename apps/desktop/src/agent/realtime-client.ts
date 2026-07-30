import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  AgentCommand,
  AgentReport,
  WsMessage,
  type AgentCommand as AgentCommandValue,
  type AgentReport as AgentReportValue,
} from '@smart-form/contracts';
import type { OutboxRecord } from '../main/db';

export interface RealtimeOutbox {
  enqueueReport(report: OutboxRecord): Promise<void>;
  listOutbox(limit?: number): OutboxRecord[];
  acknowledgeReport(reportId: string): Promise<void>;
}

export interface AgentRealtimeClientConfig {
  serverUrl: string;
  accessToken: string;
  tenantId: string;
  deviceId: string;
  protocolVersion: string;
  reconnect?: boolean;
}

interface RealtimeClientEvents {
  command: [AgentCommandValue];
  connected: [];
  disconnected: [];
  error: [Error];
}

export class AgentRealtimeClient {
  private socket: WebSocket | null = null;
  private authenticated = false;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly events = new EventEmitter<RealtimeClientEvents>();

  constructor(
    private readonly config: AgentRealtimeClientConfig,
    private readonly outbox: RealtimeOutbox,
  ) {
    const url = new URL(config.serverUrl);
    const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLoopback)) {
      throw new Error('Realtime connections require WSS except on loopback development URLs');
    }
  }

  onCommand(listener: (command: AgentCommandValue) => void): () => void {
    this.events.on('command', listener);
    return () => this.events.off('command', listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('error', listener);
    return () => this.events.off('error', listener);
  }

  onConnected(listener: () => void): () => void {
    this.events.on('connected', listener);
    return () => this.events.off('connected', listener);
  }

  onDisconnected(listener: () => void): () => void {
    this.events.on('disconnected', listener);
    return () => this.events.off('disconnected', listener);
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.authenticated = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.close(1000, 'Agent stopping');
    this.socket = null;
  }

  async sendReport(reportInput: AgentReportValue): Promise<void> {
    const report = AgentReport.parse(reportInput);
    if (
      report.tenantId !== this.config.tenantId
      || report.deviceId !== this.config.deviceId
    ) {
      throw new Error('Report identity does not match the configured device');
    }
    await this.outbox.enqueueReport({
      reportId: report.reportId,
      taskId: report.taskId,
      sequence: report.sequence,
      payload: report as unknown as Record<string, unknown>,
      createdAt: Date.parse(report.timestamp),
    });
    if (this.authenticated && this.socket?.readyState === WebSocket.OPEN) {
      this.sendJson('agent.report', report, report.commandId ?? report.taskId);
    }
  }

  sendFrame(frame: Buffer): boolean {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(frame);
    return true;
  }

  isAvailable(): boolean {
    return this.authenticated && this.socket?.readyState === WebSocket.OPEN;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.serverUrl, {
        maxPayload: 8 * 1024 * 1024,
        handshakeTimeout: 10_000,
      });
      this.socket = socket;
      let settled = false;

      socket.once('open', () => {
        this.sendJson('client.hello', {
          role: 'agent',
          accessToken: this.config.accessToken,
          deviceId: this.config.deviceId,
        });
      });
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        try {
          const message = WsMessage.parse(JSON.parse(data.toString()));
          if (message.type === 'server.hello') {
            this.authenticated = true;
            this.reconnectAttempt = 0;
            this.startHeartbeat();
            void this.flushOutbox();
            this.events.emit('connected');
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }
          if (message.type === 'task.command') {
            const command = AgentCommand.parse(message.payload);
            if (
              command.tenantId !== this.config.tenantId
              || command.deviceId !== this.config.deviceId
            ) {
              throw new Error('Received a command for another tenant or device');
            }
            this.events.emit('command', command);
            return;
          }
          if (message.type === 'agent.report_ack') {
            const reportId = message.payload.reportId;
            if (typeof reportId !== 'string' || !reportId) {
              throw new Error('Report acknowledgment is missing reportId');
            }
            void this.outbox.acknowledgeReport(reportId);
          }
        } catch (error) {
          this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
          socket.close(4000, 'Invalid server message');
        }
      });
      socket.once('error', (error) => {
        this.events.emit('error', error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      socket.once('close', () => {
        this.authenticated = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.events.emit('disconnected');
        if (!settled) {
          settled = true;
          reject(new Error('Realtime connection closed before authentication'));
        }
        this.scheduleReconnect();
      });
    });
  }

  private sendJson(
    type: string,
    payload: Record<string, unknown> | AgentReportValue,
    correlationId?: string,
  ): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime socket is not open');
    }
    this.socket.send(JSON.stringify({
      messageId: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      correlationId,
      payload,
    }));
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendJson('client.heartbeat', {
          deviceId: this.config.deviceId,
          protocolVersion: this.config.protocolVersion,
        });
      }
    }, 30_000);
    this.heartbeatTimer.unref();
  }

  private async flushOutbox(): Promise<void> {
    for (const record of this.outbox.listOutbox(100)) {
      if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return;
      try {
        const report = AgentReport.parse(record.payload);
        this.sendJson('agent.report', report, report.commandId ?? report.taskId);
      } catch (error) {
        this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.config.reconnect === false) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref();
  }
}
