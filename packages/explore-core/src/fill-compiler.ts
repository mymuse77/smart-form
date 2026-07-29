import { ActionTrace } from './trace';
import { LocatorGenerator } from './locator';

export class PlaywrightFillCompiler {
  public static compileToTypeScript(trace: ActionTrace): string {
    const lines: string[] = [
      `// Auto-generated Playwright Form Filler Script (Write Mode)`,
      `// Task ID: ${trace.taskId}`,
      `// Created At: ${new Date(trace.createdAt).toISOString()}`,
      ``,
      `import { Page } from 'playwright';`,
      `import { DefaultFillerContext } from '@smart-form/capability-sdk';`,
      ``,
      `export async function runFiller(page: Page, formData: Record<string, any>): Promise<{ success: boolean; submissionId?: string }> {`,
      `  const fillerCtx = new DefaultFillerContext(page, '${trace.taskId}');`,
      `  await page.goto('${trace.targetUrl}', { waitUntil: 'domcontentloaded' });`,
      ``,
    ];

    trace.steps.forEach((step) => {
      const locatorStr = LocatorGenerator.generatePlaywrightLocator(step.target);
      switch (step.actionType) {
        case 'navigate':
          if (step.url) lines.push(`  await page.goto('${step.url}');`);
          break;
        case 'click':
          lines.push(`  await ${locatorStr}.click();`);
          break;
        case 'fill': {
          const fieldKey = step.fieldId || 'value';
          lines.push(`  await fillerCtx.fillField('${step.target.selector || 'input'}', formData['${fieldKey}'] ?? '${step.value || ''}');`);
          break;
        }
        case 'human_secret_input':
          lines.push(`  // HUMAN_INTERVENTION_REQUIRED: Sensitive input for ${step.target?.label || 'secret'}`);
          lines.push(`  await page.pause();`);
          break;
        case 'commit':
        case 'submit':
          lines.push(`  // WAITING_APPROVAL_SUBMIT: Human approval required before clicking submit`);
          lines.push(`  const approval = await fillerCtx.requestSubmitApproval(formData);`);
          lines.push(`  if (approval.approved) {`);
          lines.push(`    await ${locatorStr}.click();`);
          lines.push(`    return { success: true, submissionId: approval.submissionId };`);
          lines.push(`  }`);
          break;
      }
    });

    lines.push(``);
    lines.push(`  return { success: true };`);
    lines.push(`}`);
    lines.push(``);

    return lines.join('\n');
  }
}
