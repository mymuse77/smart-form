export type ControlMode = 'AGENT_CONTROL' | 'HUMAN_CONTROL' | 'TRANSFERRING' | 'WAITING_APPROVAL';

export interface ControlStateChangePayload {
  previousMode: ControlMode;
  currentMode: ControlMode;
  reason?: string;
  timestamp: number;
}

export class ControlManager {
  private currentMode: ControlMode = 'AGENT_CONTROL';
  private listeners: ((payload: ControlStateChangePayload) => void)[] = [];

  public getMode(): ControlMode {
    return this.currentMode;
  }

  public onStateChange(listener: (payload: ControlStateChangePayload) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 请求切换到人工控制 (HUMAN_CONTROL)
   */
  public async requestHumanControl(reason: string = 'User Manual Takeover'): Promise<boolean> {
    if (this.currentMode === 'HUMAN_CONTROL') return true;

    const previousMode = this.currentMode;
    this.currentMode = 'TRANSFERRING';
    this.notifyListeners(previousMode, 'TRANSFERRING', reason);

    // 模拟等待当前原子动作结束清空队列
    await new Promise((resolve) => setTimeout(resolve, 200));

    this.currentMode = 'HUMAN_CONTROL';
    this.notifyListeners('TRANSFERRING', 'HUMAN_CONTROL', reason);
    return true;
  }

  /**
   * 恢复 Agent 控制 (AGENT_CONTROL)
   */
  public async resumeAgentControl(reason: string = 'User Click Resume'): Promise<boolean> {
    if (this.currentMode === 'AGENT_CONTROL') return true;

    const previousMode = this.currentMode;
    this.currentMode = 'TRANSFERRING';
    this.notifyListeners(previousMode, 'TRANSFERRING', reason);

    // 重新探测状态
    await new Promise((resolve) => setTimeout(resolve, 200));

    this.currentMode = 'AGENT_CONTROL';
    this.notifyListeners('TRANSFERRING', 'AGENT_CONTROL', reason);
    return true;
  }

  private notifyListeners(previousMode: ControlMode, currentMode: ControlMode, reason?: string) {
    const payload: ControlStateChangePayload = {
      previousMode,
      currentMode,
      reason,
      timestamp: Date.now(),
    };
    this.listeners.forEach((listener) => listener(payload));
  }
}
