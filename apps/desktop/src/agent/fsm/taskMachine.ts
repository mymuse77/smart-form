export type TaskState =
  | 'DRAFT'
  | 'PLANNING'
  | 'MATCHING'
  | 'EXPLORING'
  | 'COLLECTING'
  | 'DATA_VALIDATING'
  | 'COMPILING'
  | 'REPLAYING'
  | 'PUBLISHING'
  | 'SUCCEEDED'
  | 'WAITING_HUMAN'
  | 'PAUSED'
  | 'CANCELLED'
  | 'FAILED';

export interface TaskContext {
  taskId: string;
  targetUrl: string;
  mode: 'read' | 'write';
  currentStep: number;
  maxSteps: number;
  collectedCount: number;
  errorMsg?: string;
  humanReason?: string;
}

export type TaskEvent =
  | { type: 'START' }
  | { type: 'PLAN_DONE' }
  | { type: 'MATCH_FAIL' }
  | { type: 'MATCH_SUCCESS' }
  | { type: 'EXPLORE_STEP'; step: number }
  | { type: 'REQUIRE_HUMAN'; reason: string }
  | { type: 'HUMAN_RESUME' }
  | { type: 'COLLECT_PAGE'; count: number }
  | { type: 'VALIDATE_DONE' }
  | { type: 'COMPILE_DONE' }
  | { type: 'REPLAY_DONE' }
  | { type: 'PUBLISH_DONE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'CANCEL' }
  | { type: 'FAIL'; error: string };

export class TaskStateMachine {
  private currentState: TaskState = 'DRAFT';
  private context: TaskContext;
  private listeners: ((state: TaskState, ctx: TaskContext) => void)[] = [];

  constructor(initialContext: Partial<TaskContext> & { taskId: string; targetUrl: string }) {
    this.context = {
      mode: 'read',
      currentStep: 0,
      maxSteps: 100,
      collectedCount: 0,
      ...initialContext,
    };
  }

  public getState(): TaskState {
    return this.currentState;
  }

  public getContext(): TaskContext {
    return { ...this.context };
  }

  public subscribe(listener: (state: TaskState, ctx: TaskContext) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public send(event: TaskEvent): boolean {
    const prevState = this.currentState;

    switch (this.currentState) {
      case 'DRAFT':
        if (event.type === 'START') this.currentState = 'PLANNING';
        break;

      case 'PLANNING':
        if (event.type === 'PLAN_DONE') this.currentState = 'MATCHING';
        break;

      case 'MATCHING':
        if (event.type === 'MATCH_SUCCESS') this.currentState = 'COLLECTING';
        else if (event.type === 'MATCH_FAIL') this.currentState = 'EXPLORING';
        break;

      case 'EXPLORING':
        if (event.type === 'EXPLORE_STEP') {
          this.context.currentStep = event.step;
        } else if (event.type === 'REQUIRE_HUMAN') {
          this.currentState = 'WAITING_HUMAN';
          this.context.humanReason = event.reason;
        } else if (event.type === 'COLLECT_PAGE') {
          this.currentState = 'COLLECTING';
          this.context.collectedCount += event.count;
        }
        break;

      case 'COLLECTING':
        if (event.type === 'COLLECT_PAGE') {
          this.context.collectedCount += event.count;
        } else if (event.type === 'VALIDATE_DONE') {
          this.currentState = 'DATA_VALIDATING';
        } else if (event.type === 'REQUIRE_HUMAN') {
          this.currentState = 'WAITING_HUMAN';
          this.context.humanReason = event.reason;
        }
        break;

      case 'WAITING_HUMAN':
        if (event.type === 'HUMAN_RESUME') {
          this.currentState = 'EXPLORING';
          this.context.humanReason = undefined;
        }
        break;

      case 'DATA_VALIDATING':
        if (event.type === 'COMPILE_DONE') this.currentState = 'COMPILING';
        break;

      case 'COMPILING':
        if (event.type === 'REPLAY_DONE') this.currentState = 'REPLAYING';
        break;

      case 'REPLAYING':
        if (event.type === 'PUBLISH_DONE') this.currentState = 'SUCCEEDED';
        break;
    }

    // 全局通用转换
    if (event.type === 'PAUSE' && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(this.currentState)) {
      this.currentState = 'PAUSED';
    } else if (event.type === 'RESUME' && this.currentState === 'PAUSED') {
      this.currentState = 'EXPLORING';
    } else if (event.type === 'CANCEL') {
      this.currentState = 'CANCELLED';
    } else if (event.type === 'FAIL') {
      this.currentState = 'FAILED';
      this.context.errorMsg = event.error;
    }

    if (this.currentState !== prevState) {
      this.notifyListeners();
      return true;
    }
    return false;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.currentState, this.getContext()));
  }
}
