import { z } from 'zod';
import { BuiltinTransformType } from './transforms';

export const FieldMappingSchema = z.object({
  targetFieldId: z.string().min(1, '目标表单字段 ID 不能为空'),
  sourceKey: z.string().min(1, '数据源 Key 不能为空'),
  sensitive: z.boolean().default(false),
  transform: z.enum(['identity', 'trim', 'uppercase', 'lowercase', 'date_format_iso', 'to_number']).default('identity'),
  fallbackValue: z.any().optional(),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const MappingSnapshotSchema = z.object({
  dataSourceId: z.string().min(1),
  mappings: z.array(FieldMappingSchema),
  confirmedAt: z.number(),
  confirmedBy: z.string().default('user'),
});
export type MappingSnapshot = z.infer<typeof MappingSnapshotSchema>;
