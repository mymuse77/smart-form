import { parseAndValidateCapabilityBundle } from '@smart-form/capability-sdk';
import {
  DeclarativeCapabilityRunner,
  type SubmissionApprovalRequest,
} from '@smart-form/playwright-runner';
import type { AutomationExecutorAdapter, ExecutionOutcome, ExecutorInput } from './task-orchestrator';

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

export class RunnerExecutorAdapter implements AutomationExecutorAdapter {
  readonly kind = 'playwright-runner' as const;
  private paused = false;
  private cancelled = false;
  private idle = true;
  private resumeWaiters: Array<() => void> = [];
  private idleWaiters: Array<() => void> = [];
  private readonly approvals = new Map<string, PendingApproval>();
  private execution?: Promise<ExecutionOutcome>;

  execute(input: ExecutorInput): Promise<ExecutionOutcome> {
    if (input.resume) {
      this.resume();
      if (!this.execution) {
        return Promise.reject(new Error('Runner has no paused execution to resume'));
      }
      return this.execution;
    }
    if (this.execution) {
      return Promise.reject(new Error('Runner already has an active execution'));
    }
    this.execution = this.run(input).finally(() => {
      this.execution = undefined;
    });
    return this.execution;
  }

  private async run(input: ExecutorInput): Promise<ExecutionOutcome> {
    if (!input.artifact || !input.command.capability) {
      throw new Error('Runner requires a verified capability artifact');
    }

    this.cancelled = false;
    const bundle = parseAndValidateCapabilityBundle(
      input.artifact,
      input.command.capability,
      input.command.task,
    );
    try {
      const result = await DeclarativeCapabilityRunner.execute(
        bundle,
        input.page,
        input.command.task,
        {
          request: async (request: SubmissionApprovalRequest) => {
            await input.emitEvent('WAITING_APPROVAL_SUBMIT', {
              submissionId: request.submissionId,
              targetUrl: request.targetUrl,
              formDataSnapshot: request.formDataSnapshot,
            });
            return new Promise<boolean>((resolve) => {
              this.approvals.set(request.submissionId, { resolve });
            });
          },
        },
        {
          beforeStep: async () => {
            if (this.cancelled) throw new Error('Runner execution was cancelled');
            if (this.paused) {
              await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
            }
            if (this.cancelled) throw new Error('Runner execution was cancelled');
            this.idle = false;
          },
          afterStep: async () => {
            this.idle = true;
            for (const resolve of this.idleWaiters.splice(0)) resolve();
          },
        },
      );
      return {
        status: 'succeeded',
        payload: {
          records: result.data,
          submissionIds: result.submissions,
        },
      };
    } catch (error: unknown) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      for (const approval of this.approvals.values()) approval.resolve(false);
      this.approvals.clear();
      this.idle = true;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  async pause(): Promise<void> {
    this.paused = true;
    if (this.idle) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  async drain(): Promise<void> {
    if (this.idle) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.resume();
    for (const approval of this.approvals.values()) approval.resolve(false);
    this.approvals.clear();
  }

  async approveSubmission(submissionId: string): Promise<void> {
    const approval = this.approvals.get(submissionId);
    if (!approval) throw new Error(`Submission is not waiting for approval: ${submissionId}`);
    this.approvals.delete(submissionId);
    approval.resolve(true);
  }

  async rejectSubmission(submissionId: string): Promise<void> {
    const approval = this.approvals.get(submissionId);
    if (!approval) throw new Error(`Submission is not waiting for approval: ${submissionId}`);
    this.approvals.delete(submissionId);
    approval.resolve(false);
  }

  private resume(): void {
    this.paused = false;
    for (const resolve of this.resumeWaiters.splice(0)) resolve();
  }
}
