import type { CapabilityStep } from '@smart-form/contracts';
import type { ActionTrace, TraceStep } from './trace';

function selectorFor(step: TraceStep): string {
  const selector = step.target?.selector;
  if (!selector) {
    throw new Error(`Trace step ${step.stepId} cannot be compiled without a stable selector`);
  }
  return selector;
}

/**
 * Converts validated exploration traces into the declarative capability
 * runtime. It intentionally cannot emit arbitrary TypeScript.
 */
export class DeclarativeFillCompiler {
  static compileToProgram(trace: ActionTrace): CapabilityStep[] {
    return trace.steps.flatMap((step): CapabilityStep[] => {
      switch (step.actionType) {
        case 'navigate':
          if (!step.url) throw new Error(`Navigate step ${step.stepId} is missing a URL`);
          return [{ type: 'navigate', url: step.url }];
        case 'click':
          return [{ type: 'click', selector: selectorFor(step) }];
        case 'fill':
          return [{
            type: 'fill',
            selector: selectorFor(step),
            value: step.fieldId
              ? { source: 'input', key: step.fieldId }
              : { source: 'literal', value: step.value ?? '' },
          }];
        case 'select':
          return [{
            type: 'select',
            selector: selectorFor(step),
            value: step.fieldId
              ? { source: 'input', key: step.fieldId }
              : { source: 'literal', value: step.value ?? '' },
          }];
        case 'commit':
        case 'submit':
          return [{
            type: 'submit',
            selector: selectorFor(step),
            snapshotKeys: step.fieldId ? [step.fieldId] : [],
          }];
        case 'human_secret_input':
          throw new Error(
            `Trace step ${step.stepId} requires human input and cannot be compiled into a capability`,
          );
        case 'extract':
          throw new Error(
            `Trace step ${step.stepId} lacks an extraction schema and cannot be compiled automatically`,
          );
      }
    });
  }
}

/** @deprecated Use DeclarativeFillCompiler. */
export const PlaywrightFillCompiler = DeclarativeFillCompiler;
