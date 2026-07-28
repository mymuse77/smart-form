import { ActionTrace } from './trace';
import { LocatorGenerator } from './locator';

export class PlaywrightCompiler {
  public static compileToTypeScript(trace: ActionTrace): string {
    const lines: string[] = [
      `// Auto-generated Playwright Collector Script`,
      `// Task ID: ${trace.taskId}`,
      `// Created At: ${new Date(trace.createdAt).toISOString()}`,
      ``,
      `import { Page } from 'playwright';`,
      ``,
      `export async function runCollector(page: Page): Promise<Record<string, any>[]> {`,
      `  const results: Record<string, any>[] = [];`,
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
        case 'fill':
          lines.push(`  await ${locatorStr}.fill('${step.value || ''}');`);
          break;
        case 'human_secret_input':
          lines.push(`  // HUMAN_INTERVENTION_REQUIRED: Sensitive input for ${step.target?.label || 'secret'}`);
          lines.push(`  await page.pause();`);
          break;
        case 'extract':
          lines.push(`  const extractedVal = await ${locatorStr}.text_content();`);
          lines.push(`  results.push({ field: '${step.fieldId || 'data'}', value: extractedVal });`);
          break;
      }
    });

    lines.push(``);
    lines.push(`  return results;`);
    lines.push(`}`);

    return lines.join('\n');
  }
}
