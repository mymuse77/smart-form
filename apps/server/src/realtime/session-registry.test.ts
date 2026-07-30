import { describe, expect, it, vi } from 'vitest';
import type { AgentCommand } from '@smart-form/contracts';
import { RealtimeSessionRegistry, type RealtimePeer } from './session-registry';

function peer(): RealtimePeer {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  };
}

function startCommand(): AgentCommand {
  const now = Date.now();
  return {
    protocolVersion: '1.0.0',
    commandId: 'command-1',
    taskId: 'task-1',
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    type: 'PAUSE_TASK',
  };
}

describe('RealtimeSessionRegistry', () => {
  it('dispatches commands only to the selected tenant device', () => {
    const registry = new RealtimeSessionRegistry();
    const target = peer();
    const other = peer();
    registry.registerAgent(target, {
      subject: 'device',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      scopes: ['tasks:execute'],
    }, 'device-1');
    registry.registerAgent(other, {
      subject: 'device',
      tenantId: 'tenant-2',
      deviceId: 'device-1',
      scopes: ['tasks:execute'],
    }, 'device-1');

    registry.dispatch(startCommand());

    expect(target.send).toHaveBeenCalledOnce();
    expect(other.send).not.toHaveBeenCalled();
  });

  it('replaces stale sessions for the same device', () => {
    const registry = new RealtimeSessionRegistry();
    const previous = peer();
    const next = peer();
    const principal = {
      subject: 'device',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      scopes: ['tasks:execute'],
    };
    registry.registerAgent(previous, principal, 'device-1');
    registry.registerAgent(next, principal, 'device-1');

    expect(previous.close).toHaveBeenCalledWith(4002, 'Device session replaced');
  });

  it('broadcasts reports and frames only inside the tenant', () => {
    const registry = new RealtimeSessionRegistry();
    const sameTenant = peer();
    const otherTenant = peer();
    registry.registerWeb(sameTenant, {
      subject: 'user-1',
      tenantId: 'tenant-1',
      scopes: ['tasks:read'],
    });
    registry.registerWeb(otherTenant, {
      subject: 'user-2',
      tenantId: 'tenant-2',
      scopes: ['tasks:read'],
    });
    registry.publishReport({
      protocolVersion: '1.0.0',
      reportId: 'report-1',
      type: 'TASK_EVENT',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      taskId: 'task-1',
      sequence: 1,
      timestamp: new Date().toISOString(),
      payload: { state: 'RUNNING' },
    });
    registry.relayFrame('tenant-1', Buffer.from('frame'));

    expect(sameTenant.send).toHaveBeenCalledTimes(2);
    expect(otherTenant.send).not.toHaveBeenCalled();
  });
});
