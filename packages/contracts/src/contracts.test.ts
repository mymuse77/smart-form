import { describe, expect, it } from 'vitest';
import {
  AgentCommand,
  ArtifactReference,
  ResourceMatchRequest,
  TaskDefinition,
} from './index.js';

const timestamp = '2026-07-31T00:00:00.000Z';

function createTask(mode: 'read' | 'write' = 'read') {
  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Test task',
    description: 'Contract test',
    taskType: mode === 'read' ? 'collect' : 'fill',
    mode,
    site: {
      entryUrl: 'https://example.com/form',
      allowedDomains: ['example.com'],
    },
    target: {
      entity: 'record',
      fields: [{ name: 'title', label: 'Title', type: 'string' }],
    },
    ...(mode === 'write' ? { input: { values: { title: 'Example' } } } : {}),
    output: { format: 'jsonl', destination: 'local' },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('canonical contracts', () => {
  it('accepts a canonical task and applies safe defaults', () => {
    const task = TaskDefinition.parse(createTask());

    expect(task.target.fields[0]?.required).toBe(false);
    expect(task.budget.maxSteps).toBe(100);
  });

  it('rejects a task whose task type conflicts with its mode', () => {
    const result = TaskDefinition.safeParse({
      ...createTask('write'),
      taskType: 'collect',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('taskType must be "fill"');
    }
  });

  it('validates a start command with immutable artifact references', () => {
    const artifact = ArtifactReference.parse({
      artifactId: 'capability-1',
      tenantId: 'tenant-1',
      kind: 'capability',
      version: '1.2.3',
      sha256: 'a'.repeat(64),
      signature: 'c2lnbmF0dXJl',
      signingKeyId: 'server-key-1',
      contentLength: 42,
      transport: { type: 'https', url: 'https://artifacts.example.com/capability-1' },
      publishedAt: timestamp,
    });

    const command = AgentCommand.parse({
      protocolVersion: '1.0.0',
      commandId: 'command-1',
      taskId: 'task-1',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      issuedAt: timestamp,
      expiresAt: '2026-07-31T00:05:00.000Z',
      type: 'START_TASK',
      task: createTask(),
      capability: artifact,
      resources: [],
    });

    expect(command.type).toBe('START_TASK');
  });

  it('rejects insecure remote artifact URLs but allows local adapters', () => {
    const base = {
      artifactId: 'resource-1',
      tenantId: 'tenant-1',
      kind: 'prompt',
      version: '1.0.0',
      sha256: 'b'.repeat(64),
      signature: 'c2ln',
      signingKeyId: 'server-key-1',
      contentLength: 1,
      publishedAt: timestamp,
    };

    expect(() => ArtifactReference.parse({
      ...base,
      transport: { type: 'https', url: 'http://example.com/prompt' },
    })).toThrow(/HTTPS/);
    expect(ArtifactReference.parse({
      ...base,
      transport: { type: 'local', path: 'fixtures/prompt.json' },
    }).transport.type).toBe('local');
  });

  it('requires an explicit set of resource kinds during matching', () => {
    expect(() => ResourceMatchRequest.parse({
      tenantId: 'tenant-1',
      intent: 'collect orders',
      targetUrl: 'https://example.com',
      mode: 'read',
      requestedKinds: [],
    })).toThrow();
  });
});
