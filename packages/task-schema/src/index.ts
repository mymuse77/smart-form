/**
 * Backwards-compatible task-schema facade.
 *
 * @smart-form/contracts is the single source of truth. This package remains so
 * existing consumers do not need a flag-day migration.
 */
export {
  TaskMode as TaskModeSchema,
  FieldDefinition as FieldDefinitionSchema,
  TaskBudget as TaskBudgetSchema,
  TaskDefinition as TaskDefinitionSchema,
  validateTaskDefinition,
} from '@smart-form/contracts';

export type {
  TaskMode,
  FieldDefinition,
  TaskBudget,
  TaskDefinition,
} from '@smart-form/contracts';
