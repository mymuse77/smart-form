import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Task as PrismaTask } from '@prisma/client';
import { TaskDefinition } from '@smart-form/contracts';
import { PrismaService } from '../database/prisma.service';
import type { TaskRepository, TaskRouteRecord } from './task.repository';

@Injectable()
export class PrismaTaskRepository implements TaskRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async save(record: TaskRouteRecord): Promise<void> {
    await this.prisma.task.upsert({
      where: { id: record.task.id },
      create: {
        id: record.task.id,
        tenantId: record.tenantId,
        deviceId: record.deviceId,
        mode: record.task.mode,
        state: record.state,
        definition: record.task as unknown as Prisma.InputJsonValue,
      },
      update: {
        deviceId: record.deviceId,
        state: record.state,
        definition: record.task as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    });
  }

  async find(tenantId: string, taskId: string): Promise<TaskRouteRecord | null> {
    const record = await this.prisma.task.findFirst({ where: { id: taskId, tenantId } });
    return record ? this.map(record) : null;
  }

  async updateState(tenantId: string, taskId: string, state: string): Promise<void> {
    await this.prisma.task.updateMany({
      where: { id: taskId, tenantId },
      data: { state, revision: { increment: 1 } },
    });
  }

  private map(record: PrismaTask): TaskRouteRecord {
    return {
      tenantId: record.tenantId,
      deviceId: record.deviceId,
      task: TaskDefinition.parse(record.definition),
      state: record.state,
    };
  }
}

