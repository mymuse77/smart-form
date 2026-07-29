import { z } from 'zod';

export const DataSourceTypeSchema = z.enum(['profile', 'dataset', 'manual']);
export type DataSourceType = z.infer<typeof DataSourceTypeSchema>;

export const DataSourceFieldSchema = z.object({
  key: z.string().min(1, '字段 Key 不能为空'),
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'email', 'phone']).default('string'),
  sensitive: z.boolean().default(false),
  description: z.string().optional(),
});
export type DataSourceField = z.infer<typeof DataSourceFieldSchema>;

export const DataSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, '数据源名称不能为空'),
  type: DataSourceTypeSchema.default('profile'),
  fields: z.array(DataSourceFieldSchema),
  records: z.array(z.record(z.any())).default([]),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
});
export type DataSource = z.infer<typeof DataSourceSchema>;
