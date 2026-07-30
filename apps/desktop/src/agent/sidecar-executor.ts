import type { AutomationExecutorAdapter, ExecutionOutcome, ExecutorInput } from './task-orchestrator';
import { SidecarProcessClient } from './sidecar-client';

export class SidecarExecutorAdapter implements AutomationExecutorAdapter {
  readonly kind = 'browser-use-sidecar' as const;
  private taskId?: string;
  private execution?: Promise<ExecutionOutcome>;

  constructor(
    private readonly client: SidecarProcessClient,
    private readonly cdpEndpoint: string,
    private readonly targetId: () => Promise<string>,
  ) {}

  async execute(input: ExecutorInput): Promise<ExecutionOutcome> {
    if (input.command.task.mode !== 'read') {
      throw new Error('Browser Use Sidecar is restricted to read tasks');
    }
    if (input.resume) {
      if (!this.taskId || !this.execution) throw new Error('Sidecar has no paused task to resume');
      await this.client.control('resume', this.taskId);
      return this.execution;
    }
    if (this.execution) throw new Error('Sidecar executor already has an active task');

    this.taskId = input.command.taskId;
    const prompt = [
      input.command.task.title,
      input.command.task.description,
      `Collect entity: ${input.command.task.target.entity}.`,
      `Requested fields: ${input.command.task.target.fields.map((field) => field.name).join(', ') || '(unspecified)'}.`,
    ].filter(Boolean).join('\n');
    this.execution = this.client.execute({
      taskId: input.command.taskId,
      cdpEndpoint: this.cdpEndpoint,
      targetId: await this.targetId(),
      prompt,
      allowedDomains: input.command.task.site.allowedDomains,
      maxSteps: input.command.task.budget.maxSteps,
    }).then((response) => {
      if (response.status === 'succeeded') {
        return { status: 'succeeded', payload: response.payload } satisfies ExecutionOutcome;
      }
      return {
        status: 'failed',
        error: String(response.payload.error ?? response.status ?? 'Sidecar execution failed'),
      } satisfies ExecutionOutcome;
    }).finally(() => {
      this.execution = undefined;
      this.taskId = undefined;
    });
    return this.execution;
  }

  async pause(): Promise<void> {
    if (!this.taskId) throw new Error('Sidecar has no active task');
    await this.client.control('pause', this.taskId);
  }

  async drain(): Promise<void> {
    // The Python worker acknowledges pause only after the current agent step is idle.
  }

  async cancel(): Promise<void> {
    if (!this.taskId) return;
    await this.client.control('cancel', this.taskId);
  }
}

