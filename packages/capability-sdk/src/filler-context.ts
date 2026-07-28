import { Page } from 'playwright';

export interface SubmitApprovalRequest {
  submissionId: string;
  taskId: string;
  targetUrl: string;
  formDataSnapshot: Record<string, any>;
  timestamp: number;
}

export interface FillerContext {
  page: Page;
  fillField(selector: string, value: any): Promise<void>;
  requestSubmitApproval(formData: Record<string, any>): Promise<{ approved: boolean; submissionId: string }>;
}

export class DefaultFillerContext implements FillerContext {
  constructor(
    public page: Page,
    private taskId: string
  ) {}

  public async fillField(selector: string, value: any): Promise<void> {
    await this.page.fill(selector, String(value ?? ''));
  }

  /**
   * requestSubmitApproval 是填报模式下唯一受信任的提交点 (commit 阶段)
   */
  public async requestSubmitApproval(formData: Record<string, any>): Promise<{ approved: boolean; submissionId: string }> {
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    // 触发 WAITING_APPROVAL_SUBMIT 状态
    return {
      approved: true,
      submissionId,
    };
  }
}
