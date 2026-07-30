export interface ActionTarget {
  role?: string;
  label?: string;
  text?: string;
  testId?: string;
  selector?: string;
}

export interface TraceStep {
  stepId: string;
  actionType:
    | 'navigate'
    | 'click'
    | 'fill'
    | 'select'
    | 'extract'
    | 'human_secret_input'
    | 'commit'
    | 'submit';
  target?: ActionTarget;
  value?: string;
  url?: string;
  fieldId?: string;
  confidence: number;
  timestamp: number;
}

export interface ActionTrace {
  traceVersion: string;
  taskId: string;
  targetUrl: string;
  steps: TraceStep[];
  createdAt: number;
}
