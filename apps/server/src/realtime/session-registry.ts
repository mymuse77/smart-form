import { randomUUID } from 'node:crypto';
import {
  AgentCommand,
  AgentReport,
  type AgentCommand as AgentCommandValue,
  type AgentReport as AgentReportValue,
  type WsMessage,
} from '@smart-form/contracts';
import { ConflictError, NotFoundError } from '../shared/app-error';
import type { AuthPrincipal } from '../auth/auth.types';

export interface RealtimePeer {
  readonly readyState: number;
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
}

interface AgentSession {
  peer: RealtimePeer;
  principal: AuthPrincipal;
  deviceId: string;
}

interface WebSession {
  peer: RealtimePeer;
  principal: AuthPrincipal;
}

function deviceKey(tenantId: string, deviceId: string): string {
  return `${tenantId}\u0000${deviceId}`;
}

export class RealtimeSessionRegistry {
  private readonly agents = new Map<string, AgentSession>();
  private readonly webSessions = new Set<WebSession>();

  registerAgent(
    peer: RealtimePeer,
    principal: AuthPrincipal,
    deviceId: string,
  ): () => void {
    if (principal.deviceId && principal.deviceId !== deviceId) {
      throw new ConflictError('Device token cannot register another device');
    }
    const key = deviceKey(principal.tenantId, deviceId);
    const existing = this.agents.get(key);
    if (existing && existing.peer !== peer) {
      existing.peer.close(4002, 'Device session replaced');
    }
    const session = { peer, principal, deviceId };
    this.agents.set(key, session);
    return () => {
      if (this.agents.get(key)?.peer === peer) this.agents.delete(key);
    };
  }

  registerWeb(peer: RealtimePeer, principal: AuthPrincipal): () => void {
    const session = { peer, principal };
    this.webSessions.add(session);
    return () => this.webSessions.delete(session);
  }

  dispatch(commandInput: AgentCommandValue): void {
    const command = AgentCommand.parse(commandInput);
    const session = this.agents.get(deviceKey(command.tenantId, command.deviceId));
    if (!session || session.peer.readyState !== 1) {
      throw new NotFoundError('online device', command.deviceId);
    }
    if (Date.parse(command.expiresAt) <= Date.now()) {
      throw new ConflictError('Expired task commands cannot be dispatched');
    }
    const message: WsMessage = {
      messageId: randomUUID(),
      type: 'task.command',
      timestamp: new Date().toISOString(),
      correlationId: command.commandId,
      payload: command,
    };
    session.peer.send(JSON.stringify(message));
  }

  publishReport(reportInput: AgentReportValue): void {
    const report = AgentReport.parse(reportInput);
    const message: WsMessage = {
      messageId: randomUUID(),
      type: 'task.report',
      timestamp: new Date().toISOString(),
      correlationId: report.commandId ?? report.taskId,
      payload: report,
    };
    const encoded = JSON.stringify(message);
    for (const session of this.webSessions) {
      if (session.principal.tenantId === report.tenantId && session.peer.readyState === 1) {
        session.peer.send(encoded);
      }
    }
  }

  relayFrame(tenantId: string, frame: Buffer): void {
    for (const session of this.webSessions) {
      if (session.principal.tenantId === tenantId && session.peer.readyState === 1) {
        session.peer.send(frame);
      }
    }
  }
}
