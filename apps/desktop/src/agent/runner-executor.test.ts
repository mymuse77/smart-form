import { describe, expect, it, vi } from 'vitest';
import type { ArtifactReference, StartTaskCommand } from '@smart-form/contracts';
import type { Locator, Page } from 'playwright';
import { RunnerExecutorAdapter } from './runner-executor';
import type { ExecutorInput } from './task-orchestrator';

const compatibility = {
  protocolVersion: '1.0.0',
  sdkRange: '^1.0.0',
  playwrightRange: '^1.50.0',
  nodeRange: '>=20',
  browser: 'chromium' as const,
  executionModes: ['cdp' as const],
};

function command(): StartTaskCommand {
  return {
    protocolVersion: '1.0.0',
    commandId: 'command-1',
    taskId: 'task-1',
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    type: 'START_TASK',
    task: {
      id: 'task-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      title: 'Fill order',
      description: '',
      taskType: 'fill',
      mode: 'write',
      site: {
        entryUrl: 'https://forms.example.com/order',
        allowedDomains: ['forms.example.com'],
      },
      target: { entity: 'order', fields: [] },
      input: { values: { name: 'Alice' } },
      output: { format: 'jsonl', destination: 'local' },
      budget: {
        maxSteps: 100,
        stepTimeoutMs: 30_000,
        totalTimeoutMs: 1_800_000,
        maxCostUsd: 1,
      },
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    capability: reference(),
    resources: [],
  };
}

function reference(): ArtifactReference {
  return {
    artifactId: 'orders',
    tenantId: 'tenant-1',
    kind: 'capability',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    signature: 'signature',
    signingKeyId: 'key-1',
    contentLength: 1,
    transport: { type: 'local', path: 'orders' },
    compatibility,
    publishedAt: '2026-07-31T00:00:00.000Z',
  };
}

function artifact(): Buffer {
  return Buffer.from(JSON.stringify({
    format: 'smart-form-capability-v1',
    manifest: {
      schemaVersion: '1.1',
      capabilityId: 'orders',
      version: '1.0.0',
      tenantId: 'tenant-1',
      name: 'Orders',
      taskType: 'fill',
      mode: 'write',
      site: {
        domains: ['forms.example.com'],
        entryUrlPatterns: ['https://forms.example.com/*'],
        module: 'orders',
      },
      runtime: { ...compatibility, language: 'declarative-v1' },
      permissions: {
        domains: ['forms.example.com'],
        downloads: false,
        uploads: false,
        filesystem: [],
        requiresHumanLogin: false,
      },
      validation: {
        status: 'passed',
        validatedAt: '2026-07-31T00:00:00.000Z',
        consecutivePasses: 3,
        successRate30d: 1,
      },
      fingerprints: [],
      entrypoint: 'program',
      riskLevel: 'high',
      requiresApproval: true,
      reversible: false,
    },
    program: [
      {
        type: 'fill',
        selector: '#name',
        value: { source: 'input', key: 'name' },
      },
      {
        type: 'submit',
        selector: '#commit-order',
        snapshotKeys: ['name'],
      },
    ],
  }));
}

function pageFixture() {
  const clicked = vi.fn(async () => undefined);
  const locator = (selector: string): Locator => ({
    fill: vi.fn(async () => undefined),
    click: selector === '#commit-order' ? clicked : vi.fn(async () => undefined),
  } as unknown as Locator);
  return {
    page: {
      url: vi.fn(() => 'https://forms.example.com/order'),
      locator,
    } as unknown as Page,
    clicked,
  };
}

async function waitForEvent(events: Array<{ state: string; payload?: Record<string, unknown> }>) {
  for (let attempt = 0; attempt < 20 && events.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('RunnerExecutorAdapter', () => {
  it('holds the commit click until the matching submission is approved', async () => {
    const adapter = new RunnerExecutorAdapter();
    const { page, clicked } = pageFixture();
    const events: Array<{ state: string; payload?: Record<string, unknown> }> = [];
    const input: ExecutorInput = {
      command: command(),
      page,
      artifact: artifact(),
      leaseToken: 'lease-1',
      resume: false,
      emitEvent: vi.fn(async (state, payload) => {
        events.push({ state, payload });
      }),
    };

    const execution = adapter.execute(input);
    await waitForEvent(events);

    expect(events[0]).toMatchObject({ state: 'WAITING_APPROVAL_SUBMIT' });
    expect(clicked).not.toHaveBeenCalled();
    await adapter.approveSubmission(String(events[0]?.payload?.submissionId));

    await expect(execution).resolves.toMatchObject({ status: 'succeeded' });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('never clicks when the approval is rejected', async () => {
    const adapter = new RunnerExecutorAdapter();
    const { page, clicked } = pageFixture();
    const events: Array<{ state: string; payload?: Record<string, unknown> }> = [];
    const execution = adapter.execute({
      command: command(),
      page,
      artifact: artifact(),
      leaseToken: 'lease-1',
      resume: false,
      emitEvent: async (state, payload) => {
        events.push({ state, payload });
      },
    });
    await waitForEvent(events);
    await adapter.rejectSubmission(String(events[0]?.payload?.submissionId));

    await expect(execution).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('rejected'),
    });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('rejects stale resumes, duplicate execution, and unknown approval IDs', async () => {
    const adapter = new RunnerExecutorAdapter();
    const { page } = pageFixture();
    const events: Array<{ state: string; payload?: Record<string, unknown> }> = [];
    const baseInput: ExecutorInput = {
      command: command(),
      page,
      artifact: artifact(),
      leaseToken: 'lease-1',
      resume: false,
      emitEvent: async (state, payload) => {
        events.push({ state, payload });
      },
    };
    await expect(adapter.execute({ ...baseInput, resume: true }))
      .rejects.toThrow('no paused execution');

    const execution = adapter.execute(baseInput);
    await waitForEvent(events);
    await expect(adapter.execute(baseInput)).rejects.toThrow('already');
    await expect(adapter.approveSubmission('unknown')).rejects.toThrow('not waiting');
    await expect(adapter.rejectSubmission('unknown')).rejects.toThrow('not waiting');
    await adapter.cancel();
    await expect(execution).resolves.toMatchObject({ status: 'failed' });
    await adapter.pause();
    await adapter.drain();
  });

  it('requires both verified bytes and a signed capability reference', async () => {
    const adapter = new RunnerExecutorAdapter();
    const { page } = pageFixture();
    await expect(adapter.execute({
      command: { ...command(), capability: undefined },
      page,
      leaseToken: 'lease-1',
      resume: false,
      emitEvent: async () => undefined,
    })).rejects.toThrow('verified capability');
  });
});
