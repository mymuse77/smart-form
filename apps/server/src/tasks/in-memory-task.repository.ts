import type { TaskRepository, TaskRouteRecord } from './task.repository';

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, TaskRouteRecord>();

  async save(record: TaskRouteRecord): Promise<void> {
    this.tasks.set(`${record.tenantId}:${record.task.id}`, structuredClone(record));
  }

  async find(tenantId: string, taskId: string): Promise<TaskRouteRecord | null> {
    return this.tasks.get(`${tenantId}:${taskId}`) ?? null;
  }

  async updateState(tenantId: string, taskId: string, state: string): Promise<void> {
    const key = `${tenantId}:${taskId}`;
    const record = this.tasks.get(key);
    if (record) this.tasks.set(key, { ...record, state });
  }
}

