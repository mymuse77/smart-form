import type { TaskDefinition } from '@smart-form/contracts';

export interface TaskRouteRecord {
  tenantId: string;
  deviceId: string;
  task: TaskDefinition;
  state: string;
}

export interface TaskRepository {
  save(record: TaskRouteRecord): Promise<void>;
  find(tenantId: string, taskId: string): Promise<TaskRouteRecord | null>;
  updateState(tenantId: string, taskId: string, state: string): Promise<void>;
}

