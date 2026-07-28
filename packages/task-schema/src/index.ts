/**
 * @smart-form/task-schema
 *
 * 任务定义的扩展 Schema 与校验工具。
 * 基础类型来自 @smart-form/contracts，此包提供：
 * - 任务创建请求的完整校验
 * - mode 字段的运行时守卫
 * - 任务定义的 JSON Schema 导出（供 Sidecar 使用）
 */

import {
  TaskDefinition,
  TaskMode,
  type TaskSummary,
} from '@smart-form/contracts';

/**
 * 校验任务定义是否合法
 */
export function validateTaskDefinition(input: unknown): TaskDefinition {
  return TaskDefinition.parse(input);
}

/**
 * 守卫：任务模式在创建时锁定，不可动态切换
 * 用于 XState 状态机 guard
 */
export function isReadMode(task: TaskSummary): boolean {
  return task.mode === 'read';
}

export function isWriteMode(task: TaskSummary): boolean {
  return task.mode === 'write';
}

/**
 * 根据 mode 判断是否允许进入指定状态
 * 阻止读模式任务进入 FILLING，写模式任务进入 COLLECTING
 */
export function canEnterState(
  task: TaskSummary,
  targetState: string,
): boolean {
  if (task.mode === 'read' && targetState === 'FILLING') return false;
  if (task.mode === 'write' && targetState === 'COLLECTING') return false;
  return true;
}

export { TaskDefinition, TaskMode } from '@smart-form/contracts';
