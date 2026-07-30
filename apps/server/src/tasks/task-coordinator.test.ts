import { describe, expect, it, vi } from 'vitest';
import type { ManagedResourceVersion, ResourceMatch } from '@smart-form/contracts';
import type { RealtimeHub } from '../realtime/realtime-hub';
import type { ResourceService } from '../resources/resource.service';
import { TaskCoordinator } from './task-coordinator';
import { InMemoryTaskRepository } from './in-memory-task.repository';

function resource(kind: ManagedResourceVersion['kind']): ManagedResourceVersion {
  return {
    resourceId: `${kind}-1`,
    tenantId: 'tenant-1',
    kind,
    name: `${kind} orders`,
    version: '1.0.0',
    status: 'ACTIVE',
    criteria: {
      intents: ['orders'],
      domains: ['forms.example.com'],
      tags: [],
      modes: ['read', 'write'],
      priority: 80,
    },
    artifact: {
      artifactId: `${kind}-1`,
      tenantId: 'tenant-1',
      kind,
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      signature: 'signature',
      signingKeyId: 'key-1',
      contentLength: 1,
      transport: { type: 'local', path: `${kind}/${kind}-1/1.0.0` },
      ...(kind === 'capability' ? {
        compatibility: {
          protocolVersion: '1.0.0',
          sdkRange: '^1.0.0',
          playwrightRange: '^1.50.0',
          nodeRange: '>=20',
          browser: 'chromium' as const,
          executionModes: ['cdp' as const],
        },
      } : {}),
      publishedAt: '2026-07-31T00:00:00.000Z',
    },
    metadata: {},
    createdAt: '2026-07-31T00:00:00.000Z',
    createdBy: 'user-1',
  };
}

function setup(matches: ResourceMatch[]) {
  const resources = {
    match: vi.fn(async () => matches),
  } as unknown as ResourceService;
  const realtime = {
    dispatch: vi.fn(),
    onReport: vi.fn(() => () => undefined),
  } as unknown as RealtimeHub;
  return {
    coordinator: new TaskCoordinator(resources, realtime, new InMemoryTaskRepository()),
    realtime,
    resources,
  };
}

describe('TaskCoordinator', () => {
  it('defaults conservatively to read and dispatches Sidecar when no capability matches', async () => {
    const state = setup([]);
    const result = await state.coordinator.planAndDispatch('tenant-1', {
      message: '采集订单列表 https://forms.example.com/orders',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      tags: [],
    });

    expect(result.task.mode).toBe('read');
    expect(vi.mocked(state.realtime.dispatch)).toHaveBeenCalledWith(expect.objectContaining({
      type: 'START_TASK',
      capability: undefined,
    }));
  });

  it('refuses a write task when no validated capability matches', async () => {
    const state = setup([]);

    await expect(state.coordinator.planAndDispatch('tenant-1', {
      message: '填报订单 https://forms.example.com/orders',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      inputValues: { orderNumber: 'A-1' },
      tags: [],
    })).rejects.toMatchObject({ statusCode: 422 });

    expect(state.realtime.dispatch).not.toHaveBeenCalled();
  });

  it('extracts explicit key-value inputs from a write chat message', async () => {
    const state = setup([{
      resource: resource('capability'),
      score: 0.9,
      reasons: ['test'],
    }]);
    const result = await state.coordinator.planAndDispatch('tenant-1', {
      message: '填报订单，orderNumber=A-2 https://forms.example.com/orders',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      tags: [],
    });

    expect(result.task.input?.values).toEqual({ orderNumber: 'A-2' });
  });

  it('pins matched capability, Prompt, Skill and rules into the dispatched command', async () => {
    const matches = ['capability', 'prompt', 'skill', 'rule'].map((kind) => ({
      resource: resource(kind as ManagedResourceVersion['kind']),
      score: 0.9,
      reasons: ['test'],
    }));
    const state = setup(matches);
    const result = await state.coordinator.planAndDispatch('tenant-1', {
      message: '填报订单 https://forms.example.com/orders',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      inputValues: { orderNumber: 'A-1' },
      tags: [],
    });

    expect(result.matchedResources).toHaveLength(4);
    expect(vi.mocked(state.realtime.dispatch)).toHaveBeenCalledWith(expect.objectContaining({
      capability: expect.objectContaining({ artifactId: 'capability-1' }),
      resources: expect.arrayContaining([
        expect.objectContaining({ kind: 'prompt' }),
        expect.objectContaining({ kind: 'skill' }),
        expect.objectContaining({ kind: 'rule' }),
      ]),
    }));
  });

  it('requires a target URL and explicit values for write intent', async () => {
    const state = setup([]);
    await expect(state.coordinator.planAndDispatch('tenant-1', {
      message: '采集订单',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      tags: [],
    })).rejects.toMatchObject({ statusCode: 422 });
    await expect(state.coordinator.planAndDispatch('tenant-1', {
      message: '填报订单 https://forms.example.com/orders',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      tags: [],
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('routes validated control commands only to the registered tenant and device', async () => {
    const state = setup([]);
    const accepted = await state.coordinator.planAndDispatch('tenant-1', {
      message: '采集订单 https://forms.example.com/orders',
      deviceId: 'device-1',
      workspaceId: 'workspace-1',
      modeHint: 'read',
      tags: [],
    });
    const command = await state.coordinator.dispatchControl(
      'tenant-1',
      accepted.task.id,
      { type: 'REQUEST_TAKEOVER' },
    );

    expect(command).toMatchObject({
      type: 'REQUEST_TAKEOVER',
      deviceId: 'device-1',
      tenantId: 'tenant-1',
    });
    await expect(state.coordinator.dispatchControl(
      'tenant-2',
      accepted.task.id,
      { type: 'PAUSE_TASK' },
    )).rejects.toThrow();
    await expect(state.coordinator.dispatchControl(
      'tenant-1',
      accepted.task.id,
      { type: 'APPROVE_SUBMIT' },
    )).rejects.toThrow('submissionId');
  });
});
