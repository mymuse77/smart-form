import { ActionTrace, TraceStep } from './trace';

export class TraceNormalizer {
  public static normalize(trace: ActionTrace): ActionTrace {
    const rawSteps = trace.steps || [];
    const cleanSteps: TraceStep[] = [];

    for (let i = 0; i < rawSteps.length; i++) {
      const current = rawSteps[i];

      // 1. 脱敏密码与敏感信息
      if (current.target?.label?.includes('密码') || current.target?.label?.includes('验证码')) {
        cleanSteps.push({
          ...current,
          actionType: 'human_secret_input',
          value: '[REDACTED_SECRET]',
        });
        continue;
      }

      // 2. 合并同字段的连续输入
      if (
        cleanSteps.length > 0 &&
        cleanSteps[cleanSteps.length - 1].actionType === 'fill' &&
        current.actionType === 'fill' &&
        cleanSteps[cleanSteps.length - 1].target?.selector === current.target?.selector
      ) {
        cleanSteps[cleanSteps.length - 1].value = current.value;
        continue;
      }

      cleanSteps.push(current);
    }

    return {
      ...trace,
      steps: cleanSteps,
    };
  }
}
