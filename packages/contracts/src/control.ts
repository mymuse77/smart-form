import { z } from 'zod';

// ─── 控制权状态 ─────────────────────────────────────────
// 基于设计文档 §8.1

export const ControlState = z.enum([
  'AGENT_CONTROL',              // 自动化控制中
  'HUMAN_CONTROL',              // 用户接管
  'WAITING_APPROVAL',           // 等待批准敏感动作（读写通用）
  'WAITING_APPROVAL_SUBMIT',    // 等待批准不可逆提交动作（填报专属，§8.1 新增）
  'TRANSFERRING',               // 切换中，禁止新输入
]);
export type ControlState = z.infer<typeof ControlState>;

// ─── 人工介入原因 ───────────────────────────────────────
// 基于设计文档 §8.3

export const HumanReviewReason = z.enum([
  'password_input',
  'captcha',
  'mfa',
  'agreement_confirmation',
  'cross_domain_redirect',
  'executable_download',
  'commit_action',               // §8.3 第 6 条新增：提交类动作
  'low_confidence',
  'low_completeness',
  'fingerprint_mismatch',
  'max_retries_exceeded',
  'high_request_volume',
  'file_upload_field',           // §10 新增：input[type=file] 直接转人工
]);
export type HumanReviewReason = z.infer<typeof HumanReviewReason>;

// ─── 提交令牌 ───────────────────────────────────────────
// 基于设计文档 §8.4 幂等性设计

export interface SubmissionToken {
  submissionId: string;
  taskId: string;
  signature: string;           // 服务端签名
  issuedAt: string;
  expiresAt: string;
}

// ─── 提交预览 ───────────────────────────────────────────
// 基于设计文档 §9.3 第四栏

export interface SubmitPreview {
  taskId: string;
  fields: Array<{
    label: string;
    sourceValue: string;       // 脱敏后的值（sensitive 字段显示遮罩）
    targetFieldSelector: string;
    sensitive: boolean;
  }>;
  targetAction: string;        // 如"即将点击【提交】按钮"
}
