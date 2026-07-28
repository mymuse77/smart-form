import { z } from "zod";

export const TransformEnum = z.enum([
  "trim",
  "uppercase",
  "lowercase",
  "date_format_iso",
  "number_to_fixed_2"
]);
export type TransformType = z.infer<typeof TransformEnum>;

export const FieldMappingSchema = z.object({
  sourceField: z.string(),
  targetField: z.string(),
  sensitive: z.boolean().default(false),
  transform: TransformEnum.optional(),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const DataSourceTypeSchema = z.enum(["profile", "dataset", "manual"]);
export type DataSourceType = z.infer<typeof DataSourceTypeSchema>;

export const DataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: DataSourceTypeSchema,
  schema: z.record(z.string()),
  createdAt: z.number().default(() => Date.now()),
});
export type DataSource = z.infer<typeof DataSourceSchema>;
