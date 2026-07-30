import { randomUUID } from 'node:crypto';
import type {
  AgentCommand,
  AgentReport,
  StartTaskCommand,
} from '@smart-form/contracts';
import type { Page } from 'playwright';
import type {
  CommandReceiptRecord,
  LocalDatabaseManager,
  LocalTaskRecord,
  TaskCheckpointRecord,
} from '../main/db';
import {
  ArtifactLoader,
  ArtifactRejectedError,
} from './artifact-loader';
import {
  BrowserControlAuthority,
  type AutomationExecutor,
  type BrowserProbe,
  type ControlLease,
} from './control-lease';

export interface ExecutionOutcome {
  status: 'succeeded' | 'waiting-human' | 'failed';
  payload?: Record<string, unknown>;
  error?: string;
}

export interface ExecutorInput {
  command: StartTaskCommand;
  page: Page;
  artifact?: Buffer;
  leaseToken: string;
  resume: boolean;
  emitEvent(state: string, payload?: Record<string, unknown>): Promise<void>;
}

export interface AutomationExecutorAdapter {
  readonly kind: AutomationExecutor;
  execute(input: ExecutorInput): Promise<ExecutionOutcome>;
  pause(): Promise<void>;
  drain(): Promise<void>;
  cancel(): Promise<void>;
  approveSubmission?(submissionId: string): Promise<void>;
  rejectSubmission?(submissionId: string): Promise<void>;
}

export interface FrameController {
  start(taskId: string): void;
  stop(): void;
}

export interface ReportSink {
  sendReport(report: AgentReport): Promise<void>;
}

export interface OrchestratorDatabase {
  saveTask(task: LocalTaskRecord): Promise<void>;
  getTask(id: string): LocalTaskRecord | null;
  saveCheckpoint(checkpoint: TaskCheckpointRecord): Promise<void>;
  getCheckpoint(taskId: string): TaskCheckpointRecord | null;
  getCommandReceipt(commandId: string): CommandReceiptRecord | null;
  saveCommandReceipt(receipt: CommandReceiptRecord): Promise<void>;
}

export interface DesktopTaskOrchestratorOptions {
  tenantId: string;
  deviceId: string;
  protocolVersion: string;
  page: Page;
  database: OrchestratorDatabase;
  artifactLoader: Pick<ArtifactLoader, 'load'>;
  control: BrowserControlAuthority;
  executors: ReadonlyMap<AutomationExecutor, AutomationExecutorAdapter>;
  frames: FrameController;
  reports: ReportSink;
  probeBrowser?: () => Promise<BrowserProbe>;
}

interface ActiveTask {
  command: StartTaskCommand;
  executor: AutomationExecutorAdapter;
  lease: ControlLease;
  artifact?: Buffer;
  expectedHumanProbe?: BrowserProbe;
}

function hostnameMatches(url: string, allowedDomains: readonly string[]): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  return allowedDomains.some((value) => {
    const candidate = value.includes('://') ? value : `https://${value}`;
    return new URL(candidate).hostname.toLowerCase() === hostname;
  });
}

export class DesktopTaskOrchestrator {
  private active: ActiveTask | null = null;
  private reportSequence = 0;
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: DesktopTaskOrchestratorOptions) {}

  handle(command: AgentCommand): Promise<void> {
    return this.enqueue(() => this.processCommand(command));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.commandQueue.then(operation, operation);
    this.commandQueue = result.catch(() => undefined);
    return result;
  }

  private async processCommand(command: AgentCommand): Promise<void> {
    const prior = this.options.database.getCommandReceipt(command.commandId);
    if (prior && prior.status !== 'processing') {
      await this.sendReport(
        prior.status === 'accepted' ? 'COMMAND_ACK' : 'COMMAND_REJECTED',
        command,
        { ...prior.result, duplicate: true },
      );
      return;
    }

    try {
      this.validateEnvelope(command);
      if (!prior) {
        await this.saveReceipt(command, 'processing', { commandType: command.type });
      }
      if (command.type === 'START_TASK') {
        await this.startTask(command);
      } else {
        await this.controlTask(command);
      }
      const result = { accepted: true, commandType: command.type };
      await this.saveReceipt(command, 'accepted', result);
      await this.sendReport('COMMAND_ACK', command, result);
    } catch (error: unknown) {
      if (error instanceof ArtifactRejectedError && command.type === 'START_TASK' && command.capability) {
        await this.sendReport('ARTIFACT_REJECTED', command, {
          artifactId: command.capability.artifactId,
          artifactVersion: command.capability.version,
          code: error.code,
          detail: error.message,
        });
      }
      const result = {
        accepted: false,
        commandType: command.type,
        reason: error instanceof Error ? error.message : String(error),
      };
      await this.saveReceipt(command, 'rejected', result);
      await this.sendReport('COMMAND_REJECTED', command, result);
    }
  }

  private validateEnvelope(command: AgentCommand): void {
    if (command.tenantId !== this.options.tenantId || command.deviceId !== this.options.deviceId) {
      throw new Error('Command identity does not match this Desktop agent');
    }
    if (command.protocolVersion !== this.options.protocolVersion) {
      throw new Error(`Unsupported command protocol ${command.protocolVersion}`);
    }
    if (Date.parse(command.expiresAt) <= Date.now()) {
      throw new Error('Command has expired');
    }
  }

  private async startTask(command: StartTaskCommand): Promise<void> {
    if (this.active) {
      throw new Error(`Desktop is already executing task ${this.active.command.taskId}`);
    }
    if (!hostnameMatches(command.task.site.entryUrl, command.task.site.allowedDomains)) {
      throw new Error('Task entry URL is outside its allowed domains');
    }
    if (command.task.mode === 'write' && !command.capability) {
      throw new Error('Write tasks require a validated capability; Sidecar cannot perform writes');
    }

    const artifact = command.capability
      ? await this.options.artifactLoader.load(command.capability)
      : undefined;
    const executorKind: AutomationExecutor = artifact
      ? 'playwright-runner'
      : 'browser-use-sidecar';
    const executor = this.options.executors.get(executorKind);
    if (!executor) throw new Error(`Executor is unavailable: ${executorKind}`);

    const now = Date.now();
    await this.options.database.saveTask({
      id: command.taskId,
      title: command.task.title,
      mode: command.task.mode,
      status: 'PLANNING',
      targetUrl: command.task.site.entryUrl,
      context: {
        allowedDomains: command.task.site.allowedDomains,
        capability: command.capability,
        resources: command.resources,
        executor: executorKind,
      },
      stateVersion: 1,
      createdAt: Date.parse(command.task.createdAt),
      updatedAt: now,
    });

    await this.options.page.goto(command.task.site.entryUrl, { waitUntil: 'domcontentloaded' });
    const probe = await this.probeBrowser();
    if (!hostnameMatches(probe.url, command.task.site.allowedDomains)) {
      throw new Error('Chromium navigated outside the allowed domains');
    }

    const lease = this.options.control.acquire(command.taskId, executorKind);
    this.active = { command, executor, lease, artifact };
    await this.saveCheckpoint('RUNNING', probe);
    this.options.frames.start(command.taskId);
    this.startExecution(false);
  }

  private async controlTask(command: Exclude<AgentCommand, StartTaskCommand>): Promise<void> {
    const active = this.active;
    if (!active || active.command.taskId !== command.taskId) {
      throw new Error(`Task is not active on this Desktop: ${command.taskId}`);
    }

    switch (command.type) {
      case 'PAUSE_TASK':
        await active.executor.pause();
        this.options.frames.stop();
        await this.saveCheckpoint('PAUSED', await this.probeBrowser());
        return;
      case 'REQUEST_TAKEOVER': {
        await active.executor.pause();
        const expected = await this.probeBrowser();
        active.lease = await this.options.control.transferToHuman(
          active.lease.token,
          () => active.executor.drain(),
        );
        active.expectedHumanProbe = expected;
        await this.options.page.bringToFront();
        await this.saveCheckpoint('WAITING_HUMAN', expected);
        return;
      }
      case 'RESUME_AFTER_HUMAN': {
        if (active.lease.holder !== 'human' || !active.expectedHumanProbe) {
          throw new Error('Task is not waiting for human control');
        }
        const actual = await this.probeBrowser();
        active.lease = this.options.control.resumeAfterHuman(
          active.lease.token,
          active.executor.kind,
          active.expectedHumanProbe,
          actual,
          active.command.task.site.allowedDomains,
        );
        active.expectedHumanProbe = undefined;
        await this.saveCheckpoint('RUNNING', actual);
        this.options.frames.start(command.taskId);
        this.startExecution(true);
        return;
      }
      case 'CANCEL_TASK':
        await active.executor.cancel();
        this.options.frames.stop();
        this.releaseActiveLease();
        await this.saveCheckpoint('CANCELLED', await this.probeBrowser());
        this.active = null;
        return;
      case 'APPROVE_SUBMIT':
        if (!command.submissionId || !active.executor.approveSubmission) {
          throw new Error('Executor cannot approve this submission');
        }
        await active.executor.approveSubmission(command.submissionId);
        return;
      case 'REJECT_SUBMIT':
        if (!command.submissionId || !active.executor.rejectSubmission) {
          throw new Error('Executor cannot reject this submission');
        }
        await active.executor.rejectSubmission(command.submissionId);
        return;
    }
  }

  private startExecution(resume: boolean): void {
    const active = this.active;
    if (!active) return;
    const input: ExecutorInput = {
      command: active.command,
      page: this.options.page,
      artifact: active.artifact,
      leaseToken: active.lease.token,
      resume,
      emitEvent: (state, payload = {}) => this.enqueue(async () => {
        if (this.active !== active) throw new Error('Executor event belongs to a stale task');
        await this.saveCheckpoint(state, await this.probeBrowser());
        await this.sendReport('TASK_EVENT', active.command, { state, ...payload });
      }),
    };
    void active.executor.execute(input).then(
      (outcome) => this.enqueue(() => this.finishExecution(active, outcome)),
      (error: unknown) => this.enqueue(() => this.finishExecution(active, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })),
    );
  }

  private async finishExecution(active: ActiveTask, outcome: ExecutionOutcome): Promise<void> {
    if (this.active !== active) return;
    if (outcome.status === 'waiting-human') {
      const expected = await this.probeBrowser();
      active.lease = await this.options.control.transferToHuman(
        active.lease.token,
        () => active.executor.drain(),
      );
      active.expectedHumanProbe = expected;
      await this.options.page.bringToFront();
      await this.saveCheckpoint('WAITING_HUMAN', expected);
      await this.sendReport('TASK_EVENT', active.command, {
        state: 'WAITING_HUMAN',
        ...outcome.payload,
      });
      return;
    }

    const state = outcome.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
    this.options.frames.stop();
    this.releaseActiveLease();
    await this.saveCheckpoint(state, await this.probeBrowser());
    await this.sendReport('TASK_EVENT', active.command, {
      state,
      ...outcome.payload,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
    this.active = null;
  }

  private releaseActiveLease(): void {
    if (!this.active) return;
    const current = this.options.control.current();
    if (current?.token === this.active.lease.token) {
      this.options.control.release(current.token);
    }
  }

  private async probeBrowser(): Promise<BrowserProbe> {
    if (this.options.probeBrowser) return this.options.probeBrowser();
    return {
      url: this.options.page.url(),
      title: await this.options.page.title(),
      activeTargetId: 'desktop-task-page',
    };
  }

  private async saveCheckpoint(state: string, browser: BrowserProbe): Promise<void> {
    const active = this.active;
    if (!active) return;
    const previous = this.options.database.getCheckpoint(active.command.taskId);
    await this.options.database.saveCheckpoint({
      taskId: active.command.taskId,
      state,
      context: {
        executor: active.executor.kind,
        leaseEpoch: active.lease.epoch,
      },
      browser,
      sequence: (previous?.sequence ?? 0) + 1,
      updatedAt: Date.now(),
    });
    const task = this.options.database.getTask(active.command.taskId);
    if (task) {
      await this.options.database.saveTask({
        ...task,
        status: state,
        stateVersion: (task.stateVersion ?? 0) + 1,
        updatedAt: Date.now(),
      });
    }
  }

  private async saveReceipt(
    command: AgentCommand,
    status: CommandReceiptRecord['status'],
    result: Record<string, unknown>,
  ): Promise<void> {
    await this.options.database.saveCommandReceipt({
      commandId: command.commandId,
      taskId: command.taskId,
      status,
      result,
      updatedAt: Date.now(),
    });
  }

  private async sendReport(
    type: AgentReport['type'],
    command: AgentCommand,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.reportSequence += 1;
    await this.options.reports.sendReport({
      protocolVersion: this.options.protocolVersion,
      reportId: randomUUID(),
      type,
      tenantId: this.options.tenantId,
      deviceId: this.options.deviceId,
      taskId: command.taskId,
      commandId: command.commandId,
      sequence: this.reportSequence,
      timestamp: new Date().toISOString(),
      payload,
    });
  }
}

export type DesktopLocalDatabase = LocalDatabaseManager;
