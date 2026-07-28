import { z } from "zod";

/**
 * 任务运行模式：
 * - read: 采集模式（MVP）
 * - write: 填报模式（后续扩展）
 */
export const TaskModeSchema = z.enum(["read", "write"]);
export type TaskMode = z.infer<typeof TaskModeSchema>;

/**
 * 采集字段定义 Schema
 */
export const FieldDefinitionSchema = z.object({
  name: z.string().min(1, "字段名称不能为空"),
  label: z.string(),
  type: z.enum(["string", "number", "boolean", "date", "url", "image"]).default("string"),
  required: z.boolean().default(false),
  description: z.string().optional(),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

/**
 * 预算约束配置 Schema
 */
export const TaskBudgetSchema = z.object({
  maxSteps: z.number().int().positive().default(100),
  stepTimeoutMs: z.number().int().positive().default(30000),
  totalTimeoutMs: z.number().int().positive().default(1800000), // 30 分钟
  maxCostUsd: z.number().positive().default(1.0),
});
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;

/**
 * 完整任务定义 Schema
 */
export const TaskDefinitionSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  tenantId: z.string().default("default_tenant"),
  workspaceId: z.string().default("default_workspace"),
  title: z.string().min(1, "任务标题不能为空"),
  mode: TaskModeSchema.default("read"),
  targetUrl: z.string().url("目标必须是有效 URL"),
  description: z.string(),
  fields: z.array(FieldDefinitionSchema).min(1, "至少需要定义一个采集字段"),
  budget: TaskBudgetSchema.default({}),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
});
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

/**
 * 校验帮助函数
 */
export function validateTaskDefinition(data: unknown): TaskDefinition {
  return TaskDefinitionSchema.parse(data);
}
