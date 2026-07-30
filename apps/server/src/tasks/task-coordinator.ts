import { randomUUID } from 'node:crypto';
import {
  ChatTaskRequest,
  type AgentCommand,
  type ChatTaskAccepted,
  type ChatTaskRequest as ChatTaskRequestValue,
  type ManagedResourceVersion,
  type TaskControlRequest,
  type TaskDefinition,
  type TaskMode,
  TaskState,
} from '@smart-form/contracts';
import { ResourceService } from '../resources/resource.service';
import { RealtimeHub } from '../realtime/realtime-hub';
import { NotFoundError, ValidationError } from '../shared/app-error';
import type { TaskRepository } from './task.repository';

function inferMode(request: ChatTaskRequestValue): TaskMode {
  if (request.modeHint) return request.modeHint;
  if (request.inputValues && Object.keys(request.inputValues).length > 0) return 'write';
  const explicitWrite = /(?:填写|填报|录入|写入|提交表单|\bfill\b|\bsubmit\b)/iu.test(request.message);
  const negated = /(?:不要|无需|禁止|不允许).{0,8}(?:填写|填报|写入|提交)/u.test(request.message);
  return explicitWrite && !negated ? 'write' : 'read';
}

function resolveTargetUrl(request: ChatTaskRequestValue): string {
  const candidate = request.targetUrl
    ?? request.message.match(/https?:\/\/[^\s<>"'，。；]+/iu)?.[0];
  if (!candidate) {
    throw new ValidationError('A targetUrl or an HTTP(S) URL in the chat message is required');
  }
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError('Task targets must use HTTP or HTTPS');
  }
  url.hash = '';
  return url.toString();
}

function parseInputValues(message: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /([\p{L}\p{N}_-]+)\s*(?:=|:|：)\s*(?:"([^"]*)"|'([^']*)'|([^\s,，;；]+))/gu;
  for (const match of message.matchAll(pattern)) {
    const key = match[1]!;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (/^https?$/i.test(key) && value.startsWith('//')) continue;
    values[key] = value;
  }
  return values;
}

export class TaskCoordinator {
  constructor(
    private readonly resources: ResourceService,
    private readonly realtime: RealtimeHub,
    private readonly taskRepository: TaskRepository,
  ) {
    this.realtime.onReport((report) => {
      if (report.type !== 'TASK_EVENT' || !report.taskId) return;
      const state = TaskState.safeParse(report.payload.state);
      if (!state.success) return;
      void this.taskRepository
        .updateState(report.tenantId, report.taskId, state.data)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`${JSON.stringify({
            level: 'error',
            event: 'task_state_persistence_failed',
            tenantId: report.tenantId,
            taskId: report.taskId,
            message,
          })}\n`);
        });
    });
  }

  async planAndDispatch(
    tenantId: string,
    requestInput: ChatTaskRequestValue,
  ): Promise<ChatTaskAccepted> {
    const request = ChatTaskRequest.parse(requestInput);
    const mode = inferMode(request);
    const targetUrl = resolveTargetUrl(request);
    const inputValues = request.inputValues ?? parseInputValues(request.message);
    if (mode === 'write' && Object.keys(inputValues).length === 0) {
      throw new ValidationError('Write tasks require explicit inputValues');
    }

    const matches = await this.resources.match({
      tenantId,
      intent: request.message,
      targetUrl,
      mode,
      requestedKinds: ['capability', 'prompt', 'skill', 'rule'],
      tags: request.tags,
    });
    const capabilityMatch = matches.find((match) => (
      match.resource.kind === 'capability' && match.score >= 0.4
    ));
    if (mode === 'write' && !capabilityMatch) {
      throw new ValidationError('No active validated write capability matches this task');
    }

    const now = new Date();
    const taskId = randomUUID();
    const task: TaskDefinition = {
      id: taskId,
      tenantId,
      workspaceId: request.workspaceId,
      title: request.message.trim().slice(0, 160),
      description: request.message.trim(),
      taskType: mode === 'read' ? 'collect' : 'fill',
      mode,
      site: {
        entryUrl: targetUrl,
        allowedDomains: [new URL(targetUrl).hostname.toLowerCase()],
      },
      target: {
        entity: 'record',
        fields: request.fields ?? Object.keys(inputValues).map((name) => ({
          name,
          label: name,
          type: 'string' as const,
          required: true,
        })),
      },
      ...(mode === 'write' ? { input: { values: inputValues } } : {}),
      output: { format: 'jsonl', destination: 'local' },
      budget: {
        maxSteps: 100,
        stepTimeoutMs: 30_000,
        totalTimeoutMs: 1_800_000,
        maxCostUsd: 1,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const selectedResources: ManagedResourceVersion[] = matches
      .filter((match) => match.resource.kind !== 'capability' && match.score >= 0.4)
      .map((match) => match.resource);
    const command: AgentCommand = {
      protocolVersion: '1.0.0',
      commandId: randomUUID(),
      taskId,
      tenantId,
      deviceId: request.deviceId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      type: 'START_TASK',
      task,
      capability: capabilityMatch?.resource.artifact,
      resources: selectedResources,
    };
    await this.register(command);
    this.realtime.dispatch(command);
    return {
      accepted: true,
      task,
      commandId: command.commandId,
      matchedResources: matches,
    };
  }

  async register(command: AgentCommand): Promise<void> {
    if (command.type !== 'START_TASK') return;
    await this.taskRepository.save({
      tenantId: command.tenantId,
      deviceId: command.deviceId,
      task: command.task,
      state: 'WAITING_DEVICE',
    });
  }

  async dispatchControl(
    tenantId: string,
    taskId: string,
    control: TaskControlRequest,
  ): Promise<AgentCommand> {
    const route = await this.taskRepository.find(tenantId, taskId);
    if (!route) {
      throw new NotFoundError('active task', taskId);
    }
    if (
      ['APPROVE_SUBMIT', 'REJECT_SUBMIT'].includes(control.type)
      && !control.submissionId
    ) {
      throw new ValidationError(`${control.type} requires submissionId`);
    }
    const now = new Date();
    const command: AgentCommand = {
      protocolVersion: '1.0.0',
      commandId: randomUUID(),
      taskId,
      tenantId,
      deviceId: route.deviceId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      type: control.type,
      submissionId: control.submissionId,
    };
    this.realtime.dispatch(command);
    if (control.type === 'CANCEL_TASK') {
      await this.taskRepository.updateState(tenantId, taskId, 'CANCELLED');
    }
    return command;
  }
}
