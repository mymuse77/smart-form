export interface SubmissionReceipt {
  submissionId: string;
  taskId: string;
  targetUrl: string;
  status: 'SUBMITTED' | 'FAILED';
  timestamp: number;
  responseSummary?: string;
}

export class SubmissionManager {
  private static submissions: Map<string, SubmissionReceipt> = new Map();

  public static createSubmission(taskId: string, targetUrl: string): string {
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.submissions.set(submissionId, {
      submissionId,
      taskId,
      targetUrl,
      status: 'SUBMITTED',
      timestamp: Date.now(),
    });
    return submissionId;
  }

  public static isDuplicate(submissionId: string): boolean {
    return this.submissions.has(submissionId);
  }

  public static getReceipt(submissionId: string): SubmissionReceipt | undefined {
    return this.submissions.get(submissionId);
  }
}
