import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  AgentCommand,
  ChatTaskRequest,
  TaskControlRequest,
  type AgentCommand as AgentCommandValue,
} from '@smart-form/contracts';
import { AccessTokenGuard, type AuthenticatedRequest } from '../auth/access-token.guard';
import { ForbiddenError } from '../shared/app-error';
import { RealtimeHub } from '../realtime/realtime-hub';
import { TaskCoordinator } from './task-coordinator';

@Controller('/v1/tasks')
@UseGuards(AccessTokenGuard)
export class TaskController {
  constructor(
    @Inject(RealtimeHub)
    private readonly realtime: RealtimeHub,
    @Inject(TaskCoordinator)
    private readonly coordinator: TaskCoordinator,
  ) {}

  @Post('/dispatch')
  async dispatch(
    @Req() request: AuthenticatedRequest,
    @Body() body: AgentCommandValue,
  ) {
    if (!request.principal.scopes.includes('tasks:execute')) {
      throw new ForbiddenError('tasks:execute scope is required');
    }
    const command = AgentCommand.parse(body);
    if (command.tenantId !== request.principal.tenantId) {
      throw new ForbiddenError('Cannot dispatch tasks for another tenant');
    }
    await this.coordinator.register(command);
    this.realtime.dispatch(command);
    return {
      accepted: true,
      commandId: command.commandId,
      deviceId: command.deviceId,
    };
  }

  @Post('/from-chat')
  fromChat(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    this.requireTaskScope(request);
    return this.coordinator.planAndDispatch(
      request.principal.tenantId,
      ChatTaskRequest.parse(body),
    );
  }

  @Post('/:taskId/control')
  async control(
    @Req() request: AuthenticatedRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    this.requireTaskScope(request);
    const command = await this.coordinator.dispatchControl(
      request.principal.tenantId,
      taskId,
      TaskControlRequest.parse(body),
    );
    return { accepted: true, commandId: command.commandId };
  }

  private requireTaskScope(request: AuthenticatedRequest): void {
    if (!request.principal.scopes.includes('tasks:execute')) {
      throw new ForbiddenError('tasks:execute scope is required');
    }
  }
}
