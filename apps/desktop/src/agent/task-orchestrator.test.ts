import { describe, expect, it, vi } from 'vitest';
import type {
  AgentCommand,
  AgentReport,
  ArtifactReference,
  StartTaskCommand,
} from '@smart-form/contracts';
import type { Page } from 'playwright';
import type {
  CommandReceiptRecord,
  LocalTaskRecord,
  TaskCheckpointRecord,
} from '../main/db';
import { ArtifactRejectedError } from './artifact-loader';
import { BrowserControlAuthority } from './control-lease';
import {
  DesktopTaskOrchestrator,
  type AutomationExecutorAdapter,
  type ExecutionOutcome,
  type OrchestratorDatabase,
} from './task-orchestrator';

class MemoryDatabase implements OrchestratorDatabase {
  readonly tasks = new Map<string, LocalTaskRecord>();
  readonly checkpoints = new Map<string, TaskCheckpointRecord>();
  readonly receipts = new Map<string, CommandReceiptRecord>();

  async saveTask(task: LocalTaskRecord): Promise<void> {
    this.tasks.set(task.id, structuredClone(task));
  }

  getTask(id: string): LocalTaskRecord | null {
    return this.tasks.get(id) ?? null;
  }

  async saveCheckpoint(checkpoint: TaskCheckpointRecord): Promise<void> {
    this.checkpoints.set(checkpoint.taskId, structuredClone(checkpoint));
  }

  getCheckpoint(taskId: string): TaskCheckpointRecord | null {
    return this.checkpoints.get(taskId) ?? null;
  }

  getCommandReceipt(commandId: string): CommandReceiptRecord | null {
    return this.receipts.get(commandId) ?? null;
  }

  async saveCommandReceipt(receipt: CommandReceiptRecord): Promise<void> {
    this.receipts.set(receipt.commandId, structuredClone(receipt));
  }
}

function artifactReference(): ArtifactReference {
  return {
    artifactId: 'capability-orders',
    tenantId: 'tenant-1',
    kind: 'capability',
    version: '1.2.3',
    sha256: 'a'.repeat(64),
    signature: 'signature',
    signingKeyId: 'server-key-1',
    contentLength: 10,
    transport: { type: 'local', path: 'capability/orders/1.2.3' },
    compatibility: {
      protocolVersion: '1.0.0',
      sdkRange: '^1.0.0',
      playwrightRange: '^1.50.0',
      nodeRange: '>=20',
      browser: 'chromium',
      executionModes: ['cdp'],
    },
    publishedAt: '2026-07-31T00:00:00.000Z',
  };
}

function startCommand(overrides: Partial<StartTaskCommand> = {}): StartTaskCommand {
  return {
    protocolVersion: '1.0.0',
    commandId: 'command-1',
    taskId: 'task-1',
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    type: 'START_TASK',
    task: {
      id: 'task-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      title: 'Collect orders',
      description: '',
      taskType: 'collect',
      mode: 'read',
      site: {
        entryUrl: 'https://forms.example.com/orders',
        allowedDomains: ['forms.example.com'],
      },
      target: { entity: 'order', fields: [] },
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
    capability: artifactReference(),
    resources: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(
  artifactLoader: { load(reference: ArtifactReference): Promise<Buffer> } = {
    load: vi.fn(async () => Buffer.from('capability')),
  },
) {
  let currentUrl = 'about:blank';
  const page = {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
      return null;
    }),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => 'Orders'),
    bringToFront: vi.fn(async () => undefined),
  } as unknown as Page;
  const runnerOutcome = deferred<ExecutionOutcome>();
  const sidecarOutcome = deferred<ExecutionOutcome>();
  const runner: AutomationExecutorAdapter = {
    kind: 'playwright-runner',
    execute: vi.fn(() => runnerOutcome.promise),
    pause: vi.fn(async () => undefined),
    drain: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
  const sidecar: AutomationExecutorAdapter = {
    kind: 'browser-use-sidecar',
    execute: vi.fn(() => sidecarOutcome.promise),
    pause: vi.fn(async () => undefined),
    drain: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
  const reports: AgentReport[] = [];
  const database = new MemoryDatabase();
  const frames = {
    start: vi.fn(),
    stop: vi.fn(),
  };
  const orchestrator = new DesktopTaskOrchestrator({
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    protocolVersion: '1.0.0',
    page,
    database,
    artifactLoader,
    control: new BrowserControlAuthority(),
    executors: new Map([
      ['playwright-runner', runner],
      ['browser-use-sidecar', sidecar],
    ]),
    frames,
    reports: {
      sendReport: vi.fn(async (report: AgentReport) => {
        reports.push(report);
      }),
    },
  });
  return {
    orchestrator,
    artifactLoader,
    database,
    frames,
    page,
    reports,
    runner,
    runnerOutcome,
    sidecar,
  };
}

describe('DesktopTaskOrchestrator', () => {
  it('rejects and reports an incompatible artifact before browser execution', async () => {
    const artifactLoader = {
      load: vi.fn(async () => {
        throw new ArtifactRejectedError('SDK_INCOMPATIBLE', 'SDK range does not match');
      }),
    };
    const state = setup(artifactLoader);

    await state.orchestrator.handle(startCommand());

    expect(state.page.goto).not.toHaveBeenCalled();
    expect(state.runner.execute).not.toHaveBeenCalled();
    expect(state.reports.map((report) => report.type)).toEqual([
      'ARTIFACT_REJECTED',
      'COMMAND_REJECTED',
    ]);
    expect(state.reports[0]?.payload).toMatchObject({ code: 'SDK_INCOMPATIBLE' });
  });

  it('uses the runner for a verified capability and rejects a concurrent task', async () => {
    const state = setup();
    await state.orchestrator.handle(startCommand());

    expect(state.runner.execute).toHaveBeenCalledOnce();
    expect(state.sidecar.execute).not.toHaveBeenCalled();
    expect(state.frames.start).toHaveBeenCalledWith('task-1');

    await state.orchestrator.handle(startCommand({
      commandId: 'command-2',
      taskId: 'task-2',
      task: { ...startCommand().task, id: 'task-2' },
    }));

    expect(state.runner.execute).toHaveBeenCalledOnce();
    expect(state.reports.at(-1)).toMatchObject({
      type: 'COMMAND_REJECTED',
      payload: { accepted: false },
    });
  });

  it('transfers exclusive control to the human and re-probes before resuming', async () => {
    const state = setup();
    await state.orchestrator.handle(startCommand());
    await state.orchestrator.handle({
      ...startCommand(),
      type: 'REQUEST_TAKEOVER',
      commandId: 'command-takeover',
      capability: undefined,
      resources: undefined,
      task: undefined,
    } as unknown as AgentCommand);

    expect(state.runner.pause).toHaveBeenCalledOnce();
    expect(state.runner.drain).toHaveBeenCalledOnce();
    expect(state.page.bringToFront).toHaveBeenCalledOnce();
    expect(state.database.getCheckpoint('task-1')?.state).toBe('WAITING_HUMAN');

    await state.orchestrator.handle({
      protocolVersion: '1.0.0',
      commandId: 'command-resume',
      taskId: 'task-1',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      type: 'RESUME_AFTER_HUMAN',
    });

    expect(state.runner.execute).toHaveBeenCalledTimes(2);
    expect(vi.mocked(state.runner.execute).mock.calls[1]?.[0]).toMatchObject({ resume: true });
  });

  it('acknowledges a duplicate command without executing it twice', async () => {
    const state = setup();
    const command = startCommand();
    await state.orchestrator.handle(command);
    await state.orchestrator.handle(command);

    expect(state.runner.execute).toHaveBeenCalledOnce();
    expect(state.reports.at(-1)).toMatchObject({
      type: 'COMMAND_ACK',
      payload: { duplicate: true },
    });
  });

  it('never delegates a write task without a validated capability to Sidecar', async () => {
    const state = setup();
    const base = startCommand();
    await state.orchestrator.handle(startCommand({
      capability: undefined,
      task: {
        ...base.task,
        taskType: 'fill',
        mode: 'write',
        input: { values: { orderNumber: 'A-001' } },
      },
    }));

    expect(state.sidecar.execute).not.toHaveBeenCalled();
    expect(state.page.goto).not.toHaveBeenCalled();
    expect(state.reports.at(-1)).toMatchObject({
      type: 'COMMAND_REJECTED',
      payload: {
        reason: expect.stringContaining('Sidecar cannot perform writes'),
      },
    });
  });
});
