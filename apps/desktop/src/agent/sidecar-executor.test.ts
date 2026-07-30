import { describe, expect, it, vi } from 'vitest';
import type { StartTaskCommand } from '@smart-form/contracts';
import type { Page } from 'playwright';
import type { SidecarProcessClient } from './sidecar-client';
import { SidecarExecutorAdapter } from './sidecar-executor';

function command(mode: 'read' | 'write'): StartTaskCommand {
  const now = new Date().toISOString();
  return {
    protocolVersion: '1.0.0',
    commandId: 'command-1',
    taskId: 'task-1',
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    issuedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    type: 'START_TASK',
    task: {
      id: 'task-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      title: 'Orders',
      description: 'Collect orders',
      taskType: mode === 'read' ? 'collect' : 'fill',
      mode,
      site: { entryUrl: 'https://forms.example.com', allowedDomains: ['forms.example.com'] },
      target: { entity: 'order', fields: [] },
      ...(mode === 'write' ? { input: { values: { id: 'A-1' } } } : {}),
      output: { format: 'jsonl', destination: 'local' },
      budget: {
        maxSteps: 20,
        stepTimeoutMs: 30_000,
        totalTimeoutMs: 60_000,
        maxCostUsd: 1,
      },
      createdAt: now,
      updatedAt: now,
    },
    resources: [],
  };
}

describe('SidecarExecutorAdapter', () => {
  it('passes the Desktop CDP target to Sidecar and maps its result', async () => {
    const client = {
      execute: vi.fn(async () => ({
        protocol_version: '1.0.0',
        type: 'result',
        task_id: 'task-1',
        status: 'succeeded',
        payload: { final_result: 'orders' },
      })),
      control: vi.fn(async () => undefined),
    } as unknown as SidecarProcessClient;
    const adapter = new SidecarExecutorAdapter(
      client,
      'http://127.0.0.1:49222',
      async () => 'target-1',
    );

    await expect(adapter.execute({
      command: command('read'),
      page: {} as Page,
      leaseToken: 'lease-1',
      resume: false,
      emitEvent: async () => undefined,
    })).resolves.toMatchObject({ status: 'succeeded' });
    expect(client.execute).toHaveBeenCalledWith(expect.objectContaining({
      cdpEndpoint: 'http://127.0.0.1:49222',
      targetId: 'target-1',
    }));
  });

  it('refuses write mode and stale resume or pause operations', async () => {
    const client = {
      execute: vi.fn(),
      control: vi.fn(async () => undefined),
    } as unknown as SidecarProcessClient;
    const adapter = new SidecarExecutorAdapter(client, 'http://127.0.0.1:1', async () => 'target');
    const base = {
      page: {} as Page,
      leaseToken: 'lease',
      emitEvent: async () => undefined,
    };
    await expect(adapter.execute({
      ...base,
      command: command('write'),
      resume: false,
    })).rejects.toThrow('restricted to read');
    await expect(adapter.execute({
      ...base,
      command: command('read'),
      resume: true,
    })).rejects.toThrow('no paused task');
    await expect(adapter.pause()).rejects.toThrow('no active task');
    await adapter.cancel();
    await adapter.drain();
  });
});

