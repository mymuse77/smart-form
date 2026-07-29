export type TaskState =
  | 'DRAFT'
  | 'PLANNING'
  | 'MATCHING'
  | 'EXPLORING'
  | 'COLLECTING'
  | 'FILLING'
  | 'WAITING_APPROVAL_SUBMIT'
  | 'SUBMITTING'
  | 'SUBMIT_FAILED'
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
  submissionId?: string;
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
  | { type: 'START_FILLING' }
  | { type: 'REQUIRE_SUBMIT_APPROVAL'; submissionId: string }
  | { type: 'APPROVE_SUBMIT' }
  | { type: 'REJECT_SUBMIT' }
  | { type: 'SUBMIT_SUCCESS' }
  | { type: 'SUBMIT_FAIL'; error: string }
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
        if (event.type === 'MATCH_SUCCESS') {
          this.currentState = this.context.mode === 'write' ? 'FILLING' : 'COLLECTING';
        } else if (event.type === 'MATCH_FAIL') {
          this.currentState = 'EXPLORING';
        }
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
        } else if (event.type === 'START_FILLING') {
          this.currentState = 'FILLING';
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

      case 'FILLING':
        if (event.type === 'REQUIRE_SUBMIT_APPROVAL') {
          this.currentState = 'WAITING_APPROVAL_SUBMIT';
          this.context.submissionId = event.submissionId;
        } else if (event.type === 'REQUIRE_HUMAN') {
          this.currentState = 'WAITING_HUMAN';
          this.context.humanReason = event.reason;
        }
        break;

      case 'WAITING_APPROVAL_SUBMIT':
        if (event.type === 'APPROVE_SUBMIT') {
          this.currentState = 'SUBMITTING';
        } else if (event.type === 'REJECT_SUBMIT') {
          this.currentState = 'CANCELLED';
        }
        break;

      case 'SUBMITTING':
        if (event.type === 'SUBMIT_SUCCESS') {
          this.currentState = 'SUCCEEDED';
        } else if (event.type === 'SUBMIT_FAIL') {
          this.currentState = 'SUBMIT_FAILED';
          this.context.errorMsg = event.error;
        }
        break;

      case 'WAITING_HUMAN':
        if (event.type === 'HUMAN_RESUME') {
          this.currentState = this.context.mode === 'write' ? 'FILLING' : 'EXPLORING';
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
    if (event.type === 'PAUSE' && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'SUBMITTING'].includes(this.currentState)) {
      this.currentState = 'PAUSED';
    } else if (event.type === 'RESUME' && this.currentState === 'PAUSED') {
      this.currentState = this.context.mode === 'write' ? 'FILLING' : 'EXPLORING';
    } else if (event.type === 'CANCEL' && this.currentState !== 'SUBMITTING') { // SUBMITTING 不可逆，禁止 CANCEL
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

