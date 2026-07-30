import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  AgentReport,
  type AgentReport as AgentReportValue,
  RealtimeHello,
  WsMessage,
} from '@smart-form/contracts';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthPrincipal,
} from '../auth/auth.types';
import {
  RealtimeSessionRegistry,
  type RealtimePeer,
} from './session-registry';

interface SessionState {
  principal: AuthPrincipal;
  role: 'agent' | 'web';
  deviceId?: string;
  unregister: () => void;
}

@Injectable()
export class RealtimeHub implements OnModuleDestroy {
  private server?: WebSocketServer;
  private readonly registry = new RealtimeSessionRegistry();
  private readonly sessions = new Map<WebSocket, SessionState>();
  private readonly reportListeners = new Set<(report: AgentReportValue) => void>();

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: AccessTokenVerifier,
  ) {}

  attach(server: WebSocketServer): void {
    if (this.server) throw new Error('RealtimeHub is already attached');
    this.server = server;
    server.on('connection', (socket) => this.handleConnection(socket));
  }

  dispatch(command: Parameters<RealtimeSessionRegistry['dispatch']>[0]): void {
    this.registry.dispatch(command);
  }

  onReport(listener: (report: AgentReportValue) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  onModuleDestroy(): void {
    for (const socket of this.sessions.keys()) socket.close(1001, 'Server shutting down');
    this.server?.close();
  }

  private handleConnection(socket: WebSocket): void {
    const authTimer = setTimeout(() => socket.close(4001, 'Authentication timeout'), 5_000);
    let authenticated = false;

    socket.on('message', async (data: RawData, isBinary: boolean) => {
      try {
        if (!authenticated) {
          if (isBinary) throw new Error('Authentication message must be JSON');
          const message = WsMessage.parse(JSON.parse(data.toString()));
          if (message.type !== 'client.hello') throw new Error('client.hello is required');
          const hello = RealtimeHello.parse(message.payload);
          const principal = await this.tokenVerifier.verify(hello.accessToken);
          this.register(socket, principal, hello.role, hello.deviceId);
          authenticated = true;
          clearTimeout(authTimer);
          socket.send(JSON.stringify({
            messageId: message.messageId,
            type: 'server.hello',
            timestamp: new Date().toISOString(),
            correlationId: message.messageId,
            payload: {
              authenticated: true,
              tenantId: principal.tenantId,
              deviceId: hello.deviceId,
            },
          }));
          return;
        }

        const session = this.sessions.get(socket);
        if (!session) throw new Error('Session registration was lost');
        if (isBinary) {
          if (session.role !== 'agent') throw new Error('Only agents may upload browser frames');
          this.registry.relayFrame(session.principal.tenantId, Buffer.from(data as Buffer));
          return;
        }

        const message = WsMessage.parse(JSON.parse(data.toString()));
        if (message.type === 'client.heartbeat') return;
        if (message.type !== 'agent.report' || session.role !== 'agent') {
          throw new Error('Message type is not allowed for this session');
        }
        const report = AgentReport.parse(message.payload);
        if (
          report.tenantId !== session.principal.tenantId
          || report.deviceId !== session.deviceId
        ) {
          throw new Error('Agent report identity does not match the authenticated session');
        }
        this.registry.publishReport(report);
        for (const listener of this.reportListeners) listener(report);
        socket.send(JSON.stringify({
          messageId: crypto.randomUUID(),
          type: 'agent.report_ack',
          timestamp: new Date().toISOString(),
          correlationId: report.commandId ?? report.taskId,
          payload: { reportId: report.reportId },
        }));
      } catch {
        socket.close(4000, 'Invalid or unauthorized realtime message');
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      this.sessions.get(socket)?.unregister();
      this.sessions.delete(socket);
    });
  }

  private register(
    socket: WebSocket,
    principal: AuthPrincipal,
    role: 'agent' | 'web',
    deviceId?: string,
  ): void {
    let unregister: () => void;
    if (role === 'agent') {
      if (!deviceId || !principal.scopes.includes('tasks:execute')) {
        throw new Error('Agent sessions require a device ID and tasks:execute scope');
      }
      if (principal.deviceId && principal.deviceId !== deviceId) {
        throw new Error('Agent device ID does not match its access token');
      }
      unregister = this.registry.registerAgent(
        socket as unknown as RealtimePeer,
        principal,
        deviceId,
      );
    } else {
      unregister = this.registry.registerWeb(socket as unknown as RealtimePeer, principal);
    }
    this.sessions.set(socket, { principal, role, deviceId, unregister });
  }
}
