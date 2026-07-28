import { z } from 'zod';
import { TaskMode } from './task.js';

// ─── 风险等级 ───────────────────────────────────────────
// 基于设计文档 §7.2：read 默认 low；write 默认 high，不可自行降级

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

// ─── 能力状态 ───────────────────────────────────────────
// 基于设计文档 §7.4 + 详细设计文档 §13.3

export const CapabilityStatus = z.enum([
  'DRAFT',
  'VALIDATING',
  'ACTIVE',
  'DEGRADED',
  'RETIRED',
  'REJECTED',
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

// ─── 能力包 Manifest ───────────────────────────────────
// 基于设计文档 §7.1～7.2

export const CapabilityManifest = z.object({
  schemaVersion: z.literal('1.0'),
  capabilityId: z.string(),
  version: z.string(),
  tenantId: z.string(),
  name: z.string(),
  taskType: z.enum(['collect', 'fill']),
  mode: TaskMode,

  site: z.object({
    domains: z.array(z.string()),
    entryUrlPatterns: z.array(z.string()),
    module: z.string(),
  }),

  runtime: z.object({
    language: z.literal('typescript'),
    playwrightRange: z.literal('pinned-by-platform'),
    browser: z.literal('chromium'),
    mode: z.array(z.enum(['cdp', 'native-playwright'])),
  }),

  permissions: z.object({
    domains: z.array(z.string()),
    downloads: z.boolean(),
    uploads: z.boolean(),
    filesystem: z.array(z.string()),
    requiresHumanLogin: z.boolean(),
  }),

  validation: z.object({
    status: z.enum(['pending', 'passed', 'failed']),
    validatedAt: z.string().datetime().optional(),
    consecutivePasses: z.number().int().nonnegative(),
    successRate30d: z.number().nullable(),
  }),

  fingerprints: z.array(z.string()),
  entrypoint: z.string(),

  // V2.0 新增字段（§7.2）
  riskLevel: RiskLevel,
  requiresApproval: z.boolean(),
  reversible: z.boolean(),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;

// ─── 动作语义分类 ───────────────────────────────────────
// 基于设计文档 §14.5

export const ActionCategory = z.enum([
  'read',       // 只读取信息
  'navigate',   // 页面跳转/滚动
  'input',      // 填写但未提交
  'commit',     // 提交/确认/支付/发送 — 不可逆
]);
export type ActionCategory = z.infer<typeof ActionCategory>;
