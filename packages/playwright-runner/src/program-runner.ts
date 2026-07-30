import { randomUUID } from 'node:crypto';
import type {
  CapabilityArtifactBundle,
  CapabilityStep,
  TaskDefinition,
} from '@smart-form/contracts';
import type { Locator, Page } from 'playwright';
import { isUrlAllowed } from './domain-policy';

export interface SubmissionApprovalRequest {
  submissionId: string;
  taskId: string;
  targetUrl: string;
  selector: string;
  formDataSnapshot: Record<string, unknown>;
}

export interface SubmissionApprovalGate {
  request(request: SubmissionApprovalRequest): Promise<boolean>;
}

export interface ProgramExecutionResult {
  data: Record<string, unknown>[];
  submissions: string[];
}

export interface ProgramExecutionHooks {
  beforeStep?(step: CapabilityStep, index: number): Promise<void>;
  afterStep?(step: CapabilityStep, index: number): Promise<void>;
}

const COMMIT_SELECTOR = /submit|confirm|approve|save|send|pay|提交|确认|保存|发送|支付/i;

function resolveValue(
  value: Extract<CapabilityStep, { type: 'fill' | 'select' }>['value'],
  task: TaskDefinition,
): string {
  if (value.source === 'literal') return String(value.value);
  if (!task.input || !(value.key in task.input.values)) {
    throw new Error(`Capability input is missing: ${value.key}`);
  }
  const resolved = task.input.values[value.key];
  if (resolved === null) return '';
  return String(resolved);
}

async function readField(
  root: Page | Locator,
  field: Extract<CapabilityStep, { type: 'extract' }>['fields'][number],
): Promise<unknown> {
  const locator = root.locator(field.selector).first();
  if (field.read === 'attribute') {
    if (!field.attribute) throw new Error(`Extract field ${field.name} requires an attribute`);
    return locator.getAttribute(field.attribute);
  }
  if (field.read === 'value') return locator.inputValue();
  return (await locator.textContent())?.trim() ?? null;
}

export class DeclarativeCapabilityRunner {
  static async execute(
    bundle: CapabilityArtifactBundle,
    page: Page,
    task: TaskDefinition,
    approvalGate: SubmissionApprovalGate,
    hooks: ProgramExecutionHooks = {},
  ): Promise<ProgramExecutionResult> {
    const data: Record<string, unknown>[] = [];
    const submissions: string[] = [];
    const allowedDomains = task.site.allowedDomains;

    for (const [index, step] of bundle.program.entries()) {
      await hooks.beforeStep?.(step, index);
      try {
      if (!isUrlAllowed(page.url(), allowedDomains)) {
        throw new Error('Capability cannot continue outside the allowed domains');
      }
      switch (step.type) {
        case 'navigate':
          if (!isUrlAllowed(step.url, allowedDomains)) {
            throw new Error(`Capability navigation is outside the allowed domains: ${step.url}`);
          }
          await page.goto(step.url, { waitUntil: 'domcontentloaded' });
          break;
        case 'click':
          if (COMMIT_SELECTOR.test(step.selector)) {
            throw new Error('Commit-like selectors require the submit approval primitive');
          }
          await page.locator(step.selector).click();
          break;
        case 'fill':
          await page.locator(step.selector).fill(resolveValue(step.value, task));
          break;
        case 'select':
          await page.locator(step.selector).selectOption(resolveValue(step.value, task));
          break;
        case 'press':
          await page.locator(step.selector).press(step.key);
          break;
        case 'waitFor':
          await page.locator(step.selector).waitFor({ state: step.state });
          break;
        case 'extract': {
          const count = step.collectionSelector
            ? Math.min(await page.locator(step.collectionSelector).count(), step.maxRecords)
            : 1;
          for (let index = 0; index < count; index += 1) {
            const root: Page | Locator = step.collectionSelector
              ? page.locator(step.collectionSelector).nth(index)
              : page;
            const record: Record<string, unknown> = {};
            for (const field of step.fields) {
              record[field.name] = await readField(root, field);
            }
            data.push(record);
          }
          break;
        }
        case 'submit': {
          if (task.mode !== 'write') throw new Error('Read tasks cannot submit');
          const submissionId = randomUUID();
          const values = task.input?.values ?? {};
          const snapshot = Object.fromEntries(
            step.snapshotKeys.map((key) => [key, values[key]]),
          );
          const approved = await approvalGate.request({
            submissionId,
            taskId: task.id,
            targetUrl: page.url(),
            selector: step.selector,
            formDataSnapshot: snapshot,
          });
          if (!approved) throw new Error(`Submission was rejected: ${submissionId}`);
          if (!isUrlAllowed(page.url(), allowedDomains)) {
            throw new Error('Submission page changed outside the allowed domains');
          }
          await page.locator(step.selector).click();
          submissions.push(submissionId);
          break;
        }
      }
      } finally {
        await hooks.afterStep?.(step, index);
      }
    }
    return { data, submissions };
  }
}
